import type { GameState } from '../state'
import { makeTarget, type Target } from '../entities/target'

/** 靶子重生 + 移动靶驱动（每 tick） */
export function updateTargets(state: GameState, dt: number = 1 / 60): void {
  for (const t of state.targets) {
    if (!t.alive && state.tick >= t.respawnAtTick) {
      t.health = t.maxHealth
      t.alive = true
      t.hitFlashTick = -1
    }
    // #37 移动靶：往返运动
    if (t.alive && t.track) {
      const tr = t.track
      t.position[tr.axis] += tr.speed * tr.dir * dt
      if (t.position[tr.axis] > tr.base + tr.half) {
        t.position[tr.axis] = tr.base + tr.half
        tr.dir = -1
      } else if (t.position[tr.axis] < tr.base - tr.half) {
        t.position[tr.axis] = tr.base - tr.half
        tr.dir = 1
      }
    }
  }
}

/** 练习场靶位：近/中/远三段距离（中位立于中央平台顶面 64u） */
export function rangeTargets(): Target[] {
  return [makeTarget(0, 0, 0, 80), makeTarget(1, 0, 64, -160), makeTarget(2, 0, 0, -400)]
}

/** #37 训练场靶子：5 静靶（靶墙前）+ 2 移动靶（x 轴往返） */
export function trainingTargets(): Target[] {
  const list: Target[] = []
  // 静靶：立于靶墙前 32u 台上（台顶 y=32）
  const xs = [-480, -240, 0, 240, 480]
  xs.forEach((x, i) => {
    const t = makeTarget(i, x, 32, -380)
    list.push(t)
  })
  // 移动靶：x 轴往返（不同速度/幅度，练习甩狙）
  const m1 = makeTarget(5, -240, 32, -380)
  m1.track = { axis: 'x', base: -240, half: 160, speed: 60, dir: 1 }
  const m2 = makeTarget(6, 240, 32, -380)
  m2.track = { axis: 'x', base: 240, half: 160, speed: 90, dir: -1 }
  list.push(m1, m2)
  return list
}
