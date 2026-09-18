/**
 * 键鼠输入采集。
 * 每逻辑 tick 由调用方拉取一次 InputFrame（鼠标增量按帧消费）。
 */
export interface InputFrame {
  forward: number
  back: number
  left: number
  right: number
  /** 跳跃键按下当帧（边沿触发） */
  jumpQueued: boolean
  /** 跳跃键持续按住（bhop 自动起跳用） */
  jumpHeld: boolean
  /** 开火按下当帧 */
  fireQueued: boolean
  /** 开火键持续按住（全自动武器连发） */
  fireHeld: boolean
  /** 换弹按下当帧 */
  reloadQueued: boolean
  /** 交互键（安放/拆除）按住 */
  useHeld: boolean
  /** 买枪菜单开关键（边沿） */
  buyQueued: boolean
  /** 计分板按住 */
  scoreboardHeld: boolean
  /** 切槽按下当帧（0=primary 1=secondary 2=knife），无则为 null */
  switchSlot: number | null
  crouch: boolean
  walk: boolean
  mouseDX: number
  mouseDY: number
}

const EMPTY: InputFrame = {
  forward: 0,
  back: 0,
  left: 0,
  right: 0,
  jumpQueued: false,
  jumpHeld: false,
  fireQueued: false,
  fireHeld: false,
  reloadQueued: false,
  useHeld: false,
  buyQueued: false,
  scoreboardHeld: false,
  switchSlot: null,
  crouch: false,
  walk: false,
  mouseDX: 0,
  mouseDY: 0,
}

export const emptyInput = (): InputFrame => ({ ...EMPTY })

export class InputController {
  private keys = new Set<string>()
  private jumpQueued = false
  private fireQueued = false
  private fireHeldFlag = false
  private reloadQueued = false
  private buyQueued = false
  private switchSlot: number | null = null
  private mouseDX = 0
  private mouseDY = 0
  private canvas: HTMLCanvasElement | null = null

  get locked(): boolean {
    return this.canvas !== null && document.pointerLockElement === this.canvas
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    canvas.addEventListener('click', this.onClick)
  }

  detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.onClick)
      this.canvas = null
    }
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
  }

  private onClick = (): void => {
    if (this.canvas && !this.locked) {
      this.canvas.requestPointerLock()
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault()
      if (!this.keys.has('Space')) this.jumpQueued = true
    }
    if (e.code === 'KeyR' && !this.keys.has('KeyR')) this.reloadQueued = true
    if (e.code === 'KeyB' && !this.keys.has('KeyB')) this.buyQueued = true
    if (e.code === 'Tab') e.preventDefault()
    if (e.code === 'Digit1' && !this.keys.has('Digit1')) this.switchSlot = 0
    if (e.code === 'Digit2' && !this.keys.has('Digit2')) this.switchSlot = 1
    if (e.code === 'Digit3' && !this.keys.has('Digit3')) this.switchSlot = 2
    if (e.code === 'Digit4' && !this.keys.has('Digit4')) this.switchSlot = 3
    if (e.code === 'Digit5' && !this.keys.has('Digit5')) this.switchSlot = 4
    if (e.code === 'Digit6' && !this.keys.has('Digit6')) this.switchSlot = 5
    if (e.code === 'Digit7' && !this.keys.has('Digit7')) this.switchSlot = 6
    this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    this.mouseDX += e.movementX
    this.mouseDY += e.movementY
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return
    if (e.button === 0) {
      this.fireQueued = true
      this.fireHeldFlag = true
    }
  }

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.fireHeldFlag = false
  }

  /** 每个逻辑 tick 调用一次：读取键位快照并消费鼠标/边沿增量 */
  poll(): InputFrame {
    const k = this.keys
    const frame: InputFrame = {
      forward: k.has('KeyW') || k.has('ArrowUp') ? 1 : 0,
      back: k.has('KeyS') || k.has('ArrowDown') ? 1 : 0,
      left: k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0,
      right: k.has('KeyD') || k.has('ArrowRight') ? 1 : 0,
      jumpQueued: this.jumpQueued,
      jumpHeld: k.has('Space'),
      fireQueued: this.fireQueued,
      fireHeld: this.fireHeldLocked(),
      reloadQueued: this.reloadQueued,
      useHeld: k.has('KeyE'),
      buyQueued: this.buyQueued,
      scoreboardHeld: k.has('Tab'),
      switchSlot: this.switchSlot,
      crouch: k.has('ControlLeft') || k.has('ControlRight'),
      walk: k.has('ShiftLeft') || k.has('ShiftRight'),
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
    }
    this.jumpQueued = false
    this.fireQueued = false
    this.reloadQueued = false
    this.buyQueued = false
    this.switchSlot = null
    this.mouseDX = 0
    this.mouseDY = 0
    return frame
  }

  /** 左键按住状态（仅 pointer lock 期间有效） */
  private fireHeldLocked(): boolean {
    if (!this.locked) return false
    return this.fireHeldFlag
  }
}
