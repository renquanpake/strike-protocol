import { CONFIG } from './game/config'
import { createGameState, type GameState } from './game/state'
import { practiceLevel } from './game/map/layout'
import { prepareLevel } from './game/physics/collision'
import { updateMovement } from './game/systems/movement'
import { updateWeaponSystem, fireWeapon } from './game/systems/weapon'
import { updateTargets, rangeTargets } from './game/systems/targets'
import { TARGET_PART_LOCAL } from './game/entities/target'
import { FixedLoop } from './engine/loop'
import { InputController } from './engine/input'
import { EventBus } from './engine/eventbus'
import { GameRenderer, type TargetDef } from './engine/renderer'
import { HUD } from './ui/hud'

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
const state: GameState = createGameState(prepped.spawn, CONFIG.healthMax)
const events = new EventBus()

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

// 输入
const input = new InputController()
input.attach(canvas)

const hud = new HUD(hudRoot)
const loop = new FixedLoop(CONFIG.tickRate)

function stepLogic(dt: number): void {
  state.input = input.poll()
  updateMovement(state, prepped, dt)
  updateWeaponSystem(state, events)
  fireWeapon(state, prepped, events)
  updateTargets(state)
  state.tick += 1
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
  const p = state.player
  const prevX = p.position.x
  const prevY = p.position.y
  const prevZ = p.position.z
  const prevYaw = p.yaw
  const prevPitch = p.pitch

  const { alpha } = loop.step(now, stepLogic)

  refreshTargetDefs()
  renderer.updateTargets(targetDefs)

  const eye = p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight
  renderer.setCamera({
    x: prevX + (p.position.x - prevX) * alpha,
    y: prevY + (p.position.y - prevY) * alpha + eye,
    z: prevZ + (p.position.z - prevZ) * alpha,
    yaw: prevYaw + (p.yaw - prevYaw) * alpha,
    pitch: prevPitch + (p.pitch - prevPitch) * alpha,
  })
  renderer.render()

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
