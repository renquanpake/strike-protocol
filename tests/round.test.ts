import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import type { LevelDef } from '../src/game/map/layout'
import { prepareLevel } from '../src/game/physics/collision'
import { updateRound } from '../src/game/systems/round'
import { buyItem, canBuyNow } from '../src/game/economy'
import { WEAPONS } from '../src/game/weapons'

const TICKS_1S = CONFIG.tickRate

function makeCtx() {
  const level: LevelDef = {
    name: 'round-test',
    spawns: {
      T: [
        v3(0, 0, 300),
        v3(40, 0, 300),
        v3(-40, 0, 300),
        v3(80, 0, 300),
        v3(-80, 0, 300),
      ],
      CT: [
        v3(0, 0, -300),
        v3(40, 0, -300),
        v3(-40, 0, -300),
        v3(80, 0, -300),
        v3(-80, 0, -300),
      ],
    },
    sites: [{ name: 'A', center: v3(0, 0, 0), half: 100, elevation: 0 }],
    brushes: [],
  }
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x77)
  const prepped = prepareLevel(level)
  const events = new EventBus()
  // 跳过 warmup，直接进入第 1 回合 freeze
  state.round.phase = 'warmup'
  state.tick = 0
  updateRound(state, prepped, events, 1 / CONFIG.tickRate)
  return { state, prepped, events, level }
}

function runTicks(state: GameState, prepped: ReturnType<typeof prepareLevel>, events: EventBus, ticks: number): void {
  for (let i = 0; i <= ticks; i++) {
    state.players.forEach((p) => (p.input = emptyInput()))
    state.tick = i
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
  }
}

describe('round & economy (M3)', () => {
  it('warmup → freeze → live 阶段迁移', () => {
    const { state, prepped, events } = makeCtx()
    expect(state.round.phase).toBe('freeze')
    expect(state.round.roundNumber).toBe(1)
    runTicks(state, prepped, events, TICKS_1S * 5)
    expect(state.round.phase).toBe('live')
  })

  it('冻结期内可以购买，窗口外被拒绝', () => {
    const { state, events } = makeCtx()
    const p = state.players[0]
    p.money = 4000
    expect(canBuyNow(state)).toBe(true)
    expect(buyItem(state, p, 'm4', events)).toBe(true)
    expect(p.weapons.primary?.defId).toBe('m4')
    expect(p.money).toBe(4000 - WEAPONS.m4.price)

    // live 已过 30s（购买窗口 20s）→ 拒绝
    state.round.phase = 'live'
    state.tick = TICKS_1S * 30
    state.round.phaseEndTick = TICKS_1S * 115
    expect(canBuyNow(state)).toBe(false)
    expect(buyItem(state, p, 'awp', events)).toBe(false)
    expect(p.weapons.primary?.defId).toBe('m4')
  })

  it('余额不足时购买被拒绝', () => {
    const { state, events } = makeCtx()
    const p = state.players[0]
    p.money = 100
    expect(buyItem(state, p, 'awp', events)).toBe(false)
    expect(p.money).toBe(100)
  })

  it('CT 团灭 → T 赢，胜方奖金 + 败方连败补偿', () => {
    const { state, prepped, events } = makeCtx()
    const t = state.players[0]
    const moneyBefore = t.money
    // 全灭 CT
    for (let i = 5; i < 10; i++) {
      state.players[i].alive = false
    }
    state.round.phase = 'live'
    state.round.phaseEndTick = state.tick + TICKS_1S * 115
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(state.round.lastWinner).toBe('T')
    expect(state.round.phase).toBe('roundEnd')
    expect(state.round.score.T).toBe(1)
    // endRound 内部已自动结算经济
    expect(t.money).toBe(moneyBefore + CONFIG.roundWinBonus)
    const ct = state.players[5]
    expect(ct.money).toBe(CONFIG.startMoney) // 首败无补偿
    expect(state.round.lossStreak.CT).toBe(1)
  })

  it('C4 安放在 A 点后进入 40s 倒计时，爆炸判 T 胜', () => {
    const { state, prepped, events } = makeCtx()
    const p = state.players[0]
    // 把 C4 携带者放到 A 点并持续按住 E
    p.position = v3(0, 0, 0)
    state.round.phase = 'live'
    state.round.phaseEndTick = state.tick + TICKS_1S * 115
    p.input = { ...emptyInput(), useHeld: true }
    // 推进 plantMs
    for (let i = 0; i < Math.round((CONFIG.plantMs / 1000) * CONFIG.tickRate); i++) {
      p.input = { ...emptyInput(), useHeld: true }
      state.tick += 1
      updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    }
    expect(state.round.c4.state).toBe('planted')
    expect(state.round.phase).toBe('bombPlanted')
    // 等待爆炸（推进到回合结束）
    while ((state.round.phase as string) === 'bombPlanted') {
      p.input = emptyInput()
      state.tick += 1
      updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    }
    expect(state.round.c4.state).toBe('exploded')
    expect(state.round.lastWinner).toBe('T')
    for (const pl of state.players) expect(pl.alive).toBe(false)
  })

  it('15 回合后进入 halftime 并交换出生区', () => {
    const { state, prepped, events } = makeCtx()
    const r = state.round
    // 模拟打到第 15 回合并让 CT 赢（团灭 T）
    for (let round = 2; round <= 15; round++) {
      r.roundNumber = round
      r.phase = 'live'
      r.phaseEndTick = state.tick + TICKS_1S * 115
      state.tick = 0
      for (let i = 0; i < 5; i++) state.players[i].alive = false
      updateRound(state, prepped, events, 1 / CONFIG.tickRate)
      expect(r.lastWinner).toBe('CT')
      if (round < 15) {
        r.phase = 'roundEnd'
        r.phaseEndTick = 0
        state.tick = 0
        updateRound(state, prepped, events, 1 / CONFIG.tickRate)
      }
    }
    expect(r.phase).toBe('halftime')
    expect(r.sidesSwapped).toBe(true)
  })

  it('#17 C4 掉落：T 侧存活者走近 40u 即拾取，CT 走近不拾取', () => {
    const { state, prepped, events } = makeCtx()
    const c4 = state.round.c4
    state.round.phase = 'live'
    state.round.phaseEndTick = state.tick + TICKS_1S * 115
    // 携包者死亡 → 掉落在 T-1 出生位
    c4.state = 'dropped'
    c4.carrierId = null
    state.players[0].position = v3(999, 0, 0) // 本地玩家远离
    c4.position = { ...state.players[1].position }
    // 一名 CT 也站到掉落点，验证不拾取
    state.players[5].position = { ...state.players[1].position }
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(c4.state).toBe('carried')
    expect(c4.carrierId).toBe(1)

    // CT 独占掉落点 → 保持 dropped（CT 出生位，所有 T 距离 >600u）
    c4.state = 'dropped'
    c4.carrierId = null
    state.players[1].position = v3(-999, 0, 0)
    c4.position = v3(0, 0, -300)
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(c4.state).toBe('dropped')
  })
})

function ffaLevel(): LevelDef {
  return {
    name: 'ffa-test',
    spawns: {
      T: spawnT(),
      CT: spawnCT(),
    },
    sites: [],
    brushes: [],
  }
}

function spawnT() {
  return [
    v3(0, 0, 300),
    v3(40, 0, 300),
    v3(-40, 0, 300),
    v3(80, 0, 300),
    v3(-80, 0, 300),
  ]
}
function spawnCT() {
  return [
    v3(0, 0, -300),
    v3(40, 0, -300),
    v3(-40, 0, -300),
    v3(80, 0, -300),
    v3(-80, 0, -300),
  ]
}

function makeFfaCtx(mode: 'dm' | 'tdm') {
  const level = ffaLevel()
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, {
    rngSeed: 0x77,
    mode,
    botCount: 9,
  })
  const prepped = prepareLevel(level)
  const events = new EventBus()
  state.round.phase = 'live'
  state.round.phaseEndTick = Infinity
  return { state, prepped, events }
}

describe('#26 加时 MR3', () => {
  function winRound(state: ReturnType<typeof makeCtx>['state'], prepped: ReturnType<typeof prepareLevel>, events: EventBus, winner: 'T' | 'CT'): void {
    const r = state.round
    r.phase = 'live'
    r.phaseEndTick = state.tick + 2
    state.tick += 1
    for (const pl of state.players) if (pl.team !== winner) pl.alive = false
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    // roundEnd → enterFreeze（下一回合）
    r.phaseEndTick = 0
    state.tick = 0
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
  }

  it('常规 15:15 进 OT1，OT 内每 3 回合换边，先到 19 胜结束', () => {
    const { state, prepped, events } = makeCtx()
    const r = state.round
    // makeCtx 已消耗第 1 回合（进入 freeze）；第 2-31 回合交替取胜 → 15:15
    for (let n = 2; n <= 31; n++) {
      const winner: 'T' | 'CT' = n % 2 === 0 ? 'T' : 'CT'
      winRound(state, prepped, events, winner)
      if (n === 31) {
        expect(r.score.T).toBe(15)
        expect(r.score.CT).toBe(15)
        expect(r.overtime).toBe(1)
        expect(r.phase).toBe('freeze')
      }
    }
    // OT1：再赢 4 回合让 T 到 19（=16+3 阈值）→ matchEnd；OT1 第 3 回合（round 33）节末换边
    for (let n = 32; n <= 35; n++) {
      const swappedBefore = r.sidesSwapped
      winRound(state, prepped, events, 'T')
      if (n === 34) expect(r.sidesSwapped).toBe(!swappedBefore) // OT 节末（round 33 结束）换边
      if (n < 35) expect(r.phase).not.toBe('matchEnd')
    }
    expect(r.score.T).toBe(19)
    expect(r.score.CT).toBe(15)
    expect(r.phase).toBe('matchEnd')
    expect(r.lastWinner).toBe('T')
  })
})

describe('#36 死斗/团队死斗', () => {
  it('dm：死亡 3s 后满血复活（避开敌人生成点）', () => {
    const { state, prepped, events } = makeFfaCtx('dm')
    const p = state.players[0]
    p.alive = false
    p.health = 0
    p.deathTick = state.tick
    const respawnTicks = Math.round((CONFIG.ffaRespawnMs / 1000) * CONFIG.tickRate)
    let revivedAt = -1
    for (let i = 1; i <= respawnTicks; i++) {
      state.tick += 1
      updateRound(state, prepped, events, 1 / CONFIG.tickRate)
      if (p.alive) {
        revivedAt = i
        break
      }
    }
    expect(revivedAt).toBe(respawnTicks)
    expect(p.health).toBe(CONFIG.healthMax)
    expect(p.deathTick).toBe(-1)
  })

  it('dm：个人击杀达标 → matchEnd', () => {
    const { state, prepped, events } = makeFfaCtx('dm')
    state.players[0].kills = CONFIG.dmKillTarget
    state.tick += 1
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(state.round.phase).toBe('matchEnd')
  })

  it('tdm：队伍击杀达标 → matchEnd（胜方取击杀多的一队）', () => {
    const { state, prepped, events } = makeFfaCtx('tdm')
    // T 队合计 50（= 目标），CT 队 51 → 都达标，CT 击杀更多判 CT 胜
    for (const pl of state.players) if (pl.team === 'T') pl.kills = 10
    state.players[5].kills = CONFIG.tdmKillTarget + 1
    state.tick += 1
    updateRound(state, prepped, events, 1 / CONFIG.tickRate)
    expect(state.round.phase).toBe('matchEnd')
    expect(state.round.lastWinner).toBe('CT')
  })
})
