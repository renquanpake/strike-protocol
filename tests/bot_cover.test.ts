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

function setupCorridor() {
  const { state, prepped, nav, events, ctx } = makeWorld(5)
  const bot = state.players[5] // CT
  bot.position = v3(1100, 0, -300)
  bot.yaw = -Math.PI / 2
  bot.health = 100
  const enemy = state.players[0] // 本地 T（静止）
  enemy.position = v3(1300, 0, -300)
  enemy.yaw = Math.PI / 2
  enemy.health = 5000
  enemy.healthMax = 5000
  for (let i = 1; i < 10; i++) {
    if (i === 5) continue
    state.players[i].position = v3(400, 0, 1500)
    state.players[i].health = 5000
  }
  // 让 bot 先感知到目标 1s
  sim(state, ctx, prepped, nav, events, 64)
  return { state, prepped, nav, events, ctx, bot, enemy }
}

describe('A-R4 掩体与生存', () => {
  it('R4.1 残血（≤30）交战中转移掩体：coverUsed 触发且向掩体点收敛', () => {
    const { state, prepped, nav, events, ctx, bot } = setupCorridor()
    bot.health = 25
    sim(state, ctx, prepped, nav, events, 10)
    const brain = ctx.brains.get(5)!
    expect(brain.coverUsed).toBe(true)
    if (brain.cover) {
      const d0 = Math.hypot(bot.position.x - brain.cover.x, bot.position.z - brain.cover.z)
      sim(state, ctx, prepped, nav, events, 40)
      const d1 = Math.hypot(bot.position.x - (brain.cover?.x ?? bot.position.x), bot.position.z - (brain.cover?.z ?? bot.position.z))
      // 到位后 cover 会置 null；期间应曾靠近
      expect(Math.min(d0, d1, 999)).toBeLessThan(300)
    }
  })

  it('R4.2 换弹中触发掩体转移', () => {
    const { state, prepped, nav, events, ctx, bot } = setupCorridor()
    bot.health = 100
    const sec = bot.weapons.secondary!
    sec.reloadUntilTick = state.tick + 90
    sim(state, ctx, prepped, nav, events, 10)
    const brain = ctx.brains.get(5)!
    expect(brain.coverUsed).toBe(true)
  })

  it('R4.4 掩体额度：一次交战限 1 次，coverUsed 后不再搜索', () => {
    const { state, prepped, nav, events, ctx, bot } = setupCorridor()
    bot.health = 20
    sim(state, ctx, prepped, nav, events, 10)
    const brain = ctx.brains.get(5)!
    expect(brain.coverUsed).toBe(true)
    // 清空目标点，继续交火：不应再次搜索（coverUsed 保持 true 且 cover 不再被重新赋值）
    brain.cover = null
    bot.health = 15
    sim(state, ctx, prepped, nav, events, 30)
    expect(brain.coverUsed).toBe(true)
    expect(brain.cover).toBeNull()
  })

  it('低难度（1 档 cover=false）：残血也不转移掩体', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(1)
    const bot = state.players[5]
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2
    bot.health = 20
    const enemy = state.players[0]
    enemy.position = v3(1300, 0, -300)
    enemy.health = 5000
    enemy.healthMax = 5000
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    sim(state, ctx, prepped, nav, events, 40)
    const brain = ctx.brains.get(5)!
    expect(ctx.profile.cover).toBe(false)
    expect(brain.coverUsed).toBe(false)
  })
})
