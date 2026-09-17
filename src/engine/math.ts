export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l > 1e-9 ? scale(a, 1 / l) : v3()
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
