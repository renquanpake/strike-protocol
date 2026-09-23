import { CONFIG } from '../config'
import { WEAPONS, type WeaponDef, type WeaponInstance } from '../weapons'
import type { GameState, PlayerEntity } from '../state'
import type { EventBus } from '../../engine/eventbus'
import { v3, type Vec3 } from '../../engine/math'
import { targetAABBs } from '../entities/target'
import { humanAABBs } from '../entities/bot'
import { raycastBoxes } from '../physics/raycast'
import type { PreppedLevel } from '../physics/collision'
import type { HitboxPart } from '../types'
import { grantKillReward } from '../economy'
import { throwGrenade } from './grenade'

/** 当前激活武器 */
export function activeWeapon(p: PlayerEntity): WeaponInstance | null {
  switch (p.activeSlot) {
    case 0:
      return p.weapons.primary
    case 1:
      return p.weapons.secondary
    case 2:
      return p.weapons.knife
    default: {
      // 3..6 = 投掷物槽（he/flash/smoke/molotov）
      const i = p.activeSlot - 3
      if (i >= 0 && i < p.weapons.grenades.length) return p.weapons.grenades[i]
      return p.weapons.knife
    }
  }
}

function msToTicks(ms: number): number {
  return Math.round((ms / 1000) * CONFIG.tickRate)
}

/** 纯函数：单发伤害 = 基础伤害 × 部位倍率 × 距离衰减 × 护甲减免（#18：头盔减爆头） */
export function shotDamage(def: WeaponDef, part: HitboxPart, dist: number, armor: number, helmet: boolean = false): number {
  let d = def.damage * CONFIG.hitboxMultipliers[part]
  if (dist > def.falloffStart && def.falloffEnd > def.falloffStart) {
    const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart)
    const factor = 1 - t * (1 - def.rangeModifier)
    d *= Math.max(def.rangeModifier, factor)
  }
  if (part !== 'head' && armor > 0) {
    d *= 1 - 0.5 * (1 - def.armorPenetration)
  }
  if (part === 'head' && helmet) {
    d *= 1 - 0.5 * (1 - def.armorPenetration)
  }
  return d
}

/** 换弹 / 切槽（每 tick，单玩家） */
export function updateWeaponSystem(state: GameState, p: PlayerEntity, events: EventBus): void {
  const inp = p.input

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
    const w = activeWeapon(p)
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
      slot === 0
        ? p.weapons.primary
        : slot === 1
          ? p.weapons.secondary
          : slot === 2
            ? p.weapons.knife
            : p.weapons.grenades[slot - 3] ?? null
    if (target && p.activeSlot !== slot) {
      p.activeSlot = slot
      target.burstCount = 0
      target.nextFireTick = state.tick + msToTicks(150) // 切枪硬直
    }
  }

  const w = activeWeapon(p)
  if (w && !inp.fireHeld) w.burstCount = 0
}

/** 开火（hitscan，每 tick 至多一发） */
export function fireWeapon(
  state: GameState,
  shooter: PlayerEntity,
  level: PreppedLevel,
  events: EventBus,
): void {
  if (!shooter.alive) return
  // 买枪期/回合间隙禁止开火（对标 CS：仅 live/bombPlanted/warmup 可开火）
  if (state.round.phase !== 'live' && state.round.phase !== 'bombPlanted' && state.round.phase !== 'warmup') {
    return
  }
  const p = shooter
  const inp = p.input
  const w = activeWeapon(p)
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
    meleeStrike(state, p, def, eye, events)
    w.nextFireTick = state.tick + msToTicks(def.fireRateMs)
    events.emit({ type: 'shot', shooterId: p.id, weaponId: def.id })
    return
  }

  // 投掷物
  if (def.category === 'grenade') {
    if (w.ammoMag <= 0) return
    w.ammoMag -= 1
    w.nextFireTick = state.tick + msToTicks(def.fireRateMs)
    const forward = viewForward(p.yaw, p.pitch)
    const origin = v3(eye.x + forward.x * 30, eye.y + forward.y * 30, eye.z + forward.z * 30)
    throwGrenade(state, p, def.id, origin, forward, events)
    return
  }

  // #37 训练场：无限弹药（不扣弹匣）
  if (w.ammoMag <= 0 && !state.training) return
  if (!state.training) w.ammoMag -= 1
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
  const coneDeg = spreadDegrees(p, def, p.input.aimHeld) + def.spreadDeg.burstGrow * Math.min(w.burstCount, 10)
  const coneRad = (coneDeg * Math.PI) / 180
  let right = viewRight(p.yaw, p.pitch)
  const fr = forward.x * right.x + forward.y * right.y + forward.z * right.z
  right = normalize(v3(right.x - forward.x * fr, right.y - forward.y * fr, right.z - forward.z * fr))
  const up: Vec3 = v3(
    forward.y * right.z - forward.z * right.y,
    forward.z * right.x - forward.x * right.z,
    forward.x * right.y - forward.y * right.x,
  )

  const boxes = hitBoxes(state, level, p.id)
  let wallHit: { point: Vec3; normal: Vec3 } | null = null
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
      events.emit({ type: 'hit', victimId: tid, part, damage: dmg, attackerId: p.id })
      if (t.health <= 0) {
        t.alive = false
        t.respawnAtTick = state.tick + msToTicks(2000)
        events.emit({ type: 'targetKilled', victimId: tid, weaponId: def.id })
      }
    } else if (hit.target.startsWith('player:')) {
      const vid = Number(hit.target.split(':')[1])
      const victim = state.players.find((x) => x.id === vid)
      if (!victim || !victim.alive || !hit.part) continue
      const part = hit.part as HitboxPart
      const dmg = shotDamage(def, part, hit.t, victim.armor, victim.helmet)
      applyPlayerHit(state, p, victim, dmg, def, events, part === 'head')
    } else if (hit.target.startsWith('brush:')) {
      // #35 玻璃：命中玻璃 brush → 一次性碎裂（物理通行 + 渲染隐藏 + 音效/碎片）
      const bi = Number(hit.target.split(':').slice(1).join(':'))
      const b = level.solids[bi]
      if (b && b.material === 'glass' && !state.brokenGlass.includes(b)) {
        state.brokenGlass.push(b)
        level.solids = level.allSolids.filter((x) => x !== b)
        events.emit({ type: 'glassBreak', x: hit.point.x, y: hit.point.y, z: hit.point.z })
      }
      if (p.id === 0 && !wallHit) {
        wallHit = { point: hit.point, normal: hit.normal }
      }
    } else if (p.id === 0 && !wallHit) {
      // 命中地图墙体（仅本地玩家，供印花投射）
      wallHit = { point: hit.point, normal: hit.normal }
    }
  }
  if (wallHit) {
    events.emit({
      type: 'surfaceHit',
      shooterId: p.id,
      weaponId: def.id,
      point: wallHit.point,
      normal: wallHit.normal,
      pellets: def.pellets,
    })
  }
  events.emit({ type: 'shot', shooterId: p.id, weaponId: def.id })
}

function applyPlayerHit(
  state: GameState,
  shooter: PlayerEntity,
  victim: PlayerEntity,
  dmg: number,
  def: WeaponDef,
  events: EventBus,
  headshot: boolean = false,
): void {
  victim.health = Math.max(0, victim.health - dmg)
  shooter.damageDealt += dmg
  events.emit({ type: 'hit', victimId: victim.id, part: headshot ? 'head' : 'body', damage: dmg, attackerId: shooter.id })
  if (victim.health <= 0) {
    victim.alive = false
    victim.deaths += 1
    victim.deathTick = state.tick
    shooter.kills += 1
    if (headshot) shooter.headshotKills += 1
    // 首杀：该玩家本局（tick 内）尚无击杀即为本回合开局击杀——简化用本局首个 kill
    if (shooter.kills === 1) shooter.firstKills += 1
    // #41 成就埋点：击杀距离 / 刀杀 / HE 杀 / 本地玩家武器类别集邮
    if (shooter.id === 0) {
      const d = Math.hypot(shooter.position.x - victim.position.x, shooter.position.z - victim.position.z)
      if (d > state.matchStats.maxKillDist) state.matchStats.maxKillDist = d
      if (def.category === 'knife') state.matchStats.knifeKills += 1
      if (def.category === 'grenade' && def.id === 'he') state.matchStats.heKills += 1
      if (!state.matchStats.killCats.includes(def.category)) state.matchStats.killCats.push(def.category)
    }
    grantKillReward(shooter, def.killReward)
    // C4 持有者死亡 → 掉落
    if (state.round.c4.state === 'carried' && state.round.c4.carrierId === victim.id) {
      state.round.c4.state = 'dropped'
      state.round.c4.carrierId = null
      state.round.c4.position = v3(victim.position.x, victim.position.y, victim.position.z)
    }
    events.emit({ type: 'playerKilled', victimId: victim.id, attackerId: shooter.id, weaponId: def.id, headshot })
  }
}

function hitBoxes(state: GameState, level: PreppedLevel, shooterId: number) {
  const boxes: { id: string; part?: string; min: Vec3; max: Vec3 }[] = []
  level.solids.forEach((b, i) => boxes.push({ id: `brush:${i}`, min: b.min, max: b.max }))
  for (const t of state.targets) {
    if (!t.alive) continue
    for (const box of targetAABBs(t)) {
      boxes.push({ id: `target:${t.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  for (const pl of state.players) {
    if (pl.id === shooterId || !pl.alive) continue
    for (const box of humanAABBs(pl)) {
      boxes.push({ id: `player:${pl.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  return boxes
}

function meleeStrike(state: GameState, p: PlayerEntity, def: WeaponDef, eye: Vec3, events: EventBus): void {
  const forward = viewForward(p.yaw, p.pitch)
  const boxes: { id: string; part?: string; min: Vec3; max: Vec3 }[] = []
  for (const t of state.targets) {
    if (!t.alive) continue
    for (const box of targetAABBs(t)) {
      boxes.push({ id: `target:${t.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  for (const pl of state.players) {
    if (pl.id === p.id || !pl.alive) continue
    for (const box of humanAABBs(pl)) {
      boxes.push({ id: `player:${pl.id}`, part: box.part, min: box.min, max: box.max })
    }
  }
  const hit = raycastBoxes(eye, forward, boxes)
  if (!hit) return
  const meleeRange = def.meleeRange ?? 0
  const meleeDmg = def.meleeDamage ?? def.damage
  if (hit.target.startsWith('target:') && hit.t <= meleeRange) {
    const tid = Number(hit.target.split(':')[1])
    const t = state.targets.find((x) => x.id === tid)
    if (!t) return
    t.health -= meleeDmg
    t.hitFlashTick = state.tick
    events.emit({ type: 'hit', victimId: tid, part: hit.part ?? 'chest', damage: meleeDmg, attackerId: p.id })
    if (t.health <= 0) {
      t.alive = false
      t.respawnAtTick = state.tick + msToTicks(2000)
      events.emit({ type: 'targetKilled', victimId: tid, weaponId: def.id })
    }
  } else if (hit.target.startsWith('player:') && hit.t <= meleeRange) {
    const vid = Number(hit.target.split(':')[1])
    const victim = state.players.find((x) => x.id === vid)
    if (!victim || !victim.alive) return
    applyPlayerHit(state, p, victim, meleeDmg, def, events)
  }
}

/** 散布状态锥角（度）：站定 / 移动 / 空中。
 * #8：有开镜的武器（zoom）——开镜时用 stand 值；未开镜 noscope 加 8° 惩罚。
 * 无 zoom 武器不受 aiming 影响。 */
export function spreadDegrees(p: PlayerEntity, def: WeaponDef, aiming: boolean = false): number {
  if (def.zoom) {
    if (aiming) {
      const hspeed = Math.hypot(p.velocity.x, p.velocity.z)
      if (!p.onGround) return def.spreadDeg.air
      if (hspeed > CONFIG.movingSpeedThreshold) return def.spreadDeg.move
      return def.spreadDeg.stand
    }
    return def.spreadDeg.stand + 8
  }
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
