import { CONFIG } from '../config'
import { WEAPONS, type WeaponDef, type WeaponInstance } from '../weapons'
import type { GameState, PlayerEntity } from '../state'
import type { EventBus } from '../../engine/eventbus'
import { v3, type Vec3 } from '../../engine/math'
import { targetAABBs } from '../entities/target'
import { humanAABBs } from '../entities/bot'
import { raycastBoxes, raycastBoxesWithPenetration } from '../physics/raycast'
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

/** 单发伤害结算（纯函数）：
 * 部位倍率（头部取逐枪 headMul，默认 4；腹 0.85 / 四肢 0.5，见 CONFIG）× 距离衰减 × 护甲。
 * 护甲模型（对标 CS）：甲池 0-100 点；非头部命中吸收 50%（受甲池约束）；
 * 头部命中仅当戴盔时吸收 50%（头盔不消耗甲池，但受甲池余量约束）。
 * 返回最终伤害与本次甲池损耗。 */
export function shotDamage(
  def: WeaponDef,
  part: HitboxPart,
  dist: number,
  armor: number,
  helmet: boolean = false,
): { damage: number; armorLost: number } {
  const partMul =
    part === 'head'
      ? def.headMul ?? CONFIG.hitboxMultipliers.head
      : CONFIG.hitboxMultipliers[part]
  let d = def.damage * partMul
  if (dist > def.falloffStart && def.falloffEnd > def.falloffStart) {
    const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart)
    const factor = 1 - t * (1 - def.rangeModifier)
    d *= Math.max(def.rangeModifier, factor)
  }
  let armorLost = 0
  const armored = part !== 'head' ? armor > 0 : helmet && armor > 0
  if (armored) {
    armorLost = Math.min(d * 0.5, armor)
    d -= armorLost
  }
  return { damage: d, armorLost }
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
      if (w.reloadUntilTick > 0) {
        // CS：换弹中再按 R 取消换弹
        w.reloadUntilTick = 0
        events.emit({ type: 'reloadFinished', weaponId: def.id })
      } else if (def.magazine > 0 && w.ammoMag < def.magazine && w.ammoReserve > 0) {
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
      target.recoilIndex = 0
      target.nextFireTick = state.tick + msToTicks(150) // 切枪硬直
    }
  }

  const w = activeWeapon(p)
  if (w && !inp.fireHeld) w.burstCount = 0
  // 后坐力停火回卷（G2）：停火每 400ms 回卷一步（恢复插值，避免跳变），满 3s 完全回卷（对标 CS 预压后坐）。
  // 以"进入停火时的索引快照"为基准做幂等计算，避免逐 tick 重复扣减。
  if (w && w.lastShotTick > 0 && w.recoilIndex > 0) {
    if (inp.fireHeld || inp.fireQueued) {
      // 重新开火：清除停火快照，本次开火从当前序列位置继续
      w.recoilStopIndex = 0
    } else {
      if (w.recoilStopIndex === 0) w.recoilStopIndex = w.recoilIndex // 首次进入停火，记录基准
      const stopTicks = state.tick - w.lastShotTick
      if (stopTicks >= msToTicks(CONFIG.recoilResetMs)) {
        w.recoilIndex = 0
      } else {
        const steps = Math.floor(stopTicks / msToTicks(CONFIG.recoilRecoverMs))
        w.recoilIndex = Math.max(0, w.recoilStopIndex - steps)
      }
    }
  }
}

/** 开火（hitscan，每 tick 至多一发） */
export function fireWeapon(
  state: GameState,
  shooter: PlayerEntity,
  level: PreppedLevel,
  events: EventBus,
  dt: number = 1 / CONFIG.tickRate,
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

  // 连射散布的时间衰减（停火回准，对标 CS inaccuracy decay）
  p.fireSpread = Math.max(0, p.fireSpread - CONFIG.spreadDecayPerSec * dt)

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
  if (w.ammoMag <= 0 && !state.training) {
    // CS：空仓开火自动触发换弹（有备弹时）
    if (w.ammoReserve > 0 && w.reloadUntilTick === 0) {
      w.reloadUntilTick = state.tick + msToTicks(def.reloadMs)
      events.emit({ type: 'reloadStarted', weaponId: def.id })
    }
    return
  }
  if (!state.training) w.ammoMag -= 1
  w.burstCount += 1
  w.nextFireTick = state.tick + msToTicks(def.fireRateMs)
  w.lastShotTick = state.tick
  p.fireSpread += def.spreadDeg.burstGrow

  // 后坐力：固定序列推进
  if (def.recoilPattern.length > 0) {
    const [pk, yk] = def.recoilPattern[w.recoilIndex % def.recoilPattern.length]
    w.recoilIndex = (w.recoilIndex + 1) % def.recoilPattern.length
    p.pitch += pk
    p.yaw += yk
  }

  // 弹道
  const forward = viewForward(p.yaw, p.pitch)
  const coneDeg = spreadDegrees(p, def, p.input.aimHeld)
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
  let wallHit: { point: Vec3; normal: Vec3; penetrated: boolean } | null = null
  let anyPenetrated = false
  // G1 穿墙（wallbang）：按武器 wallPenetration 决定可穿层数（≥0.9 穿 maxLayers，其余 1 层），材质衰减见 CONFIG.wallbang
  const wp = def.wallPenetration ?? 0
  const penMaxLayers = wp > 0 ? (wp >= 0.9 ? CONFIG.wallbang.maxLayers : 1) : 0
  const brushMaterialOf = (target: string): string | undefined =>
    level.solids[Number(target.slice(6))]?.material
  const isPenetrable = (target: string): boolean => {
    if (!target.startsWith('brush:')) return false
    const mat = brushMaterialOf(target)
    return mat !== undefined && (CONFIG.wallbang.materials as Record<string, number>)[mat] !== undefined
  }
  const attenuationOf = (target: string): number => {
    const mat = brushMaterialOf(target)
    return mat ? ((CONFIG.wallbang.materials as Record<string, number>)[mat] ?? 1) : 1
  }

  for (let i = 0; i < def.pellets; i++) {
    const [ox, oy, oz] = state.rng.coneDirection(coneRad)
    const dir: Vec3 = normalize(
      v3(
        forward.x * oz + right.x * ox + up.x * oy,
        forward.y * oz + right.y * ox + up.y * oy,
        forward.z * oz + right.z * ox + up.z * oy,
      ),
    )
    let hit
    let dmgScale = 1
    let entry: { point: Vec3; normal: Vec3 } | null = null
    if (penMaxLayers > 0) {
      const res = raycastBoxesWithPenetration(eye, dir, boxes, isPenetrable, attenuationOf, penMaxLayers)
      hit = res.hit
      dmgScale = res.damageScale
      if (res.penetrated) {
        anyPenetrated = true
        if (res.entry) entry = { point: res.entry.point, normal: res.entry.normal }
      }
    } else {
      hit = raycastBoxes(eye, dir, boxes)
    }
    if (!hit) continue
    // G1 穿墙命中后距离取眼位→最终命中的总距（衰减正确性）
    const dist =
      dmgScale < 1 ? Math.hypot(hit.point.x - eye.x, hit.point.y - eye.y, hit.point.z - eye.z) : hit.t

    if (hit.target.startsWith('target:')) {
      const tid = Number(hit.target.split(':')[1])
      const t = state.targets.find((x) => x.id === tid)
      if (!t || !t.alive || !hit.part) continue
      const part = hit.part as HitboxPart
      const { damage: dmg } = shotDamage(def, part, dist, 0)
      t.health -= dmg * dmgScale
      t.hitFlashTick = state.tick
      events.emit({ type: 'hit', victimId: tid, part, damage: dmg * dmgScale, attackerId: p.id })
      // G1 穿墙命中靶子：入口点投射烟尘 decal（仅本地玩家）
      if (entry && p.id === 0 && !wallHit) {
        wallHit = { point: entry.point, normal: entry.normal, penetrated: true }
      }
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
      const { damage: dmg, armorLost } = shotDamage(def, part, dist, victim.armor, victim.helmet)
      applyPlayerHit(state, p, victim, dmg * dmgScale, def, events, part === 'head', armorLost)
      // G1 穿墙命中实体：入口点投射烟尘 decal（仅本地玩家）
      if (entry && p.id === 0 && !wallHit) {
        wallHit = { point: entry.point, normal: entry.normal, penetrated: true }
      }
    } else if (hit.target.startsWith('brush:')) {
      // #35 玻璃：命中玻璃 brush → 一次性碎裂（物理通行 + 渲染隐藏 + 音效/碎片）
      const bi = Number(hit.target.split(':').slice(1).join(':'))
      const b = level.solids[bi]
      if (b && b.material === 'glass' && !state.brokenGlass.includes(b)) {
        state.brokenGlass.push(b)
        level.solids = level.allSolids.filter((x) => x !== b)
        events.emit({ type: 'glassBreak', x: hit.point.x, y: hit.point.y, z: hit.point.z })
      }
      // G1 穿墙命中：decals 投在首个穿透点（入口），concrete 厚墙投在最终命中点
      const at = entry ?? { point: hit.point, normal: hit.normal }
      if (p.id === 0 && !wallHit) {
        wallHit = { point: at.point, normal: at.normal, penetrated: entry !== null }
      }
    } else if (p.id === 0 && !wallHit) {
      // 命中地图墙体（仅本地玩家，供印花投射）
      const at = entry ?? { point: hit.point, normal: hit.normal }
      wallHit = { point: at.point, normal: at.normal, penetrated: entry !== null }
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
      penetrated: wallHit.penetrated,
    })
  }
  events.emit({ type: 'shot', shooterId: p.id, weaponId: def.id, muffled: anyPenetrated, penetrated: anyPenetrated })
}

function applyPlayerHit(
  state: GameState,
  shooter: PlayerEntity,
  victim: PlayerEntity,
  dmg: number,
  def: WeaponDef,
  events: EventBus,
  headshot: boolean = false,
  armorLost: number = 0,
): void {
  victim.health = Math.max(0, victim.health - dmg)
  if (armorLost > 0) victim.armor = Math.max(0, victim.armor - armorLost)
  // G3 受击减速（tagging）：按伤害比例临时降移速（0.4-0.6s 衰减恢复），护甲降低时长与幅度（CS 标准）
  if (dmg > 0 && victim.alive) {
    const tg = CONFIG.tagging
    const hadArmor = victim.armor > 0 || armorLost > 0
    const armorMul = hadArmor ? 1 - tg.armorReduction : 1
    const ms = (tg.minMs + (tg.maxMs - tg.minMs) * Math.min(1, dmg / 50)) * armorMul
    victim.tagFromTick = state.tick
    victim.tagUntilTick = state.tick + Math.max(1, msToTicks(ms))
    // 强度按最终（护甲后）伤害计：护甲减伤已体现在 dmg 上
    victim.tagStrength = Math.min(tg.maxStrength, dmg * tg.strengthPerDmg)
  }
  shooter.damageDealt += dmg
  events.emit({ type: 'hit', victimId: victim.id, part: headshot ? 'head' : 'body', damage: dmg, attackerId: shooter.id })
  if (victim.health <= 0) {
    victim.alive = false
    victim.deaths += 1
    victim.deathTick = state.tick
    shooter.kills += 1
    shooter.roundKills += 1
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
    // 击杀赏金：单回合 $1500 上限（CS：kill reward cap）
    const remaining = CONFIG.killRewardCap - shooter.roundKillReward
    if (remaining > 0) {
      const amount = Math.min(def.killReward, remaining)
      shooter.roundKillReward += amount
      grantKillReward(shooter, amount)
    }
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

/** 散布状态锥角（度）：站定基础 + 速度连续插值（地面/空中按速度比例 0→满）+ 连射增量（时间衰减）。
 * 有开镜武器：开镜时按站定基础计；未开镜不再加惩罚（对标 CS，鼓励开镜靠倍率而非散布惩罚）。
 * `_aiming` 保留参数以稳定调用方签名。 */
export function spreadDegrees(p: PlayerEntity, def: WeaponDef, _aiming: boolean = false): number {
  const hspeed = Math.hypot(p.velocity.x, p.velocity.z)
  const ratio = p.onGround ? Math.min(1, hspeed / CONFIG.moveMaxSpeed) : Math.min(1, hspeed / CONFIG.airMaxSpeed)
  const extra = p.onGround ? def.spreadDeg.move : def.spreadDeg.air
  const moving = def.spreadDeg.stand + extra * ratio + p.fireSpread
  if (!p.crouching) return moving
  // G4 蹲射精度：蹲下基础散布取 crouch（默认 stand 的 65%），蹲下移动插值减半，并与站立/移动值取最小（蹲射更准）
  const crouchBase = def.spreadDeg.crouch ?? def.spreadDeg.stand * 0.65
  const crouched = crouchBase + extra * ratio * 0.5 + p.fireSpread
  return Math.min(crouched, moving)
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
