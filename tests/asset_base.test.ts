/** 资源 URL base 前缀纯函数单测（GitHub Pages 子路径 404 回归） */
import { describe, it, expect } from 'vitest'
import { joinAsset, assetUrl } from '../src/engine/asset'

describe('joinAsset / assetUrl', () => {
  it('dev base "/" keeps root-absolute paths', () => {
    expect(joinAsset('/', 'models/character.glb')).toBe('/models/character.glb')
    expect(joinAsset('/', '/textures/sand.png')).toBe('/textures/sand.png') // 前导斜杠归一
  })

  it('Pages sub-path base prepends the prefix', () => {
    expect(joinAsset('/strike-protocol/', 'models/character.glb')).toBe('/strike-protocol/models/character.glb')
    expect(joinAsset('/strike-protocol/', 'sounds/click_001.ogg')).toBe('/strike-protocol/sounds/click_001.ogg')
  })

  it('base without trailing slash is normalized', () => {
    expect(joinAsset('/strike-protocol', 'models/character.glb')).toBe('/strike-protocol/models/character.glb')
  })

  it('assetUrl resolves against current import.meta.env.BASE_URL', () => {
    // vitest 环境 BASE_URL='/'；只断言非空且以 / 开头、包含资源路径
    const u = assetUrl('models/ct_soldier.glb')
    expect(u).toContain('models/ct_soldier.glb')
    expect(u.startsWith('/')).toBe(true)
  })
})
