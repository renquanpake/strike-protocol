import type { Vec3 } from '../../engine/math'
import type { PreppedLevel } from '../physics/collision'

export interface NavGrid {
  /** 网格原点（世界坐标，覆盖区域 min） */
  ox: number
  oz: number
  /** 网格尺寸（cell 数） */
  w: number
  h: number
  /** 栅格边长 u */
  cell: number
  /** 可走性 0/1 */
  walkable: Uint8Array
  /** 地面高度（该格顶面高度，-1 表示无） */
  height: Float32Array
}

/** 高度场：每格取 XZ 覆盖该格中心的实心 brush 的最高顶面 */
export function buildNavGrid(level: PreppedLevel, cell = 24): NavGrid {
  const minX = -600
  const maxX = 600
  const minZ = -600
  const maxZ = 600
  const w = Math.floor((maxX - minX) / cell)
  const h = Math.floor((maxZ - minZ) / cell)
  const walkable = new Uint8Array(w * h)
  const height = new Float32Array(w * h).fill(-1)

  for (let iz = 0; iz < h; iz++) {
    for (let ix = 0; ix < w; ix++) {
      const cx = minX + ix * cell + cell / 2
      const cz = minZ + iz * cell + cell / 2
      let top = -9999
      let hasFloor = false
      for (const b of level.solids) {
        if (cx < b.min.x || cx > b.max.x) continue
        if (cz < b.min.z || cz > b.max.z) continue
        if (b.max.y > top) {
          top = b.max.y
          hasFloor = true
        }
      }
      const i = iz * w + ix
      if (hasFloor && top <= 60) {
        // 只认 60u 以内的顶面为可走地面（更高视为墙体，A* 绕行）
        height[i] = top
        walkable[i] = 1
      }
    }
  }
  return { ox: minX, oz: minZ, w, h, cell, walkable, height }
}

export function worldToCell(nav: NavGrid, x: number, z: number): [number, number] {
  let ix = Math.floor((x - nav.ox) / nav.cell)
  let iz = Math.floor((z - nav.oz) / nav.cell)
  ix = Math.max(0, Math.min(nav.w - 1, ix))
  iz = Math.max(0, Math.min(nav.h - 1, iz))
  return [ix, iz]
}

export function cellToWorld(nav: NavGrid, ix: number, iz: number): Vec3 {
  return { x: nav.ox + ix * nav.cell + nav.cell / 2, y: 0, z: nav.oz + iz * nav.cell + nav.cell / 2 }
}

/** 找距目标最近的可走格 */
export function nearestWalkable(nav: NavGrid, x: number, z: number): [number, number] | null {
  const [sx, sz] = worldToCell(nav, x, z)
  for (let r = 0; r < Math.max(nav.w, nav.h); r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const ix = sx + dx
        const iz = sz + dz
        if (ix < 0 || iz < 0 || ix >= nav.w || iz >= nav.h) continue
        if (nav.walkable[iz * nav.w + ix]) return [ix, iz]
      }
    }
  }
  return null
}

/** 两点间是否存在可达路径 */
export function hasPath(nav: NavGrid, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  return astar(nav, from, to) !== null
}

/** A* 4 邻接寻路，返回世界坐标路径点（不含起点） */
export function astar(
  nav: NavGrid,
  from: { x: number; z: number },
  to: { x: number; z: number },
): Vec3[] | null {
  const start = nearestWalkable(nav, from.x, from.z)
  const goal = nearestWalkable(nav, to.x, to.z)
  if (!start || !goal) return null

  const W = nav.w
  const H = nav.h
  const idx = (x: number, y: number) => y * W + x
  const [sx, sy] = start
  const [gx, gy] = goal

  const open: number[] = [idx(sx, sy)]
  const came = new Int32Array(W * H).fill(-1)
  const g = new Float32Array(W * H).fill(Infinity)
  const f = new Float32Array(W * H).fill(Infinity)
  const inOpen = new Uint8Array(W * H)
  g[idx(sx, sy)] = 0
  f[idx(sx, sy)] = Math.abs(gx - sx) + Math.abs(gy - sy)
  inOpen[idx(sx, sy)] = 1

  const hFn = (x: number, y: number) => Math.abs(gx - x) + Math.abs(gy - y)

  while (open.length > 0) {
    // 取 f 最小
    let bi = 0
    for (let i = 1; i < open.length; i++) {
      if (f[open[i]] < f[open[bi]]) bi = i
    }
    const cur = open[bi]
    open.splice(bi, 1)
    inOpen[cur] = 0
    const cx = cur % W
    const cy = Math.floor(cur / W)
    if (cx === gx && cy === gy) {
      // 回溯
      const path: Vec3[] = []
      let n = cur
      while (n !== idx(sx, sy)) {
        path.push(cellToWorld(nav, n % W, Math.floor(n / W)))
        n = came[n]
      }
      return path.reverse()
    }
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (const [dx, dy] of dirs) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      if (!nav.walkable[idx(nx, ny)]) continue
      const ni = idx(nx, ny)
      const ng = g[cur] + 1
      if (ng < g[ni]) {
        came[ni] = cur
        g[ni] = ng
        f[ni] = ng + hFn(nx, ny)
        if (!inOpen[ni]) {
          open.push(ni)
          inOpen[ni] = 1
        }
      }
    }
  }
  return null
}
