import type { Vec3 } from '../../engine/math'
import type { Brush, LevelDef, SiteDef } from '../map/layout'

const EPS = 1e-3
/** 单 tick 最大穿透容差（maxFallSpeed*dt ≈ 10.9u） */
const Y_TOLERANCE = 24
/** 梯子抓取容差（向四周放宽 u） */
const LADDER_TOLERANCE = 6

/** 预处理的地图：实心碰撞体与梯子分离，避免逐 tick 过滤 */
export interface PreppedLevel {
  solids: Brush[]
  ladders: Brush[]
  spawns: { T: Vec3[]; CT: Vec3[] }
  sites: SiteDef[]
}

export function prepareLevel(level: LevelDef): PreppedLevel {
  const solids: Brush[] = []
  const ladders: Brush[] = []
  for (const b of level.brushes) {
    if (b.clip) continue
    if (b.ladder) ladders.push(b)
    else solids.push(b)
  }
  return {
    solids,
    ladders,
    spawns: level.spawns,
    sites: level.sites ?? [],
  }
}

function overlapXZ(px: number, pz: number, r: number, b: Brush): boolean {
  return (
    px + r > b.min.x + EPS &&
    px - r < b.max.x - EPS &&
    pz + r > b.min.z + EPS &&
    pz - r < b.max.z - EPS
  )
}

function overlapY(feetY: number, height: number, b: Brush): boolean {
  return feetY + height > b.min.y + EPS && feetY < b.max.y - EPS
}

/**
 * 角色 AABB 对静态 brush 的分轴扫掠碰撞。
 * pos = 脚底中心；返回本 tick 是否着地。
 * 分轴解算顺序：X → Z → Y。
 */
export function collideBrushes(
  pos: Vec3,
  vel: Vec3,
  height: number,
  radius: number,
  brushes: Brush[],
  dt: number,
): boolean {
  const r = radius

  pos.x += vel.x * dt
  for (const b of brushes) {
    if (!overlapXZ(pos.x, pos.z, r, b)) continue
    if (!overlapY(pos.y, height, b)) continue
    if (vel.x > 0) pos.x = b.min.x - r - EPS
    else if (vel.x < 0) pos.x = b.max.x + r + EPS
    vel.x = 0
  }

  pos.z += vel.z * dt
  for (const b of brushes) {
    if (!overlapXZ(pos.x, pos.z, r, b)) continue
    if (!overlapY(pos.y, height, b)) continue
    if (vel.z > 0) pos.z = b.min.z - r - EPS
    else if (vel.z < 0) pos.z = b.max.z + r + EPS
    vel.z = 0
  }

  pos.y += vel.y * dt
  let onGround = false
  for (const b of brushes) {
    if (!overlapXZ(pos.x, pos.z, r, b)) continue
    // 着地：脚底落入顶面附近且下坠
    if (vel.y <= 0 && pos.y <= b.max.y && pos.y > b.max.y - Y_TOLERANCE) {
      pos.y = b.max.y
      vel.y = 0
      onGround = true
    } else if (
      vel.y > 0 &&
      pos.y + height >= b.min.y &&
      pos.y + height < b.min.y + Y_TOLERANCE &&
      pos.y < b.min.y
    ) {
      pos.y = b.min.y - height
      vel.y = 0
    }
  }
  return onGround
}

/** 脚底 AABB 与梯子是否重叠（含容差），用于判定可抓取 */
export function overlapLadder(
  pos: Vec3,
  height: number,
  radius: number,
  l: Brush,
): boolean {
  const t = LADDER_TOLERANCE
  return (
    pos.x + radius > l.min.x - t &&
    pos.x - radius < l.max.x + t &&
    pos.z + radius > l.min.z - t &&
    pos.z - radius < l.max.z + t &&
    pos.y + height > l.min.y &&
    pos.y < l.max.y + t
  )
}
