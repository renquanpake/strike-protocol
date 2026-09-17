import { CONFIG } from './game/config'
import { createGameState, type GameState } from './game/state'
import { practiceLevel } from './game/map/layout'
import { prepareLevel } from './game/physics/collision'
import { updatePlayerMovement } from './game/systems/movement'
import { updateWeaponSystem, fireWeapon } from './game/systems/weapon'
import { updateTargets, rangeTargets } from './game/systems/targets'
import { updateRound } from './game/systems/round'
import { emptyInput } from './engine/input'
import { TARGET_PART_LOCAL } from './game/entities/target'
import { FixedLoop } from './engine/loop'
import { InputController } from './engine/input'
import { EventBus } from './engine/eventbus'
import { GameRenderer, type TargetDef } from './engine/renderer'
import { HUD } from './ui/hud'
import { BuyMenu } from './ui/buymenu'
import { Scoreboard } from './ui/scoreboard'

const MAT_COLORS: Record<string, [number, number]> = {
  concrete: [0x9aa0a8, 1],
  metal: [0x767e88, 1],
  wood: [0x9c6b3f, 1],
  sand: [0xc9a86a, 1],
  glass: [0x9fd8e8, 0.45],
  ladder: [0xd8c25a, 0.85],
}

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudRoot = document.getElementById('hud') as HTMLElement

const level = practiceLevel()
const prepped = prepareLevel(level)
const state: GameState = createGameState(
  level.spawns.T,
  level.spawns.CT,
  CONFIG.healthMax,
  CONFIG.startMoney,
)
const events = new EventBus()

// warmup 时长
state.round.phaseEndTick = Math.round((CONFIG.warmupMs / 1000) * CONFIG.tickRate)

// 靶子
state.targets = rangeTargets()
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
renderer.addGroundGrid(1024, 64, 0.15)
for (const b of level.brushes) {
  if (b.clip) continue
  const [color, opacity] = MAT_COLORS[b.material] ?? [0x888888, 1]
  renderer.addBox(b.min, b.max, color, opacity)
}
renderer.addTargets(targetDefs)
// Bot / C4
for (const p of state.players) {
  if (p.id === 0) continue
  const color = p.team === 'T' ? 0x4caf50 : 0x5c86c5
  renderer.addDynamicBox(`bot:${p.id}`, 40, CONFIG.playerHeight, 40, color)
}
renderer.addDynamicBox('c4', 14, 8, 10, 0xd0342c)

// 输入
const input = new InputController()
input.attach(canvas)

const hud = new HUD(hudRoot)
const buyMenu = new BuyMenu(hudRoot, state, events)
const scoreboard = new Scoreboard(hudRoot, state)
const roundMsgEl = document.getElementById('roundmsg') as HTMLElement | null
const loop = new FixedLoop(CONFIG.tickRate)

function localInput(): void {
  state.players[0].input = input.poll()
}

function stepLogic(dt: number): void {
  localInput()
  for (const p of state.players) {
    if (p.id !== 0) p.input = emptyInput()
    if (!p.alive) continue
    updatePlayerMovement(state, p, prepped, dt)
    updateWeaponSystem(state, p, events)
    fireWeapon(state, p, prepped, events)
  }
  updateTargets(state)
  updateRound(state, prepped, events, dt)
  state.tick += 1
}

function refreshDynamic(): void {
  for (const p of state.players) {
    if (p.id === 0) continue
    renderer.updateDynamicBox(
      `bot:${p.id}`,
      p.position.x,
      p.position.y,
      p.position.z,
      p.alive,
    )
  }
  const c4 = state.round.c4
  const c4Visible = c4.state === 'carried' || c4.state === 'dropped' || c4.state === 'planted'
  renderer.updateDynamicBox('c4', c4.position.x, c4.position.y, c4.position.z, c4Visible)
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

  // 买枪菜单开关（购买窗口内）
  if (p.input.buyQueued) buyMenu.toggle()
  buyMenu.sync()
  scoreboard.update(p.input.scoreboardHeld)

  refreshTargetDefs()
  renderer.updateTargets(targetDefs)
  refreshDynamic()

  const eye = p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight
  renderer.setCamera({
    x: prevX + (p.position.x - prevX) * alpha,
    y: prevY + (p.position.y - prevY) * alpha + eye,
    z: prevZ + (p.position.z - prevZ) * alpha,
    yaw: prevYaw + (p.yaw - prevYaw) * alpha,
    pitch: prevPitch + (p.pitch - prevPitch) * alpha,
  })
  renderer.render()

  // 回合消息
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
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
window.addEventListener('resize', () => renderer.resize())

interface DebugAPI {
  state(): GameState
  tickOnce(): void
}
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: DebugAPI }).__game = {
    state: () => state,
    tickOnce: () => stepLogic(1 / CONFIG.tickRate),
  }
}
