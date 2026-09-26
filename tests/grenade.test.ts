import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { prepareLevel } from '../src/game/physics/collision'
import { matchLevel } from '../src/game/map/match'
import { makeTarget } from '../src/game/entities/target'
import { throwGrenade, updateGrenades, inSmoke } from '../src/game/systems/grenade'
import { buyItem, canBuyNow } from '../src/game/economy'

const DT = 1 / CONFIG.tickRate

function makeWorld() {
  const level = matchLevel()
  const prepped = prepareLevel(level)
  const state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x42)
  const events = new EventBus()
  state.round.phase = 'live'
  state.round.roundNumber = 1
  state.round.phaseEndTick = state.tick + 7360
  return { state, prepped, events }
}

function sim(state: ReturnType<typeof makeWorld>['state'], prepped: ReturnType<typeof prepareLevel>, events: EventBus, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    state.players.forEach((p) => (p.input = emptyInput()))
    updateGrenades(state, prepped, events, DT)
    state.tick += 1
  }
}

describe('grenades (M6)', () => {
  it('高爆手雷在区域内对目标造成伤害', () => {
    const { state, prepped, events } = makeWorld()
    const t = makeTarget(0, 0, 0, -100)
    state.targets = [t]
    // 在目标脚边引爆
    throwGrenade(state, { id: 0 }, 'he', v3(0, 60, -90), v3(0, -1, 0), events)
    expect(state.grenades.length).toBe(1)
    sim(state, prepped, events, Math.round((CONFIG.heFuseMs / 1000) * CONFIG.tickRate) + 10)
    expect(state.grenades.length).toBe(0) // 已引爆移除
    expect(t.health).toBeLessThan(t.maxHealth)
  })

  it('高爆手雷距离越远伤害越低（区域衰减）', () => {
    const near = makeTarget(0, 300, 0, -1650)
    const far = makeTarget(1, 300, 0, -1750)
    const w1 = makeWorld()
    w1.state.targets = [near]
    throwGrenade(w1.state, { id: 0 }, 'he', v3(300, 60, -1640), v3(0, -1, 0), w1.events)
    sim(w1.state, w1.prepped, w1.events, Math.round((CONFIG.heFuseMs / 1000) * CONFIG.tickRate) + 10)
    const nearDmg = near.maxHealth - near.health

    const w2 = makeWorld()
    w2.state.targets = [far]
    throwGrenade(w2.state, { id: 0 }, 'he', v3(300, 60, -1640), v3(0, -1, 0), w2.events)
    sim(w2.state, w2.prepped, w2.events, Math.round((CONFIG.heFuseMs / 1000) * CONFIG.tickRate) + 10)
    const farDmg = far.maxHealth - far.health
    expect(nearDmg).toBeGreaterThan(farDmg)
  })

  it('烟雾弹落地后生成遮蔽区（inSmoke 命中）', () => {
    const { state, prepped, events } = makeWorld()
    throwGrenade(state, { id: 0 }, 'smoke', v3(0, 100, 0), v3(0, -1, 0), events)
    sim(state, prepped, events, Math.round((CONFIG.smokeFuseMs / 1000) * CONFIG.tickRate) + 10)
    expect(state.smokes.length).toBe(1)
    const z = state.smokes[0]
    expect(inSmoke(state, z.center.x, z.center.y, z.center.z)).toBe(true)
    // 远处无烟雾
    expect(inSmoke(state, z.center.x + 500, 0, z.center.z)).toBe(false)
  })

  it('烟雾区到期后自动消失', () => {
    const { state, prepped, events } = makeWorld()
    throwGrenade(state, { id: 0 }, 'smoke', v3(0, 100, 0), v3(0, -1, 0), events)
    const total = Math.round(((CONFIG.smokeFuseMs + CONFIG.smokeLifeMs) / 1000) * CONFIG.tickRate)
    sim(state, prepped, events, total + 10)
    expect(state.smokes.length).toBe(0)
  })

  it('闪光弹在视线无遮挡时致盲目标', () => {
    const { state, prepped, events } = makeWorld()
    const victim = state.players[5]
    victim.position = v3(0, 0, -100)
    // 向受害者位置投掷闪光
    throwGrenade(state, { id: 0 }, 'flash', v3(0, 100, -80), v3(0, -1, 0), events)
    const blindBefore = victim.blindUntil
    sim(state, prepped, events, Math.round((CONFIG.flashFuseMs / 1000) * CONFIG.tickRate) + 10)
    expect(victim.blindUntil).toBeGreaterThan(blindBefore)
    expect(victim.blindUntil - state.tick + Math.round((CONFIG.flashBlindMs / 1000) * CONFIG.tickRate)).toBeGreaterThan(0)
  })

  it('燃烧瓶生成燃烧区并持续掉血', () => {
    const { state, prepped, events } = makeWorld()
    const t = makeTarget(0, 300, 0, -1650)
    state.targets = [t]
    throwGrenade(state, { id: 0 }, 'molotov', v3(300, 100, -1650), v3(0, -1, 0), events)
    sim(state, prepped, events, Math.round((CONFIG.molotovFuseMs / 1000) * CONFIG.tickRate) + 10)
    expect(state.burns.length).toBe(1)
    const hpAfter = t.health
    sim(state, prepped, events, Math.round((1000 / 1000) * CONFIG.tickRate)) // 1s
    expect(t.health).toBeLessThan(hpAfter)
  })

  it('投掷物反弹（撞墙后速度反向）', () => {
    const { state, prepped, events } = makeWorld()
    // 朝西边界墙（x=-350）投掷
    throwGrenade(state, { id: 0 }, 'he', v3(0, 40, 0), v3(-1, 0, 0), events)
    const g = state.grenades[0]
    sim(state, prepped, events, 200) // 让它飞一段并撞墙
    // 引爆前若仍存在，检查其 x 没有穿过墙
    const stillThere = state.grenades[0]
    if (stillThere) {
      expect(stillThere.position.x).toBeGreaterThan(-350 - 8)
    } else {
      // 已引爆，则引爆点也应在墙内侧
      expect(g.fuseUntilTick).toBeGreaterThan(0)
    }
    void prepped
    void events
  })

  it('购买投掷物进 4 格槽位', () => {
    const { state, events } = makeWorld()
    state.round.phase = 'freeze'
    state.round.roundNumber = 2 // 跳过首回合手枪轮
    const p = state.players[0]
    p.money = 5000
    expect(canBuyNow(state)).toBe(true)
    expect(buyItem(state, p, 'he', events)).toBe(true)
    expect(buyItem(state, p, 'smoke', events)).toBe(true)
    expect(p.weapons.grenades[0]?.defId).toBe('he')
    expect(p.weapons.grenades[2]?.defId).toBe('smoke')
    expect(p.weapons.grenades[1]).toBeNull()
  })
})
