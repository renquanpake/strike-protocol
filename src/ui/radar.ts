import type { GameState } from '../game/state'
import type { PreppedLevel } from '../game/physics/collision'

/** #42 团队色（默认橙/蓝；色盲模式橙/青，避开红绿轴） */
let TEAM_COLORS = { T: '#ff9d5c', CT: '#5cc8ff' }
export function setRadarTeamColors(m: 'default' | 'deuteranopia'): void {
  TEAM_COLORS =
    m === 'deuteranopia'
      ? { T: '#ffb02e', CT: '#00d5e0' }
      : { T: '#ff9d5c', CT: '#5cc8ff' }
}

/**
 * 小地图（重做）：北朝上整图视图。
 * 预渲染静态层（墙体/玻璃/梯子/爆点/出生点/边界），每帧叠加动态层（C4/敌我/C4 状态/本地方向楔）。
 * 目标：一眼看清"墙在哪、敌我谁在哪、C4 在哪、我该往哪走"。
 */
export class Radar {
  private ctx: CanvasRenderingContext2D
  private staticCanvas: HTMLCanvasElement
  private scale: number
  /** 世界坐标 → 静态层像素（北=+z 朝上） */
  private minX = 0
  private maxZ = 0

  constructor(private canvas: HTMLCanvasElement, private level: PreppedLevel) {
    const pad = 6
    this.ctx = canvas.getContext('2d')!
    // 地图范围：取全部 solids + sites + spawns 的 x/z 包围盒
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    const grow = (x: number, z: number) => {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    for (const b of level.solids) {
      grow(b.min.x, b.min.z)
      grow(b.max.x, b.max.z)
    }
    for (const s of level.sites) {
      grow(s.center.x - s.half, s.center.z - s.half)
      grow(s.center.x + s.half, s.center.z + s.half)
    }
    for (const sp of [...level.spawns.T, ...level.spawns.CT]) grow(sp.x, sp.z)
    const spanX = Math.max(1, maxX - minX)
    const spanZ = Math.max(1, maxZ - minZ)
    this.minX = minX
    this.maxZ = maxZ
    const cw = canvas.width
    const ch = canvas.height
    this.scale = Math.min((cw - pad * 2) / spanX, (ch - pad * 2) / spanZ)
    // 居中偏移
    const offX = (cw - spanX * this.scale) / 2
    const offY = (ch - spanZ * this.scale) / 2
    this.offX = offX
    this.offY = offY
    this.staticCanvas = this.renderStatic(cw, ch)
  }

  private offX = 0
  private offY = 0

  private wx(x: number): number {
    return this.offX + (x - this.minX) * this.scale
  }
  private wz(z: number): number {
    return this.offY + (this.maxZ - z) * this.scale
  }

  /** 预渲染静态层（墙体/玻璃/梯子/爆点/出生点） */
  private renderStatic(cw: number, ch: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const g = c.getContext('2d')!
    g.clearRect(0, 0, cw, ch)
    // 底色（更深更不透明，突出布局）
    g.fillStyle = 'rgba(5, 9, 13, 0.9)'
    g.fillRect(0, 0, cw, ch)
    const H_WALL = 30 // 高度阈值：高于此视为"墙"，否则视为地面/低台
    for (const b of this.level.solids) {
      const h = b.max.y - b.min.y
      const x0 = this.wx(b.min.x)
      const y0 = this.wz(b.max.z)
      const w = (b.max.x - b.min.x) * this.scale
      const hh = (b.max.z - b.min.z) * this.scale
      if (h >= H_WALL) {
        if (b.material === 'glass') {
          g.fillStyle = 'rgba(90, 200, 215, 0.75)'
          g.fillRect(x0, y0, w, hh)
        } else {
          g.fillStyle = 'rgba(205, 220, 240, 0.95)'
          g.fillRect(x0, y0, w, hh)
        }
      }
    }
    // 梯子
    for (const l of this.level.ladders) {
      const x = this.wx(l.min.x)
      const y = this.wz(l.max.z)
      const w = (l.max.x - l.min.x) * this.scale
      const hh = (l.max.z - l.min.z) * this.scale
      g.fillStyle = 'rgba(255, 220, 120, 0.85)'
      g.fillRect(x, y, Math.max(2, w), Math.max(2, hh))
    }
    // 爆点
    for (const s of this.level.sites) {
      const cx = this.wx(s.center.x)
      const cy = this.wz(s.center.z)
      const r = s.half * this.scale
      g.strokeStyle = 'rgba(255, 210, 87, 0.95)'
      g.lineWidth = 2
      g.strokeRect(cx - r, cy - r, r * 2, r * 2)
      g.fillStyle = 'rgba(255, 210, 87, 0.95)'
      g.font = 'bold 13px monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(s.name, cx, cy)
    }
    // 出生点
    const dot = (x: number, z: number, color: string) => {
      g.fillStyle = color
      g.beginPath()
      g.arc(this.wx(x), this.wz(z), 2, 0, Math.PI * 2)
      g.fill()
    }
    for (const sp of this.level.spawns.T) dot(sp.x, sp.z, 'rgba(255, 157, 92, 0.9)')
    for (const sp of this.level.spawns.CT) dot(sp.x, sp.z, 'rgba(92, 200, 255, 0.9)')
    return c
  }

  update(state: GameState): void {
    const ctx = this.ctx
    const cw = this.canvas.width
    const ch = this.canvas.height
    ctx.clearRect(0, 0, cw, ch)
    ctx.drawImage(this.staticCanvas, 0, 0)
    const me = state.players[0]

    // 本地方向楔（视野锥）：屏幕系方向 = (-sin(yaw), cos(yaw))（世界 x 右、-z 下）
    if (me) {
      const px = this.wx(me.position.x)
      const py = this.wz(me.position.z)
      const dirX = -Math.sin(me.yaw)
      const dirY = Math.cos(me.yaw)
      const ang = Math.atan2(dirY, dirX)
      const len = 130 * this.scale
      const spread = 0.45
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.arc(px, py, len, ang - spread, ang + spread)
      ctx.closePath()
      ctx.fill()
    }

    // C4（被 bot 携带 / 掉落 / 已安放都显示；本地携带则归到本地箭头上）
    const c4 = state.round.c4
    if (state.mode === 'de' && (c4.state === 'dropped' || c4.state === 'planted' || c4.carrierId !== 0)) {
      const cx = this.wx(c4.position.x)
      const cy = this.wz(c4.position.z)
      ctx.fillStyle = c4.state === 'planted' ? '#ff5533' : '#ffaa00'
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // 玩家：本地=白色方向箭头；其余按各自阵营色
    for (const p of state.players) {
      if (!p.alive) continue
      const px = this.wx(p.position.x)
      const py = this.wz(p.position.z)
      if (p.id === 0) {
        const fxs = -Math.sin(p.yaw)
        const fys = Math.cos(p.yaw) // 屏幕 y 分量 = -fz = cos(yaw)
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(Math.atan2(fys, fxs))
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.moveTo(8, 0)
        ctx.lineTo(-5, 4.5)
        ctx.lineTo(-5, -4.5)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else {
        ctx.fillStyle = TEAM_COLORS[p.team as 'T' | 'CT']
        ctx.beginPath()
        ctx.arc(px, py, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
