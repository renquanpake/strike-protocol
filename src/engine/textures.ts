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

export type TextureMap = Record<string, THREE.Texture>

export function buildTextures(): TextureMap {
  return {
    concrete: concreteTexture(),
    metal: metalTexture(),
    wood: woodTexture(),
    sand: sandTexture(),
    ladder: ladderTexture(),
    glass: glassTexture(),
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

/** 异步把生图表面贴图覆盖进 map（保留 ladder/glass 的 canvas 版），并补枪身/阵营键 */
export async function loadImageTextures(map: TextureMap): Promise<void> {
  const entries = await Promise.all([
    loadOrFallback('/textures/concrete.png', concreteTexture),
    loadOrFallback('/textures/wood.png', woodTexture),
    loadOrFallback('/textures/sand.png', sandTexture),
    loadOrFallback('/textures/metal.png', metalTexture),
    loadOrFallback('/textures/gun_metal.png', () => metalTexture()),
    loadOrFallback('/textures/gun_wood.png', () => woodTexture()),
    loadOrFallback('/textures/bot_ct.png', () => metalTexture()),
    loadOrFallback('/textures/bot_t.png', () => sandTexture()),
  ])
  map.concrete = entries[0]
  map.wood = entries[1]
  map.sand = entries[2]
  map.metal = entries[3]
  map.gun_metal = entries[4]
  map.gun_wood = entries[5]
  map.bot_ct = entries[6]
  map.bot_t = entries[7]
}

/** 印花贴图：白底生成图 → 运行时提取 alpha（越黑越不透明），用于投射弹孔/烧痕 */
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
