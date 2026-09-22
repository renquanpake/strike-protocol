import type { Vec3 } from '../../engine/math'
import type { Brush, LevelDef } from './layout'

const b = (
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  material: Brush['material'] = 'concrete',
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
 * #37 训练场：封闭靶道（静靶墙 + 移动靶轨道）+ 投掷练习区。
 * 无包点（sites 空）；无 C4 规则由 mode 门控。
 */
export function buildTraining(): LevelDef {
  const brushes: Brush[] = []
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

  // 地面（1600×1200）
  brushes.push(b(0, -32, 0, 1600, 32, 1200, 'sand'))
  // 四面外墙（120 高）
  brushes.push(b(0, 0, -600, 1600, 120, 24, 'stone'))
  brushes.push(b(0, 0, 600, 1600, 120, 24, 'stone'))
  brushes.push(b(-800, 0, 0, 24, 120, 1200, 'stone'))
  brushes.push(b(800, 0, 0, 24, 120, 1200, 'stone'))

  // 靶道静靶墙（z=-440，长 1200，留门洞）
  brushes.push(b(-600, 0, -440, 600, 120, 24, 'stone'))
  brushes.push(b(600, 0, -440, 600, 120, 24, 'stone'))
  // 靶墙前小台（靶子立于 32u 台顶）
  brushes.push(b(0, 0, -380, 1200, 32, 80, 'wood'))

  // 投掷练习区掩体（中央 + 玻璃靶）
  brushes.push(b(-300, 0, 0, 60, 48, 60, 'wood'))
  brushes.push(b(300, 0, 0, 60, 48, 60, 'wood'))
  // 玻璃靶（#35 验证：可打碎）
  brushes.push(b(0, 0, 200, 200, 90, 24, 'glass'))
  // 投掷物落点标记台
  brushes.push(b(0, 0, 400, 300, 16, 200, 'sand'))

  return {
    name: 'training',
    spawns: {
      T: [v(-200, 0, 450), v(-100, 0, 450), v(0, 0, 450), v(100, 0, 450), v(200, 0, 450)],
      CT: [v(-200, 0, 480), v(0, 0, 480), v(200, 0, 480)],
    },
    sites: [],
    brushes,
  }
}
