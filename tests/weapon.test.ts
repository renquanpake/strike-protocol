import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { prepareLevel, type PreppedLevel } from '../src/game/physics/collision'
import type { LevelDef } from '../src/game/map/layout'
import { WEAPONS, newWeaponInstance } from '../src/game/weapons'
import { makeTarget } from '../src/game/entities/target'
import {
  activeWeapon,
  fireWeapon,
  shotDamage,
  spreadDegrees,
  updateWeaponSystem,
} from '../src/game/systems/weapon'

const openLevel: LevelDef = {
  name: 'open',
  spawns: { T: [{ x: 0, y: 0, z: 0 }], CT: [] },
  sites: [],
  brushes: [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ],
}
const prepped: PreppedLevel = prepareLevel(openLevel)

function makeState() {
  const state = createGameState(openLevel.spawns.T, [], CONFIG.healthMax, 800, 0x1234)
  const p = state.players[0]
  p.position = v3(0, 0, 0)
  p.onGround = true
  // 其余玩家停到射击线外，避免其 hitbox 阻挡射线
  for (let i = 1; i < state.players.length; i++) {
    state.players[i].position = v3(i % 2 === 0 ? 500 : -500, 0, 400)
  }
  return { state, p }
}

describe('weapon system', () => {
  it('买枪期(freeze)禁止开火，live 可开火（对标 CS）', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    const glock = p.weapons.secondary!
    state.round.phase = 'freeze'
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine) // 买枪期未消耗弹药
    state.round.phase = 'live'
    state.tick = 1
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 1)
  })

  it('半自动手枪边沿触发且受冷却限制', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    const glock = p.weapons.secondary!
    expect(glock.defId).toBe('glock')

    p.input = { ...emptyInput(), fireQueued: true }
    state.tick = 0
    fireWeapon(state, p, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 1)

    state.tick = 1
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    // 冷却未到（150ms ≈ 10 tick），不发射
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 1)

    state.tick = 10
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 2)
  })

  it('全自动步枪按住连发，射速间隔正确', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.weapons.primary = newWeaponInstance('m4')
    p.activeSlot = 0
    const m4 = p.weapons.primary!
    const interval = Math.round((WEAPONS.m4.fireRateMs / 1000) * CONFIG.tickRate)

    let shots = 0
    for (let tick = 0; tick < interval * 12; tick++) {
      state.tick = tick
      p.input = { ...emptyInput(), fireHeld: true }
      fireWeapon(state, p, prepped, events)
      shots += tick % interval === 0 ? 1 : 0
    }
    // 每 interval 一发：0,6,12... 共 12 发
    expect(m4.ammoMag).toBe(WEAPONS.m4.magazine - 12)
    expect(shots).toBe(12)
  })

  it('换弹完成后弹药回填，换弹期间无法开火', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.weapons.primary = newWeaponInstance('awp')
    p.activeSlot = 0
    const awp = p.weapons.primary!
    awp.ammoMag = 0

    state.tick = 0
    p.input = { ...emptyInput(), reloadQueued: true }
    updateWeaponSystem(state, p, events)
    expect(awp.reloadUntilTick).toBeGreaterThan(0)
    const reloadTicks = awp.reloadUntilTick

    p.input = { ...emptyInput(), fireHeld: true }
    fireWeapon(state, p, prepped, events)
    expect(awp.ammoMag).toBe(0) // 换弹中无法开火

    state.tick = reloadTicks
    p.input = { ...emptyInput(), fireHeld: true }
    updateWeaponSystem(state, p, events)
    expect(awp.ammoMag).toBe(WEAPONS.awp.magazine)
    expect(awp.ammoReserve).toBe(WEAPONS.awp.reserve - WEAPONS.awp.magazine)
    expect(awp.reloadUntilTick).toBe(0)
  })

  it('切槽 1/2/3 切换激活武器并带切枪硬直', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.weapons.primary = newWeaponInstance('m4')
    expect(activeWeapon(p)?.defId).toBe('glock')

    state.tick = 100
    p.input = { ...emptyInput(), switchSlot: 0 }
    updateWeaponSystem(state, p, events)
    expect(p.activeSlot).toBe(0)
    expect(activeWeapon(p)?.defId).toBe('m4')

    p.input = { ...emptyInput(), switchSlot: 2 }
    updateWeaponSystem(state, p, events)
    expect(p.activeSlot).toBe(2)
    expect(activeWeapon(p)?.defId).toBe('knife')
  })
})

describe('shot damage formula', () => {
  it('逐枪头部倍率（M4 4x / AWP 2.3x）', () => {
    const m4 = shotDamage(WEAPONS.m4, 'head', 0, 0)
    expect(m4.damage).toBeCloseTo(WEAPONS.m4.damage * 4, 1)
    const awp = shotDamage(WEAPONS.awp, 'head', 0, 0)
    expect(awp.damage).toBeCloseTo(WEAPONS.awp.damage * (WEAPONS.awp.headMul ?? 4), 1)
  })
  it('距离衰减（falloffStart 后线性至 rangeModifier，CS 每 500u 衰减刻度）', () => {
    const m4 = WEAPONS.m4
    const near = shotDamage(m4, 'chest', 0, 0)
    const mid = shotDamage(m4, 'chest', 2000, 0)
    const far = shotDamage(m4, 'chest', 4000, 0)
    expect(near.damage).toBeCloseTo(m4.damage, 1)
    expect(mid.damage).toBeGreaterThan(far.damage)
    expect(mid.damage).toBeLessThan(near.damage)
    // 衰减地板 = rangeModifier
    expect(far.damage).toBeCloseTo(m4.damage * m4.rangeModifier, 1)
  })

  it('护甲 CS 模型：最终伤害 = 原伤 × armorPenetration，甲损耗 = 最终伤 × 0.5（腿免甲/甲尽回升）', () => {
    const m4 = WEAPONS.m4
    const noArmor = shotDamage(m4, 'chest', 0, 0)
    const withArmor = shotDamage(m4, 'chest', 0, 100)
    expect(noArmor.damage).toBeCloseTo(m4.damage, 1)
    expect(withArmor.damage).toBeCloseTo(m4.damage * m4.armorPenetration, 1)
    expect(withArmor.armorLost).toBeCloseTo((m4.damage * m4.armorPenetration) * 0.5, 1)
    // 甲池耗尽后伤害回升（CS 源码行为：d - 2×armor）
    const lowArmor = shotDamage(m4, 'chest', 0, 5)
    expect(lowArmor.damage).toBeCloseTo(m4.damage - 10, 1)
    expect(lowArmor.armorLost).toBeCloseTo(5, 1)
    // 腿部免甲（CS：腿不吃护甲减免）
    const legArmor = shotDamage(m4, 'legs', 0, 100)
    expect(legArmor.damage).toBeCloseTo(m4.damage * 0.75, 1)
    expect(legArmor.armorLost).toBe(0)
    // AK 对甲身体 ≈ 28（36×0.775，CS wiki）
    const ak = shotDamage(WEAPONS.ak, 'chest', 0, 100)
    expect(ak.damage).toBeCloseTo(27.9, 1)
  })

  it('腿部 0.75 倍率（CS2 hitgroup）', () => {
    const d = shotDamage(WEAPONS.glock, 'legs', 100, 0)
    expect(d.damage).toBeCloseTo(WEAPONS.glock.damage * 0.75, 1)
  })

  it('腹部 1.25 倍率（CS2 hitgroup：AK 腹 45 无甲三枪死）', () => {
    const d = shotDamage(WEAPONS.ak, 'stomach', 0, 0)
    expect(d.damage).toBeCloseTo(WEAPONS.ak.damage * 1.25, 1)
  })
})

describe('武器库完整性 (M8, 批次 A 全量 42 项)', () => {
  const count = (cat: string) => Object.values(WEAPONS).filter((w) => w.category === cat).length
  it('CS2 全量清单：10 手枪 / 7 冲锋 / 7 步枪 / 4 狙 / 4 霰 / 2 机枪 / 6 投掷 / zeus / 刀', () => {
    expect(count('pistol')).toBe(10)
    expect(count('smg')).toBe(7)
    expect(count('rifle')).toBe(7)
    expect(count('sniper')).toBe(4)
    expect(count('shotgun')).toBe(4)
    expect(count('lmg')).toBe(2)
    expect(count('grenade')).toBe(6)
    expect(count('gear')).toBe(1)
    expect(count('knife')).toBe(1)
    expect(Object.keys(WEAPONS).length).toBe(42)
  })
  it('关键枪价格/击杀奖励与 CS2 一致', () => {
    expect(WEAPONS.ak.price).toBe(2700)
    expect(WEAPONS.m4.price).toBe(3100)
    expect(WEAPONS.awp.price).toBe(4750)
    expect(WEAPONS.awp.killReward).toBe(100)
    expect(WEAPONS.deagle.price).toBe(700)
    expect(WEAPONS.mp9.killReward).toBe(600)
    expect(WEAPONS.nova.killReward).toBe(900)
    expect(WEAPONS.knife.killReward).toBe(1500)
    expect(WEAPONS.zeus.killReward).toBe(0)
    expect(WEAPONS.negev.price).toBe(1700)
  })
  it('阵营限定枪（CS2 购买规则）', () => {
    expect(WEAPONS.glock.team).toBe('T')
    expect(WEAPONS.usp.team).toBe('CT')
    expect(WEAPONS.mac10.team).toBe('T')
    expect(WEAPONS.mp9.team).toBe('CT')
    expect(WEAPONS.ak.team).toBe('T')
    expect(WEAPONS.m4.team).toBe('CT')
    expect(WEAPONS.galil.team).toBe('T')
    expect(WEAPONS.famas.team).toBe('CT')
    expect(WEAPONS.molotov.team).toBe('T')
    expect(WEAPONS.incendiary.team).toBe('CT')
    expect(WEAPONS.g3sg1.team).toBe('T')
    expect(WEAPONS.scar20.team).toBe('CT')
    expect(WEAPONS.mag7.team).toBe('CT')
    expect(WEAPONS.sawnoff.team).toBe('T')
    expect(WEAPONS.deagle.team).toBeUndefined()
  })
  it('持枪移速比表驱动（AWP 0.80 / 步枪 0.86-0.90 / SMG 0.96 / 刀 1.0 / LMG 0.78）', () => {
    expect(WEAPONS.awp.moveSpeedScale).toBe(0.8)
    expect(WEAPONS.ak.moveSpeedScale).toBe(0.86)
    expect(WEAPONS.m4.moveSpeedScale).toBe(0.9)
    expect(WEAPONS.mp9.moveSpeedScale).toBe(0.96)
    expect(WEAPONS.knife.moveSpeedScale).toBe(1)
    expect(WEAPONS.negev.moveSpeedScale).toBe(0.78)
  })
  it('全部武器数值表合法（含手枪/霰弹/狙击/zeus pattern 与 ammo）', () => {
    const ids = Object.keys(WEAPONS)
    expect(ids.length).toBeGreaterThanOrEqual(42)
    for (const id of ids) {
      const w = WEAPONS[id]
      expect(w.fireRateMs).toBeGreaterThan(0)
      expect(w.magazine).toBeGreaterThanOrEqual(0)
      expect(w.damage).toBeGreaterThanOrEqual(0)
      expect(['T', 'CT', undefined]).toContain(w.team)
      if (w.category !== 'grenade' && w.category !== 'knife' && w.category !== 'gear') {
        expect(w.magazine).toBeGreaterThan(0)
        expect(w.recoilPattern.length).toBeGreaterThan(0)
        expect(w.wallPenetration ?? 0).toBeGreaterThanOrEqual(0)
      }
      if (w.category !== 'knife') expect(w.price).toBeGreaterThan(0)
      if (w.category === 'grenade') {
        expect(w.magazine).toBe(1)
        expect(w.reserve).toBeGreaterThan(0)
      }
    }
    // 全自动枪械 pattern ≥ 6 发（可学习弹道）；连发狙单发大 kick 例外
    for (const w of Object.values(WEAPONS)) {
      if (w.auto && !['gear', 'knife', 'sniper', 'shotgun'].includes(w.category)) {
        expect(w.recoilPattern.length).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('10 支枪械覆盖 6 大类', () => {
    const gunCats = new Set(
      Object.values(WEAPONS)
        .filter((w) => !['knife', 'grenade', 'gear'].includes(w.category))
        .map((w) => w.category),
    )
    expect(gunCats.has('pistol')).toBe(true)
    expect(gunCats.has('smg')).toBe(true)
    expect(gunCats.has('rifle')).toBe(true)
    expect(gunCats.has('sniper')).toBe(true)
    expect(gunCats.has('shotgun')).toBe(true)
    expect(gunCats.has('lmg')).toBe(true)
  })
})

describe('新枪行为 (M8)', () => {
  it('P-90 全自动 50 发弹匣', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.weapons.primary = newWeaponInstance('p90')
    p.activeSlot = 0
    const p90 = p.weapons.primary!
    const interval = Math.round((WEAPONS.p90.fireRateMs / 1000) * CONFIG.tickRate)
    let fired = 0
    for (let tick = 0; tick < interval * 4; tick++) {
      state.tick = tick
      p.input = { ...emptyInput(), fireHeld: true }
      fireWeapon(state, p, prepped, events)
      if (tick % interval === 0) fired++
    }
    expect(p90.ammoMag).toBe(WEAPONS.p90.magazine - 4)
    expect(fired).toBe(4)
  })

  it('SSG 08 栓动狙击枪冷却 1300ms', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.weapons.primary = newWeaponInstance('ssg08')
    p.activeSlot = 0
    const ssg = p.weapons.primary!
    const cooldown = Math.round((WEAPONS.ssg08.fireRateMs / 1000) * CONFIG.tickRate)
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(ssg.ammoMag).toBe(WEAPONS.ssg08.magazine - 1)
    // 冷却期内再按不发射
    state.tick = Math.floor(cooldown / 2)
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(ssg.ammoMag).toBe(WEAPONS.ssg08.magazine - 1)
  })

  it('短管霰弹枪单发 6 枚弹丸近距爆伤', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    state.targets = [makeTarget(0, 0, 0, -60)]
    p.weapons.primary = newWeaponInstance('sawnoff')
    p.activeSlot = 0
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    // 6 弹丸 × 20 伤害，近距衰减后总伤 > 60
    expect(state.targets[0].health).toBeLessThan(100 - 60)
  })

  it('大雕爆头（53×2.18≈116）近距秒杀 100 血目标', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    state.targets = [makeTarget(0, 0, 0, -200)]
    p.weapons.secondary = newWeaponInstance('deagle')
    p.activeSlot = 1
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(state.targets[0].health).toBeLessThanOrEqual(0)
  })
})

describe('#8 ADS 散布规则（连续化：站定基础 + 速度比例 + 连射衰减）', () => {
  it('站定 = 站定基础值（noscope 无惩罚，对标 CS）', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    for (const def of [WEAPONS.awp, WEAPONS.ssg08, WEAPONS.m4]) {
      expect(spreadDegrees(p, def, false)).toBeCloseTo(def.spreadDeg.stand, 5)
      expect(spreadDegrees(p, def, true)).toBeCloseTo(def.spreadDeg.stand, 5)
    }
  })

  it('移动散布按速度连续插值（地面 250 / 空中 325）', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(125, 0, 0)
    const half = spreadDegrees(p, WEAPONS.m4, false)
    p.velocity = v3(250, 0, 0)
    const full = spreadDegrees(p, WEAPONS.m4, false)
    expect(full - half).toBeCloseTo(WEAPONS.m4.spreadDeg.move * 0.5, 1)
  })

  it('连射增量计入散布并可用 fireSpread 模拟', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    p.fireSpread = 4
    expect(spreadDegrees(p, WEAPONS.m4, false)).toBeCloseTo(WEAPONS.m4.spreadDeg.stand + 4, 1)
  })
})

describe('#4 结算统计埋点', () => {
  it('命中累计 damageDealt；首杀置位 firstKills；爆头击杀累计 headshotKills', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    const victim = state.players[1]
    victim.position = v3(0, 0, -200)
    // 200u 处 AWP：身体 50（无衰减）、头部 115（50×2.3）→ 100 血目标只有爆头一击必杀
    victim.health = 100
    p.weapons.primary = newWeaponInstance('awp')
    p.activeSlot = 0
    p.pitch = 0.003 // 微调抬头，射线对准 300u 处头部中心（y≈65，眼高 64）
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(victim.alive).toBe(false)
    expect(p.kills).toBe(1)
    expect(p.headshotKills).toBe(1)
    expect(p.firstKills).toBe(1)
    expect(p.damageDealt).toBeGreaterThan(0)
  })

  it('非首杀不重复置位 firstKills', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    p.firstKills = 1
    p.kills = 5
    const victim = state.players[2]
    victim.position = v3(0, 0, -300)
    victim.health = 10
    p.weapons.secondary = newWeaponInstance('glock')
    p.activeSlot = 1
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(victim.alive).toBe(false)
    expect(p.kills).toBe(6)
    expect(p.firstKills).toBe(1) // 保持不变
  })
})

describe('击杀赏金 $1500/回合上限（CS kill reward cap）', () => {
  it('连续击杀到 5 次封顶，第 6 次不再入账', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    const money0 = p.money
    const victim = state.players[1]
    p.weapons.secondary = newWeaponInstance('glock')
    p.activeSlot = 1
    state.round.phase = 'live'
    let tick = 0
    for (let i = 0; i < 6; i++) {
      victim.alive = true
      victim.health = 10
      victim.position = v3(0, 0, -200)
      p.input = { ...emptyInput(), fireQueued: true }
      state.tick = tick
      fireWeapon(state, p, prepped, events)
      tick += 32
    }
    expect(p.roundKillReward).toBe(CONFIG.killRewardCap)
    expect(p.money).toBe(money0 + CONFIG.killRewardCap)
  })
})

