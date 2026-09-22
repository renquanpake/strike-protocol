/**
 * #5 击杀播报 / #9 动态准星 / #10 受击方向 / #14 击杀奖励 / #23 无线电 / #41 成就 toast / #15 观战标签。
 * 全部为 DOM 面板（不重排），消费事件 + 逐帧驱动。
 */
import { WEAPONS } from '../game/weapons'
import { activeWeapon, spreadDegrees } from '../game/systems/weapon'
import type { PlayerEntity } from '../game/state'

const TEAM_CLASS: Record<string, string> = { T: 't', CT: 'ct' }

export class Feedback {
  private crosshair: HTMLElement
  private scope: HTMLElement
  private dmgdir: HTMLElement
  private dmgArcs: SVGPathElement[]
  private killfeed: HTMLElement
  private killreward: HTMLElement
  private radio: HTMLElement
  private toasts: HTMLElement
  private spectate: HTMLElement
  private radar: HTMLCanvasElement

  constructor(container: HTMLElement, radar: HTMLCanvasElement) {
    this.crosshair = container.querySelector('#crosshair') as HTMLElement
    this.scope = container.querySelector('#scope') as HTMLElement
    this.dmgdir = container.querySelector('#dmgdir') as HTMLElement
    this.dmgArcs = [
      document.getElementById('dmgdir-a') as unknown as SVGPathElement,
      document.getElementById('dmgdir-b') as unknown as SVGPathElement,
    ]
    this.killfeed = container.querySelector('#killfeed') as HTMLElement
    this.killreward = container.querySelector('#killreward') as HTMLElement
    this.radio = container.querySelector('#radio') as HTMLElement
    this.toasts = container.querySelector('#toasts') as HTMLElement
    this.spectate = container.querySelector('#spectate') as HTMLElement
    this.radar = radar
  }

  // ===== #9 动态准星：间距 = 基准 + 散布锥角 × 换算系数 =====
  updateCrosshair(p: PlayerEntity, gapPerDeg: number, aiming: boolean): void {
    if (aiming) {
      this.crosshair.style.display = 'none'
      return
    }
    this.crosshair.style.display = ''
    const def = WEAPONS[activeWeapon(p)?.defId ?? 'knife']
    const deg = spreadDegrees(p, def, aiming)
    const gap = 6 + deg * gapPerDeg
    this.crosshair.style.setProperty('--gap', `${gap}px`)
  }

  /** #3/#42：应用准星样式（cross/dot/circle + 颜色 + 间距倍率） */
  applyCrosshairSettings(style: string, color: string, gapScale: number): void {
    this.crosshair.setAttribute('data-style', style)
    this.crosshair.style.setProperty('--color', color)
    this.crosshair.style.setProperty('--gapScale', String(gapScale))
  }

  // ===== #8 开镜 overlay =====
  setScope(visible: boolean, mag: number): void {
    this.scope.style.display = visible ? 'block' : 'none'
    if (visible) this.scope.setAttribute('data-mag', String(mag))
  }

  // ===== #10 受击方向指示 =====
  /** relRad: 攻击者相对本地玩家的方位角（0=正前），arcIdx 0/1 交替 */
  showDmgDir(relRad: number): void {
    const s = this as unknown as { _dmgIdx?: number }
    const idx = s._dmgIdx ?? 0
    s._dmgIdx = 1 - idx
    const arc = this.dmgArcs[idx]
    if (!arc) return
    const deg = (relRad * 180) / Math.PI
    arc.setAttribute('transform', `rotate(${deg} 70 70)`)
    arc.style.transition = 'none'
    arc.style.opacity = '1'
    this.dmgdir.style.transition = 'none'
    this.dmgdir.style.opacity = '1'
    requestAnimationFrame(() => {
      arc.style.transition = 'opacity 0.5s ease-out'
      this.dmgdir.style.transition = 'opacity 0.5s ease-out'
      requestAnimationFrame(() => {
        arc.style.opacity = '0'
        this.dmgdir.style.opacity = '0'
      })
    })
  }

  // ===== #5 击杀播报 =====
  addKill(attacker: PlayerEntity, victim: PlayerEntity, weaponId: string, headshot: boolean): void {
    const div = document.createElement('div')
    div.className = 'kf'
    const aCls = TEAM_CLASS[attacker.team] ?? 't'
    const vCls = TEAM_CLASS[victim.team] ?? 't'
    const wname = WEAPONS[weaponId]?.name ?? weaponId
    const hsTag = headshot ? '<span class="hs">[HS]</span> ' : ''
    div.innerHTML = `${hsTag}<span class="${aCls}">${escapeHtml(attacker.name)}</span> ─ ${wname} ─ <span class="${vCls}">${escapeHtml(victim.name)}</span>`
    this.killfeed.appendChild(div)
    while (this.killfeed.children.length > 6) this.killfeed.removeChild(this.killfeed.firstChild as Node)
    setTimeout(() => div.remove(), 4500)
  }

  // ===== #14 击杀奖励浮动 =====
  showKillReward(amount: number, headshot: boolean): void {
    this.killreward.innerHTML = headshot
      ? `<span class="hs">[HS]</span> +$${amount}`
      : `+$${amount}`
    this.killreward.style.opacity = '1'
    clearTimeout((this as unknown as { _krT?: number })._krT)
    ;(this as unknown as { _krT?: number })._krT = setTimeout(() => {
      this.killreward.style.opacity = '0'
    }, 900)
  }

  // ===== #23 无线电 =====
  addRadio(team: 'T' | 'CT', key: string, name: string): void {
    const div = document.createElement('div')
    div.className = `rq team-${team}`
    const text: Record<string, string> = {
      bombPlanted: `${name}: 已下包！`,
      bombDefused: `${name}: 拆掉了`,
      enemySpotted: `${name}: 看到敌人了`,
      needBackup: `${name}: 需要支援`,
      flashOut: `${name}: 闪光来了`,
      niceShot: `${name}: 漂亮击杀`,
    }
    div.textContent = text[key] ?? `${name}: …`
    this.radio.appendChild(div)
    while (this.radio.children.length > 3) this.radio.removeChild(this.radio.firstChild as Node)
    setTimeout(() => div.remove(), 3000)
  }

  // ===== #41 成就 / 系统 toast =====
  toast(msg: string): void {
    const div = document.createElement('div')
    div.className = 'toast'
    div.textContent = msg
    this.toasts.appendChild(div)
    setTimeout(() => div.remove(), 3200)
  }

  // ===== #15 观战标签 =====
  showSpectate(name: string | null): void {
    this.spectate.style.display = name ? 'block' : 'none'
    if (name) this.spectate.textContent = `观战中：${name}（点击切换目标）`
  }

  /** #6 小地图开关键 */
  setMinimapVisible(v: boolean): void {
    this.radar.style.display = v ? 'block' : 'none'
  }

  /** 清空（对局切换时） */
  clear(): void {
    this.killfeed.innerHTML = ''
    this.radio.innerHTML = ''
    this.toasts.innerHTML = ''
    this.killreward.style.opacity = '0'
    this.spectate.style.display = 'none'
    this.scope.style.display = 'none'
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
