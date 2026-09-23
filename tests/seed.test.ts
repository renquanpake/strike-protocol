import { describe, expect, it } from 'vitest'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'

const DT = 1 / CONFIG.tickRate

/** 同种子跑 N tick，返回所有玩家位置 + rng 状态 */
function sim(seed: number, ticks: number) {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, {
    rngSeed: seed,
    botCount: 9,
    difficulty: 5,
  })
  const events = new EventBus()
  const ctx = createBotContext(state, level.sites, 5)
  // 自然回合流（warmup→freeze→live）：freeze 期战术抽签/经济走 state.rng，同种子可复现
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
  return state
}

describe('#44 对局种子与可复现', () => {
  it('state.seed 回写传入种子', () => {
    const s = sim(0x1234, 10)
    expect(s.seed).toBe(0x1234)
  })

  it('同种子两次运行 1000 tick 后全员位置一致', () => {
    const a = sim(0x1234, 1000)
    const b = sim(0x1234, 1000)
    expect(a.players.length).toBe(b.players.length)
    for (let i = 0; i < a.players.length; i++) {
      expect(a.players[i].position.x).toBeCloseTo(b.players[i].position.x, 3)
      expect(a.players[i].position.z).toBeCloseTo(b.players[i].position.z, 3)
      expect(a.players[i].yaw).toBeCloseTo(b.players[i].yaw, 3)
    }
  })

  it('不同种子产生不同走位（至少一名 bot 位置不同）', () => {
    const a = sim(0x1111, 1000)
    const c = sim(0x2222, 1000)
    let differ = false
    for (let i = 1; i < a.players.length; i++) {
      if (
        Math.abs(a.players[i].position.x - c.players[i].position.x) > 1 ||
        Math.abs(a.players[i].position.z - c.players[i].position.z) > 1
      ) {
        differ = true
        break
      }
    }
    expect(differ).toBe(true)
  })
})
