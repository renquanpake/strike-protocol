import * as THREE from 'three'
import { CONFIG } from '../game/config'
import type { PlayerEntity } from '../game/state'
import { v3, type Vec3 } from '../engine/math'
import { activeWeapon } from '../game/systems/weapon'
import { WEAPONS, type WeaponCategory } from '../game/weapons'
import type { GameRenderer } from '../engine/renderer'
import type { TextureMap } from '../engine/textures'

/** 逐帧插值后的视角姿态（与相机一致，使枪身精确跟随视角） */
export interface VmPose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  crouching: boolean
  onGround: boolean
  velX: number
  velZ: number
}

function cloneTex(t: THREE.Texture | undefined): THREE.Texture {
  if (!t) return new THREE.Texture()
  const c = t.clone()
  c.needsUpdate = true
  return c
}

/**
 * 第一人称武器模型：按枪类用多部件几何（枪管/机匣/弹匣/握把/枪托/瞄具/枪身贴图）拼装，
 * 屏幕右下，行走摆动 + 开火后坐 + 切枪隐藏。
 * 局部坐标系：-Z 为枪口方向，+Y 为上，+X 为右。
 */
export class ViewModel {
  private bobPhase = 0
  private kick = 0
  private hideUntil = 0
  private lastDefId: string | null = null
  private muzzle: Vec3 = v3(0, -9999, 0)

  constructor(private renderer: GameRenderer, textures: TextureMap) {
    const metal = () => new THREE.MeshLambertMaterial({ map: cloneTex(textures.gun_metal), color: 0xffffff })
    const wood = () => new THREE.MeshLambertMaterial({ map: cloneTex(textures.gun_wood), color: 0xffffff })
    const steel = () => new THREE.MeshLambertMaterial({ map: cloneTex(textures.gun_metal), color: 0x555a61 })
    const blade = () => new THREE.MeshLambertMaterial({ color: 0xaab4c0 })

    // 各枪类部件组（注册进渲染器，按 id 驱动）
    this.buildRifle(metal, wood, steel)
    this.buildRifle(metal, wood, steel, 'vm_lmg') // 轻机枪：独立组，避免与步枪 GLB 替换冲突
    this.buildSmi(metal, wood)
    this.buildSniper(metal, wood, steel)
    this.buildShotgun(metal, wood)
    this.buildPistol(metal, steel)
    this.buildKnife(wood, blade)
    this.renderer.addDynamicSphere('vm_grenade2', 5, 0x4a5d3a)
    // 持枪手臂（第一人称前臂 + 手，握在枪柄/护木处）
    this.buildArms(wood)
  }

  private buildArms(wood: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_arms')
    const cloth = new THREE.MeshLambertMaterial({ color: 0x2c3138 })
    void wood
    // 约定：右手在组局部 z≈0（握把处），前臂向后（朝相机）延伸；组锚点由 update() 按 armAnchorZ 定位
    // 右前臂（握扳机）：从握把伸向右下
    this.part(g, new THREE.BoxGeometry(4, 4, 12), cloth, 4.5, -5, -6, -0.5, 0, 0.15)
    this.part(g, new THREE.BoxGeometry(3.5, 3.5, 4), cloth, 1.8, -3, 0) // 右手
    // 左前臂（托护木）
    this.part(g, new THREE.BoxGeometry(4, 4, 10), cloth, -4.5, -3.5, 7, -0.4, 0, -0.15)
    this.part(g, new THREE.BoxGeometry(3.5, 3.5, 4), cloth, -3, 0.5, 15) // 左手
    return g
  }

  private part(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    m.castShadow = false
    g.add(m)
  }

  private cyl(r: number, len: number, seg = 12): THREE.CylinderGeometry {
    const g = new THREE.CylinderGeometry(r, r, len, seg)
    g.rotateX(Math.PI / 2) // 轴向对准 Z
    return g
  }

  private buildRifle(metal: () => THREE.Material, wood: () => THREE.Material, steel: () => THREE.Material, id = 'vm_rifle'): THREE.Group {
    const g = this.renderer.addViewmodelGroup(id)
    this.part(g, new THREE.BoxGeometry(5, 5, 14), metal(), 0, 0, 11) // 机匣
    this.part(g, this.cyl(1.4, 14), steel(), 0, 0.5, -3) // 枪管
    this.part(g, this.cyl(1.8, 2.5), steel(), 0, 0.5, -10) // 消焰器
    this.part(g, new THREE.BoxGeometry(3.5, 4, 6), metal(), 0, -1, -4) // 护木
    this.part(g, new THREE.BoxGeometry(3, 9, 4), metal(), 0, -5, 9, 0.18) // 弹匣
    this.part(g, new THREE.BoxGeometry(3, 6, 3), wood(), -1, -5, 18, -0.35) // 握把
    this.part(g, new THREE.BoxGeometry(4, 4, 7), wood(), 0, 0, 22) // 枪托
    this.part(g, new THREE.BoxGeometry(1.5, 3, 1.5), metal(), 0, 3.5, -6) // 前准星
    this.part(g, new THREE.BoxGeometry(1.5, 2.5, 3), metal(), 0, 3.5, 18) // 后照门
    return g
  }

  private buildSmi(metal: () => THREE.Material, wood: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_smg')
    this.part(g, new THREE.BoxGeometry(4.5, 4.5, 11), metal(), 0, 0, 9) // 紧凑机匣
    this.part(g, this.cyl(1.2, 8), metal(), 0, 0.3, -1) // 短枪管
    this.part(g, new THREE.BoxGeometry(4, 3, 3), wood(), 0, -0.5, -4) // 护木
    this.part(g, new THREE.BoxGeometry(2.8, 10, 3.5), metal(), 0, -5.5, 9) // 直弹匣
    this.part(g, new THREE.BoxGeometry(2.6, 5, 2.6), wood(), -0.5, -4.5, 16, -0.3) // 握把
    this.part(g, new THREE.BoxGeometry(1.2, 2.5, 1.2), metal(), 0, 3, 14) // 照门
    return g
  }

  private buildSniper(metal: () => THREE.Material, wood: () => THREE.Material, steel: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_sniper')
    this.part(g, new THREE.BoxGeometry(5, 5, 16), metal(), 0, 0, 12) // 长机匣
    this.part(g, this.cyl(1.3, 22), steel(), 0, 0.6, -4) // 长枪管
    this.part(g, this.cyl(2, 14), steel(), 0, 4, 8) // 瞄准镜筒
    this.part(g, this.cyl(2.2, 2), metal(), 0, 4, 15) // 目镜
    this.part(g, new THREE.BoxGeometry(4, 4, 8), wood(), 0, -0.5, 24) // 枪托
    this.part(g, new THREE.BoxGeometry(3, 9, 4), metal(), 0, -5, 10) // 弹匣
    this.part(g, new THREE.BoxGeometry(2.6, 5, 2.6), wood(), -0.5, -4.5, 19, -0.3) // 握把
    // 两脚架
    this.part(g, new THREE.BoxGeometry(0.8, 0.8, 8), metal(), -2.5, -4, -6, 0.15)
    this.part(g, new THREE.BoxGeometry(0.8, 0.8, 8), metal(), 2.5, -4, -6, -0.15)
    return g
  }

  private buildShotgun(metal: () => THREE.Material, wood: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_shotgun')
    this.part(g, new THREE.BoxGeometry(5.5, 5.5, 13), metal(), 0, 0, 9) // 机匣
    this.part(g, this.cyl(1.8, 12), metal(), -1.4, 0.6, -2) // 双管
    this.part(g, this.cyl(1.8, 12), metal(), 1.4, 0.6, -2)
    this.part(g, new THREE.BoxGeometry(6, 3, 5), wood(), 0, -1, -3) // 泵/护木
    this.part(g, new THREE.BoxGeometry(4.5, 4.5, 6), wood(), 0, -0.5, 20) // 枪托
    this.part(g, new THREE.BoxGeometry(2.6, 5, 2.6), wood(), -0.5, -4.5, 15, -0.3) // 握把
    return g
  }

  private buildPistol(metal: () => THREE.Material, steel: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_pistol')
    this.part(g, new THREE.BoxGeometry(3.5, 3, 11), steel(), 0, 0, 6) // 套筒
    this.part(g, this.cyl(1, 4), steel(), 0, 0.2, -2) // 枪管口
    this.part(g, new THREE.BoxGeometry(3, 3, 3), metal(), 0, -1, 13) // 套筒座
    this.part(g, new THREE.BoxGeometry(3, 7, 3), metal(), 0, -5, 14, -0.28) // 握把
    this.part(g, new THREE.BoxGeometry(1, 2, 1), metal(), 0, 2, -1) // 准星
    return g
  }

  private buildKnife(wood: () => THREE.Material, blade: () => THREE.Material): THREE.Group {
    const g = this.renderer.addViewmodelGroup('vm_knife')
    const b = new THREE.BoxGeometry(1.5, 2.5, 16)
    b.translate(0, 0, -8)
    this.part(g, b, blade(), 0, 0, -2, 0, 0, 0.12) // 刀刃（前掠）
    this.part(g, new THREE.BoxGeometry(3, 4, 8), wood(), 0, -1, 10, -0.2) // 刀柄
    return g
  }

  setKick(ticks: number): void {
    this.kick = ticks
  }

  /** 用 GLB 高模替换某枪类的程序化部件（失败返回 false，保留程序化模型） */
  async upgradeWithGLB(cat: WeaponCategory, url: string, targetLen: number, zShift = -0.22): Promise<boolean> {
    try {
      const model = await this.renderer.loadViewModelGLB(url, targetLen, zShift)
      this.renderer.setViewmodelModel(`vm_${cat}`, model)
      this.glbCats.add(cat)
      return true
    } catch {
      return false
    }
  }

  getMuzzle(): Vec3 {
    return this.muzzle
  }

  private groupId(cat: string): string {
    return `vm_${cat}`
  }

  private glbCats = new Set<string>()

  /** 各枪类握把在组局部 z 的位置（手臂锚点跟随；GLB 枪握把在原点附近） */
  private armAnchorZ(cat: WeaponCategory): number {
    if (this.glbCats.has(cat)) return 2
    switch (cat) {
      case 'rifle':
      case 'lmg':
        return 18
      case 'smg':
        return 16
      case 'sniper':
        return 19
      case 'shotgun':
        return 15
      case 'pistol':
        return 14
      default:
        return 10
    }
  }

  hide(): void {
    for (const key of ['rifle', 'lmg', 'smg', 'sniper', 'shotgun', 'pistol', 'knife']) {
      this.renderer.updateViewmodelGroup(`vm_${key}`, 0, -9999, 0, 0, false)
    }
    this.renderer.updateDynamicSphere('vm_grenade2', 0, -9999, 0, false)
    this.renderer.updateViewmodelGroup('vm_arms', 0, -9999, 0, 0, false)
    this.kick = 0
  }

  update(p: PlayerEntity, pose: VmPose, tick: number): void {
    const w = activeWeapon(p)
    const defId = w?.defId ?? 'knife'
    if (this.lastDefId !== defId) {
      this.hideUntil = tick + 8
      this.lastDefId = defId
    }
    const cat = (WEAPONS[defId]?.category ?? 'knife') as WeaponCategory
    const isGrenade = cat === 'grenade'
    const hidden = tick < this.hideUntil

    const eyeY = pose.y + CONFIG.eyeHeight
    const right = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) }
    const fwd = { x: -Math.sin(pose.yaw), y: 0, z: -Math.cos(pose.yaw) }
    const ax = pose.x + right.x * 14
    const ay = eyeY - 14 + (pose.crouching ? 4 : 0)
    const az = pose.z + right.z * 14

    const sp = Math.hypot(pose.velX, pose.velZ)
    if (pose.onGround && sp > 10) this.bobPhase += 0.22 * (sp / CONFIG.moveMaxSpeed)
    const bobY = Math.sin(this.bobPhase) * 2.5

    if (this.kick > 0) this.kick -= 1
    const kickOff = 8 * (this.kick / 4)

    // 组中心 = 锚点 + 前向偏移（随后坐后退）
    const cx = ax + fwd.x * (14 - kickOff)
    const cy = ay + bobY
    const cz = az + fwd.z * (14 - kickOff)
    const rotY = pose.yaw + Math.PI

    // 隐藏全部枪类组与投掷物球
    for (const key of ['rifle', 'lmg', 'smg', 'sniper', 'shotgun', 'pistol', 'knife']) {
      this.renderer.updateViewmodelGroup(`vm_${key}`, 0, -9999, 0, 0, false)
    }
    this.renderer.updateDynamicSphere('vm_grenade2', 0, -9999, 0, false)

    // 显示当前枪类
    if (isGrenade) {
      this.renderer.updateDynamicSphere('vm_grenade2', cx, cy - 3, cz, !hidden)
    } else {
      this.renderer.updateViewmodelGroup(this.groupId(cat), cx, cy, cz, rotY, !hidden)
      // 持枪手臂：锚点沿枪轴前移到握把位置
      const a0 = this.armAnchorZ(cat)
      this.renderer.updateViewmodelGroup('vm_arms', ax + fwd.x * a0, cy, az + fwd.z * a0, rotY, !hidden && cat !== 'knife')
    }

    this.muzzle = v3(cx + fwd.x * (30 - kickOff), cy, cz + fwd.z * (30 - kickOff))
  }
}
