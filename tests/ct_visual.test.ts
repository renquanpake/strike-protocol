import { describe, expect, it } from 'vitest'
import { albedoFallback, albedoKeys } from '../src/engine/textures'

describe('R1a CT 阵营纹理源分离（回退人形纯黑修复回归）', () => {
  it('bot_ct 回退工厂独立于 metal 与 bot_t 源', () => {
    expect(albedoFallback.bot_ct).not.toBe(albedoFallback.metal)
    expect(albedoFallback.bot_ct).not.toBe(albedoFallback.bot_t)
  })
  it('bot_ct 仍登记在 albedo 键表（加载链完整）', () => {
    expect(albedoKeys).toContain('bot_ct')
    expect(albedoKeys).toContain('bot_t')
  })
  it('工厂表覆盖全部阵营键且引用均非空', () => {
    for (const k of albedoKeys) {
      expect(typeof albedoFallback[k]).toBe('function')
    }
  })
})
