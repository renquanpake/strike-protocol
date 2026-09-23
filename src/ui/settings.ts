/**
 * 全局设置：单一来源，localStorage 持久化（`sp_settings`）。
 * 数值类改动先落这里，再挂消费点（movement/renderer/audio/ui），禁止散落魔法数字。
 * 新增字段时保留旧存档合并：loadSettings() 浅合并 DEFAULTS，缺字段自动补齐。
 */

export interface CrosshairSettings {
  style: 'cross' | 'dot' | 'circle'
  color: string
  gapScale: number
}

export interface Settings {
  /** 70-110 度 */
  fov: number
  /** 0.2-3.0 倍率（CONFIG.mouseSens × 此值） */
  mouseSens: number
  /** 0-1 主音量 */
  volume: number
  crosshair: CrosshairSettings
  screenShake: boolean
  showMinimap: boolean
  quality: 'low' | 'medium' | 'high'
  /** 设备像素比上限 */
  resolution: 1 | 1.5 | 2
  language: 'zh' | 'en'
  teamColors: 'default' | 'deuteranopia'
  /** #42 改键：action → KeyboardEvent.code */
  binds: Record<string, string>
}

/** #42 默认键位（与历史硬编码一致） */
export const DEFAULT_BINDS: Record<string, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  walk: 'ShiftLeft',
  reload: 'KeyR',
  buy: 'KeyB',
  drop: 'KeyG',
  use: 'KeyE',
  scoreboard: 'Tab',
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 90,
  mouseSens: 1,
  volume: 0.7,
  crosshair: { style: 'cross', color: '#d8ffe8', gapScale: 1 },
  screenShake: true,
  showMinimap: true,
  quality: 'high',
  resolution: 2,
  language: 'zh',
  teamColors: 'default',
  binds: { ...DEFAULT_BINDS },
}

const KEY = 'sp_settings'

export function loadSettings(): Settings {
  let stored: Partial<Settings> = {}
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) stored = JSON.parse(raw) as Partial<Settings>
  } catch {
    stored = {}
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(stored.crosshair ?? {}) },
    binds: { ...DEFAULT_BINDS, ...(stored.binds ?? {}) },
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 无痕模式等写入失败时静默
  }
}

/** 对局配置：由主菜单表单产出（#1），随 startMatch(cfg) 进入对局。
 * 难度表引用 #19 的 BOT_DIFFICULTY（config.ts），1-10 档。 */
export interface MatchConfig {
  mapId: string
  mode: 'de' | 'dm' | 'tdm'
  /** 总 bot 数（默认 9：两侧共 10 人 = 5v5） */
  botCount: number
  playerSide: 'T' | 'CT'
  difficulty: number
  playerName: string
  /** 不填则随机（#44：种子回写 state.rngSeed 并显示） */
  seed?: number
}

export const DEFAULT_MATCH: MatchConfig = {
  mapId: 'de_sahara',
  mode: 'de',
  botCount: 9,
  playerSide: 'T',
  difficulty: 5,
  playerName: 'YOU',
}

export function loadMatchConfig(): MatchConfig {
  let stored: Partial<MatchConfig> = {}
  try {
    const raw = localStorage.getItem('sp_match')
    if (raw) stored = JSON.parse(raw) as Partial<MatchConfig>
  } catch {
    stored = {}
  }
  const cfg: MatchConfig = { ...DEFAULT_MATCH, ...stored }
  // #44 URL ?seed=12345 预填种子（优先级高于存档）
  const sp = new URLSearchParams(window.location.search).get('seed')
  if (sp !== null) {
    const n = Number(sp)
    if (Number.isFinite(n)) cfg.seed = Math.floor(n) & 0xffff
  }
  return cfg
}

export function saveMatchConfig(c: MatchConfig): void {
  try {
    localStorage.setItem('sp_match', JSON.stringify(c))
  } catch {
    // 静默
  }
}
