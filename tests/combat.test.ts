import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel } from '../src/game/physics/collision'
import { makeTarget } from '../src/game/entities/target'
import { fireWeapon } from '../src/game/systems/weapon'

function makeLevel(withWall: boolean): LevelDef {
  const brushes: LevelDef['brushes'] = [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ]
  if (withWall) {
    brushes.push({
      min: { x: -200, y: 0, z: -120 },
      max: { x: 200, y: 200, z: -100 },
      material: 'concrete',
    })
  }
  return {
    name: withWall ? 'blocked' : 'open',
    spawns: {
      // T 全部放在 +Z（射手身后），CT 分散在 -Z 远端且偏离 x=0 射击线
      T: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 30 },
        { x: 0, y: 0, z: 60 },
        { x: 0, y: 0, z: 90 },
        { x: 0, y: 0, z: 120 },
      ],
      CT: [
        { x: 0, y: 0, z: -400 },
        { x: 30, y: 0, z: -400 },
        { x: -30, y: 0, z: -400 },
        { x: 60, y: 0, z: -400 },
        { x: -60, y: 0, z: -400 },
      ],
    },
    sites: [],
    brushes,
  }
}

function makeCombatState(withWall: boolean, targets: ReturnType<typeof makeTarget>[]) {
  const level = makeLevel(withWall)
  const state: GameState = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, 800, 0xabcd)
  const p = state.players[0]
  p.position = v3(0, 0, 0)
  p.onGround = true
  state.targets = targets
  return { state, p, prepped: prepareLevel(level) }
}

describe('combat e2e', () => {
  it('正面命中靶子头部（近距爆头）', () => {
    const t = makeTarget(0, 0, 0, -200)
    const { state, p, prepped } = makeCombatState(false, [t])
    const events = new EventBus()
    p.input = { ...emptyInput(), fireQueued: true }
    state.tick = 0
    fireWeapon(state, p, prepped, events)
    // 眼高 64 → 命中 200u 处靶子的头部（y 58..72）
    expect(t.health).toBeLessThan(5)
    expect(t.alive).toBe(true)
    expect(t.hitFlashTick).toBe(0)
  })

  it('墙体阻断子弹，靶子不掉血', () => {
    const t = makeTarget(0, 0, 0, -300)
    const { state, p, prepped } = makeCombatState(true, [t])
    const events = new EventBus()
    p.input = { ...emptyInput(), fireQueued: true }
    state.tick = 0
    fireWeapon(state, p, prepped, events)
    expect(t.health).toBe(t.maxHealth)
  })

  it('小刀近身 48u 内可击伤', () => {
    const t = makeTarget(0, 0, 0, -40)
    const { state, p, prepped } = makeCombatState(false, [t])
    p.activeSlot = 2
    const events = new EventBus()
    p.input = { ...emptyInput(), fireQueued: true }
    state.tick = 0
    fireWeapon(state, p, prepped, events)
    expect(t.health).toBeCloseTo(100 - 55, 1)
  })

  it('空仓不发射', () => {
    const t = makeTarget(0, 0, 0, -200)
    const { state, p, prepped } = makeCombatState(false, [t])
    p.weapons.secondary!.ammoMag = 0
    const events = new EventBus()
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(t.health).toBe(t.maxHealth)
  })

  it('击杀敌方玩家：死亡计数 + 击杀奖励 + C4 掉落', () => {
    const { state, p, prepped } = makeCombatState(false, [])
    const victim = state.players[5] // CT-1
    victim.position = v3(0, 0, -300)
    victim.health = 10
    const moneyBefore = p.money
    p.weapons.secondary!.ammoMag = 5
    p.activeSlot = 1
    const events = new EventBus()
    let killed = 0
    events.on('playerKilled', () => killed++)
    p.input = { ...emptyInput(), fireQueued: true }
    state.tick = 0
    fireWeapon(state, p, prepped, events)
    // glock 26 伤害 ≥ 10 血 → 击杀
    expect(victim.alive).toBe(false)
    expect(p.kills).toBe(1)
    expect(victim.deaths).toBe(1)
    expect(killed).toBe(1)
    expect(p.money).toBe(moneyBefore + WEAPON_KILL_REWARD)
    // C4 由本地玩家持有 → 受害者非携带者，C4 状态不变
    expect(state.round.c4.state).toBe('carried')
  })
})

const WEAPON_KILL_REWARD = 300
