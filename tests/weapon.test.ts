import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { prepareLevel, type PreppedLevel } from '../src/game/physics/collision'
import type { LevelDef } from '../src/game/map/layout'
import { WEAPONS, newWeaponInstance } from '../src/game/weapons'
import {
  activeWeapon,
  fireWeapon,
  shotDamage,
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
  return { state, p }
}

describe('weapon system', () => {
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
