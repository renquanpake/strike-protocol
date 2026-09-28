/** 公共资源 URL（含 Vite base）：本地 dev 为 '/'，GitHub Pages 子路径构建为 '/strike-protocol/'。
 * 所有指向 public/ 的运行时资源（models/textures/sounds）必须走 assetUrl，避免子路径 404 回退。 */
export const ASSET_BASE = import.meta.env.BASE_URL

/** 纯函数：拼接 base + 资源路径（可单测） */
export function joinAsset(base: string, path: string): string {
  const p = path.replace(/^\/+/, '')
  return base.endsWith('/') ? `${base}${p}` : `${base}/${p}`
}

export function assetUrl(path: string): string {
  return joinAsset(ASSET_BASE, path)
}
