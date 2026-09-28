import * as THREE from 'three'

/** 程序化材质贴图：全部 Canvas 生成，零外部资源 */

function makeCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')!]
}

function noiseFill(ctx: CanvasRenderingContext2D, size: number, base: string, speckles: number, alpha: number): void {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < speckles; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = Math.random() * 2 + 0.5
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 60)},${Math.floor(Math.random() * 60)},${Math.floor(Math.random() * 60)},${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function concreteTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  noiseFill(ctx, 256, '#9aa0a8', 4000, 0.12)
  // 板材接缝
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, 254, 254)
  ctx.beginPath()
  ctx.moveTo(128, 0)
  ctx.lineTo(128, 256)
  ctx.moveTo(0, 128)
  ctx.lineTo(256, 128)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function woodTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#8a5a30'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 4; i++) {
    const y0 = i * 64
    ctx.fillStyle = i % 2 ? '#7a4e28' : '#96633a'
    ctx.fillRect(0, y0, 256, 64)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, y0)
    ctx.lineTo(256, y0)
    ctx.stroke()
    // 木纹
    ctx.strokeStyle = 'rgba(60,35,15,0.35)'
    ctx.lineWidth = 1
    for (let k = 0; k < 5; k++) {
      ctx.beginPath()
      ctx.moveTo(0, y0 + 8 + k * 11)
      ctx.bezierCurveTo(80, y0 + 4 + k * 11, 180, y0 + 14 + k * 11, 256, y0 + 8 + k * 11)
      ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function metalTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#767e88'
  ctx.fillRect(0, 0, 256, 256)
  // 拉丝
  for (let i = 0; i < 160; i++) {
    const y = Math.random() * 256
    ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.08})`
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(256, y + (Math.random() - 0.5) * 6)
    ctx.stroke()
  }
  // 铆钉
  ctx.fillStyle = 'rgba(30,34,40,0.55)'
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.beginPath()
      ctx.arc(20 + i * 72, 20 + j * 72, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function sandTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  noiseFill(ctx, 256, '#c9a86a', 9000, 0.18)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** CT 警员制服（R1a：替换深色金属贴图，警蓝基底+迷彩+亮条，ACES 管线下可读） */
export function ctUniformTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  noiseFill(ctx, 256, '#5f8fc9', 9000, 0.18)
  ctx.fillStyle = 'rgba(40,68,112,0.5)'
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.ellipse(Math.random() * 256, Math.random() * 256, 14 + Math.random() * 22, 8 + Math.random() * 12, Math.random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(222,236,255,0.5)'
  ctx.fillRect(0, 62, 256, 12)
  ctx.fillRect(0, 184, 256, 12)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function ladderTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#d8c25a'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(90,70,20,0.8)'
  ctx.lineWidth = 10
  ctx.strokeRect(30, 0, 40, 256)
  ctx.strokeRect(186, 0, 40, 256)
  for (let i = 0; i < 10; i++) {
    ctx.beginPath()
    ctx.moveTo(70, 20 + i * 25)
    ctx.lineTo(186, 20 + i * 25)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  return tex
}

export function glassTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#9fd8e8'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(40, 0)
  ctx.lineTo(200, 256)
  ctx.stroke()
  return new THREE.CanvasTexture(c)
}

export function stoneTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#c9a878'
  ctx.fillRect(0, 0, 256, 256)
  // 错缝石砌
  ctx.strokeStyle = 'rgba(80,60,35,0.5)'
  ctx.lineWidth = 3
  for (let r = 0; r < 4; r++) {
    const y0 = r * 64
    ctx.strokeRect(0, y0, 256, 64)
    const off = r % 2 ? 64 : 0
    for (let x = off; x < 256; x += 128) ctx.beginPath(), ctx.moveTo(x, y0), ctx.lineTo(x, y0 + 64), ctx.stroke()
  }
  noiseFill(ctx, 256, '#c9a878', 1500, 0.08)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function roofTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#9c7f57'
  ctx.fillRect(0, 0, 256, 256)
  noiseFill(ctx, 256, '#9c7f57', 5000, 0.12)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** V6 地中海白灰泥墙（de_plaza 主色板） */
export function plasterTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#ece5d8'
  ctx.fillRect(0, 0, 256, 256)
  // 石灰灰泥：细微竖流痕 + 旧化斑块
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256
    ctx.strokeStyle = `rgba(180,170,150,${0.05 + Math.random() * 0.08})`
    ctx.lineWidth = 2 + Math.random() * 6
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + (Math.random() - 0.5) * 30, 256)
    ctx.stroke()
  }
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(200,190,170,${0.1 + Math.random() * 0.1})`
    ctx.beginPath()
    ctx.ellipse(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 30, 8 + Math.random() * 20, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  noiseFill(ctx, 256, '#ece5d8', 1200, 0.06)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** V6 灰瓷砖广场地面（de_plaza 主色板） */
export function tileTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#cfc8bc'
  ctx.fillRect(0, 0, 256, 256)
  // 2x2 瓷砖 + 灰缝
  const ts = 128
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = i % 2 ? '#d4cec2' : '#cbc4b8'
      ctx.fillRect(i * ts + 3, j * ts + 3, ts - 6, ts - 6)
    }
  }
  ctx.strokeStyle = 'rgba(120,115,105,0.8)'
  ctx.lineWidth = 4
  for (let k = 0; k <= 2; k++) {
    ctx.beginPath()
    ctx.moveTo(k * ts, 0)
    ctx.lineTo(k * ts, 256)
    ctx.moveTo(0, k * ts)
    ctx.lineTo(256, k * ts)
    ctx.stroke()
  }
  noiseFill(ctx, 256, '#cfc8bc', 1500, 0.08)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function sandbagTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#b09a6a'
  ctx.fillRect(0, 0, 256, 256)
  // 沙袋叠砌（running bond）
  ctx.strokeStyle = 'rgba(90,72,40,0.55)'
  ctx.lineWidth = 3
  for (let r = 0; r < 5; r++) {
    const y0 = r * 52
    ctx.strokeRect(0, y0, 256, 52)
    const off = r % 2 ? 64 : 0
    for (let x = off; x < 256; x += 128) {
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 52); ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function rustedTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#8a5a34'
  ctx.fillRect(0, 0, 256, 256)
  // 竖向瓦楞
  for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = 'rgba(60,40,20,0.35)'
    ctx.fillRect(x, 0, 4, 256)
    ctx.fillStyle = 'rgba(180,140,90,0.25)'
    ctx.fillRect(x + 14, 0, 6, 256)
  }
  noiseFill(ctx, 256, '#8a5a34', 3000, 0.15)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export type TextureMap = Record<string, THREE.Texture>

export function buildTextures(): TextureMap {
  return {
    concrete: concreteTexture(),
    metal: metalTexture(),
    wood: woodTexture(),
    sand: sandTexture(),
    ladder: ladderTexture(),
    glass: glassTexture(),
    stone: stoneTexture(),
    roof: roofTexture(),
    sandbag: sandbagTexture(),
    rusted: rustedTexture(),
    plaster: plasterTexture(),
    tile: tileTexture(),
  }
}

/** 图片纹理加载（/textures/*.png，加载失败回退到 canvas 程序化贴图） */
function loadOrFallback(url: string, fallback: () => THREE.Texture): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        tex.anisotropy = 4
        resolve(tex)
      },
      undefined,
      () => resolve(fallback()),
    )
  })
}

/** V3 双层平铺：仅对大面积开放表面合成 2048² "mega-tile"（种子决定相位，确定性跨运行稳定） */
const MEGA_SEEDS: Record<string, number> = {
  concrete: 1,
  stone: 2,
  sand: 3,
  rusted: 4,
  plaster: 5,
  tile: 6,
  roof: 7,
  sandbag: 8,
  wood: 9,
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error(url))
    i.src = url
  })
}

/** V3 双层平铺合成：2048 mega-tile = 2x2 随机相位平铺 + 第二层 AO 灰度 detail（multiply），
 *  并沿 mega-tile 边界加晕影带，打破 1024 源图重复平铺的规律感。源图缺失/尺寸不足时由调用方回退。 */
async function composeMegaTexture(url: string, seed: number): Promise<THREE.Texture> {
  const img = await loadImageEl(url)
  const S = img.width
  if (S < 1024) throw new Error(`source too small for mega composite: ${S}`)
  const Q = 1024
  // 3x3 wrap canvas：随机偏移（≤1/4 周期）无接缝采样
  const wrap = document.createElement('canvas')
  wrap.width = wrap.height = S * 3
  const wctx = wrap.getContext('2d')!
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) wctx.drawImage(img, i * S, j * S)
  const c = document.createElement('canvas')
  c.width = c.height = Q * 2
  const ctx = c.getContext('2d')!
  const rnd = mulberry(seed * 1013)
  for (let qx = 0; qx < 2; qx++) {
    for (let qy = 0; qy < 2; qy++) {
      const ox = Math.floor(rnd() * S * 0.25)
      const oy = Math.floor(rnd() * S * 0.25)
      ctx.drawImage(wrap, ox, oy, S, S, qx * Q, qy * Q, Q, Q)
    }
  }
  // 第二层 AO 灰度 detail（1024 无缝，二倍平铺）：低频污渍斑块
  const AO = 1024
  const ao = document.createElement('canvas')
  ao.width = ao.height = AO
  const actx = ao.getContext('2d')!
  actx.fillStyle = '#ffffff'
  actx.fillRect(0, 0, AO, AO)
  const rnd2 = mulberry(seed * 271)
  for (let i = 0; i < 72; i++) {
    const cx = rnd2() * AO
    const cy = rnd2() * AO
    const r = 40 + rnd2() * 130
    const a = 0.05 + rnd2() * 0.09
    const bright = rnd2() < 0.3
    // 9 倍环绕副本保证 canvas 边缘无缝
    for (let dx = -AO; dx <= AO; dx += AO) {
      for (let dy = -AO; dy <= AO; dy += AO) {
        const g = actx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r)
        const rgb = bright ? '255,255,255' : '30,28,24'
        g.addColorStop(0, `rgba(${rgb},${a})`)
        g.addColorStop(1, `rgba(${rgb},0)`)
        actx.fillStyle = g
        actx.fillRect(cx + dx - r, cy + dy - r, r * 2, r * 2)
      }
    }
  }
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(ao, 0, 0)
  ctx.drawImage(ao, AO, 0)
  ctx.drawImage(ao, 0, AO)
  ctx.drawImage(ao, AO, AO)
  // mega-tile 边界晕影带（0/Q/2Q 处），打破平铺重复规律
  const edge = 72
  for (const pos of [0, Q, Q * 2]) {
    const gv = ctx.createLinearGradient(pos - edge, 0, pos + edge, 0)
    gv.addColorStop(0, 'rgba(0,0,0,0.14)')
    gv.addColorStop(0.5, 'rgba(0,0,0,0)')
    gv.addColorStop(1, 'rgba(0,0,0,0.14)')
    ctx.fillStyle = gv
    ctx.fillRect(pos - edge, 0, edge * 2, Q * 2)
    const gh = ctx.createLinearGradient(0, pos - edge, 0, pos + edge)
    gh.addColorStop(0, 'rgba(0,0,0,0.14)')
    gh.addColorStop(0.5, 'rgba(0,0,0,0)')
    gh.addColorStop(1, 'rgba(0,0,0,0.14)')
    ctx.fillStyle = gh
    ctx.fillRect(0, pos - edge, Q * 2, edge * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

/** 阵营/枪身贴图 albedo 键与回退工厂表（模块级：单测可验证 CT/T 纹理源分离，R1a 回归） */
export const albedoKeys = [
  'concrete', 'wood', 'sand', 'metal',
  'gun_metal', 'gun_wood', 'gun_steel', 'gun_sleeve',
  'bot_ct', 'bot_t',
  'stone', 'roof', 'sandbag', 'rusted',
  'm4_basecolor', 'm4_roughness',
  'plaster', 'tile',
] as const
export const albedoFallback: Record<(typeof albedoKeys)[number], () => THREE.Texture> = {
  concrete: concreteTexture,
  wood: woodTexture,
  sand: sandTexture,
  metal: metalTexture,
  gun_metal: () => metalTexture(),
  gun_wood: () => woodTexture(),
  gun_steel: () => metalTexture(),
  gun_sleeve: () => sandTexture(),
  bot_ct: () => ctUniformTexture(),
  bot_t: () => sandTexture(),
  stone: stoneTexture,
  roof: roofTexture,
  sandbag: sandbagTexture,
  rusted: rustedTexture,
  m4_basecolor: () => woodTexture(),
  m4_roughness: () => metalTexture(),
  plaster: plasterTexture,
  tile: tileTexture,
}

/** 异步把生图表面贴图覆盖进 map（保留 ladder/glass 的 canvas 版），并补枪身/阵营键；onStep 报告进度。
 * PBR 升级：法线贴图以 `{key}_n` 键加载（缺失时静默跳过，不影响 albedo）。 */
export async function loadImageTextures(map: TextureMap, onStep?: (done: number, total: number) => void): Promise<void> {
  const jobs: Array<Promise<THREE.Texture>> = albedoKeys.map((k) => {
    const url = `/textures/${k}.png`
    const seed = MEGA_SEEDS[k]
    // V3：大面积表面走 2048 双层平铺合成（失败回退普通加载/程序化）
    return seed
      ? composeMegaTexture(url, seed).catch(() => loadOrFallback(url, albedoFallback[k]))
      : loadOrFallback(url, albedoFallback[k])
  })
  // 法线贴图（仅表面材质，缺失回退无操作）
  const normalKeys = ['concrete', 'wood', 'sand', 'stone', 'rusted', 'sandbag', 'plaster', 'tile'] as const
  jobs.push(
    ...normalKeys.map((k) =>
      new Promise<THREE.Texture | null>((resolve) => {
        new THREE.TextureLoader().load(
          `/textures/${k}_n.png`,
          (tex) => {
            tex.colorSpace = THREE.NoColorSpace
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping
            tex.anisotropy = 4
            resolve(tex)
          },
          undefined,
          () => resolve(null),
        )
      }).then((t) => {
        if (t) map[`${k}_n`] = t
        return t as unknown as THREE.Texture
      }),
    ),
  )
  // M4 GLB 专属法线（文件名不遵循 {key}_n 约定）
  jobs.push(
    new Promise<THREE.Texture | null>((resolve) => {
      new THREE.TextureLoader().load(
        '/textures/m4_normal.png',
        (tex) => {
          tex.colorSpace = THREE.NoColorSpace
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.anisotropy = 4
          resolve(tex)
        },
        undefined,
        () => resolve(null),
      )
    }).then((t) => {
      if (t) map['m4_normal'] = t
      return t as unknown as THREE.Texture
    }),
  )
  const settled = await Promise.all(
    jobs.map((j, i) =>
      j.then((tex) => {
        onStep?.(i + 1, jobs.length)
        return tex
      }),
    ),
  )
  for (let i = 0; i < albedoKeys.length; i++) map[albedoKeys[i]] = settled[i]
}

/** 印花贴图：白底生成图 → 运行时提取 alpha（越黑越不透明），用于投射弹孔/烧痕 */
/** #16 程序化血渍纹理（暗红斑 + 飞溅点，白底=透明、黑区=不透明，与 makeDecalPool 的 alpha 约定一致） */
export function makeBloodTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 128, 128)
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 46)
  g.addColorStop(0, 'rgba(30,0,0,0.95)')
  g.addColorStop(0.6, 'rgba(40,0,0,0.7)')
  g.addColorStop(1, 'rgba(40,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(64, 64, 46, 0, Math.PI * 2)
  ctx.fill()
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 20 + Math.random() * 42
    ctx.fillStyle = `rgba(30,0,0,${0.4 + Math.random() * 0.5})`
    ctx.beginPath()
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + Math.random() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export async function makeDecalTexture(url: string): Promise<THREE.Texture> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('decal load failed: ' + url))
    i.src = url
  })
  const c = document.createElement('canvas')
  c.width = c.height = img.width
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    // 亮度越低（越黑）→ 越不透明；白底 → 完全透明
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    px[i + 3] = Math.max(0, 255 - lum)
  }
  ctx.putImageData(data, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
