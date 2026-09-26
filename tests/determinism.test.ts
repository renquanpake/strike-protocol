import { describe, expect, it } from 'vitest'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'

const DT = 1 / CONFIG.tickRate

/** 全状态哈希：位置/速度/血量/弹药/回合/rng 输出，同种子两次运行必须逐位一致 */
function stateHash(state: GameState): string {
  let h = ''
  for (const p of state.players) {
    h += `${p.position.x.toFixed(4)},${p.position.y.toFixed(4)},${p.position.z.toFixed(4)},`
    h += `${p.velocity.x.toFixed(3)},${p.velocity.z.toFixed(3)},`
    h += `${p.yaw.toFixed(4)},${p.health.toFixed(1)},${p.armor},${p.money},`
    h += `${p.weapons.primary?.defId ?? '-'},${p.weapons.secondary?.defId ?? '-'},`
    h += `${p.weapons.primary?.ammoMag ?? '-'},${p.weapons.secondary?.ammoMag ?? '-'},`
    h += `${p.alive ? 1 : 0};`
  }
  h += `|${state.round.phase},${state.round.roundNumber},${state.round.score.T}:${state.round.score.CT},${state.round.c4.state};`
  h += `|g:${state.grenades.length},sm:${state.smokes.length},br:${state.burns.length};`
  // rng 采样（确定性链的关键：任何分支随机都会体现在这里）
  let s = ''
  for (let i = 0; i < 8; i++) s += state.rng.float().toFixed(6) + '|'
  h += `|rng:${s}`
  return h
}

function sim(seed: number, ticks: number, botCount = 9) {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, {
    rngSeed: seed,
    botCount,
    difficulty: 3,
  })
  const events = new EventBus()
  const ctx = createBotContext(state, level.sites, 3)
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

describe('确定性 10000 tick 全状态哈希（design.md 承诺）', () => {
  it('同种子两次运行 10000 tick 后全状态哈希逐位一致', { timeout: 120000 }, () => {
    const a = sim(0xabc123, 10000)
    const b = sim(0xabc123, 10000)
    expect(stateHash(a)).toBe(stateHash(b))
  })

  it('不同种子 10000 tick 后状态哈希不同', { timeout: 120000 }, () => {
    const a = sim(0xabc123, 10000)
    const c = sim(0xdef456, 10000)
    expect(stateHash(a)).not.toBe(stateHash(c))
  })
})
