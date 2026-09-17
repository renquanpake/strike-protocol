import type { Vec3 } from '../../engine/math'

export interface RayHit {
  /** 射线参数 t（单位 = 距离 u） */
  t: number
  point: Vec3
  /** 命中的实体标识（brush 索引 / 'target:<id>:<part>' / 'miss'） */
  target: string
  part?: string
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

    if (Math.abs(dx) < 1e-9) {
      if (ox < b.min.x || ox > b.max.x) continue
    } else {
      let t1 = (b.min.x - ox) / dx
      let t2 = (b.max.x - ox) / dx
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < b.min.y || oy > b.max.y) continue
    } else {
      let t1 = (b.min.y - oy) / dy
      let t2 = (b.max.y - oy) / dy
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < b.min.z || oz > b.max.z) continue
    } else {
      let t1 = (b.min.z - oz) / dz
      let t2 = (b.max.z - oz) / dz
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
    }

    if (tmax < tmin) continue
    const t = tmin > 0 ? tmin : tmax
    if (t < 0) continue
    if (!best || t < best.t) {
      best = {
        t,
        point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
        target: b.id,
        part: b.part,
      }
    }
  }
  return best
}
