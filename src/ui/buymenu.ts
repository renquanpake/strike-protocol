import type { GameState, PlayerEntity } from '../game/state'
import { WEAPONS } from '../game/weapons'
import { canBuyNow, buyItem, GEAR_PRICES } from '../game/economy'
import type { EventBus } from '../engine/eventbus'

interface BuyItem {
  id: string
  label: string
  price: number
  owned?: (p: PlayerEntity) => boolean
}

const GRENADE_ORDER = ['he', 'flash', 'smoke', 'molotov']

const SECTIONS: { title: string; items: BuyItem[] }[] = [
  {
    title: '副武器',
    items: [
      { id: 'glock', label: 'G-19', price: WEAPONS.glock.price },
      { id: 'deagle', label: '大雕', price: WEAPONS.deagle.price },
    ],
  },
  {
    title: '主武器',
    items: [
      { id: 'mp9', label: 'MP-9', price: WEAPONS.mp9.price },
      { id: 'p90', label: 'P-90', price: WEAPONS.p90.price },
      { id: 'm4', label: 'M4', price: WEAPONS.m4.price },
      { id: 'm249', label: 'M-249', price: WEAPONS.m249.price },
      { id: 'awp', label: 'AWP', price: WEAPONS.awp.price },
      { id: 'ssg08', label: 'SSG 08', price: WEAPONS.ssg08.price },
      { id: 'xm1014', label: 'XM-14', price: WEAPONS.xm1014.price },
      { id: 'sawnoff', label: '短管', price: WEAPONS.sawnoff.price },
    ],
  },
  {
    title: '投掷物',
    items: GRENADE_ORDER.map((id) => ({
      id,
      label: { he: '高爆', flash: '闪光', smoke: '烟雾', molotov: '燃烧' }[id] ?? id,
      price: WEAPONS[id].price,
      owned: (p: PlayerEntity) => p.weapons.grenades[GRENADE_ORDER.indexOf(id)] !== null,
    })),
  },
  {
    title: '装备',
    items: [{ id: 'kit', label: '拆弹钳', price: GEAR_PRICES.kit, owned: (p: PlayerEntity) => p.hasKit }],
  },
]

/** 买枪菜单（B 键开关，分栏 DOM 面板） */
export class BuyMenu {
  private root: HTMLElement
  private rows = new Map<string, HTMLElement>()
  private open = false

  constructor(container: HTMLElement, private state: GameState, private events: EventBus) {
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
      head.textContent = section.title
      this.root.appendChild(head)
      for (const item of section.items) {
        const row = document.createElement('div')
        row.className = 'buy-row'
        row.textContent = `${item.label}  $${item.price}`
        row.addEventListener('click', () => {
          const p = this.state.players[0]
          if (buyItem(this.state, p, item.id, this.events)) this.refresh()
        })
        this.root.appendChild(row)
        this.rows.set(item.id, row)
      }
    }
  }

  toggle(): void {
    if (!canBuyNow(this.state)) return
    this.open = !this.open
    this.root.style.display = this.open ? 'block' : 'none'
    if (this.open) this.refresh()
  }

  sync(): void {
    if (this.open && !canBuyNow(this.state)) {
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
        row.style.opacity = owned || p.money < item.price ? '0.4' : '1'
        row.style.pointerEvents = owned ? 'none' : 'auto'
        row.textContent = `${item.label}  $${item.price}${owned ? ' · 已持有' : ''}`
      }
    }
    const money = this.root.querySelector('.money')
    if (money) money.textContent = `$${p.money}`
  }
}
