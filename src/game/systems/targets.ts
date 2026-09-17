import type { GameState } from '../state'
import { makeTarget, type Target } from '../entities/target'

/** 靶子重生（每 tick） */
export function updateTargets(state: GameState): void {
  for (const t of state.targets) {
    if (!t.alive && state.tick >= t.respawnAtTick) {
      t.health = t.maxHealth
      t.alive = true
      t.hitFlashTick = -1
    }
  }
}

/** 练习场靶位：近/中/远三段距离（中位立于中央平台顶面 64u） */
export function rangeTargets(): Target[] {
  return [makeTarget(0, 0, 0, 80), makeTarget(1, 0, 64, -160), makeTarget(2, 0, 0, -400)]
}
