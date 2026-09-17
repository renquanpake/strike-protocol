import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { prepareLevel } from '../src/game/physics/collision'
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
  spawn: { x: 0, y: 0, z: 0 },
  brushes: [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ],
}
const prepped = prepareLevel(openLevel)

function makeState(): ReturnType<typeof createGameState> {
  const s = createGameState(v3(0, 0, 0), CONFIG.healthMax, 0x1234)
  s.player.onGround = true
  return s
}

describe('weapon system', () => {
  it('半自动手枪边沿触发且受冷却限制', () => {
    const s = makeState()
    const events = new EventBus()
    const glock = s.player.weapons.secondary!
    expect(glock.defId).toBe('glock')

    s.input = { ...emptyInput(), fireQueued: true }
    s.tick = 0
    fireWeapon(s, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 1)

    s.tick = 1
    s.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(s, prepped, events)
    // 冷却未到（150ms ≈ 10 tick），不发射
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 1)

    s.tick = 10
    s.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(s, prepped, events)
    expect(glock.ammoMag).toBe(WEAPONS.glock.magazine - 2)
  })

  it('全自动步枪按住连发，射速间隔正确', () => {
    const s = makeState()
    const events = new EventBus()
    s.player.weapons.primary = newWeaponInstance('m4')
    s.player.activeSlot = 0
    const m4 = s.player.weapons.primary!
    const interval = Math.round((WEAPONS.m4.fireRateMs / 1000) * CONFIG.tickRate)

    s.input = { ...emptyInput(), fireHeld: true }
    let shots = 0
    for (let tick = 0; tick < interval * 12; tick++) {
      s.tick = tick
      s.input = { ...emptyInput(), fireHeld: true }
      fireWeapon(s, prepped, events)
      shots += tick % interval === 0 ? 1 : 0
    }
    // 每 interval 一发：0,6,12... 共 12 发
    expect(m4.ammoMag).toBe(WEAPONS.m4.magazine - 12)
    expect(shots).toBe(12)
  })

  it('换弹完成后弹药回填，换弹期间无法开火', () => {
    const s = makeState()
    const events = new EventBus()
    s.player.weapons.primary = newWeaponInstance('awp')
    s.player.activeSlot = 0
    const awp = s.player.weapons.primary!
    awp.ammoMag = 0

    s.tick = 0
    s.input = { ...emptyInput(), reloadQueued: true }
    updateWeaponSystem(s, events)
    expect(awp.reloadUntilTick).toBeGreaterThan(0)
    const reloadTicks = awp.reloadUntilTick

    s.input = { ...emptyInput(), fireHeld: true }
    fireWeapon(s, prepped, events)
    expect(awp.ammoMag).toBe(0) // 换弹中无法开火

    s.tick = reloadTicks
    s.input = { ...emptyInput(), fireHeld: true }
    updateWeaponSystem(s, events)
    expect(awp.ammoMag).toBe(WEAPONS.awp.magazine)
    expect(awp.ammoReserve).toBe(WEAPONS.awp.reserve - WEAPONS.awp.magazine)
    expect(awp.reloadUntilTick).toBe(0)
  })

  it('切槽 1/2/3 切换激活武器并带切枪硬直', () => {
    const s = makeState()
    const events = new EventBus()
    s.player.weapons.primary = newWeaponInstance('m4')
    expect(activeWeapon(s)?.defId).toBe('glock')

    s.tick = 100
    s.input = { ...emptyInput(), switchSlot: 0 }
    updateWeaponSystem(s, events)
    expect(s.player.activeSlot).toBe(0)
    expect(activeWeapon(s)?.defId).toBe('m4')

    s.input = { ...emptyInput(), switchSlot: 2 }
    updateWeaponSystem(s, events)
    expect(s.player.activeSlot).toBe(2)
    expect(activeWeapon(s)?.defId).toBe('knife')
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
