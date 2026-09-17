import type { Vec3 } from '../engine/math'
import { v3 } from '../engine/math'
import type { Rng } from '../engine/rng'
import { Rng as RngCtor } from '../engine/rng'
import type { InputFrame } from '../engine/input'
import { emptyInput } from '../engine/input'
import type { WeaponInstance } from './weapons'
import { newWeaponInstance } from './weapons'
import type { Target } from './entities/target'

export interface WeaponSlots {
  primary: WeaponInstance | null
  secondary: WeaponInstance | null
  knife: WeaponInstance
}

export interface PlayerState {
  /** 脚底中心 */
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  onGround: boolean
  crouching: boolean
  onLadder: boolean
  /** 0-100，坠落伤害等扣减 */
  health: number
  /** 最近一次着地 tick（bhop 窗口用） */
  lastGroundedTick: number
  /** 0=primary 1=secondary 2=knife */
  activeSlot: number
  weapons: WeaponSlots
}

export interface GameState {
  tick: number
  player: PlayerState
  input: InputFrame
  rng: Rng
  targets: Target[]
}

export function createGameState(spawn: Vec3, healthMax: number, rngSeed = 0x5eed): GameState {
  return {
    tick: 0,
    player: {
      position: v3(spawn.x, spawn.y, spawn.z),
      velocity: v3(),
      yaw: 0,
      pitch: 0,
      onGround: false,
      crouching: false,
      onLadder: false,
      health: healthMax,
      lastGroundedTick: -1,
      activeSlot: 1,
      weapons: {
        primary: null,
        secondary: newWeaponInstance('glock'),
        knife: newWeaponInstance('knife'),
      },
    },
    input: emptyInput(),
    rng: new RngCtor(rngSeed),
    targets: [],
  }
}
