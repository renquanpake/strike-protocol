/**
 * #1 主菜单 + #7 设置面板 + #2 暂停 + #4 结算屏。
 * DOM 自建（注入 <style>），main.ts 通过回调驱动（startMatch / onExit / onResume）。
 * V5 美术化：地图/模式/阵营改卡片选择，设置改自定义下拉+开关（无原生控件），全局 Rajdhani 字体。
 */
import type { MatchConfig } from './settings'
import { loadSettings, saveSettings, loadMatchConfig, saveMatchConfig, DEFAULT_SETTINGS, type Settings } from './settings'
import { AVAILABLE_MAPS, type MapId } from '../game/map/match'
import { loadCareer } from '../game/career'
import { setLanguage } from './strings'
import type { GameState } from '../game/state'

/** 卡片色板（V6 地图辨识度：de_sahara 沙、de_plaza 地中海、training 训练） */
const MAP_CARD: Record<string, { bg: string; tag: string }> = {
  de_sahara: { bg: 'linear-gradient(135deg,#c9a86a,#8a5a30)', tag: '沙漠' },
  de_plaza: { bg: 'linear-gradient(135deg,#dfe6ea,#7d8a97)', tag: '地中海' },
  de_costa: { bg: 'linear-gradient(135deg,#9fc4dd,#4a7a9e)', tag: '海滨' },
  training: { bg: 'linear-gradient(135deg,#4a5d3a,#2c3a24)', tag: '训练场' },
}
const MODE_CARD: Record<string, { bg: string; tag: string }> = {
  de: { bg: 'linear-gradient(135deg,#3a4a6a,#1c2438)', tag: '爆破' },
  dm: { bg: 'linear-gradient(135deg,#6a3a3a,#381c1c)', tag: '死斗' },
  tdm: { bg: 'linear-gradient(135deg,#4a6a5a,#1c382c)', tag: '团队死斗' },
}
const SIDE_CARD: Record<string, { bg: string; tag: string }> = {
  T: { bg: 'linear-gradient(135deg,#b58a5a,#5a3a1c)', tag: '进攻' },
  CT: { bg: 'linear-gradient(135deg,#5a7fb5,#1c3a5a)', tag: '防守' },
}

const CSS = `
.sp-overlay{position:fixed;inset:0;background:rgba(4,7,10,.92);z-index:50;display:flex;align-items:center;justify-content:center;color:#dfe8f0;font-family:'Rajdhani','Saira','Courier New',monospace;pointer-events:auto}
.sp-panel{background:rgba(10,14,18,.97);border:1px solid rgba(140,200,255,.4);border-radius:6px;padding:26px 30px;max-width:980px;width:94%;max-height:90vh;overflow-y:auto}
.sp-title{font-size:28px;letter-spacing:.18em;color:#ffd257;margin:0 0 4px;font-weight:700}
.sp-sub{font-size:12px;color:rgba(223,232,240,.55);margin:0 0 18px;letter-spacing:.05em}
.sp-cols{display:flex;gap:26px;flex-wrap:wrap}
.sp-col{flex:1;min-width:280px}
.sp-sec{color:#7fb0ff;font-size:11px;letter-spacing:.12em;border-bottom:1px solid rgba(140,200,255,.25);padding-bottom:4px;margin:16px 0 8px}
.sp-row{display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:6px 2px;gap:10px}
.sp-row label{opacity:.9;flex-shrink:0;font-weight:500}
.sp-btn{display:inline-block;margin:6px 8px 0 0;background:rgba(140,200,255,.14);border:1px solid rgba(140,200,255,.5);color:#dfe8f0;border-radius:4px;padding:9px 20px;font-size:14px;letter-spacing:.06em;cursor:pointer;font-family:inherit;font-weight:600}
.sp-btn:hover{background:rgba(140,200,255,.3)}
.sp-btn.primary{background:rgba(255,210,87,.16);border-color:rgba(255,210,87,.6);color:#ffd257}
.sp-btn.danger{background:rgba(208,52,44,.16);border-color:rgba(208,52,44,.55);color:#ff9d94}
.sp-tabs{display:flex;gap:8px;margin-bottom:6px}
.sp-tab{padding:6px 16px;font-size:14px;border-radius:4px;cursor:pointer;color:rgba(223,232,240,.6);border:1px solid transparent;font-weight:600}
.sp-tab.active{color:#ffd257;border-color:rgba(255,210,87,.4);background:rgba(255,210,87,.08)}
.sp-result{font-size:22px;color:#ffd257;letter-spacing:.1em;margin:0 0 10px;text-align:center;font-weight:700}
.sp-stats{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}
.sp-stats td,.sp-stats th{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:center}
.sp-stats th{color:#7fb0ff;font-size:11px;letter-spacing:.08em}
.sp-stats tr.mine td{background:rgba(255,210,87,.1);color:#ffd257}
.sp-ot{color:#ff9d5c;font-size:12px;text-align:center;margin:4px 0}
.sp-hidden{display:none!important}
/* V5 卡片选择组 */
.sp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0}
.sp-cards.c2{grid-template-columns:repeat(2,1fr)}
.sp-card{position:relative;background:rgba(140,200,255,.06);border:1px solid rgba(140,200,255,.28);border-radius:6px;padding:10px 8px;cursor:pointer;text-align:center;overflow:hidden;transition:transform .08s}
.sp-card:hover{background:rgba(140,200,255,.14)}
.sp-card.on{border-color:#ffd257;background:rgba(255,210,87,.1);box-shadow:0 0 0 1px rgba(255,210,87,.4)}
.sp-card .cc-bg{position:absolute;inset:0;opacity:.28}
.sp-card .cc-txt{position:relative;font-size:14px;font-weight:600;letter-spacing:.03em}
.sp-card .cc-tag{position:relative;font-size:10px;color:rgba(223,232,240,.6);margin-top:2px;letter-spacing:.1em}
/* V5 自定义下拉 */
.sp-dd{position:relative;min-width:150px}
.sp-dd-btn{width:100%;background:#0a0e12;border:1px solid rgba(140,200,255,.35);color:#dfe8f0;border-radius:4px;padding:6px 10px;font-size:13px;text-align:left;cursor:pointer;font-family:inherit;display:flex;justify-content:space-between;align-items:center;gap:8px}
.sp-dd-btn::after{content:'▾';opacity:.6}
.sp-dd.open .sp-dd-btn{border-color:rgba(255,210,87,.6)}
.sp-dd-menu{display:none;position:absolute;top:100%;left:0;right:0;background:#0d1117;border:1px solid rgba(140,200,255,.4);border-radius:4px;margin-top:2px;z-index:5;max-height:220px;overflow-y:auto}
.sp-dd.open .sp-dd-menu{display:block}
.sp-dd-item{padding:6px 10px;font-size:13px;cursor:pointer}
.sp-dd-item:hover{background:rgba(140,200,255,.18)}
.sp-dd-item.on{color:#ffd257}
/* V5 开关 */
.sp-toggle{position:relative;width:40px;height:20px;background:rgba(140,200,255,.15);border:1px solid rgba(140,200,255,.4);border-radius:10px;cursor:pointer;flex-shrink:0}
.sp-toggle::after{content:'';position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;background:#8fa8c0;transition:left .12s}
.sp-toggle.on{background:rgba(255,210,87,.2);border-color:rgba(255,210,87,.6)}
.sp-toggle.on::after{left:21px;background:#ffd257}
/* V5 滑块 */
input[type=range].sp-range{width:150px;-webkit-appearance:none;appearance:none;height:4px;background:rgba(140,200,255,.25);border-radius:2px;outline:none}
input[type=range].sp-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#ffd257;cursor:pointer;border:2px solid #0a0e12}
input[type=range].sp-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#ffd257;cursor:pointer;border:2px solid #0a0e12}
/* V5 文本框 */
.sp-text{background:#0a0e12;border:1px solid rgba(140,200,255,.35);color:#dfe8f0;border-radius:3px;padding:5px 8px;font-size:13px;font-family:inherit;max-width:170px}
`

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

/** V5 卡片组：点击选中，返回 { el, value() } */
function cardGroup(
  host: HTMLElement,
  items: { key: string; text: string; tag?: string; bg?: string }[],
  current: string,
  onPick: (key: string) => void,
  twoCol = false,
): { el: HTMLElement; value: () => string } {
  const wrap = document.createElement('div')
  wrap.className = 'sp-cards' + (twoCol ? ' c2' : '')
  let sel = current
  const cards: HTMLElement[] = []
  for (const it of items) {
    const c = document.createElement('div')
    c.className = 'sp-card'
    if (it.bg) {
      const bg = document.createElement('div')
      bg.className = 'cc-bg'
      bg.style.background = it.bg
      c.appendChild(bg)
    }
    const tx = document.createElement('div')
    tx.className = 'cc-txt'
    tx.textContent = it.text
    c.appendChild(tx)
    if (it.tag) {
      const tg = document.createElement('div')
      tg.className = 'cc-tag'
      tg.textContent = it.tag
      c.appendChild(tg)
    }
    const refresh = (): void => {
      c.classList.toggle('on', sel === it.key)
    }
    c.addEventListener('click', () => {
      sel = it.key
      cards.forEach((x) => x.classList.remove('on'))
      refresh()
      onPick(it.key)
    })
    refresh()
    cards.push(c)
    wrap.appendChild(c)
  }
  host.appendChild(wrap)
  return { el: wrap, value: () => sel }
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
      onInputMode?(mode: Settings['inputMode']): void
    },
  ) {
    injectStyle()
    this.root = container
    this.settingsForms = loadSettings()
    this.matchCfg = loadMatchConfig()
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
    const careerTab = this.mkEl('div', 'sp-tab', '生涯')
    tabs.appendChild(matchTab)
    tabs.appendChild(setTab)
    tabs.appendChild(careerTab)
    panel.appendChild(tabs)

    const cols = this.mkEl('div', 'sp-cols')
    panel.appendChild(cols)

    const careerCol = this.mkEl('div', 'sp-col')
    cols.appendChild(careerCol)
    careerCol.style.display = 'none'
    this.fillCareer(careerCol)

    const showMatch = (): void => {
      matchTab.classList.add('active')
      setTab.classList.remove('active')
      careerTab.classList.remove('active')
      matchCol.style.display = ''
      setCol.style.display = 'none'
      careerCol.style.display = 'none'
    }
    const showSettings = (): void => {
      setTab.classList.add('active')
      matchTab.classList.remove('active')
      careerTab.classList.remove('active')
      setCol.style.display = ''
      matchCol.style.display = 'none'
      careerCol.style.display = 'none'
    }
    const showCareer = (): void => {
      careerTab.classList.add('active')
      matchTab.classList.remove('active')
      setTab.classList.remove('active')
      careerCol.style.display = ''
      matchCol.style.display = 'none'
      setCol.style.display = 'none'
      this.fillCareer(careerCol)
    }
    matchTab.addEventListener('click', showMatch)
    setTab.addEventListener('click', showSettings)
    careerTab.addEventListener('click', showCareer)

    // ===== 对局列（V5 卡片化） =====
    const matchCol = this.mkEl('div', 'sp-col')
    cols.appendChild(matchCol)
    matchCol.appendChild(this.mkEl('div', 'sp-sec', '地图'))
    const mapGroup = cardGroup(
      matchCol,
      AVAILABLE_MAPS.map((m) => ({ key: m.id, text: m.id.replace('de_', ''), tag: MAP_CARD[m.id]?.tag ?? m.label, bg: MAP_CARD[m.id]?.bg })),
      this.matchCfg.mapId,
      (k) => (this.matchCfg.mapId = k),
    )

    matchCol.appendChild(this.mkEl('div', 'sp-sec', '模式'))
    cardGroup(
      matchCol,
      [
        { key: 'de', text: '爆破', tag: '炸弹 · 攻守', bg: MODE_CARD.de.bg },
        { key: 'dm', text: '死斗', tag: '个人目标', bg: MODE_CARD.dm.bg },
        { key: 'tdm', text: '团队死斗', tag: '队伍目标', bg: MODE_CARD.tdm.bg },
      ],
      this.matchCfg.mode,
      (k) => (this.matchCfg.mode = k as MatchConfig['mode']),
    )

    matchCol.appendChild(this.mkEl('div', 'sp-sec', '阵营'))
    cardGroup(
      matchCol,
      [
        { key: 'T', text: 'T · 进攻', tag: '恐怖分子', bg: SIDE_CARD.T.bg },
        { key: 'CT', text: 'CT · 防守', tag: '反恐精英', bg: SIDE_CARD.CT.bg },
      ],
      this.matchCfg.playerSide,
      (k) => (      this.matchCfg.playerSide = k as 'T' | 'CT'),
      true,
    )

    matchCol.appendChild(this.mkEl('div', 'sp-sec', '参数'))
    matchCol.appendChild(this.mkRange('Bot 难度', 1, 10, 1, this.matchCfg.difficulty, (v) => (this.matchCfg.difficulty = v)))
    matchCol.appendChild(this.mkRange('Bot 总数', 1, 19, 2, this.matchCfg.botCount, (v) => (this.matchCfg.botCount = v)))
    matchCol.appendChild(this.mkText('玩家名', this.matchCfg.playerName, (v) => (this.matchCfg.playerName = v)))
    matchCol.appendChild(
      this.mkText('种子（可选）', String(this.matchCfg.seed ?? ''), (v) => {
        const n = parseInt(v, 10)
        this.matchCfg.seed = Number.isFinite(n) && v.trim() !== '' ? n : undefined
      }),
    )

    const startBtn = this.mkEl('button', 'sp-btn primary', '开 始 对 局')
    startBtn.addEventListener('click', () => {
      this.matchCfg.mapId = mapGroup.value() as MapId
      saveMatchConfig(this.matchCfg)
      this.cb.onStart(this.matchCfg)
    })
    matchCol.appendChild(startBtn)

    // ===== 设置列（V5 自定义控件） =====
    const setCol = this.mkEl('div', 'sp-col')
    cols.appendChild(setCol)
    const s = this.settingsForms
    setCol.appendChild(this.mkEl('div', 'sp-sec', '画面'))
    setCol.appendChild(this.mkRange('视场角 FOV', 60, 110, 1, s.fov, (v) => (s.fov = v)))
    const qualSel = this.mkDropdown('画质', ['低', '中', '高'], QUAL_LABELS.indexOf(s.quality), (i) => (s.quality = QUAL_LABELS[i]))
    const resoSel = this.mkDropdown('渲染分辨率', ['1x', '1.5x', '2x'], [1, 1.5, 2].indexOf(s.resolution), (i) => (s.resolution = [1, 1.5, 2][i] as 1 | 1.5 | 2))
    setCol.appendChild(qualSel)
    setCol.appendChild(resoSel)
    setCol.appendChild(this.mkToggle('屏幕震动', s.screenShake, (v) => (s.screenShake = v)))
    setCol.appendChild(this.mkToggle('显示小地图', s.showMinimap, (v) => {
      s.showMinimap = v
      saveSettings(s)
      this.applySettings()
    }))
    setCol.appendChild(this.mkToggle('调试面板', s.showDebug, (v) => (s.showDebug = v)))

    setCol.appendChild(this.mkEl('div', 'sp-sec', '操作'))
    setCol.appendChild(this.mkRange('鼠标灵敏度', 0.2, 3, 0.05, s.mouseSens, (v) => (s.mouseSens = v)))
    setCol.appendChild(this.mkRange('触摸视角灵敏度', 0.2, 3, 0.05, s.touchSens, (v) => (s.touchSens = v)))
    setCol.appendChild(this.mkToggle('开镜灵敏度分离', s.aimSensSplit, (v) => (s.aimSensSplit = v)))
    setCol.appendChild(this.mkRange('开镜灵敏度', 0.2, 1.5, 0.05, s.aimSens, (v) => (s.aimSens = v)))
    // B-R1.3 触控布局预设（右手 = 默认，左手 = 水平镜像；长按可自定义）
    setCol.appendChild(
      this.mkDropdown(
        '触控布局',
        ['右手布局', '左手布局'],
        s.touchPreset === 'left' ? 1 : 0,
        (i) => (s.touchPreset = i === 1 ? 'left' : 'right'),
      ),
    )
    // B-R3 操作方式：自动检测（默认）/ 触屏 / 键鼠
    const modeSel = this.mkDropdown(
      '操作方式',
      ['自动检测', '触屏', '键鼠'],
      s.inputMode === 'touch' ? 1 : s.inputMode === 'mouse' ? 2 : 0,
      (i) => (s.inputMode = i === 1 ? 'touch' : i === 2 ? 'mouse' : 'auto'),
    )
    setCol.appendChild(modeSel)

    setCol.appendChild(this.mkEl('div', 'sp-sec', '音频'))
    setCol.appendChild(this.mkRange('音量', 0, 1, 0.05, s.volume, (v) => (s.volume = v)))

    setCol.appendChild(this.mkEl('div', 'sp-sec', '准星'))
    const chStyle = this.mkDropdown('样式', ['十字', '圆点', '圆圈'], CROSSHAIR_STYLES.indexOf(s.crosshair.style), (i) => (s.crosshair.style = CROSSHAIR_STYLES[i]))
    setCol.appendChild(chStyle)
    const chColor = document.createElement('input')
    chColor.type = 'color'
    chColor.value = s.crosshair.color
    const chColorRow = this.mkEl('div', 'sp-row')
    chColorRow.appendChild(this.mkEl('label', '', '颜色'))
    chColorRow.appendChild(chColor)
    setCol.appendChild(chColorRow)
    setCol.appendChild(this.mkRange('间距', 0.5, 3, 0.1, s.crosshair.gapScale, (v) => (s.crosshair.gapScale = v)))

    // #42 改键
    setCol.appendChild(this.mkEl('div', 'sp-sec', '键位（点击改键）'))
    const BIND_ACTIONS: [string, string][] = [
      ['forward', '前进'],
      ['back', '后退'],
      ['left', '左移'],
      ['right', '右移'],
      ['jump', '跳跃'],
      ['crouch', '蹲伏'],
      ['walk', '静走'],
      ['reload', '换弹'],
      ['buy', '买枪'],
      ['drop', '丢弃'],
      ['use', '交互'],
      ['scoreboard', '记分板'],
    ]
    for (const [action, label] of BIND_ACTIONS) {
      const row = this.mkEl('div', 'sp-row')
      const lab = this.mkEl('label', '', label)
      const keyVal = this.mkEl('span', '', s.binds[action] ?? DEFAULT_SETTINGS.binds[action] ?? '-')
      keyVal.style.opacity = '0.7'
      keyVal.style.fontSize = '12px'
      const btn = this.mkEl('button', 'sp-btn', '改')
      btn.style.padding = '2px 8px'
      btn.style.fontSize = '11px'
      btn.addEventListener('click', () => {
        keyVal.textContent = '按任意键…'
        const handler = (ev: KeyboardEvent): void => {
          ev.preventDefault()
          const code = ev.code === 'Escape' ? DEFAULT_SETTINGS.binds[action] ?? ev.code : ev.code
          s.binds[action] = code
          keyVal.textContent = code
          window.removeEventListener('keydown', handler, true)
        }
        window.addEventListener('keydown', handler, true)
      })
      row.appendChild(lab)
      row.appendChild(keyVal)
      row.appendChild(btn)
      setCol.appendChild(row)
    }

    setCol.appendChild(this.mkEl('div', 'sp-sec', '其他'))
    const langSel = this.mkDropdown('语言', ['中文', 'English'], s.language === 'zh' ? 0 : 1, (i) => (s.language = i === 0 ? 'zh' : 'en'))
    const teamSel = this.mkDropdown('阵营色', ['默认', '色盲友好'], s.teamColors === 'default' ? 0 : 1, (i) => (s.teamColors = i === 0 ? 'default' : 'deuteranopia'))
    setCol.appendChild(langSel)
    setCol.appendChild(teamSel)

    const applyBtn = this.mkEl('button', 'sp-btn', '保 存 设 置')
    applyBtn.addEventListener('click', () => {
      setLanguage(s.language)
      saveSettings(s)
      this.applySettings()
    })
    setCol.appendChild(applyBtn)

    setCol.style.display = 'none'
    this.root.appendChild(ov)
  }

  private applySettings(): void {
    ;(this.root as HTMLElement & { __onSettingsApplied?: (s: Settings) => void }).__onSettingsApplied?.(this.settingsForms)
  }

  private fillCareer(col: HTMLElement): void {
    col.innerHTML = ''
    col.appendChild(this.mkEl('div', 'sp-sec', '生涯'))
    const career = loadCareer()
    const t = career.totals
    const winRate = t.games > 0 ? Math.round((t.wins / t.games) * 100) : 0
    const kd = t.deaths > 0 ? (t.kills / t.deaths).toFixed(2) : String(t.kills)
    const hsRate = t.kills > 0 ? Math.round((t.hs / t.kills) * 100) : 0
    const summary = this.mkEl('div', 'sp-row', `总场次 ${t.games} · 胜率 ${winRate}% · K/D ${kd} · 爆头率 ${hsRate}%`)
    summary.style.fontSize = '12px'
    summary.style.opacity = '0.8'
    col.appendChild(summary)
    col.appendChild(this.mkEl('div', 'sp-sec', '最近对局'))
    const recent = career.matches.slice(-10).reverse()
    if (recent.length === 0) {
      col.appendChild(this.mkEl('div', 'sp-row', '暂无记录'))
      return
    }
    for (const m of recent) {
      const label = m.result === 'win' ? '胜' : m.result === 'loss' ? '负' : '平'
      const row = this.mkEl('div', 'sp-row', `${label} ${m.score[0]}:${m.score[1]} · ${m.mapId} · K${m.k}/D${m.d}`)
      col.appendChild(row)
    }
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
    // B-R2.3 暂停菜单快捷灵敏度滑条（实时生效，免回主菜单）
    const s = this.settingsForms
    const qsec = this.mkEl('div', 'sp-sec', '灵敏度')
    qsec.appendChild(this.mkRange('鼠标灵敏度', 0.2, 3, 0.05, s.mouseSens, (v) => {
      s.mouseSens = v
      this.applySettings()
    }))
    qsec.appendChild(this.mkRange('触摸视角灵敏度', 0.2, 3, 0.05, s.touchSens, (v) => {
      s.touchSens = v
      this.applySettings()
    }))
    panel.appendChild(qsec)
    // 暂停菜单快捷小地图开关（M 键等效；触屏用户免进设置面板）
    const mmRow = this.mkEl('div', '', '小地图')
    const mmBtn = this.mkEl('button', 'sp-btn', s.showMinimap ? '开' : '关')
    mmBtn.addEventListener('click', () => {
      s.showMinimap = !s.showMinimap
      saveSettings(s)
      this.applySettings()
      mmBtn.textContent = s.showMinimap ? '开' : '关'
    })
    mmRow.appendChild(mmBtn)
    panel.appendChild(mmRow)
    // B-R3.3 暂停菜单切换操作方式（即时重建输入层）
    const imRow = this.mkEl('div', '', '操作方式')
    const modes: { label: string; m: Settings['inputMode'] }[] = [
      { label: '自动', m: 'auto' },
      { label: '触屏', m: 'touch' },
      { label: '键鼠', m: 'mouse' },
    ]
    for (const it of modes) {
      const b = this.mkEl('button', 'sp-btn', it.label)
      if (s.inputMode === it.m) b.classList.add('primary')
      b.addEventListener('click', () => {
        s.inputMode = it.m
        this.cb.onInputMode?.(it.m)
        for (const x of imRow.querySelectorAll('button')) x.classList.remove('primary')
        b.classList.add('primary')
      })
      imRow.appendChild(b)
    }
    panel.appendChild(imRow)
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

  /** V5 自定义下拉（替代原生 select） */
  private mkDropdown(label: string, opts: string[], current: number, onPick: (idx: number) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const dd = document.createElement('div')
    dd.className = 'sp-dd'
    const btn = document.createElement('div')
    btn.className = 'sp-dd-btn'
    const val = document.createElement('span')
    val.textContent = opts[Math.max(0, current)]
    btn.appendChild(val)
    const menu = document.createElement('div')
    menu.className = 'sp-dd-menu'
    let sel = current
    opts.forEach((o, i) => {
      const item = document.createElement('div')
      item.className = 'sp-dd-item' + (i === sel ? ' on' : '')
      item.textContent = o
      item.addEventListener('click', () => {
        sel = i
        menu.querySelectorAll('.sp-dd-item').forEach((x, j) => x.classList.toggle('on', j === i))
        val.textContent = opts[i]
        dd.classList.remove('open')
        onPick(i)
      })
      menu.appendChild(item)
    })
    btn.addEventListener('click', () => dd.classList.toggle('open'))
    dd.appendChild(btn)
    dd.appendChild(menu)
    row.appendChild(dd)
    return row
  }

  /** V5 开关（替代原生 checkbox） */
  private mkToggle(label: string, checked: boolean, onInput: (v: boolean) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const tg = document.createElement('div')
    tg.className = 'sp-toggle' + (checked ? ' on' : '')
    let on = checked
    tg.addEventListener('click', () => {
      on = !on
      tg.classList.toggle('on', on)
      onInput(on)
    })
    row.appendChild(tg)
    return row
  }

  private mkRange(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLElement {
    const row = this.mkEl('div', 'sp-row')
    row.appendChild(this.mkEl('label', '', label))
    const inp = document.createElement('input')
    inp.type = 'range'
    inp.className = 'sp-range'
    inp.min = String(min)
    inp.max = String(max)
    inp.step = String(step)
    inp.value = String(value)
    const valEl = this.mkEl('span', '', String(value))
    valEl.style.opacity = '0.6'
    valEl.style.fontSize = '12px'
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
    inp.className = 'sp-text'
    inp.value = value
    inp.addEventListener('input', () => onInput(inp.value))
    row.appendChild(inp)
    return row
  }
}

const QUAL_LABELS: Settings['quality'][] = ['low', 'medium', 'high']
const CROSSHAIR_STYLES: Settings['crosshair']['style'][] = ['cross', 'dot', 'circle']

/** 读取本局配置（供 main.ts 组装 MatchOptions） */
export function matchOptionsFromCfg(cfg: MatchConfig) {
  return {
    botCount: cfg.botCount,
    playerSide: cfg.playerSide,
    playerName: cfg.playerName,
    rngSeed: cfg.seed,
    difficulty: cfg.difficulty,
    mode: cfg.mode,
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
