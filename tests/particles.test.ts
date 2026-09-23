import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { spawnShell, updateShells, type Shell } from '../src/game/particles'
import { TracerRing, tracerWanted } from '../src/game/tracer'

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

describe('tracer pool (#13)', () => {
  it('环形槽位超量后复用最旧槽', () => {
    const ring = new TracerRing(4)
    const seq: number[] = []
    for (let i = 0; i < 10; i++) seq.push(ring.next())
    expect(seq).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1])
  })

  it('自动武器每 3 发一条、狙击/单发每发一条', () => {
    const auto = { auto: true }
    const sniper = { zoom: { fovs: [40, 14], sensScale: 0.3 } }
    const semi = { auto: false }
    expect(tracerWanted(1, auto)).toBe(true)
    expect(tracerWanted(2, auto)).toBe(false)
    expect(tracerWanted(3, auto)).toBe(false)
    expect(tracerWanted(4, auto)).toBe(true)
    expect(tracerWanted(1, sniper)).toBe(true)
    expect(tracerWanted(2, sniper)).toBe(true)
    expect(tracerWanted(1, semi)).toBe(true)
    expect(tracerWanted(2, semi)).toBe(true)
  })
})
