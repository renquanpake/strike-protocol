import { CONFIG } from '../config'
import { WEAPONS } from '../weapons'
import type { GameState, PlayerEntity } from '../state'
import { teamPlayers } from '../state'
import type { PreppedLevel } from '../physics/collision'
import type { NavGrid } from '../map/navmesh'
import { astar } from '../map/navmesh'
import { raycastBoxes } from '../physics/raycast'
import { buyItem, GEAR_PRICES } from '../economy'
import { inSmoke, throwGrenade } from './grenade'
import { v3, type Vec3 } from '../../engine/math'
import type { EventBus } from '../../engine/eventbus'
import { emptyInput, type InputFrame } from '../../engine/input'

export interface BotBrain {
  id: number
  objective: Vec3
  path: Vec3[] | null
  replanAt: number
  targetId: number | null
  reactionUntil: number
  nextShotTick: number
  stuckTicks: number
  /** 最近一次感知到的敌人 id（用于反应窗口只在换目标时重置） */
  perceivedId: number | null
  nextThrowTick: number
  smokedThisRound: boolean
  /** 到达目标点后的守点朝向（rad） */
  idleYaw: number
  /** 交战瞄准：锁定基础误差 + 跟踪时间（用于收敛） */
  baseAimYaw: number
  baseAimPitch: number
  trackTicks: number
  /** #22 战术：出发延迟截止 tick（slow 分批） */
  waitUntilTick: number
  /** #20：已对本目标投过闪光 */
  flashTarget: number | null
  /** #21：本回合投过燃烧瓶 */
  moloThrown: boolean
  /** 投掷物预投：本回合出发前封过烟（rush/slow/lurk T 队，出生区封爆点口） */
  preSmoke: boolean
  /** #23：最近无线电 tick */
  lastRadioTick: number
}

export type BotTactic = 'rush' | 'default' | 'slow' | 'lurk' | 'aggro' | 'stack'

export interface BotContext {
  brains: Map<number, BotBrain>
  processedRound: number
  /** 本回合 freeze 起始 tick（botEconomy 购买窗口 = freeze 前 128 tick，按回合相对计时） */
  freezeStartTick: number
  sites: { name: 'A' | 'B'; center: Vec3; elevation: number }[]
  /** #19 难度参数（第 5 档 = 现行基线） */
  profile: (typeof CONFIG.BOT_DIFFICULTY)[number]
  /** #22 本回合战术（freeze 时抽签，测试可断言） */
  tacticT: BotTactic
  tacticCT: BotTactic
}

/** #22 战术抽签（纯函数，可单测）：连败提升激进/潜伏概率 */
export function pickTactic(
  rng: { float(): number },
  team: 'T' | 'CT',
  streak: number,
): BotTactic {
  const roll = rng.float()
  if (team === 'T') {
    if (streak >= 3 && roll < 0.45) return 'lurk'
    if (roll < 0.3) return 'rush'
    if (roll < 0.6) return 'slow'
    return 'default'
  }
  if (streak >= 3 && roll < 0.4) return 'stack'
  if (roll < 0.3) return 'aggro'
  return 'default'
}

export function createBotContext(
  state: GameState,
  sites: { name: 'A' | 'B'; center: Vec3; elevation: number }[],
  difficulty: number = 5,
): BotContext {
  const brains = new Map<number, BotBrain>()
  const idx = Math.max(1, Math.min(10, Math.round(difficulty)))
  const profile = CONFIG.BOT_DIFFICULTY[idx - 1]
  for (const p of state.players) {
    if (p.isBot) {
      brains.set(p.id, {
        id: p.id,
        objective: v3(p.position.x, p.position.y, p.position.z),
        path: null,
        replanAt: 0,
        targetId: null,
        reactionUntil: 0,
        nextShotTick: 0,
        stuckTicks: 0,
        perceivedId: null,
        nextThrowTick: 0,
        smokedThisRound: false,
        idleYaw: 0,
        baseAimYaw: 0,
        baseAimPitch: 0,
        trackTicks: 0,
        waitUntilTick: 0,
        flashTarget: null,
        moloThrown: false,
        preSmoke: false,
        lastRadioTick: 0,
      })
    }
  }
  return { brains, processedRound: -1, freezeStartTick: 0, sites, profile, tacticT: 'default', tacticCT: 'default' }
}

function gauss(rng: { float(): number }): number {
  const u = Math.max(1e-9, rng.float())
  const v = rng.float()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v)
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** 每 tick 为全部 Bot 合成输入（移动 / 交火 / 交互 / 购买） */
export function updateBots(
  state: GameState,
  level: PreppedLevel,
  nav: NavGrid,
  ctx: BotContext,
  events: EventBus,
  dt: number,
): void {
  const r = state.round
  // 新回合：战术抽签 + 目标分配 + 经济决策
  if (r.phase === 'freeze' && r.roundNumber !== ctx.processedRound) {
    ctx.tacticT = pickTactic(state.rng, 'T', r.lossStreak.T)
    ctx.tacticCT = pickTactic(state.rng, 'CT', r.lossStreak.CT)
    assignObjectives(state, ctx)
    ctx.freezeStartTick = state.tick
    botEconomy(state, events, state.tick)
    ctx.processedRound = r.roundNumber
  }
  // retake：队友本 tick 阵亡 → 重分配战术目标（换防/改推点，避免 5 个 bot 站桩等死）
  for (const p of state.players) {
    if (p.isBot && !p.alive && p.deathTick === state.tick) {
      assignObjectives(state, ctx, true)
      break
    }
  }
  // C4 已安放 → CT 目标切到 C4 位置
  if (r.c4.state === 'planted') {
    for (const p of state.players) {
      if (!p.isBot || p.team !== 'CT') continue
      const brain = ctx.brains.get(p.id)!
      brain.objective = v3(r.c4.position.x, r.c4.position.y, r.c4.position.z)
      brain.path = null
    }
  }
  // #25 残局：时间所剩无几且 C4 未安放 → T bot 强冲最近爆点下包（无爆点地图跳过）
  if (r.phase === 'live' && r.c4.state === 'carried' && r.c4.carrierId !== null && ctx.sites.length > 0) {
    const remainingSec = Math.max(0, r.phaseEndTick - state.tick) / CONFIG.tickRate
    if (remainingSec < 20) {
      for (const p of state.players) {
        if (!p.isBot || p.team !== 'T') continue
        const brain = ctx.brains.get(p.id)!
        let best = ctx.sites[0]
        let bd = Infinity
        for (const s of ctx.sites) {
          const d = Math.hypot(s.center.x - p.position.x, s.center.z - p.position.z)
          if (d < bd) {
            bd = d
            best = s
          }
        }
        brain.objective = v3(best.center.x, best.elevation, best.center.z)
        brain.path = null
      }
    }
  }
  // #23 无线电：本队存活 ≤2 且未近期播报 → 随机呼叫支援（限频 10s/bot）
  if (r.phase === 'live' || r.phase === 'bombPlanted') {
    const aliveNow = (team: 'T' | 'CT') => teamPlayers(state, team).filter((p) => p.alive).length
    for (const p of state.players) {
      if (!p.isBot || !p.alive) continue
      const brain = ctx.brains.get(p.id)!
      if (aliveNow(p.team) <= 2 && state.tick - brain.lastRadioTick > 10 * CONFIG.tickRate && state.rng.float() < 0.02) {
        brain.lastRadioTick = state.tick
        events.emit({ type: 'radio', team: p.team, key: 'needBackup', playerId: p.id })
      }
    }
  }

  const tick = state.tick
  for (const p of state.players) {
    if (!p.isBot) continue
    if (!p.alive) {
      p.input = emptyInput()
      continue
    }
    const brain = ctx.brains.get(p.id)
    if (!brain) continue
    const rng = state.rng
    const profile = ctx.profile

    // #22 战术延迟：出发前原地待命
    if (tick < brain.waitUntilTick) {
      p.input = emptyInput()
      continue
    }

    const enemy = perceiveEnemy(state, level, p, brain, profile)
    if (enemy === null) brain.perceivedId = null
    // #25 残局：CT 持钳者正在拆除（贴 C4）时不交战，优先 defuse
    const defusing =
      p.team === 'CT' &&
      p.hasKit &&
      state.round.c4.state === 'planted' &&
      dist2D(p.position, state.round.c4.position) <= 45
    const engaging = enemy !== null && tick >= brain.reactionUntil && !defusing

    let inp: InputFrame = emptyInput()

    if (engaging && enemy) {
      brain.path = null
      const blinded = tick < p.blindUntil
      const eye = { x: p.position.x, y: p.position.y + CONFIG.eyeHeight, z: p.position.z }
      const aimY = enemy.position.y + (rng.float() < 0.3 ? 60 : 44)
      const dx = enemy.position.x - eye.x
      const dy = aimY - eye.y
      const dz = enemy.position.z - eye.z
      const dist = Math.max(1, Math.hypot(dx, dy, dz))

      // 换目标时锁定基础误差；持续跟踪则误差按时间常数收敛（越瞄越准）
      // #19：sigma0 / tau 按难度档缩放
      if (brain.targetId !== enemy.id) {
        const sigma0 = (0.02 + 0.00012 * dist) * profile.sigmaMul
        brain.baseAimYaw = gauss(rng) * sigma0
        brain.baseAimPitch = gauss(rng) * sigma0 * 0.6
        brain.trackTicks = 0
        brain.targetId = enemy.id
      } else {
        brain.trackTicks += 1
      }
      const errFactor = Math.exp(-brain.trackTicks / (CONFIG.botAimTauTicks * profile.tauMul)) * (blinded ? 6 : 1)
      // 狙击手盯得稳：误差减半
      const curW = p.activeSlot === 0 ? p.weapons.primary : p.weapons.secondary
      const sniperAim = curW ? WEAPONS[curW.defId].category === 'sniper' : false
      const aimErrYaw = brain.baseAimYaw * errFactor * (sniperAim ? 0.5 : 1)
      const aimErrPitch = brain.baseAimPitch * errFactor * (sniperAim ? 0.5 : 1)

      const desiredYaw = Math.atan2(-dx, -dz) + aimErrYaw
      const desiredPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist))) + aimErrPitch
      const turnCap = 3 * dt
      const dyaw = angleDiff(desiredYaw, p.yaw)
      p.yaw += Math.max(-turnCap, Math.min(turnCap, dyaw))
      const dpitch = desiredPitch - p.pitch
      p.pitch += Math.max(-turnCap, Math.min(turnCap, dpitch))
      // 交战走位：周期切换侧移（#19：周期按难度）
      const toRight = Math.floor(tick / profile.strafePeriod) % 2 === 0
      if (toRight) inp.right = 1
      else inp.left = 1
      // 开火（被致盲不开火；非狙击枪超射程不开火）
      if (!blinded && curW) {
        const def = WEAPONS[curW.defId]
        const inRange = def.category === 'sniper' || dist <= CONFIG.botHoldFireRange
        // #8：bot 狙击交火时开镜（获得 ADS 精度与低散布）
        inp.aimHeld = def.category === 'sniper' && curW.ammoMag > 0 && curW.reloadUntilTick === 0
        if (def && curW.ammoMag > 0 && curW.reloadUntilTick === 0 && inRange) {
          if (def.auto) {
            inp.fireHeld = true
          } else if (tick >= brain.nextShotTick) {
            inp.fireQueued = true
            brain.nextShotTick = tick + Math.round((def.fireRateMs * 1.15 / 1000) * CONFIG.tickRate)
          }
        }
      }
      // 投掷物使用
      const throwDir = v3(dx / dist, dy / dist, dz / dist)
      const he = p.weapons.grenades[0]
      if (p.team === 'T' && he && he.ammoMag > 0 && tick >= brain.nextThrowTick && dist < 400) {
        throwGrenade(state, p, 'he', { x: p.position.x, y: p.position.y + 40, z: p.position.z }, throwDir, events)
        he.ammoMag -= 1
        brain.nextThrowTick = tick + Math.round((8000 / 1000) * CONFIG.tickRate)
      }
      // #20：首次发现目标且距离 <500 时投闪光（限频：同目标只投一次）
      const flash = p.weapons.grenades[1]
      if (flash && flash.ammoMag > 0 && brain.flashTarget !== enemy.id && tick >= brain.nextThrowTick && dist < 500) {
        const fy = Math.max(0.25, dy / dist)
        throwGrenade(state, p, 'flash', { x: p.position.x, y: p.position.y + 40, z: p.position.z }, v3(dx / dist, fy, dz / dist), events)
        flash.ammoMag -= 1
        brain.flashTarget = enemy.id
        brain.nextThrowTick = tick + Math.round((8000 / 1000) * CONFIG.tickRate)
        // #23 无线电：投闪前呼叫
        events.emit({ type: 'radio', team: p.team, key: 'flashOut', playerId: p.id })
      }
      const smoke = p.weapons.grenades[2]
      const c4 = state.round.c4
      if (p.team === 'CT' && smoke && smoke.ammoMag > 0 && c4.state === 'planted' && !brain.smokedThisRound && tick >= brain.nextThrowTick) {
        const sdx = c4.position.x - p.position.x
        const sdz = c4.position.z - p.position.z
        const sdist = Math.max(1, Math.hypot(sdx, sdz))
        throwGrenade(state, p, 'smoke', { x: p.position.x, y: p.position.y + 40, z: p.position.z }, v3(sdx / sdist, 0.3, sdz / sdist), events)
        smoke.ammoMag -= 1
        brain.smokedThisRound = true
        brain.nextThrowTick = tick + Math.round((8000 / 1000) * CONFIG.tickRate)
      }
      // #23 无线电：首次发现敌人（限频 10s/人）
      if (tick - brain.lastRadioTick > 10 * CONFIG.tickRate && dist < 300) {
        brain.lastRadioTick = tick
        events.emit({ type: 'radio', team: p.team, key: 'enemySpotted', playerId: p.id })
      }
    } else {
      brain.targetId = null
      // A-R7：感知到敌人后驻停——反应窗口/记忆期内不推进战术目标，面向感知方向等待，
      // 防止窗口期走位漂出视野锥导致永远无法交战（回归缺陷修复）
      const perceived = brain.perceivedId !== null ? state.players[brain.perceivedId] : null
      if (perceived && perceived.alive) {
        const pdx = perceived.position.x - p.position.x
        const pdz = perceived.position.z - p.position.z
        const desiredYaw = Math.atan2(-pdx, -pdz)
        const dyaw = angleDiff(desiredYaw, p.yaw)
        const turnCap = 3 * dt
        p.yaw += Math.max(-turnCap, Math.min(turnCap, dyaw))
      } else {
        if (brain.path === null || tick >= brain.replanAt) {
          brain.path = astar(nav, p.position, brain.objective)
          brain.replanAt = tick + Math.round(2 * CONFIG.tickRate)
        }
        const moveDir = nextWaypointDir(p.position, brain.path)
        if (moveDir) {
          inp = moveInput(p, moveDir, inp, dt)
          const sp = Math.hypot(p.velocity.x, p.velocity.z)
          brain.stuckTicks = sp < 15 ? brain.stuckTicks + 1 : 0
          if (brain.stuckTicks >= 40) {
            inp.jumpQueued = true
            inp.jumpHeld = true
            brain.stuckTicks = 0
          }
          // 投掷物预投：T 队推进途中向目标爆点封一道烟（每 bot 每回合 1 颗，rush/slow 更前置）
          if (
            p.team === 'T' &&
            r.phase === 'live' &&
            !brain.preSmoke &&
            tick >= brain.nextThrowTick &&
            dist2D(p.position, brain.objective) > 300
          ) {
            const smoke = p.weapons.grenades[2]
            if (smoke && smoke.ammoMag > 0) {
              const tx = brain.objective.x - p.position.x
              const tz = brain.objective.z - p.position.z
              const tl = Math.max(1, Math.hypot(tx, tz))
              throwGrenade(
                state,
                p,
                'smoke',
                { x: p.position.x, y: p.position.y + 40, z: p.position.z },
                v3(tx / tl, ctx.tacticT === 'rush' ? 0.15 : 0.28, tz / tl),
                events,
              )
              smoke.ammoMag -= 1
              brain.preSmoke = true
              brain.nextThrowTick = tick + Math.round((8000 / 1000) * CONFIG.tickRate)
              events.emit({ type: 'radio', team: 'T', key: 'smokeOut', playerId: p.id })
            }
          }
        } else {
          brain.path = null
          // 到达后：守点架枪（朝 idleYaw 转向）
          const diw = angleDiff(brain.idleYaw, p.yaw)
          const turnCap = 3 * dt
          p.yaw += Math.max(-turnCap, Math.min(turnCap, diw))
          p.pitch = 0
          // #21：CT 守点投燃烧瓶（每回合 1 颗，朝守点前沿）
          const molo = p.weapons.grenades[3]
          if (p.team === 'CT' && molo && molo.ammoMag > 0 && !brain.moloThrown && tick >= brain.nextThrowTick) {
            const mdir = v3(-Math.sin(brain.idleYaw), 0.15, -Math.cos(brain.idleYaw))
            throwGrenade(state, p, 'molotov', { x: p.position.x, y: p.position.y + 40, z: p.position.z }, mdir, events)
            molo.ammoMag -= 1
            brain.moloThrown = true
          }
          // CT 持钳者靠近 C4 拆除（#25：拆除时优先，不交战）
          const c4 = state.round.c4
          if (c4.state === 'planted' && p.team === 'CT' && p.hasKit && dist2D(p.position, c4.position) <= 40) {
            inp.useHeld = true
          }
        }
      }
    }

    p.input = inp
  }
}

function nextWaypointDir(pos: Vec3, path: Vec3[] | null): Vec3 | null {
  if (!path || path.length === 0) return null
  const wp = path[0]
  const dx = wp.x - pos.x
  const dz = wp.z - pos.z
  if (Math.hypot(dx, dz) < 30) {
    path.shift()
    if (path.length === 0) return null
    const n = path[0]
    return v3(n.x - pos.x, 0, n.z - pos.z)
  }
  return v3(dx, 0, dz)
}

function moveInput(p: PlayerEntity, dir: Vec3, inp: InputFrame, dt: number): InputFrame {
  const dl = Math.hypot(dir.x, dir.z)
  if (dl < 1e-6) return inp
  const nx = dir.x / dl
  const nz = dir.z / dl
  const desiredYaw = Math.atan2(-nx, -nz)
  const turnCap = 6 * dt
  const dyaw = angleDiff(desiredYaw, p.yaw)
  p.yaw += Math.max(-turnCap, Math.min(turnCap, dyaw))
  const fx = -Math.sin(p.yaw)
  const fz = -Math.cos(p.yaw)
  const rx = Math.cos(p.yaw)
  const rz = -Math.sin(p.yaw)
  const fwd = nx * fx + nz * fz
  const side = nx * rx + nz * rz
  if (fwd > 0.3) inp.forward = 1
  else if (fwd < -0.3) inp.back = 1
  if (side > 0.3) inp.right = 1
  else if (side < -0.3) inp.left = 1
  return inp
}

/** 感知：最近 LOS 可见敌人（前向视野 + 难度感知距离） */
function perceiveEnemy(
  state: GameState,
  level: PreppedLevel,
  p: PlayerEntity,
  brain: BotBrain,
  profile: BotContext['profile'],
): PlayerEntity | null {
  const eye = { x: p.position.x, y: p.position.y + CONFIG.eyeHeight, z: p.position.z }
  const range = profile.viewRange
  let best: PlayerEntity | null = null
  let bestDist = Infinity
  const boxes = level.solids.map((b, i) => ({ id: `b${i}`, min: b.min, max: b.max }))
  const fx = -Math.sin(p.yaw)
  const fz = -Math.cos(p.yaw)
  for (const e of state.players) {
    if (e.id === p.id || !e.alive || e.team === p.team) continue
    const chest = { x: e.position.x, y: e.position.y + 44, z: e.position.z }
    const dx = chest.x - eye.x
    const dy = chest.y - eye.y
    const dz = chest.z - eye.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist > range || dist >= bestDist) continue
    const inv = 1 / dist
    const hit = raycastBoxes(eye, v3(dx * inv, dy * inv, dz * inv), boxes)
    if (hit && hit.t < dist - 12) continue
    const dotf = fx * dx * inv + fz * dz * inv
    if (dotf < CONFIG.botViewDot) continue
    // 烟雾遮蔽：LOS 中点冒烟则视为不可见
    if (inSmoke(state, (eye.x + chest.x) / 2, (eye.y + chest.y) / 2, (eye.z + chest.z) / 2)) continue
    // 反应窗口仅在感知目标变化时重置，避免每 tick 反复推迟开火（#19：窗口按难度）
    if (brain.perceivedId !== e.id) {
      brain.perceivedId = e.id
      const [rMin, rMax] = profile.reactionMs
      brain.reactionUntil =
        state.tick + Math.round(((rMin + state.rng.float() * (rMax - rMin)) / 1000) * CONFIG.tickRate)
    }
    best = e
    bestDist = dist
  }
  return best
}

/** 目标分配：按战术抽签（#22）——T：rush/default/slow/lurk；CT：aggro/stack/default。
 * force=true（队友阵亡 retake）：跳过出发延迟，立即重新分配，不重置投掷冷却。 */
function assignObjectives(state: GameState, ctx: BotContext, force = false): void {
  // 无爆点地图（训练场等）：bot 留守出生区，不做目标分配
  if (ctx.sites.length === 0) {
    for (const p of state.players) {
      if (!p.isBot) continue
      const brain = ctx.brains.get(p.id)
      if (!brain) continue
      brain.objective = v3(p.position.x, p.position.y, p.position.z)
      brain.path = null
    }
    return
  }
  const [siteA, siteBF] = ctx.sites
  const siteB = siteBF ?? siteA // 单爆点图回落到 A
  const tBots = state.players.filter((x) => x.isBot && x.team === 'T')
  const ctBots = state.players.filter((x) => x.isBot && x.team === 'CT')
  tBots.forEach((p, i) => {
    const brain = ctx.brains.get(p.id)!
    const tactic = ctx.tacticT
    let target = siteA
    if (tactic === 'lurk' && i === 0) target = siteB // 1 人潜伏绕 B
    else if (i % 3 === 2 && tactic !== 'rush' && tactic !== 'lurk') target = siteB
    brain.objective = v3(target.center.x, target.elevation, target.center.z)
    brain.idleYaw = Math.PI // T 守点面朝 +Z（CT 回防方向）
    brain.path = null
    brain.reactionUntil = 0
    brain.targetId = null
    brain.smokedThisRound = force ? brain.smokedThisRound : false
    brain.flashTarget = force ? brain.flashTarget : null
    brain.moloThrown = force ? brain.moloThrown : false
    brain.waitUntilTick = force ? 0 : tactic === 'slow' ? state.tick + Math.round(((3000 + state.rng.float() * 5000) / 1000) * CONFIG.tickRate) : 0
    if (!force) brain.nextThrowTick = Math.round(3 * CONFIG.tickRate) // 开局 3s 后才允许投掷
  })
  ctBots.forEach((p, i) => {
    const brain = ctx.brains.get(p.id)!
    const tactic = ctx.tacticCT
    if (tactic === 'aggro' && i < 2) {
      // 前压 2 人进中路
      brain.objective = v3(0, 0, -100 + i * 120)
      brain.idleYaw = Math.PI
    } else if (tactic === 'stack') {
      // 连败堆 A：3 人 A、其余 B（简化 3+2 分配，i 越界回落到 B）
      brain.objective =
        i < 3
          ? v3(siteA.center.x + (i % 2 === 0 ? -60 : 60), siteA.elevation, siteA.center.z)
          : v3(siteB.center.x + (i % 2 === 0 ? -60 : 60), siteB.elevation, siteB.center.z)
      brain.idleYaw = i < 3 ? -Math.PI / 2 : Math.PI / 2
    } else {
      // default / aggro 其余人：2A / 2B / 1 中路
      if (i >= ctBots.length - 1 && ctBots.length <= 5 && i === 4) {
        brain.objective = v3(0, 0, -100)
        brain.idleYaw = Math.PI
      } else {
        const target = i < 2 ? siteA : siteB
        brain.objective = v3(target.center.x + (i % 2 === 0 ? -60 : 60), target.elevation, target.center.z)
        brain.idleYaw = i < 2 ? -Math.PI / 2 : Math.PI / 2
      }
    }
    brain.path = null
    brain.reactionUntil = 0
    brain.targetId = null
    brain.smokedThisRound = force ? brain.smokedThisRound : false
    brain.flashTarget = force ? brain.flashTarget : null
    brain.moloThrown = force ? brain.moloThrown : false
    brain.waitUntilTick = 0
    if (!force) brain.nextThrowTick = Math.round(3 * CONFIG.tickRate)
  })
}

/** 经济决策：freeze 期购买（阵营分枪：T 系 AK / CT 系 M4）。仅 freeze 前 2s（128 tick，相对起点）内执行 */
function botEconomy(state: GameState, events: EventBus, freezeStartTick: number): void {
  const r = state.round
  if (state.tick - freezeStartTick > 128) return
  for (const p of state.players) {
    if (!p.isBot) continue
    const streak = r.lossStreak[p.team]
    const wantForce = streak >= 3
    if (p.team === 'CT' && !p.hasKit && p.money >= GEAR_PRICES.kit) {
      buyItem(state, p, 'kit', events)
    }
    if (p.weapons.primary === null) {
      const rifle = p.team === 'T' ? 'ak' : 'm4'
      if (p.money >= WEAPONS[rifle].price + 300 || wantForce) {
        buyItem(state, p, rifle, events)
      } else if (p.money >= WEAPONS.mp9.price) {
        buyItem(state, p, 'mp9', events)
      }
    } else if (wantForce && p.money >= WEAPONS.awp.price) {
      buyItem(state, p, 'awp', events)
    }
    // #18 护甲：钱富余时购买（连败后优先保甲）
    if (p.armor === 0 && (wantForce || p.money >= 4000) && p.money >= 1650) {
      buyItem(state, p, 'kevlarHelmet', events)
    }
    // 投掷物：T 买高爆+闪光+烟雾，CT 买闪光+烟雾+燃烧（阵营限购由 buyItem 兜底）
    if (p.team === 'T') {
      if (!p.weapons.grenades[0] && p.money >= WEAPONS.he.price) buyItem(state, p, 'he', events)
      if (!p.weapons.grenades[1] && p.money >= WEAPONS.flash.price) buyItem(state, p, 'flash', events)
      if (!p.weapons.grenades[2] && p.money >= WEAPONS.smoke.price) buyItem(state, p, 'smoke', events)
    } else {
      if (!p.weapons.grenades[1] && p.money >= WEAPONS.flash.price) buyItem(state, p, 'flash', events)
      if (!p.weapons.grenades[2] && p.money >= WEAPONS.smoke.price) buyItem(state, p, 'smoke', events)
      if (!p.weapons.grenades[3] && p.money >= WEAPONS.molotov.price) buyItem(state, p, 'molotov', events)
    }
    p.activeSlot = p.weapons.primary ? 0 : 1
  }
}
