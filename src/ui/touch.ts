import type { InputFrame } from '../engine/input'
import type { InputController } from '../engine/input'
import { emptyInput } from '../engine/input'
import { loadSettings, saveSettings, type Settings } from './settings'

/**
 * 移动端触控层：左半屏虚拟摇杆（移动）+ 右半屏拖拽（视角）+ 按钮组（开火/跳/蹲/换弹/E/买/丢/切枪/投掷物/开镜/暂停）。
 * 布局对标主流手机 FPS（CODM/和平精英式：左摇杆右拖拽 + 右侧动作键）。
 * 复用 base InputController（键盘若有外接仍生效），poll() 输出合并后的 InputFrame，
 * 开火/开镜不受指针锁门控（触屏按钮自身即"按住"状态）。
 */

const JOY_RATIO = 0.45 // 左 45% = 摇杆区，其余 = 视角/按钮区
const JOY_RADIUS = 48 // 摇杆行程半径（px）
const BUTTONS: {
  key: string
  label: string
  /** 按住型（fire/aim/crouch/use/jumpHeld）；否则为边沿（jump/reload/buy/drop/switchSlot） */
  held?: boolean
  slot?: number
  cls: string
  title?: string
}[] = [
  { key: 'fire', label: '开火', held: true, cls: 'tb-fire' },
  { key: 'aim', label: '镜', held: true, cls: 'tb-aim', title: '开镜' },
  { key: 'jump', label: '跳', held: true, cls: 'tb-jump' },
  { key: 'crouch', label: '蹲', held: true, cls: 'tb-crouch' },
  { key: 'reload', label: '弹', cls: 'tb-reload', title: '换弹' },
  { key: 'use', label: 'E', held: true, cls: 'tb-use', title: '安放/拆除 C4' },
  { key: 'buy', label: '买', cls: 'tb-buy' },
  { key: 'drop', label: '丢', cls: 'tb-drop' },
  { key: 's0', label: '主', slot: 0, cls: 'tb-slot' },
  { key: 's1', label: '副', slot: 1, cls: 'tb-slot' },
  { key: 's2', label: '刀', slot: 2, cls: 'tb-slot' },
  { key: 's3', label: '雷', slot: 3, cls: 'tb-grenade', title: '高爆' },
  { key: 's4', label: '闪', slot: 4, cls: 'tb-grenade', title: '闪光' },
  { key: 's5', label: '烟', slot: 5, cls: 'tb-grenade', title: '烟雾' },
  { key: 's6', label: '燃', slot: 6, cls: 'tb-grenade', title: '燃烧' },
]

const CSS = `
#touch { position: fixed; inset: 0; z-index: 45; pointer-events: none; display: none; }
#touch.on { display: block; }
#touch-capture { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
#touch .tb-btn {
  position: absolute; pointer-events: auto; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: #e8eef6; font-family: 'Courier New', monospace;
  background: rgba(10, 14, 18, 0.42); border: 1.5px solid rgba(140, 200, 255, 0.35);
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
#touch .tb-btn.on { background: rgba(255, 210, 87, 0.5); border-color: rgba(255, 210, 87, 0.9); }
/* 定位/尺寸由 TOUCH_LAYOUT 单源驱动（JS 施加，保证零重叠可单测，B-R1.1/1.2） */
.tb-fire { font-size: 18px; font-weight: 700;
  background: rgba(208, 52, 44, 0.4); border-color: rgba(255, 120, 90, 0.7); }
.tb-aim { font-size: 16px; }
.tb-jump { font-size: 13px; }
.tb-crouch { font-size: 13px; }
.tb-reload { font-size: 13px; }
.tb-use { font-size: 13px; }
.tb-buy { font-size: 13px; }
.tb-drop { font-size: 13px; }
.tb-slot { font-size: 13px; }
.tb-grenade { font-size: 12px; }
.tb-pause { position: absolute; pointer-events: auto; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: rgba(10, 14, 18, 0.5); border: 1.5px solid rgba(140, 200, 255, 0.4);
  color: #e8eef6; font-size: 20px; -webkit-tap-highlight-color: transparent; }
#joy-base { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px;
  border-radius: 50%; background: rgba(255, 255, 255, 0.08); border: 1.5px solid rgba(140, 200, 255, 0.4);
  pointer-events: none; display: none; }
#joy-thumb { position: absolute; width: 52px; height: 52px; margin: -26px 0 0 -26px;
  border-radius: 50%; background: rgba(255, 210, 87, 0.7); border: 2px solid rgba(255, 210, 87, 0.9);
  pointer-events: none; display: none; }
#touch-rotate { position: absolute; inset: 0; display: none; z-index: 60;
  flex-direction: column; align-items: center; justify-content: center;
  background: rgba(5, 8, 12, 0.92); color: #dfe8f0; font-size: 18px; text-align: center;
  pointer-events: auto; }
#touch.on.rot #touch-rotate { display: flex; }
#touch-rotate button { margin-top: 18px; background: rgba(140, 200, 255, 0.15); color: #ffd257;
  border: 1px solid rgba(140, 200, 255, 0.5); border-radius: 6px; padding: 10px 22px;
  font-size: 14px; cursor: pointer; }
#touch-edit-hint { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 70;
  background: rgba(10, 14, 18, 0.88); border: 1px solid rgba(255, 210, 87, 0.6); color: #ffd257;
  padding: 8px 16px; border-radius: 6px; font-size: 13px; pointer-events: none;
  display: flex; align-items: center; gap: 10px; }
#touch-edit-hint .te-cancel { pointer-events: auto; cursor: pointer; color: #ff8d5e;
  font-size: 12px; border: 1px solid rgba(255, 141, 94, 0.5); border-radius: 4px; padding: 2px 8px;
  background: rgba(255, 141, 94, 0.12); }
#touch .tb-btn.editing { border-color: #ffd257; box-shadow: 0 0 0 3px rgba(255, 210, 87, 0.4); cursor: grabbing; }
`

/** B-R4：竖屏判定（纯函数，可单测） */
export function isPortrait(w: number, h: number): boolean {
  return h > w
}

/** B-R1.1/1.2 触控布局单一来源（right/left + top/bottom 锚定 px）。
 * 分区：左上=暂停/买/丢；右下=开火+开镜；右中=动作弧行（跳/蹲/换弹/E）；
 * 右上=武器槽行（主副刀）+ 投掷行（雷闪烟燃）。单测断言任意两键零重叠。 */
export interface TouchLayoutItem {
  w: number
  h: number
  right?: number
  left?: number
  bottom?: number
  top?: number
}
export const TOUCH_LAYOUT: Record<string, TouchLayoutItem> = {
  pause: { w: 46, h: 46, left: 16, top: 12 },
  buy: { w: 50, h: 50, left: 72, top: 24 },
  drop: { w: 50, h: 50, left: 132, top: 24 },
  fire: { w: 92, h: 92, right: 20, bottom: 20 },
  aim: { w: 56, h: 56, right: 126, bottom: 38 },
  jump: { w: 54, h: 54, right: 30, bottom: 126 },
  crouch: { w: 54, h: 54, right: 96, bottom: 126 },
  reload: { w: 54, h: 54, right: 162, bottom: 126 },
  use: { w: 54, h: 54, right: 228, bottom: 126 },
  s0: { w: 44, h: 44, right: 272, bottom: 238 },
  s1: { w: 44, h: 44, right: 218, bottom: 238 },
  s2: { w: 44, h: 44, right: 164, bottom: 238 },
  s3: { w: 40, h: 40, right: 244, bottom: 192 },
  s4: { w: 40, h: 40, right: 194, bottom: 192 },
  s5: { w: 40, h: 40, right: 144, bottom: 192 },
  s6: { w: 40, h: 40, right: 94, bottom: 192 },
}

/** 按 TOUCH_LAYOUT 条目施加定位与尺寸（单源，保证可测） */
function applyLayout(el: HTMLElement, key: string, ctx: { W: number; H: number; preset: 'right' | 'left'; offsets: Record<string, { dx: number; dy: number }> }): void {
  const lay = TOUCH_LAYOUT[key]
  const st = layoutStyle(key, ctx.W, ctx.H, ctx.preset, ctx.offsets)
  el.style.width = `${lay.w}px`
  el.style.height = `${lay.h}px`
  Object.assign(el.style, st)
}

/** B-R1.3/R1.5：按键定位纯函数（可单测）。
 * right 预设 = TOUCH_LAYOUT 原值；left 预设 = 水平镜像（right↔left 坐标翻转，W=层宽）。
 * 用户偏移（编辑器）叠加在最终坐标上。返回该按键的 CSS 定位属性。 */
export function layoutStyle(
  key: string,
  W: number,
  H: number,
  preset: 'right' | 'left',
  offsets: Record<string, { dx: number; dy: number }>,
): Record<string, string> {
  const lay = TOUCH_LAYOUT[key]
  let left: number
  let top: number
  if (lay.right != null) left = W - lay.right - lay.w
  else left = lay.left ?? 0
  if (lay.bottom != null) top = H - lay.bottom - lay.h
  else top = lay.top ?? 0
  if (preset === 'left') {
    // 镜像：水平翻转（垂直位置不变）
    left = W - left - lay.w
  }
  const off = offsets[key] ?? { dx: 0, dy: 0 }
  left += off.dx
  top += off.dy
  // 安全区约束（B-R1.4）：距边缘 ≥ 4px 且不越界
  left = Math.max(4, Math.min(left, W - lay.w - 4))
  top = Math.max(4, Math.min(top, H - lay.h - 4))
  return { left: `${left}px`, top: `${top}px` }
}

let styleInjected = false
function injectStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const el = document.createElement('style')
  el.id = 'touch-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

export class TouchController {
  private root: HTMLDivElement
  private capture: HTMLDivElement
  private joyBase: HTMLDivElement
  private joyThumb: HTMLDivElement
  private rotateEl: HTMLDivElement
  private btnEls = new Map<string, HTMLDivElement>()

  // 摇杆
  private stickId = -1
  private stickOX = 0
  private stickOY = 0
  private joy = { forward: 0, back: 0, left: 0, right: 0 }
  // 视角
  private lookId = -1
  private lookLX = 0
  private lookLY = 0
  private lookDX = 0
  private lookDY = 0
  /** 视角灵敏度倍率（1 = 与 CONFIG.mouseSens 同量纲的像素增量） */
  lookScale = 1.1

  // 按钮边沿/按住状态
  private fireHeld = false
  private fireQueued = false
  private aimHeld = false
  private jumpHeld = false
  private jumpQueued = false
  private crouchHeld = false
  private useHeld = false
  private reloadQueued = false
  private buyQueued = false
  private dropQueued = false
  private switchSlotQueued: number | null = null

  /** 暂停回调（由 main.ts 注入） */
  onPause?: () => void
  private pauseEl: HTMLDivElement
  private settings: Settings
  /** B-R1.5 长按编辑器状态 */
  private editKey: string | null = null
  private editTimer: number | null = null
  private editStart: { x: number; y: number } | null = null
  private editBase: { left: number; top: number } | null = null
  private editArmed = false
  private editHint: HTMLDivElement

  constructor(container: HTMLElement, private base: InputController) {
    injectStyle()
    this.settings = loadSettings()
    this.root = document.createElement('div')
    this.root.id = 'touch'
    this.capture = document.createElement('div')
    this.capture.id = 'touch-capture'
    this.joyBase = document.createElement('div')
    this.joyBase.id = 'joy-base'
    this.joyThumb = document.createElement('div')
    this.joyThumb.id = 'joy-thumb'
    this.root.appendChild(this.capture)
    this.root.appendChild(this.joyBase)
    this.root.appendChild(this.joyThumb)
    // B-R4 竖屏提示遮罩（+「全屏并锁定横屏」按钮）
    this.rotateEl = document.createElement('div')
    this.rotateEl.id = 'touch-rotate'
    const tip = document.createElement('div')
    tip.textContent = '请旋转至横屏'
    this.rotateEl.appendChild(tip)
    const lockBtn = document.createElement('button')
    lockBtn.textContent = '全屏并锁定横屏'
    lockBtn.addEventListener('click', () => {
      void document.documentElement.requestFullscreen().catch(() => {})
      const o = screen.orientation as unknown as { lock?: (o: string) => Promise<void> }
      if (o?.lock) void o.lock('landscape').catch(() => {})
      // R4.5：平台拒绝方向锁定时静默降级，仅保留旋转提示
    })
    this.rotateEl.appendChild(lockBtn)
    this.root.appendChild(this.rotateEl)
    container.appendChild(this.root)

    // 暂停按钮
    const pause = document.createElement('div')
    pause.className = 'tb-pause'
    pause.textContent = 'II'
    this.pauseEl = pause
    applyLayout(pause, 'pause', this.layoutCtx())
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.onPause?.()
    })
    this.root.appendChild(pause)

    // B-R1.5 布局编辑提示条（长按按钮 0.6s 后出现）
    this.editHint = document.createElement('div')
    this.editHint.id = 'touch-edit-hint'
    this.editHint.textContent = '拖动按钮调整布局，松开保存'
    this.editHint.style.display = 'none'
    const cancelBtn = document.createElement('span')
    cancelBtn.className = 'te-cancel'
    cancelBtn.textContent = '取消'
    cancelBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.cancelEdit()
    })
    this.editHint.appendChild(cancelBtn)
    this.root.appendChild(this.editHint)

    // 动作按钮（定位/尺寸按 TOUCH_LAYOUT 单源施加 + 预设镜像 + 用户偏移）
    for (const b of BUTTONS) {
      const el = document.createElement('div')
      el.className = `tb-btn ${b.cls}`
      el.textContent = b.label
      if (TOUCH_LAYOUT[b.key]) applyLayout(el, b.key, this.layoutCtx())
      el.addEventListener('pointerdown', (e) => this.btnDown(e, b))
      el.addEventListener('pointerup', (e) => this.btnUp(e, b))
      el.addEventListener('pointercancel', (e) => this.btnUp(e, b))
      el.addEventListener('pointerleave', (e) => this.btnUp(e, b))
      el.addEventListener('pointermove', (e) => this.btnMove(e, b))
      this.root.appendChild(el)
      this.btnEls.set(b.key, el)
    }

    this.capture.addEventListener('pointerdown', this.onDown)
    this.capture.addEventListener('pointermove', this.onMove)
    this.capture.addEventListener('pointerup', this.onUp)
    this.capture.addEventListener('pointercancel', this.onUp)
  }

  /** B-R1.3/R1.5：当前布局上下文（预设 + 用户偏移 + 实际尺寸） */
  private layoutCtx(): { W: number; H: number; preset: 'right' | 'left'; offsets: Record<string, { dx: number; dy: number }> } {
    return {
      W: this.root.clientWidth || window.innerWidth,
      H: this.root.clientHeight || window.innerHeight,
      preset: this.settings.touchPreset,
      offsets: this.settings.touchOffsets,
    }
  }

  /** B-R1.3：预设切换后即时重排所有按键（main.ts applySettings 调用） */
  relayout(loaded?: Settings): void {
    if (loaded) this.settings = loaded
    else this.settings = loadSettings()
    applyLayout(this.pauseEl, 'pause', this.layoutCtx())
    for (const b of BUTTONS) {
      const el = this.btnEls.get(b.key)
      if (el) applyLayout(el, b.key, this.layoutCtx())
    }
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault()
    const isStickZone = e.clientX < window.innerWidth * JOY_RATIO
    if (isStickZone && this.stickId === -1) {
      this.stickId = e.pointerId
      this.stickOX = e.clientX
      this.stickOY = e.clientY
      this.showJoy(e.clientX, e.clientY)
    } else if (this.lookId === -1) {
      this.lookId = e.pointerId
      this.lookLX = e.clientX
      this.lookLY = e.clientY
    }
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickOX
      let dy = e.clientY - this.stickOY
      const len = Math.hypot(dx, dy)
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS
        dy = (dy / len) * JOY_RADIUS
      }
      this.joyThumb.style.transform = `translate(${this.stickOX + dx}px, ${this.stickOY + dy}px)`
      const nx = dx / JOY_RADIUS
      const ny = dy / JOY_RADIUS // 向下为正
      this.joy = {
        forward: ny < 0 ? -ny : 0,
        back: ny > 0 ? ny : 0,
        left: nx < 0 ? -nx : 0,
        right: nx > 0 ? nx : 0,
      }
    } else if (e.pointerId === this.lookId) {
      this.lookDX += (e.clientX - this.lookLX) * this.lookScale
      this.lookDY += (e.clientY - this.lookLY) * this.lookScale
      this.lookLX = e.clientX
      this.lookLY = e.clientY
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = -1
      this.joy = { forward: 0, back: 0, left: 0, right: 0 }
      this.joyBase.style.display = 'none'
      this.joyThumb.style.display = 'none'
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1
    }
  }

  private showJoy(x: number, y: number): void {
    this.joyBase.style.display = 'block'
    this.joyThumb.style.display = 'block'
    this.joyBase.style.transform = `translate(${x}px, ${y}px)`
    this.joyThumb.style.transform = `translate(${x}px, ${y}px)`
  }

  private btnDown(e: PointerEvent, b: (typeof BUTTONS)[number]): void {
    e.preventDefault()
    this.btnEls.get(b.key)?.classList.add('on')
    // B-R1.5：长按 0.6s 进入布局编辑（该次按压不再触发按键动作）
    this.editBase = { left: parseInt(this.btnEls.get(b.key)?.style.left ?? '0', 10), top: parseInt(this.btnEls.get(b.key)?.style.top ?? '0', 10) }
    this.editStart = { x: e.clientX, y: e.clientY }
    this.editKey = b.key
    this.editArmed = true
    if (this.editTimer) window.clearTimeout(this.editTimer)
    this.editTimer = window.setTimeout(() => this.enterEdit(b.key), 600)
    switch (b.key) {
      case 'fire':
        if (!this.fireHeld) this.fireQueued = true
        this.fireHeld = true
        break
      case 'aim':
        this.aimHeld = true
        break
      case 'jump':
        if (!this.jumpHeld) this.jumpQueued = true
        this.jumpHeld = true
        break
      case 'crouch':
        this.crouchHeld = true
        break
      case 'use':
        this.useHeld = true
        break
      case 'reload':
        this.reloadQueued = true
        break
      case 'buy':
        this.buyQueued = true
        break
      case 'drop':
        this.dropQueued = true
        break
      default:
        if (b.slot !== undefined) this.switchSlotQueued = b.slot
    }
  }

  private btnUp(e: PointerEvent, b: (typeof BUTTONS)[number]): void {
    this.btnEls.get(b.key)?.classList.remove('on')
    if (this.editTimer) {
      window.clearTimeout(this.editTimer)
      this.editTimer = null
    }
    // B-R1.5：编辑模式松开 → 保存偏移；否则仅取消编辑待命
    if (this.editKey === b.key && this.editArmed) {
      if (this.editStart && this.editBase) {
        const dx = e.clientX - this.editStart.x
        const dy = e.clientY - this.editStart.y
        // 仅在确实拖动过（>4px）时保存，避免误触
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          const orig = this.layoutStyleWithoutOffset(b.key)
          const ndx = this.editBase.left + dx - orig.left
          const ndy = this.editBase.top + dy - orig.top
          this.settings.touchOffsets = {
            ...this.settings.touchOffsets,
            [b.key]: { dx: Math.round(ndx), dy: Math.round(ndy) },
          }
          saveSettings(this.settings)
          this.relayout()
        }
      }
      this.exitEdit()
      // 编辑态：本次按压不作为按键动作（清掉已置位的按住态）
      this.clearHeld(b)
      this.editArmed = false
      return
    }
    this.editArmed = false
    if (b.held) {
      if (b.key === 'fire') this.fireHeld = false
      if (b.key === 'aim') this.aimHeld = false
      if (b.key === 'crouch') this.crouchHeld = false
      if (b.key === 'use') this.useHeld = false
      if (b.key === 'jump') this.jumpHeld = false
    }
  }

  private btnMove(e: PointerEvent, b: (typeof BUTTONS)[number]): void {
    // B-R1.5：编辑态拖动按键
    if (this.editKey !== b.key || !this.editStart || !this.editBase) return
    const el = this.btnEls.get(b.key)
    if (!el) return
    const dx = e.clientX - this.editStart.x
    const dy = e.clientY - this.editStart.y
    el.style.left = `${this.editBase.left + dx}px`
    el.style.top = `${this.editBase.top + dy}px`
  }

  /** B-R1.5：进入编辑（长按 0.6s）——高亮 + 提示 + 清按住态 */
  private enterEdit(key: string): void {
    this.editKey = key
    this.btnEls.get(key)?.classList.add('editing')
    this.editHint.style.display = 'block'
    // 长按期间若曾是按住键，取消动作语义（该按压用于布局）
    const b = BUTTONS.find((x) => x.key === key)
    if (b) this.clearHeld(b)
  }

  private exitEdit(): void {
    if (this.editKey) this.btnEls.get(this.editKey)?.classList.remove('editing')
    this.editKey = null
    this.editBase = null
    this.editStart = null
    this.editHint.style.display = 'none'
  }

  /** B-R1.5：取消编辑（恢复预设布局，不保存偏移） */
  cancelEdit(): void {
    if (this.editKey) {
      const key = this.editKey
      this.exitEdit()
      const el = this.btnEls.get(key)
      if (el) applyLayout(el, key, this.layoutCtx())
    }
  }

  /** 清除某按键的按住/边沿状态（编辑态取消动作语义用） */
  private clearHeld(b: (typeof BUTTONS)[number]): void {
    if (b.held) {
      if (b.key === 'fire') {
        this.fireHeld = false
        this.fireQueued = false
      }
      if (b.key === 'aim') this.aimHeld = false
      if (b.key === 'crouch') this.crouchHeld = false
      if (b.key === 'use') this.useHeld = false
      if (b.key === 'jump') this.jumpHeld = false
    }
    if (b.key === 'reload') this.reloadQueued = false
    if (b.key === 'buy') this.buyQueued = false
    if (b.key === 'drop') this.dropQueued = false
    if (b.slot !== undefined) this.switchSlotQueued = null
  }

  /** B-R1.5：按当前预设计算（不含用户偏移）的基准位置 */
  private layoutStyleWithoutOffset(key: string): { left: number; top: number } {
    const ctx = this.layoutCtx()
    const st = layoutStyle(key, ctx.W, ctx.H, ctx.preset, {})
    return { left: parseInt(st.left, 10), top: parseInt(st.top, 10) }
  }

  /** 每 tick：base 键盘/鼠标帧 + 触控叠加。开火/开镜不依赖指针锁。 */
  poll(): InputFrame {
    // B-R4：竖屏对局中显示旋转遮罩并暂停输入轮询（横屏下一帧自动恢复）
    const portrait = isPortrait(window.innerWidth, window.innerHeight) && this.root.classList.contains('on')
    this.rotateEl.style.display = portrait ? 'flex' : 'none'
    if (portrait) {
      this.fireHeld = false
      this.aimHeld = false
      this.crouchHeld = false
      this.useHeld = false
      this.jumpHeld = false
      this.joy = { forward: 0, back: 0, left: 0, right: 0 }
      return emptyInput()
    }
    const f = this.base.poll()
    f.forward = Math.max(f.forward, this.joy.forward)
    f.back = Math.max(f.back, this.joy.back)
    f.left = Math.max(f.left, this.joy.left)
    f.right = Math.max(f.right, this.joy.right)
    f.mouseDX += this.lookDX
    f.mouseDY += this.lookDY
    this.lookDX = 0
    this.lookDY = 0
    f.fireHeld = f.fireHeld || this.fireHeld
    f.fireQueued = f.fireQueued || this.fireQueued
    this.fireQueued = false
    f.aimHeld = f.aimHeld || this.aimHeld
    f.jumpHeld = f.jumpHeld || this.jumpHeld
    f.jumpQueued = f.jumpQueued || this.jumpQueued
    this.jumpQueued = false
    f.crouch = f.crouch || this.crouchHeld
    f.useHeld = f.useHeld || this.useHeld
    f.reloadQueued = f.reloadQueued || this.reloadQueued
    this.reloadQueued = false
    f.buyQueued = f.buyQueued || this.buyQueued
    this.buyQueued = false
    f.dropQueued = f.dropQueued || this.dropQueued
    this.dropQueued = false
    if (this.switchSlotQueued !== null) {
      f.switchSlot = this.switchSlotQueued
      this.switchSlotQueued = null
    }
    return f
  }

  /** 触屏视为"已锁定"：准星常显、隐藏"点击锁定鼠标"提示 */
  get locked(): boolean {
    return this.root.classList.contains('on')
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('on', v)
    if (!v) {
      this.onUp({ pointerId: -1 } as PointerEvent)
      this.fireHeld = false
      this.aimHeld = false
      this.crouchHeld = false
      this.useHeld = false
      this.jumpHeld = false
    }
  }
}

/** 切枪/投掷物小按钮定位（右下角上方两列） */
