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
import type { Brush } from './map/layout'

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
  /** 4 格投掷物槽（he/flash/smoke/molotov，未购为 null） */
  grenades: (WeaponInstance | null)[]
}

export type GrenadeKind = 'he' | 'flash' | 'smoke' | 'molotov'

export interface GrenadeState {
  id: number
  kind: GrenadeKind
  owner: number
  position: Vec3
  velocity: Vec3
  /** 引爆/落地起算 */
  fuseUntilTick: number
  exploded: boolean
}

export interface ZoneState {
  id: number
  center: Vec3
  radius: number
  untilTick: number
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
  /** #18：头盔（爆头减伤），与 armor 独立 */
  helmet: boolean
  alive: boolean
  money: number
  kills: number
  deaths: number
  hasKit: boolean
  activeSlot: number
  weapons: WeaponSlots
  /** 本局统计（#4 结算屏 / #40 生涯）：仅 matchEnd 前累计，回合不重置 */
  damageDealt: number
  headshotKills: number
  firstKills: number
  /** 闪光致盲截止 tick */
  blindUntil: number
  /** 脚步计时（ms 累计，触发 footstep 事件用） */
  stepTimer: number
  /** #36 死亡 tick（死斗复活计时），-1=存活 */
  deathTick: number
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
  /** #26：加时节数（0=常规时间；每节 3 回合，3:3 平进入下一节） */
  overtime: number
}

export interface DroppedWeapon {
  id: number
  defId: string
  position: Vec3
  ammoMag: number
  ammoReserve: number
}

export interface GameState {
  tick: number
  /** players[0] 为本地玩家 */
  players: PlayerEntity[]
  targets: Target[]
  round: RoundState
  rng: Rng
  /** 在场投掷物 */
  grenades: GrenadeState[]
  /** 烟雾区 / 燃烧区 */
  smokes: ZoneState[]
  burns: ZoneState[]
  nextGrenadeId: number
  nextZoneId: number
  /** #44：实际使用种子（随机开局也回写），同种子可复现 */
  seed: number
  /** #19：bot 难度 1-10 */
  difficulty: number
  /** #27：地面掉落武器（回合结束清空） */
  droppedWeapons: DroppedWeapon[]
  nextDropId: number
  /** #35：本回合被打碎的玻璃 brush（回合重置清空并恢复 solids） */
  brokenGlass: Brush[]
  /** #36 对局模式：de 爆破 / dm 死斗 / tdm 团队死斗（默认 de） */
  mode: 'de' | 'dm' | 'tdm'
  /** #37 训练场：无限弹药 / 金钱锁 / 伤害数字 */
  training: boolean
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
    helmet: false,
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
      grenades: [null, null, null, null],
    },
    damageDealt: 0,
    headshotKills: 0,
    firstKills: 0,
    blindUntil: 0,
    stepTimer: 0,
    deathTick: -1,
    input: emptyInput(),
  }
}

export interface MatchOptions {
  /** 总 bot 数（默认 9 → 5v5；本地玩家占自己阵营 1 席） */
  botCount?: number
  /** 本地玩家阵营（默认 T） */
  playerSide?: Team
  /** 本地玩家名（默认 YOU） */
  playerName?: string
  /** 随机种子（默认 0x5eed） */
  rngSeed?: number
  /** bot 难度 1-10（默认 5） */
  difficulty?: number
  /** #36 对局模式（默认 de 爆破） */
  mode?: 'de' | 'dm' | 'tdm'
}

/** #24：bot 名字池（CS 风，无重复） */
export const BOT_NAMES = [
  'Blaze', 'Havoc', 'Viper', 'Falcon', 'Dagger',
  'Ghost', 'Storm', 'Reaper', 'Cobra', 'Wolf',
  'Raptor', 'Nomad', 'Sable', 'Onyx', 'Fang',
]

export function createGameState(
  spawnT: Vec3[],
  spawnCT: Vec3[],
  healthMax: number,
  startMoney: number,
  optionsOrSeed: number | MatchOptions = 0x5eed,
): GameState {
  const options: MatchOptions =
    typeof optionsOrSeed === 'number' ? { rngSeed: optionsOrSeed } : optionsOrSeed
  const botCount = options.botCount ?? 9
  const playerSide = options.playerSide ?? 'T'
  const playerName = options.playerName ?? 'YOU'
  const seed = options.rngSeed ?? 0x5eed
  const difficulty = options.difficulty ?? 5
  const mode = options.mode ?? 'de'
  // 每侧人数 N：ceil((botCount+1)/2)，两侧合计 botCount+1（含本地玩家）
  const perSide = Math.max(1, Math.ceil((botCount + 1) / 2))
  const localTeamBots = perSide - 1
  const enemyBots = Math.max(0, botCount - localTeamBots)

  const players: PlayerEntity[] = []
  let nameSeq = 0
  const takeBotName = (): string => BOT_NAMES[nameSeq++ % BOT_NAMES.length]
  // 本地玩家（恒 id 0）
  const localSpawn = playerSide === 'T' ? spawnT[0] : spawnCT[0] ?? spawnT[0]
  players.push(makePlayer(0, playerName, playerSide, false, localSpawn, healthMax, startMoney))
  const localBotsSpawn = playerSide === 'T' ? spawnT : spawnCT
  for (let i = 0; i < localTeamBots; i++) {
    const sp = localBotsSpawn[i + 1] ?? localBotsSpawn[0]
    players.push(makePlayer(i + 1, takeBotName(), playerSide, true, sp, healthMax, startMoney))
  }
  const enemyBotsSpawn = playerSide === 'T' ? spawnCT : spawnT
  for (let i = 0; i < enemyBots; i++) {
    const sp = enemyBotsSpawn[i] ?? enemyBotsSpawn[0] ?? spawnT[0]
    players.push(makePlayer(players.length, takeBotName(), playerSide === 'T' ? 'CT' : 'T', true, sp, healthMax, startMoney))
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
      overtime: 0,
    },
    rng: new RngCtor(seed),
    grenades: [],
    smokes: [],
    burns: [],
    nextGrenadeId: 1,
    nextZoneId: 1,
    seed,
    difficulty,
    droppedWeapons: [],
    nextDropId: 1,
    brokenGlass: [],
    mode,
    training: false,
  }
}

export function teamPlayers(state: GameState, team: Team): PlayerEntity[] {
  return state.players.filter((p) => p.team === team)
}
