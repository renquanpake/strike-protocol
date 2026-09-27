import { CONFIG } from './game/config'
import { createGameState, type GameState } from './game/state'
import { matchLevel, type MapId } from './game/map/match'
import { prepareLevel } from './game/physics/collision'
import { buyItem } from './game/economy'
import { buildNavGrid } from './game/map/navmesh'
import { updatePlayerMovement, setMouseSensScale } from './game/systems/movement'
import { updateWeaponSystem, fireWeapon, viewForward, viewRight } from './game/systems/weapon'
import { updateTargets, trainingTargets } from './game/systems/targets'
import { updateRound } from './game/systems/round'
import { updateGrenades, inSmoke } from './game/systems/grenade'
import { updateDrops } from './game/systems/drops'
import { createBotContext, updateBots, type BotContext } from './game/systems/bot'
import { emptyInput } from './engine/input'
import { TARGET_PART_LOCAL } from './game/entities/target'
import { FixedLoop } from './engine/loop'
import { InputController } from './engine/input'
import { EventBus } from './engine/eventbus'
import { GameRenderer, type TargetDef } from './engine/renderer'
import { buildTextures, loadImageTextures, makeDecalTexture, makeBloodTexture, type TextureMap } from './engine/textures'
import { HUD } from './ui/hud'
import { BuyMenu } from './ui/buymenu'
import { Scoreboard } from './ui/scoreboard'
import { Radar, setRadarTeamColors } from './ui/radar'
import { setLanguage } from './ui/strings'
import { ViewModel } from './ui/viewmodel'
import { MenuUI, buildMatchEndStats, matchOptionsFromCfg } from './ui/menu'
import { Feedback } from './ui/feedback'
import { TouchController } from './ui/touch'
import { AudioEngine } from './engine/audio'
import { updateShells, spawnShell, type Shell } from './game/particles'
import { TracerRing, tracerWanted } from './game/tracer'
import { raycastBoxes } from './game/physics/raycast'
import { v3 } from './engine/math'
import { loadSettings, loadMatchConfig, type Settings, type MatchConfig } from './ui/settings'
import { WEAPONS, newWeaponInstance } from './game/weapons'
import { activeWeapon } from './game/systems/weapon'
import { persistMatchEnd, achievementName } from './game/achievements'

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudRoot = document.getElementById('hud') as HTMLElement
const radarCanvas = document.getElementById('radar') as HTMLCanvasElement

// #43 错误兜底：WebGL 不可用 / 运行时异常 → #fatal 或 #error-log
function showFatal(msg: string): void {
  const el = document.getElementById('fatal')
  const m = document.getElementById('fatal-msg')
  if (el) el.style.display = 'flex'
  if (m) m.textContent = msg
}
function logError(msg: string): void {
  const el = document.getElementById('error-log')
  if (!el) return
  el.style.display = 'block'
  el.textContent += msg + '\n'
  while (el.textContent.split('\n').length > 6) el.textContent = el.textContent.split('\n').slice(-5).join('\n')
}
window.addEventListener('error', (e) => logError(String(e.message)))
window.addEventListener('unhandledrejection', (e) => logError('promise: ' + String(e.reason)))
// WebGL 能力检测（renderer 构造前）
if (!document.createElement('canvas').getContext('webgl2')) {
  showFatal('当前浏览器不支持 WebGL2，无法渲染 3D 场景。请使用最新版 Chrome / Edge / Firefox。')
  ;(window as unknown as { __BOOT_FAILED?: boolean }).__BOOT_FAILED = true
}

let settings: Settings = loadSettings()
let textures: TextureMap = buildTextures()

// ===== 全局持久对象 =====
const input = new InputController()
input.attach(canvas)
// 移动端触控层：触屏设备 / mobile.html / ?touch 自动启用（左摇杆 + 右拖拽视角 + 动作键）
const IS_TOUCH =
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    ? true
    : 'ontouchstart' in window || location.pathname.includes('mobile') || new URLSearchParams(location.search).has('touch')
let touch: TouchController | null = null
if (IS_TOUCH) touch = new TouchController(hudRoot, input)
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

// 渲染器（#43：init 内延迟构造，失败显示兜底页）
let renderer: GameRenderer
function mapPalette(name: string) {
  return CONFIG.SKY_PALETTES[name] ?? CONFIG.SKY_PALETTES['de_sahara']
}
function makeRenderer(): GameRenderer {
  const r = new GameRenderer(canvas, settings.fov)
  r.configure(mapPalette(level.name), 2600, settings.quality === 'high' ? 4096 : 2048)
  return r
}

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

// #13 曳光：本地玩家弹道（狙击/单发枪每发，自动武器每 3 发一条）
const shotSeq: Record<string, number> = {}
events.on('shot', (e) => {
  if (e.shooterId !== 0 || e.weaponId === 'drop') return
  shotSeq[e.weaponId] = (shotSeq[e.weaponId] ?? 0) + 1
})
events.on('surfaceHit', (e) => {
  if (e.shooterId !== 0) return
  const st = state
  const p = st?.players[0]
  const eyeY = p ? p.position.y + CONFIG.eyeHeight : 0
  const dist = p ? Math.hypot(e.point.x - p.position.x, e.point.y - eyeY, e.point.z - p.position.z) : 0
  // V2 CC0 命中材质三态（金属/木/沙地）；G1 穿墙命中走闷声
  audio.surfaceHit(e.material, e.penetrated ?? false, e.point.x, e.point.y, e.point.z, dist)
  // G1 穿墙命中：入口点投射烟尘 decal（shot 池），非穿墙用弹孔 decal
  const pool = e.pellets > 1 ? shotPool : e.penetrated ? shotPool : bulletPool
  renderer.spawnDecal(pool, e.point, e.normal, e.pellets > 1 ? 2.4 : e.penetrated ? 1.8 : 1)
  if (e.pellets === 1 && !e.penetrated) {
    const def = WEAPONS[e.weaponId] ?? { auto: false }
    if (tracerWanted(shotSeq[e.weaponId] ?? 1, def)) spawnTracer(e.point)
  }
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

// ===== M2 手感层（#8-#16）=====
let feedback: Feedback | null = null
// #8 开镜：FOV 逐帧插值（档位 p.aimStage 由 stepLogic 推进）
let curFov = 75
// #11 屏幕震动
let shakeUntil = 0
let shakeAmp = 0
// #13 曳光池
const TRACER_POOL = 32
const tracerRing = new TracerRing(TRACER_POOL)
const tracerUntil: number[] = new Array(TRACER_POOL).fill(0)
const tracerCoords = Array.from({ length: TRACER_POOL }, () => ({
  x1: 0,
  y1: -9999,
  z1: 0,
  x2: 0,
  y2: -9999,
  z2: 0,
}))
function spawnTracer(to: { x: number; y: number; z: number }): void {
  const i = tracerRing.next()
  tracerCoords[i] = {
    x1: lastShotMuzzle.x,
    y1: lastShotMuzzle.y,
    z1: lastShotMuzzle.z,
    x2: to.x,
    y2: to.y,
    z2: to.z,
  }
  tracerUntil[i] = performance.now() + 60
}
// #16 血雾池（dynamicSphere）
const BLOOD_POOL = 12
const bloodUntil: number[] = new Array(BLOOD_POOL).fill(0)
const bloodPos: { x: number; y: number; z: number }[] = Array.from({ length: BLOOD_POOL }, () => ({
  x: 0,
  y: -9999,
  z: 0,
}))
let bloodSeq = 0
let bloodPool = -1
// #35 玻璃碎片池
const SHARD_POOL = 8
const shardUntil: number[] = new Array(SHARD_POOL).fill(0)
const shardPos: { x: number; y: number; z: number }[] = Array.from({ length: SHARD_POOL }, () => ({
  x: 0,
  y: -9999,
  z: 0,
}))
let shardSeq = 0
// #35 玻璃 box 句柄（破碎隐藏 / 回合恢复）
let glassBoxes: Map<unknown, { visible: boolean }> = new Map()
// #12 心跳节拍
let lastBeat = 0
// #15 观战
let spectIdx = 0
let prevFireQueued = false

events.on('shot', (e) => {
  const st = state
  if (!st) return
  const p = st.players[e.shooterId]
  if (!p) return
  const isLocal = e.shooterId === 0
  const eyeY = p.position.y + CONFIG.eyeHeight
  audio.shot(e.weaponId, p.position.x, eyeY, p.position.z, isLocal, e.muffled ?? false)
  if (isLocal && viewmodel) {
    viewmodel.setKick(4)
    // 枪口位置：优先用武器模型枪口（随摆动/后坐），首次开火前回退到眼位前 24u
    const vmMuzzle = viewmodel.getMuzzle()
    const fwd = viewForward(p.yaw, p.pitch)
    lastShotMuzzle = vmMuzzle.y > -9000 ? vmMuzzle : v3(p.position.x + fwd.x * 24, eyeY + fwd.y * 24, p.position.z + fwd.z * 24)
    muzzleTicks = 6
    // 枪口动态火光（弱暖光，短促）
    renderer.addFlashLight(lastShotMuzzle.x, lastShotMuzzle.y, lastShotMuzzle.z, 0xffd27a, 0.9, 120)
    // 弹壳
    const up = v3(0, 1, 0)
    const right = viewRight(p.yaw, p.pitch)
    spawnShell(shells, shellSeq++, lastShotMuzzle, right, up, fwd, 200)
  }
})
events.on('hit', (e) => {
  const st = state
  if (e.attackerId === 0) {
    audio.hitmarker(e.part)
    hitmarkUntil = performance.now() + 120
    hitmarkHead = e.part === 'head'
  }
  if (e.victimId === 0 && st) {
    const p = st.players[0]
    const attacker = st.players[e.attackerId]
    if (attacker) {
      // #10 受击方向：攻击者相对方位
      const px = p.position.x
      const pz = p.position.z
      const rel = normAngle(Math.atan2(attacker.position.x - px, attacker.position.z - pz) - (p.yaw + Math.PI))
      feedback?.showDmgDir(rel)
    }
    dmgUntil = performance.now() + 220
    // #16 血雾：受害者为本地玩家在命中点喷血
    const bi = bloodSeq++ % BLOOD_POOL
    bloodUntil[bi] = performance.now() + 300
    const vict = st.players[e.victimId]
    if (vict) {
      bloodPos[bi] = { x: vict.position.x, y: vict.position.y + 44, z: vict.position.z }
    }
  }
})
// #37 训练场：命中靶子显示伤害 / 部位（本地玩家）
events.on('hit', (e) => {
  const st = state
  if (!st?.training || e.attackerId !== 0) return
  if (st.targets.some((x) => x.id === e.victimId)) feedback?.showDamage(e.damage, e.part)
})
// #5 击杀播报 + #14 击杀奖励 + #16 血迹
events.on('playerKilled', (e) => {
  const st = state
  if (!st) return
  const attacker = st.players[e.attackerId]
  const victim = st.players[e.victimId]
  if (!attacker || !victim) return
  feedback?.addKill(attacker, victim, e.weaponId, e.headshot)
  if (e.attackerId === 0) {
    const def = WEAPONS[e.weaponId]
    feedback?.showKillReward(def?.killReward ?? 0, e.headshot)
  } else if (attacker.alive && st.rng.float() < 0.35) {
    // #23 无线电：队友击杀随机播报
    events.emit({ type: 'radio', team: attacker.team, key: 'niceShot', playerId: attacker.id })
  }
})
// #23 无线电（只显示本队；敌方事件不播）
events.on('radio', (e) => {
  const st = state
  if (!st) return
  if (e.team !== st.players[0].team) return
  const name = st.players[e.playerId]?.name ?? '???'
  feedback?.addRadio(e.team, e.key, name)
  audio.radioBeep()
})
// #17 C4 拾取提示
events.on('c4PickedUp', (e) => {
  const st = state
  const p = st?.players[e.playerId]
  if (p) feedback?.toast(`${p.name} 拾取了 C4`)
})
// #41 成就 toast
events.on('achievement', (e) => {
  feedback?.toast(`成就解锁：${achievementName(e.id)}`)
  audio.radioBeep()
})
// #11 屏幕震动
events.on('grenadeExploded', (e) => {
  const st = state
  if (!st) return
  const p = st.players[0]
  const d = Math.hypot(e.x - p.position.x, e.z - p.position.z)
  triggerShake(Math.max(0, Math.min(1, 1 - d / CONFIG.shakeDecayDist)) * CONFIG.shakeMaxAmp, e.kind === 'flash' ? 0.5 : 1)
})
events.on('bombExploded', () => {
  const st = state
  if (!st) return
  triggerShake(CONFIG.shakeMaxAmp, 1)
})
function triggerShake(amp: number, scale: number): void {
  if (!settings.screenShake || amp <= 0) return
  shakeAmp = Math.min(CONFIG.shakeMaxAmp, amp * scale)
  shakeUntil = performance.now() + 260
}

// #35 玻璃破碎：音效 + 碎片 + 隐藏玻璃 box
events.on('glassBreak', (e) => {
  audio.glassBreak(e.x, e.y, e.z)
  const si = shardSeq++ % SHARD_POOL
  shardUntil[si] = performance.now() + 300
  shardPos[si] = { x: e.x, y: e.y, z: e.z }
  const st = state
  if (st && st.brokenGlass.length > 0) {
    const b = st.brokenGlass[st.brokenGlass.length - 1]
    const m = glassBoxes.get(b)
    if (m) m.visible = false
  }
})
// 回合重置：玻璃 box 恢复可见
events.on('roundEnd', () => {
  for (const m of glassBoxes.values()) m.visible = true
})

/** 归一化角度到 [-π, π] */
function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

// #16 血迹 decal（受害者脚下地面），回合结束清理
events.on('playerKilled', (e) => {
  const st = state
  if (!st || bloodPool < 0) return
  const victim = st.players[e.victimId]
  if (!victim) return
  const hit = surfaceBelow(victim.position.x, victim.position.y + 30, victim.position.z)
  if (hit) renderer.spawnDecal(bloodPool, hit.point, hit.normal, 2.2)
  else {
    renderer.spawnDecal(bloodPool, { x: victim.position.x, y: victim.position.y, z: victim.position.z }, { x: 0, y: 1, z: 0 }, 2.2)
  }
})
events.on('roundEnd', () => {
  if (bloodPool >= 0) renderer.clearDecals(bloodPool)
})
events.on('grenadeExploded', (e) => {
  const kind = e.kind === 'flash' ? 'flash' : e.kind === 'molotov' || e.kind === 'smoke' ? e.kind : 'he'
  audio.explosion(kind, e.x, e.y, e.z)
  // 动态火光（爆炸/燃烧橙光、闪光白光）
  if (e.kind === 'flash') renderer.addFlashLight(e.x, e.y + 20, e.z, 0xfff6e0, 5, 200)
  else if (e.kind === 'he' || e.kind === 'molotov') renderer.addFlashLight(e.x, e.y + 10, e.z, 0xff9a3c, 3.5, e.kind === 'he' ? 300 : 500)
})
events.on('bombExploded', () => {
  const st = state
  if (!st) return
  audio.explosion('c4', st.round.c4.position.x, st.round.c4.position.y, st.round.c4.position.z)
  renderer.addFlashLight(st.round.c4.position.x, st.round.c4.position.y + 30, st.round.c4.position.z, 0xff8a2a, 7, 500)
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
let prevLocalAimHeld = false
let prevLocalWeaponId = ''

function stepLogic(dt: number): void {
  const st = state
  if (!st) return
  const frame = touch ? touch.poll() : input.poll()
  const local = st.players[0]
  local.input = frame
  // 开镜档位（每 tick 推进，逻辑层确定性；渲染层只消费 p.aimStage）
  const localW = activeWeapon(local)
  const localWId = localW?.defId ?? ''
  if (localWId !== prevLocalWeaponId) local.aimStage = 0
  prevLocalWeaponId = localWId
  const localZoom = localW ? WEAPONS[localWId].zoom : undefined
  if (frame.aimHeld && localZoom) {
    if (!prevLocalAimHeld) local.aimStage = (local.aimStage + 1) % (localZoom.fovs.length + 1)
  } else {
    local.aimStage = 0
  }
  prevLocalAimHeld = frame.aimHeld
  // 边沿标志在 tick 级累积，避免一帧多 tick 时被后续 tick 覆盖丢失
  if (frame.buyQueued) pendingBuyToggle = true
  if (botCtx) updateBots(st, prepped, nav, botCtx, events, dt)
  for (const p of st.players) {
    if (p.id !== 0 && !p.isBot) p.input = emptyInput()
    if (!p.alive) continue
    updatePlayerMovement(st, p, prepped, dt, events)
    updateWeaponSystem(st, p, events)
    fireWeapon(st, p, prepped, events, dt)
    updateDrops(st, p, events)
  }
  updateTargets(st, dt)
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
    // 烟雾剪影：人物（眼高）在烟雾区内 → 罩雾壳，模拟"烟里只见轮廓"
    const smoked = p.alive ? inSmoke(st, p.position.x, p.position.y + CONFIG.eyeHeight, p.position.z) : false
    renderer.updateHumanoid(`bot:${p.id}`, p.position.x, p.position.y, p.position.z, p.yaw, p.alive, false, moving, smoked)
  }
  const c4 = st.round.c4
  const c4Visible = st.mode === 'de' && (c4.state === 'carried' || c4.state === 'dropped' || c4.state === 'planted')
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

/** #27 掉落武器配色（按武器类） */
const DROP_COLORS: Record<string, number> = {
  pistol: 0x9fb0c4,
  smg: 0x8fa3ad,
  rifle: 0xc8862a,
  sniper: 0x3f6fae,
  shotgun: 0x7a5a3a,
  lmg: 0x5a5a5a,
  knife: 0xd0342c,
  grenade: 0x8a9a5a,
}

function ensureDyn(key: string): void {
  if (madeDyn.has(key)) return
  madeDyn.add(key)
  const st = state
  if (key.startsWith('g:')) {
    const g = st?.grenades.find((x) => `g:${x.id}` === key)
    renderer.addDynamicSphere(key, 8, GREN_COLORS[g?.kind ?? 'he'] ?? 0x888888)
  } else if (key.startsWith('d:')) {
    // #27 掉落武器：小箱模型按武器类染色
    const dw = st?.droppedWeapons.find((x) => `d:${x.id}` === key)
    const cat = dw ? WEAPONS[dw.defId]?.category : undefined
    renderer.addDynamicBox(key, 18, 6, 18, DROP_COLORS[cat ?? ''] ?? 0x888888)
  } else if (key.startsWith('sm:')) {
    // #32 烟雾 = 粒子云（低画质档减密度）
    renderer.addParticleCloud(key, settings.quality === 'low' ? 24 : 40, 0x9fb4c4, 18)
  } else {
    // #32 火焰 = 双层错相位粒子云（主橙 + 少量黄芯）
    renderer.addParticleCloud(key, settings.quality === 'low' ? 20 : 30, 0xff7043, 10)
    renderer.addParticleCloud(`${key}c`, 12, 0xffc94d, 6)
  }
}

function refreshGrenades(): void {
  const st = state
  if (!st) return
  const liveG = new Set(st.grenades.map((g) => `g:${g.id}`))
  const liveSm = new Set(st.smokes.map((z) => `sm:${z.id}`))
  const liveFn = new Set(st.burns.map((z) => `fn:${z.id}`))
  const liveD = new Set(st.droppedWeapons.map((w) => `d:${w.id}`))
  for (const g of st.grenades) {
    ensureDyn(`g:${g.id}`)
    renderer.updateDynamicSphere(`g:${g.id}`, g.position.x, g.position.y + 8, g.position.z, true)
  }
  for (const w of st.droppedWeapons) {
    ensureDyn(`d:${w.id}`)
    renderer.updateDynamicBox(`d:${w.id}`, w.position.x, w.position.y + 3, w.position.z, true)
  }
  for (const z of st.smokes) {
    ensureDyn(`sm:${z.id}`)
    // 烟雾体积化：先 25% 寿命内膨胀至 1.35×，随后整团缓慢上升（模拟烟随风抬升）
    const lifeTicks = Math.max(1, Math.round((CONFIG.smokeLifeMs / 1000) * CONFIG.tickRate))
    const remain = Math.max(0, z.untilTick - st.tick)
    const ageFrac = 1 - remain / lifeTicks
    const grow = 1 + 0.35 * Math.min(1, ageFrac * 4)
    const rise = 14 * Math.min(1, ageFrac)
    renderer.updateParticleCloud(`sm:${z.id}`, z.center.x, z.center.y + 25 + rise, z.center.z, z.radius * grow, true)
  }
  for (const z of st.burns) {
    ensureDyn(`fn:${z.id}`)
    renderer.updateParticleCloud(`fn:${z.id}`, z.center.x, z.center.y + 8, z.center.z, Math.max(30, z.radius * 0.5), true)
    renderer.updateParticleCloud(`fn:${z.id}c`, z.center.x, z.center.y + 5, z.center.z, Math.max(18, z.radius * 0.3), true)
  }
  // 隐藏已消失的
  for (const key of madeDyn) {
    const alive =
      (key.startsWith('g:') && liveG.has(key)) ||
      (key.startsWith('d:') && liveD.has(key)) ||
      (key.startsWith('sm:') && liveSm.has(key)) ||
      (key.startsWith('fn:') && liveFn.has(key))
    if (!alive) {
      if (key.startsWith('g:')) renderer.updateDynamicSphere(key, 0, -9999, 0, false)
      else if (key.startsWith('d:')) renderer.updateDynamicBox(key, 0, -9999, 0, false)
      else if (key.startsWith('sm:')) renderer.updateParticleCloud(key, 0, -9999, 0, 1, false)
      else {
        renderer.updateParticleCloud(key, 0, -9999, 0, 1, false)
        renderer.updateParticleCloud(`${key}c`, 0, -9999, 0, 1, false)
      }
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

  syncAudioScene()

  // 触控层仅在对局进行中显示（菜单/暂停/结算隐藏，露出 DOM 菜单）
  touch?.setVisible(phase === 'running')

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

  // ===== 相机源（#15 观战）：本地存活 = 本地玩家；死亡 = 存活队友轮换 / 俯瞰自由视角 =====
  const liveTeamMates = st.players.filter((x) => x.team === p.team && x.alive && x.id !== 0)
  const camOwner = p.alive ? p : liveTeamMates.length > 0 ? liveTeamMates[spectIdx % liveTeamMates.length] : null
  let camX: number
  let camY: number
  let camZ: number
  let camYaw: number
  let camPitch: number
  if (camOwner) {
    camX = camOwner.position.x
    camY = camOwner.position.y
    camZ = camOwner.position.z
    camYaw = camOwner.yaw
    camPitch = camOwner.pitch
  } else {
    camX = 0
    camY = 600
    camZ = 0
    camYaw = Math.PI
    camPitch = -Math.PI / 4
  }
  feedback?.showSpectate(p.alive ? null : camOwner ? camOwner.name : '自由视角')
  if (!p.alive && p.input.fireQueued && !prevFireQueued) {
    spectIdx += 1
  }
  prevFireQueued = p.input.fireQueued

  // #8 开镜：右键按住时 FOV 逐帧 lerp + 镜 overlay（档位由 stepLogic 推进 p.aimStage）
  const w = activeWeapon(p)
  const wId = w?.defId ?? ''
  const zoom = w ? WEAPONS[wId].zoom : undefined
  const aimActive = p.alive && p.aimStage > 0 && !!zoom
  const targetFov = aimActive && zoom ? zoom.fovs[p.aimStage - 1] : settings.fov
  curFov += (targetFov - curFov) * Math.min(1, frameDt * 9)
  renderer.setFov(curFov)
  feedback?.setScope(aimActive, p.aimStage)

  refreshTargetDefs()
  renderer.updateTargets(targetDefs)
  refreshDynamic()
  radar?.update(st)

  const eye = camOwner === p ? (p.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight) : CONFIG.eyeHeight

  // #11 屏幕震动（爆炸衰减随机偏移，受设置开关控制）
  const nowMs2 = performance.now()
  let shakeYaw = 0
  let shakePitch = 0
  if (nowMs2 < shakeUntil) {
    const k = shakeAmp * ((shakeUntil - nowMs2) / 260) * 0.01
    shakeYaw = (Math.random() - 0.5) * 2 * k
    shakePitch = (Math.random() - 0.5) * 2 * k
  }

  renderer.setCamera({
    x: prevX + (camX - prevX) * alpha,
    y: prevY + (camY - prevY) * alpha + eye,
    z: prevZ + (camZ - prevZ) * alpha,
    yaw: prevYaw + (camYaw - prevYaw) * alpha + shakeYaw,
    pitch: prevPitch + (camPitch - prevPitch) * alpha + shakePitch,
  })
  // 第一人称武器模型：本地存活且未开镜才显示（AWP 风格开镜下沉隐藏）
  if (p.alive && viewmodel && !aimActive) {
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

  // #9 动态准星（逐帧，散布驱动间距）
  feedback?.updateCrosshair(p, CONFIG.crosshairGapPerDeg, aimActive)

  // #12 低血量心跳（<30 启动 800ms，<15 加密 500ms）；红晕与受击闪在同一处合并计算，避免互相覆盖
  {
    const hp = p.health
    if (hp < 30 && p.alive) {
      const interval = hp < 15 ? 500 : 800
      if (nowMs2 - lastBeat > interval) {
        lastBeat = nowMs2
        audio.heartbeat(Math.min(1, 1 - hp / 30))
      }
    }
  }

  // #16 血雾（本地受击 300ms 命中点红色球）
  for (let i = 0; i < BLOOD_POOL; i++) {
    const on = performance.now() < bloodUntil[i]
    const bp = bloodPos[i]
    renderer.updateDynamicSphere(`blood:${i}`, bp.x, bp.y, bp.z, on)
  }

  // #35 玻璃碎片（300ms）
  for (let i = 0; i < SHARD_POOL; i++) {
    const on = performance.now() < shardUntil[i]
    const sp = shardPos[i]
    renderer.updateDynamicSphere(`shard:${i}`, sp.x, sp.y, sp.z, on)
  }

  // #13 曳光（本地开火命中后 60ms 淡出）
  for (let i = 0; i < TRACER_POOL; i++) {
    const c = tracerCoords[i]
    const on = performance.now() < tracerUntil[i]
    renderer.updateTracer(`tr:${i}`, c.x1, c.y1, c.z1, c.x2, c.y2, c.z2, on ? 0.7 : 0)
  }

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
    // #12 低血量常驻红晕（渐变随 HP）叠加 #10 受击闪红，取两者最大值
    const lowHp = p.alive && p.health < 30 ? Math.max(0.22, (30 - p.health) / 30 * 0.4) : 0
    dmgEl.style.opacity = String(Math.max(lowHp, nowMs < dmgUntil ? 0.85 : 0))
  }

  const roundMsgEl = document.getElementById('roundmsg') as HTMLElement | null
  if (roundMsgEl) {
    const r = st.round
    if (r.phase === 'matchEnd') {
      roundMsgEl.style.display = 'block'
      roundMsgEl.textContent = `MATCH OVER — ${r.lastWinner} WINS ${r.score.T}:${r.score.CT}`
    } else if (r.phase === 'roundEnd' || r.phase === 'halftime') {
      roundMsgEl.style.display = 'block'
      // MVP：本回合击杀最多者（roundKills 在下个 freeze 才清零，roundEnd 期间可读）
      let mvp = st.players[0]
      for (const pl of st.players) if (pl.roundKills > mvp.roundKills) mvp = pl
      const mvpLine = mvp.roundKills > 0 ? ` · MVP ${mvp.name}（${mvp.roundKills} 杀）` : ''
      roundMsgEl.textContent =
        r.phase === 'halftime'
          ? `HALFTIME — 换边${mvpLine}`
          : `${r.lastWinner} 赢下回合（${r.lastResult}）${mvpLine}`
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

  hud.update(st, fps, input.locked || (touch ? true : false), now)
  // 致盲白屏
  const blindEl = document.getElementById('blind') as HTMLElement | null
  if (blindEl) {
    const remain = p.blindUntil - st.tick
    blindEl.style.opacity = remain > 0 ? String(Math.min(1, (remain / 256) * 1.2)) : '0'
  }
  // 本地烟幕罩：自身（眼高）处于烟雾区 → 屏幕白雾
  const smokeVeil = document.getElementById('smokeveil') as HTMLElement | null
  if (smokeVeil) {
    const eyeY = p.position.y + CONFIG.eyeHeight
    const inSm = inSmoke(st, p.position.x, eyeY, p.position.z)
    smokeVeil.style.opacity = inSm ? '0.8' : '0'
  }

  // #4 结算屏：matchEnd 触发一次
  if (st.round.phase === 'matchEnd' && !matchendShown) {
    matchendShown = true
    phase = 'matchend'
    // #40 生涯 + #41 成就（写入后逐条发 achievement 事件 → toast）
    const me = st.players[0]
    const result: 'win' | 'loss' | 'draw' =
      me.team === st.round.lastWinner ? 'win' : st.round.lastWinner === null ? 'draw' : 'loss'
    const unlocked = persistMatchEnd(st, result, matchConfig.mapId, matchConfig.mode)
    for (const id of unlocked) events.emit({ type: 'achievement', id })
    menuUI.showMatchEnd(buildMatchEndStats(st))
  }
}

/** #34 音乐/环境音场景切换（幂等，逐帧调用） */
function syncAudioScene(): void {
  if (phase === 'menu') {
    audio.stopAmbient()
    audio.startMenuMusic()
  } else {
    audio.stopMenuMusic()
    const st = state
    if (st && (st.round.phase === 'live' || st.round.phase === 'bombPlanted')) audio.startAmbient()
    else audio.stopAmbient()
  }
}

/** V5：debug 面板显隐（?debug=1 强制开，否则看设置 showDebug，默认关） */
const DEBUG_FORCED = new URLSearchParams(location.search).has('debug')
function applyDebugFlag(showDebug: boolean): void {
  document.body.classList.toggle('debug-on', DEBUG_FORCED || showDebug)
}

/** 应用设置（#3/#7/#9/#38/#42 + V5 debug 面板）：音量/FOV/画质/灵敏度/准星/小地图/语言/色盲 */
function applySettings(s: Settings): void {
  settings = s
  audio.setMasterVolume(s.volume)
  renderer.setFov(s.fov)
  setMouseSensScale(s.mouseSens)
  renderer.setQuality(s.quality)
  renderer.setDprCap(s.resolution)
  feedback?.applyCrosshairSettings(s.crosshair.style, s.crosshair.color, s.crosshair.gapScale)
  feedback?.setMinimapVisible(s.showMinimap)
  setLanguage(s.language)
  setRadarTeamColors(s.teamColors)
  input.setBinds(s.binds)
  buyMenu?.applyLang()
  applyDebugFlag(s.showDebug)
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
  if (cfg.mapId === 'training') {
    // #37 训练场：填靶 + 无限弹 + 金钱锁
    state.targets = trainingTargets()
    state.training = true
    for (const p of state.players) p.money = CONFIG.moneyCap
  }
  if (cfg.mode === 'de') {
    state.round.phaseEndTick = Math.round((CONFIG.warmupMs / 1000) * CONFIG.tickRate)
  } else {
    // #36 死斗/团队死斗：跳过 warmup 直接 live，固定配装 + 金钱锁
    state.round.phase = 'live'
    state.round.phaseEndTick = Infinity
    for (const p of state.players) {
      p.weapons.primary = newWeaponInstance('m4')
      p.weapons.secondary = newWeaponInstance('deagle')
      p.weapons.grenades = [
        newWeaponInstance('he'),
        newWeaponInstance('flash'),
        newWeaponInstance('smoke'),
        newWeaponInstance('molotov'),
      ]
      p.activeSlot = 0
      p.money = CONFIG.moneyCap
    }
  }
  if (!state.training) state.targets = []
  botCtx = createBotContext(state, level.sites, state.difficulty)

  // 重建渲染世界
  renderer.resetWorld()
  renderer.configure(mapPalette(level.name), 2600, settings.quality === 'high' ? 4096 : 2048)
  madeDyn.clear()
  for (const s of shells) {
    s.active = false
    s.position = v3(0, -9999, 0)
  }
  viewmodel = new ViewModel(renderer, textures)
  // Blender 高模替换（按枪类逐个接入；失败保留程序化模型）
  // V1：m4.glb 灰模补 PBR 贴图（imggen 生成 baseColor/normal/roughness）
  void viewmodel.upgradeWithGLB(
    'rifle',
    '/models/m4.glb',
    38,
    -0.28,
    { map: textures.m4_basecolor, normal: textures.m4_normal, roughness: textures.m4_roughness },
  )
  glassBoxes = new Map()
  for (const b of level.brushes) {
    if (b.clip) continue
    const mesh = renderer.addBox(b.min, b.max, 0xffffff, b.material === 'glass' ? 0.45 : 1, b.material, textures)
    if (b.material === 'glass') glassBoxes.set(b, mesh)
  }
  // #35 碎片池
  for (let i = 0; i < SHARD_POOL; i++) renderer.addDynamicSphere(`shard:${i}`, 4, 0xbfe8e0)
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
    renderer.addHumanoid(`bot:${p.id}`, camo, accent, p.team)
  }
  renderer.addDynamicBox('c4', 14, 8, 10, 0xd0342c)
  // 弹壳池重新注册
  for (let i = 0; i < SHELL_POOL; i++) renderer.addDynamicSphere(`shell:${i}`, 3, 0xd4af37)
  renderer.addDynamicSphere('muzzle', 6, 0xffd75e)
  // #13 曳光 / #16 血雾 池
  for (let i = 0; i < TRACER_POOL; i++) renderer.addTracer(`tr:${i}`)
  for (let i = 0; i < BLOOD_POOL; i++) renderer.addDynamicSphere(`blood:${i}`, 6, 0x8b0000)
  // #16 血迹印花池（程序化血渍纹理）
  bloodPool = renderer.addDecalPool(10, makeBloodTexture(), 14)
  feedback?.clear()

  // UI 重绑（先清旧 DOM，避免重复 append）
  hudRoot.querySelectorAll('#buymenu, #scoreboard').forEach((el) => el.remove())
  buyMenu = new BuyMenu(hudRoot, state, prepped, events)
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
  menuUI.showMenu()
}

// #6 加载屏（LOGO + 进度条 + 状态文字）
function setLoadProgress(frac: number, label: string): void {
  const bar = document.getElementById('loading-bar')
  const status = document.getElementById('loading-status')
  if (bar) bar.style.width = `${Math.round(frac * 100)}%`
  if (status) status.textContent = label
}
function hideLoading(): void {
  const el = document.getElementById('loading')
  if (!el) return
  el.classList.add('hidden')
  setTimeout(() => el.remove(), 450)
}

async function init(): Promise<void> {
  if ((window as unknown as { __BOOT_FAILED?: boolean }).__BOOT_FAILED) return
  // #6 加载屏：逐步报进度
  setLoadProgress(0.05, '初始化渲染器…')
  // #43：渲染器构造失败（WebGL 上下文创建失败）→ 兜底页
  try {
    renderer = makeRenderer()
  } catch (e) {
    showFatal('WebGL 渲染器初始化失败：' + String(e))
    return
  }
  // 先加载生图表面贴图（失败回退 canvas），再建世界
  setLoadProgress(0.1, '加载贴图…')
  await loadImageTextures(textures, (done, total) => setLoadProgress(0.1 + 0.35 * (done / total), `加载贴图 ${done}/${total}…`))
  // 人物模型：优先 character.glb（Mixamo 全动画 PBR，含 Death01/Hit_Chest 死亡帧，观感对标基准）；
  // 失败回退 soldier.glb（three.js 官方 Vanguard，仅 Idle/Run/Walk）再退回色块
  setLoadProgress(0.55, '加载人物模型…')
  let charDegraded = false
  const chH = CONFIG.charVisualHeight
  if (!(await renderer.loadCharacterModel('/models/character.glb', 'T', chH))) {
    charDegraded = true
    await renderer.loadCharacterModel('/models/soldier.glb', 'T', chH)
  }
  // #30 阵营差异化：CT 独立模板（缺则回退共享 T 模板，不影响可用性）
  await renderer.loadCharacterModel('/models/ct_soldier.glb', 'CT', chH).catch(() => false)
  setLoadProgress(0.8, charDegraded ? '人物模型已降级（回退资产）' : '构建对局世界…')
  feedback = new Feedback(hudRoot, radarCanvas)
  // 首局：直接进主菜单，背景先渲染一张默认地图
  void startMatch({ ...matchConfig })
  // 主菜单 UI（覆盖在对局之上）
  menuUI = new MenuUI(hudRoot, {
    onStart: (cfg) => {
      menuUI.hideAll()
      void startMatch(cfg)
    },
    onExit: () => exitToMenu(),
    onResume: () => {
      menuUI.hidePause()
      phase = 'running'
      loop.reset()
      if (!IS_TOUCH) canvas.requestPointerLock()
    },
  })
  // 移动端暂停按钮（替代桌面 ESC/指针锁释放）
  if (touch) {
    touch.lookScale = 1.0 + (settings.mouseSens - 1) * 0.5
    touch.onPause = () => {
      if (phase === 'running') {
        phase = 'paused'
        loop.reset()
        menuUI.showPause()
      }
    }
  }
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

  setLoadProgress(1, '完成')
  hideLoading()
  requestAnimationFrame(frame)
  window.addEventListener('resize', () => renderer.resize())
}

// 人物模型（three.js 官方 Soldier「Vanguard」CC 资产，含 Idle/Run/Walk；
// 失败回退 Quaternius character.glb，再失败退回色块人形）——init 内加载（renderer 就绪后）
void init()

interface DebugAPI {
  state(): GameState | null
  tickOnce(): void
  nav?: unknown
  /** 当前预制地图（含 bombsites），headless 走查推进/下包用 */
  level?: unknown
  events?: unknown
  renderer?: unknown
  textures?: unknown
  bulletPool?: number
  scorchPool?: number
  shotPool?: number
  /** #输入控制器（headless 键鼠走查用） */
  input?: unknown
  /** 本地玩家购买（headless 买区/手枪轮走查用） */
  buy?: (itemId: string) => boolean
}
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: DebugAPI }).__game = {
    state: () => state,
    tickOnce: () => {
      if (state) stepLogic(1 / CONFIG.tickRate)
    },
    nav,
    get level() {
      return prepped
    },
    events,
    input,
    buy: (itemId: string) => {
      if (!state) return false
      return buyItem(state, state.players[0], itemId, events, prepped)
    },
    get renderer() {
      return renderer
    },
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
