import type { Vec3 } from '../../engine/math'

export type BrushMaterial = 'concrete' | 'metal' | 'wood' | 'sand' | 'glass' | 'ladder'

export interface Brush {
  /** 脚底坐标系：min.y 为底面 */
  min: Vec3
  max: Vec3
  material: BrushMaterial
  /** 仅碰撞不可见 */
  clip?: boolean
  /** 梯子：不作实心碰撞，可攀爬 */
  ladder?: boolean
}

export interface LevelDef {
  name: string
  spawn: Vec3
  brushes: Brush[]
}

const b = (
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  material: BrushMaterial,
  clip = false,
  ladder = false,
): Brush => ({
  min: { x: cx - w / 2, y: cy, z: cz - d / 2 },
  max: { x: cx + w / 2, y: cy + h, z: cz + d / 2 },
  material,
  clip,
  ladder: ladder || undefined,
})

/**
 * M0 练习场：验证碰撞/移动/跳跃。
 * 双爆破点正式地图在 M4 落地（map/layout）。
 */
export function practiceLevel(): LevelDef {
  return {
    name: 'practice',
    spawn: { x: 0, y: 40, z: 200 },
    brushes: [
      // 地面 1024x1024
      b(0, -32, 0, 1024, 32, 1024, 'sand'),
      // 低墙（跳跃可越过）
      b(0, 0, -60, 240, 32, 16, 'concrete'),
      // 木箱堆（蹲跳验证，M1）
      b(60, 0, -40, 48, 48, 48, 'wood'),
      b(60, 48, -40, 48, 48, 48, 'wood'),
      // 阶梯
      b(-80, 0, -80, 64, 24, 64, 'concrete'),
      b(-80, 24, -120, 64, 24, 64, 'concrete'),
      b(-80, 48, -160, 64, 24, 64, 'concrete'),
      // 中央平台（需 bhop/连跳跳上，验证空中加速）
      b(0, 0, -160, 160, 64, 160, 'metal'),
      // 散布掩体箱
      b(180, 0, 40, 48, 48, 48, 'wood'),
      b(-180, 0, 40, 48, 48, 48, 'wood'),
      b(180, 48, 40, 48, 24, 48, 'wood'),
      // 远处地标塔（视野参照）
      b(400, 0, -300, 96, 240, 96, 'concrete'),
      b(400, 240, -300, 32, 48, 32, 'metal'),
      // 梯子（M1 攀爬验证，不作实心碰撞；顶部 160u 落下冲击 530u/s < 580 无坠落伤害）
      b(300, 0, -300, 8, 160, 8, 'ladder', false, true),
    ],
  }
}
