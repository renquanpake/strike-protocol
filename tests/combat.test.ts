import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel } from '../src/game/physics/collision'
import { makeTarget } from '../src/game/entities/target'
import { fireWeapon } from '../src/game/systems/weapon'

const openLevel: LevelDef = {
  name: 'combat',
  spawn: { x: 0, y: 0, z: 0 },
  brushes: [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ],
}

const blockedLevel: LevelDef = {
  ...openLevel,
  name: 'blocked',
  brushes: [
    ...openLevel.brushes,
    // 中间一面高墙
    {
      min: { x: -200, y: 0, z: -120 },
      max: { x: 200, y: 200, z: -100 },
      material: 'concrete',
    },
  ],
}

function makeCombatState(targets: ReturnType<typeof makeTarget>[]) {
  const s = createGameState(v3(0, 0, 0), CONFIG.healthMax, 0xabcd)
  s.player.onGround = true
  s.targets = targets
  return s
}

describe('combat e2e', () => {
  it('正面命中的伤害等于公式值（近距爆头）', () => {
    const t = makeTarget(0, 0, 0, -200)
    const s = makeCombatState([t])
    const events = new EventBus()
    s.input = { ...emptyInput(), fireQueued: true }
    s.tick = 0
    fireWeapon(s, prepareLevel(openLevel), events)
    // 眼高 64 → 命中 200u 处靶子的头部（y 58..72）
    expect(t.health).toBeLessThan(5)
    expect(t.alive).toBe(true)
    expect(t.hitFlashTick).toBe(0)
  })

  it('墙体阻断子弹，靶子不掉血', () => {
    const t = makeTarget(0, 0, 0, -300)
    const s = makeCombatState([t])
    const events = new EventBus()
    s.input = { ...emptyInput(), fireQueued: true }
    s.tick = 0
    fireWeapon(s, prepareLevel(blockedLevel), events)
    expect(t.health).toBe(t.maxHealth)
  })

  it('小刀近身 48u 内可击伤', () => {
    const t = makeTarget(0, 0, 0, -40)
    const s = makeCombatState([t])
    s.player.activeSlot = 2
    const events = new EventBus()
    s.input = { ...emptyInput(), fireQueued: true }
    s.tick = 0
    fireWeapon(s, prepareLevel(openLevel), events)
    // 精确断言：刀伤 55
    expect(t.health).toBeCloseTo(100 - 55, 1)
  })

  it('空仓不发射', () => {
    const t = makeTarget(0, 0, 0, -200)
    const s = makeCombatState([t])
    s.player.weapons.secondary!.ammoMag = 0
    const events = new EventBus()
    s.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(s, prepareLevel(openLevel), events)
    expect(t.health).toBe(t.maxHealth)
  })
})
