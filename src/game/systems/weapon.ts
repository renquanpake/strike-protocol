import { CONFIG } from '../config'
import { WEAPONS, type WeaponDef, type WeaponInstance } from '../weapons'
import type { GameState } from '../state'
import type { EventBus } from '../../engine/eventbus'
import { v3, type Vec3 } from '../../engine/math'
import { targetAABBs } from '../entities/target'
import { raycastBoxes } from '../physics/raycast'
import type { PreppedLevel } from '../physics/collision'
import type { HitboxPart } from '../types'

/** 当前激活武器 */
export function activeWeapon(state: GameState): WeaponInstance | null {
  const s = state.player
  switch (s.activeSlot) {
    case 0:
      return s.weapons.primary
    case 1:
      return s.weapons.secondary
    default:
      return s.weapons.knife
  }
}

function msToTicks(ms: number): number {
  return Math.round((ms / 1000) * CONFIG.tickRate)
}

/** 纯函数：单发伤害 = 基础伤害 × 部位倍率 × 距离衰减 × 护甲减免 */
export function shotDamage(def: WeaponDef, part: HitboxPart, dist: number, armor: number): number {
  let d = def.damage * CONFIG.hitboxMultipliers[part]
  if (dist > def.falloffStart && def.falloffEnd > def.falloffStart) {
    const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart)
    const factor = 1 - t * (1 - def.rangeModifier)
    d *= Math.max(def.rangeModifier, factor)
  }
  if (part !== 'head' && armor > 0) {
    d *= 1 - 0.5 * (1 - def.armorPenetration)
  }
  return d
}

/** 换弹 / 切槽（每 tick） */
export function updateWeaponSystem(state: GameState, events: EventBus): void {
  const p = state.player
  const inp = state.input

  for (const inst of [p.weapons.primary, p.weapons.secondary, p.weapons.knife]) {
    if (!inst) continue
    const def = WEAPONS[inst.defId]
    if (inst.reloadUntilTick > 0 && state.tick >= inst.reloadUntilTick) {
      const transfer = Math.min(def.magazine - inst.ammoMag, inst.ammoReserve)
      inst.ammoMag += transfer
      inst.ammoReserve -= transfer
      inst.reloadUntilTick = 0
      events.emit({ type: 'reloadFinished', weaponId: def.id })
    }
  }

  if (inp.reloadQueued) {
    const w = activeWeapon(state)
    if (w) {
      const def = WEAPONS[w.defId]
      if (def.magazine > 0 && w.reloadUntilTick === 0 && w.ammoMag < def.magazine && w.ammoReserve > 0) {
        w.reloadUntilTick = state.tick + msToTicks(def.reloadMs)
        events.emit({ type: 'reloadStarted', weaponId: def.id })
      }
    }
  }

  if (inp.switchSlot !== null) {
    const slot = inp.switchSlot
    const target: WeaponInstance | null =
      slot === 0 ? p.weapons.primary : slot === 1 ? p.weapons.secondary : p.weapons.knife
    if (target && p.activeSlot !== slot) {
      p.activeSlot = slot
      target.burstCount = 0
      target.nextFireTick = state.tick + msToTicks(150) // 切枪硬直
    }
  }

  // 松手重置连射计数
  const w = activeWeapon(state)
  if (w && !inp.fireHeld) w.burstCount = 0
}

/** 开火（hitscan，每 tick 至多一发） */
export function fireWeapon(state: GameState, level: PreppedLevel, events: EventBus): void {
  const p = state.player
  const inp = state.input
  const w = activeWeapon(state)
  if (!w) return
  const def = WEAPONS[w.defId]

  if (state.tick < w.nextFireTick) return
  if (w.reloadUntilTick > 0) return

  const canFire = def.auto ? inp.fireHeld : inp.fireQueued
  if (!canFire) return

  const eye: Vec3 = {
    x: p.position.x,
    y: p.position.y + (p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight),
    z: p.position.z,
  }

  // 近战
  if (def.category === 'knife') {
    meleeStrike(state, def, eye, events)
    w.nextFireTick = state.tick + msToTicks(def.fireRateMs)
    events.emit({ type: 'shot', shooterId: 0, weaponId: def.id })
    return
  }

  if (w.ammoMag <= 0) return // 空仓（M7 播 click 音效）
  w.ammoMag -= 1
  w.burstCount += 1
  w.nextFireTick = state.tick + msToTicks(def.fireRateMs)

  // 后坐力：固定序列推进
  if (def.recoilPattern.length > 0) {
    const [pk, yk] = def.recoilPattern[w.recoilIndex % def.recoilPattern.length]
    w.recoilIndex = (w.recoilIndex + 1) % def.recoilPattern.length
    p.pitch += pk
    p.yaw += yk
  }

  // 弹道
  const forward = viewForward(p.yaw, p.pitch)
  const coneDeg = spreadDegrees(state, def) + def.spreadDeg.burstGrow * Math.min(w.burstCount, 10)
  const coneRad = (coneDeg * Math.PI) / 180
  let right = viewRight(p.yaw, p.pitch)
  // 正交化：去除了 forward 分量后归一
  const fr = forward.x * right.x + forward.y * right.y + forward.z * right.z
  right = normalize(v3(right.x - forward.x * fr, right.y - forward.y * fr, right.z - forward.z * fr))
  const up: Vec3 = v3(
    forward.y * right.z - forward.z * right.y,
    forward.z * right.x - forward.x * right.z,
    forward.x * right.y - forward.y * right.x,
  )

  const boxes = targetBoxes(state, level)
  for (let i = 0; i < def.pellets; i++) {
    const [ox, oy, oz] = state.rng.coneDirection(coneRad)
    const dir: Vec3 = normalize(
      v3(
        forward.x * oz + right.x * ox + up.x * oy,
        forward.y * oz + right.y * ox + up.y * oy,
        forward.z * oz + right.z * ox + up.z * oy,
      ),
    )
    const hit = raycastBoxes(eye, dir, boxes)
    if (!hit) continue
    if (hit.target.startsWith('target:')) {
      const tid = Number(hit.target.split(':')[1])
      const t = state.targets.find((x) => x.id === tid)
      if (!t || !t.alive || !hit.part) continue
      const part = hit.part as HitboxPart
      const dmg = shotDamage(def, part, hit.t, 0)
      t.health -= dmg
      t.hitFlashTick = state.tick
      events.emit({ type: 'hit', victimId: tid, part, damage: dmg })
      if (t.health <= 0) {
        t.alive = false
        t.respawnAtTick = state.tick + msToTicks(2000)
        events.emit({ type: 'targetKilled', victimId: tid, weaponId: def.id })
      }
    }
  }
  events.emit({ type: 'shot', shooterId: 0, weaponId: def.id })
}

function targetBoxes(state: GameState, level: PreppedLevel) {
  const boxes: { id: string; part?: string; min: Vec3; max: Vec3 }[] = []
  level.solids.forEach((b, i) => boxes.push({ id: `brush:${i}`, min: b.min, max: b.max }))
  for (const t of state.targets) {
    if (!t.alive) continue
    for (const box of targetAABBs(t)) {
      boxes.push({ id: `target:${t.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  return boxes
}

function meleeStrike(state: GameState, def: WeaponDef, eye: Vec3, events: EventBus): void {
  const p = state.player
  const forward = viewForward(p.yaw, p.pitch)
  const boxes: { id: string; part?: string; min: Vec3; max: Vec3 }[] = []
  for (const t of state.targets) {
    if (!t.alive) continue
    for (const box of targetAABBs(t)) {
      boxes.push({ id: `target:${t.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  const hit = raycastBoxes(eye, forward, boxes)
  const meleeRange = def.meleeRange ?? 0
  if (hit && hit.target.startsWith('target:') && hit.t <= meleeRange) {
    const tid = Number(hit.target.split(':')[1])
    const t = state.targets.find((x) => x.id === tid)
    if (!t) return
    t.health -= def.meleeDamage ?? def.damage
    t.hitFlashTick = state.tick
    events.emit({ type: 'hit', victimId: tid, part: hit.part ?? 'chest', damage: def.meleeDamage ?? def.damage })
    if (t.health <= 0) {
      t.alive = false
      t.respawnAtTick = state.tick + msToTicks(2000)
      events.emit({ type: 'targetKilled', victimId: tid, weaponId: def.id })
    }
  }
}

/** 散布状态锥角（度）：站定 / 移动 / 空中 */
export function spreadDegrees(state: GameState, def: WeaponDef): number {
  const p = state.player
  const hspeed = Math.hypot(p.velocity.x, p.velocity.z)
  if (!p.onGround) return def.spreadDeg.air
  if (hspeed > CONFIG.movingSpeedThreshold) return def.spreadDeg.move
  return def.spreadDeg.stand
}

export function viewForward(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return v3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp)
}

export function viewRight(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return v3(Math.cos(yaw) * cp, 0, -Math.sin(yaw) * cp)
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return l > 1e-9 ? v3(v.x / l, v.y / l, v.z / l) : v3(0, 0, 1)
}
