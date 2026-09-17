import type { GameState } from '../game/state'
import { WEAPONS } from '../game/weapons'
import { activeWeapon } from '../game/systems/weapon'

export class HUD {
  private statusEl: HTMLElement
  private crosshairEl: HTMLElement
  private hintEl: HTMLElement
  private fpsEl: HTMLElement
  private tickEl: HTMLElement
  private weaponEl: HTMLElement | null = null
  private lastTextUpdate = 0

  constructor(root: HTMLElement) {
    this.statusEl = root.querySelector('#status') as HTMLElement
    this.crosshairEl = root.querySelector('#crosshair') as HTMLElement
    this.hintEl = root.querySelector('#lock-hint') as HTMLElement
    this.fpsEl = root.querySelector('#fps') as HTMLElement
    this.tickEl = root.querySelector('#tick') as HTMLElement
    this.weaponEl = root.querySelector('#weapon')
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
      `HP ${p.health.toFixed(0)} · GND ${p.onGround ? 'Y' : 'N'} · LAD ${p.onLadder ? 'Y' : 'N'}`,
      state.targets.map((t) => `T${t.id} ${t.alive ? t.health.toFixed(0) : '---'}`).join('  '),
    ].join('\n')
    if (this.weaponEl) {
      const w = activeWeapon(state)
      if (w) {
        const def = WEAPONS[w.defId]
        const slots = ['主', '副', '刀']
        this.weaponEl.textContent = def.category === 'knife'
          ? `${slots[p.activeSlot]} ${def.name}`
          : `${slots[p.activeSlot]} ${def.name}  ${w.ammoMag}/${w.ammoReserve}${w.reloadUntilTick > 0 ? ' · 换弹中…' : ''}`
      }
    }
    this.fpsEl.textContent = String(fps)
    this.tickEl.textContent = String(state.tick)
  }
}
