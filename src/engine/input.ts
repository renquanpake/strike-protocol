/**
 * 键鼠输入采集。
 * 每逻辑 tick 由调用方拉取一次 InputFrame（鼠标增量按帧消费）。
 */
export interface InputFrame {
  forward: number
  back: number
  left: number
  right: number
  jumpQueued: boolean
  crouch: boolean
  walk: boolean
  reload: boolean
  mouseDX: number
  mouseDY: number
}

const EMPTY: InputFrame = {
  forward: 0,
  back: 0,
  left: 0,
  right: 0,
  jumpQueued: false,
  crouch: false,
  walk: false,
  reload: false,
  mouseDX: 0,
  mouseDY: 0,
}

export const emptyInput = (): InputFrame => ({ ...EMPTY })

export class InputController {
  private keys = new Set<string>()
  private jumpQueued = false
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

  /** 每个逻辑 tick 调用一次：读取键位快照并消费鼠标增量 */
  poll(): InputFrame {
    const k = this.keys
    const frame: InputFrame = {
      forward: k.has('KeyW') || k.has('ArrowUp') ? 1 : 0,
      back: k.has('KeyS') || k.has('ArrowDown') ? 1 : 0,
      left: k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0,
      right: k.has('KeyD') || k.has('ArrowRight') ? 1 : 0,
      jumpQueued: this.jumpQueued,
      crouch: k.has('ControlLeft') || k.has('ControlRight'),
      walk: k.has('ShiftLeft') || k.has('ShiftRight'),
      reload: k.has('KeyR'),
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
    }
    this.jumpQueued = false
    this.mouseDX = 0
    this.mouseDY = 0
    return frame
  }
}
