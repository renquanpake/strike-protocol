import type { Vec3 } from '../../engine/math'
import type { Brush, LevelDef, SiteDef } from '../map/layout'

const EPS = 1e-3
/** 单 tick 最大穿透容差（maxFallSpeed*dt ≈ 10.9u） */
const Y_TOLERANCE = 24
/** 梯子抓取容差（向四周放宽 u） */
const LADDER_TOLERANCE = 6

/** 购买区（出生区外包扩，见 CONFIG.buyZoneMargin） */
export interface BuyZone {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 预处理的地图：实心碰撞体与梯子分离，避免逐 tick 过滤 */
export interface PreppedLevel {
  solids: Brush[]
  /** #35 完整 solids 快照（玻璃破坏后可用于恢复） */
  allSolids: Brush[]
  ladders: Brush[]
  spawns: { T: Vec3[]; CT: Vec3[] }
  sites: SiteDef[]
  /** 各阵营购买区（出生点包围盒 + buyZoneMargin；空 spawns 为 null） */
  buyZones: { T: BuyZone | null; CT: BuyZone | null }
}

function buyZoneOf(spawns: Vec3[], margin: number): BuyZone | null {
  if (spawns.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const s of spawns) {
    minX = Math.min(minX, s.x)
    maxX = Math.max(maxX, s.x)
    minZ = Math.min(minZ, s.z)
    maxZ = Math.max(maxZ, s.z)
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }
}

export function prepareLevel(level: LevelDef, buyZoneMargin = 250): PreppedLevel {
  const solids: Brush[] = []
  const ladders: Brush[] = []
  for (const b of level.brushes) {
    if (b.clip) continue
    if (b.decor) continue // 纯视觉装饰：不参与碰撞/导航（仍参与渲染与弹道）
    if (b.ladder) ladders.push(b)
    else solids.push(b)
  }
  return {
    solids,
    allSolids: [...solids],
    ladders,
    spawns: level.spawns,
    sites: level.sites ?? [],
    buyZones: {
      T: buyZoneOf(level.spawns.T, buyZoneMargin),
      CT: buyZoneOf(level.spawns.CT, buyZoneMargin),
    },
  }
}

/** 是否位于阵营购买区内（无购买区数据时放行） */
export function inBuyZone(level: PreppedLevel, team: 'T' | 'CT', x: number, z: number): boolean {
  const zone = level.buyZones[team]
  if (!zone) return true
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ
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
 * stepHeight > 0 时启用台阶上行（CS step）：下坠/着地态碰到 ≤stepHeight 的顶面且头顶净空可通行时，
 * 抬起脚底站上顶面并继续前进，而非被阻挡。
 */
export function collideBrushes(
  pos: Vec3,
  vel: Vec3,
  height: number,
  radius: number,
  brushes: Brush[],
  dt: number,
  stepHeight = 0,
): boolean {
  const r = radius

  /** 台阶上行条件：顶面高出脚底 ≤stepHeight，且顶面到头顶之间无其他实心阻挡 */
  const canStep = (b: Brush): boolean => {
    if (stepHeight <= 0 || vel.y > 0) return false
    const rise = b.max.y - pos.y
    if (rise <= 1 || rise > stepHeight) return false
    const topY = b.max.y
    for (const c of brushes) {
      if (c === b) continue
      if (!overlapXZ(pos.x, pos.z, r, c)) continue
      if (c.min.y < topY + height - 1 && c.max.y > topY + 1) return false
    }
    return true
  }

  pos.x += vel.x * dt
  for (const b of brushes) {
    if (!overlapXZ(pos.x, pos.z, r, b)) continue
    if (!overlapY(pos.y, height, b)) continue
    if (canStep(b)) {
      pos.y = b.max.y
      continue
    }
    if (vel.x > 0) pos.x = b.min.x - r - EPS
    else if (vel.x < 0) pos.x = b.max.x + r + EPS
    vel.x = 0
  }

  pos.z += vel.z * dt
  for (const b of brushes) {
    if (!overlapXZ(pos.x, pos.z, r, b)) continue
    if (!overlapY(pos.y, height, b)) continue
    if (canStep(b)) {
      pos.y = b.max.y
      continue
    }
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
