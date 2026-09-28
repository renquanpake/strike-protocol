import { describe, expect, it } from 'vitest'
import { isPortrait } from '../src/ui/touch'

describe('B-R4 竖屏判定', () => {
  it('竖屏（高>宽）触发遮罩条件', () => {
    expect(isPortrait(390, 844)).toBe(true)
    expect(isPortrait(375, 667)).toBe(true)
  })
  it('横屏与方屏不触发', () => {
    expect(isPortrait(844, 390)).toBe(false)
    expect(isPortrait(500, 500)).toBe(false)
  })
})
