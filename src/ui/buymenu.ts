import type { GameState, PlayerEntity } from '../game/state'
import { WEAPONS } from '../game/weapons'
import { canBuyNow, buyItem, GEAR_PRICES } from '../game/economy'
import { inBuyZone, type PreppedLevel } from '../game/physics/collision'
import type { EventBus } from '../engine/eventbus'
import { t } from './strings'

interface BuyItem {
  id: string
  label: string | (() => string)
  price: number
  owned?: (p: PlayerEntity) => boolean
}

const GRENADE_ORDER = ['he', 'flash', 'smoke', 'molotov']

const SECTIONS: { titleKey: string; items: BuyItem[] }[] = [
  {
    titleKey: 'buy.sub',
    items: [
      { id: 'glock', label: 'G-19', price: WEAPONS.glock.price },
      { id: 'deagle', label: '大雕', price: WEAPONS.deagle.price },
      { id: 'usp', label: 'USP-S', price: WEAPONS.usp.price },
      { id: 'p250', label: 'P-250', price: WEAPONS.p250.price },
      { id: 'fiveSeven', label: '5.7', price: WEAPONS.fiveSeven.price },
      { id: 'tec9', label: 'TEC-9', price: WEAPONS.tec9.price },
    ],
  },
  {
    titleKey: 'buy.primary',
    items: [
      { id: 'mp9', label: 'MP-9', price: WEAPONS.mp9.price },
      { id: 'p90', label: 'P-90', price: WEAPONS.p90.price },
      { id: 'ak', label: 'AK-47', price: WEAPONS.ak.price },
      { id: 'm4', label: 'M4', price: WEAPONS.m4.price },
      { id: 'm249', label: 'M-249', price: WEAPONS.m249.price },
      { id: 'awp', label: 'AWP', price: WEAPONS.awp.price },
      { id: 'ssg08', label: 'SSG 08', price: WEAPONS.ssg08.price },
      { id: 'xm1014', label: 'XM-14', price: WEAPONS.xm1014.price },
      { id: 'sawnoff', label: '短管', price: WEAPONS.sawnoff.price },
    ],
  },
  {
    titleKey: 'buy.grenade',
    items: GRENADE_ORDER.map((id) => ({
      id,
      label: { he: '高爆', flash: '闪光', smoke: '烟雾', molotov: '燃烧' }[id] ?? id,
      price: WEAPONS[id].price,
      owned: (p: PlayerEntity) => p.weapons.grenades[GRENADE_ORDER.indexOf(id)] !== null,
    })),
  },
  {
    titleKey: 'buy.gear',
    items: [
      { id: 'kevlar', label: () => t('buy.armor'), price: GEAR_PRICES.kevlar, owned: (p: PlayerEntity) => p.armor >= 100 },
      {
        id: 'kevlarHelmet',
        label: () => t('buy.armorHelmet'),
        price: GEAR_PRICES.kevlarHelmet,
        owned: (p: PlayerEntity) => p.armor >= 100 && p.helmet,
      },
      { id: 'kit', label: () => t('buy.kit'), price: GEAR_PRICES.kit, owned: (p: PlayerEntity) => p.hasKit },
    ],
  },
]

function labelOf(item: BuyItem): string {
  return typeof item.label === 'function' ? item.label() : item.label
}

/** 买枪菜单（B 键开关，分栏 DOM 面板；CS 式买区限制：仅本方出生区可买） */
export class BuyMenu {
  private root: HTMLElement
  private rows = new Map<string, HTMLElement>()
  private sectionHeads: HTMLElement[] = []
  private open = false

  constructor(container: HTMLElement, private state: GameState, private level: PreppedLevel, private events: EventBus) {
    this.root = document.createElement('div')
    this.root.id = 'buymenu'
    this.root.style.display = 'none'
    container.appendChild(this.root)
    this.build()
  }

  private build(): void {
    const money = document.createElement('div')
    money.className = 'money'
    this.root.appendChild(money)
    for (const section of SECTIONS) {
      const head = document.createElement('div')
      head.className = 'bm-section'
      head.textContent = t(section.titleKey)
      this.root.appendChild(head)
      this.sectionHeads.push(head)
      for (const item of section.items) {
        const row = document.createElement('div')
        row.className = 'buy-row'
        row.textContent = `${labelOf(item)}  $${item.price}`
        row.addEventListener('click', () => {
          const p = this.state.players[0]
          if (buyItem(this.state, p, item.id, this.events, this.level)) this.refresh()
        })
        this.root.appendChild(row)
        this.rows.set(item.id, row)
      }
    }
  }

  /** #42 语言切换：刷新分栏标题与装备行标签 */
  applyLang(): void {
    let si = 0
    for (const section of SECTIONS) {
      const head = this.sectionHeads[si++]
      if (head) head.textContent = t(section.titleKey)
      for (const item of section.items) {
        const row = this.rows.get(item.id)
        if (row && !this.open) continue
        if (row) row.textContent = `${labelOf(item)}  $${item.price}`
      }
    }
  }

  private canOpen(): boolean {
    if (!canBuyNow(this.state)) return false
    // CS：买区外按 B 无效（仅 de 模式有买区；其他模式无买区数据则放行）
    const p = this.state.players[0]
    if (this.state.mode === 'de') {
      return inBuyZone(this.level, p.team, p.position.x, p.position.z)
    }
    return true
  }

  toggle(): void {
    if (!this.canOpen()) return
    this.open = !this.open
    this.root.style.display = this.open ? 'block' : 'none'
    if (this.open) this.refresh()
  }

  sync(): void {
    if (this.open && !this.canOpen()) {
      this.open = false
      this.root.style.display = 'none'
    }
  }

  private refresh(): void {
    const p: PlayerEntity = this.state.players[0]
    for (const section of SECTIONS) {
      for (const item of section.items) {
        const row = this.rows.get(item.id)!
        const owned = item.owned ? item.owned(p) : false
        // 阵营限购：CT 无燃烧瓶、T 无拆弹钳
        const locked =
          (item.id === 'molotov' && p.team !== 'T') || (item.id === 'kit' && p.team !== 'CT')
        row.style.opacity = owned || locked || p.money < item.price ? '0.4' : '1'
        row.style.pointerEvents = owned || locked ? 'none' : 'auto'
        row.textContent = `${labelOf(item)}  $${item.price}${owned ? ' · ' + t('buy.owned') : ''}${locked ? ' · ' + t('buy.lockedTeam') : ''}`
      }
    }
    const money = this.root.querySelector('.money')
    if (money) money.textContent = `$${p.money}`
  }
}
