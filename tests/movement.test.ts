import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel } from '../src/game/physics/collision'
import { updatePlayerMovement } from '../src/game/systems/movement'

const DT = 1 / CONFIG.tickRate

function makeLevel(kind: 'open' | 'wall' | 'ladder' | 'step18' | 'step32'): LevelDef {
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
      min: { x: 296, y: 0, z: -304 },
      max: { x: 304, y: 160, z: -296 },
      material: 'ladder',
      ladder: true,
    })
  }
  if (kind === 'step18' || kind === 'step32') {
    // 抬升区：z ≤ 60 的地面抬高 H（玩家站在抬升区内，验证能否步行爬上顶面）
    const h = kind === 'step18' ? 18 : 32
    brushes.push({
      min: { x: -512, y: 0, z: -512 },
      max: { x: 512, y: h, z: 60 },
      material: 'concrete',
    })
  }
  return {
    name: kind,
    spawns: { T: [{ x: 0, y: 40, z: 0 }], CT: [] },
    sites: [],
    brushes,
  }
}

function makeState(kind: 'open' | 'wall' | 'ladder' | 'step18' | 'step32') {
  const level = makeLevel(kind)
  const prepped = prepareLevel(level)
  const state = createGameState(level.spawns.T, [], CONFIG.healthMax, 800, 0x11)
  const p = state.players[0]
  p.position = v3(0, 40, 0)
  return { state, prepped, p }
}

function runTicks(
  ctx: ReturnType<typeof makeState>,
  ticks: number,
  input?: Partial<ReturnType<typeof emptyInput>>,
  firstTickOnly = false,
): void {
  for (let i = 0; i < ticks; i++) {
    ctx.p.input = { ...emptyInput(), ...input }
    if (firstTickOnly && i > 0) ctx.p.input.jumpQueued = false
    ctx.state.tick = i
    updatePlayerMovement(ctx.state, ctx.p, ctx.prepped, DT)
  }
}

function settle(ctx: ReturnType<typeof makeState>, ticks = 200): void {
  runTicks(ctx, ticks)
}

describe('movement (M0 baseline)', () => {
  it('从生成点下落后稳定站在地面上', () => {
    const ctx = makeState('open')
    settle(ctx)
    expect(ctx.p.onGround).toBe(true)
    expect(ctx.p.position.y).toBeCloseTo(0, 3)
    expect(Math.abs(ctx.p.velocity.y)).toBeLessThan(1)
  })

  it('按住 W 加速到地面极速并沿 -Z 前进', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 64, { forward: 1 })
    const speed = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(ctx.p.position.z).toBeLessThan(-100)
    // 极速 = moveMaxSpeed × 持枪移速比（默认手枪 0.96 → 240）
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed - 20)
    expect(speed).toBeLessThanOrEqual(CONFIG.moveMaxSpeed + 1)
  })

  it('无输入时地面摩擦快速衰减速度', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 32, { forward: 1 })
    const before = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(before).toBeGreaterThan(100)
    runTicks(ctx, 64)
    const after = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(after).toBeLessThan(20)
  })

  it('低墙阻挡水平前进', () => {
    const ctx = makeState('wall')
    settle(ctx)
    ctx.p.position = v3(0, 0, 20)
    ctx.p.velocity = v3()
    ctx.p.onGround = true
    runTicks(ctx, 128, { forward: 1 })
    expect(ctx.p.position.z).toBeGreaterThan(-52)
    expect(ctx.p.position.z).toBeLessThan(-20)
  })

  it('18u 台阶可步行爬上（CS step-up），32u 超出台阶高度被阻挡', () => {
    const up = makeState('step18')
    settle(up)
    up.p.position = v3(0, 0, 20)
    up.p.velocity = v3()
    up.p.onGround = true
    runTicks(up, 96, { forward: 1 })
    expect(up.p.position.y).toBeCloseTo(18, 0) // 已站上抬升区顶面
    expect(up.p.position.z).toBeLessThan(-140) // 顺利穿过去

    const block = makeState('step32')
    settle(block)
    block.p.position = v3(0, 0, 20)
    block.p.velocity = v3()
    block.p.onGround = true
    runTicks(block, 96, { forward: 1 })
    expect(block.p.position.y).toBeCloseTo(0, 0) // 没爬上去
    expect(block.p.position.z).toBeGreaterThan(-140) // 被挡在抬升区前缘
  })

  it('蹲下时移速上限降为 duckSpeed', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 96, { forward: 1, crouch: true })
    const speed = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(speed).toBeGreaterThanOrEqual(CONFIG.duckSpeed - 5)
    expect(speed).toBeLessThanOrEqual(CONFIG.duckSpeed + 5)
  })

  it('坠出地图后回到本队出生点', () => {
    const ctx = makeState('open')
    settle(ctx)
    ctx.p.position = v3(0, CONFIG.killFallY - 1, 0)
    runTicks(ctx, 1)
    expect(ctx.p.position.y).toBe(40)
  })

  it('空中 strafe 可累积速度超过地面极速（bhop 基础）', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 1, { jumpQueued: true, right: 1 }, true)
    runTicks(ctx, 20, { right: 1 })
    const speed = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed)
    expect(speed).toBeLessThanOrEqual(CONFIG.airMaxSpeed + 1)
  })
})

describe('movement (M1)', () => {
  it('边沿跳跃施加 jumpImpulse 并产生跳跃高度', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 30, { jumpQueued: true }, true)
    expect(ctx.p.position.y).toBeGreaterThan(30)
    expect(ctx.p.onGround).toBe(false)
  })

  it('按住跳跃键实现自动连跳（bhop）', () => {
    const ctx = makeState('open')
    settle(ctx)
    runTicks(ctx, 240, { jumpHeld: true, right: 1 })
    const speed = Math.hypot(ctx.p.velocity.x, ctx.p.velocity.z)
    expect(speed).toBeGreaterThan(CONFIG.moveMaxSpeed)
  })

  it('蹲跳比站立跳获得更高初速（crouchJumpBonus）', () => {
    const a = makeState('open')
    settle(a)
    runTicks(a, 1, { jumpQueued: true }, true)
    const standVy = a.p.velocity.y + CONFIG.gravity * DT

    const b = makeState('open')
    settle(b)
    runTicks(b, 1, { jumpQueued: true, crouch: true }, true)
    const crouchVy = b.p.velocity.y + CONFIG.gravity * DT

    expect(crouchVy).toBeCloseTo(standVy + CONFIG.crouchJumpBonus, 1)
  })

  it('高坠触发坠落伤害并扣血', () => {
    const ctx = makeState('open')
    settle(ctx)
    const healthBefore = ctx.p.health
    ctx.p.position = v3(0, 400, 0)
    ctx.p.velocity = v3()
    runTicks(ctx, 128)
    expect(ctx.p.onGround).toBe(true)
    expect(ctx.p.health).toBeLessThan(healthBefore)
  })

  it('低坠（冲击低于阈值）不产生坠落伤害', () => {
    const ctx = makeState('open')
    settle(ctx)
    ctx.p.position = v3(0, 60, 0)
    ctx.p.velocity = v3()
    runTicks(ctx, 128)
    expect(ctx.p.health).toBe(CONFIG.healthMax)
  })

  it('梯子可攀爬上升', () => {
    const ctx = makeState('ladder')
    settle(ctx)
    ctx.p.position = v3(300, 0, -300)
    ctx.p.velocity = v3()
    ctx.p.onGround = true
    runTicks(ctx, 64, { forward: 1 })
    expect(ctx.p.position.y).toBeGreaterThan(80)
    expect(ctx.p.onLadder).toBe(true)
  })
})
