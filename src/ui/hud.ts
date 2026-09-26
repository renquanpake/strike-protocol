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
  private hpNum: HTMLElement | null = null
  private apNum: HTMLElement | null = null
  private hpBar: HTMLElement | null = null
  private apBar: HTMLElement | null = null
  private ammoD: HTMLElement | null = null
  private ammoR: HTMLElement | null = null
  private nadeEls: HTMLElement[] = []
  private bigTimer: HTMLElement | null = null
  private lastTextUpdate = 0

  constructor(root: HTMLElement) {
    this.statusEl = root.querySelector('#status') as HTMLElement
    this.crosshairEl = root.querySelector('#crosshair') as HTMLElement
    this.hintEl = root.querySelector('#lock-hint') as HTMLElement
    this.fpsEl = root.querySelector('#fps') as HTMLElement
    this.tickEl = root.querySelector('#tick') as HTMLElement
    this.weaponEl = root.querySelector('#weapon')
    this.roundEl = root.querySelector('#round')
    this.hpNum = root.querySelector('#hpnum')
    this.apNum = root.querySelector('#apnum')
    this.hpBar = root.querySelector('#vitals .vbar.hp i')
    this.apBar = root.querySelector('#vitals .vbar.ap i')
    this.ammoD = root.querySelector('#ammod')
    this.ammoR = root.querySelector('#ammore')
    this.nadeEls = Array.from(root.querySelectorAll('#nades i'))
    this.bigTimer = root.querySelector('#bigtimer')
  }

  update(state: GameState, fps: number, locked: boolean, nowMs: number): void {
    this.crosshairEl.style.visibility = locked ? 'visible' : 'hidden'
    this.hintEl.style.display = locked ? 'none' : 'block'
    const p = state.players[0]

    // CS 风读数：血/甲条 + 弹药 + 投掷物 + 大号计时（每帧驱动，廉价的 textContent 更新）
    if (this.hpNum) {
      const hp = Math.max(0, Math.ceil(p.health))
      this.hpNum.textContent = String(hp)
      this.hpNum.classList.toggle('low', p.health < 30)
      this.hpBar!.style.width = `${(hp / CONFIG.healthMax) * 100}%`
      const ap = p.armor > 0 ? Math.ceil(p.armor) : 0
      this.apNum!.textContent = ap > 0 ? String(ap) : '—'
      this.apBar!.style.width = `${ap}%`
      const w = activeWeapon(p)
      const wdef = w ? WEAPONS[w.defId] : undefined
      this.ammoD!.textContent = w ? String(w.ammoMag) : '—'
      this.ammoR!.textContent = w && wdef && wdef.magazine > 0 ? String(w.ammoReserve) : ''
      const gLabels = ['雷', '闪', '烟', '燃']
      this.nadeEls.forEach((el, i) => {
        const inst = p.weapons.grenades[i]
        el.classList.toggle('empty', !inst)
        el.textContent = inst ? `${gLabels[i] ?? ''}${inst.ammoMag > 1 ? '×' + inst.ammoMag : ''}` : (gLabels[i] ?? '')
      })
      this.updateBigTimer(state)
    }

    if (nowMs - this.lastTextUpdate < 125) return
    this.lastTextUpdate = nowMs
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    const gear = `${p.armor > 0 ? ` AP ${p.armor}` : ''}${p.helmet ? ' [HLM]' : ''}`
    this.statusEl.textContent = [
      `POS ${p.position.x.toFixed(0)} / ${p.position.y.toFixed(0)} / ${p.position.z.toFixed(0)}`,
      `SPD ${speed.toFixed(1)} u/s${p.onGround ? '' : ' (AIR)'}`,
      `HP ${p.health.toFixed(0)} · GND ${p.onGround ? 'Y' : 'N'} · LAD ${p.onLadder ? 'Y' : 'N'}${gear} · SEED ${state.seed}`,
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
  /** 中央大号计时：冻结=BUY 计时 / live=回合剩余 / C4=红色倒计时；其他阶段隐藏 */
  private updateBigTimer(state: GameState): void {
    if (!this.bigTimer) return
    const r = state.round
    let text = ''
    let danger = false
    if (state.mode === 'de') {
      if (r.phase === 'freeze') {
        text = `BUY ${Math.max(0, Math.ceil((r.phaseEndTick - state.tick) / CONFIG.tickRate))}`
      } else if (r.phase === 'live') {
        text = fmtTime(Math.max(0, r.phaseEndTick - state.tick) / CONFIG.tickRate)
      } else if (r.phase === 'bombPlanted') {
        text = fmtTime(Math.max(0, r.c4.explodeAtTick - state.tick) / CONFIG.tickRate)
        danger = true
      }
    }
    this.bigTimer.textContent = text
    this.bigTimer.style.visibility = text ? 'visible' : 'hidden'
    this.bigTimer.classList.toggle('danger', danger)
  }
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : String(s)
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
