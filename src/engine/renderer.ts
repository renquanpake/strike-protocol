import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Vec3 } from './math'
import type { TextureMap } from './textures'

/** 单帧相机姿态（由 main 完成插值后下发） */
export interface CameraPose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

/** 靶子渲染规格（main 从 game 层映射，引擎层保持与玩法解耦） */
export interface TargetDef {
  id: number
  x: number
  y: number
  z: number
  alive: boolean
  flash: boolean
  /** 各部位的局部 AABB（与 addTargets 时传入一致） */
  parts: { min: Vec3; max: Vec3 }[]
}

const TARGET_PART_COLORS = [0xc0392b, 0xa93226, 0xa93226, 0x7b241c, 0x641e16]

/** 人物阵营配色：保留原贴图真实质感，用柔和阵营 tint 相乘（警冷蓝 / 匪暖沙）；
 *  强识别交给地面阵营光环 + 雷达点色 + 自发光 glow。键 = 阵营 accent */
const CHAR_TINTS: Record<number, { body: number; head: number; glow: number }> = {
  0xc8862a: { body: 0xe8d5b0, head: 0x8a7256, glow: 0xff7a1a }, // T 匪：暖沙色服 + 深褐头巾
  0x3f6fae: { body: 0xbcd0e8, head: 0x4a5a78, glow: 0x2f6fd8 }, // CT 警：冷蓝警服 + 深蓝警盔
}

export class GameRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private dprCap = 2

  /** #38：设置渲染分辨率上限（设备像素比） */
  setDprCap(v: number): void {
    this.dprCap = v
    this.renderer.setPixelRatio(v)
    this.resize()
  }

  /** #38：画质档位（低关阴影；中 2048 阴影；高 4096 阴影） */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.renderer.shadowMap.enabled = q !== 'low'
    if (this.sunLight) {
      const size = q === 'high' ? 4096 : 2048
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose()
        ;(this.sunLight.shadow as unknown as { map: null }).map = null
      }
      this.sunLight.shadow.mapSize.set(size, size)
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.castShadow = q !== 'low'
    })
  }

  constructor(canvas: HTMLCanvasElement, fov: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(this.dprCap)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // CS:GO 级画面基调：ACES 色调映射 + sRGB 输出（亮而不发灰，高光有电影感）
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 12000)
    // IBL 环境：PBR(Standard) 材质需要环境反射才能不发黑（RoomEnvironment PMREM）
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    // WebGL context 恢复后，three.js 自动重建程序/渲染器但不重传 skinned mesh 的
    // boneTexture（DataTexture），会导致蒙皮人物消失。切 tab / GPU 重置同样触发，
    // 故在 restored 时强制重传所有骨骼纹理。
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh
        if (!m.isSkinnedMesh || !m.skeleton) return
        // context 恢复后仅需重传骨骼纹理。切勿调用无参 skeleton.init() 或无 bindMatrix 的
        // bind()——会清空 bones/boneInverses/bindMatrix，彻底破坏蒙皮渲染。
        if (m.skeleton.boneTexture) m.skeleton.boneTexture.needsUpdate = true
      })
    })
    this.resize()
  }

  /** #1/#28：清空世界对象（box/grid/target/humanoid/动态/印花），保留相机、灯光、人物模板。
   * 每次 startMatch 调用后重建。 */
  resetWorld(): void {
    this.scene.children.slice().forEach((c) => this.scene.remove(c))
    this.dynBoxes.clear()
    this.dynSpheres.clear()
    this.viewmodels.clear()
    this.vmGroups.clear()
    this.humanoids.clear()
    this.decals = []
    this.targetMeshes = []
    this.charAnims.clear()
    this.charMats.clear()
    this.tracers.clear()
    this.particleClouds.clear()
    this.boxMatCache.clear()
    this.boxTexCache.clear()
    for (const l of this.dynLightPool) l.visible = false
  }

  /** 盒子材质/纹理共享缓存（同 repeat 组合复用材质与 GL 纹理实例，消除逐 brush 克隆的 VRAM 浪费） */
  private boxMatCache = new Map<string, THREE.MeshStandardMaterial>()
  private boxTexCache = new Map<string, THREE.Texture>()

  /** #13 曳光池（THREE.Line，additive） */
  private tracers: Map<string, { line: THREE.Line; mat: THREE.LineBasicMaterial; posAttr: THREE.BufferAttribute }> =
    new Map()

  addTracer(id: string, color: number = 0xffe08a): void {
    if (this.tracers.has(id)) return
    const geo = new THREE.BufferGeometry()
    const pos = new THREE.BufferAttribute(new Float32Array(6), 3)
    geo.setAttribute('position', pos)
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    const line = new THREE.Line(geo, mat)
    line.frustumCulled = false
    this.scene.add(line)
    this.tracers.set(id, { line, mat, posAttr: pos })
  }

  updateTracer(id: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, opacity: number): void {
    const t = this.tracers.get(id)
    if (!t) return
    t.posAttr.setXYZ(0, x1, y1, z1)
    t.posAttr.setXYZ(1, x2, y2, z2)
    t.posAttr.needsUpdate = true
    t.mat.opacity = opacity
    t.line.visible = opacity > 0
  }

  /** #32 粒子云（THREE.Points 随机球面偏移，整体跟随中心） */
  private particleClouds: Map<
    string,
    { points: THREE.Points; mat: THREE.PointsMaterial; base: Float32Array; count: number }
  > = new Map()

  addParticleCloud(id: string, count: number, color: number, size: number): void {
    if (this.particleClouds.has(id)) return
    const base = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      // 单位球内均匀
      const r = Math.cbrt(Math.random())
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      base[i * 3] = r * Math.sin(ph) * Math.cos(th)
      base[i * 3 + 1] = r * Math.cos(ph) * 0.6
      base[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
    }
    const geo = new THREE.BufferGeometry()
    const attr = new THREE.BufferAttribute(new Float32Array(base), 3)
    geo.setAttribute('position', attr)
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.55, depthWrite: false })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    this.scene.add(points)
    this.particleClouds.set(id, { points, mat, base, count })
  }

  updateParticleCloud(id: string, cx: number, cy: number, cz: number, radius: number, visible: boolean): void {
    const c = this.particleClouds.get(id)
    if (!c) return
    c.points.visible = visible
    if (!visible) return
    const attr = c.points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < c.count; i++) {
      attr.setXYZ(i, cx + c.base[i * 3] * radius, cy + c.base[i * 3 + 1] * radius, cz + c.base[i * 3 + 2] * radius)
    }
    attr.needsUpdate = true
  }

  /** #33 天空盒：渐变天穹（不受雾）+ 太阳斑 + 外围沙丘剪影（沙漠氛围） */
  addSkyDome(): void {
    const geo = new THREE.SphereGeometry(9000, 24, 12)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a6ea8) },
        horizon: { value: new THREE.Color(0xe8cfa0) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 1.6, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, top, h), 1.0);
        }
      `,
    })
    const dome = new THREE.Mesh(geo, mat)
    dome.renderOrder = -1
    this.scene.add(dome)
    // 太阳亮斑（sprite billboard）
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff2cc, fog: false }))
    sun.position.set(4200, 4600, 2400)
    sun.scale.set(900, 900, 1)
    this.scene.add(sun)
    // 外围沙丘剪影（外墙之外的远景色，不受雾）
    const duneMat = new THREE.MeshBasicMaterial({ color: 0xb09a72, fog: false, transparent: true, opacity: 0.55 })
    const duneGeo = new THREE.BoxGeometry(1, 1, 1)
    const dunes: [number, number, number, number, number, number][] = [
      [0, 60, 5400, 4600, 260, 600],
      [0, 90, -5400, 4600, 340, 600],
      [5400, 70, 0, 600, 280, 4400],
      [-5400, 50, 0, 600, 220, 4400],
    ]
    for (const [cx, cy, cz, w, h, d] of dunes) {
      const m = new THREE.Mesh(duneGeo, duneMat)
      m.scale.set(w, h, d)
      m.position.set(cx, cy, cz)
      m.rotation.y = Math.random() * 0.4
      this.scene.add(m)
    }
  }

  /** 运行时改 FOV（#3 设置层 / #8 开镜共用），调用方自行做逐帧插值。 */
  setFov(fov: number): void {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }

  private sunLight: THREE.DirectionalLight | null = null
  private dynLightPool: THREE.PointLight[] = []
  private dynLightUntil: number[] = []
  private dynLightIdx = 0

  /** 动态点光池（爆炸火光 / 闪光爆点，带 250ms 衰减） */
  addFlashLight(x: number, y: number, z: number, color: number, intensity: number, lifeMs = 260): void {
    if (this.dynLightPool.length === 0) {
      for (let i = 0; i < 8; i++) {
        const l = new THREE.PointLight(color, 0, 900, 2)
        l.visible = false
        this.scene.add(l)
        this.dynLightPool.push(l)
        this.dynLightUntil.push(0)
      }
    }
    const i = this.dynLightIdx++ % this.dynLightPool.length
    const l = this.dynLightPool[i]
    l.color.setHex(color)
    l.position.set(x, y, z)
    l.intensity = intensity
    l.visible = true
    this.dynLightUntil[i] = performance.now() + lifeMs
    // 强度按剩余寿命线性衰减（render 帧里逐帧读）
    ;(l as unknown as { _peak?: number })._peak = intensity
    ;(l as unknown as { _lifeMs?: number })._lifeMs = lifeMs
  }

  /** 每帧衰减动态光（render() 内调用） */
  private updateDynLights(): void {
    const now = performance.now()
    for (let i = 0; i < this.dynLightPool.length; i++) {
      const l = this.dynLightPool[i]
      if (!l.visible) continue
      const remain = this.dynLightUntil[i] - now
      if (remain <= 0) {
        l.visible = false
        l.intensity = 0
        continue
      }
      const peak = (l as unknown as { _peak?: number })._peak ?? 0
      const life = (l as unknown as { _lifeMs?: number })._lifeMs ?? 260
      l.intensity = peak * Math.max(0, remain / life)
    }
  }

  configure(sky: number, fogNear: number, fogFar: number, shadowExtent = 900, shadowMapSize = 2048): void {
    this.scene.background = new THREE.Color(sky)
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar)
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7a705c, 0.55)
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.1)
    sun.position.set(800, 1200, 500)
    sun.castShadow = true
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    const sc = sun.shadow.camera
    sc.left = -shadowExtent
    sc.right = shadowExtent
    sc.top = shadowExtent
    sc.bottom = -shadowExtent
    sc.near = 100
    sc.far = 6000
    sun.shadow.bias = -0.0004
    this.scene.add(hemi, sun)
    this.sunLight = sun
  }

  addGroundGrid(size: number, divisions: number, y: number): void {
    const grid = new THREE.GridHelper(size, divisions, 0x555555, 0x8a8a72)
    grid.position.y = y
    this.scene.add(grid)
  }

  addBox(min: Vec3, max: Vec3, color: number, opacity = 1, material?: string, textures?: TextureMap): THREE.Mesh {
    const w = max.x - min.x
    const h = max.y - min.y
    const d = max.z - min.z
    const tex = material ? textures?.[material] : undefined
    const nrm = material ? textures?.[`${material}_n`] : undefined
    const rx = Math.max(1, Math.round(Math.max(w, d) / 96))
    const ry = Math.max(1, Math.round(h / 96))
    // 金属系材质（枪金属/锈蚀/梯子）给金属度，其余哑光
    const metalish = material === 'metal' || material === 'gun_metal' || material === 'rusted' || material === 'ladder' || material === 'glass'
    const matKey = `${material ?? 'plain'}_${opacity}_${tex ? rx : 0}x${tex ? ry : 0}_${nrm ? 1 : 0}`
    let mat = this.boxMatCache.get(matKey)
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: metalish ? 0.55 : 0.95,
        metalness: metalish ? 0.5 : 0.02,
        transparent: opacity < 1,
        opacity,
      })
      if (tex) {
        const t = this.cachedClone(tex, `a:${tex.uuid}_${rx}_${ry}`)
        mat.map = t
        mat.color.setHex(0xffffff) // 贴图自带颜色
      }
      if (nrm) {
        const nt = this.cachedClone(nrm, `n:${nrm.uuid}_${rx}_${ry}`)
        nt.colorSpace = THREE.NoColorSpace
        mat.normalMap = nt
        mat.normalScale.set(0.55, 0.55)
      }
      this.boxMatCache.set(matKey, mat)
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(min.x + w / 2, min.y + h / 2, min.z + d / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  /** 克隆纹理实例并按 (源纹理, repeat) 缓存共享 */
  private cachedClone(tex: THREE.Texture, key: string): THREE.Texture {
    let t = this.boxTexCache.get(key)
    if (!t) {
      t = tex.clone()
      t.needsUpdate = true
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      const parts = key.split('_')
      t.repeat.set(Number(parts[parts.length - 2]), Number(parts[parts.length - 1]))
      this.boxTexCache.set(key, t)
    }
    return t
  }

  private targetMeshes: { id: number; group: THREE.Group; parts: THREE.Mesh[]; base: number[] }[] = []
  private dynBoxes: Map<string, { mesh: THREE.Mesh; w: number; h: number; d: number }> = new Map()
  private dynSpheres: Map<string, { mesh: THREE.Mesh }> = new Map()
  private viewmodels: Map<string, THREE.Mesh> = new Map()
  private vmGroups: Map<string, THREE.Group> = new Map()
  private humanoids: Map<
    string,
    {
      group: THREE.Group
      torsoMat: THREE.MeshLambertMaterial
      /** #31 死亡倒地：起始墙钟 ms（0=存活/未倒地），倒下方向 ±1 */
      fallStart: number
      fallDir: number
      /** 阵营色地面光环（T 橙 / CT 蓝），独立于 group，updateHumanoid 里平贴地面跟随 */
      teamRing: THREE.Object3D | null
      /** 烟雾剪影壳（人物进烟时罩住） */
      smokeShell: THREE.Mesh | null
    }
  > = new Map()
  private decals: { pool: THREE.Mesh[]; free: number[]; size: number; texture: THREE.Texture }[] = []

  // ===== 开源人物模型（Quaternius CC0）：模板 + 每实例动画状态 =====
  /** #30 阵营差异化：T/CT 各一人物模板（缺某阵营则回退共享模板） */
  private charTemplates: Record<'T' | 'CT', THREE.Object3D | null> = { T: null, CT: null }
  private charClipsByTeam: Record<'T' | 'CT', THREE.AnimationClip[]> = { T: [], CT: [] }
  private charTemplate: THREE.Object3D | null = null
  private charClips: THREE.AnimationClip[] = []
  private charScale = 1
  private charAnims: Map<
    string,
    {
      mixer: THREE.AnimationMixer
      idle?: THREE.AnimationAction
      move?: THREE.AnimationAction
      death?: THREE.AnimationAction
      current: 'idle' | 'move' | 'death'
      deathDone: boolean
    }
  > = new Map()
  private charMats: Map<number, Map<THREE.Material, THREE.Material>> = new Map()
  /** 人物黑边（倒置外壳）：共享膨胀几何 + 黑色 BackSide 材质 */
  private outlineGeoCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  private outlineMat: THREE.MeshBasicMaterial | null = null

  /** 加载人物 GLB 模板，按玩家身高 140u 归一化；失败返回 false（bot 退回色块人形）。
   * #30：team 指定阵营模板（缺该阵营时回退共享 charTemplate） */
  async loadCharacterModel(url: string, team: 'T' | 'CT' = 'T'): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url)
      // 作者残留：Armature 根带约 15° X 轴旋转，归零保持站立姿态笔直
      gltf.scene.traverse((o) => {
        if (o.name === 'Armature') o.quaternion.identity()
      })
      // 材质保留 PBR（Standard）：场景已有 IBL 环境（RoomEnvironment PMREM），金属/布料有真实质感。
      // 仅把残留的 Basic/Phong 归一到 Standard，避免发黑。
      const matSwap = new Map<THREE.Material, THREE.MeshStandardMaterial>()
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mesh.material = list.map((m) => {
          let l = matSwap.get(m)
          if (!l) {
            const pbr = m as THREE.MeshStandardMaterial
            l = new THREE.MeshStandardMaterial({
              map: pbr.map ?? undefined,
              normalMap: pbr.normalMap ?? undefined,
              roughnessMap: pbr.roughnessMap ?? undefined,
              metalnessMap: pbr.metalnessMap ?? undefined,
              roughness: pbr.roughness ?? 0.8,
              metalness: pbr.metalness ?? 0,
              emissive: new THREE.Color(0x000000),
            })
            l.name = pbr.name || ''
            matSwap.set(m, l)
          }
          return l
        })
      })
      this.charTemplate = gltf.scene
      this.charClips = gltf.animations
      // 归一化基准：skinned mesh 的 geometry bbox 是 bind pose（T 张开臂）范围，不可靠；
      // 改用骨骼世界坐标极端点实测站立高度（140u 与游戏玩家等高）
      gltf.scene.updateWorldMatrix(true, true)
      let miny = Infinity
      let maxy = -Infinity
      gltf.scene.traverse((o) => {
        const bone = o as THREE.Bone
        if (!bone.isBone) return
        const y = bone.matrixWorld.elements[13]
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      })
      const h = Math.max(maxy - miny, 1e-4)
      this.charScale = 140 / h
      gltf.scene.scale.setScalar(this.charScale)
      gltf.scene.position.y = -miny * this.charScale
      // #30 记录阵营模板（共享字段指向 T 模板以兼容旧逻辑）
      this.charTemplates[team] = gltf.scene
      this.charClipsByTeam[team] = gltf.animations
      if (team === 'T') {
        this.charTemplate = gltf.scene
        this.charClips = gltf.animations
      }
      if (import.meta.env.DEV) {
        console.log(`[char:${team}] ${url} h=${h.toFixed(3)} scale=${this.charScale.toFixed(2)} anims=${gltf.animations.length}`)
      }
      return true
    } catch (e) {
      console.warn(`[char:${team}] 加载失败，该阵营退回共享/色块人形`, e)
      this.charTemplates[team] = null
      return false
    }
  }

  /** #30 取某阵营人物模板（缺则回退共享 charTemplate） */
  private charTemplateFor(team: 'T' | 'CT'): THREE.Object3D | null {
    return this.charTemplates[team] ?? this.charTemplate
  }
  private charClipsFor(team: 'T' | 'CT'): THREE.AnimationClip[] {
    return this.charClipsByTeam[team].length > 0 ? this.charClipsByTeam[team] : this.charClips
  }

  /** 逐帧驱动所有人物动画混合器 */
  updateCharacters(dt: number): void {
    for (const a of this.charAnims.values()) a.mixer.update(dt)
  }

  addDynamicBox(id: string, w: number, h: number, d: number, color: number, opacity = 1): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    )
    this.scene.add(mesh)
    this.dynBoxes.set(id, { mesh, w, h, d })
  }

  updateDynamicBox(id: string, x: number, y: number, z: number, visible: boolean): void {
    const entry = this.dynBoxes.get(id)
    if (!entry) return
    entry.mesh.visible = visible
    // y 为脚底
    entry.mesh.position.set(x, y + entry.h / 2, z)
  }

  addDynamicSphere(id: string, r: number, color: number, opacity = 1): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 10),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    )
    this.scene.add(mesh)
    this.dynSpheres.set(id, { mesh })
  }

  updateDynamicSphere(id: string, x: number, y: number, z: number, visible: boolean): void {
    const entry = this.dynSpheres.get(id)
    if (!entry) return
    entry.mesh.visible = visible
    entry.mesh.position.set(x, y, z)
  }

  /** 第一人称武器模型部件（中心定位 + yaw 朝向，供 viewmodel 系统逐帧驱动） */
  addViewmodelBox(id: string, w: number, h: number, d: number, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }),
    )
    this.scene.add(mesh)
    this.viewmodels.set(id, mesh)
  }

  updateViewmodelBox(id: string, x: number, y: number, z: number, visible: boolean, rotY: number): void {
    const mesh = this.viewmodels.get(id)
    if (!mesh) return
    mesh.visible = visible
    mesh.position.set(x, y, z)
    mesh.rotation.set(0, rotY, 0)
  }

  /** 多部件 viewmodel 部件（任意几何体 + 材质，中心定位 + yaw 朝向） */
  addViewmodelMesh(id: string, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    this.scene.add(mesh)
    this.viewmodels.set(id, mesh)
  }

  /** 注册一个 viewmodel 部件组（供 viewmodel 系统逐帧驱动位置/朝向） */
  addViewmodelGroup(id: string): THREE.Group {
    const g = new THREE.Group()
    g.visible = false
    this.scene.add(g)
    this.vmGroups.set(id, g)
    return g
  }

  updateViewmodelGroup(id: string, x: number, y: number, z: number, rotY: number, visible: boolean): void {
    const g = this.vmGroups.get(id)
    if (!g) return
    g.visible = visible
    g.position.set(x, y, z)
    g.rotation.set(0, rotY, 0)
  }

  /**
   * 加载 GLB 武器模型并归一化：居中、缩放到目标长度（游戏单位）。
   * 朝向：Blender -Y 前向经 glTF 导出为 +Z，viewmodel 组自带 yaw+PI 旋转，
   * 恰好把 +Z 转回世界前向，wrap 无需再转。
   * zShift：沿枪轴平移比例（负值前移），使握把落在组原点、枪托贴近相机、枪管远伸（CS 式布局）。
   * 场景无环境贴图，金属度会让 PBR 材质发黑——加载时压低金属度并提亮反照率（共享材质只处理一次）。
   */
  async loadViewModelGLB(url: string, targetLen: number, zShift = 0.12): Promise<THREE.Object3D> {
    const gltf = await new GLTFLoader().loadAsync(url)
    const root = gltf.scene
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    root.position.sub(center)
    root.position.z -= zShift * size.z
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        // 共享材质只处理一次（sRGB 转换不可叠加）
        if (!('metalness' in std) || std.userData.vmLifted) continue
        std.userData.vmLifted = true
        // 无环境贴图的场景里金属度材质会发黑：归零金属度，暗反照率按亮度归一（上限 4 倍，保留材质对比）
        std.metalness = 0
        std.roughness = Math.max(std.roughness ?? 0.5, 0.55)
        if (std.color) {
          const c = std.color
          const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
          if (lum < 0.45) c.multiplyScalar(Math.min(4, 0.45 / Math.max(lum, 0.02)))
          c.convertLinearToSRGB()
        }
      }
    })
    const wrap = new THREE.Group()
    wrap.add(root)
    wrap.scale.setScalar(targetLen / Math.max(size.x, size.y, size.z, 1e-4))
    if (import.meta.env.DEV) {
      console.log(`[glb] ${url} size=(${size.x.toFixed(3)},${size.y.toFixed(3)},${size.z.toFixed(3)}) scale=${wrap.scale.x.toFixed(2)}`)
    }
    return wrap
  }

  /** 将加载好的模型挂进 viewmodel 组（替换程序化部件；手臂等独立组不受影响） */
  setViewmodelModel(id: string, model: THREE.Object3D): void {
    const g = this.vmGroups.get(id)
    if (!g) return
    g.clear()
    model.traverse((o) => {
      o.castShadow = false
      ;(o as THREE.Mesh).receiveShadow = false
    })
    g.add(model)
  }

  /** 注册一个 decal 池（同纹理多实例，投射到表面） */
  addDecalPool(size: number, texture: THREE.Texture, count: number): number {
    const pool: THREE.Mesh[] = []
    const mat = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      side: THREE.DoubleSide,
    })
    const geo = new THREE.PlaneGeometry(size, size)
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat)
      m.visible = false
      m.renderOrder = 1
      m.matrixAutoUpdate = true
      this.scene.add(m)
      pool.push(m)
    }
    const free = pool.map((_, i) => i)
    this.decals.push({ pool, free, size, texture: mat.map as THREE.Texture })
    return this.decals.length - 1
  }

  /** 在某表面法线处投射一个 decal（返回池序号或 -1） */
  spawnDecal(poolIdx: number, pos: Vec3, normal: Vec3, sizeScale = 1): number {
    const d = this.decals[poolIdx]
    if (!d) return -1
    const i = d.free.pop()
    if (i === undefined) return -1
    const m = d.pool[i]
    m.visible = true
    const s = d.size * sizeScale
    m.scale.set(s / d.size, s / d.size, 1)
    // 平面默认 +Z 朝外，旋到表面法线
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z).normalize())
    m.quaternion.copy(q)
    // 沿法线外偏 0.6u 避免 z-fighting
    m.position.set(pos.x + normal.x * 0.6, pos.y + normal.y * 0.6, pos.z + normal.z * 0.6)
    return i
  }

  /** 释放一个 decal 实例回池 */
  releaseDecal(poolIdx: number, instanceIdx: number): void {
    const d = this.decals[poolIdx]
    if (!d) return
    const m = d.pool[instanceIdx]
    if (m) m.visible = false
    d.free.push(instanceIdx)
  }

  /** 阵营色地面光环（独立 scene 对象，updateHumanoid 平贴地面跟随）：实心盘+描边，亮色醒目 */
  private ringGeo: THREE.RingGeometry | null = null
  private discGeo: THREE.CircleGeometry | null = null
  private ringColorFor(accent: number): number {
    return accent === 0x3f6fae ? 0x4a9ff0 : 0xff8a3a // CT 亮蓝（警）/ T 亮橙（匪）
  }
  makeTeamRing(accent: number): THREE.Mesh {
    const color = this.ringColorFor(accent)
    const grp = new THREE.Group()
    this.discGeo ??= new THREE.CircleGeometry(24, 36)
    this.ringGeo ??= new THREE.RingGeometry(20, 24, 36)
    const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }))
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }))
    for (const m of [disc, ring]) {
      m.rotation.x = -Math.PI / 2
      m.renderOrder = 2
      m.frustumCulled = false
    }
    disc.position.y = 0
    ring.position.y = 0.4
    grp.add(disc, ring)
    this.scene.add(grp)
    return grp as unknown as THREE.Mesh
  }

  /** 人形 bot：优先蒙皮人物模型（#30 按阵营选模板），模板缺失时退回色块盒人形 */
  addHumanoid(id: string, camo: THREE.Texture, accent: number, team: 'T' | 'CT' = 'T'): void {
    if (this.charTemplateFor(team) && this.charClipsFor(team).length > 0) {
      this.addSkinnedHumanoid(id, accent, team)
      return
    }
    if (this.charTemplate && this.charClips.length > 0) {
      this.addSkinnedHumanoid(id, accent, 'T')
      return
    }
    const group = new THREE.Group()
    const camoMat = new THREE.MeshLambertMaterial({ map: camo })
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x8a6b52 })
    const accentMat = new THREE.MeshLambertMaterial({ color: accent })
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      group.add(m)
      return m
    }
    // 腿（两条）
    add(new THREE.BoxGeometry(12, 55, 14), camoMat, -8, 27, 0)
    add(new THREE.BoxGeometry(12, 55, 14), camoMat, 8, 27, 0)
    // 躯干
    const torso = add(new THREE.BoxGeometry(30, 45, 18), camoMat, 0, 77, 0)
    // 胸前阵营色条
    add(new THREE.BoxGeometry(31, 10, 19), accentMat, 0, 84, 0)
    // 臂（两条）
    add(new THREE.BoxGeometry(9, 44, 11), camoMat, -22, 82, 0)
    add(new THREE.BoxGeometry(9, 44, 11), camoMat, 22, 82, 0)
    // 头
    add(new THREE.BoxGeometry(18, 18, 18), skinMat, 0, 112, 0)
    // 头盔
    add(new THREE.BoxGeometry(20, 10, 20), accentMat, 0, 120, 0)
    // 烟雾剪影壳（人物进烟时罩住，模拟烟中轮廓）
    const shell = this.makeSmokeShell()
    group.add(shell)
    this.scene.add(group)
    this.humanoids.set(id, {
      group,
      torsoMat: torso.material as THREE.MeshLambertMaterial,
      fallStart: 0,
      fallDir: Math.random() < 0.5 ? -1 : 1,
      teamRing: this.makeTeamRing(accent),
      smokeShell: shell,
    })
  }

  /** 烟雾剪影壳：半透明白雾圆柱罩（默认隐藏） */
  private makeSmokeShell(): THREE.Mesh {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(34, 40, 150, 12, 1, true),
      new THREE.MeshLambertMaterial({
        color: 0xd8dee4,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    shell.position.y = 75
    shell.visible = false
    shell.renderOrder = 5
    return shell
  }

  /** 蒙皮人物实例：克隆模板 + 阵营纯色身体 + 头部中性提亮 + idle/jog/death 动画状态（#30 按阵营选模板） */
  private addSkinnedHumanoid(id: string, accent: number, team: 'T' | 'CT' = 'T'): void {
    const template = this.charTemplateFor(team) ?? this.charTemplate!
    const clips = this.charClipsFor(team)
    const model = skeletonClone(template) as THREE.Group
    // 材质按 accent 缓存：身体保留贴图+阵营 tint、头部提亮、眼睛保留
    const tintDef = CHAR_TINTS[accent] ?? CHAR_TINTS[0xc8862a]
    let swapMap = this.charMats.get(accent)
    if (!swapMap) {
      swapMap = new Map()
      const swapRef = swapMap
      const bodyColor = new THREE.Color(tintDef.body)
      const headColor = new THREE.Color(tintDef.head)
      const glowColor = new THREE.Color(tintDef.glow)
      const seen = new Set<THREE.Material>()
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of list) {
          if (seen.has(m)) continue
          seen.add(m)
          const name = m.name || ''
          let dst: THREE.Material
          if (/eye/i.test(name)) {
            dst = m.clone() // 眼睛保留
          } else if (/visor|helmet|head|hair|brow|face|skull/i.test(name)) {
            const c = m.clone() as THREE.MeshStandardMaterial
            c.color.copy(headColor) // 头部/面罩/头盔：保留贴图，柔和阵营 tint
            c.emissive = new THREE.Color(0x000000)
            dst = c
          } else {
            const c = m.clone() as THREE.MeshStandardMaterial
            // 保留原贴图（真实质感），柔和阵营 tint 相乘；强识别交给地面光环/雷达/自发光
            c.color.copy(bodyColor)
            c.emissive = glowColor.clone().multiplyScalar(0.25) // 阵营色自发光（PBR 下收敛，防过曝）
            dst = c
          }
          swapRef.set(m, dst)
        }
      })
      this.charMats.set(accent, swapRef)
    }
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mesh.material = list.map((m) => swapMap!.get(m) ?? m)
    })
    // 动画：按候选名匹配（兼容不同模型命名：Idle/Run/Walk、Idle_Loop/Jog_Fwd_Loop/Death01 等）
    const mixer = new THREE.AnimationMixer(model)
    const pick = (...names: string[]): THREE.AnimationClip | undefined => {
      for (const n of names) {
        const c = clips.find((x) => x.name === n)
        if (c) return c
      }
      return undefined
    }
    const mk = (clip: THREE.AnimationClip, loop: THREE.AnimationActionLoopStyles): THREE.AnimationAction => {
      const a = mixer.clipAction(clip)
      a.loop = loop
      return a
    }
    const idleClip = pick('Idle_Loop', 'Idle', 'idle', 'Standing', 'stand')
    const moveClip = pick('Jog_Fwd_Loop', 'Run', 'run', 'Walk', 'Walk_Loop', 'walk', 'Jog')
    const deathClip = pick('Death01', 'Death', 'death', 'Dead', 'Hit_Chest')
    const idle = idleClip ? mk(idleClip, THREE.LoopRepeat) : undefined
    const move = moveClip ? mk(moveClip, THREE.LoopRepeat) : undefined
    const death = deathClip ? mk(deathClip, THREE.LoopOnce) : undefined
    if (death) death.clampWhenFinished = true
    const entry = { mixer, idle, move, death, current: 'idle' as const, deathDone: false }
    if (death) {
      mixer.addEventListener('finished', () => {
        entry.deathDone = true
        model.visible = false
      })
    }
    this.charAnims.set(id, entry)
    if (idle) idle.play()
    this.buildOutline(model)
    const shell = this.makeSmokeShell()
    model.add(shell)
    this.scene.add(model)
    this.humanoids.set(id, {
      group: model,
      torsoMat: null as unknown as THREE.MeshLambertMaterial,
      fallStart: 0,
      fallDir: Math.random() < 0.5 ? -1 : 1,
      teamRing: this.makeTeamRing(accent),
      smokeShell: shell,
    })
  }

  /** 人物黑边（倒置外壳）：对每个蒙皮网格生成法线膨胀的克隆几何，用黑色 BackSide 材质渲染出轮廓 */
  private buildOutline(model: THREE.Object3D): void {
    this.outlineMat ??= new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide })
    const th = 3.2 / this.charScale // 局部空间膨胀量（×charScale ≈ 3.2u 世界黑边宽）
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return
      let inflated = this.outlineGeoCache.get(m.geometry)
      if (!inflated) {
        inflated = this.inflateGeometry(m.geometry, th)
        this.outlineGeoCache.set(m.geometry, inflated)
      }
      const om = new THREE.SkinnedMesh(inflated, this.outlineMat!)
      om.skeleton = m.skeleton
      om.bind(m.skeleton, m.bindMatrix)
      om.frustumCulled = false
      om.castShadow = false
      om.receiveShadow = false
      om.renderOrder = -1
      om.position.copy(m.position)
      om.quaternion.copy(m.quaternion)
      om.scale.copy(m.scale)
      const parent = m.parent ?? model
      parent.add(om)
    })
  }

  /** 顶点沿法线外推，得到膨胀几何（用于倒置外壳黑边） */
  private inflateGeometry(geo: THREE.BufferGeometry, th: number): THREE.BufferGeometry {
    const g = geo.clone()
    const pos = g.attributes.position as THREE.BufferAttribute | undefined
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined
    if (pos && nrm && nrm.count === pos.count) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + nrm.getX(i) * th,
          pos.getY(i) + nrm.getY(i) * th,
          pos.getZ(i) + nrm.getZ(i) * th,
        )
      }
      pos.needsUpdate = true
    }
    g.computeBoundingSphere()
    return g
  }

  updateHumanoid(id: string, x: number, y: number, z: number, yaw: number, alive: boolean, flash: boolean, moving = false, smoked = false): void {
    const h = this.humanoids.get(id)
    if (!h) return
    const anim = this.charAnims.get(id)
    const nowMs = performance.now()

    // 阵营光环：平贴地面跟随 x/z（不随倒地/转向倾斜），存活才显示
    if (h.teamRing) {
      h.teamRing.position.set(x, 0.6, z)
      h.teamRing.visible = alive
    }
    // 烟雾剪影壳：存活且处于烟雾区时罩住人物
    if (h.smokeShell) h.smokeShell.visible = smoked && alive

    if (!alive) {
      // #31 死亡倒地：600ms 前扑倒地 + 随机偏航，尸体保留到回合重置
      if (h.fallStart === 0) h.fallStart = nowMs
      const p = Math.min(1, (nowMs - h.fallStart) / 600)
      const ease = 1 - (1 - p) * (1 - p)
      h.group.visible = true
      h.group.position.set(x, y, z)
      h.group.rotation.set((Math.PI / 2) * ease * h.fallDir, yaw + Math.PI, 0)
      // 蒙皮人物：若含 death 动画则叠加播放（骨级倒地），否则纯组级 topple
      if (anim && anim.death && !anim.deathDone) {
        if (anim.current !== 'death') {
          anim.current = 'death'
          anim.death.reset()
          anim.death.play()
          anim.idle?.stop()
          anim.move?.stop()
        }
      }
      return
    }

    // 复活/新回合：复位姿态
    if (h.fallStart !== 0) {
      h.fallStart = 0
      h.group.rotation.set(0, yaw + Math.PI, 0)
    }
    if (anim) {
      if (anim.current === 'death') {
        anim.deathDone = false
        anim.death?.stop()
        anim.current = 'idle'
        anim.idle?.reset().play()
      }
      h.group.visible = true
      h.group.position.set(x, y, z)
      h.group.rotation.set(0, yaw + Math.PI, 0)
      const want: 'idle' | 'move' = moving && anim.move ? 'move' : 'idle'
      if (want !== anim.current) {
        const from = want === 'move' ? anim.idle : anim.move
        const to = want === 'move' ? anim.move : anim.idle
        from?.fadeOut(0.18)
        to?.reset().fadeIn(0.18).play()
        anim.current = want
      }
      return
    }
    h.group.visible = true
    h.group.position.set(x, y, z)
    h.group.rotation.set(0, yaw + Math.PI, 0)
    h.torsoMat.color.setHex(flash ? 0xffffff : 0xffffff)
  }

  /** 隐藏某 decal 池全部实例（回合切换清场） */
  clearDecals(poolIdx: number): void {
    const d = this.decals[poolIdx]
    if (!d) return
    for (const m of d.pool) m.visible = false
    d.free = d.pool.map((_, i) => i)
  }

  addTargets(defs: TargetDef[]): void {
    for (const d of defs) {
      const group = new THREE.Group()
      group.position.set(d.x, d.y, d.z)
      const parts: THREE.Mesh[] = []
      const base: number[] = []
      d.parts.forEach((p, i) => {
        const color = TARGET_PART_COLORS[i % TARGET_PART_COLORS.length]
        base.push(color)
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(p.max.x - p.min.x, p.max.y - p.min.y, p.max.z - p.min.z),
          new THREE.MeshLambertMaterial({ color }),
        )
        mesh.position.set(
          (p.min.x + p.max.x) / 2,
          (p.min.y + p.max.y) / 2,
          (p.min.z + p.max.z) / 2,
        )
        group.add(mesh)
        parts.push(mesh)
      })
      this.scene.add(group)
      this.targetMeshes.push({ id: d.id, group, parts, base })
    }
  }

  updateTargets(defs: TargetDef[]): void {
    for (const d of defs) {
      const entry = this.targetMeshes.find((m) => m.id === d.id)
      if (!entry) continue
      entry.group.visible = d.alive
      entry.group.position.set(d.x, d.y, d.z)
      for (let i = 0; i < entry.parts.length; i++) {
        const mat = entry.parts[i].material as THREE.MeshLambertMaterial
        mat.color.setHex(d.flash ? 0xffffff : entry.base[i])
      }
    }
  }

  setCamera(pose: CameraPose): void {
    this.camera.position.set(pose.x, pose.y, pose.z)
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = pose.yaw
    this.camera.rotation.x = pose.pitch
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.updateDynLights()
    this.renderer.render(this.scene, this.camera)
  }
}
