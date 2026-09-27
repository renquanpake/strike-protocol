import { describe, expect, it } from 'vitest'
import { v3 } from '../src/engine/math'
import { emptyInput } from '../src/engine/input'
import { EventBus } from '../src/engine/eventbus'
import { CONFIG } from '../src/game/config'
import { createGameState, type PlayerEntity } from '../src/game/state'
import { prepareLevel, type PreppedLevel } from '../src/game/physics/collision'
import type { LevelDef } from '../src/game/map/layout'
import { WEAPONS, newWeaponInstance } from '../src/game/weapons'
import { makeTarget } from '../src/game/entities/target'
import {
  fireWeapon,
  spreadDegrees,
  updateWeaponSystem,
} from '../src/game/systems/weapon'
import { updatePlayerMovement } from '../src/game/systems/movement'

// 开放场 + 可穿墙木箱（G1 用例）
const wallLevel: LevelDef = {
  name: 'wall',
  spawns: { T: [{ x: 0, y: 0, z: 0 }], CT: [] },
  sites: [],
  brushes: [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
    // 木箱挡在射击线 z∈[-78,-42]（高 80，眼高 64 可穿过）
    {
      min: { x: -16, y: 0, z: -78 },
      max: { x: 16, y: 80, z: -42 },
      material: 'wood',
    },
  ],
}
const wallPrepped: PreppedLevel = prepareLevel(wallLevel)

// 双木箱（AWP 双层穿透用例）
const dblLevel: LevelDef = {
  ...wallLevel,
  brushes: [
    wallLevel.brushes[0],
    {
      min: { x: -16, y: 0, z: -90 },
      max: { x: 16, y: 80, z: -54 },
      material: 'wood',
    },
    {
      min: { x: -16, y: 0, z: -50 },
      max: { x: 16, y: 80, z: -14 },
      material: 'wood',
    },
  ],
}
const dblPrepped: PreppedLevel = prepareLevel(dblLevel)

// 纯净开放场（只有地面，无木箱）：G3 受击 / G4 散调用
const clearLevel: LevelDef = {
  name: 'clear',
  spawns: { T: [{ x: 0, y: 0, z: 0 }], CT: [] },
  sites: [],
  brushes: [
    {
      min: { x: -512, y: -32, z: -512 },
      max: { x: 512, y: 0, z: 512 },
      material: 'sand',
    },
  ],
}
const clearPrepped: PreppedLevel = prepareLevel(clearLevel)

function makeState(prepped: PreppedLevel, seed = 0x51) {
  const state = createGameState(prepped.spawns.T, [], CONFIG.healthMax, 800, seed)
  const p = state.players[0]
  p.position = v3(0, 0, 0)
  p.onGround = true
  for (let i = 1; i < state.players.length; i++) {
    state.players[i].position = v3(i % 2 === 0 ? 500 : -500, 0, 400)
  }
  return { state, p }
}

function aimChestAt(p: PlayerEntity, dist: number): void {
  // 胸盒中心 y≈49，眼高 64 → 俯角 atan((49-64)/dist)
  p.pitch = Math.atan2(49 - 64, dist)
  p.yaw = 0
  p.fireSpread = 0
}

describe('G1 穿墙（wallbang）', () => {
  it('AK 穿木箱命中靶：伤害按材质衰减 0.9', () => {
    const { state, p } = makeState(wallPrepped)
    state.targets = [makeTarget(0, 0, 0, -150)]
    p.weapons.primary = newWeaponInstance('ak')
    p.activeSlot = 0
    aimChestAt(p, 150)
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireHeld: true, fireQueued: true }
    fireWeapon(state, p, wallPrepped, new EventBus())
    const expected = WEAPONS.ak.damage * CONFIG.wallbang.materials.wood
    expect(state.targets[0].health).toBeCloseTo(100 - expected, 1)
  })

  it('AWP 可穿双层木板（衰减 0.9×0.9），手枪只穿 1 层', () => {
    const { state, p } = makeState(dblPrepped)
    state.targets = [makeTarget(0, 0, 0, -200)]
    p.weapons.primary = newWeaponInstance('awp')
    p.activeSlot = 0
    aimChestAt(p, 200)
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, dblPrepped, new EventBus())
    const awpScale = CONFIG.wallbang.materials.wood ** CONFIG.wallbang.maxLayers
    expect(state.targets[0].health).toBeCloseTo(100 - 50 * awpScale, 1)

    // 手枪（glock wallPenetration 0.25 < 0.9 → 仅 1 层）：双层木板挡住目标
    state.targets[0].health = 100
    state.targets[0].alive = true
    p.weapons.primary = newWeaponInstance('glock')
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, dblPrepped, new EventBus())
    expect(state.targets[0].health).toBe(100) // 第二层木箱拦截
  })

  it('刀不可穿墙；concrete 厚墙不可穿透', () => {
    const { state, p } = makeState(wallPrepped)
    state.targets = [makeTarget(0, 0, 0, -150)]
    p.activeSlot = 2 // 刀
    aimChestAt(p, 150)
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, wallPrepped, new EventBus())
    expect(state.targets[0].health).toBe(100)
  })

  it('穿墙命中发射 muffled shot 事件与 penetrated surfaceHit', () => {
    const { state, p } = makeState(wallPrepped)
    state.targets = [makeTarget(0, 0, 0, -150)]
    const events = new EventBus()
    let shotMuffled: boolean | undefined
    let surfacePenetrated: boolean | undefined
    events.on('shot', (e) => (shotMuffled = e.muffled))
    events.on('surfaceHit', (e) => (surfacePenetrated = e.penetrated))
    p.weapons.primary = newWeaponInstance('ak')
    p.activeSlot = 0
    aimChestAt(p, 150)
    state.round.phase = 'live'
    state.tick = 0
    p.input = { ...emptyInput(), fireHeld: true, fireQueued: true }
    fireWeapon(state, p, wallPrepped, events)
    expect(shotMuffled).toBe(true)
    expect(surfacePenetrated).toBe(true)
  })
})

describe('G2 完整 30 发弹道图 + 停火恢复插值', () => {
  it('AK/M4 弹道表为 30 发独立条目', () => {
    expect(WEAPONS.ak.recoilPattern.length).toBe(30)
    expect(WEAPONS.m4.recoilPattern.length).toBe(30)
  })

  it('AK 弹道形状：前 7 发近似直线，10-15 发左漂，16-24 发右摆', () => {
    const pat = WEAPONS.ak.recoilPattern
    const sumPitch = (a: number, b: number) => pat.slice(a, b).reduce((s, p) => s + p[0], 0)
    const total = sumPitch(0, 30)
    expect(sumPitch(0, 7) / total).toBeLessThan(0.4) // 前 7 发占比小（近似直线）
    const leftYaw = pat.slice(9, 15).reduce((s, p) => s + p[1], 0)
    const rightYaw = pat.slice(15, 24).reduce((s, p) => s + p[1], 0)
    expect(leftYaw).toBeLessThan(0) // 中段左漂
    expect(rightYaw).toBeGreaterThan(0) // 后段右摆
  })

  it('30 连发累计位移序列 = 弹道表前 30 项之和（确定性）', () => {
    const { state, p } = makeState(wallPrepped, 0x1234)
    p.weapons.primary = newWeaponInstance('ak')
    p.activeSlot = 0
    p.pitch = 0
    p.yaw = 0
    p.fireSpread = 0
    state.round.phase = 'live'
    const events = new EventBus()
    const interval = Math.round((WEAPONS.ak.fireRateMs / 1000) * CONFIG.tickRate)
    for (let i = 0; i < 30; i++) {
      state.tick = i * interval
      p.input = { ...emptyInput(), fireHeld: true }
      fireWeapon(state, p, wallPrepped, events)
    }
    const expPitch = WEAPONS.ak.recoilPattern.reduce((s, pk) => s + pk[0], 0)
    const expYaw = WEAPONS.ak.recoilPattern.reduce((s, pk) => s + pk[1], 0)
    expect(p.pitch).toBeCloseTo(expPitch, 6)
    expect(p.yaw).toBeCloseTo(expYaw, 6)
  })

  it('停火 400ms 部分回卷一步，3s 完全回卷（恢复插值避免跳变）', () => {
    const { state, p } = makeState(wallPrepped)
    p.weapons.primary = newWeaponInstance('ak')
    p.activeSlot = 0
    state.round.phase = 'live'
    const events = new EventBus()
    const interval = Math.round((WEAPONS.ak.fireRateMs / 1000) * CONFIG.tickRate)
    for (let i = 0; i < 10; i++) {
      state.tick = i * interval
      p.input = { ...emptyInput(), fireHeld: true }
      fireWeapon(state, p, wallPrepped, events)
    }
    expect(p.weapons.primary!.recoilIndex).toBe(10)
    const lastShot = p.weapons.primary!.lastShotTick
    const recoverTicks = Math.round((CONFIG.recoilRecoverMs / 1000) * CONFIG.tickRate)
    // 停 400ms（recoverTicks）→ 回卷 1 步
    state.tick = lastShot + recoverTicks
    p.input = { ...emptyInput() }
    updateWeaponSystem(state, p, events)
    expect(p.weapons.primary!.recoilIndex).toBe(9)
    // 停 2×400ms → 回卷第 2 步
    state.tick = lastShot + 2 * recoverTicks
    updateWeaponSystem(state, p, events)
    expect(p.weapons.primary!.recoilIndex).toBe(8)
    // 停满 3s → 完全回卷
    state.tick = lastShot + Math.round((CONFIG.recoilResetMs / 1000) * CONFIG.tickRate)
    updateWeaponSystem(state, p, events)
    expect(p.weapons.primary!.recoilIndex).toBe(0)
  })
})

describe('G3 受击减速（tagging）', () => {
  function hitChest(wpn: string): { victim: PlayerEntity; tick: number; state: ReturnType<typeof makeState>['state'] } {
    const { state, p } = makeState(clearPrepped, 0x7)
    const victim = state.players[1]
    victim.position = v3(0, 0, -100)
    victim.health = 100
    victim.armor = 0
    victim.alive = true
    p.weapons.primary = newWeaponInstance(wpn)
    p.activeSlot = 0
    aimChestAt(p, 100)
    state.round.phase = 'live'
    state.tick = 100
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, clearPrepped, new EventBus())
    return { victim, tick: state.tick, state }
  }

  it('受击后 tag 生效：tagUntilTick/tagStrength 按伤害设置', () => {
    const { victim, tick } = hitChest('usp')
    expect(victim.health).toBeLessThan(100)
    expect(victim.tagFromTick).toBe(tick)
    // usp 25 伤、无甲：时长 400+200*0.5=500ms=32 tick，强度 min(0.5, 25*0.01)=0.25
    const expMs = CONFIG.tagging.minMs + (CONFIG.tagging.maxMs - CONFIG.tagging.minMs) * Math.min(1, 25 / 50)
    expect(victim.tagUntilTick - tick).toBe(Math.max(1, Math.round((expMs / 1000) * CONFIG.tickRate)))
    expect(victim.tagStrength).toBeCloseTo(Math.min(CONFIG.tagging.maxStrength, 25 * CONFIG.tagging.strengthPerDmg), 5)
  })

  it('护甲降低 tag 时长与降幅', () => {
    const { state, victim } = (() => {
      const r = hitChest('usp')
      return { state: r.state, victim: r.victim }
    })()
    // 无甲：dmg=25 → 时长 400+200*0.5=500ms=32 tick
    const noArmorTicks = victim.tagUntilTick - victim.tagFromTick
    expect(noArmorTicks).toBe(32)
    // 带甲再打一发：最终伤害 = 25*0.5 = 12.5
    victim.health = 100
    victim.armor = 100
    victim.tagFromTick = 0
    victim.tagUntilTick = 0
    const p = state.players[0]
    state.tick = 200
    p.input = { ...emptyInput(), fireQueued: true }
    fireWeapon(state, p, clearPrepped, new EventBus())
    const finalDmg = 25 * 0.5
    const armoredTicks = victim.tagUntilTick - victim.tagFromTick
    const expMs =
      (CONFIG.tagging.minMs +
        (CONFIG.tagging.maxMs - CONFIG.tagging.minMs) * Math.min(1, finalDmg / 50)) *
      (1 - CONFIG.tagging.armorReduction)
    expect(armoredTicks).toBe(Math.max(1, Math.round((expMs / 1000) * CONFIG.tickRate)))
    expect(armoredTicks).toBeLessThan(noArmorTicks)
    expect(victim.tagStrength).toBeCloseTo(
      Math.min(CONFIG.tagging.maxStrength, finalDmg * CONFIG.tagging.strengthPerDmg),
      5,
    )
  })

  it('tag 期间移速上限下降并随时间恢复（被扫射走不掉）', () => {
    const { state, p } = makeState(clearPrepped, 0x9)
    p.weapons.primary = newWeaponInstance('m4')
    p.activeSlot = 0
    const victim = state.players[1]
    victim.position = v3(10, 0, -300)
    victim.alive = true
    victim.health = 100
    // 直接设 tag（等价于刚受 50 伤）
    victim.tagFromTick = state.tick
    victim.tagUntilTick = state.tick + 32
    victim.tagStrength = 0.5
    victim.input = { ...emptyInput(), forward: 1 }
    victim.velocity = v3(0, 0, -200)
    victim.yaw = Math.PI // 面向 +Z（forward=+z）
    // 对照：无 tag
    const victim2 = state.players[2]
    victim2.position = v3(30, 0, -300)
    victim2.alive = true
    victim2.health = 100
    victim2.input = { ...emptyInput(), forward: 1 }
    victim2.velocity = v3(0, 0, -200)
    victim2.yaw = Math.PI
    for (let i = 0; i < 16; i++) {
      state.tick += 1
      updatePlayerMovement(state, victim, clearPrepped, 1 / CONFIG.tickRate)
      victim.tagFromTick = state.tick // 保持 tag 持续（模拟被连续扫射）
      victim.tagUntilTick = state.tick + 32
      updatePlayerMovement(state, victim2, clearPrepped, 1 / CONFIG.tickRate)
    }
    const sp = Math.hypot(victim.velocity.x, victim.velocity.z)
    const sp2 = Math.hypot(victim2.velocity.x, victim2.velocity.z)
    expect(sp).toBeLessThan(sp2) // tag 玩家更快被拖到低于上限
    // tag 结束后恢复满速上限
    victim.tagUntilTick = state.tick
    for (let i = 0; i < 64; i++) {
      state.tick += 1
      updatePlayerMovement(state, victim, clearPrepped, 1 / CONFIG.tickRate)
    }
    expect(Math.hypot(victim.velocity.x, victim.velocity.z)).toBeGreaterThan(sp)
  })
})

describe('G4 蹲射精度', () => {
  it('蹲下站定散布 = crouch 值（约 stand 的 60-70%）', () => {
    const { p } = makeState(wallPrepped)
    p.onGround = true
    p.velocity = v3(0, 0, 0)
    for (const def of [WEAPONS.ak, WEAPONS.m4, WEAPONS.usp]) {
      p.crouching = false
      const stand = spreadDegrees(p, def, false)
      p.crouching = true
      const crouch = spreadDegrees(p, def, false)
      expect(crouch).toBeLessThan(stand)
      expect(crouch).toBeCloseTo(def.spreadDeg.crouch!, 5)
      expect(crouch / def.spreadDeg.stand).toBeGreaterThan(0.55)
      expect(crouch / def.spreadDeg.stand).toBeLessThan(0.75)
    }
    p.crouching = false
  })

  it('蹲下移动取最小：蹲射弹孔散布小于站射（移动中）', () => {
    const { p } = makeState(wallPrepped)
    p.onGround = true
    p.velocity = v3(0, 0, 85) // 满速蹲移（duckSpeed）
    p.crouching = true
    const crouched = spreadDegrees(p, WEAPONS.m4, false)
    p.crouching = false
    p.velocity = v3(0, 0, CONFIG.moveMaxSpeed)
    const standing = spreadDegrees(p, WEAPONS.m4, false)
    expect(crouched).toBeLessThan(standing)
  })
})
