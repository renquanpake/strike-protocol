import type { GameState } from '../game/state'
import { activeWeapon } from '../game/systems/weapon'

/** 计分板（Tab 按住显示，DOM 表格） */
export class Scoreboard {
  private root: HTMLElement

  constructor(container: HTMLElement, private state: GameState) {
    this.root = document.createElement('div')
    this.root.id = 'scoreboard'
    this.root.style.display = 'none'
    container.appendChild(this.root)
  }

  update(held: boolean): void {
    if (!held) {
      this.root.style.display = 'none'
      return
    }
    const s = this.state
    const r = s.round
    const rows = s.players
      .map((p) => {
        const w = activeWeapon(p)
        const wname = w ? WEAPON_NAMES[w.defId] ?? '' : ''
        return `<tr class="${p.team}">
          <td>${p.name}${p.isBot ? '' : '★'}</td>
          <td>${p.kills}/${p.deaths}</td>
          <td>$${p.money}</td>
          <td>${wname}</td>
          <td>${p.alive ? 'ALIVE' : 'DEAD'}</td>
        </tr>`
      })
      .join('')
    this.root.innerHTML = `
      <div class="sb-head">ROUND ${r.roundNumber} · ${r.phase.toUpperCase()} · T ${r.score.T} : ${r.score.CT} CT</div>
      <table>${rows}</table>`
    this.root.style.display = 'block'
  }
}

const WEAPON_NAMES: Record<string, string> = {
  knife: 'knife',
  glock: 'glock',
  mp9: 'mp9',
  m4: 'm4',
  awp: 'awp',
  xm1014: 'xm1014',
}
