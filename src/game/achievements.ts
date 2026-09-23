/**
 * #41 成就系统：matchEnd 快照判定，12 个成就，localStorage 双 key：
 * - `sp_achievements`：id→解锁时间（只弹一次）
 * - `sp_ach_meta`：跨局累计（爆头总数 / 连败数 / 武器类别集邮 / 拆包总数）
 */
import type { GameState } from './state'
import { loadCareer, recordMatch, type MatchRecord } from './career'

export interface AchievementDef {
  id: string
  name: string
  desc: string
  test(ctx: AchievementCtx): boolean
}

/** 跨局累计元数据（persistMatchEnd 维护） */
export interface AchMeta {
  /** 历史累计爆头 */
  hsTotal: number
  /** 连败局数（赢一局清零） */
  lossStreak: number
  /** 历史击杀武器类别集（全武器集邮） */
  killCats: string[]
  /** 历史拆包总数 */
  defusesTotal: number
}

export interface AchievementCtx {
  state: GameState
  /** 本局结果（matchEnd 时可用） */
  result?: 'win' | 'loss' | 'draw'
  score?: [number, number]
  /** 检查时使用的跨局累计（含本局增量，不含本局胜负对连败的影响） */
  meta: AchMeta
}

const KILL_CATS_ALL = ['knife', 'pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'lmg']

const DEFS: AchievementDef[] = [
  { id: 'first_win', name: '首胜', desc: '赢下第一局对局', test: (c) => c.result === 'win' },
  { id: 'deadeye', name: '爆头大师', desc: '单局 10 次爆头', test: (c) => me(c).headshotKills >= 10 },
  { id: 'octokill', name: '杀戮机器', desc: '单局 10 杀', test: (c) => me(c).kills >= 10 },
  {
    id: 'hs_streak',
    name: '爆头机器',
    desc: '跨局累计 10 次爆头',
    test: (c) => c.meta.hsTotal >= 10,
  },
  {
    id: 'clutch_1v5',
    name: '残局大师',
    desc: '己方仅 1 人存活时赢下回合',
    test: (c) => c.state.matchStats.myClutch >= 1,
  },
  {
    id: 'knife_kill',
    name: '刀枪不入',
    desc: '用小刀完成一次击杀',
    test: (c) => c.state.matchStats.knifeKills >= 1,
  },
  {
    id: 'he_triple',
    name: '雷霆三响',
    desc: '单局用破片雷完成 3 次击杀',
    test: (c) => c.state.matchStats.heKills >= 3,
  },
  {
    id: 'win_after_plant',
    name: '下包制胜',
    desc: '本局下过包并赢得对局（T 阵营）',
    test: (c) => c.state.players[0].team === 'T' && c.state.matchStats.plants > 0 && c.result === 'win',
  },
  {
    id: 'defuse',
    name: '拆弹专家',
    desc: '成功拆除 C4（CT 阵营）',
    test: (c) => c.state.players[0].team === 'CT' && c.state.matchStats.defuses >= 1,
  },
  {
    id: 'comeback',
    name: '触底反弹',
    desc: '连败 5 局后赢下一局',
    test: (c) => c.meta.lossStreak >= 5 && c.result === 'win',
  },
  {
    id: 'snipe_far',
    name: '千里之外',
    desc: '单次击杀距离超过 800u',
    test: (c) => c.state.matchStats.maxKillDist > 800,
  },
  {
    id: 'all_cats',
    name: '全武器集邮',
    desc: '累计用 7 类武器（刀/手枪/冲锋/步枪/狙击/霰弹/机枪）完成击杀',
    test: (c) => KILL_CATS_ALL.every((k) => c.meta.killCats.includes(k)),
  },
]

function me(c: AchievementCtx) {
  return c.state.players[0]
}

const KEY = 'sp_achievements'
const META_KEY = 'sp_ach_meta'

export function loadUnlocked(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function saveUnlocked(m: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // 静默
  }
}

export function loadMeta(): AchMeta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (raw) {
      const m = JSON.parse(raw) as Partial<AchMeta>
      return {
        hsTotal: m.hsTotal ?? 0,
        lossStreak: m.lossStreak ?? 0,
        killCats: m.killCats ?? [],
        defusesTotal: m.defusesTotal ?? 0,
      }
    }
  } catch {
    // 损坏则重置
  }
  return { hsTotal: 0, lossStreak: 0, killCats: [], defusesTotal: 0 }
}

export function saveMeta(m: AchMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m))
  } catch {
    // 静默
  }
}

/** 一局结束：返回新解锁的成就 id 列表（并持久化） */
export function checkAchievements(ctx: AchievementCtx): string[] {
  const unlocked = loadUnlocked()
  const fresh: string[] = []
  for (const def of DEFS) {
    if (unlocked[def.id] !== undefined) continue
    if (def.test(ctx)) {
      unlocked[def.id] = Date.now()
      fresh.push(def.id)
    }
  }
  if (fresh.length > 0) saveUnlocked(unlocked)
  return fresh
}

export function achievementName(id: string): string {
  return DEFS.find((d) => d.id === id)?.name ?? id
}

export const ACHIEVEMENT_DEFS = DEFS

/** 全部成就条目（UI 展示用） */
export function allAchievements(): { id: string; name: string; desc: string }[] {
  return DEFS.map((d) => ({ id: d.id, name: d.name, desc: d.desc }))
}

// 生涯 + 成就一站式写入（matchEnd 调用）
export function persistMatchEnd(
  state: GameState,
  result: 'win' | 'loss' | 'draw',
  mapId: string,
  mode: string,
): string[] {
  const p = state.players[0]
  const rec: Omit<MatchRecord, 'date'> = {
    mapId,
    mode,
    result,
    score: [state.round.score.T, state.round.score.CT],
    k: p.kills,
    d: p.deaths,
    hs: p.headshotKills,
  }
  recordMatch(rec)
  const meta = loadMeta()
  const ms = state.matchStats
  // 检查用「含本局增量的累计」；连败判定用本局胜负前
  const ctxMeta: AchMeta = {
    hsTotal: meta.hsTotal + p.headshotKills,
    lossStreak: meta.lossStreak,
    killCats: [...meta.killCats],
    defusesTotal: meta.defusesTotal + ms.defuses,
  }
  for (const c of ms.killCats) if (!ctxMeta.killCats.includes(c)) ctxMeta.killCats.push(c)
  const fresh = checkAchievements({
    state,
    result,
    score: [state.round.score.T, state.round.score.CT],
    meta: ctxMeta,
  })
  meta.hsTotal = ctxMeta.hsTotal
  meta.killCats = ctxMeta.killCats
  meta.defusesTotal = ctxMeta.defusesTotal
  meta.lossStreak = result === 'loss' ? meta.lossStreak + 1 : result === 'win' ? 0 : meta.lossStreak
  saveMeta(meta)
  return fresh
}

export { loadCareer }
