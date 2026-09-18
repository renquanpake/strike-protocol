import type { Vec3 } from '../engine/math'

export interface Shell {
  id: number
  position: Vec3
  velocity: Vec3
  /** 存活截止帧（渲染层用） */
  until: number
  active: boolean
}

export interface MuzzleFlash {
  position: Vec3
  /** 剩余显示 tick */
  ticks: number
}

/** 弹壳池更新：重力 + 地面反弹 + 寿命 */
export function updateShells(shells: Shell[], groundY: number, dt: number, gravity = 800): number {
  let activeCount = 0
  for (const s of shells) {
    if (!s.active) continue
    s.velocity.y -= gravity * dt
    s.position.x += s.velocity.x * dt
    s.position.y += s.velocity.y * dt
    s.position.z += s.velocity.z * dt
    if (s.position.y < groundY) {
      s.position.y = groundY
      s.velocity.y *= -0.4
      s.velocity.x *= 0.7
      s.velocity.z *= 0.7
    }
    if (s.until <= 0) s.active = false
    else s.until -= 1
    if (s.active) activeCount++
  }
  return activeCount
}

/** 从枪口生成一枚弹壳（右后上方抛出） */
export function spawnShell(
  shells: Shell[],
  id: number,
  muzzle: Vec3,
  right: Vec3,
  up: Vec3,
  forward: Vec3,
  lifeTicks: number,
): boolean {
  const slot = shells.find((s) => !s.active)
  if (!slot) return false
  slot.id = id
  slot.active = true
  slot.position = {
    x: muzzle.x + right.x * 8 + up.x * 6 + forward.x * 10,
    y: muzzle.y + right.y * 8 + up.y * 6 + forward.y * 10,
    z: muzzle.z + right.z * 8 + up.z * 6 + forward.z * 10,
  }
  slot.velocity = {
    x: right.x * 60 + (Math.random() - 0.5) * 40,
    y: 50 + Math.random() * 40,
    z: right.z * 60 + (Math.random() - 0.5) * 40,
  }
  slot.until = lifeTicks
  return true
}

/** 火光 tick 递减 */
export function updateMuzzle(flashes: MuzzleFlash[]): void {
  for (const f of flashes) f.ticks -= 1
}
