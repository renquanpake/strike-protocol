import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { Rng } from '../src/engine/rng'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type GameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { prepareLevel } from '../src/game/physics/collision'
import { buildNavGrid } from '../src/game/map/navmesh'
import { createBotContext, updateBots, pickTactic, type BotContext } from '../src/game/systems/bot'
import { updatePlayerMovement } from '../src/game/systems/movement'
import { updateWeaponSystem, fireWeapon } from '../src/game/systems/weapon'
import { updateGrenades } from '../src/game/systems/grenade'
import { updateRound } from '../src/game/systems/round'
import { newWeaponInstance } from '../src/game/weapons'

const DT = 1 / CONFIG.tickRate

function makeWorld() {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const nav = buildNavGrid(prepped, 48)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x99)
  const events = new EventBus()
  const ctx: BotContext = createBotContext(state, level.sites)
  // 直接进入第 1 回合 live（跳过 warmup/freeze）
  state.round.phase = 'live'
  state.round.phaseEndTick = state.tick + Math.round(115 * CONFIG.tickRate)
  state.round.roundNumber = 1
  return { state, prepped, nav, events, ctx, level }
}

function sim(state: GameState, ctx: BotContext, prepped: ReturnType<typeof prepareLevel>, nav: ReturnType<typeof buildNavGrid>, events: EventBus, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    state.players[0].input = emptyInput()
    updateBots(state, prepped, nav, ctx, events, DT)
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
}

describe('bot AI (M5)', () => {
  it('freeze 期 Bot 按经济购买主武器（T 系 AK / CT 系 M4）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.round.phase = 'freeze'
    state.round.roundNumber = 2 // 跳过首回合手枪轮
    state.tick = 0
    const bot = state.players[1] // T-1
    bot.money = 4000
    updateBots(state, prepped, nav, ctx, events, DT)
    expect(bot.weapons.primary?.defId).toBe('ak')
    expect(bot.activeSlot).toBe(0)
  })

  it('T Bot 沿导航推进到 A 点（距离收敛）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    ctx.processedRound = 1 // 跳过自动分配，手动指派
    const bot = state.players[1]
    const siteA = ctx.sites[0]
    // CT bots 停驻死角（CT spawn 内，远离 T bot 感知范围）
    for (let i = 5; i < 10; i++) {
      state.players[i].position = v3(400, 0, 1500)
      state.players[i].yaw = Math.PI
    }
    ctx.brains.get(bot.id)!.objective = v3(siteA.center.x, siteA.elevation, siteA.center.z)
    const startDist = Math.hypot(bot.position.x - siteA.center.x, bot.position.z - siteA.center.z)
    sim(state, ctx, prepped, nav, events, 1200) // ~19s
    const endDist = Math.hypot(bot.position.x - siteA.center.x, bot.position.z - siteA.center.z)
    expect(endDist).toBeLessThan(startDist * 0.5)
  })

  it('Bot 发现敌人后反应延迟内开火并造成伤害', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    const bot = state.players[1]
    const enemy = state.players[5]
    // 其余 Bot 停驻死角，只留 bot 与 enemy 对峙（long 走廊，LOS 清晰）
    for (let i = 0; i < 10; i++) {
      if (i === 1 || i === 5) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    // 面对面 200u（x 轴，long 走廊内）
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2 // 朝 +X
    enemy.position = v3(1300, 0, -300)
    enemy.yaw = Math.PI / 2 // 朝 -X
    bot.money = 4000
    bot.weapons.primary = null
    bot.activeSlot = 1 // glock 20 发
    state.round.phase = 'live'
    state.round.phaseEndTick = state.tick + 7360
    let shots = 0
    events.on('shot', (e) => {
      if (e.shooterId === bot.id) shots++
    })
    const enemyHpBefore = enemy.health
    sim(state, ctx, prepped, nav, events, 400) // ~6s
    expect(shots).toBeGreaterThan(0)
    expect(enemy.health).toBeLessThan(enemyHpBefore)
  })

  it('无干预完整对局：Bot 互战直至 matchEnd（本地挂机）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    let guard = 0
    const cap = 160000
    while (state.round.phase !== 'matchEnd' && guard < cap) {
      sim(state, ctx, prepped, nav, events, 256)
      guard += 256
    }
    expect(state.round.phase).toBe('matchEnd')
    const s = state.round.score
    expect(Math.max(s.T, s.CT)).toBe(CONFIG.winRounds)
    expect(guard).toBeLessThan(cap)
  })
})

describe('bot AI (M9 打磨)', () => {
  it('守点 Bot 到位后转向守点朝向（架枪）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    ctx.processedRound = 1 // 跳过自动目标分配，使用手动设置
    const bot = state.players[5] // CT
    // 把 CT 直接放到 A 平台西端，目标点设为当前所在（已到位）
    const siteA = ctx.sites[0]
    bot.position = v3(siteA.center.x - 325, siteA.elevation, siteA.center.z)
    ctx.brains.get(bot.id)!.objective = v3(bot.position.x, bot.position.y, bot.position.z)
    ctx.brains.get(bot.id)!.idleYaw = -Math.PI / 2 // 朝 +X（面向 A 点纵深）
    bot.yaw = Math.PI // 初始背对守点方向
    // 敌人停死角，避免进入交战分支
    for (let i = 0; i < 10; i++) {
      if (i === 5) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    state.round.phase = 'live'
    state.round.phaseEndTick = Infinity
    // 只驱动 Bot + 移动，不推进回合（避免越界重置位置/yaw）
    for (let i = 0; i < 600; i++) {
      state.players[0].input = emptyInput()
      updateBots(state, prepped, nav, ctx, events, DT)
      for (const p of state.players) {
        if (!p.alive) continue
        updatePlayerMovement(state, p, prepped, DT)
      }
      state.tick += 1
    }
    // 与 -π/2 的偏差应在 0.5 rad 内（转向收敛；yaw 按 2π 归一化比较）
    let d = Math.abs(bot.yaw - -Math.PI / 2)
    d = Math.min(d, Math.PI * 2 - d)
    expect(d).toBeLessThan(0.5)
  })

  it('完整对局双方互有斩获（有来有回）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.rng = new Rng(0x5eed) // 与主测试不同种子，验收“有来有回”
    const killsByTeam: Record<'T' | 'CT', number> = { T: 0, CT: 0 }
    events.on('playerKilled', (e) => {
      const killer = state.players.find((x) => x.id === e.attackerId)
      if (killer && e.victimId !== killer.id) killsByTeam[killer.team] += 1
    })
    let guard = 0
    const cap = 160000
    while (state.round.phase !== 'matchEnd' && guard < cap) {
      sim(state, ctx, prepped, nav, events, 256)
      guard += 256
    }
    expect(state.round.phase).toBe('matchEnd')
    // 双方都至少击杀过 1 名对方：有来有回，不是一边倒
    expect(killsByTeam.T).toBeGreaterThan(0)
    expect(killsByTeam.CT).toBeGreaterThan(0)
  })
})

describe('#19 Bot 难度分级', () => {
  it('难度表 10 档，第 5 档 = 现行回归基线', () => {
    expect(CONFIG.BOT_DIFFICULTY.length).toBe(10)
    const base = CONFIG.BOT_DIFFICULTY[4]
    expect(base.reactionMs).toEqual([200, 400])
    expect(base.sigmaMul).toBe(1)
    expect(base.tauMul).toBe(1)
    expect(base.viewRange).toBe(480)
    expect(base.strafePeriod).toBe(32)
  })

  it('档位单调：1 档反应最慢感知最弱，10 档最快最强', () => {
    const l1 = CONFIG.BOT_DIFFICULTY[0]
    const l10 = CONFIG.BOT_DIFFICULTY[9]
    expect(l1.reactionMs[0]).toBeGreaterThan(l10.reactionMs[0])
    expect(l1.viewRange).toBeLessThan(l10.viewRange)
    expect(l1.sigmaMul).toBeGreaterThan(l10.sigmaMul)
    expect(l1.strafePeriod).toBeGreaterThan(l10.strafePeriod)
  })

  it('createBotContext 按难度取档（越界收敛）', () => {
    const { state } = makeWorld()
    const sites = [] as { name: 'A' | 'B'; center: ReturnType<typeof v3>; elevation: number }[]
    expect(createBotContext(state, sites, 1).profile).toBe(CONFIG.BOT_DIFFICULTY[0])
    expect(createBotContext(state, sites, 5).profile).toBe(CONFIG.BOT_DIFFICULTY[4])
    expect(createBotContext(state, sites, 99).profile).toBe(CONFIG.BOT_DIFFICULTY[9])
  })
})

describe('#22 战术抽签（pickTactic 纯函数）', () => {
  const roll = (v: number) => ({ float: () => v })
  it('T：roll<0.3 rush / <0.6 slow / 否则 default', () => {
    expect(pickTactic(roll(0.1), 'T', 0)).toBe('rush')
    expect(pickTactic(roll(0.5), 'T', 0)).toBe('slow')
    expect(pickTactic(roll(0.9), 'T', 0)).toBe('default')
  })
  it('T 连败 ≥3：lurk 概率提升（roll<0.45）', () => {
    expect(pickTactic(roll(0.1), 'T', 3)).toBe('lurk')
    expect(pickTactic(roll(0.5), 'T', 3)).toBe('slow')
  })
  it('CT：roll<0.3 aggro / 否则 default；连败 ≥3 stack 概率提升', () => {
    expect(pickTactic(roll(0.1), 'CT', 0)).toBe('aggro')
    expect(pickTactic(roll(0.5), 'CT', 0)).toBe('default')
    expect(pickTactic(roll(0.1), 'CT', 3)).toBe('stack')
    expect(pickTactic(roll(0.5), 'CT', 3)).toBe('default')
  })
})

describe('#20 Bot 购买与投掷闪光弹', () => {
  it('freeze 期 T bot 有钱买 flash（grenades[1]）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.round.phase = 'freeze'
    state.round.roundNumber = 2 // 跳过首回合手枪轮
    state.tick = 0
    const bot = state.players[1]
    bot.money = 4000 // 主武器 + 全套雷预算（经济按序扣钱）
    updateBots(state, prepped, nav, ctx, events, DT)
    expect(bot.weapons.grenades[1]?.defId).toBe('flash')
    expect(bot.weapons.grenades[0]?.defId).toBe('he')
  })

  it('T bot 推进途中预投封烟（radio smokeOut，每 bot 每回合 1 颗）', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.round.phase = 'freeze'
    state.round.roundNumber = 2 // 跳过首回合手枪轮，bot 购买装备（含 smoke）
    state.tick = 0
    const bot = state.players[1] // T-1
    bot.money = 5000
    updateBots(state, prepped, nav, ctx, events, DT)
    expect(bot.weapons.grenades[2]?.defId).toBe('smoke')
    const brain = ctx.brains.get(1)!
    expect(brain.objective).toBeTruthy()
    // 进入 live：T bot 沿路径推进，距目标 >300u 时向爆点封烟
    state.round.phase = 'live'
    state.round.phaseEndTick = Infinity
    let smokeOut = 0
    events.on('radio', (m) => {
      if (m.key === 'smokeOut') smokeOut += 1
    })
    sim(state, ctx, prepped, nav, events, 1200)
    expect(smokeOut).toBeGreaterThanOrEqual(1)
    expect(brain.preSmoke).toBe(true)
    expect(bot.weapons.grenades[2]?.ammoMag).toBeLessThan(1)
  })

  it('flash 投掷：首发现目标且 <500u 时抛出闪光弹', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    ctx.processedRound = 1
    const bot = state.players[1]
    bot.weapons.grenades[1] = newWeaponInstance('flash')
    bot.weapons.grenades[0] = null
    const enemy = state.players[5]
    // 面对面 200u（long 走廊内，LOS 清晰，<500 投掷距离）
    bot.position = v3(1100, 0, -300)
    bot.yaw = -Math.PI / 2
    enemy.position = v3(1300, 0, -300)
    enemy.yaw = Math.PI / 2
    for (let i = 0; i < 10; i++) {
      if (i === 1 || i === 5) continue
      state.players[i].position = v3(400, 0, 1500)
    }
    state.round.phase = 'live'
    state.round.phaseEndTick = Infinity
    let threwFlash = false
    events.on('grenadeExploded', (e) => {
      if (e.kind === 'flash') threwFlash = true
    })
    sim(state, ctx, prepped, nav, events, 800)
    expect(bot.weapons.grenades[1]?.ammoMag).toBe(0)
    expect(threwFlash).toBe(true)
  })
})

describe('retake 目标重分配（队友阵亡）', () => {
  it('T 队友阵亡 → 存活 T bot 路径重置、目标回位爆点、出发延迟清零', () => {
    const { state, prepped, nav, events, ctx } = makeWorld()
    state.round.phase = 'live'
    state.round.roundNumber = 2
    ctx.processedRound = 2 // 跳过 freeze 抽签，聚焦 retake
    const tBots = state.players.filter((x) => x.isBot && x.team === 'T')
    // 阵亡一名 T bot（本 tick 死亡）
    tBots[0].alive = false
    tBots[0].deathTick = state.tick
    // 给存活 T bot 塞脏数据，验证 retake 会重置
    for (const b of tBots.slice(1)) {
      const brain = ctx.brains.get(b.id)!
      brain.objective = v3(9999, 0, 9999)
      brain.path = [v3(1, 0, 1), v3(2, 0, 2)]
      brain.waitUntilTick = state.tick + 500
    }
    updateBots(state, prepped, nav, ctx, events, DT)
    for (const b of tBots.slice(1)) {
      const brain = ctx.brains.get(b.id)!
      const onSite = ctx.sites.some(
        (s) => Math.hypot(s.center.x - brain.objective.x, s.center.z - brain.objective.z) < 60,
      )
      expect(onSite).toBe(true) // 目标被重分配到 A/B 爆点（脏数据 9999 被覆盖）
      expect(brain.waitUntilTick).toBe(0) // force 清除出发延迟
      expect(brain.reactionUntil).toBe(0) // 反应窗口重置
    }
  })
})
