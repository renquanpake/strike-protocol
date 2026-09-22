import type { Vec3 } from '../../engine/math'
import type { Brush, BrushMaterial, LevelDef } from './layout'

const b = (
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  material: BrushMaterial = 'concrete',
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
 * “de_plaza”——城市广场（#28 第二张对战图）：
 * 开放广场三路线：西高台 A（48 平台）、东平地 B（0）、中央下沉广场（-32）作 mid。
 * T 出生（南）/ CT 出生（北）。玩家高 140u：门洞净空 ≥150u、通道 ≥120u、台阶 ≤32u/级。
 */
export function buildDePlaza(): LevelDef {
  const brushes: Brush[] = []
  const push = (...bs: Brush[]): void => {
    brushes.push(...bs)
  }
  const conc = (...bs: Brush[]): void => push(...bs.map((x) => ({ ...x, material: 'stone' as BrushMaterial })))
  const wood = (...bs: Brush[]): void => push(...bs.map((x) => ({ ...x, material: 'wood' as BrushMaterial })))
  const metal = (...bs: Brush[]): void => push(...bs.map((x) => ({ ...x, material: 'rusted' as BrushMaterial })))
  const sand = (...bs: Brush[]): void => push(...bs.map((x) => ({ ...x, material: 'sand' as BrushMaterial })))
  const glass = (...bs: Brush[]): void => push(...bs.map((x) => ({ ...x, material: 'glass' as BrushMaterial })))
  const decor = (...bs: Brush[]): void =>
    push(...bs.map((x) => ({ ...x, material: (x.material ?? 'concrete') as BrushMaterial, decor: true })))

  // ===== 地面（3200×2800，中央挖下沉广场）=====
  sand(
    b(0, -32, 775, 3200, 32, 2500), // 北带 z∈[150,1400]
    b(0, -32, -775, 3200, 32, 2500), // 南带 z∈[-1400,-150]
    b(-875, -32, 0, 2950, 32, 300), // 中带西 x∈[-1600,-150]
    b(875, -32, 0, 2950, 32, 300), // 中带东 x∈[150,1600]
  )
  // 中央下沉广场（downtown pit，底 -32）
  sand(b(0, -64, 0, 300, 32, 300))
  // 广场南北缘两级台阶（-32→-16→0）
  conc(b(0, -64, -140, 300, 48, 40))
  conc(b(0, -64, 140, 300, 48, 40))
  conc(b(0, -64, -120, 300, 32, 60))
  conc(b(0, -64, 120, 300, 32, 60))

  // ===== 外墙（160 高）=====
  conc(
    b(0, 0, 1412, 3248, 160, 24),
    b(0, 0, -1412, 3248, 160, 24),
    b(-1612, 0, 0, 24, 160, 2848),
    b(1612, 0, 0, 24, 160, 2848),
  )

  // ===== A 点高台（西，平台 48）=====
  conc(b(-1000, 0, 0, 600, 48, 600))
  // A 台三级台阶（自西广场 0→48）
  conc(
    b(-1320, 0, 0, 60, 16, 200),
    b(-1360, 0, 0, 60, 32, 200),
    b(-1400, 0, 0, 60, 48, 200),
  )
  // A 台掩体
  conc(b(-1050, 48, -150, 160, 64, 120)) // 石台
  metal(b(-850, 48, 150, 200, 64, 120)) // 车
  wood(b(-900, 48, -50, 48, 48, 48))
  wood(b(-900, 96, -50, 48, 24, 48))

  // ===== B 点平地（东）=====
  // B 掩体（车 / 箱 / 玻璃靶）
  metal(b(1050, 0, 150, 200, 64, 120))
  wood(b(900, 0, -100, 48, 48, 48))
  wood(b(900, 48, -100, 48, 24, 48))
  glass(b(980, 0, 0, 24, 90, 200)) // 玻璃挡板（#35 可打碎）

  // ===== 中央广场周边掩体 =====
  wood(b(-250, 0, -250, 48, 48, 48))
  wood(b(250, 0, 250, 48, 48, 48))
  metal(b(0, 0, -350, 160, 64, 120))
  metal(b(0, 0, 350, 160, 64, 120))

  // ===== T 出生区（南）掩体 =====
  wood(b(-400, 0, -1200, 48, 48, 48))
  wood(b(400, 0, -1200, 48, 48, 48))
  metal(b(0, 0, -1150, 200, 64, 120))

  // ===== CT 出生区（北）掩体 =====
  wood(b(-400, 0, 1200, 48, 48, 48))
  wood(b(400, 0, 1200, 48, 48, 48))
  metal(b(0, 0, 1150, 200, 64, 120))

  // ===== 纯视觉装饰（decor：不碰撞、不入导航）=====
  // 路灯 / 旗帜 / 广场地标
  decor(
    b(-1000, 0, -300, 10, 150, 10, 'concrete'),
    b(-1000, 150, -300, 40, 30, 4, 'rusted'),
    b(1000, 0, 300, 10, 150, 10, 'concrete'),
    b(1000, 150, 300, 40, 30, 4, 'rusted'),
    b(0, 0, 0, 8, 120, 8, 'concrete'),
    b(0, 120, 0, 36, 28, 4, 'rusted'),
  )
  // 沙袋排（广场入口）
  decor(
    b(-160, 0, -200, 28, 44, 120, 'sandbag'),
    b(160, 0, 200, 28, 44, 120, 'sandbag'),
  )

  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

  return {
    name: 'de_plaza',
    spawns: {
      T: [v(-600, 0, -1250), v(-200, 0, -1250), v(200, 0, -1250), v(600, 0, -1250), v(0, 0, -1350)],
      CT: [v(-600, 0, 1250), v(-200, 0, 1250), v(200, 0, 1250), v(600, 0, 1250), v(0, 0, 1350)],
    },
    sites: [
      { name: 'A', center: v(-1000, 48, 0), half: 250, elevation: 48 },
      { name: 'B', center: v(1000, 0, 0), half: 250, elevation: 0 },
    ],
    brushes,
  }
}
