import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { prepareLevel } from '../src/game/physics/collision'
import { updatePlayerMovement, setAimSensScale } from '../src/game/systems/movement'
import { newWeaponInstance } from '../src/game/weapons'
import { DEFAULT_SETTINGS, loadSettings } from '../src/ui/settings'
import { matchLevel } from '../src/game/map/match'

import { matchLevel } from '../src/game/map/match'

const DT = 1 / CONFIG.tickRate

function mkPrepped() {
  const level = matchLevel()
  return { level, prep: prepareLevel(level) }
}

describe('B-R2 灵敏度体系', () => {
  it('R2.1 默认值：touchSens=1 / aimSens=0.5 / aimSensSplit=false', () => {
    expect(DEFAULT_SETTINGS.touchSens).toBe(1)
    expect(DEFAULT_SETTINGS.aimSens).toBe(0.5)
    expect(DEFAULT_SETTINGS.aimSensSplit).toBe(false)
  })

  it('R2.5 越界收敛到最近合法边界', () => {
    // stub localStorage
    const store = new Map<string, string>()
    const fake = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    }
    ;(globalThis as { localStorage?: unknown }).localStorage = fake
    store.set(
      'sp_settings',
      JSON.stringify({ mouseSens: 99, touchSens: -5, aimSens: 8, fov: 20 }),
    )
    const s = loadSettings()
    expect(s.mouseSens).toBe(3) // clamp 上界
    expect(s.touchSens).toBe(0.2) // clamp 下界
    expect(s.aimSens).toBe(1.5) // 开镜上界
    expect(s.fov).toBe(70) // fov 下界
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('R2.4 开镜灵敏度分离：开启时开镜状态转速按 aimSens 缩放', () => {
    const { level, prep } = mkPrepped()
    const run = (split: boolean, aimSens: number): number => {
      const s2 = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x99)
      const pl = s2.players[0]
      pl.position = v3(0, 0, 0)
      // 给一把有 zoom 的狙击枪并进入开镜
      pl.weapons.primary = newWeaponInstance('awp')
      pl.activeSlot = 0
      const inp = emptyInput()
      inp.aimHeld = true
      inp.mouseDX = 500
      pl.input = inp
      setAimSensScale(aimSens, split)
      updatePlayerMovement(s2, pl, prep, DT)
      return Math.abs(pl.yaw)
    }
    const withSplit = run(true, 0.5)
    const noSplit = run(false, 0.5)
    // 分离开启：开镜灵敏度减半 → yaw 变化更小
    expect(withSplit).toBeLessThan(noSplit)
  })
})
