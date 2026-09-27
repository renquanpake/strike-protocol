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
  /** 槽位快捷键（1/2/3/4-7） */
  hotkey?: string
  owned?: (p: PlayerEntity) => boolean
  /** 剪影 key（对应 SILHOUETTES） */
  sil?: string
}

const GRENADE_ORDER = ['he', 'flash', 'smoke', 'molotov']
const GRENADE_LABEL: Record<string, string> = { he: '高爆', flash: '闪光', smoke: '烟雾', molotov: '燃烧' }
const GRENADE_KEY: Record<string, string> = { he: '4', flash: '5', smoke: '6', molotov: '7' }

/** V5：按 CS:GO 分区（手枪/冲锋枪/步枪/狙击/重型/投掷物/装备） */
const SECTIONS: { titleKey: string; items: BuyItem[] }[] = [
  {
    titleKey: 'buy.sub',
    items: [
      { id: 'glock', label: 'G-19', price: WEAPONS.glock.price, hotkey: '2', sil: 'pistol' },
      { id: 'deagle', label: '大雕', price: WEAPONS.deagle.price, hotkey: '2', sil: 'pistol_heavy' },
      { id: 'usp', label: 'USP-S', price: WEAPONS.usp.price, hotkey: '2', sil: 'pistol' },
      { id: 'p250', label: 'P-250', price: WEAPONS.p250.price, hotkey: '2', sil: 'pistol' },
      { id: 'fiveSeven', label: '5.7', price: WEAPONS.fiveSeven.price, hotkey: '2', sil: 'pistol' },
      { id: 'tec9', label: 'TEC-9', price: WEAPONS.tec9.price, hotkey: '2', sil: 'pistol' },
    ],
  },
  {
    titleKey: 'buy.smg',
    items: [
      { id: 'mp9', label: 'MP-9', price: WEAPONS.mp9.price, hotkey: '1', sil: 'smg' },
      { id: 'p90', label: 'P-90', price: WEAPONS.p90.price, hotkey: '1', sil: 'smg_p90' },
    ],
  },
  {
    titleKey: 'buy.rifle',
    items: [
      { id: 'ak', label: 'AK-47', price: WEAPONS.ak.price, hotkey: '1', sil: 'ak' },
      { id: 'm4', label: 'M4', price: WEAPONS.m4.price, hotkey: '1', sil: 'rifle' },
      { id: 'm249', label: 'M-249', price: WEAPONS.m249.price, hotkey: '1', sil: 'lmg' },
    ],
  },
  {
    titleKey: 'buy.sniper',
    items: [
      { id: 'ssg08', label: 'SSG 08', price: WEAPONS.ssg08.price, hotkey: '1', sil: 'sniper' },
      { id: 'awp', label: 'AWP', price: WEAPONS.awp.price, hotkey: '1', sil: 'sniper_heavy' },
    ],
  },
  {
    titleKey: 'buy.heavy',
    items: [
      { id: 'xm1014', label: 'XM-14', price: WEAPONS.xm1014.price, hotkey: '1', sil: 'shotgun' },
      { id: 'sawnoff', label: '短管', price: WEAPONS.sawnoff.price, hotkey: '1', sil: 'shotgun_short' },
    ],
  },
  {
    titleKey: 'buy.grenade',
    items: GRENADE_ORDER.map((id) => ({
      id,
      label: GRENADE_LABEL[id] ?? id,
      price: WEAPONS[id].price,
      hotkey: GRENADE_KEY[id],
      sil: 'grenade',
      owned: (p: PlayerEntity) => p.weapons.grenades[GRENADE_ORDER.indexOf(id)] !== null,
    })),
  },
  {
    titleKey: 'buy.gear',
    items: [
      { id: 'kevlar', label: () => t('buy.armor'), price: GEAR_PRICES.kevlar, sil: 'armor', owned: (p) => p.armor >= 100 },
      {
        id: 'kevlarHelmet',
        label: () => t('buy.armorHelmet'),
        price: GEAR_PRICES.kevlarHelmet,
        sil: 'armor',
        owned: (p) => p.armor >= 100 && p.helmet,
      },
      { id: 'kit', label: () => t('buy.kit'), price: GEAR_PRICES.kit, sil: 'kit', owned: (p) => p.hasKit },
    ],
  },
]

/** V5 武器矢量剪影（手绘 SVG，currentColor 填充，网格卡片内显示） */
const SILHOUETTES: Record<string, string> = {
  // 手枪：套筒 + 握把
  pistol: '<path d="M3 8h26v5h-4l-2 8h-6l2-8H3z"/><rect x="3" y="8" width="28" height="2" rx="1" fill="#000" opacity=".35"/>',
  pistol_heavy: '<path d="M3 7h28v6h-5l-2 9h-7l2-9H3z"/><rect x="2" y="6" width="10" height="3" rx="1"/>',
  // 冲锋枪：短粗机匣 + 直弹匣
  smg: '<path d="M2 10h22v5h-5v6h-5l2-6H2z"/><rect x="24" y="11" width="8" height="3"/><rect x="9" y="15" width="4" height="7"/>',
  smg_p90: '<path d="M2 9h24v7H9l2 6H6l-2-6H2z"/><rect x="26" y="10" width="7" height="3"/><rect x="12" y="8" width="3" height="4"/>',
  // 步枪（M4）：机匣 + 长枪管 + 直弹匣 + 枪托
  rifle: '<path d="M1 11h34v4h-6l-1 5h-4l1-5h-7l2 5h-5l-2-5H1z"/><rect x="35" y="12" width="8" height="2"/><rect x="18" y="15" width="4" height="8"/><rect x="0" y="10" width="4" height="7"/>',
  // AK：步枪 + 弯弹匣
  ak: '<path d="M1 11h34v4h-6l-1 5h-4l1-5h-7l2 5h-5l-2-5H1z"/><rect x="35" y="12" width="8" height="2"/><path d="M18 15h4c3 2 3 7 1 10l-3-1c1-3 0-6-2-9z"/><rect x="0" y="10" width="4" height="7"/>',
  // 狙击：长枪管 + 瞄准镜
  sniper: '<path d="M1 12h38v3h-36z"/><rect x="39" y="12" width="5" height="3"/><rect x="16" y="7" width="12" height="4" rx="2"/><rect x="14" y="6" width="2" height="6"/><rect x="28" y="6" width="2" height="6"/><rect x="0" y="11" width="3" height="8"/>',
  sniper_heavy: '<path d="M0 12h40v4H6l-2 6H2l2-6H0z"/><rect x="40" y="12" width="6" height="4"/><rect x="14" y="6" width="16" height="4" rx="2"/><rect x="12" y="5" width="2" height="7"/><rect x="30" y="5" width="2" height="7"/>',
  // 霰弹枪：双管 + 泵
  shotgun: '<path d="M2 11h32v3H8l-2 5H4l2-5H2z"/><rect x="33" y="11" width="4" height="3"/><rect x="14" y="14" width="9" height="4" rx="2"/>',
  shotgun_short: '<path d="M4 11h22v3H8l-2 5H4l2-5H4z"/><rect x="25" y="11" width="5" height="3"/><rect x="12" y="14" width="7" height="4" rx="2"/>',
  // 投掷物：弹体 + 引信
  grenade: '<circle cx="20" cy="16" r="8"/><rect x="17" y="4" width="6" height="5" rx="1"/><rect x="23" y="5" width="7" height="2" transform="rotate(20 23 5)"/>',
  // 防弹衣
  armor: '<path d="M12 5h16l4 6v12a2 2 0 01-2 2h-4v-6a3 3 0 00-6 0v6h-6v-6a3 3 0 00-6 0v6H8a2 2 0 01-2-2V11z"/><rect x="14" y="9" width="12" height="3" opacity=".5"/>',
  // 拆弹钳
  kit: '<rect x="14" y="4" width="12" height="18" rx="2"/><rect x="17" y="8" width="6" height="4" opacity=".5"/><rect x="18" y="15" width="4" height="3"/>',
}

function labelOf(item: BuyItem): string {
  return typeof item.label === 'function' ? item.label() : item.label
}

function silSvg(key: string | undefined, cls = ''): string {
  if (!key || !SILHOUETTES[key]) return ''
  return `<svg class="bm-sil ${cls}" viewBox="0 0 40 24" width="46" height="28" aria-hidden="true" fill="currentColor">${SILHOUETTES[key]}</svg>`
}

/** 买枪菜单（B 键开关；V5 网格 + 剪影 + 快捷键；CS 式买区限制：仅本方出生区可买） */
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
    money.className = 'bm-money'
    this.root.appendChild(money)
    for (const section of SECTIONS) {
      const head = document.createElement('div')
      head.className = 'bm-section'
      head.textContent = t(section.titleKey)
      this.root.appendChild(head)
      this.sectionHeads.push(head)
      const grid = document.createElement('div')
      grid.className = 'bm-grid'
      for (const item of section.items) {
        const cell = document.createElement('div')
        cell.className = 'bm-item'
        cell.innerHTML = `${silSvg(item.sil)}
          <div class="bm-name">${labelOf(item)}${item.hotkey ? `<i class="bm-key">${item.hotkey}</i>` : ''}</div>
          <div class="bm-price">$${item.price}</div>
          <div class="bm-state"></div>`
        cell.addEventListener('click', () => {
          const p = this.state.players[0]
          if (buyItem(this.state, p, item.id, this.events, this.level)) this.refresh()
        })
        grid.appendChild(cell)
        this.rows.set(item.id, cell)
      }
      this.root.appendChild(grid)
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
        if (!row) continue
        const nm = row.querySelector('.bm-name') as HTMLElement | null
        if (nm) {
          const key = nm.querySelector('.bm-key')
          nm.textContent = labelOf(item)
          if (key) nm.appendChild(key)
        }
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
        const locked = (item.id === 'molotov' && p.team !== 'T') || (item.id === 'kit' && p.team !== 'CT')
        row.style.opacity = owned || locked || p.money < item.price ? '0.4' : '1'
        row.style.pointerEvents = owned || locked ? 'none' : 'auto'
        const st = row.querySelector('.bm-state') as HTMLElement
        if (st) st.textContent = owned ? t('buy.owned') : locked ? t('buy.lockedTeam') : ''
      }
    }
    const money = this.root.querySelector('.bm-money')
    if (money) money.textContent = `$${p.money}`
  }
}
