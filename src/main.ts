import { CONFIG } from './game/config'
import { createGameState, type GameState } from './game/state'
import { matchLevel } from './game/map/match'
import { prepareLevel } from './game/physics/collision'
import { buildNavGrid } from './game/map/navmesh'
import { updatePlayerMovement } from './game/systems/movement'
import { updateWeaponSystem, fireWeapon } from './game/systems/weapon'
import { updateTargets } from './game/systems/targets'
import { updateRound } from './game/systems/round'
import { updateGrenades } from './game/systems/grenade'
import { createBotContext, updateBots, type BotContext } from './game/systems/bot'
import { emptyInput } from './engine/input'
import { TARGET_PART_LOCAL } from './game/entities/target'
import { FixedLoop } from './engine/loop'
import { InputController } from './engine/input'
import { EventBus } from './engine/eventbus'
import { GameRenderer, type TargetDef } from './engine/renderer'
import { buildTextures, type TextureMap } from './engine/textures'
import { HUD } from './ui/hud'
import { BuyMenu } from './ui/buymenu'
import { Scoreboard } from './ui/scoreboard'
import { Radar } from './ui/radar'

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudRoot = document.getElementById('hud') as HTMLElement
const radarCanvas = document.getElementById('radar') as HTMLCanvasElement

const level = matchLevel()
const prepped = prepareLevel(level)
const textures: TextureMap = buildTextures()
const nav = buildNavGrid(prepped, 48)

const state: GameState = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney)
const events = new EventBus()
const botCtx: BotContext = createBotContext(state, level.sites)

state.round.phaseEndTick = Math.round((CONFIG.warmupMs / 1000) * CONFIG.tickRate)
state.targets = []

const targetDefs: TargetDef[] = state.targets.map((t) => ({
  id: t.id,
  x: t.position.x,
  y: t.position.y,
  z: t.position.z,
  alive: t.alive,
  flash: false,
  parts: TARGET_PART_LOCAL,
}))

// 渲染
const renderer = new GameRenderer(canvas, CONFIG.fov)
renderer.configure(CONFIG.skyColor, CONFIG.fogNear, CONFIG.fogFar)
for (const b of level.brushes) {
  if (b.clip) continue
  renderer.addBox(b.min, b.max, 0xffffff, b.material === 'glass' ? 0.45 : 1, b.material, textures)
}
renderer.addTargets(targetDefs)
for (const p of state.players) {
  if (p.id === 0) continue
  const color = p.team === 'T' ? 0x4caf50 : 0x5c86c5
  renderer.addDynamicBox(`bot:${p.id}`, 40, CONFIG.playerHeight, 40, color)
}
renderer.addDynamicBox('c4', 14, 8, 10, 0xd0342c)

// 输入 / UI
const input = new InputController()
input.attach(canvas)
const hud = new HUD(hudRoot)
const buyMenu = new BuyMenu(hudRoot, state, events)
const scoreboard = new Scoreboard(hudRoot, state)
const radar = new Radar(radarCanvas, prepped)
const roundMsgEl = document.getElementById('roundmsg') as HTMLElement | null
const blindEl = document.getElementById('blind') as HTMLElement | null
const loop = new FixedLoop(CONFIG.tickRate)

function stepLogic(dt: number): void {
  state.players[0].input = input.poll()
  updateBots(state, prepped, nav, botCtx, events, dt)
  for (const p of state.players) {
    if (p.id !== 0 && !p.isBot) p.input = emptyInput()
    if (!p.alive) continue
    updatePlayerMovement(state, p, prepped, dt)
    updateWeaponSystem(state, p, events)
    fireWeapon(state, p, prepped, events)
  }
  updateTargets(state)
  updateGrenades(state, prepped, events, dt)
  updateRound(state, prepped, events, dt)
  state.tick += 1
}

function refreshDynamic(): void {
  for (const p of state.players) {
    if (p.id === 0) continue
    renderer.updateDynamicBox(`bot:${p.id}`, p.position.x, p.position.y, p.position.z, p.alive)
  }
  const c4 = state.round.c4
  const c4Visible = c4.state === 'carried' || c4.state === 'dropped' || c4.state === 'planted'
  renderer.updateDynamicBox('c4', c4.position.x, c4.position.y, c4.position.z, c4Visible)
  refreshGrenades()
}

const GREN_COLORS: Record<string, number> = {
  he: 0xd0342c,
  flash: 0xffd257,
  smoke: 0x8fa3ad,
  molotov: 0xff7043,
}
const madeDyn = new Set<string>()

function ensureDyn(key: string): void {
  if (madeDyn.has(key)) return
  madeDyn.add(key)
  if (key.startsWith('g:')) {
    const g = state.grenades.find((x) => `g:${x.id}` === key)
    renderer.addDynamicSphere(key, 8, GREN_COLORS[g?.kind ?? 'he'] ?? 0x888888)
  } else if (key.startsWith('sm:')) {
    const z = state.smokes.find((x) => `sm:${x.id}` === key)
    const r = z?.radius ?? 100
    renderer.addDynamicBox(key, r * 2, 90, r * 2, 0x9fb4c4, 0.45)
  } else {
    const z = state.burns.find((x) => `fn:${x.id}` === key)
    const r = z?.radius ?? 60
    renderer.addDynamicBox(key, r * 2, 2, r * 2, 0xff7043, 0.8)
  }
}

function refreshGrenades(): void {
  const liveG = new Set(state.grenades.map((g) => `g:${g.id}`))
  const liveSm = new Set(state.smokes.map((z) => `sm:${z.id}`))
  const liveFn = new Set(state.burns.map((z) => `fn:${z.id}`))
  for (const g of state.grenades) {
    ensureDyn(`g:${g.id}`)
    renderer.updateDynamicSphere(`g:${g.id}`, g.position.x, g.position.y + 8, g.position.z, true)
  }
  for (const z of state.smokes) {
    ensureDyn(`sm:${z.id}`)
    renderer.updateDynamicBox(`sm:${z.id}`, z.center.x, z.center.y, z.center.z, true)
  }
  for (const z of state.burns) {
    ensureDyn(`fn:${z.id}`)
    renderer.updateDynamicBox(`fn:${z.id}`, z.center.x, z.center.y, z.center.z, true)
  }
  // 隐藏已消失的
  for (const key of madeDyn) {
    const alive =
      (key.startsWith('g:') && liveG.has(key)) ||
      (key.startsWith('sm:') && liveSm.has(key)) ||
      (key.startsWith('fn:') && liveFn.has(key))
    if (!alive) {
      if (key.startsWith('g:')) renderer.updateDynamicSphere(key, 0, -9999, 0, false)
      else renderer.updateDynamicBox(key, 0, -9999, 0, false)
    }
  }
}

function refreshTargetDefs(): void {
  state.targets.forEach((t, i) => {
    const d = targetDefs[i]
    d.alive = t.alive
    d.flash = t.hitFlashTick >= 0 && state.tick - t.hitFlashTick < 4
  })
}

let fps = 60
let fpsFrames = 0
let fpsWindowStart = 0

function frame(now: number): void {
  const p = state.players[0]
  const prevX = p.position.x
  const prevY = p.position.y
  const prevZ = p.position.z
  const prevYaw = p.yaw
  const prevPitch = p.pitch

  const { alpha } = loop.step(now, stepLogic)

  if (p.input.buyQueued) buyMenu.toggle()
  buyMenu.sync()
  scoreboard.update(p.input.scoreboardHeld)

  refreshTargetDefs()
  renderer.updateTargets(targetDefs)
  refreshDynamic()
  radar.update(state)

  const eye = p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight
  renderer.setCamera({
    x: prevX + (p.position.x - prevX) * alpha,
    y: prevY + (p.position.y - prevY) * alpha + eye,
    z: prevZ + (p.position.z - prevZ) * alpha,
    yaw: prevYaw + (p.yaw - prevYaw) * alpha,
    pitch: prevPitch + (p.pitch - prevPitch) * alpha,
  })
  renderer.render()

  if (roundMsgEl) {
    const r = state.round
    if (r.phase === 'matchEnd') {
      roundMsgEl.style.display = 'block'
      roundMsgEl.textContent = `MATCH OVER — ${r.lastWinner} WINS ${r.score.T}:${r.score.CT}`
    } else if (r.phase === 'roundEnd' || r.phase === 'halftime') {
      roundMsgEl.style.display = 'block'
      roundMsgEl.textContent = r.phase === 'halftime' ? 'HALFTIME — 换边' : `${r.lastWinner} 赢下回合（${r.lastResult}）`
    } else {
      roundMsgEl.style.display = 'none'
    }
  }

  fpsFrames += 1
  if (fpsWindowStart === 0) fpsWindowStart = now
  if (now - fpsWindowStart >= 500) {
    fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart))
    fpsFrames = 0
    fpsWindowStart = now
  }

  hud.update(state, fps, input.locked, now)
  // 致盲白屏
  if (blindEl) {
    const p0 = state.players[0]
    const remain = p0.blindUntil - state.tick
    blindEl.style.opacity = remain > 0 ? String(Math.min(1, (remain / 256) * 1.2)) : '0'
  }
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
window.addEventListener('resize', () => renderer.resize())

interface DebugAPI {
  state(): GameState
  tickOnce(): void
  nav?: unknown
}
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: DebugAPI }).__game = {
    state: () => state,
    tickOnce: () => stepLogic(1 / CONFIG.tickRate),
    nav,
  }
}
