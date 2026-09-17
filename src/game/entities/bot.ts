import type { Vec3 } from '../../engine/math'
import type { PlayerEntity } from '../state'
import type { HitboxPart } from '../types'

export interface HumanAABB {
  part: HitboxPart
  min: Vec3
  max: Vec3
}

/** 玩家五段 hitbox 局部 AABB（相对脚底，单位 u）：与靶子同模板 */
export const HUMAN_PART_LOCAL: { part: HitboxPart; min: Vec3; max: Vec3 }[] = [
  { part: 'head', min: { x: -8, y: 58, z: -8 }, max: { x: 8, y: 72, z: 8 } },
  { part: 'chest', min: { x: -16, y: 40, z: -8 }, max: { x: 16, y: 58, z: 8 } },
  { part: 'stomach', min: { x: -12, y: 26, z: -6 }, max: { x: 12, y: 40, z: 6 } },
  { part: 'arms', min: { x: -28, y: 40, z: -5 }, max: { x: 28, y: 56, z: 5 } },
  { part: 'legs', min: { x: -14, y: 0, z: -6 }, max: { x: 14, y: 26, z: 6 } },
]

export function humanAABBs(p: PlayerEntity): HumanAABB[] {
  return HUMAN_PART_LOCAL.map((box) => ({
    part: box.part,
    min: {
      x: p.position.x + box.min.x,
      y: p.position.y + box.min.y,
      z: p.position.z + box.min.z,
    },
    max: {
      x: p.position.x + box.max.x,
      y: p.position.y + box.max.y,
      z: p.position.z + box.max.z,
    },
  }))
}
