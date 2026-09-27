import type { Vec3 } from '../../engine/math'

export type BrushMaterial =
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'sand'
  | 'glass'
  | 'ladder'
  | 'stone'
  | 'roof'
  | 'sandbag'
  | 'rusted'
  | 'plaster'
  | 'tile'

export interface Brush {
  /** 脚底坐标系：min.y 为底面 */
  min: Vec3
  max: Vec3
  material: BrushMaterial
  /** 仅碰撞不可见 */
  clip?: boolean
  /** 梯子：不作实心碰撞，可攀爬 */
  ladder?: boolean
  /** 纯视觉装饰：参与渲染与弹道，不进碰撞/导航 */
  decor?: boolean
}

export interface SiteDef {
  name: 'A' | 'B'
  center: Vec3
  half: number
  elevation: number
}

export interface LevelDef {
  name: string
  spawns: { T: Vec3[]; CT: Vec3[] }
  sites: SiteDef[]
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
  decor = false,
): Brush => ({
  min: { x: cx - w / 2, y: cy, z: cz - d / 2 },
  max: { x: cx + w / 2, y: cy + h, z: cz + d / 2 },
  material,
  clip,
  ladder: ladder || undefined,
  decor: decor || undefined,
})

/**
 * M0 练习场 + M3 双爆破点/出生区。
 * 正式对战地图在 M4 落地。
 */
export function practiceLevel(): LevelDef {
  return {
    name: 'practice',
    spawns: {
      T: [
        { x: 0, y: 0, z: 200 },
        { x: -60, y: 0, z: 240 },
        { x: 60, y: 0, z: 240 },
        { x: -120, y: 0, z: 280 },
        { x: 120, y: 0, z: 280 },
      ],
      CT: [
        { x: 0, y: 0, z: -460 },
        { x: -80, y: 0, z: -440 },
        { x: 80, y: 0, z: -440 },
        { x: -160, y: 0, z: -420 },
        { x: 160, y: 0, z: -420 },
      ],
    },
    sites: [
      { name: 'A', center: { x: 0, y: 64, z: -160 }, half: 100, elevation: 64 },
      { name: 'B', center: { x: 400, y: 0, z: -180 }, half: 130, elevation: 0 },
    ],
    brushes: [
      // 地面 1024x1024
      b(0, -32, 0, 1024, 32, 1024, 'sand'),
      // 低墙（跳跃可越过）
      b(0, 0, -60, 240, 32, 16, 'concrete'),
      // 木箱堆（蹲跳验证）
      b(60, 0, -40, 48, 48, 48, 'wood'),
      b(60, 48, -40, 48, 48, 48, 'wood'),
      // 阶梯
      b(-80, 0, -80, 64, 24, 64, 'concrete'),
      b(-80, 24, -120, 64, 24, 64, 'concrete'),
      b(-80, 48, -160, 64, 24, 64, 'concrete'),
      // 中央平台（A 点，需 bhop 跳上）
      b(0, 0, -160, 160, 64, 160, 'metal'),
      // B 点掩体
      b(400, 0, -120, 48, 48, 48, 'wood'),
      // 散布掩体箱
      b(180, 0, 40, 48, 48, 48, 'wood'),
      b(-180, 0, 40, 48, 48, 48, 'wood'),
      b(180, 48, 40, 48, 24, 48, 'wood'),
      // 远处地标塔（B 点参照）
      b(400, 0, -300, 96, 240, 96, 'concrete'),
      b(400, 240, -300, 32, 48, 32, 'metal'),
      // 梯子（攀爬验证）
      b(300, 0, -300, 8, 160, 8, 'ladder', false, true),
    ],
  }
}
