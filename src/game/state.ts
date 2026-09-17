import type { Vec3 } from '../engine/math'
import { v3 } from '../engine/math'
import type { Rng } from '../engine/rng'
import { Rng as RngCtor } from '../engine/rng'
import type { InputFrame } from '../engine/input'
import { emptyInput } from '../engine/input'
import type { WeaponInstance } from './weapons'
import { newWeaponInstance } from './weapons'
import type { Target } from './entities/target'
import type { Team } from './types'

export type RoundPhase =
  | 'warmup'
  | 'freeze'
  | 'live'
  | 'bombPlanted'
  | 'roundEnd'
  | 'halftime'
  | 'matchEnd'

export type RoundResult = 'elimination' | 'timeout' | 'bomb' | 'defuse'

export interface WeaponSlots {
  primary: WeaponInstance | null
  secondary: WeaponInstance | null
  knife: WeaponInstance
}

export interface PlayerEntity {
  id: number
  name: string
  team: Team
  isBot: boolean
  /** 脚底中心 */
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  onGround: boolean
  crouching: boolean
  onLadder: boolean
  lastGroundedTick: number
  health: number
  armor: number
  alive: boolean
  money: number
  kills: number
  deaths: number
  hasKit: boolean
  activeSlot: number
  weapons: WeaponSlots
  /** 本 tick 输入（Bot 为合成输入） */
  input: InputFrame
}

export interface C4State {
  state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded'
  carrierId: number | null
  site: 'A' | 'B' | null
  plantProgress: number
  defuseProgress: number
  explodeAtTick: number
  position: Vec3
}

export interface RoundState {
  phase: RoundPhase
  phaseEndTick: number
  roundNumber: number
  score: { T: number; CT: number }
  lossStreak: { T: number; CT: number }
  lastWinner: Team | null
  lastResult: RoundResult | null
  c4: C4State
  /** 半场是否已交换出生区 */
  sidesSwapped: boolean
}

export interface GameState {
  tick: number
  /** players[0] 为本地玩家 */
  players: PlayerEntity[]
  targets: Target[]
  round: RoundState
  rng: Rng
}

export function makePlayer(
  id: number,
  name: string,
  team: Team,
  isBot: boolean,
  spawn: Vec3,
  healthMax: number,
  startMoney: number,
): PlayerEntity {
  return {
    id,
    name,
    team,
    isBot,
    position: v3(spawn.x, spawn.y, spawn.z),
    velocity: v3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
    crouching: false,
    onLadder: false,
    lastGroundedTick: -1,
    health: healthMax,
    armor: 0,
    alive: true,
    money: startMoney,
    kills: 0,
    deaths: 0,
    hasKit: false,
    activeSlot: 1,
    weapons: {
      primary: null,
      secondary: newWeaponInstance('glock'),
      knife: newWeaponInstance('knife'),
    },
    input: emptyInput(),
  }
}

export function createGameState(
  spawnT: Vec3[],
  spawnCT: Vec3[],
  healthMax: number,
  startMoney: number,
  rngSeed = 0x5eed,
): GameState {
  const players: PlayerEntity[] = []
  // 本地玩家（T，id 0）
  players.push(makePlayer(0, 'YOU', 'T', false, spawnT[0], healthMax, startMoney))
  for (let i = 0; i < 4; i++) {
    players.push(makePlayer(i + 1, `T-${i + 1}`, 'T', true, spawnT[i + 1] ?? spawnT[0], healthMax, startMoney))
  }
  for (let i = 0; i < 5; i++) {
    const sp = spawnCT[i] ?? spawnCT[0] ?? spawnT[0]
    players.push(makePlayer(5 + i, `CT-${i + 1}`, 'CT', true, sp, healthMax, startMoney))
  }
  const c4: C4State = {
    state: 'carried',
    carrierId: 0,
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    explodeAtTick: 0,
    position: v3(),
  }
  return {
    tick: 0,
    players,
    targets: [],
    round: {
      phase: 'warmup',
      phaseEndTick: 0,
      roundNumber: 0,
      score: { T: 0, CT: 0 },
      lossStreak: { T: 0, CT: 0 },
      lastWinner: null,
      lastResult: null,
      c4,
      sidesSwapped: false,
    },
    rng: new RngCtor(rngSeed),
  }
}

export function teamPlayers(state: GameState, team: Team): PlayerEntity[] {
  return state.players.filter((p) => p.team === team)
}
