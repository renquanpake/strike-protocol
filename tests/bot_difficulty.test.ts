import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'

const D = CONFIG.BOT_DIFFICULTY

describe('A-R7 难度档位单一来源（偏高硬核校准）', () => {
  it('档位表 10 档且字段齐全', () => {
    expect(D.length).toBe(10)
    for (const p of D) {
      expect(typeof p.hear).toBe('boolean')
      expect(typeof p.lkpSec).toBe('number')
      expect(typeof p.cover).toBe('boolean')
      expect(typeof p.anchor).toBe('boolean')
      expect(typeof p.burst).toBe('boolean')
      expect(p.headBias).toBeGreaterThanOrEqual(0)
      expect(typeof p.radioHear).toBe('boolean')
    }
  })
  it('R7.1 低档休闲：1-2 档反应窗 ≥ 0.8s 且无听觉/掩体', () => {
    for (const i of [0, 1]) {
      expect(D[i].reactionMs[0]).toBeGreaterThanOrEqual(800)
      expect(D[i].hear).toBe(false)
      expect(D[i].cover).toBe(false)
      expect(D[i].lkpSec).toBe(0)
    }
  })
  it('R7.2 中档：3-5 档启用 R2-R6 全部能力，难度 5 反应窗 ∈ [0.35, 0.8]s', () => {
    for (const i of [2, 3, 4]) {
      expect(D[i].hear).toBe(true)
      expect(D[i].cover).toBe(true)
      expect(D[i].anchor).toBe(true)
      expect(D[i].burst).toBe(true)
      expect(D[i].lkpSec).toBeGreaterThanOrEqual(4)
    }
    expect(D[4].reactionMs[0]).toBeGreaterThanOrEqual(350)
    expect(D[4].reactionMs[1]).toBeLessThanOrEqual(800)
  })
  it('R7.3 高档：6-9 档反应窗 ∈ [0.18, 0.35]s、头部倾向与听声报点', () => {
    for (const i of [5, 6, 7, 8]) {
      expect(D[i].reactionMs[0]).toBeGreaterThanOrEqual(180)
      expect(D[i].reactionMs[1]).toBeLessThanOrEqual(350)
      expect(D[i].headBias).toBeGreaterThan(0)
      expect(D[i].radioHear).toBe(true)
    }
  })
  it('R7.4 极限档：10 档反应 ≤ 0.22s、LKP 追击 6s、头部倾向最大', () => {
    const p = D[9]
    expect(p.reactionMs[1]).toBeLessThanOrEqual(220)
    expect(p.lkpSec).toBe(6)
    expect(p.headBias).toBe(0.6)
  })
  it('难度上升反应窗上界单调不增（曲线不回退）', () => {
    for (let i = 1; i < D.length; i++) {
      expect(D[i].reactionMs[1], `档 ${i + 1}`).toBeLessThanOrEqual(D[i - 1].reactionMs[1])
    }
  })
})
