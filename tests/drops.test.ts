import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel, type PreppedLevel } from '../src/game/physics/collision'
import { newWeaponInstance, WEAPONS } from '../src/game/weapons'
import { updateDrops } from '../src/game/systems/drops'
import { updateRound } from '../src/game/systems/round'

const level: LevelDef = {
  name: 'drops-test',
  spawns: {
    T: [v3(0, 0, 300), v3(40, 0, 300), v3(-40, 0, 300), v3(80, 0, 300), v3(-80, 0, 300)],
    CT: [v3(0, 0, -300), v3(40, 0, -300), v3(-40, 0, -300), v3(80, 0, -300), v3(-80, 0, -300)],
  },
  sites: [],
  brushes: [],
}

const prepped: PreppedLevel = prepareLevel(level)
const events = new EventBus()

function makeLive() {
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x55)
  state.round.phase = 'live'
  state.round.phaseEndTick = state.tick + 10000
  // C4 先掉到远处（避免本地玩家 G 键误走 C4 分支）
  state.round.c4.state = 'dropped'
  state.round.c4.carrierId = null
  state.round.c4.position = v3(-999, 0, -999)
  return state
}

function dropTick(state: ReturnType<typeof makeLive>): void {
  state.tick += 1
  for (const p of state.players) updateDrops(state, p, events)
}

describe('#27 丢弃/拾取装备', () => {
  it('G 丢主武器 → 生成 drop、槽位清空、弹药保留（冷却内不秒捡）', () => {
    const state = makeLive()
    const p = state.players[0]
    p.position = v3(500, 0, 300) // 远离队友 bot，避免其抢先拾取
    p.weapons.primary = newWeaponInstance('m4')
    p.activeSlot = 0
    p.input = { ...emptyInput(), dropQueued: true }
    dropTick(state)
    expect(state.droppedWeapons.length).toBe(1)
    expect(state.droppedWeapons[0].defId).toBe('m4')
    expect(state.droppedWeapons[0].ammoMag).toBe(WEAPONS.m4.magazine)
    expect(p.weapons.primary).toBeNull()
    expect(p.activeSlot).toBe(1)
  })

  it('冷却结束走近 40u 自动拾取；主槽满不捡', () => {
    const state = makeLive()
    const p = state.players[0]
    p.position = v3(500, 0, 300)
    p.yaw = 0 // 朝 -Z，drop 落在身前 12u（40u 拾取半径内）
    // 1) 丢副武器 deagle
    p.weapons.secondary = newWeaponInstance('deagle')
    p.activeSlot = 1
    p.input = { ...emptyInput(), dropQueued: true }
    dropTick(state)
    expect(state.droppedWeapons.length).toBe(1)
    expect(state.droppedWeapons[0].defId).toBe('deagle')
    expect(p.weapons.secondary).toBeNull()
    // 2) 等冷却（60 tick）→ 原地自动拾取
    p.input = emptyInput()
    for (let i = 0; i < 65; i++) dropTick(state)
    expect(state.droppedWeapons.length).toBe(0)
    expect(p.weapons.secondary?.defId).toBe('deagle')
    // 3) 主槽有 m4 时，冷却结束走近 awp 的 drop → 不顶掉
    p.weapons.primary = newWeaponInstance('m4')
    p.weapons.secondary = newWeaponInstance('deagle')
    state.droppedWeapons.push({
      id: state.nextDropId++,
      defId: 'awp',
      position: v3(p.position.x, p.position.y, p.position.z),
      ammoMag: 5,
      ammoReserve: 0,
      pickupReadyTick: state.tick + 60,
    })
    for (let i = 0; i < 65; i++) dropTick(state)
    expect(p.weapons.primary?.defId).toBe('m4') // 主槽满 → awp 不捡
    expect(state.droppedWeapons.length).toBe(1)
  })

  it('C4 携带者 G 丢包，与 #17 拾取互通', () => {
    const state = makeLive()
    const p = state.players[0]
    p.position = v3(0, 0, 300)
    state.round.c4.state = 'carried'
    state.round.c4.carrierId = 0
    p.input = { ...emptyInput(), dropQueued: true }
    dropTick(state)
    expect(state.round.c4.state).toBe('dropped')
    expect(state.round.c4.carrierId).toBeNull()
    // 另一 T（id=1）走近接包，本地玩家走开避免抢先；先等过 60 tick 拾取冷却
    const mate = state.players[1]
    state.players[0].position = v3(999, 0, 0)
    mate.position = v3(state.round.c4.position.x, state.round.c4.position.y, state.round.c4.position.z)
    for (let i = 0; i < 65; i++) dropTick(state)
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(state.round.c4.state).toBe('carried')
    expect(state.round.c4.carrierId).toBe(1)
  })

  it('回合重置（enterFreeze）清空掉落物', () => {
    const state = makeLive()
    const p = state.players[0]
    p.position = v3(500, 0, 300)
    p.weapons.primary = newWeaponInstance('m4')
    p.activeSlot = 0
    p.input = { ...emptyInput(), dropQueued: true }
    dropTick(state)
    expect(state.droppedWeapons.length).toBe(1)
    state.round.phase = 'roundEnd'
    state.round.phaseEndTick = 0
    state.tick = 1
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(state.round.phase).toBe('freeze')
    expect(state.droppedWeapons.length).toBe(0)
  })
})
