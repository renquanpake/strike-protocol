import type { Vec3 } from '../../engine/math'
import type { Brush, BrushMaterial, LevelDef } from './layout'

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
 * 原创对战地图 “strikeline”：双爆破点（A 高点 / B 地面）、中路 + 左右侧翼。
 * T 出生区 z>460，CT 出生区 z<-460；A 点平台 48u（阶梯可达），B 点地面。
 */
export function matchLevel(): LevelDef {
  const brushes: Brush[] = [
    // 地面 1200x1200
    b(0, -32, 0, 1200, 32, 1200, 'sand'),

    // ===== 出生区围墙 =====
    b(0, 0, 520, 700, 96, 24, 'concrete'), // T 区后墙
    b(0, 0, -520, 700, 96, 24, 'concrete'), // CT 区后墙
    b(-350, 0, 0, 24, 96, 1040, 'concrete'), // 西边界
    b(350, 0, 0, 24, 96, 1040, 'concrete'), // 东边界

    // ===== 中路走廊（x -40..40，z -240..240）=====
    b(-52, 0, 0, 24, 96, 480, 'concrete'), // 中走廊西墙
    b(52, 0, 0, 24, 96, 480, 'concrete'), // 中走廊东墙
    // 中走廊内掩体箱
    b(0, 0, 120, 48, 32, 48, 'wood'),
    b(0, 0, -120, 48, 32, 48, 'wood'),
    // 中走廊 T 侧入口门框（留 80u 缺口在 x 0 附近由两堵短墙夹出）
    b(-90, 0, 240, 100, 96, 24, 'concrete'),
    b(90, 0, 240, 100, 96, 24, 'concrete'),
    // CT 侧入口门框
    b(-90, 0, -240, 100, 96, 24, 'concrete'),
    b(90, 0, -240, 100, 96, 24, 'concrete'),

    // ===== 左翼通道（x -60..-340，z -240..240 → A 点方向）=====
    b(-200, 0, 180, 24, 96, 120, 'concrete'), // 左翼 T 侧短墙
    b(-320, 0, 60, 60, 64, 48, 'wood'), // 左翼掩体
    b(-240, 0, -60, 48, 48, 48, 'wood'), // 左翼低箱
    b(-320, 0, -180, 24, 96, 120, 'concrete'), // 左翼 CT 侧短墙
    // 横向连接走廊（z -240..-300 连通中路与左右翼，墙留缺口 ±[120..180]）
    b(-210, 0, -270, 60, 96, 24, 'concrete'),
    b(-80, 0, -270, 80, 96, 24, 'concrete'),
    b(210, 0, -270, 60, 96, 24, 'concrete'),
    b(80, 0, -270, 80, 96, 24, 'concrete'),

    // ===== 右翼通道（x 60..340，z -240..240 → B 点方向）=====
    b(200, 0, 180, 24, 96, 120, 'concrete'),
    b(320, 0, 60, 60, 64, 48, 'wood'),
    b(240, 0, -60, 48, 48, 48, 'wood'),
    b(320, 0, -180, 24, 96, 120, 'concrete'),

    // ===== A 点（西，高台 48u）=====
    b(-240, 0, -380, 220, 48, 160, 'metal'), // A 平台
    // A 平台阶梯（东侧，3 级 × 16u）
    b(-150, 0, -300, 40, 16, 80, 'concrete'),
    b(-134, 16, -300, 24, 16, 80, 'concrete'),
    b(-122, 32, -300, 12, 16, 80, 'concrete'),
    // A 点掩体
    b(-280, 48, -420, 48, 48, 48, 'wood'),
    b(-200, 48, -340, 48, 32, 48, 'wood'),
    b(-240, 72, -440, 16, 48, 16, 'metal'), // A 点灯塔（参照）
    // 平台护栏（西/北低墙，防掉台）
    b(-350, 48, -380, 8, 32, 160, 'concrete'),
    b(-240, 48, -460, 220, 32, 8, 'concrete'),

    // ===== B 点（东，地面）=====
    b(240, 0, -380, 48, 48, 48, 'wood'),
    b(300, 0, -320, 48, 48, 48, 'wood'),
    b(300, 48, -320, 48, 24, 48, 'wood'),
    b(200, 0, -420, 16, 160, 16, 'metal'), // B 点高塔（卡点参照）
    b(340, 0, -380, 48, 32, 120, 'concrete'), // B 点低墙
  ]

  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

  return {
    name: 'strikeline',
    spawns: {
      T: [v(0, 0, 500), v(-60, 0, 480), v(60, 0, 480), v(-120, 0, 460), v(120, 0, 460)],
      CT: [v(0, 0, -500), v(-60, 0, -480), v(60, 0, -480), v(-120, 0, -460), v(120, 0, -460)],
    },
    sites: [
      { name: 'A', center: v(-240, 48, -380), half: 110, elevation: 48 },
      { name: 'B', center: v(260, 0, -380), half: 110, elevation: 0 },
    ],
    brushes,
  }
}
