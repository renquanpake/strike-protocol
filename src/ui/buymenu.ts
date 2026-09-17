import type { GameState, PlayerEntity } from '../game/state'
import { WEAPONS } from '../game/weapons'
import { canBuyNow, buyItem, GEAR_PRICES } from '../game/economy'
import type { EventBus } from '../engine/eventbus'

const BUYABLE: { id: string; label: string }[] = [
  { id: 'glock', label: 'G-19 手枪' },
  { id: 'mp9', label: 'MP-9 冲锋枪' },
  { id: 'm4', label: 'M4 步枪' },
  { id: 'awp', label: 'AWP 狙击枪' },
  { id: 'xm1014', label: 'XM-14 霰弹枪' },
  { id: 'kit', label: '拆弹钳' },
]

/** 买枪菜单（B 键开关，DOM 面板） */
export class BuyMenu {
  private root: HTMLElement
  private rows: Map<string, HTMLElement> = new Map()
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
    money.textContent = ''
    this.root.appendChild(money)
    for (const item of BUYABLE) {
      const row = document.createElement('div')
      row.className = 'buy-row'
      const price = item.id === 'kit' ? GEAR_PRICES.kit : WEAPONS[item.id].price
      row.textContent = `${item.label}  $${price}`
      row.addEventListener('click', () => {
        const p = this.state.players[0]
        if (buyItem(this.state, p, item.id, this.events)) {
          this.refresh()
        }
      })
      this.root.appendChild(row)
      this.rows.set(item.id, row)
    }
  }

  toggle(): void {
    if (!canBuyNow(this.state)) return
    this.open = !this.open
    this.root.style.display = this.open ? 'block' : 'none'
    if (this.open) this.refresh()
  }

  /** 离开购买窗口自动关闭 */
  sync(): void {
    if (this.open && !canBuyNow(this.state)) {
      this.open = false
      this.root.style.display = 'none'
    }
  }

  private refresh(): void {
    const p: PlayerEntity = this.state.players[0]
    for (const item of BUYABLE) {
      const row = this.rows.get(item.id)!
      const price = item.id === 'kit' ? GEAR_PRICES.kit : WEAPONS[item.id].price
      const owned = item.id === 'kit' && p.hasKit
      row.style.opacity = owned || p.money < price ? '0.4' : '1'
      row.style.pointerEvents = owned ? 'none' : 'auto'
    }
    const money = this.root.querySelector('.money')
    if (money) money.textContent = `$${p.money}`
  }
}
