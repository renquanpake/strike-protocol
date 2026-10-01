import { describe, expect, it } from 'vitest'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState, type PlayerEntity } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots, type BotContext } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'
import { newWeaponInstance } from '../src/game/weapons'

const DT = 1 / CONFIG.tickRate

/** 玩家视角对抗：本地玩家（T，C4 携带者）被脚本驱动执行「推进→下包→防守」，
 *  全体 CT bot 来抢拆/拦截。用于验证核心攻防闭环对玩家可用且可复现。 */

function makeWorld(seed: number) {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, {
    rngSeed: seed,
    botCount: 9,
    difficulty: 5,
  })
  const events = new EventBus()
  const ctx: BotContext = createBotContext(state, level.sites, 5)
  const me = state.players[0]
  me.weapons.primary = newWeaponInstance('m4')
  me.activeSlot = 0
  return { state, prepped, nav, ctx, events, level }
}

function nearestEnemy(state: GameState, p: PlayerEntity): PlayerEntity | null {
  let best: PlayerEntity | null = null
  let bd = Infinity
  for (const o of state.players) {
    if (o.id === p.id || !o.alive || o.team === p.team) continue
    const d = Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return best
}

function aimAt(p: PlayerEntity, t: PlayerEntity): void {
  const dx = t.position.x - p.position.x
  const dz = t.position.z - p.position.z
  const dy = 44 - CONFIG.eyeHeight
  const dist = Math.max(1, Math.hypot(dx, dz))
  p.yaw = Math.atan2(-dx, -dz)
  p.pitch = Math.atan2(dy, dist)
}

/** 以 maxSpeed u/s 直线逼近目标点（headless 下代替寻路，寻路由 navmesh/routes 测试覆盖） */
function stepToward(p: PlayerEntity, to: { x: number; z: number }, maxSpeed: number, dt: number): void {
  const dx = to.x - p.position.x
  const dz = to.z - p.position.z
  const d = Math.hypot(dx, dz)
  if (d < 2) return
  const step = Math.min(d, maxSpeed * dt)
  p.position.x += (dx / d) * step
  p.position.z += (dz / d) * step
}

export interface RunResult {
  state: GameState
  plantedRounds: number
  myKills: number
  damageTaken: number
  kills: number
  deaths: number
  matchEnd: boolean
  score: [number, number]
}

export function runMatch(seed: number, ticks: number, opts: { chase?: boolean } = {}): RunResult {
  const chase = opts.chase ?? false
  const { state, prepped, nav, ctx, events, level } = makeWorld(seed)
  state.round.phase = 'live'
  state.round.phaseEndTick = state.tick + Math.round(120 * CONFIG.tickRate)
  state.round.roundNumber = 1
  const siteA = level.sites[0]

  let plantedRounds = 0
  let myKills = 0
  let damageTaken = 0

  events.on('bombPlanted', () => {
    plantedRounds++
  })
  events.on('playerKilled', (e) => {
    if (e.attackerId === 0) myKills++
  })
  events.on('hit', (e) => {
    if (e.victimId === 0 && e.attackerId !== 0) damageTaken += e.damage
  })

  const me = state.players[0]
  const phaseOf = (): string => state.round.phase as string
  for (let i = 0; i < ticks; i++) {
    if (phaseOf() === 'matchEnd') break
    // updateBots 会为每个 bot 写好 p.input；本地玩家（id 0）由脚本策略覆盖
    updateBots(state, prepped, nav, ctx, events, DT)
    {
      const p = me
      if (p.alive) {
        const inp = emptyInput()
        const c4 = state.round.c4
        const enemy = nearestEnemy(state, p)
        const dEnemy = enemy ? Math.hypot(enemy.position.x - p.position.x, enemy.position.z - p.position.z) : Infinity
        // 近敌（650u）→ 交战优先（停步架枪）；chase 时中距敌逼近接敌；无近敌 → 推进 A 点下包
        if (enemy && dEnemy < 650) {
          aimAt(p, enemy)
          inp.fireHeld = true
        } else if (chase && enemy && dEnemy < 800) {
          stepToward(p, enemy.position, 500, DT)
          aimAt(p, enemy)
          inp.fireHeld = true
        } else if (state.round.phase === 'live' && c4.state === 'carried' && c4.carrierId === p.id) {
          stepToward(p, siteA.center, 500, DT)
          const dSite = Math.hypot(siteA.center.x - p.position.x, siteA.center.z - p.position.z)
          if (dSite <= siteA.half) inp.useHeld = true
        } else if (phaseOf() === 'bombPlanted' && c4.state === 'planted') {
          // 下包后防守：警戒并靠近 C4（CT 抢拆时交战分支自然接管）
          stepToward(p, { x: c4.position.x + 80, z: c4.position.z }, 400, DT)
        }
        if (p.weapons.primary && p.weapons.primary.ammoMag < 5 && p.weapons.primary.ammoMag > 0) {
          inp.reloadQueued = true
        }
        p.input = inp
      }
    }
    for (const p of state.players) {
      if (!p.alive) continue
      updatePlayerMovement(state, p, prepped, DT)
      updateWeaponSystem(state, p, events)
      fireWeapon(state, p, prepped, events)
    }
    updateGrenades(state, prepped, events, DT)
    updateRound(state, prepped, events, DT)
    state.tick += 1
  }

  return {
    state,
    plantedRounds,
    myKills,
    damageTaken,
    kills: me.kills,
    deaths: me.deaths,
    matchEnd: phaseOf() === 'matchEnd',
    score: [state.round.score.T, state.round.score.CT],
  }
}

describe('玩家视角对抗（脚本化本地玩家：T 下包 vs CT 抢拆）', () => {
  it('玩家能成功下包（对抗 CT 压力后达成核心目标）', () => {
    const r = runMatch(0xabc, 14000) // ~219s，跨多个回合
    expect(r.plantedRounds).toBeGreaterThan(0)
    expect(r.state.round.roundNumber).toBeGreaterThan(1)
  })

  it('对抗性：玩家与 bot 双向交火（玩家有击杀或承伤）', () => {
    const r = runMatch(0xabc, 14000, { chase: true })
    expect(r.myKills + (r.damageTaken > 0 ? 1 : 0)).toBeGreaterThan(0)
  })

  it('同种子 + 同策略可复现（对抗确定性）', () => {
    const a = runMatch(0x77, 9000)
    const b = runMatch(0x77, 9000)
    expect(a.plantedRounds).toBe(b.plantedRounds)
    expect(a.myKills).toBe(b.myKills)
    expect(a.damageTaken).toBeCloseTo(b.damageTaken, 1)
    expect(a.score).toEqual(b.score)
    expect(a.state.players[0].position.x).toBeCloseTo(b.state.players[0].position.x, 1)
  })

  it('回合状态机对玩家可见：回合推进 / 分数 / 可能的 matchEnd', () => {
    const r = runMatch(0xabc, 200000) // 长跑至 matchEnd
    expect(r.matchEnd).toBe(true)
    const [t, ct] = r.score
    expect(Math.max(t, ct)).toBe(CONFIG.winRounds)
  })
})
