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
  return { state, prepped, nav, events, ctx, level }
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

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

describe('A-R2 Bot 听觉感知', () => {
  it('枪声在视锥外 400u：bot 转向声源方向', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const ct = state.players[5] // CT bot
    ct.position = v3(-200, 0, 1500)
    ct.yaw = Math.PI // 朝 +Z（forward=(-sinπ,-cosπ)=(0,1)）
    const shooter = state.players[0]
    shooter.position = v3(-200, 0, 1100) // 400u 正北方（CT 背后，视锥外）
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(600, 0, -1400) // 其他 bot 远离死角
    }
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'glock' })
    sim(state, ctx, prepped, nav, events, 90) // ~1.4s
    // 期望转向：desired = atan2(-dx, -dz)，dx=0, dz=-400 → 0（朝 -Z）
    expect(Math.abs(angleDiff(ct.yaw, 0))).toBeLessThan(0.2)
  })

  it('5s 防抖：转向后 5s 内重复枪声不重复转向', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(5)
    const ct = state.players[5]
    ct.position = v3(-200, 0, 1500)
    ct.yaw = Math.PI
    const shooter = state.players[0]
    shooter.position = v3(-200, 0, 1100) // 背后 400u
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(600, 0, -1400)
    }
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'glock' })
    sim(state, ctx, prepped, nav, events, 90) // 第一次转向
    const brain = ctx.brains.get(5)!
    expect(brain.lastSoundTurnTick).not.toBe(-99999)
    const t0 = brain.lastSoundTurnTick
    // 仍在 5s（320 tick）防抖窗内再开一枪：不应重新获取声源
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'glock' })
    sim(state, ctx, prepped, nav, events, 10)
    expect(brain.lastSoundTurnTick).toBe(t0)
  })

  it('难度 1 档无听觉：枪声不引起转向', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(1)
    const ct = state.players[5]
    ct.position = v3(-200, 0, 1500)
    ct.yaw = Math.PI
    const shooter = state.players[0]
    shooter.position = v3(-200, 0, 1900)
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(600, 0, -1400)
    }
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'glock' })
    sim(state, ctx, prepped, nav, events, 90)
    const brain = ctx.brains.get(5)!
    expect(brain.lastSoundTurnTick).toBe(-99999) // 未触发
    expect(ctx.profile.hear).toBe(false)
  })

  it('难度 6 档听声报点：<400u 枪声触发 radio heardSound', () => {
    const { state, prepped, nav, events, ctx } = makeWorld(6)
    const ct = state.players[5]
    ct.position = v3(-200, 0, 1500)
    ct.yaw = Math.PI
    const shooter = state.players[0]
    shooter.position = v3(-200, 0, 1300) // 背后 200u < 400
    for (let i = 1; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(600, 0, -1400)
    }
    let heardRadio = false
    events.on('radio', (m) => {
      if (m.key === 'heardSound') heardRadio = true
    })
    events.emit({ type: 'shot', shooterId: 0, weaponId: 'ak' })
    sim(state, ctx, prepped, nav, events, 90)
    expect(heardRadio).toBe(true)
  })
})
