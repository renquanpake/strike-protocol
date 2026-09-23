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
  it('头部 4 倍率', () => {
    const d = shotDamage(WEAPONS.awp, 'head', 0, 0)
    expect(d).toBeCloseTo(WEAPONS.awp.damage * 4, 1)
  })
  it('距离衰减（falloffStart 后线性至 rangeModifier）', () => {
    const m4 = WEAPONS.m4
    const near = shotDamage(m4, 'chest', 0, 0)
    const mid = shotDamage(m4, 'chest', 550, 0)
    const far = shotDamage(m4, 'chest', 1000, 0)
    expect(near).toBeCloseTo(30, 1)
    expect(mid).toBeCloseTo(30 * 0.925, 1)
    expect(far).toBeCloseTo(30 * 0.85, 1)
  })

  it('护甲减免非头部伤害（按穿透系数）', () => {
    const m4 = WEAPONS.m4
    const noArmor = shotDamage(m4, 'chest', 0, 0)
    const withArmor = shotDamage(m4, 'chest', 0, 100)
    expect(withArmor).toBeCloseTo(noArmor * (1 - 0.5 * (1 - m4.armorPenetration)), 1)
  })

  it('腿部 0.7 倍率', () => {
    const d = shotDamage(WEAPONS.glock, 'legs', 100, 0)
    expect(d).toBeCloseTo(WEAPONS.glock.damage * 0.7, 1)
  })
})

describe('武器库完整性 (M8)', () => {
  it('全部 15 种武器数值表合法', () => {
    const ids = Object.keys(WEAPONS)
    expect(ids.length).toBeGreaterThanOrEqual(15)
    for (const id of ids) {
      const w = WEAPONS[id]
      expect(w.fireRateMs).toBeGreaterThan(0)
      expect(w.magazine).toBeGreaterThanOrEqual(0)
      expect(w.damage).toBeGreaterThanOrEqual(0)
      if (w.category !== 'grenade' && w.category !== 'knife') {
        expect(w.magazine).toBeGreaterThan(0)
      }
      if (w.category !== 'knife') expect(w.price).toBeGreaterThan(0)
      if (w.category !== 'grenade' && w.category !== 'knife') {
        expect(w.recoilPattern.length).toBeGreaterThan(0)
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

  it('大雕爆头 53×4 近距秒杀 100 血目标', () => {
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

describe('#8 ADS 散布规则', () => {
  it('狙击未开镜（noscope）散布 = 站定值 + 8° 惩罚；开镜 = 站定值', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    const awp = WEAPONS.awp
    const stand = awp.spreadDeg.stand
    expect(spreadDegrees(p, awp, false)).toBeCloseTo(stand + 8, 5)
    expect(spreadDegrees(p, awp, true)).toBeCloseTo(stand, 5)
  })

  it('无 zoom 武器不受开镜状态影响', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    const m4 = WEAPONS.m4
    expect(m4.zoom).toBeUndefined()
    expect(spreadDegrees(p, m4, false)).toBe(m4.spreadDeg.stand)
    expect(spreadDegrees(p, m4, true)).toBe(m4.spreadDeg.stand)
  })

  it('noscope 散布严格大于开镜散布', () => {
    const { p } = makeState()
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    for (const def of [WEAPONS.awp, WEAPONS.ssg08]) {
      expect(spreadDegrees(p, def, false)).toBeGreaterThan(spreadDegrees(p, def, true))
    }
  })
})

describe('#4 结算统计埋点', () => {
  it('命中累计 damageDealt；首杀置位 firstKills；爆头击杀累计 headshotKills', () => {
    const { state, p } = makeState()
    const events = new EventBus()
    const victim = state.players[1]
    victim.position = v3(0, 0, -200)
    // 200u 处 AWP：身体约 100 伤（200 血不致死）、头部 4 倍（约 446 必杀）→ 只有爆头击杀才置位 headshotKills
    victim.health = 200
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

