import type { Vec3 } from '../engine/math'
import { v3 } from '../engine/math'
import type { InputFrame } from '../engine/input'
import { emptyInput } from '../engine/input'

export interface PlayerState {
  /** 脚底中心 */
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  onGround: boolean
  crouching: boolean
  /** 最近一次着地 tick（M1 bhop 窗口用） */
  lastGroundedTick: number
}

export interface GameState {
  tick: number
  player: PlayerState
  input: InputFrame
}

export function createGameState(spawn: Vec3): GameState {
  return {
    tick: 0,
    player: {
      position: v3(spawn.x, spawn.y, spawn.z),
      velocity: v3(),
      yaw: 0,
      pitch: 0,
      onGround: false,
      crouching: false,
      lastGroundedTick: -1,
    },
    input: emptyInput(),
  }
}
