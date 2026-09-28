import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots, type BotContext } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'

const DT = 1 / CONFIG.tickRate

function makeWorld(difficulty = 5) {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x99)
  const events = new EventBus()
  const ctx: BotContext = createBotContext(state, level.sites, difficulty, events)
  state.round.phase = 'live'
  state.round.phaseEndTick = Infinity
  return { state, prepped, nav, events, ctx }
}

function sim(state: ReturnType<typeof createGameState>, ctx: BotContext, prepped: ReturnType<typeof prepareLevel>, nav: ReturnType<typeof buildNavGrid>, events: EventBus, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    state.players[0].input = emptyInput()
    updateBots(state, prepped, nav, ctx, events, DT)
    for (const p of state.players) {
      if (!p.alive) continue
      updatePlayerMovement(state, p, prepped, DT)
      updateWeaponSystem(state, p, events)
      fireWeapon(state, p, prepped, events)
    }
    updateGrenades(state, prepped, events, DT)
    updateRound(state, prepped, events, DT)
    state.tick += 1
  }
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

describe('A-R3 目标记忆与 LKP 追击', () => {
  it('R3.1 丢视野后 bot 向最后已知位置移动（距离收敛）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5] // CT
    // 长走廊（bot.test.ts 已验证 LOS 清晰）
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2 // 朝 +X
    bot.health = 5000
    const enemy = state.players[1] // T bot
    enemy.position = v3(1300, 0, -300)
    enemy.yaw = Math.PI / 2
    for (let i = 0; i < 10; i++) {
      if (i === 5 || i === 1) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    // 先让 bot 感知到敌人 1s（加血防止交战期内阵亡）
    enemy.health = 5000
    sim(state, ctx, prepped, nav, events, 64)
    expect(ctx.brains.get(5)!.perceivedId).not.toBe(null)
    // 敌人瞬移到死角（丢视野）
    enemy.position = v3(400, 0, 1500)
    enemy.alive = true
    sim(state, ctx, prepped, nav, events, 10)
    const brain = ctx.brains.get(5)!
    expect(brain.lkp, '丢视野应记录 LKP').not.toBe(null)
    const lkp = brain.lkp!
    const d0 = dist2(bot.position.x, bot.position.z, lkp.x, lkp.z)
    sim(state, ctx, prepped, nav, events, 190) // ~3s（< lkpSec 4s）
    const d1 = dist2(bot.position.x, bot.position.z, lkp.x, lkp.z)
    expect(d1).toBeLessThan(d0) // 向 LKP 收敛
  })

  it('R3.3 追击超过 lkpSec 后放弃 LKP、回归战术目标', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5]
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2
    bot.health = 5000
    const enemy = state.players[1]
    enemy.position = v3(1300, 0, -300)
    enemy.yaw = Math.PI / 2
    enemy.health = 5000
    for (let i = 0; i < 10; i++) {
      if (i === 5 || i === 1) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    sim(state, ctx, prepped, nav, events, 64)
    enemy.position = v3(400, 0, 1500)
    const brain = ctx.brains.get(5)!
    sim(state, ctx, prepped, nav, events, 10)
    expect(brain.lkp).not.toBe(null)
    // 推进超过 lkpSec（4s = 256 ticks）
    sim(state, ctx, prepped, nav, events, 300)
    expect(brain.lkp).toBe(null)
  })

  it('R3.2 追击期周期性 ±45° 扫视（yaw 在 2s 窗口内偏离开道方向）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5]
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2
    bot.health = 5000
    const enemy = state.players[1]
    enemy.position = v3(1300, 0, -300)
    enemy.yaw = Math.PI / 2
    enemy.health = 5000
    for (let i = 0; i < 10; i++) {
      if (i === 5 || i === 1) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    sim(state, ctx, prepped, nav, events, 64)
    enemy.position = v3(400, 0, 1500)
    const brain = ctx.brains.get(5)!
    sim(state, ctx, prepped, nav, events, 10)
    expect(brain.lkp).not.toBe(null)
    // 扫视相位周期 3×32=96 ticks：采样 96 tick 内 yaw 应同时出现两种偏差
    const yaws: number[] = []
    for (let i = 0; i < 96; i++) {
      sim(state, ctx, prepped, nav, events, 1)
      yaws.push(bot.yaw)
    }
    let min = Infinity
    let max = -Infinity
    for (const y of yaws) {
      min = Math.min(min, y)
      max = Math.max(max, y)
    }
    expect(max - min).toBeGreaterThan(0.3) // 扫视使 yaw 周期性偏离开道方向（移动转向会折损幅度）
  })
})
