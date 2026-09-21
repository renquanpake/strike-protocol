import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
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

/** 人物阵营配色：身体纯色 mannequin（去贴图保证远距阵营可读），头部保留贴图做中性提亮（键 = 阵营 accent） */
const CHAR_TINTS: Record<number, { body: number; head: number; glow: number }> = {
  0xc8862a: { body: 0xff9440, head: 0xd8d0c4, glow: 0xff7a1a },
  0x3f6fae: { body: 0x5f8ff0, head: 0xd8d0c4, glow: 0x2f5fd8 },
}

export class GameRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera

  constructor(canvas: HTMLCanvasElement, fov: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 12000)
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

  configure(sky: number, fogNear: number, fogFar: number, shadowExtent = 900): void {
    this.scene.background = new THREE.Color(sky)
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar)
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7a705c, 0.85)
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.6)
    sun.position.set(800, 1200, 500)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -shadowExtent
    sc.right = shadowExtent
    sc.top = shadowExtent
    sc.bottom = -shadowExtent
    sc.near = 100
    sc.far = 6000
    sun.shadow.bias = -0.0004
    this.scene.add(hemi, sun)
  }

  addGroundGrid(size: number, divisions: number, y: number): void {
    const grid = new THREE.GridHelper(size, divisions, 0x555555, 0x8a8a72)
    grid.position.y = y
    this.scene.add(grid)
  }

  addBox(min: Vec3, max: Vec3, color: number, opacity = 1, material?: string, textures?: TextureMap): void {
    const w = max.x - min.x
    const h = max.y - min.y
    const d = max.z - min.z
    const tex = material ? textures?.[material] : undefined
    const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity })
    if (tex) {
      const t = tex.clone()
      t.needsUpdate = true
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      // 水平取较大跨度（南北向长墙的 z 跨度也算），垂直取高
      t.repeat.set(Math.max(1, Math.round(Math.max(w, d) / 96)), Math.max(1, Math.round(h / 96)))
      mat.map = t
      mat.color.setHex(0xffffff) // 贴图自带颜色
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(min.x + w / 2, min.y + h / 2, min.z + d / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
  }

  private targetMeshes: { id: number; group: THREE.Group; parts: THREE.Mesh[]; base: number[] }[] = []
  private dynBoxes: Map<string, { mesh: THREE.Mesh; w: number; h: number; d: number }> = new Map()
  private dynSpheres: Map<string, { mesh: THREE.Mesh }> = new Map()
  private viewmodels: Map<string, THREE.Mesh> = new Map()
  private vmGroups: Map<string, THREE.Group> = new Map()
  private humanoids: Map<string, { group: THREE.Group; torsoMat: THREE.MeshLambertMaterial }> = new Map()
  private decals: { pool: THREE.Mesh[]; free: number[]; size: number; texture: THREE.Texture }[] = []

  // ===== 开源人物模型（Quaternius CC0）：模板 + 每实例动画状态 =====
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

  /** 加载人物 GLB 模板，按玩家身高 140u 归一化；失败返回 false（bot 退回色块人形） */
  async loadCharacterModel(url: string): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url)
      // 作者残留：Armature 根带约 15° X 轴旋转，归零保持站立姿态笔直
      gltf.scene.traverse((o) => {
        if (o.name === 'Armature') o.quaternion.identity()
      })
      // 材质统一转 Lambert（与游戏光照体系一致）：PBR Standard 在无环境贴图场景发黑
      const matSwap = new Map<THREE.Material, THREE.MeshLambertMaterial>()
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mesh.material = list.map((m) => {
          let l = matSwap.get(m)
          if (!l) {
            const pbr = m as THREE.MeshStandardMaterial
            l = new THREE.MeshLambertMaterial({ map: pbr.map ?? undefined })
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
      if (import.meta.env.DEV) {
        console.log(`[char] ${url} h=${h.toFixed(3)} scale=${this.charScale.toFixed(2)} anims=${this.charClips.length}`)
      }
      return true
    } catch (e) {
      console.warn('[char] 加载失败，bot 退回色块人形', e)
      this.charTemplate = null
      return false
    }
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

  /** 人形 bot：优先蒙皮人物模型，模板缺失时退回色块盒人形 */
  addHumanoid(id: string, camo: THREE.Texture, accent: number): void {
    if (this.charTemplate && this.charClips.length > 0) {
      this.addSkinnedHumanoid(id, accent)
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
    this.scene.add(group)
    this.humanoids.set(id, { group, torsoMat: torso.material as THREE.MeshLambertMaterial })
  }

  /** 蒙皮人物实例：克隆模板 + 阵营纯色身体 + 头部中性提亮 + idle/jog/death 动画状态 */
  private addSkinnedHumanoid(id: string, accent: number): void {
    const template = this.charTemplate!
    const model = skeletonClone(template) as THREE.Group
    // 材质按 accent 缓存：身体纯色 mannequin（去贴图）、头部/发保留贴图中性提亮、眼睛保留
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
          } else if (/hair|brow/i.test(name)) {
            const c = m.clone() as THREE.MeshLambertMaterial
            c.color.copy(headColor) // 头部/发：保留贴图，中性提亮
            c.emissive = new THREE.Color(0x000000)
            dst = c
          } else {
            const c = m.clone() as THREE.MeshLambertMaterial
            c.map = null // 身体：纯色 mannequin（去暗贴图），阵营色直接可见
            c.color.copy(bodyColor)
            c.emissive = glowColor.clone().multiplyScalar(0.18) // 阴影区兜底
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
    // 动画：Idle_Loop / Jog_Fwd_Loop / Death01
    const mixer = new THREE.AnimationMixer(model)
    const find = (name: string): THREE.AnimationClip | undefined => this.charClips.find((c) => c.name === name)
    const mk = (clip: THREE.AnimationClip, loop: THREE.AnimationActionLoopStyles): THREE.AnimationAction => {
      const a = mixer.clipAction(clip)
      a.loop = loop
      return a
    }
    const idleClip = find('Idle_Loop')
    const moveClip = find('Jog_Fwd_Loop')
    const deathClip = find('Death01')
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
    this.scene.add(model)
    this.humanoids.set(id, { group: model, torsoMat: null as unknown as THREE.MeshLambertMaterial })
  }

  updateHumanoid(id: string, x: number, y: number, z: number, yaw: number, alive: boolean, flash: boolean, moving = false): void {
    const h = this.humanoids.get(id)
    if (!h) return
    const anim = this.charAnims.get(id)
    if (anim) {
      if (!alive) {
        if (!anim.deathDone && anim.death) {
          if (anim.current !== 'death') {
            anim.current = 'death'
            anim.death.reset()
            anim.death.play()
            anim.idle?.stop()
            anim.move?.stop()
          }
        } else {
          h.group.visible = false
        }
        return
      }
      // 复活/新回合：回 idle
      if (anim.current === 'death') {
        anim.deathDone = false
        anim.death?.stop()
        anim.current = 'idle'
        anim.idle?.reset().play()
      }
      h.group.visible = true
      h.group.position.set(x, y, z)
      h.group.rotation.y = yaw + Math.PI
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
    h.group.visible = alive
    if (!alive) return
    h.group.position.set(x, y, z)
    h.group.rotation.y = yaw + Math.PI
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
    this.renderer.render(this.scene, this.camera)
  }
}
