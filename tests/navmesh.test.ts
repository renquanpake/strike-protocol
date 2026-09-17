import { describe, expect, it } from 'vitest'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { astar, buildNavGrid, hasPath, nearestWalkable } from '../src/game/map/navmesh'

const prepped = prepareLevel(matchLevel())
const nav = buildNavGrid(prepped, 24)

describe('navmesh (M4)', () => {
  it('网格尺寸与可走性合理', () => {
    expect(nav.w).toBeGreaterThan(0)
    expect(nav.h).toBeGreaterThan(0)
    const walkableCount = nav.walkable.reduce((a, v) => a + v, 0)
    expect(walkableCount).toBeGreaterThan(nav.w * nav.h * 0.3)
  })

  it('T 出生区可走到 A 点（经阶梯上平台）', () => {
    const t = matchLevel().spawns.T[0]
    const a = matchLevel().sites[0].center
    expect(hasPath(nav, t, a)).toBe(true)
  })

  it('T 出生区可走到 B 点', () => {
    const t = matchLevel().spawns.T[0]
    const b = matchLevel().sites[1].center
    expect(hasPath(nav, t, b)).toBe(true)
  })

  it('CT 出生区可走到 A 点与 B 点', () => {
    const ct = matchLevel().spawns.CT[0]
    const a = matchLevel().sites[0].center
    const b = matchLevel().sites[1].center
    expect(hasPath(nav, ct, a)).toBe(true)
    expect(hasPath(nav, ct, b)).toBe(true)
  })

  it('A 点与 B 点互通', () => {
    const a = matchLevel().sites[0].center
    const b = matchLevel().sites[1].center
    expect(hasPath(nav, a, b)).toBe(true)
  })

  it('astar 返回的路径点均为可走格', () => {
    const t = matchLevel().spawns.T[0]
    const b = matchLevel().sites[1].center
    const path = astar(nav, t, b)
    expect(path).not.toBeNull()
    for (const pt of path!) {
      const c = nearestWalkable(nav, pt.x, pt.z)
      expect(c).not.toBeNull()
    }
  })
})
