import { CONFIG } from '../game/config'
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
  private roundEl: HTMLElement | null = null
  private lastTextUpdate = 0

  constructor(root: HTMLElement) {
    this.statusEl = root.querySelector('#status') as HTMLElement
    this.crosshairEl = root.querySelector('#crosshair') as HTMLElement
    this.hintEl = root.querySelector('#lock-hint') as HTMLElement
    this.fpsEl = root.querySelector('#fps') as HTMLElement
    this.tickEl = root.querySelector('#tick') as HTMLElement
    this.weaponEl = root.querySelector('#weapon')
    this.roundEl = root.querySelector('#round')
  }

  update(state: GameState, fps: number, locked: boolean, nowMs: number): void {
    this.crosshairEl.style.visibility = locked ? 'visible' : 'hidden'
    this.hintEl.style.display = locked ? 'none' : 'block'
    if (nowMs - this.lastTextUpdate < 125) return
    this.lastTextUpdate = nowMs
    const p = state.players[0]
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    const gear = `${p.armor > 0 ? ` AP ${p.armor}` : ''}${p.helmet ? ' [HLM]' : ''}`
    this.statusEl.textContent = [
      `POS ${p.position.x.toFixed(0)} / ${p.position.y.toFixed(0)} / ${p.position.z.toFixed(0)}`,
      `SPD ${speed.toFixed(1)} u/s${p.onGround ? '' : ' (AIR)'}`,
      `HP ${p.health.toFixed(0)} · GND ${p.onGround ? 'Y' : 'N'} · LAD ${p.onLadder ? 'Y' : 'N'}${gear}`,
      state.targets.map((t) => `T${t.id} ${t.alive ? t.health.toFixed(0) : '---'}`).join('  '),
    ].join('\n')
    if (this.weaponEl) {
      const w = activeWeapon(p)
      if (w) {
        const def = WEAPONS[w.defId]
        const slots = ['主', '副', '刀']
        if (p.activeSlot >= 3) {
          const gLabels = ['HE', '闪光', '烟雾', '燃烧']
          this.weaponEl.textContent = `投掷 ${gLabels[p.activeSlot - 3] ?? ''} ${def.name} ×${w.ammoMag}`
        } else {
          this.weaponEl.textContent = def.category === 'knife'
            ? `${slots[p.activeSlot]} ${def.name}`
            : `${slots[p.activeSlot]} ${def.name}  ${w.ammoMag}/${w.ammoReserve}${w.reloadUntilTick > 0 ? ' · 换弹中…' : ''}`
        }
      }
    }
    if (this.roundEl) {
      this.roundEl.textContent = roundLine(state)
    }
    this.fpsEl.textContent = String(fps)
    this.tickEl.textContent = String(state.tick)
  }
}

export function roundLine(state: GameState): string {
  const r = state.round
  const p = state.players[0]
  // #36 死斗/团队死斗：显示击杀目标进度
  if (state.mode === 'dm') {
    return `死斗 · 个人 ${p.kills}/${CONFIG.dmKillTarget}`
  }
  if (state.mode === 'tdm') {
    const t = state.players.filter((x) => x.team === 'T').reduce((a, x) => a + x.kills, 0)
    const ct = state.players.filter((x) => x.team === 'CT').reduce((a, x) => a + x.kills, 0)
    return `团队死斗 · T ${t}/${CONFIG.tdmKillTarget} : ${ct}/${CONFIG.tdmKillTarget} CT`
  }
  let timer = ''
  if (r.phase === 'freeze') timer = `BUY ${(Math.max(0, r.phaseEndTick - state.tick) / CONFIG.tickRate).toFixed(1)}s`
  else if (r.phase === 'live') timer = `${(Math.max(0, r.phaseEndTick - state.tick) / CONFIG.tickRate).toFixed(0)}s`
  else if (r.phase === 'bombPlanted') {
    const left = Math.max(0, r.c4.explodeAtTick - state.tick) / CONFIG.tickRate
    timer = `C4 ${r.c4.site} ${left.toFixed(0)}s`
  } else if (r.phase === 'warmup') timer = 'WARMUP'
  else if (r.phase === 'roundEnd') timer = 'ROUND OVER'
  else if (r.phase === 'halftime') timer = 'HALFTIME'
  else if (r.phase === 'matchEnd') timer = 'MATCH OVER'

  let c4line = ''
  const c4 = r.c4
  if (c4.state === 'carried' && c4.carrierId === p.id) c4line = ' · C4:携带'
  if (c4.state === 'dropped') c4line = ' · C4:掉落'
  if (c4.state === 'planted') c4line = ` · C4:已安放${c4.defuseProgress > 0 ? ` 拆 ${(c4.defuseProgress * 100).toFixed(0)}%` : ''}`
  const ot = r.overtime > 0 ? ` OT${r.overtime}` : ''
  return `R${r.roundNumber} ${r.phase.toUpperCase()}${ot} ${timer} · T ${r.score.T}:${r.score.CT} CT · $${p.money}${c4line}`
}
