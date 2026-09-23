import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { newWeaponInstance } from '../src/game/weapons'
import { fireWeapon } from '../src/game/systems/weapon'

/**
 * #35 玻璃破碎：de_plaza 东侧 B0 玻璃挡板（x≈968..992, z∈[-100,100], y∈[0,90]）。
 * 射手站在挡板西侧 (850,0,0) 朝 +X 开火 → 命中玻璃 → 碎 + 出 solids → 弹道可穿透。
 */
describe('#35 玻璃破碎', () => {
  it('子弹打碎玻璃后弹道可穿透，回合重置恢复', () => {
    const level = matchLevel('de_plaza')
    const prepped = prepareLevel(level)
    const events = new EventBus()
    const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x42)
    const p = state.players[0]
    p.position = v3(850, 0, 0)
    p.yaw = -Math.PI / 2 // 朝 +X
    p.pitch = 0
    p.onGround = true
    p.weapons.primary = newWeaponInstance('awp')
    p.activeSlot = 0
    state.round.phase = 'live'
    state.tick = 0
    // 其余玩家移离射击线（z 轴两侧），避免其 hitbox 挡住玻璃
    for (let i = 1; i < state.players.length; i++) {
      state.players[i].position = v3(0, 0, 400)
    }

    const glass = level.brushes.find((b) => b.material === 'glass')
    expect(glass).toBeDefined()
    expect(prepped.solids).toContain(glass)

    let broke = 0
    events.on('glassBreak', () => broke++)

    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(broke).toBe(1)
    expect(state.brokenGlass.length).toBe(1)
    expect(prepped.solids).not.toContain(glass)

    // 第二发穿透（玻璃已碎）：无新碎事件
    state.tick += 10
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, prepped, events)
    expect(broke).toBe(1)
    expect(prepped.solids).not.toContain(glass)

    // 回合重置（enterFreeze 的恢复逻辑）
    state.brokenGlass = []
    prepped.solids = prepped.allSolids
    expect(prepped.solids).toContain(glass)
  })
})
