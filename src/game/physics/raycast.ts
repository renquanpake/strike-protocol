import type { Vec3 } from '../../engine/math'

export interface RayHit {
  /** 射线参数 t（单位 = 距离 u） */
  t: number
  point: Vec3
  /** 命中的实体标识（brush 索引 / 'target:<id>:<part>' / 'miss'） */
  target: string
  part?: string
  /** 命中面法线（外法线，用于对齐印花投射） */
  normal: Vec3
}

export interface BoxEntry {
  id: string
  part?: string
  min: Vec3
  max: Vec3
}

/** G1 穿墙结果：最终命中 + 累计衰减 + 首个穿透点（供烟尘 decal / 闷声） */
export interface PenetrationResult {
  hit: RayHit | null
  /** 累计伤害衰减系数（各穿透层材质衰减之积，未穿透 = 1） */
  damageScale: number
  /** 是否至少穿透了一层材质 */
  penetrated: boolean
  /** 首个穿透层命中（入口点） */
  entry: RayHit | null
  /** 穿透层数 */
  layers: number
}

/**
 * G1 穿墙（wallbang）：命中 solid 后按材质衰减继续追踪（穿透白名单外的材质/实体为止）。
 * isPenetrable(id) 判定某 brush 是否可穿透；attenuation(id) 返回该层伤害衰减系数。
 */
export function raycastBoxesWithPenetration(
  origin: Vec3,
  dir: Vec3,
  boxes: BoxEntry[],
  isPenetrable: (target: string) => boolean,
  attenuation: (target: string) => number,
  maxLayers: number,
): PenetrationResult {
  let o: Vec3 = origin
  let scale = 1
  let layers = 0
  let entry: RayHit | null = null
  let final: RayHit | null = null
  for (let guard = 0; guard < Math.max(1, maxLayers + 2); guard++) {
    const hit = raycastBoxes(o, dir, boxes)
    if (!hit) break
    if (hit.target.startsWith('brush:') && layers < maxLayers && isPenetrable(hit.target)) {
      if (!entry) entry = hit
      final = hit
      scale *= attenuation(hit.target)
      layers += 1
      // 推进到该盒子的出射面（各轴"远面"交叉时间取最小），保证下一轮不再命中同一盒子
      const bb = boxes[Number(hit.target.slice(6))]
      if (bb) {
        // 当前 origin 在盒内/入口处，沿 dir 前进会先穿过某轴"远面"而离开盒子
        const farX =
          Math.abs(dir.x) > 1e-9 ? (dir.x > 0 ? bb.max.x - o.x : o.x - bb.min.x) / Math.abs(dir.x) : Infinity
        const farY =
          Math.abs(dir.y) > 1e-9 ? (dir.y > 0 ? bb.max.y - o.y : o.y - bb.min.y) / Math.abs(dir.y) : Infinity
        const farZ =
          Math.abs(dir.z) > 1e-9 ? (dir.z > 0 ? bb.max.z - o.z : o.z - bb.min.z) / Math.abs(dir.z) : Infinity
        const tExit = Math.min(farX, farY, farZ)
        if (Number.isFinite(tExit)) {
          o = {
            x: o.x + dir.x * (tExit + 1e-3),
            y: o.y + dir.y * (tExit + 1e-3),
            z: o.z + dir.z * (tExit + 1e-3),
          }
          continue
        }
      }
    }
    final = hit
    break
  }
  return { hit: final, damageScale: layers > 0 ? scale : 1, penetrated: layers > 0, entry, layers }
}

/**
 * 射线 vs 盒子集合，返回最近命中。
 * boxes: 每个 box 带标识 id 与可选 part。
 */
export function raycastBoxes(
  origin: Vec3,
  dir: Vec3,
  boxes: { id: string; part?: string; min: Vec3; max: Vec3 }[],
): RayHit | null {
  const { x: ox, y: oy, z: oz } = origin
  const { x: dx, y: dy, z: dz } = dir
  let best: RayHit | null = null

  for (const b of boxes) {
    let tmin = 0
    let tmax = Infinity
    let face = 0 // 0=x 1=y 2=z
    let faceSign = 1 // -1 朝 -axis, +1 朝 +axis

    if (Math.abs(dx) < 1e-9) {
      if (ox < b.min.x || ox > b.max.x) continue
    } else {
      let t1 = (b.min.x - ox) / dx
      let t2 = (b.max.x - ox) / dx
      if (t1 > t2) [t1, t2] = [t2, t1]
      if (t1 > tmin) {
        tmin = t1
        face = 0
        faceSign = dx > 0 ? -1 : 1
      }
      tmax = Math.min(tmax, t2)
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < b.min.y || oy > b.max.y) continue
    } else {
      let t1 = (b.min.y - oy) / dy
      let t2 = (b.max.y - oy) / dy
      if (t1 > t2) [t1, t2] = [t2, t1]
      if (t1 > tmin) {
        tmin = t1
        face = 1
        faceSign = dy > 0 ? -1 : 1
      }
      tmax = Math.min(tmax, t2)
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < b.min.z || oz > b.max.z) continue
    } else {
      let t1 = (b.min.z - oz) / dz
      let t2 = (b.max.z - oz) / dz
      if (t1 > t2) [t1, t2] = [t2, t1]
      if (t1 > tmin) {
        tmin = t1
        face = 2
        faceSign = dz > 0 ? -1 : 1
      }
      tmax = Math.min(tmax, t2)
    }

    if (tmax < tmin) continue
    const t = tmin > 0 ? tmin : tmax
    if (t < 0) continue
    const normal: Vec3 =
      face === 0
        ? { x: faceSign, y: 0, z: 0 }
        : face === 1
          ? { x: 0, y: faceSign, z: 0 }
          : { x: 0, y: 0, z: faceSign }
    if (!best || t < best.t) {
      best = {
        t,
        point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
        target: b.id,
        part: b.part,
        normal,
      }
    }
  }
  return best
}
