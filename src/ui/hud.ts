import type { GameState } from '../game/state'

export class HUD {
  private statusEl: HTMLElement
  private crosshairEl: HTMLElement
  private hintEl: HTMLElement
  private fpsEl: HTMLElement
  private tickEl: HTMLElement
  private lastTextUpdate = 0

  constructor(root: HTMLElement) {
    this.statusEl = root.querySelector('#status') as HTMLElement
    this.crosshairEl = root.querySelector('#crosshair') as HTMLElement
    this.hintEl = root.querySelector('#lock-hint') as HTMLElement
    this.fpsEl = root.querySelector('#fps') as HTMLElement
    this.tickEl = root.querySelector('#tick') as HTMLElement
  }

  update(state: GameState, fps: number, locked: boolean, nowMs: number): void {
    this.crosshairEl.style.visibility = locked ? 'visible' : 'hidden'
    this.hintEl.style.display = locked ? 'none' : 'block'
    if (nowMs - this.lastTextUpdate < 125) return
    this.lastTextUpdate = nowMs
    const p = state.player
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    this.statusEl.textContent = [
      `TICK ${state.tick}`,
      `POS ${p.position.x.toFixed(0)} / ${p.position.y.toFixed(0)} / ${p.position.z.toFixed(0)}`,
      `SPD ${speed.toFixed(1)} u/s${p.onGround ? '' : ' (AIR)'}`,
      `GND ${p.onGround ? 'Y' : 'N'} · CRH ${p.crouching ? 'Y' : 'N'}`,
    ].join('\n')
    this.fpsEl.textContent = String(fps)
    this.tickEl.textContent = String(state.tick)
  }
}
