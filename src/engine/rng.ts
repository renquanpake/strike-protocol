/** 确定性 LCG 随机数发生器：同种子同序列，保证对局可回放/单测可复现 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** [0,1) */
  float(): number {
    this.state = (this.state * 48271) % 2147483647
    if (this.state <= 0) this.state += 2147483646
    return this.state / 2147483647
  }

  /** 锥内随机方向偏移：返回 [sin θ·cos φ, sin θ·sin φ, cos θ]，θ∈[0,maxAngle] */
  coneDirection(maxAngleRad: number): [number, number, number] {
    // 均匀分布于锥面
    const cosMax = Math.cos(maxAngleRad)
    const cosTheta = 1 - this.float() * (1 - cosMax)
    const theta = Math.acos(cosTheta)
    const phi = this.float() * Math.PI * 2
    return [
      Math.sin(theta) * Math.cos(phi),
      Math.sin(theta) * Math.sin(phi),
      Math.cos(theta),
    ]
  }

  get seed(): number {
    return this.state
  }
}
