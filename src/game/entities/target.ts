import type { Vec3 } from '../../engine/math'
import type { HitboxPart } from '../types'

export interface Target {
  id: number
  /** 脚底中心 */
  position: Vec3
  health: number
  maxHealth: number
  /** 最近一次被命中的 tick（渲染命中闪白用） */
  hitFlashTick: number
  alive: boolean
  respawnAtTick: number
}

export interface TargetAABB {
  part: HitboxPart
  min: Vec3
  max: Vec3
}

/** 靶子五段 hitbox 的局部 AABB（相对脚底，单位 u） */
export const TARGET_PART_LOCAL: TargetAABB[] = [
  { part: 'head', min: { x: -8, y: 58, z: -8 }, max: { x: 8, y: 72, z: 8 } },
  { part: 'chest', min: { x: -16, y: 40, z: -8 }, max: { x: 16, y: 58, z: 8 } },
  { part: 'stomach', min: { x: -12, y: 26, z: -6 }, max: { x: 12, y: 40, z: 6 } },
  { part: 'arms', min: { x: -28, y: 40, z: -5 }, max: { x: 28, y: 56, z: 5 } },
  { part: 'legs', min: { x: -14, y: 0, z: -6 }, max: { x: 14, y: 26, z: 6 } },
]

export function targetAABBs(t: Target): TargetAABB[] {
  return TARGET_PART_LOCAL.map((p) => ({
    part: p.part,
    min: {
      x: t.position.x + p.min.x,
      y: t.position.y + p.min.y,
      z: t.position.z + p.min.z,
    },
    max: {
      x: t.position.x + p.max.x,
      y: t.position.y + p.max.y,
      z: t.position.z + p.max.z,
    },
  }))
}

export function makeTarget(id: number, x: number, y: number, z: number): Target {
  return {
    id,
    position: { x, y, z },
    health: 100,
    maxHealth: 100,
    hitFlashTick: -1,
    alive: true,
    respawnAtTick: 0,
  }
}
