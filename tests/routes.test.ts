import { describe, expect, it } from 'vitest'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { astar, buildNavGrid, type NavGrid } from '../src/game/map/navmesh'

const prepped = prepareLevel(matchLevel())
const nav = buildNavGrid(prepped, 24)
const level = matchLevel()

/** 路径是否经过上 B 洞（x∈[-1500,-1150] 洞段） */
function viaUpperTunnel(nav: NavGrid, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const p = astar(nav, from, to)
  return p?.some((w) => w.x < -1100 && w.x > -1550 && w.z > -1050 && w.z < 900) ?? false
}

/** 路径是否经过下 B 洞（x < -1500 的堑壕） */
function viaLowerTrench(nav: NavGrid, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const p = astar(nav, from, to)
  return p?.some((w) => w.x < -1550 && w.x > -1950) ?? false
}

/** 路径是否经过 A 可达通道（long 北端阶梯 或 catwalk 高架平台） */
function viaARoute(nav: NavGrid, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const p = astar(nav, from, to)
  if (!p) return false
  const longRamp = p.some((w) => w.x > 1000 && w.x < 1500 && w.z > 780 && w.z < 950)
  const catwalk = p.some((w) => w.x > 240 && w.x < 1000 && w.z > 500 && w.z < 1060)
  return longRamp || catwalk
}

describe('de_sahara 路由拓扑', () => {
  it('T → B 走上 B 洞', () => {
    expect(viaUpperTunnel(nav, level.spawns.T[0], level.sites[1].center)).toBe(true)
  })

  it('CT → B 守备路线经过下 B 洞', () => {
    expect(viaLowerTrench(nav, level.spawns.CT[0], level.sites[1].center)).toBe(true)
  })

  it('T → A 经 long 阶梯或 catwalk 上平台', () => {
    expect(viaARoute(nav, level.spawns.T[0], level.sites[0].center)).toBe(true)
  })

  it('CT → A 比 T → A 近（CT 出生更靠 A）', () => {
    const pa = astar(nav, level.spawns.T[0], level.sites[0].center)!
    const pc = astar(nav, level.spawns.CT[0], level.sites[0].center)!
    expect(pa.length).toBeGreaterThan(pc.length)
  })

  it('T 长道入口：T 出生到 long 南端开阔地可达', () => {
    const p = astar(nav, level.spawns.T[0], { x: 1250, z: -1375 })
    expect(p).not.toBeNull()
  })
})
