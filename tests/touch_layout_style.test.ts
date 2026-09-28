/** B-R1.3/R1.4/R1.5 触控布局纯函数单测（layoutStyle 镜像/偏移/安全区） */
import { describe, it, expect } from 'vitest'
import { layoutStyle } from '../src/ui/touch'

const W = 800
const H = 600

describe('layoutStyle (touch layout pure function)', () => {
  it('right preset returns TOUCH_LAYOUT coordinates', () => {
    // fire: right:20 bottom:20 w:92 h:92
    const st = layoutStyle('fire', W, H, 'right', {})
    expect(st.left).toBe(`${W - 20 - 92}px`) // 688
    expect(st.top).toBe(`${H - 20 - 92}px`) // 488
  })

  it('left preset mirrors horizontally', () => {
    const right = layoutStyle('fire', W, H, 'right', {})
    const left = layoutStyle('fire', W, H, 'left', {})
    const rL = parseInt(right.left, 10)
    const lL = parseInt(left.left, 10)
    // 镜像：right 预设 left=688 → left 预设 left = W - 688 - 92 = 20
    expect(lL).toBe(W - rL - 92)
    expect(lL).toBe(20)
  })

  it('user offsets shift the key position', () => {
    const st = layoutStyle('fire', W, H, 'right', { fire: { dx: 10, dy: -20 } })
    expect(st.left).toBe('698px') // 688 + 10
    expect(st.top).toBe('468px') // 488 - 20
  })

  it('safe-area clamps to >= 4px from edges and inside bounds', () => {
    // 超大负偏移 → left 钳制到 4
    const st = layoutStyle('fire', W, H, 'right', { fire: { dx: -700, dy: 0 } })
    expect(st.left).toBe('4px')
    // 超大正偏移 → 越界右边界钳制
    const st2 = layoutStyle('fire', W, H, 'right', { fire: { dx: 500, dy: 0 } })
    expect(parseInt(st2.left, 10)).toBe(W - 92 - 4)
  })
})
