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

/** CT bot 直接放守点架枪状态（跳过推进，直接到 objective 后） */
function setupHold() {
  const { state, prepped, nav, events, ctx } = makeWorld(5)
  const bot = state.players[5] // CT
  const site = ctx.sites[5 % ctx.sites.length] // 与 R5.4 换位逻辑同一 site
  // bot 已在守点 objective 处（到达态：path=null）
  {
    const b = ctx.brains.get(5)!
    b.objective = v3(site.center.x, site.elevation, site.center.z)
    b.path = null
    b.holdSinceTick = 0
  }
  bot.position = v3(site.center.x, site.elevation, site.center.z)
  bot.yaw = Math.PI
  // 敌方全放远处死角，保证无感知
  for (let i = 0; i < 5; i++) {
    state.players[i].position = v3(500, 0, -1600)
    state.players[i].health = 5000
  }
  for (let i = 6; i < 10; i++) {
    state.players[i].position = v3(site.center.x + 80, site.elevation, site.center.z + 80)
    state.players[i].health = 5000
  }
  return { state, prepped, nav, events, ctx, bot, site }
}

describe('A-R5 防守架点', () => {
  it('R5.4 守点 40s 无接触 → 换位（holdSwapped=true，objective 改变）', () => {
    const { state, prepped, nav, events, ctx, bot, site } = setupHold()
    const brain = ctx.brains.get(5)!
    // 快进 40s（2560 ticks）+ 余量
    sim(state, ctx, prepped, nav, events, 2624)
    sim(state, ctx, prepped, nav, events, 2624)
    expect(brain.holdSwapped).toBe(true)
    // 换位后新目标仍在爆点区内（≤200u），bot 也仍在爆点区附近
    expect(Math.hypot(site.center.x - brain.objective.x, site.center.z - brain.objective.z)).toBeLessThan(200)
    expect(Math.hypot(site.center.x - bot.position.x, site.center.z - bot.position.z)).toBeLessThan(300)
    void bot
  })

  it('R5.2 守点时 800u 内枪声 → 向声源方向支援（objective 朝声源偏移）', () => {
    const { state, prepped, nav, events, ctx } = setupHold()
    const brain = ctx.brains.get(5)!
    const bx = state.players[5].position.x
    const bz = state.players[5].position.z
    const startX = brain.objective.x
    // 声源在 bot 东侧 400u
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'ak' })
    ;(ctx.heard[0] as { x: number; z: number }).x = bx + 400
    ;(ctx.heard[0] as { z: number }).z = bz
    sim(state, ctx, prepped, nav, events, 20)
    expect(brain.supportingShot).toBe(true)
    // objective 相对原位向 +X 偏移
    expect(brain.objective.x).toBeGreaterThan(startX)
    void prepped
    void nav
    void events
  })

  it('R5.2 低难度（radioHear=false）：不触发听声报点 radio', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5]
    const site = ctx.sites[0]
    const b = ctx.brains.get(5)!
    b.objective = v3(site.center.x, site.elevation, site.center.z)
    b.path = null
    bot.position = v3(site.center.x, site.elevation, site.center.z)
    for (let i = 0; i < 5; i++) state.players[i].position = v3(500, 0, -1600)
    for (let i = 6; i < 10; i++) {
      state.players[i].position = v3(site.center.x + 80, site.elevation, site.center.z + 80)
      state.players[i].health = 5000
    }
    // 难度 5 radioHear=false：枪声不产生 radio（5 档）
    expect(ctx.profile.radioHear).toBe(false)
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'ak' })
    ;(ctx.heard[0] as { x: number; z: number }).x = bot.position.x + 400
    ;(ctx.heard[0] as { z: number }).z = bot.position.z
    let radioCount = 0
    events.on('radio', (m) => {
      if (m.key === 'heardSound') radioCount++
    })
    sim(state, ctx, prepped, nav, events, 20)
    expect(radioCount).toBe(0)
  })
})
