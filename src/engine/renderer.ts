import * as THREE from 'three'
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
    this.resize()
  }

  configure(sky: number, fogNear: number, fogFar: number): void {
    this.scene.background = new THREE.Color(sky)
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar)
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7a705c, 0.85)
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.6)
    sun.position.set(800, 1200, 500)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -900
    sc.right = 900
    sc.top = 900
    sc.bottom = -900
    sc.near = 100
    sc.far = 4000
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
      t.repeat.set(Math.max(1, Math.round(w / 96)), Math.max(1, Math.round(h / 96)))
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

  /** 人形 bot：头/躯干/双臂/双腿 + 阵营材质，整体随位置与 yaw 更新 */
  addHumanoid(id: string, camo: THREE.Texture, accent: number): void {
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

  updateHumanoid(id: string, x: number, y: number, z: number, yaw: number, alive: boolean, flash: boolean): void {
    const h = this.humanoids.get(id)
    if (!h) return
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
