import { CONFIG } from '../config'
import type { GameState } from '../state'
import type { LevelDef } from '../map/layout'
import { collideBrushes } from '../physics/collision'

/**
 * 每逻辑 tick 执行一次的角色运动积分。
 * 实现 Source 风格：地面摩擦+加速 / 空中加速（bhop 来源）/ 跳跃冲量 / 重力。
 * M1 起将校准 air accelerate 窗口与落地自动起跳（bhopWindowMs）。
 */
export function updateMovement(state: GameState, level: LevelDef, dt: number): void {
  const p = state.player
  const inp = state.input

  // 视角
  p.yaw -= inp.mouseDX * CONFIG.mouseSens
  p.pitch -= inp.mouseDY * CONFIG.mouseSens
  const pitchLimit = Math.PI / 2 - 0.01
  p.pitch = Math.min(pitchLimit, Math.max(-pitchLimit, p.pitch))

  // 蹲（M0：不受阻挡限制）
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

  // 摩擦
  const fric = p.onGround ? CONFIG.groundFriction : CONFIG.airFriction
  const decay = Math.max(0, 1 - fric * dt)
  p.velocity.x *= decay
  p.velocity.z *= decay

  // 加速
  if (wx !== 0 || wz !== 0) {
    const cur = p.velocity.x * wx + p.velocity.z * wz
    if (p.onGround) {
      // 地面：向 wishSpeed 加速，摩擦负责收敛
      if (cur < wishSpeed) {
        const add = Math.min(CONFIG.groundAccel * dt * wishSpeed, wishSpeed - cur)
        p.velocity.x += wx * add
        p.velocity.z += wz * add
      }
    } else if (cur < CONFIG.airMaxSpeed) {
      // 空中（bhop）：目标取 airMaxSpeed，每 tick 增量受 airSpeedCap 限制
      const add = Math.min(
        CONFIG.airAccel * dt * CONFIG.airMaxSpeed,
        CONFIG.airMaxSpeed - cur,
        CONFIG.airSpeedCap,
      )
      p.velocity.x += wx * add
      p.velocity.z += wz * add
    }
  }

  // 跳跃（M0：着地即跳；M1 加落地窗口自动 bhop）
  if (inp.jumpQueued && p.onGround) {
    p.velocity.y = CONFIG.jumpImpulse
    p.onGround = false
    p.lastGroundedTick = state.tick
  }

  // 重力
  p.velocity.y -= CONFIG.gravity * dt
  if (p.velocity.y < -CONFIG.maxFallSpeed) p.velocity.y = -CONFIG.maxFallSpeed

  // 碰撞
  p.onGround = collideBrushes(
    p.position,
    p.velocity,
    height,
    CONFIG.playerRadius,
    level.brushes,
    dt,
  )
  if (p.onGround) p.lastGroundedTick = state.tick

  // 坠出地图
  if (p.position.y < CONFIG.killFallY) {
    p.position.x = level.spawn.x
    p.position.y = level.spawn.y
    p.position.z = level.spawn.z
    p.velocity.x = 0
    p.velocity.y = 0
    p.velocity.z = 0
    p.onGround = false
  }
}
