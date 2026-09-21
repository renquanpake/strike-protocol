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

/** 角色身高净空：格子上方这段距离内不得有实心体（顶棚须高于此值） */
const BODY_CLEARANCE = 136
/** 可跨越高差：小于等于此值的近地台阶视为可走上去（阶梯 16u/级） */
const STEP_UP = 32
/** 可走地面顶面上限（更高的顶面视为墙体/屋顶，不作地面） */
const WALK_TOP = 60

/**
 * 高度场：每格取覆盖该格中心的实心 brush 的最高可走顶面，
 * 并要求该顶面上方存在角色净空（门洞/隧道顶棚必须高于 BODY_CLEARANCE）。
 * 网格范围从实心 brush 包围盒自动推导（外扩 64u）。
 */
export function buildNavGrid(level: PreppedLevel, cell = 24): NavGrid {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const b of level.solids) {
    if (b.min.x < minX) minX = b.min.x
    if (b.max.x > maxX) maxX = b.max.x
    if (b.min.z < minZ) minZ = b.min.z
    if (b.max.z > maxZ) maxZ = b.max.z
  }
  if (!isFinite(minX)) {
    minX = -600
    maxX = 600
    minZ = -600
    maxZ = 600
  }
  minX -= 64
  minZ -= 64
  maxX += 64
  maxZ += 64
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
        if (b.max.y <= WALK_TOP && b.max.y > top) {
          top = b.max.y
          hasFloor = true
        }
      }
      if (!hasFloor) continue
      let blocked = false
      for (const b of level.solids) {
        if (cx < b.min.x || cx > b.max.x) continue
        if (cz < b.min.z || cz > b.max.z) continue
        // 高出顶面 STEP_UP 以上的实心体侵入净空 → 不可走（墙/柱/箱）
        if (b.max.y > top + STEP_UP && b.min.y < top + BODY_CLEARANCE) {
          blocked = true
          break
        }
      }
      const i = iz * w + ix
      if (!blocked) {
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

/** 最小二叉堆（按 f 值），支持 push/pop，O(log n) */
class MinHeap {
  private items: number[] = []
  private keys: Float64Array
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity)
  }
  get size(): number {
    return this.items.length
  }
  push(item: number, key: number): void {
    this.items.push(item)
    this.keys[item] = key
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[this.items[p]] <= this.keys[this.items[i]]) break
      ;[this.items[p], this.items[i]] = [this.items[i], this.items[p]]
      i = p
    }
  }
  pop(): number {
    const top = this.items[0]
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.keys[this.items[l]] < this.keys[this.items[m]]) m = l
        if (r < this.items.length && this.keys[this.items[r]] < this.keys[this.items[m]]) m = r
        if (m === i) break
        ;[this.items[m], this.items[i]] = [this.items[i], this.items[m]]
        i = m
      }
    }
    return top
  }
}

/** A* 4 邻接寻路（二叉堆），返回世界坐标路径点（不含起点） */
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

  const open = new MinHeap(W * H)
  const came = new Int32Array(W * H).fill(-1)
  const g = new Float32Array(W * H).fill(Infinity)
  const closed = new Uint8Array(W * H)
  g[idx(sx, sy)] = 0
  open.push(idx(sx, sy), Math.abs(gx - sx) + Math.abs(gy - sy))

  const hFn = (x: number, y: number) => Math.abs(gx - x) + Math.abs(gy - y)

  while (open.size > 0) {
    const cur = open.pop()
    if (closed[cur]) continue
    closed[cur] = 1
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
      const ni = idx(nx, ny)
      if (!nav.walkable[ni] || closed[ni]) continue
      const ng = g[cur] + 1
      if (ng < g[ni]) {
        came[ni] = cur
        g[ni] = ng
        open.push(ni, ng + hFn(nx, ny))
      }
    }
  }
  return null
}
