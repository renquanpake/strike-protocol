import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..')

describe('R1b CT 阵营专属模型资产', () => {
  it('public/models/ct_soldier.glb 存在且为 GLB 二进制（消除 404 回退链）', () => {
    const p = resolve(ROOT, 'public/models/ct_soldier.glb')
    expect(existsSync(p)).toBe(true)
    const buf = readFileSync(p)
    expect(buf.length).toBeGreaterThan(1_000_000)
    // GLB magic: 0x46546C67 'glTF'
    expect(buf.subarray(0, 4).toString()).toBe('glTF')
  })
  it('T 主模板与 CT 模板均为合法 GLB（双模板独立可加载）', () => {
    for (const f of ['character.glb', 'ct_soldier.glb']) {
      const buf = readFileSync(resolve(ROOT, `public/models/${f}`))
      expect(buf.subarray(0, 4).toString()).toBe('glTF')
    }
  })
})
