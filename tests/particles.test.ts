import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { spawnShell, updateShells, type Shell } from '../src/game/particles'

function makeShells(n: number): Shell[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    position: v3(0, -9999, 0),
    velocity: v3(),
    until: 0,
    active: false,
  }))
}

describe('particles (M7)', () => {
  it('弹壳生成并受重力下落、地面反弹', () => {
    const shells = makeShells(4)
    const muzzle = v3(0, 64, 0)
    expect(spawnShell(shells, 1, muzzle, v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 200)).toBe(true)
    const s = shells[0]
    expect(s.active).toBe(true)
    // 模拟 1s：应落到地面附近并反弹
    for (let i = 0; i < 60; i++) updateShells(shells, 0, 1 / 60)
    expect(s.position.y).toBeGreaterThanOrEqual(0)
    expect(s.position.y).toBeLessThan(20) // 已从高处落下
  })

  it('弹壳寿命结束自动失活', () => {
    const shells = makeShells(2)
    spawnShell(shells, 1, v3(0, 5, 0), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 5)
    for (let i = 0; i < 6; i++) updateShells(shells, 0, 1 / 60)
    expect(shells[0].active).toBe(false)
  })

  it('弹壳池满时拒绝新弹壳', () => {
    const shells = makeShells(2)
    shells[0].active = true
    shells[1].active = true
    expect(spawnShell(shells, 9, v3(), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 100)).toBe(false)
  })
})
