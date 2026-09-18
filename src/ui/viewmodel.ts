import { CONFIG } from '../game/config'
import type { PlayerEntity } from '../game/state'
import { v3, type Vec3 } from '../engine/math'
import { activeWeapon } from '../game/systems/weapon'
import { WEAPONS } from '../game/weapons'
import type { GameRenderer } from '../engine/renderer'

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

/** 第一人称武器模型：方块拼装，屏幕右下角，行走摆动 + 开火后坐 + 切枪隐藏 */
export class ViewModel {
  private bobPhase = 0
  private kick = 0 // 剩余后坐 tick
  private hideUntil = 0
  private lastDefId: string | null = null
  private muzzle: Vec3 = v3(0, -9999, 0)

  constructor(private renderer: GameRenderer) {
    renderer.addViewmodelBox('vm_body', 6, 6, 20, 0x4a5058)
    renderer.addViewmodelBox('vm_barrel', 3, 3, 15, 0x2a2e34)
    renderer.addViewmodelBox('vm_mag', 4, 10, 5, 0x333941)
    renderer.addViewmodelBox('vm_grip', 4, 9, 5, 0x333941)
    renderer.addViewmodelBox('vm_sight', 2, 3, 4, 0x2a2e34)
    renderer.addViewmodelBox('vm_knife', 3, 3, 18, 0xb8c2cc)
    renderer.addDynamicSphere('vm_grenade', 5, 0x4a5d3a)
  }

  /** 本地玩家开火时调用 */
  setKick(ticks: number): void {
    this.kick = ticks
  }

  getMuzzle(): Vec3 {
    return this.muzzle
  }

  /** 本地玩家死亡时隐藏全部部件 */
  hide(): void {
    this.renderer.updateViewmodelBox('vm_body', 0, -9999, 0, false, 0)
    this.renderer.updateViewmodelBox('vm_barrel', 0, -9999, 0, false, 0)
    this.renderer.updateViewmodelBox('vm_mag', 0, -9999, 0, false, 0)
    this.renderer.updateViewmodelBox('vm_grip', 0, -9999, 0, false, 0)
    this.renderer.updateViewmodelBox('vm_sight', 0, -9999, 0, false, 0)
    this.renderer.updateViewmodelBox('vm_knife', 0, -9999, 0, false, 0)
    this.renderer.updateDynamicSphere('vm_grenade', 0, -9999, 0, false)
    this.kick = 0
  }

  update(p: PlayerEntity, pose: VmPose, tick: number): void {
    const w = activeWeapon(p)
    const defId = w?.defId ?? 'knife'
    if (this.lastDefId !== defId) {
      this.hideUntil = tick + 8
      this.lastDefId = defId
    }
    const cat = WEAPONS[defId]?.category ?? 'knife'
    const hidden = tick < this.hideUntil
    const rotY = pose.yaw + Math.PI

    // 锚点：眼位右下 16u（更深贴角落，枪口朝前指）
    const eyeY = pose.y + CONFIG.eyeHeight
    const right = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) }
    const fwd = { x: -Math.sin(pose.yaw), y: 0, z: -Math.cos(pose.yaw) }
    const ax = pose.x + right.x * 16
    const ay = eyeY - 16 + (pose.crouching ? 4 : 0)
    const az = pose.z + right.z * 16

    // 行走摆动（地面且移动时）
    const sp = Math.hypot(pose.velX, pose.velZ)
    if (pose.onGround && sp > 10) this.bobPhase += 0.22 * (sp / CONFIG.moveMaxSpeed)
    const bobY = Math.sin(this.bobPhase) * 3

    // 后坐：枪沿视线后退
    if (this.kick > 0) this.kick -= 1
    const kickOff = 9 * (this.kick / 4)

    const px = ax + fwd.x * (18 - kickOff)
    const py = ay + bobY
    const pz = az + fwd.z * (18 - kickOff)

    this.renderer.updateViewmodelBox('vm_body', px, py, pz, !hidden && cat !== 'knife', rotY)
    this.renderer.updateViewmodelBox(
      'vm_barrel',
      ax + fwd.x * (30 - kickOff),
      py,
      az + fwd.z * (30 - kickOff),
      !hidden && (cat === 'rifle' || cat === 'sniper' || cat === 'smg' || cat === 'shotgun'),
      rotY,
    )
    this.renderer.updateViewmodelBox('vm_mag', ax + fwd.x * (17 - kickOff), py - 7, az + fwd.z * (17 - kickOff), !hidden && cat !== 'knife', rotY)
    this.renderer.updateViewmodelBox('vm_grip', ax + fwd.x * (13 - kickOff), py - 8, az + fwd.z * (13 - kickOff), !hidden && cat !== 'knife', rotY)
    this.renderer.updateViewmodelBox('vm_sight', ax + fwd.x * (25 - kickOff), py + 4, az + fwd.z * (25 - kickOff), !hidden && cat === 'sniper', rotY)
    this.renderer.updateViewmodelBox('vm_knife', ax + fwd.x * (22 - kickOff), py - 2, az + fwd.z * (22 - kickOff), !hidden && cat === 'knife', rotY)
    this.renderer.updateDynamicSphere('vm_grenade', ax + fwd.x * 14, py - 3, az + fwd.z * 14, !hidden && cat === 'grenade')

    // 枪口位置（火光用）：枪管末端
    this.muzzle = v3(ax + fwd.x * (40 - kickOff), py, az + fwd.z * (40 - kickOff))
  }
}
