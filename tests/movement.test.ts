import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel, type PreppedLevel } from '../src/game/physics/collision'
import { updateMovement } from '../src/game/systems/movement'

const DT = 1 / CONFIG.tickRate

const SPAWN = { x: 0, y: 40, z: 0 }

function makeLevel(kind: 'open' | 'wall' | 'ladder'): LevelDef {
  const brushes: LevelDef['brushes'] = [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ]
  if (kind === 'wall') {
    brushes.push({
      min: { x: -120, y: 0, z: -68 },
      max: { x: 120, y: 32, z: -52 },
      material: 'concrete',
    })
  }
  if (kind === 'ladder') {
    brushes.push({
      // 梯子：x∈[296,304], z∈[-304,-296], y 0..160
      min: { x: 296, y: 0, z: -304 },
      max: { x: 304, y: 160, z: -296 },
      material: 'ladder',
      ladder: true,
    })
  }
  return { name: kind, spawn: SPAWN, brushes }
}

function runTicks(
  s: GameState,
  prepped: PreppedLevel,
  ticks: number,
  input?: Partial<ReturnType<typeof emptyInput>>,
  firstTickOnly = false,
): void {
  for (let i = 0; i < ticks; i++) {
    s.input = { ...emptyInput(), ...input }
    if (firstTickOnly && i > 0) s.input.jumpQueued = false
    updateMovement(s, prepped, DT)
  }
}

function makeState(prepped: PreppedLevel): GameState {
  return createGameState(prepped.spawn, CONFIG.healthMax)
}

function settle(s: GameState, prepped: PreppedLevel, ticks = 200): void {
  runTicks(s, prepped, ticks)
}

describe('movement (M0 baseline)', () => {
  it('从生成点下落后稳定站在地面上', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    expect(s.player.onGround).toBe(true)
    expect(s.player.position.y).toBeCloseTo(0, 3)
    expect(Math.abs(s.player.velocity.y)).toBeLessThan(1)
  })

  it('按住 W 加速到地面极速并沿 -Z 前进', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    runTicks(s, prepped, 64, { forward: 1 })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(s.player.position.z).toBeLessThan(-100)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed - 10)
    expect(speed).toBeLessThanOrEqual(CONFIG.moveMaxSpeed + 1)
  })

  it('无输入时地面摩擦快速衰减速度', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    runTicks(s, prepped, 32, { forward: 1 })
    const before = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(before).toBeGreaterThan(100)
    runTicks(s, prepped, 64)
    const after = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(after).toBeLessThan(20)
  })

  it('低墙阻挡水平前进', () => {
    const prepped = prepareLevel(makeLevel('wall'))
    const s = makeState(prepped)
    settle(s, prepped)
    s.player.position = v3(0, 0, 20)
    s.player.velocity = v3()
    s.player.onGround = true
    runTicks(s, prepped, 128, { forward: 1 })
    expect(s.player.position.z).toBeGreaterThan(-52)
    expect(s.player.position.z).toBeLessThan(-20)
  })

  it('蹲下时移速上限降为 duckSpeed', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    runTicks(s, prepped, 96, { forward: 1, crouch: true })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(speed).toBeGreaterThanOrEqual(CONFIG.duckSpeed - 5)
    expect(speed).toBeLessThanOrEqual(CONFIG.duckSpeed + 5)
  })

  it('坠出地图后回到出生点', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    s.player.position = v3(0, CONFIG.killFallY - 1, 0)
    runTicks(s, prepped, 1)
    expect(s.player.position.y).toBe(prepped.spawn.y)
  })

  it('空中 strafe 可累积速度超过地面极速（bhop 基础）', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    runTicks(s, prepped, 1, { jumpQueued: true, right: 1 }, true)
    runTicks(s, prepped, 20, { right: 1 })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed)
    expect(speed).toBeLessThanOrEqual(CONFIG.airMaxSpeed + 1)
  })
})

describe('movement (M1)', () => {
  it('边沿跳跃施加 jumpImpulse 并产生跳跃高度', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    runTicks(s, prepped, 30, { jumpQueued: true }, true)
    expect(s.player.position.y).toBeGreaterThan(30)
    expect(s.player.onGround).toBe(false)
  })

  it('按住跳跃键实现自动连跳（bhop）', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    // 持续按住跳跃键 + 侧移，应多次离地（速度在空气态累积超过地面极速）
    runTicks(s, prepped, 240, { jumpHeld: true, right: 1 })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed)
  })

  it('蹲跳比站立跳获得更高初速（crouchJumpBonus）', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const stand = makeState(prepped)
    settle(stand, prepped)
    runTicks(stand, prepped, 1, { jumpQueued: true }, true)
    const standVy = stand.player.velocity.y + CONFIG.gravity * DT

    const crouch = makeState(prepped)
    settle(crouch, prepped)
    runTicks(crouch, prepped, 1, { jumpQueued: true, crouch: true }, true)
    const crouchVy = crouch.player.velocity.y + CONFIG.gravity * DT

    expect(crouchVy).toBeCloseTo(standVy + CONFIG.crouchJumpBonus, 1)
  })

  it('高坠触发坠落伤害并扣血', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    const healthBefore = s.player.health
    // 从高处自由落体到地面
    s.player.position = v3(0, 400, 0)
    s.player.velocity = v3()
    runTicks(s, prepped, 128)
    expect(s.player.onGround).toBe(true)
    expect(s.player.health).toBeLessThan(healthBefore)
  })

  it('低坠（冲击低于阈值）不产生坠落伤害', () => {
    const prepped = prepareLevel(makeLevel('open'))
    const s = makeState(prepped)
    settle(s, prepped)
    s.player.position = v3(0, 60, 0)
    s.player.velocity = v3()
    runTicks(s, prepped, 128)
    expect(s.player.health).toBe(CONFIG.healthMax)
  })

  it('梯子可攀爬上升', () => {
    const prepped = prepareLevel(makeLevel('ladder'))
    const s = makeState(prepped)
    // 站到梯子根部（XZ 已重叠），按住前进即向上攀爬
    s.player.position = v3(300, 0, -300)
    s.player.velocity = v3()
    s.player.onGround = true
    runTicks(s, prepped, 64, { forward: 1 })
    expect(s.player.position.y).toBeGreaterThan(80)
    expect(s.player.onLadder).toBe(true)
  })
})
