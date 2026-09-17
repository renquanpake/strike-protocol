export interface LoopResult {
  ticks: number
  alpha: number
}

export type TickFn = (dtSec: number) => void

/**
 * 固定逻辑步长主循环（accumulator 模式）。
 * 与渲染帧率解耦：每帧按真实耗时累积，按 tickMs 步进执行逻辑 tick，
 * 剩余不足一步的时间比例作为渲染插值因子 alpha 返回。
 */
export class FixedLoop {
  private accumulatorMs = 0
  private lastMs = -1
  private readonly tickMs: number
  private readonly maxTicksPerFrame: number

  constructor(tickHz: number, maxTicksPerFrame = 32) {
    this.tickMs = 1000 / tickHz
    this.maxTicksPerFrame = maxTicksPerFrame
  }

  /** 以墙钟毫秒推进一次，返回本帧执行的 tick 数与插值 alpha */
  step(nowMs: number, fn: TickFn): LoopResult {
    if (this.lastMs < 0) {
      this.lastMs = nowMs
      return { ticks: 0, alpha: 0 }
    }
    let frameMs = nowMs - this.lastMs
    this.lastMs = nowMs
    if (frameMs > 1000) frameMs = 1000
    this.accumulatorMs += frameMs
    let ticks = 0
    while (this.accumulatorMs >= this.tickMs && ticks < this.maxTicksPerFrame) {
      fn(this.tickMs / 1000)
      this.accumulatorMs -= this.tickMs
      ticks += 1
    }
    if (ticks === this.maxTicksPerFrame) this.accumulatorMs = 0
    return { ticks, alpha: this.accumulatorMs / this.tickMs }
  }

  reset(): void {
    this.accumulatorMs = 0
    this.lastMs = -1
  }
}
