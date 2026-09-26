import { CONFIG } from '../config'
import type { GameState, PlayerEntity } from '../state'
import { collideBrushes, overlapLadder, type PreppedLevel } from '../physics/collision'
import type { EventBus } from '../../engine/eventbus'
import { activeWeapon } from './weapon'
import { WEAPONS } from '../weapons'

/** bhop 自动起跳窗口（tick）：落地后 N tick 内仍按住跳跃键则再起跳 */
function bhopWindowTicks(): number {
  return Math.max(1, Math.round((CONFIG.bhopWindowMs / 1000) * CONFIG.tickRate))
}

/** #3 设置层：鼠标灵敏度倍率（默认 1 = CONFIG.mouseSens 原值），由 main.ts 应用设置时注入 */
let mouseSensScale = 1
export function setMouseSensScale(v: number): void {
  mouseSensScale = v
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
  events?: EventBus,
): void {
  const inp = p.input

  // #8 ADS：开镜武器右键瞄准时降敏 + 减速（开镜灵敏度按倍率反比缩放，见 weapons.zoom.sensScales）
  const activeW = activeWeapon(p)
  const zoomDef = activeW ? WEAPONS[activeW.defId].zoom : undefined
  const aiming = inp.aimHeld && !!zoomDef
  const zoomStage = p.aimStage > 0 ? p.aimStage : aiming ? 1 : 0
  const sensScale = aiming && zoomDef ? (zoomDef.sensScales?.[zoomStage - 1] ?? zoomDef.sensScale) : 1

  // 视角
  p.yaw -= inp.mouseDX * CONFIG.mouseSens * mouseSensScale * sensScale
  p.pitch -= inp.mouseDY * CONFIG.mouseSens * mouseSensScale * sensScale
  const pitchLimit = Math.PI / 2 - 0.01
  p.pitch = Math.min(pitchLimit, Math.max(-pitchLimit, p.pitch))

  // 蹲
  p.crouching = inp.crouch
  const height = p.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight
  let wishSpeed = p.crouching
    ? CONFIG.duckSpeed
    : inp.walk
      ? CONFIG.walkSpeed
      : CONFIG.moveMaxSpeed
  if (aiming) wishSpeed *= 0.4
  // 武器移速系数（CS 2018 起全枪 1.0，字段保留给武器表驱动）
  if (activeW) wishSpeed *= WEAPONS[activeW.defId].moveSpeedScale

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

  // 摩擦 + 水平加速（CS 模型：有输入时仅垂直于期望方向的分量衰减，平行分量加速至 wishSpeed；
  // 无输入时全速衰减，地面带 stopSpeed 地板）
  if (!p.onLadder) {
    if (wx !== 0 || wz !== 0) {
      const cur = p.velocity.x * wx + p.velocity.z * wz
      const px = p.velocity.x - cur * wx
      const pz = p.velocity.z - cur * wz
      const perps = Math.hypot(px, pz)
      let pScale = 0
      if (perps > 1e-6) {
        if (p.onGround) {
          pScale = perps > CONFIG.groundStopSpeed * dt ? Math.max(0, 1 - CONFIG.groundFriction * dt) : 0
        } else {
          pScale = Math.max(0, 1 - CONFIG.airFriction * dt)
        }
      }
      let newCur = cur
      if (p.onGround) {
        if (cur < wishSpeed) newCur = cur + Math.min(CONFIG.groundAccel * dt * wishSpeed, wishSpeed - cur)
      } else if (cur < CONFIG.airMaxSpeed) {
        newCur =
          cur +
          Math.min(CONFIG.airAccel * dt * CONFIG.airMaxSpeed, CONFIG.airMaxSpeed - cur, CONFIG.airSpeedCap)
      }
      p.velocity.x = px * pScale + wx * newCur
      p.velocity.z = pz * pScale + wz * newCur
    } else {
      const hs = Math.hypot(p.velocity.x, p.velocity.z)
      if (hs > 1e-6) {
        let s: number
        if (p.onGround) {
          const stop = CONFIG.groundStopSpeed * dt
          s = hs > stop ? Math.max(0, 1 - CONFIG.groundFriction * dt) : Math.max(0, hs - stop) / hs
        } else {
          s = Math.max(0, 1 - CONFIG.airFriction * dt)
        }
        p.velocity.x *= s
        p.velocity.z *= s
      }
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

  // 实心碰撞（着地 + 竖直吸收 + 台阶上行）
  const wasGrounded = p.onGround
  p.onGround = collideBrushes(
    p.position,
    p.velocity,
    height,
    CONFIG.playerRadius,
    level.solids,
    dt,
    CONFIG.stepHeight,
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

  // 脚步（静走无声；空中不触发）
  if (events && p.onGround && !inp.walk) {
    const hspeed = Math.hypot(p.velocity.x, p.velocity.z)
    if (hspeed > 30) {
      p.stepTimer += hspeed * dt
      // 约每 40u 一步
      if (p.stepTimer >= 40) {
        p.stepTimer = 0
        const mat = groundMaterial(level, p.position)
        events.emit({
          type: 'footstep',
          playerId: p.id,
          material: mat,
          x: p.position.x,
          y: p.position.y,
          z: p.position.z,
        })
      }
    }
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

/** 脚下最高实心顶面的材质（用于脚步音效区分） */
function groundMaterial(level: PreppedLevel, pos: { x: number; z: number; y: number }): string {
  let best = -9999
  let mat = 'sand'
  for (const b of level.solids) {
    if (pos.x < b.min.x || pos.x > b.max.x) continue
    if (pos.z < b.min.z || pos.z > b.max.z) continue
    if (b.max.y > best && b.max.y <= pos.y + 2) {
      best = b.max.y
      mat = b.material
    }
  }
  return mat
}
