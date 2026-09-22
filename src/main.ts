import { CONFIG } from './game/config'
import { createGameState, type GameState } from './game/state'
import { matchLevel, type MapId } from './game/map/match'
import { prepareLevel } from './game/physics/collision'
import { buildNavGrid } from './game/map/navmesh'
import { updatePlayerMovement, setMouseSensScale } from './game/systems/movement'
import { updateWeaponSystem, fireWeapon, viewForward, viewRight } from './game/systems/weapon'
import { updateTargets } from './game/systems/targets'
import { updateRound } from './game/systems/round'
import { updateGrenades } from './game/systems/grenade'
import { updateDrops } from './game/systems/drops'
import { createBotContext, updateBots, type BotContext } from './game/systems/bot'
import { emptyInput } from './engine/input'
import { TARGET_PART_LOCAL } from './game/entities/target'
import { FixedLoop } from './engine/loop'
import { InputController } from './engine/input'
import { EventBus } from './engine/eventbus'
import { GameRenderer, type TargetDef } from './engine/renderer'
import { buildTextures, loadImageTextures, makeDecalTexture, type TextureMap } from './engine/textures'
import { HUD } from './ui/hud'
import { BuyMenu } from './ui/buymenu'
import { Scoreboard } from './ui/scoreboard'
import { Radar } from './ui/radar'
import { ViewModel } from './ui/viewmodel'
import { MenuUI, buildMatchEndStats, matchOptionsFromCfg } from './ui/menu'
import { AudioEngine } from './engine/audio'
import { updateShells, spawnShell, type Shell } from './game/particles'
import { raycastBoxes } from './game/physics/raycast'
import { v3 } from './engine/math'
import { loadSettings, loadMatchConfig, type Settings, type MatchConfig } from './ui/settings'

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudRoot = document.getElementById('hud') as HTMLElement
const radarCanvas = document.getElementById('radar') as HTMLCanvasElement

let settings: Settings = loadSettings()
let textures: TextureMap = buildTextures()

// ===== 全局持久对象 =====
const input = new InputController()
input.attach(canvas)
const hud = new HUD(hudRoot)
const loop = new FixedLoop(CONFIG.tickRate)
const audio = new AudioEngine()
audio.setInitialVolume(settings.volume)
const unlockAudio = (): void => audio.init()
window.addEventListener('pointerdown', unlockAudio, { once: false })
window.addEventListener('keydown', unlockAudio, { once: false })

const events = new EventBus()

// ===== 对局生命周期（#1）：menu → running ⇄ paused → matchend → menu/再战 =====
type Phase = 'menu' | 'running' | 'paused' | 'matchend'
let phase: Phase = 'menu'
let matchConfig: MatchConfig = loadMatchConfig()

let state: GameState | null = null
let level = matchLevel()
let prepped = prepareLevel(level)
let nav = buildNavGrid(prepped, 24)
let botCtx: BotContext | null = null
let buyMenu: BuyMenu | null = null
let scoreboard: Scoreboard | null = null
let radar: Radar | null = null
let viewmodel: ViewModel | null = null
let targetDefs: TargetDef[] = []
let matchendShown = false

// 渲染器单例（世界对象随对局 resetWorld）
const renderer = new GameRenderer(canvas, settings.fov)
renderer.configure(CONFIG.skyColor, CONFIG.fogNear, CONFIG.fogFar, 2600)

// 弹壳池
const SHELL_POOL = 24
const shells: Shell[] = Array.from({ length: SHELL_POOL }, (_, i) => ({
  id: i,
  position: v3(0, -9999, 0),
  velocity: v3(),
  until: 0,
  active: false,
}))

// 第一人称武器模型
// ===== 印花（弹孔/霰弹/烧痕），池在对局重建时创建 =====
let bulletPool = -1
let scorchPool = -1
let shotPool = -1

function surfaceBelow(x: number, y: number, z: number): import('./game/physics/raycast').RayHit | null {
  const boxes = level.brushes
    .filter((b) => !b.clip && b.material !== 'glass')
    .map((b, i) => ({ id: String(i), min: b.min, max: b.max }))
  return raycastBoxes(v3(x, y, z), v3(0, -1, 0), boxes) ?? raycastBoxes(v3(x, y, z), v3(0, 1, 0), boxes)
}

events.on('surfaceHit', (e) => {
  if (e.shooterId !== 0) return
  const pool = e.pellets > 1 ? shotPool : bulletPool
  renderer.spawnDecal(pool, e.point, e.normal, e.pellets > 1 ? 2.4 : 1)
})
const spawnScorch = (x: number, y: number, z: number): void => {
  const hit = surfaceBelow(x, y, z)
  if (hit) renderer.spawnDecal(scorchPool, hit.point, hit.normal, 3)
}
events.on('grenadeExploded', (e) => spawnScorch(e.x, e.y, e.z))
events.on('bombExploded', () => {
  const st = state
  if (!st) return
  spawnScorch(st.round.c4.position.x, st.round.c4.position.y, st.round.c4.position.z)
})
events.on('roundEnd', () => {
  renderer.clearDecals(bulletPool)
  renderer.clearDecals(scorchPool)
  renderer.clearDecals(shotPool)
})

// 枪口火光（本地玩家最近一次开火）
let muzzleTicks = 0
let lastShotMuzzle = v3(0, -9999, 0)
let shellSeq = 1

// 命中反馈计时
let hitmarkUntil = 0
let hitmarkHead = false
let dmgUntil = 0

events.on('shot', (e) => {
  const st = state
  if (!st) return
  const p = st.players[e.shooterId]
  if (!p) return
  const isLocal = e.shooterId === 0
  const eyeY = p.position.y + CONFIG.eyeHeight
  audio.shot(e.weaponId, p.position.x, eyeY, p.position.z, isLocal)
  if (isLocal && viewmodel) {
    viewmodel.setKick(4)
    // 枪口位置：优先用武器模型枪口（随摆动/后坐），首次开火前回退到眼位前 24u
    const vmMuzzle = viewmodel.getMuzzle()
    const fwd = viewForward(p.yaw, p.pitch)
    lastShotMuzzle = vmMuzzle.y > -9000 ? vmMuzzle : v3(p.position.x + fwd.x * 24, eyeY + fwd.y * 24, p.position.z + fwd.z * 24)
    muzzleTicks = 6
    // 弹壳
    const up = v3(0, 1, 0)
    const right = viewRight(p.yaw, p.pitch)
    spawnShell(shells, shellSeq++, lastShotMuzzle, right, up, fwd, 200)
  }
})
events.on('hit', (e) => {
  if (e.attackerId === 0) {
    audio.hitmarker(e.part)
    hitmarkUntil = performance.now() + 120
    hitmarkHead = e.part === 'head'
  }
  if (e.victimId === 0) {
    dmgUntil = performance.now() + 220
  }
})
events.on('grenadeExploded', (e) => {
  const kind = e.kind === 'flash' ? 'flash' : e.kind === 'molotov' || e.kind === 'smoke' ? e.kind : 'he'
  audio.explosion(kind, e.x, e.y, e.z)
})
events.on('bombExploded', () => {
  const st = state
  if (!st) return
  audio.explosion('c4', st.round.c4.position.x, st.round.c4.position.y, st.round.c4.position.z)
})
events.on('c4Beep', () => {
  const st = state
  if (!st) return
  audio.c4Beep(st.round.c4.position.x, st.round.c4.position.y, st.round.c4.position.z)
})
events.on('footstep', (e) => {
  const st = state
  if (!st) return
  const p = st.players[e.playerId]
  if (!p) return
  audio.footstep(e.material, e.x, e.y, e.z, e.playerId === 0)
})
events.on('reloadStarted', () => audio.reload())
events.on('roundEnd', (e) => audio.roundEnd(e.winner === 'T'))

let pendingBuyToggle = false

function stepLogic(dt: number): void {
  const st = state
  if (!st) return
  const frame = input.poll()
  st.players[0].input = frame
  // 边沿标志在 tick 级累积，避免一帧多 tick 时被后续 tick 覆盖丢失
  if (frame.buyQueued) pendingBuyToggle = true
  if (botCtx) updateBots(st, prepped, nav, botCtx, events, dt)
  for (const p of st.players) {
    if (p.id !== 0 && !p.isBot) p.input = emptyInput()
    if (!p.alive) continue
    updatePlayerMovement(st, p, prepped, dt, events)
    updateWeaponSystem(st, p, events)
    fireWeapon(st, p, prepped, events)
    updateDrops(st, p, events)
  }
  updateTargets(st)
  updateGrenades(st, prepped, events, dt)
  updateRound(st, prepped, events, dt)
  st.tick += 1
}

function refreshDynamic(): void {
  const st = state
  if (!st) return
  for (const p of st.players) {
    if (p.id === 0) continue
    const moving = Math.hypot(p.velocity.x, p.velocity.z) > 20
    renderer.updateHumanoid(`bot:${p.id}`, p.position.x, p.position.y, p.position.z, p.yaw, p.alive, false, moving)
  }
  const c4 = st.round.c4
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
  const st = state
  if (key.startsWith('g:')) {
    const g = st?.grenades.find((x) => `g:${x.id}` === key)
    renderer.addDynamicSphere(key, 8, GREN_COLORS[g?.kind ?? 'he'] ?? 0x888888)
  } else if (key.startsWith('sm:')) {
    const z = st?.smokes.find((x) => `sm:${x.id}` === key)
    const r = z?.radius ?? 100
    renderer.addDynamicBox(key, r * 2, 90, r * 2, 0x9fb4c4, 0.45)
  } else {
    const z = st?.burns.find((x) => `fn:${x.id}` === key)
    const r = z?.radius ?? 60
    renderer.addDynamicBox(key, r * 2, 2, r * 2, 0xff7043, 0.8)
  }
}

function refreshGrenades(): void {
  const st = state
  if (!st) return
  const liveG = new Set(st.grenades.map((g) => `g:${g.id}`))
  const liveSm = new Set(st.smokes.map((z) => `sm:${z.id}`))
  const liveFn = new Set(st.burns.map((z) => `fn:${z.id}`))
  for (const g of st.grenades) {
    ensureDyn(`g:${g.id}`)
    renderer.updateDynamicSphere(`g:${g.id}`, g.position.x, g.position.y + 8, g.position.z, true)
  }
  for (const z of st.smokes) {
    ensureDyn(`sm:${z.id}`)
    renderer.updateDynamicBox(`sm:${z.id}`, z.center.x, z.center.y, z.center.z, true)
  }
  for (const z of st.burns) {
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
  const st = state
  if (!st) return
  st.targets.forEach((t, i) => {
    const d = targetDefs[i]
    d.alive = t.alive
    d.flash = t.hitFlashTick >= 0 && st.tick - t.hitFlashTick < 4
  })
}

let fps = 60
let fpsFrames = 0
let fpsWindowStart = 0
let lastFrameNow = 0

function frame(now: number): void {
  const st = state
  requestAnimationFrame(frame)
  if (!st) return
  const p = st.players[0]
  const frameDt = lastFrameNow > 0 ? Math.min(0.1, (now - lastFrameNow) / 1000) : 1 / 60
  lastFrameNow = now

  if (phase !== 'running') {
    // 菜单 / 暂停 / 结算：静态渲染（菜单作背景），不做逻辑
    renderer.render()
    return
  }

  const prevX = p.position.x
  const prevY = p.position.y
  const prevZ = p.position.z
  const prevYaw = p.yaw
  const prevPitch = p.pitch

  const { alpha } = loop.step(now, stepLogic)

  if (pendingBuyToggle) {
    pendingBuyToggle = false
    buyMenu?.toggle()
  }
  buyMenu?.sync()
  scoreboard?.update(p.input.scoreboardHeld)

  refreshTargetDefs()
  renderer.updateTargets(targetDefs)
  refreshDynamic()
  radar?.update(st)

  const eye = p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight
  renderer.setCamera({
    x: prevX + (p.position.x - prevX) * alpha,
    y: prevY + (p.position.y - prevY) * alpha + eye,
    z: prevZ + (p.position.z - prevZ) * alpha,
    yaw: prevYaw + (p.yaw - prevYaw) * alpha,
    pitch: prevPitch + (p.pitch - prevPitch) * alpha,
  })
  // 第一人称武器模型：与相机同插值姿态；死亡时隐藏
  if (p.alive && viewmodel) {
    viewmodel.update(
      p,
      {
        x: prevX + (p.position.x - prevX) * alpha,
        y: prevY + (p.position.y - prevY) * alpha,
        z: prevZ + (p.position.z - prevZ) * alpha,
        yaw: prevYaw + (p.yaw - prevYaw) * alpha,
        pitch: prevPitch + (p.pitch - prevPitch) * alpha,
        crouching: p.crouching,
        onGround: p.onGround,
        velX: p.velocity.x,
        velZ: p.velocity.z,
      },
      st.tick,
    )
  } else if (viewmodel) {
    viewmodel.hide()
  }
  renderer.updateCharacters(frameDt)
  renderer.render()

  // M7：音频监听者 + 弹壳/火光 + 命中反馈
  audio.setListener(p.position.x, p.position.y + eye, p.position.z)
  updateShells(shells, 0, 1 / 60, CONFIG.gravity)
  for (const s of shells) {
    renderer.updateDynamicSphere(`shell:${s.id}`, s.position.x, s.position.y, s.position.z, s.active)
  }
  if (muzzleTicks > 0) {
    muzzleTicks -= 1
    renderer.updateDynamicSphere('muzzle', lastShotMuzzle.x, lastShotMuzzle.y, lastShotMuzzle.z, muzzleTicks > 0)
  } else {
    renderer.updateDynamicSphere('muzzle', 0, -9999, 0, false)
  }
  const nowMs = performance.now()
  const hitmarkEl = document.getElementById('hitmarker')
  if (hitmarkEl) {
    const show = nowMs < hitmarkUntil
    hitmarkEl.style.opacity = show ? '1' : '0'
    hitmarkEl.style.color = hitmarkHead ? '#ff4444' : '#ffffff'
  }
  const dmgEl = document.getElementById('dmg')
  if (dmgEl) {
    dmgEl.style.opacity = nowMs < dmgUntil ? '0.85' : '0'
  }

  const roundMsgEl = document.getElementById('roundmsg') as HTMLElement | null
  if (roundMsgEl) {
    const r = st.round
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

  hud.update(st, fps, input.locked, now)
  // 致盲白屏
  const blindEl = document.getElementById('blind') as HTMLElement | null
  if (blindEl) {
    const remain = p.blindUntil - st.tick
    blindEl.style.opacity = remain > 0 ? String(Math.min(1, (remain / 256) * 1.2)) : '0'
  }

  // #4 结算屏：matchEnd 触发一次
  if (st.round.phase === 'matchEnd' && !matchendShown) {
    matchendShown = true
    phase = 'matchend'
    menuUI.showMatchEnd(buildMatchEndStats(st))
  }
}

/** 应用设置（#3/#7）：音量/FOV/画质/灵敏度 */
function applySettings(s: Settings): void {
  settings = s
  audio.setMasterVolume(s.volume)
  renderer.setFov(s.fov)
  setMouseSensScale(s.mouseSens)
}

let menuUI: MenuUI

async function startMatch(cfg: MatchConfig): Promise<void> {
  matchConfig = cfg
  const mapId = cfg.mapId as MapId
  level = matchLevel(mapId)
  prepped = prepareLevel(level)
  nav = buildNavGrid(prepped, 24)

  const opts = matchOptionsFromCfg(cfg)
  const seed = cfg.seed ?? (Date.now() & 0xffff)
  state = createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, {
    ...opts,
    rngSeed: seed,
  })
  state.seed = seed
  state.round.phaseEndTick = Math.round((CONFIG.warmupMs / 1000) * CONFIG.tickRate)
  state.targets = []
  botCtx = createBotContext(state, level.sites, state.difficulty)

  // 重建渲染世界
  renderer.resetWorld()
  renderer.configure(CONFIG.skyColor, CONFIG.fogNear, CONFIG.fogFar, 2600)
  madeDyn.clear()
  for (const s of shells) {
    s.active = false
    s.position = v3(0, -9999, 0)
  }
  viewmodel = new ViewModel(renderer, textures)
  // Blender 高模替换（按枪类逐个接入；失败保留程序化模型）
  void viewmodel.upgradeWithGLB('rifle', '/models/m4.glb', 38, -0.28)
  for (const b of level.brushes) {
    if (b.clip) continue
    renderer.addBox(b.min, b.max, 0xffffff, b.material === 'glass' ? 0.45 : 1, b.material, textures)
  }
  targetDefs = state.targets.map((t) => ({
    id: t.id,
    x: t.position.x,
    y: t.position.y,
    z: t.position.z,
    alive: t.alive,
    flash: false,
    parts: TARGET_PART_LOCAL,
  }))
  renderer.addTargets(targetDefs)
  // 人形 bot（替换色块盒）
  for (const p of state.players) {
    if (p.id === 0) continue
    const camo = p.team === 'T' ? textures.bot_t : textures.bot_ct
    const accent = p.team === 'T' ? 0xc8862a : 0x3f6fae
    renderer.addHumanoid(`bot:${p.id}`, camo, accent)
  }
  renderer.addDynamicBox('c4', 14, 8, 10, 0xd0342c)
  // 弹壳池重新注册
  for (let i = 0; i < SHELL_POOL; i++) renderer.addDynamicSphere(`shell:${i}`, 3, 0xd4af37)
  renderer.addDynamicSphere('muzzle', 6, 0xffd75e)

  // UI 重绑（先清旧 DOM，避免重复 append）
  hudRoot.querySelectorAll('#buymenu, #scoreboard').forEach((el) => el.remove())
  buyMenu = new BuyMenu(hudRoot, state, events)
  scoreboard = new Scoreboard(hudRoot, state)
  radar = new Radar(radarCanvas, prepped)

  loop.reset()
  matchendShown = false
  phase = 'running'
}

/** 回主菜单（#1/#2） */
function exitToMenu(): void {
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  phase = 'menu'
  loop.reset()
}

async function init(): Promise<void> {
  // 先加载生图表面贴图（失败回退 canvas），再建世界
  await loadImageTextures(textures)
  // 首局：直接进主菜单，背景先渲染一张默认地图
  void startMatch({ ...matchConfig })
  // 主菜单 UI（覆盖在对局之上）
  menuUI = new MenuUI(hudRoot, {
    onStart: (cfg) => {
      void startMatch(cfg)
    },
    onExit: () => exitToMenu(),
    onResume: () => {
      menuUI.hidePause()
      phase = 'running'
      loop.reset()
      canvas.requestPointerLock()
    },
  })
  // #7：设置实时生效钩子
  ;(hudRoot as HTMLElement & { __onSettingsApplied?: (s: Settings) => void }).__onSettingsApplied = applySettings
  applySettings(settings)

  // #2：ESC 触发 pointer lock 释放 → 自动暂停
  document.addEventListener('pointerlockchange', () => {
    if (!input.locked && phase === 'running') {
      phase = 'paused'
      loop.reset()
      menuUI.showPause()
    }
  })

  requestAnimationFrame(frame)
  window.addEventListener('resize', () => renderer.resize())
}

// 人物模型（three.js 官方 Soldier「Vanguard」CC 资产，含 Idle/Run/Walk；
// 失败回退 Quaternius character.glb，再失败退回色块人形）
void (async () => {
  if (!(await renderer.loadCharacterModel('/models/soldier.glb'))) {
    await renderer.loadCharacterModel('/models/character.glb')
  }
})()

void init()

interface DebugAPI {
  state(): GameState | null
  tickOnce(): void
  nav?: unknown
  events?: unknown
  renderer?: unknown
  textures?: unknown
  bulletPool?: number
  scorchPool?: number
  shotPool?: number
}
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: DebugAPI }).__game = {
    state: () => state,
    tickOnce: () => {
      if (state) stepLogic(1 / CONFIG.tickRate)
    },
    nav,
    events,
    renderer,
    textures,
    get bulletPool() {
      return bulletPool
    },
    get scorchPool() {
      return scorchPool
    },
    get shotPool() {
      return shotPool
    },
  }
}

// 印花池（对局重建时创建）
async function buildDecalPools(): Promise<void> {
  const [bulletTex, scorchTex, shotTex] = await Promise.all([
    makeDecalTexture('/textures/decal_bullet.png').catch(() => null),
    makeDecalTexture('/textures/decal_scorch.png').catch(() => null),
    makeDecalTexture('/textures/decal_shot.png').catch(() => null),
  ])
  if (bulletTex) bulletPool = renderer.addDecalPool(6, bulletTex, 48)
  if (scorchTex) scorchPool = renderer.addDecalPool(26, scorchTex, 16)
  if (shotTex) shotPool = renderer.addDecalPool(10, shotTex, 24)
}
void buildDecalPools()
