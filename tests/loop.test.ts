import { describe, expect, it } from 'vitest'
import { FixedLoop } from '../src/engine/loop'

describe('FixedLoop', () => {
  it('每个完整 tick 间隔执行一次逻辑 tick', () => {
    const loop = new FixedLoop(64)
    let calls = 0
    loop.step(0, () => calls++)
    expect(calls).toBe(0)
    for (let i = 1; i <= 64; i++) {
      const r = loop.step(i * 15.625, () => calls++)
      if (i % 4 === 0) expect(r.ticks).toBe(1) // 60fps 帧长 16.67ms，跨 4 帧满一个 64tick 的 3 倍...
    }
    expect(calls).toBe(64)
  })

  it('按真实帧间隔累计，tick 数与总时间成正比', () => {
    const loop = new FixedLoop(64)
    let calls = 0
    // 模拟 60fps：每帧 16.667ms，共 1000 帧 ≈ 16.67s ≈ 1066 tick
    for (let i = 1; i <= 1000; i++) loop.step((i * 1000) / 60, () => calls++)
    const expected = Math.floor((1000 * (1000 / 60)) / (1000 / 64))
    // 浮点累加允许 ±1 tick 误差
    expect(Math.abs(calls - expected)).toBeLessThanOrEqual(1)
    expect(calls).toBeGreaterThanOrEqual(1060)
  })

  it('超长帧丢弃超出上限的 tick 并清零累加器', () => {
    const loop = new FixedLoop(64, 16)
    let calls = 0
    loop.step(0, () => calls++)
    const r = loop.step(5000, () => calls++) // 5s 帧 → 上限 16 tick
    expect(r.ticks).toBe(16)
    expect(calls).toBe(16)
    // 累加器已清零，下一帧只处理真实间隔
    const r2 = loop.step(5000 + 15.625, () => calls++)
    expect(r2.ticks).toBe(1)
  })

  it('alpha 始终在 [0,1) 区间', () => {
    const loop = new FixedLoop(64)
    loop.step(0, () => {})
    for (let i = 1; i <= 200; i++) {
      const { alpha } = loop.step(i * 7.3, () => {})
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
    }
  })
})
