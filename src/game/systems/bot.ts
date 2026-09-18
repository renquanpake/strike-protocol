import { CONFIG } from '../config'
import { WEAPONS } from '../weapons'
import type { GameState, PlayerEntity } from '../state'
import type { PreppedLevel } from '../physics/collision'
import type { NavGrid } from '../map/navmesh'
import { astar } from '../map/navmesh'
import { raycastBoxes } from '../physics/raycast'
import { buyItem } from '../economy'
import { inSmoke, throwGrenade } from './grenade'
import { viewForward } from './weapon'
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
  aimErrYaw: number
  aimErrPitch: number
  nextShotTick: number
  stuckTicks: number
  /** 最近一次感知到的敌人 id（用于反应窗口只在换目标时重置） */
  perceivedId: number | null
  nextThrowTick: number
  smokedThisRound: boolean
}

export interface BotContext {
  brains: Map<number, BotBrain>
  processedRound: number
  sites: { name: 'A' | 'B'; center: Vec3; elevation: number }[]
}

export function createBotContext(
  state: GameState,
  sites: { name: 'A' | 'B'; center: Vec3; elevation: number }[],
): BotContext {
  const brains = new Map<number, BotBrain>()
  for (const p of state.players) {
    if (p.isBot) {
      brains.set(p.id, {
        id: p.id,
        objective: v3(p.position.x, p.position.y, p.position.z),
        path: null,
        replanAt: 0,
        targetId: null,
        reactionUntil: 0,
        aimErrYaw: 0,
        aimErrPitch: 0,
        nextShotTick: 0,
        stuckTicks: 0,
        perceivedId: null,
        nextThrowTick: 0,
        smokedThisRound: false,
      })
    }
  }
  return { brains, processedRound: -1, sites }
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
  // 新回合：目标分配 + 经济决策
  if (r.phase === 'freeze' && r.roundNumber !== ctx.processedRound) {
    assignObjectives(state, ctx)
    botEconomy(state, events)
    ctx.processedRound = r.roundNumber
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

    const enemy = perceiveEnemy(state, level, p, brain)
    if (enemy === null) brain.perceivedId = null
    const engaging = enemy !== null && tick >= brain.reactionUntil

    let inp: InputFrame = emptyInput()

    if (engaging && enemy) {
      brain.targetId = enemy.id
      brain.path = null
      const blinded = tick < p.blindUntil
      const eye = { x: p.position.x, y: p.position.y + CONFIG.eyeHeight, z: p.position.z }
      const aimY = enemy.position.y + (rng.float() < 0.3 ? 60 : 44)
      const dx = enemy.position.x - eye.x
      const dy = aimY - eye.y
      const dz = enemy.position.z - eye.z
      const dist = Math.max(1, Math.hypot(dx, dy, dz))
      // 被致盲时瞄准误差放大
      const sigma = (0.02 + 0.00012 * dist) * (blinded ? 6 : 1)
      brain.aimErrYaw = gauss(rng) * sigma
      brain.aimErrPitch = gauss(rng) * sigma * 0.6
      const desiredYaw = Math.atan2(-dx, -dz) + brain.aimErrYaw
      const desiredPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist))) + brain.aimErrPitch
      const turnCap = 3 * dt
      const dyaw = angleDiff(desiredYaw, p.yaw)
      p.yaw += Math.max(-turnCap, Math.min(turnCap, dyaw))
      const dpitch = desiredPitch - p.pitch
      p.pitch += Math.max(-turnCap, Math.min(turnCap, dpitch))
      // 交战走位：周期切换侧移
      const toRight = Math.floor(tick / 32) % 2 === 0
      if (toRight) inp.right = 1
      else inp.left = 1
      // 开火（被致盲不开火）
      if (!blinded) {
        const w = p.activeSlot === 0 ? p.weapons.primary : p.weapons.secondary
        const def = w ? WEAPONS[w.defId] : null
        if (def && w && w.ammoMag > 0 && w.reloadUntilTick === 0) {
          if (def.auto) {
            inp.fireHeld = true
          } else if (tick >= brain.nextShotTick) {
            inp.fireQueued = true
            brain.nextShotTick = tick + Math.round((def.fireRateMs * 1.15 / 1000) * CONFIG.tickRate)
          }
        }
      }
      // 投掷物使用
      const fwd = viewForward(p.yaw, p.pitch)
      const throwDir = v3(dx / dist, dy / dist, dz / dist)
      const he = p.weapons.grenades[0]
      if (p.team === 'T' && he && he.ammoMag > 0 && tick >= brain.nextThrowTick && dist < 400) {
        throwGrenade(state, p, 'he', { x: p.position.x, y: p.position.y + 40, z: p.position.z }, throwDir, events)
        he.ammoMag -= 1
        brain.nextThrowTick = tick + Math.round((8000 / 1000) * CONFIG.tickRate)
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
      void fwd
    } else {
      brain.targetId = null
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
      } else {
        brain.path = null
        // 到达后：CT 持钳者靠近 C4 拆除
        const c4 = state.round.c4
        if (c4.state === 'planted' && p.team === 'CT' && p.hasKit && dist2D(p.position, c4.position) <= 40) {
          inp.useHeld = true
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

/** 感知：最近 LOS 可见敌人（100° 前向视野 + 480u 射程） */
function perceiveEnemy(state: GameState, level: PreppedLevel, p: PlayerEntity, brain: BotBrain): PlayerEntity | null {
  const eye = { x: p.position.x, y: p.position.y + CONFIG.eyeHeight, z: p.position.z }
  const range = 480
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
    if (dotf < -0.34) continue
    // 烟雾遮蔽：LOS 中点冒烟则视为不可见
    if (inSmoke(state, (eye.x + chest.x) / 2, (eye.y + chest.y) / 2, (eye.z + chest.z) / 2)) continue
    // 反应窗口仅在感知目标变化时重置，避免每 tick 反复推迟开火
    if (brain.perceivedId !== e.id) {
      brain.perceivedId = e.id
      brain.reactionUntil = state.tick + Math.round(((200 + state.rng.float() * 200) / 1000) * CONFIG.tickRate)
    }
    best = e
    bestDist = dist
  }
  return best
}

/** 目标分配：T 攻 A/B，CT 守 A/B/中路 */
function assignObjectives(state: GameState, ctx: BotContext): void {
  const [siteA, siteB] = ctx.sites
  const tBots = state.players.filter((x) => x.isBot && x.team === 'T')
  const ctBots = state.players.filter((x) => x.isBot && x.team === 'CT')
  tBots.forEach((p, i) => {
    const brain = ctx.brains.get(p.id)!
    const target = i % 3 === 2 ? siteB : siteA
    brain.objective = v3(target.center.x, target.elevation, target.center.z)
    brain.path = null
    brain.reactionUntil = 0
    brain.targetId = null
    brain.smokedThisRound = false
    brain.nextThrowTick = Math.round(3 * CONFIG.tickRate) // 开局 3s 后才允许投掷
  })
  ctBots.forEach((p, i) => {
    const brain = ctx.brains.get(p.id)!
    if (i === 4) {
      brain.objective = v3(0, 0, -100)
    } else {
      const target = i < 2 ? siteA : siteB
      brain.objective = v3(target.center.x + (i % 2 === 0 ? -60 : 60), target.elevation, target.center.z)
    }
    brain.path = null
    brain.reactionUntil = 0
    brain.targetId = null
    brain.smokedThisRound = false
    brain.nextThrowTick = Math.round(3 * CONFIG.tickRate)
  })
}

/** 经济决策：freeze 期购买 */
function botEconomy(state: GameState, events: EventBus): void {
  const r = state.round
  if (state.tick > 128) return
  for (const p of state.players) {
    if (!p.isBot) continue
    const streak = r.lossStreak[p.team]
    const wantForce = streak >= 3
    if (p.team === 'CT' && !p.hasKit && p.money >= 500) {
      buyItem(state, p, 'kit', events)
    }
    if (p.weapons.primary === null) {
      if (p.money >= WEAPONS.m4.price + 300 || wantForce) {
        buyItem(state, p, 'm4', events)
      } else if (p.money >= WEAPONS.mp9.price) {
        buyItem(state, p, 'mp9', events)
      }
    } else if (wantForce && p.money >= WEAPONS.awp.price) {
      buyItem(state, p, 'awp', events)
    }
    // 投掷物：T 买高爆+烟雾，CT 买烟雾+燃烧
    if (p.team === 'T') {
      if (!p.weapons.grenades[0] && p.money >= WEAPONS.he.price) buyItem(state, p, 'he', events)
      if (!p.weapons.grenades[2] && p.money >= WEAPONS.smoke.price) buyItem(state, p, 'smoke', events)
    } else {
      if (!p.weapons.grenades[2] && p.money >= WEAPONS.smoke.price) buyItem(state, p, 'smoke', events)
      if (!p.weapons.grenades[3] && p.money >= WEAPONS.molotov.price) buyItem(state, p, 'molotov', events)
    }
    p.activeSlot = p.weapons.primary ? 0 : 1
  }
}
