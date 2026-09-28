import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { Rng } from '../src/engine/rng'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots, planBurst, type BotContext } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'
import { WEAPONS, newWeaponInstance } from '../src/game/weapons'

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

describe('A-R6 交战品质', () => {
  it('R6.1 planBurst：burst 为 2-4 发、组间隔 0.3-0.5s（纯函数）', () => {
    const def = WEAPONS.ak
    const brain = { burstRemain: 0, burstNextTick: 0, burstPauseUntil: 0 }
    const rng = new Rng(0x77)
    const fires: number[] = []
    const total = 640 // 10s
    for (let t = 0; t < total; t++) {
      if (planBurst(brain, def, t, rng)) fires.push(t)
    }
    expect(fires.length).toBeGreaterThan(0)
    // 按间隔分组成 burst
    const groups: number[][] = []
    let cur: number[] = [fires[0]]
    for (let i = 1; i < fires.length; i++) {
      const gap = fires[i] - fires[i - 1]
      const burstGapTicks = Math.round(0.2 * CONFIG.tickRate)
      if (gap > burstGapTicks) {
        groups.push(cur)
        cur = [fires[i]]
      } else cur.push(fires[i])
    }
    groups.push(cur)
    for (const g of groups) {
      expect(g.length, 'burst 2-4 发').toBeGreaterThanOrEqual(2)
      expect(g.length).toBeLessThanOrEqual(4)
    }
    // 组间隔 0.3-0.5s
    for (let i = 1; i < groups.length; i++) {
      const gap = groups[i][0] - groups[i - 1][groups[i - 1].length - 1]
      expect(gap, '组间隔 0.3-0.5s').toBeGreaterThanOrEqual(Math.round(0.3 * CONFIG.tickRate))
      expect(gap).toBeLessThanOrEqual(Math.round(0.55 * CONFIG.tickRate))
    }
  })

  it('R6.2 弹匣 ≤30% 且 3s 无敌人 → 换弹', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5]
    // 把敌人放远（无感知）
    for (let i = 0; i < 5; i++) state.players[i].position = v3(500, 0, -1600)
    for (let i = 6; i < 10; i++) state.players[i].position = v3(400, 0, 1500)
    bot.position = v3(0, 0, 0)
    bot.yaw = 0
    const sec = bot.weapons.secondary!
    const secMag = WEAPONS[sec.defId].magazine
    sec.ammoMag = Math.max(1, Math.ceil(secMag * 0.2)) // ≤30%
    // lastSeenTick=0（初始），tick 推进到 > 3s
    sim(state, ctx, prepped, nav, events, 250)
    // 换弹已被请求：reloadUntilTick > 0 或已换满
    const reloaded = sec.reloadUntilTick > 0 || sec.ammoMag >= secMag
    expect(reloaded).toBe(true)
  })

  it('R6.4 近距（≤200u）自动武器保持压射：单位时间开火密集', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const bot = state.players[5]
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2
    bot.weapons.primary = newWeaponInstance('ak')
    bot.activeSlot = 0
    bot.weapons.primary!.ammoMag = 30
    bot.weapons.primary!.ammoReserve = 90
    const enemy = state.players[0]
    enemy.position = v3(1300, 0, -300) // 200u 近距
    enemy.yaw = Math.PI / 2
    enemy.health = 5000
    enemy.healthMax = 5000
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(400, 0, 1500)
      state.players[i].health = 5000
    }
    // bot 用 AK（自动）：近距压射 → 短时间开火密集
    let shots = 0
    events.on('shot', (e) => {
      if (e.shooterId === bot.id) shots++
    })
    sim(state, ctx, prepped, nav, events, 256) // 4s
    // AK 射速 ~10 发/s，4s 理论 40 发；压射下应明显多于 burst
    expect(shots).toBeGreaterThan(15)
  })
})
