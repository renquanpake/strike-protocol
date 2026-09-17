import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots, type BotContext } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateRound } from '../src/game/systems/round'

const DT = 1 / CONFIG.tickRate

function makeWorld() {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x99)
  const events = new EventBus()
  const ctx: BotContext = createBotContext(state, level.sites)
  // 直接进入第 1 回合 live（跳过 warmup/freeze）
  state.round.phase = 'live'
  state.round.phaseEndTick = state.tick + Math.round(115 * CONFIG.tickRate)
  state.round.roundNumber = 1
  return { state, prepped, nav, events, ctx, level }
}

function sim(state: GameState, ctx: BotContext, prepped: ReturnType<typeof prepareLevel>, nav: ReturnType<typeof buildNavGrid>, events: EventBus, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    state.players[0].input = emptyInput()
    updateBots(state, prepped, nav, ctx, events, DT)
    for (const p of state.players) {
      if (!p.alive) continue
      updatePlayerMovement(state, p, prepped, DT)
      updateWeaponSystem(state, p, events)
      fireWeapon(state, p, prepped, events)
    }
    updateRound(state, prepped, events, DT)
    state.tick += 1
  }
}

describe('bot AI (M5)', () => {
  it('freeze 期 Bot 按经济购买主武器', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.round.phase = 'freeze'
    state.round.roundNumber = 1
    state.tick = 0
    const bot = state.players[1] // T-1，800 钱
    bot.money = 4000
    updateBots(state, prepped, nav, ctx, events, DT)
    expect(bot.weapons.primary?.defId).toBe('m4')
    expect(bot.activeSlot).toBe(0)
  })

  it('T Bot 沿导航推进到 A 点（距离收敛）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    ctx.processedRound = 1 // 跳过自动分配，手动指派
    const bot = state.players[1]
    const siteA = ctx.sites[0]
    // CT bots 停驻死角（后墙背后 606u 外，超出感知 480）
    for (let i = 5; i < 10; i++) {
      state.players[i].position = v3(330, 0, -585)
      state.players[i].yaw = Math.PI
    }
    ctx.brains.get(bot.id)!.objective = v3(siteA.center.x, siteA.elevation, siteA.center.z)
    const startDist = Math.hypot(bot.position.x - siteA.center.x, bot.position.z - siteA.center.z)
    sim(state, ctx, prepped, nav, events, 1200) // ~19s
    const endDist = Math.hypot(bot.position.x - siteA.center.x, bot.position.z - siteA.center.z)
    expect(endDist).toBeLessThan(startDist * 0.5)
  })

  it('Bot 发现敌人后反应延迟内开火并造成伤害', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    const bot = state.players[1]
    const enemy = state.players[5]
    // 其余 Bot 停驻死角，只留 bot 与 enemy 对峙（开阔广场，LOS 清晰）
    for (let i = 0; i < 10; i++) {
      if (i === 1 || i === 5) continue
      state.players[i].position = v3(330, 0, -585)
    }
    // 面对面 200u（x 轴）
    bot.position = v3(-100, 0, -400)
    bot.yaw = -Math.PI / 2 // 朝 +X
    enemy.position = v3(100, 0, -400)
    enemy.yaw = Math.PI / 2 // 朝 -X
    bot.money = 4000
    bot.weapons.primary = null
    bot.activeSlot = 1 // glock 20 发
    state.round.phase = 'live'
    state.round.phaseEndTick = state.tick + 7360
    let shots = 0
    events.on('shot', (e) => {
      if (e.shooterId === bot.id) shots++
    })
    const enemyHpBefore = enemy.health
    sim(state, ctx, prepped, nav, events, 400) // ~6s
    expect(shots).toBeGreaterThan(0)
    expect(enemy.health).toBeLessThan(enemyHpBefore)
  })

  it('无干预完整对局：Bot 互战直至 matchEnd（本地挂机）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    let guard = 0
    const cap = 160000
    while (state.round.phase !== 'matchEnd' && guard < cap) {
      sim(state, ctx, prepped, nav, events, 256)
      guard += 256
    }
    expect(state.round.phase).toBe('matchEnd')
    const s = state.round.score
    expect(Math.max(s.T, s.CT)).toBe(CONFIG.winRounds)
    expect(guard).toBeLessThan(cap)
  })
})
