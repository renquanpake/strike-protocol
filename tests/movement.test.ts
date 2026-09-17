import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { updateMovement } from '../src/game/systems/movement'

const DT = 1 / CONFIG.tickRate

const SPAWN = { x: 0, y: 40, z: 0 }

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
      // 低墙：z ∈ [-68, -52]，高 32，挡在玩家 -Z 前进方向
      min: { x: -120, y: 0, z: -68 },
      max: { x: 120, y: 32, z: -52 },
      material: 'concrete',
    })
  }
  return { name: withWall ? 'wall' : 'open', spawn: SPAWN, brushes }
}

function runTicks(
  s: GameState,
  level: LevelDef,
  ticks: number,
  input?: Partial<ReturnType<typeof emptyInput>>,
  firstTickOnly = false,
): void {
  for (let i = 0; i < ticks; i++) {
    s.input = { ...emptyInput(), ...input }
    if (firstTickOnly && i > 0) s.input.jumpQueued = false
    updateMovement(s, level, DT)
  }
}

function makeState(level: LevelDef): GameState {
  return createGameState(level.spawn)
}

function settle(s: GameState, level: LevelDef, ticks = 200): void {
  runTicks(s, level, ticks)
}

describe('movement', () => {
  it('从生成点下落后稳定站在地面上', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    expect(s.player.onGround).toBe(true)
    expect(s.player.position.y).toBeCloseTo(0, 3)
    expect(Math.abs(s.player.velocity.y)).toBeLessThan(1)
  })

  it('按住 W 加速到地面极速并沿 -Z 前进', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    runTicks(s, level, 64, { forward: 1 })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(s.player.position.z).toBeLessThan(-100)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed - 10)
    expect(speed).toBeLessThanOrEqual(CONFIG.moveMaxSpeed + 1)
  })

  it('无输入时地面摩擦快速衰减速度', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    runTicks(s, level, 32, { forward: 1 })
    const before = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(before).toBeGreaterThan(100)
    runTicks(s, level, 64)
    const after = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(after).toBeLessThan(20)
  })

  it('跳跃施加 jumpImpulse 并产生跳跃高度', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    runTicks(s, level, 30, { jumpQueued: true }, true)
    expect(s.player.position.y).toBeGreaterThan(30)
    expect(s.player.onGround).toBe(false)
  })

  it('低墙阻挡水平前进', () => {
    const level = makeLevel(true)
    const s = makeState(level)
    settle(s, level)
    s.player.position = v3(0, 0, 20)
    s.player.velocity = v3()
    s.player.onGround = true
    runTicks(s, level, 128, { forward: 1 })
    // 脚停在墙的 +Z 一侧（墙 z∈[-68,-52]，半径 24 → z ≈ -28）
    expect(s.player.position.z).toBeGreaterThan(-52)
    expect(s.player.position.z).toBeLessThan(-20)
  })

  it('蹲下时移速上限降为 duckSpeed', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    runTicks(s, level, 96, { forward: 1, crouch: true })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(speed).toBeGreaterThanOrEqual(CONFIG.duckSpeed - 5)
    expect(speed).toBeLessThanOrEqual(CONFIG.duckSpeed + 5)
  })

  it('坠出地图后回到出生点', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    s.player.position = v3(0, CONFIG.killFallY - 1, 0)
    runTicks(s, level, 1)
    expect(s.player.position.y).toBe(level.spawn.y)
  })

  it('空中 strafe 可累积速度超过地面极速（bhop 基础）', () => {
    const level = makeLevel(false)
    const s = makeState(level)
    settle(s, level)
    runTicks(s, level, 1, { jumpQueued: true, right: 1 }, true)
    runTicks(s, level, 20, { right: 1 })
    const speed = Math.hypot(s.player.velocity.x, s.player.velocity.z)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed)
    expect(speed).toBeLessThanOrEqual(CONFIG.airMaxSpeed + 1)
  })
})
