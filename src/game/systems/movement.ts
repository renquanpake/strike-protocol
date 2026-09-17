import { CONFIG } from '../config'
import type { GameState, PlayerEntity } from '../state'
import { collideBrushes, overlapLadder, type PreppedLevel } from '../physics/collision'

/** bhop 自动起跳窗口（tick）：落地后 N tick 内仍按住跳跃键则再起跳 */
function bhopWindowTicks(): number {
  return Math.max(1, Math.round((CONFIG.bhopWindowMs / 1000) * CONFIG.tickRate))
}

/**
 * 单个实体的每 tick 运动积分（人类与 Bot 共用，Bot 为合成输入）。
 * 顺序：视角 → 蹲/期望速 → 期望方向 → 摩擦 → 水平加速 → 梯子/跳跃/重力 → 碰撞(着地+吸收) → 坠落伤害 → 坠出地图。
 */
export function updatePlayerMovement(
  state: GameState,
  p: PlayerEntity,
  level: PreppedLevel,
  dt: number,
): void {
  const inp = p.input

  // 视角
  p.yaw -= inp.mouseDX * CONFIG.mouseSens
  p.pitch -= inp.mouseDY * CONFIG.mouseSens
  const pitchLimit = Math.PI / 2 - 0.01
  p.pitch = Math.min(pitchLimit, Math.max(-pitchLimit, p.pitch))

  // 蹲
  p.crouching = inp.crouch
  const height = p.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight
  const wishSpeed = p.crouching
    ? CONFIG.duckSpeed
    : inp.walk
      ? CONFIG.walkSpeed
      : CONFIG.moveMaxSpeed

  // 期望方向（相对视角）
  const fx = -Math.sin(p.yaw)
  const fz = -Math.cos(p.yaw)
  const rx = Math.cos(p.yaw)
  const rz = -Math.sin(p.yaw)
  let wx = fx * (inp.forward - inp.back) + rx * (inp.right - inp.left)
  let wz = fz * (inp.forward - inp.back) + rz * (inp.right - inp.left)
  const wl = Math.hypot(wx, wz)
  if (wl > 1e-6) {
    wx /= wl
    wz /= wl
  } else {
    wx = 0
    wz = 0
  }

  // 梯子判定（决定本 tick 是否走攀爬逻辑）
  p.onLadder = isOnLadder(p, height, level)

  // 摩擦
  const fric = p.onGround ? CONFIG.groundFriction : CONFIG.airFriction
  const decay = Math.max(0, 1 - fric * dt)
  p.velocity.x *= decay
  p.velocity.z *= decay

  // 水平加速（梯子上不推进）
  if (!p.onLadder && (wx !== 0 || wz !== 0)) {
    const cur = p.velocity.x * wx + p.velocity.z * wz
    if (p.onGround) {
      if (cur < wishSpeed) {
        const add = Math.min(CONFIG.groundAccel * dt * wishSpeed, wishSpeed - cur)
        p.velocity.x += wx * add
        p.velocity.z += wz * add
      }
    } else if (cur < CONFIG.airMaxSpeed) {
      const add = Math.min(
        CONFIG.airAccel * dt * CONFIG.airMaxSpeed,
        CONFIG.airMaxSpeed - cur,
        CONFIG.airSpeedCap,
      )
      p.velocity.x += wx * add
      p.velocity.z += wz * add
    }
  }

  // 坠落冲击采样（进入碰撞前的竖直速度）
  const impactSpeed = p.velocity.y < 0 ? -p.velocity.y : 0

  // 梯子 / 跳跃 / 重力
  if (p.onLadder) {
    p.velocity.y = inp.forward
      ? CONFIG.ladderClimbSpeed
      : inp.back
        ? -CONFIG.ladderClimbSpeed
        : 0
    p.velocity.x *= 0.6
    p.velocity.z *= 0.6
    p.onGround = false
  } else {
    // 跳跃：边沿触发，或落地窗口内按住跳跃键（自动 bhop）
    const inWindow = state.tick - p.lastGroundedTick <= bhopWindowTicks()
    if (p.onGround && (inp.jumpQueued || (inp.jumpHeld && inWindow))) {
      const bonus = p.crouching ? CONFIG.crouchJumpBonus : 0
      p.velocity.y = CONFIG.jumpImpulse + bonus
      p.onGround = false
    }
    p.velocity.y -= CONFIG.gravity * dt
    if (p.velocity.y < -CONFIG.maxFallSpeed) p.velocity.y = -CONFIG.maxFallSpeed
  }

  // 实心碰撞（着地 + 竖直吸收）
  const wasGrounded = p.onGround
  p.onGround = collideBrushes(
    p.position,
    p.velocity,
    height,
    CONFIG.playerRadius,
    level.solids,
    dt,
  )
  if (p.onGround) {
    p.velocity.y = 0
    p.lastGroundedTick = state.tick
  }
  const justLanded = p.onGround && !wasGrounded

  // 坠落伤害
  if (justLanded && impactSpeed >= CONFIG.fallDamageThreshold) {
    const dmg = (impactSpeed - CONFIG.fallDamageThreshold) * CONFIG.fallDamageScale
    p.health = Math.max(0, p.health - dmg)
  }

  // 坠出地图 → 回本队出生点
  if (p.position.y < CONFIG.killFallY) {
    const idx = p.id % 5
    const sp = level.spawns[p.team][idx] ?? level.spawns[p.team][0]
    p.position.x = sp.x
    p.position.y = sp.y
    p.position.z = sp.z
    p.velocity.x = 0
    p.velocity.y = 0
    p.velocity.z = 0
    p.onGround = false
    p.onLadder = false
  }
}

function isOnLadder(p: PlayerEntity, height: number, level: PreppedLevel): boolean {
  for (const l of level.ladders) {
    if (overlapLadder(p.position, height, CONFIG.playerRadius, l)) return true
  }
  return false
}
