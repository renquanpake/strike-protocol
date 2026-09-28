import { describe, expect, it } from 'vitest'
import { TOUCH_LAYOUT } from '../src/ui/touch'

function rectOf(key: string, W: number, H: number) {
  const l = TOUCH_LAYOUT[key]
  const left = l.left != null ? l.left : W - (l.right ?? 0) - l.w
  const top = l.top != null ? l.top : H - (l.bottom ?? 0) - l.h
  return { key, left, top, right: left + l.w, bottom: top + l.h }
}

function overlap(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

describe('B-R1.1 触控布局零重叠回归', () => {
  it('全部 16 键均有定位锚（right/left 与 bottom/top 恰有一个）', () => {
    for (const [k, l] of Object.entries(TOUCH_LAYOUT)) {
      expect(l.right != null || l.left != null, `${k} 缺水平锚`).toBe(true)
      expect(l.bottom != null || l.top != null, `${k} 缺垂直锚`).toBe(true)
    }
  })

  it('常见横屏尺寸下任意两键命中区零重叠', () => {
    const sizes = [
      { W: 390, H: 360 }, // 手机最小横屏（逻辑像素）
      { W: 667, H: 375 }, // iPhone 横屏
      { W: 1280, H: 720 }, // 桌面 ?touch 调试
    ]
    const keys = Object.keys(TOUCH_LAYOUT)
    for (const { W, H } of sizes) {
      const rects = keys.map((k) => rectOf(k, W, H))
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(
            overlap(rects[i], rects[j]),
            `${W}x${H}: ${rects[i].key} × ${rects[j].key} 重叠`,
          ).toBe(false)
        }
      }
    }
  })

  it('最小屏幕下所有键完整落在视口内', () => {
    const W = 390, H = 360
    for (const k of Object.keys(TOUCH_LAYOUT)) {
      const r = rectOf(k, W, H)
      expect(r.left, `${k} 越左界`).toBeGreaterThanOrEqual(0)
      expect(r.top, `${k} 越上界`).toBeGreaterThanOrEqual(0)
      expect(r.right, `${k} 越右界`).toBeLessThanOrEqual(W)
      expect(r.bottom, `${k} 越下界`).toBeLessThanOrEqual(H)
    }
  })
})
