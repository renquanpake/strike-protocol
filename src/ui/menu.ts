/**
 * #1 主菜单 + #7 设置面板 + #2 暂停 + #4 结算屏。
 * DOM 自建（注入 <style>），main.ts 通过回调驱动（startMatch / onExit / onResume）。
 */
import type { MatchConfig } from './settings'
import { loadSettings, saveSettings, loadMatchConfig, saveMatchConfig, DEFAULT_SETTINGS, type Settings } from './settings'
import { AVAILABLE_MAPS, type MapId } from '../game/map/match'
import type { GameState } from '../game/state'

const CSS = `
.sp-overlay{position:fixed;inset:0;background:rgba(4,7,10,.92);z-index:50;display:flex;align-items:center;justify-content:center;color:#dfe8f0;font-family:'Courier New',monospace;pointer-events:auto}
.sp-panel{background:rgba(10,14,18,.97);border:1px solid rgba(140,200,255,.4);border-radius:6px;padding:26px 30px;max-width:920px;width:94%;max-height:90vh;overflow-y:auto}
.sp-title{font-size:26px;letter-spacing:.18em;color:#ffd257;margin:0 0 4px}
.sp-sub{font-size:12px;color:rgba(223,232,240,.55);margin:0 0 18px}
.sp-cols{display:flex;gap:26px;flex-wrap:wrap}
.sp-col{flex:1;min-width:270px}
.sp-sec{color:#7fb0ff;font-size:11px;letter-spacing:.12em;border-bottom:1px solid rgba(140,200,255,.25);padding-bottom:4px;margin:14px 0 8px}
.sp-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:5px 2px;gap:10px}
.sp-row label{opacity:.85;flex-shrink:0}
.sp-row select,.sp-row input[type=text]{background:#0a0e12;border:1px solid rgba(140,200,255,.35);color:#dfe8f0;border-radius:3px;padding:4px 8px;font-size:13px;font-family:inherit;max-width:180px}
.sp-row input[type=range]{width:140px}
.sp-btn{display:inline-block;margin:6px 8px 0 0;background:rgba(140,200,255,.14);border:1px solid rgba(140,200,255,.5);color:#dfe8f0;border-radius:4px;padding:9px 20px;font-size:14px;letter-spacing:.06em;cursor:pointer;font-family:inherit}
.sp-btn:hover{background:rgba(140,200,255,.3)}
.sp-btn.primary{background:rgba(255,210,87,.16);border-color:rgba(255,210,87,.6);color:#ffd257}
.sp-btn.danger{background:rgba(208,52,44,.16);border-color:rgba(208,52,44,.55);color:#ff9d94}
.sp-tabs{display:flex;gap:8px;margin-bottom:6px}
.sp-tab{padding:6px 16px;font-size:13px;border-radius:4px;cursor:pointer;color:rgba(223,232,240,.6);border:1px solid transparent}
.sp-tab.active{color:#ffd257;border-color:rgba(255,210,87,.4);background:rgba(255,210,87,.08)}
.sp-result{font-size:20px;color:#ffd257;letter-spacing:.1em;margin:0 0 10px;text-align:center}
.sp-stats{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
.sp-stats td,.sp-stats th{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:center}
.sp-stats th{color:#7fb0ff;font-size:11px;letter-spacing:.08em}
.sp-stats tr.mine td{background:rgba(255,210,87,.1);color:#ffd257}
.sp-ot{color:#ff9d5c;font-size:12px;text-align:center;margin:4px 0}
.sp-hidden{display:none!important}
`;

function injectStyle(): void {
  if (document.getElementById('sp-menu-style')) return
  const el = document.createElement('style')
  el.id = 'sp-menu-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

export interface MatchEndStats {
  winner: 'T' | 'CT'
  score: { T: number; CT: number }
  overtime: number
  seed: number
  rows: { name: string; team: string; kills: number; deaths: number; dmg: number; hs: number; mine: boolean }[]
}

export class MenuUI {
  private root: HTMLElement
  private matchCfg: MatchConfig
  private menuEl: HTMLElement | null = null
  private pauseEl: HTMLElement | null = null
  private endEl: HTMLElement | null = null
  private settingsForms: Settings = { ...DEFAULT_SETTINGS }

  constructor(
    container: HTMLElement,
    private cb: {
      onStart(cfg: MatchConfig): void
      onExit(): void
      onResume(): void
    },
  ) {
    injectStyle()
    this.root = container
    this.settingsForms = loadSettings()
    this.matchCfg = loadMatchConfig()
    // 初始显示主菜单
    this.showMenu()
  }

  /** 主菜单（#1 对局设置 + #7 设置 tab） */
  showMenu(): void {
    this.removeOverlay()
    const ov = this.mkOverlay()
    this.menuEl = ov
    const panel = this.mkEl('div', 'sp-panel')
    ov.appendChild(panel)
    panel.appendChild(this.mkEl('h1', 'sp-title', 'STRIKE PROTOCOL'))
    panel.appendChild(this.mkEl('p', 'sp-sub', '浏览器 FPS · 5v5 爆破 · 单机 Bot'))

    const tabs = this.mkEl('div', 'sp-tabs')
    const matchTab = this.mkEl('div', 'sp-tab active', '对局')
    const setTab = this.mkEl('div', 'sp-tab', '设置')
    tabs.appendChild(matchTab)
    tabs.appendChild(setTab)
    panel.appendChild(tabs)

    const cols = this.mkEl('div', 'sp-cols')
    panel.appendChild(cols)

    // ===== 对局列 =====
    const matchCol = this.mkEl('div', 'sp-col')
    cols.appendChild(matchCol)
    matchCol.appendChild(this.mkEl('div', 'sp-sec', '匹配'))

    const mapSel = this.mkSelect('地图', AVAILABLE_MAPS.map((m) => m.label), this.matchCfg.mapId)
    matchCol.appendChild(mapSel)

    const modeSel = this.mkSelect('模式', ['爆破', '死斗', '团队死斗'], modeLabel(this.matchCfg.mode))
    matchCol.appendChild(modeSel)

    const sideSel = this.mkSelect('阵营', ['T（进攻）', 'CT（防守）'], this.matchCfg.playerSide === 'T' ? 0 : 1)
    matchCol.appendChild(sideSel)

    matchCol.appendChild(
      this.mkRange('Bot 难度', 1, 10, 1, this.matchCfg.difficulty, (v) => (this.matchCfg.difficulty = v)),
    )
    matchCol.appendChild(
      this.mkRange('Bot 总数', 1, 19, 2, this.matchCfg.botCount, (v) => (this.matchCfg.botCount = v)),
    )

    const nameInp = this.mkText('玩家名', this.matchCfg.playerName, (v) => (this.matchCfg.playerName = v))
    matchCol.appendChild(nameInp)

    const seedInp = this.mkText('种子（可选）', String(this.matchCfg.seed ?? ''), (v) => {
      const n = parseInt(v, 10)
      this.matchCfg.seed = Number.isFinite(n) && v.trim() !== '' ? n : undefined
    })
    matchCol.appendChild(seedInp)

    const startBtn = this.mkEl('button', 'sp-btn primary', '开 始 对 局')
    startBtn.addEventListener('click', () => {
      this.matchCfg.mapId = (AVAILABLE_MAPS[Number(mapSel.value)].id) as MapId
      this.matchCfg.mode = modeId(modeSel.value)
      this.matchCfg.playerSide = Number(sideSel.value) === 0 ? 'T' : 'CT'
      saveMatchConfig(this.matchCfg)
      this.cb.onStart(this.matchCfg)
    })
    matchCol.appendChild(startBtn)

    // ===== 设置列（#7） =====
    const setCol = this.mkEl('div', 'sp-col')
    cols.appendChild(setCol)
    const s = this.settingsForms
    setCol.appendChild(this.mkEl('div', 'sp-sec', '画面'))
    setCol.appendChild(this.mkRange('视场角 FOV', 60, 110, 1, s.fov, (v) => (s.fov = v)))
    const qualSel = this.mkSelect('画质', ['低', '中', '高'], s.quality)
    setCol.appendChild(qualSel)
    const resoSel = this.mkSelect('渲染分辨率', ['1x', '1.5x', '2x'], String(s.resolution))
    setCol.appendChild(resoSel)
    const shakeChk = this.mkChk('屏幕震动', s.screenShake, (v) => (s.screenShake = v))
    setCol.appendChild(shakeChk)
    const mmChk = this.mkChk('显示小地图', s.showMinimap, (v) => (s.showMinimap = v))
    setCol.appendChild(mmChk)

    setCol.appendChild(this.mkEl('div', 'sp-sec', '操作'))
    setCol.appendChild(this.mkRange('鼠标灵敏度', 0.2, 3, 0.05, s.mouseSens, (v) => (s.mouseSens = v)))

    setCol.appendChild(this.mkEl('div', 'sp-sec', '音频'))
    setCol.appendChild(this.mkRange('音量', 0, 1, 0.05, s.volume, (v) => (s.volume = v)))

    setCol.appendChild(this.mkEl('div', 'sp-sec', '准星'))
    const chStyle = this.mkSelect('样式', ['十字', '圆点', '圆圈'], s.crosshair.style)
    setCol.appendChild(chStyle)
    const chColor = document.createElement('input')
    chColor.type = 'color'
    chColor.value = s.crosshair.color
    const chColorRow = this.mkEl('div', 'sp-row')
    chColorRow.appendChild(this.mkEl('label', '', '颜色'))
    chColorRow.appendChild(chColor)
    setCol.appendChild(chColorRow)
    setCol.appendChild(this.mkRange('间距', 0.5, 3, 0.1, s.crosshair.gapScale, (v) => (s.crosshair.gapScale = v)))

    setCol.appendChild(this.mkEl('div', 'sp-sec', '其他'))
    const langSel = this.mkSelect('语言', ['中文', 'English'], s.language === 'zh' ? 0 : 1)
    setCol.appendChild(langSel)
    const teamSel = this.mkSelect('阵营色', ['默认', '色盲友好'], s.teamColors)
    setCol.appendChild(teamSel)

    const applyBtn = this.mkEl('button', 'sp-btn', '保 存 设 置')
    applyBtn.addEventListener('click', () => {
      s.quality = QUAL_LABELS[Number(qualSel.value)]
      s.resolution = Number(resoSel.value) as 1 | 1.5 | 2
      s.crosshair.style = CROSSHAIR_STYLES[Number(chStyle.value)]
      s.crosshair.color = chColor.value
      s.language = Number(langSel.value) === 0 ? 'zh' : 'en'
      s.teamColors = Number(teamSel.value) === 0 ? 'default' : 'deuteranopia'
      saveSettings(s)
      this.applySettings()
    })
    setCol.appendChild(applyBtn)

    matchTab.addEventListener('click', () => {
      matchTab.classList.add('active')
      setTab.classList.remove('active')
      matchCol.style.display = ''
      setCol.style.display = 'none'
    })
    setTab.addEventListener('click', () => {
      setTab.classList.add('active')
      matchTab.classList.remove('active')
      setCol.style.display = ''
      matchCol.style.display = 'none'
    })
    setCol.style.display = 'none'
    this.root.appendChild(ov)
  }

  private applySettings(): void {
    // main.ts 注入的实时生效回调
    ;(this.root as HTMLElement & { __onSettingsApplied?: (s: Settings) => void }).__onSettingsApplied?.(this.settingsForms)
  }

  /** #2 暂停菜单 */
  showPause(): void {
    if (this.pauseEl) return
    const ov = this.mkOverlay()
    this.pauseEl = ov
    const panel = this.mkEl('div', 'sp-panel')
    ov.appendChild(panel)
    panel.appendChild(this.mkEl('h1', 'sp-title', '已暂停'))
    const row = this.mkEl('div', '')
    const resume = this.mkEl('button', 'sp-btn primary', '继 续')
    const toMenu = this.mkEl('button', 'sp-btn', '回主菜单')
    row.appendChild(resume)
    row.appendChild(toMenu)
    panel.appendChild(row)
    resume.addEventListener('click', () => this.cb.onResume())
    toMenu.addEventListener('click', () => this.cb.onExit())
    this.root.appendChild(ov)
  }

  hidePause(): void {
    this.pauseEl?.remove()
    this.pauseEl = null
  }

  /** #4 结算屏 */
  showMatchEnd(stats: MatchEndStats): void {
    this.removeOverlay()
    const ov = this.mkOverlay()
    this.endEl = ov
    const panel = this.mkEl('div', 'sp-panel')
    ov.appendChild(panel)
    panel.appendChild(this.mkEl('div', 'sp-result', `${stats.winner} 胜利  ${stats.score.T} : ${stats.score.CT}`))
    if (stats.overtime > 0) panel.appendChild(this.mkEl('div', 'sp-ot', `加时赛 × ${stats.overtime}`))
    panel.appendChild(this.mkEl('div', 'sp-ot', `种子 ${stats.seed}`))
    const table = document.createElement('table')
    table.className = 'sp-stats'
    const thead = document.createElement('tr')
    for (const h of ['', 'K', 'D', '伤害', '爆头']) {
      const th = document.createElement('th')
      th.textContent = h
      thead.appendChild(th)
    }
    table.appendChild(thead)
    for (const r of stats.rows) {
      const tr = document.createElement('tr')
      if (r.mine) tr.className = 'mine'
      const cells = [r.name, String(r.kills), String(r.deaths), String(Math.round(r.dmg)), String(r.hs)]
      for (const c of cells) {
        const td = document.createElement('td')
        td.textContent = c
        tr.appendChild(td)
      }
      table.appendChild(tr)
    }
    panel.appendChild(table)
    const row = this.mkEl('div', '')
    const rematch = this.mkEl('button', 'sp-btn primary', '再战一局')
    const toMenu = this.mkEl('button', 'sp-btn', '主菜单')
    row.appendChild(rematch)
    row.appendChild(toMenu)
    panel.appendChild(row)
    rematch.addEventListener('click', () => this.cb.onStart(this.matchCfg))
    toMenu.addEventListener('click', () => this.cb.onExit())
    this.root.appendChild(ov)
  }

  /** 匹配结束：移除所有 overlay（进对局） */
  hideAll(): void {
    this.removeOverlay()
  }

  private removeOverlay(): void {
    this.menuEl?.remove()
    this.menuEl = null
    this.pauseEl?.remove()
    this.pauseEl = null
    this.endEl?.remove()
    this.endEl = null
  }

  private mkOverlay(): HTMLElement {
    const ov = document.createElement('div')
    ov.className = 'sp-overlay'
    return ov
  }

  private mkEl(tag: string, cls: string, text?: string): HTMLElement {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (text) el.textContent = text
    return el
  }

  private mkSelect(label: string, opts: string[], current: string | number): HTMLSelectElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const sel = document.createElement('select')
    opts.forEach((o, i) => {
      const opt = document.createElement('option')
      opt.value = String(i)
      opt.textContent = o
      sel.appendChild(opt)
    })
    const idx = typeof current === 'number' ? current : opts.indexOf(current)
    sel.value = String(idx >= 0 ? idx : 0)
    row.appendChild(sel)
    return sel
  }

  private mkRange(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const inp = document.createElement('input')
    inp.type = 'range'
    inp.min = String(min)
    inp.max = String(max)
    inp.step = String(step)
    inp.value = String(value)
    const valEl = this.mkEl('span', '', String(value))
    valEl.style.opacity = '0.6'
    inp.addEventListener('input', () => {
      valEl.textContent = inp.value
      onInput(Number(inp.value))
    })
    row.appendChild(inp)
    row.appendChild(valEl)
    return row
  }

  private mkText(label: string, value: string, onInput: (v: string) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.value = value
    inp.addEventListener('input', () => onInput(inp.value))
    row.appendChild(inp)
    return row
  }

  private mkChk(label: string, checked: boolean, onInput: (v: boolean) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const inp = document.createElement('input')
    inp.type = 'checkbox'
    inp.checked = checked
    inp.addEventListener('input', () => onInput(inp.checked))
    row.appendChild(inp)
    return row
  }
}

const QUAL_LABELS: Settings['quality'][] = ['low', 'medium', 'high']
const CROSSHAIR_STYLES: Settings['crosshair']['style'][] = ['cross', 'dot', 'circle']

function modeLabel(mode: MatchConfig['mode']): number {
  return mode === 'de' ? 0 : mode === 'dm' ? 1 : 2
}
function modeId(idx: string): MatchConfig['mode'] {
  return Number(idx) === 1 ? 'dm' : Number(idx) === 2 ? 'tdm' : 'de'
}

/** 读取本局配置（供 main.ts 组装 MatchOptions） */
export function matchOptionsFromCfg(cfg: MatchConfig) {
  return {
    botCount: cfg.botCount,
    playerSide: cfg.playerSide,
    playerName: cfg.playerName,
    rngSeed: cfg.seed,
    difficulty: cfg.difficulty,
  }
}

/** #4 结算统计：从 GameState 组装 */
export function buildMatchEndStats(state: GameState): MatchEndStats {
  const r = state.round
  const winner = r.lastWinner ?? (r.score.T >= r.score.CT ? 'T' : 'CT')
  return {
    winner,
    score: { T: r.score.T, CT: r.score.CT },
    overtime: r.overtime,
    seed: state.seed,
    rows: state.players.map((p) => ({
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      dmg: p.damageDealt,
      hs: p.headshotKills,
      mine: p.id === 0,
    })),
  }
}
