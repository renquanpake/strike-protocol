import { describe, expect, it } from 'vitest'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { astar, buildNavGrid, type NavGrid } from '../src/game/map/navmesh'

const prepped = prepareLevel(matchLevel())
const nav = buildNavGrid(prepped, 24)
const level = matchLevel()
const plazaLevel = matchLevel('de_plaza')
const plazaNav = buildNavGrid(prepareLevel(plazaLevel), 24)
const costaLevel = matchLevel('de_costa')
const costaNav = buildNavGrid(prepareLevel(costaLevel), 24)

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

describe('de_plaza 路由拓扑', () => {
  it('T → A 高台可达（经台阶上平台）', () => {
    const p = astar(plazaNav, plazaLevel.spawns.T[0], plazaLevel.sites[0].center)
    expect(p).not.toBeNull()
  })

  it('T → B 平地可达', () => {
    const p = astar(plazaNav, plazaLevel.spawns.T[0], plazaLevel.sites[1].center)
    expect(p).not.toBeNull()
  })

  it('CT → A 与 CT → B 均可达', () => {
    expect(astar(plazaNav, plazaLevel.spawns.CT[0], plazaLevel.sites[0].center)).not.toBeNull()
    expect(astar(plazaNav, plazaLevel.spawns.CT[0], plazaLevel.sites[1].center)).not.toBeNull()
  })

  it('中央下沉广场 mid 可达（T 出生能下到广场）', () => {
    const p = astar(plazaNav, plazaLevel.spawns.T[0], { x: 0, z: 0 })
    expect(p).not.toBeNull()
  })
})

describe('de_costa 路由拓扑（G5 新竞技图）', () => {
  it('T → A 高台可达（经西夹道/台阶上平台）', () => {
    const p = astar(costaNav, costaLevel.spawns.T[0], costaLevel.sites[0].center)
    expect(p).not.toBeNull()
  })

  it('T → B 花园台可达（经东夹道/台阶上平台）', () => {
    const p = astar(costaNav, costaLevel.spawns.T[0], costaLevel.sites[1].center)
    expect(p).not.toBeNull()
  })

  it('CT → A 与 CT → B 均可达', () => {
    expect(astar(costaNav, costaLevel.spawns.CT[0], costaLevel.sites[0].center)).not.toBeNull()
    expect(astar(costaNav, costaLevel.spawns.CT[0], costaLevel.sites[1].center)).not.toBeNull()
  })

  it('西廊（顶棚走廊）内部可达', () => {
    const p = astar(costaNav, costaLevel.spawns.T[0], { x: -780, z: 0 })
    expect(p).not.toBeNull()
  })

  it('中央下沉井可达（T 出生能下到井底）', () => {
    const p = astar(costaNav, costaLevel.spawns.T[0], { x: 0, z: 0 })
    expect(p).not.toBeNull()
  })

  it('东坑道坑底可达', () => {
    const p = astar(costaNav, costaLevel.spawns.CT[0], { x: 780, z: 0 })
    expect(p).not.toBeNull()
  })
})
