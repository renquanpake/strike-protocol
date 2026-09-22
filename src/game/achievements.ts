/**
 * #41 成就系统：事件/快照驱动，localStorage `sp_achievements`（id→date）。
 * 每局结束时用本局 stats 检查 test()，触发即发 `achievement` 事件（UI toast + 音效）。
 */
import type { GameState } from './state'
import { loadCareer, recordMatch, type MatchRecord } from './career'

export interface AchievementDef {
  id: string
  name: string
  desc: string
  test(ctx: AchievementCtx): boolean
}

export interface AchievementCtx {
  state: GameState
  /** 本局结果（matchEnd 时可用） */
  result?: 'win' | 'loss' | 'draw'
  score?: [number, number]
}

const DEFS: AchievementDef[] = [
  { id: 'first_win', name: '首胜', desc: '赢下第一局对局', test: (c) => c.result === 'win' },
  {
    id: 'deadeye',
    name: '爆头大师',
    desc: '单局 10 次爆头',
    test: (c) => me(c).headshotKills >= 10,
  },
  {
    id: 'octokill',
    name: '杀戮机器',
    desc: '单局 10 杀',
    test: (c) => me(c).kills >= 10,
  },
  {
    id: 'snipe_far',
    name: '千里之外',
    desc: '超远距离狙击击杀（需埋点，V1 简化：10 杀以上即达成）',
    test: (c) => me(c).kills >= 10,
  },
  {
    id: 'clutch_1v5',
    name: '1v5 残局',
    desc: '1v5 残局取胜（需埋点，V1 简化：胜局且本队剩余击杀差）',
    test: (c) => c.result === 'win',
  },
  {
    id: 'defender',
    name: '拆弹专家',
    desc: '成功拆包（需埋点，V1 简化：胜局）',
    test: (c) => c.result === 'win',
  },
]

function me(c: AchievementCtx) {
  return c.state.players[0]
}

const KEY = 'sp_achievements'

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
  return checkAchievements({ state, result, score: [state.round.score.T, state.round.score.CT] })
}

export { loadCareer }
