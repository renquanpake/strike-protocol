import type { GameState } from '../game/state'
import type { PreppedLevel } from '../game/physics/collision'

/** 雷达：俯视小地图（Canvas 2D），北朝上（-Z 在上） */
export class Radar {
  private ctx: CanvasRenderingContext2D
  private scale: number

  constructor(private canvas: HTMLCanvasElement, private level: PreppedLevel) {
    this.ctx = canvas.getContext('2d')!
    const range = 1200 // 覆盖 ±600
    this.scale = canvas.width / range
  }

  private toRadar(x: number, z: number): [number, number] {
    return [
      this.canvas.width / 2 + x * this.scale,
      this.canvas.height / 2 - z * this.scale,
    ]
  }

  update(state: GameState): void {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(8, 12, 16, 0.55)'
    ctx.fillRect(0, 0, w, h)

    // bombsites
    for (const s of this.level.sites) {
      const [sx, sy] = this.toRadar(s.center.x, s.center.z)
      const r = s.half * this.scale
      ctx.strokeStyle = 'rgba(255, 210, 87, 0.8)'
      ctx.lineWidth = 1
      ctx.strokeRect(sx - r, sy - r, r * 2, r * 2)
      ctx.fillStyle = 'rgba(255, 210, 87, 0.9)'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(s.name, sx, sy + 3)
    }

    // C4
    const c4 = state.round.c4
    if (c4.state === 'carried' || c4.state === 'dropped' || c4.state === 'planted') {
      const [cx, cy] = this.toRadar(c4.position.x, c4.position.z)
      ctx.fillStyle = c4.state === 'planted' ? '#ff5533' : '#ffaa00'
      ctx.fillRect(cx - 2, cy - 2, 4, 4)
    }

    // 玩家
    for (const p of state.players) {
      if (!p.alive) continue
      const [px, py] = this.toRadar(p.position.x, p.position.z)
      if (p.id === 0) {
        ctx.fillStyle = '#ffffff'
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(p.yaw)
        ctx.beginPath()
        ctx.moveTo(0, -5)
        ctx.lineTo(3, 3)
        ctx.lineTo(-3, 3)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else {
        ctx.fillStyle = p.team === 'T' ? '#6fe07f' : '#ff6f6f'
        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
