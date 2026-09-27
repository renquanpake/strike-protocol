/**
 * WebAudio 音频引擎（V2 采样化）：
 * - 真实 CC0 采样（Kenney impact/interface/sci-fi，public/sounds/*.ogg，见 CC0_LICENSE_KENNEY.txt）
 *   覆盖脚步/命中材质/爆头铃/换弹咔哒/爆炸/C4 滴答/无线电提示音。
 * - 枪声：按枪类离线合成的 AudioBuffer（带限噪波 + 低频 thump，闭眼可区分步枪/手枪/狙击/霰弹），
 *   与采样走同一播放管线；穿墙命中加低通闷声（muffled）。
 * - 空间化：3D 声源保留 PannerNode（equalpower / linear，refDistance 120u / maxDistance 2500u），
 *   本地玩家音效直达 master。采样未就绪时回退到程序合成（noiseBurst/tone），保证零素材可运行。
 * - 主音量由设置层注入（setMasterVolume → master.gain，原硬编码 0.7 废除）。
 */

type Ctx = AudioContext

/** 采样清单：逻辑键 → CC0 ogg 文件（public/sounds/） */
const SAMPLE_FILES: Record<string, string[]> = {
  step_sand: ['footstep_grass_000.ogg', 'footstep_grass_001.ogg', 'footstep_grass_002.ogg', 'footstep_grass_003.ogg', 'footstep_grass_004.ogg'],
  step_concrete: ['footstep_concrete_000.ogg', 'footstep_concrete_001.ogg', 'footstep_concrete_002.ogg', 'footstep_concrete_003.ogg', 'footstep_concrete_004.ogg'],
  step_wood: ['footstep_wood_000.ogg', 'footstep_wood_001.ogg', 'footstep_wood_002.ogg', 'footstep_wood_003.ogg', 'footstep_wood_004.ogg'],
  step_sandbag: ['footstep_carpet_000.ogg', 'footstep_carpet_001.ogg', 'footstep_carpet_002.ogg', 'footstep_carpet_003.ogg', 'footstep_carpet_004.ogg'],
  step_metal: ['impactMetal_light_000.ogg'],
  step_ladder: ['impactTin_medium_000.ogg'],
  step_glass: ['impactGlass_light_000.ogg'],
  hit_metal: ['impactMetal_heavy_000.ogg'],
  hit_wood: ['impactWood_medium_000.ogg', 'impactWood_heavy_000.ogg'],
  hit_sand: ['impactGeneric_light_000.ogg'],
  hit_soft: ['impactSoft_medium_000.ogg'],
  hit_head: ['impactBell_heavy_000.ogg', 'impactBell_heavy_001.ogg'],
  glass_break: ['impactGlass_heavy_000.ogg'],
  explosion: ['explosionCrunch_000.ogg', 'explosionCrunch_001.ogg'],
  explosion_sub: ['lowFrequency_explosion_000.ogg'],
  flash: ['laserRetro_000.ogg'],
  c4_beep: ['tick_001.ogg', 'tick_002.ogg'],
  radio_beep: ['confirmation_001.ogg'],
  radio_beep2: ['question_001.ogg'],
  reload_a: ['click_001.ogg'],
  reload_b: ['click_003.ogg'],
  round_win: ['bong_001.ogg'],
}

/** 枪声合成规格（按武器 id）：dur=s 衰减时长，cut=低通截止 Hz，sub=低频 thump Hz，subG=thump 增益 */
interface ShotSpec {
  dur: number
  cut: number
  sub: number
  subG: number
  gain: number
}
const SHOT_SPECS: Record<string, ShotSpec> = {
  glock: { dur: 0.07, cut: 2600, sub: 95, subG: 0.5, gain: 0.85 },
  usp: { dur: 0.07, cut: 2400, sub: 90, subG: 0.5, gain: 0.85 },
  p250: { dur: 0.07, cut: 2600, sub: 100, subG: 0.55, gain: 0.9 },
  tec9: { dur: 0.06, cut: 3000, sub: 110, subG: 0.5, gain: 0.8 },
  fiveSeven: { dur: 0.07, cut: 2800, sub: 100, subG: 0.5, gain: 0.85 },
  deagle: { dur: 0.1, cut: 1800, sub: 62, subG: 0.7, gain: 1.0 },
  mp9: { dur: 0.06, cut: 3200, sub: 120, subG: 0.45, gain: 0.75 },
  p90: { dur: 0.06, cut: 3000, sub: 115, subG: 0.45, gain: 0.75 },
  m4: { dur: 0.12, cut: 1900, sub: 70, subG: 0.6, gain: 0.95 },
  m249: { dur: 0.1, cut: 1700, sub: 65, subG: 0.55, gain: 0.9 },
  ak: { dur: 0.13, cut: 1500, sub: 58, subG: 0.65, gain: 1.0 },
  awp: { dur: 0.26, cut: 900, sub: 45, subG: 0.85, gain: 1.15 },
  ssg08: { dur: 0.2, cut: 1200, sub: 50, subG: 0.7, gain: 1.0 },
  xm1014: { dur: 0.16, cut: 1000, sub: 55, subG: 0.7, gain: 1.05 },
  sawnoff: { dur: 0.14, cut: 1200, sub: 58, subG: 0.65, gain: 0.95 },
  knife: { dur: 0.04, cut: 3500, sub: 0, subG: 0, gain: 0.18 },
}

/** 合成 gunshot AudioBuffer：带限白噪（一阶低通）× 指数包络 + 低频 thump（确定性 mulberry32） */
function buildShotBuffer(ctx: Ctx, spec: ShotSpec): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(64, Math.floor(spec.dur * sr))
  const buf = ctx.createBuffer(1, len, sr)
  const data = buf.getChannelData(0)
  let s = 0x9e3779b9 ^ Math.floor(spec.dur * 1e4)
  const rand = (): number => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const alpha = 1 - Math.exp((-2 * Math.PI * spec.cut) / sr)
  let lp = 0
  const decay = 1 / (len * 0.55)
  for (let i = 0; i < len; i++) {
    const w = (rand() * 2 - 1) * Math.exp(-i * decay * 3)
    lp += alpha * (w - lp)
    let v = lp * 2.6
    if (spec.sub > 0) {
      const ph = (2 * Math.PI * spec.sub * i) / sr
      const sd = Math.exp(-i / ((len * 0.5) / 1))
      v += Math.sin(ph) * spec.subG * sd * 0.55
    }
    data[i] = v * spec.gain
  }
  // 峰值归一，防爆
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0.98 && peak > 1e-6) {
    const k = 0.98 / peak
    for (let i = 0; i < len; i++) data[i] *= k
  }
  return buf
}

/** 合成耳鸣（闪光爆鸣后本地 3.2kHz 短鸣） */
function buildTinnitusBuffer(ctx: Ctx): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(0.6 * sr)
  const buf = ctx.createBuffer(1, len, sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    const t = i / sr
    data[i] = Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 4) * 0.25
  }
  return buf
}

export class AudioEngine {
  private ctx: Ctx | null = null
  private master: GainNode | null = null
  private amb: GainNode | null = null
  private noise: AudioBuffer | null = null
  private started = false
  private initialVolume = 0.7
  private ambientNodes: AudioNode[] = []
  private musicNodes: AudioNode[] = []
  /** CC0 采样 buffer（逻辑键 → 变体组） */
  private samples = new Map<string, AudioBuffer[]>()
  /** 合成枪声 buffer（武器 id） */
  private shotBuffers = new Map<string, AudioBuffer>()
  private tinnitus: AudioBuffer | null = null
  private c4BeepSeq = 0
  private loaded = false

  /** 设置初始主音量（init 前调用，供设置层注入） */
  setInitialVolume(v: number): void {
    this.initialVolume = v
  }

  /** 运行时改主音量（0-1），未 init 时仅暂存（master.gain 由设置层驱动） */
  setMasterVolume(v: number): void {
    this.initialVolume = v
    if (this.master) this.master.gain.value = v
  }

  /** 运行时改环境/音乐音量（0-1） */
  setAmbientVolume(v: number): void {
    if (this.amb) this.amb.gain.value = v
  }

  /** 采样是否就绪（未就绪走合成回退） */
  get samplesReady(): boolean {
    return this.loaded
  }

  /** 需在用户手势中调用以解锁 AudioContext；随后异步加载 CC0 采样 + 合成枪声 buffer */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.initialVolume
    this.master.connect(this.ctx.destination)
    // 预生成噪声缓冲（合成回退 + 环境风声）
    const len = this.ctx.sampleRate * 1
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.started = true
    void this.loadAll()
  }

  /** 加载 CC0 采样（fetch → decodeAudioData），并合成枪声/耳鸣 buffer；失败静默（保持合成回退） */
  private async loadAll(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    // 枪声合成 buffer（与采样管线同源播放）
    for (const [id, spec] of Object.entries(SHOT_SPECS)) {
      this.shotBuffers.set(id, buildShotBuffer(ctx, spec))
    }
    this.tinnitus = buildTinnitusBuffer(ctx)
    const keys = Object.keys(SAMPLE_FILES)
    const results = await Promise.all(
      keys.map(async (k) => {
        const variants: AudioBuffer[] = []
        for (const file of SAMPLE_FILES[k]) {
          try {
            const resp = await fetch(`/sounds/${file}`)
            if (!resp.ok) continue
            const ab = await resp.arrayBuffer()
            variants.push(await ctx.decodeAudioData(ab))
          } catch {
            // 单文件失败跳过（PWA 离线/网络异常时回退合成）
          }
        }
        return [k, variants] as const
      }),
    )
    for (const [k, variants] of results) if (variants.length > 0) this.samples.set(k, variants)
    this.loaded = true
  }

  private pick(key: string): AudioBuffer | null {
    const list = this.samples.get(key)
    if (!list || list.length === 0) return null
    return list[Math.floor(Math.random() * list.length)]
  }

  get ready(): boolean {
    return this.started
  }

  /** 每帧更新监听者位置（本地玩家） */
  setListener(x: number, y: number, z: number): void {
    if (!this.ctx || !this.master) return
    const l = this.ctx.listener as unknown as {
      positionX?: AudioParam
      setPosition?: (x: number, y: number, z: number) => void
    }
    if (l.positionX) {
      l.positionX.value = x
      ;(l as unknown as { positionY: AudioParam }).positionY.value = y
      ;(l as unknown as { positionZ: AudioParam }).positionZ.value = z
    } else if (l.setPosition) {
      l.setPosition(x, y, z)
    }
  }

  private makePanner(x: number, y: number, z: number): PannerNode {
    const p = this.ctx!.createPanner()
    p.panningModel = 'equalpower'
    p.distanceModel = 'linear'
    p.refDistance = 120
    p.maxDistance = 2500
    p.rolloffFactor = 1
    const pos = p as unknown as { positionX?: AudioParam; setPosition?: (a: number, b: number, c: number) => void }
    if (pos.positionX) {
      pos.positionX.value = x
      ;(pos as unknown as { positionY: AudioParam }).positionY.value = y
      ;(pos as unknown as { positionZ: AudioParam }).positionZ.value = z
    } else pos.setPosition?.(x, y, z)
    p.connect(this.master!)
    return p
  }

  /** 播放一个 AudioBuffer（可选 3D 空间化 / 低通闷声 / 延迟 / 随机微变调） */
  private playBuf(
    buf: AudioBuffer,
    opts: { spatial?: boolean; x?: number; y?: number; z?: number; gain?: number; muffled?: boolean; delayMs?: number; rateJitter?: number } = {},
  ): void {
    if (!this.ctx || !this.master || !buf) return
    const ctx = this.ctx
    const t = ctx.currentTime + (opts.delayMs ? opts.delayMs / 1000 : 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    if (opts.rateJitter) src.playbackRate.value = 1 + (Math.random() - 0.5) * opts.rateJitter
    let node: AudioNode = src
    if (opts.muffled) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 480
      node.connect(lp)
      node = lp
    }
    const g = ctx.createGain()
    g.gain.value = (opts.gain ?? 1) * (opts.muffled ? 0.7 : 1)
    node.connect(g)
    if (opts.spatial) {
      const p = this.makePanner(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0)
      g.connect(p)
    } else {
      g.connect(this.master)
    }
    src.start(t)
  }

  /** 播放采样组（未加载回退为静默） */
  private playSample(key: string, opts: { spatial?: boolean; x?: number; y?: number; z?: number; gain?: number; muffled?: boolean; delayMs?: number; rateJitter?: number } = {}): boolean {
    const buf = this.pick(key)
    if (!buf) return false
    this.playBuf(buf, opts)
    return true
  }

  /** #12 低血量心跳（双跳），intensity 0-1 控制音量（机制音效保持合成，无需采样） */
  heartbeat(intensity: number): void {
    if (!this.ctx || !this.master) return
    const g = Math.max(0.05, intensity)
    this.tone(70, 0.12, g, 'sine')
    setTimeout(() => this.tone(60, 0.14, g * 0.8, 'sine'), 180)
  }

  /** #23 无线电提示音（CC0 confirmation 采样；未加载回退双 beep 合成） */
  radioBeep(): void {
    if (!this.ctx || !this.master) return
    if (!this.playSample('radio_beep', { gain: 0.5 })) {
      this.tone(1200, 0.06, 0.12, 'square')
      setTimeout(() => this.tone(900, 0.08, 0.12, 'square'), 80)
    }
  }

  /** #34 环境底噪（风声 + 远雷脉冲），对局 live 启动、菜单停止 */
  startAmbient(): void {
    if (!this.ctx || !this.master || !this.noise || this.ambientNodes.length > 0) return
    const ctx = this.ctx
    const amb = this.ensureAmb()
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 300
    const g = ctx.createGain()
    g.gain.value = 0.05
    src.connect(f)
    f.connect(g)
    g.connect(amb)
    src.start()
    this.ambientNodes = [src, f, g]
  }

  stopAmbient(): void {
    for (const n of this.ambientNodes) {
      const s = n as unknown as { stop?: () => void }
      s.stop?.()
      ;(n as AudioNode).disconnect?.()
    }
    this.ambientNodes = []
  }

  /** #34 主菜单 BGM（程序化 pad 和弦循环） */
  startMenuMusic(): void {
    if (!this.ctx || !this.master || this.musicNodes.length > 0) return
    const ctx = this.ctx
    const amb = this.ensureAmb()
    const freqs = [220, 330, 440]
    const oscs: OscillatorNode[] = []
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.12
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.03
    lfo.connect(lfoGain)
    const base = ctx.createGain()
    base.gain.value = 0.08
    for (const fr of freqs) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = fr
      const og = ctx.createGain()
      og.gain.value = 0.25
      o.connect(og)
      og.connect(base)
      o.start()
      oscs.push(o)
    }
    lfoGain.connect(base.gain)
    base.connect(amb)
    lfo.start()
    this.musicNodes = [lfo, base, ...oscs, lfoGain]
  }

  stopMenuMusic(): void {
    for (const n of this.musicNodes) {
      const s = n as unknown as { stop?: () => void }
      s.stop?.()
      ;(n as AudioNode).disconnect?.()
    }
    this.musicNodes = []
  }

  private ensureAmb(): GainNode {
    if (this.amb) return this.amb
    const amb = this.ctx!.createGain()
    amb.gain.value = 0.6
    amb.connect(this.master!)
    this.amb = amb
    return amb
  }

  private noiseBurst(
    filterFreq: number,
    filterType: BiquadFilterType,
    dur: number,
    gain: number,
    spatial = false,
    x = 0,
    y = 0,
    z = 0,
  ): void {
    if (!this.ctx || !this.master || !this.noise) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = filterType
    f.frequency.value = filterFreq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f)
    f.connect(g)
    if (spatial) {
      const p = this.makePanner(x, y, z)
      g.connect(p)
    } else {
      g.connect(this.master)
    }
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    spatial = false,
    x = 0,
    y = 0,
    z = 0,
  ): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g)
    if (spatial) {
      const p = this.makePanner(x, y, z)
      g.connect(p)
    } else {
      g.connect(this.master)
    }
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /** 枪声：合成枪声 buffer（闭眼可区分枪类）+ PannerNode 空间化；muffled=穿墙闷声；
   *  采样管线未就绪时回退到原程序合成（保持行为不崩） */
  shot(weaponId: string, x: number, y: number, z: number, isLocal: boolean, muffled = false): void {
    const spatial = !isLocal
    const buf = this.shotBuffers.get(weaponId) ?? this.shotBuffers.get('m4') ?? null
    if (buf) {
      this.playBuf(buf, { spatial, x, y, z, muffled, gain: muffled ? 0.9 : 1, rateJitter: 0.06 })
      return
    }
    // 合成回退（保持旧行为：bandpass 噪波 + 低频）
    const p = SHOT_SPECS[weaponId] ?? SHOT_SPECS.m4
    const f = muffled ? 480 : p.cut
    this.noiseBurst(f, muffled ? 'lowpass' : 'bandpass', p.dur, p.gain, spatial, x, y, z)
    if (p.sub > 0) this.tone(p.sub, p.dur * 0.8, p.subG * p.gain, 'sine', spatial, x, y, z)
  }

  /** 脚步（CC0 采样按材质区分；静走由移动层不触发事件实现） */
  footstep(material: string, x: number, y: number, z: number, isLocal: boolean): void {
    const key =
      material === 'concrete'
        ? 'step_concrete'
        : material === 'wood'
          ? 'step_wood'
          : material === 'metal' || material === 'rusted'
            ? 'step_metal'
            : material === 'ladder'
              ? 'step_ladder'
              : material === 'glass'
                ? 'step_glass'
                : material === 'sandbag' || material === 'roof'
                  ? 'step_sandbag'
                  : 'step_sand'
    if (this.playSample(key, { spatial: !isLocal, x, y, z, gain: 0.9, rateJitter: 0.25 })) return
    // 回退：材质化合成（旧 stepParams 行为）
    const params: Record<string, { f: number; g: number; ping: number }> = {
      sand: { f: 400, g: 0.22, ping: 0 },
      concrete: { f: 900, g: 0.3, ping: 0 },
      metal: { f: 1600, g: 0.3, ping: 2400 },
      wood: { f: 600, g: 0.3, ping: 0 },
      ladder: { f: 800, g: 0.2, ping: 0 },
      glass: { f: 2000, g: 0.2, ping: 3000 },
    }
    const p = params[material] ?? params.sand
    this.noiseBurst(p.f, 'bandpass', 0.06, p.g, !isLocal, x, y, z)
    if (p.ping > 0) this.tone(p.ping, 0.05, p.g * 0.4, 'triangle', !isLocal, x, y, z)
  }

  /** 命中材质（本地射击打墙）：三态可听辨（金属叮/木头闷/沙地噗）；穿墙命中加闷声 */
  surfaceHit(material: string | undefined, penetrated: boolean, x: number, y: number, z: number, dist: number): void {
    const spatial = dist > 120
    const key =
      material === 'metal' || material === 'rusted' || material === 'ladder'
        ? 'hit_metal'
        : material === 'wood' || material === 'sandbag'
          ? 'hit_wood'
          : material === 'glass'
            ? 'glass_break'
            : 'hit_sand'
    if (!this.playSample(key, { spatial, x, y, z, gain: 0.7, muffled: penetrated, rateJitter: 0.2 })) {
      this.noiseBurst(material === 'metal' ? 1600 : 500, 'bandpass', 0.08, 0.25, spatial, x, y, z)
    }
  }

  /** #35 玻璃碎裂（CC0 重玻璃采样） */
  glassBreak(x: number, y: number, z: number): void {
    const spatial = Math.hypot(x, z) > 120
    if (this.playSample('glass_break', { spatial, x, y, z, gain: 0.8, rateJitter: 0.2 })) return
    this.noiseBurst(4500, 'highpass', 0.18, 0.25, spatial, x, y, z)
    this.tone(2400, 0.12, 0.08, 'triangle', spatial, x, y, z)
  }

  /** 爆炸（HE / C4 / 燃烧瓶）：CC0 爆炸采样 + 低频 sub；闪光=爆鸣 + 本地耳鸣 */
  explosion(kind: string, x: number, y: number, z: number): void {
    const big = kind === 'he' || kind === 'c4'
    const spatial = true
    if (kind === 'flash') {
      if (this.playSample('flash', { spatial, x, y, z, gain: 0.8 })) {
        // 耳鸣（本地）：独立于 3D
        if (this.tinnitus) this.playBuf(this.tinnitus, { gain: 0.8 })
        return
      }
      this.noiseBurst(3000, 'highpass', 0.06, 0.5, true, x, y, z)
      return
    }
    const crunch = this.playSample('explosion', { spatial, x, y, z, gain: big ? 0.95 : 0.55, rateJitter: 0.15 })
    if (big && this.playSample('explosion_sub', { spatial, x, y, z, gain: 0.8 })) {
      return
    }
    if (crunch) return
    // 回退：合成爆炸
    this.noiseBurst(big ? 300 : 700, 'lowpass', big ? 0.7 : 0.4, big ? 0.9 : 0.5, true, x, y, z)
    if (big) this.tone(48, 0.5, 0.7, 'sine', true, x, y, z)
  }

  /** 命中反馈（本地）：爆头=铃铛叮声（CC0），身体=闷肉击；打墙见 surfaceHit */
  hitmarker(part: string): void {
    if (part === 'head') {
      if (this.playSample('hit_head', { gain: 0.9, rateJitter: 0.15 })) return
      this.tone(2000, 0.05, 0.3, 'square')
      return
    }
    if (this.playSample('hit_soft', { gain: 0.7, rateJitter: 0.2 })) return
    this.tone(1400, 0.05, 0.3, 'square')
  }

  /** C4 滴答（CC0 tick 采样交替；越临近越快由调用方控制频率） */
  c4Beep(x: number, y: number, z: number): void {
    const key = this.c4BeepSeq++ % 2 === 0 ? 'c4_beep' : 'c4_beep'
    if (this.playSample(key, { spatial: true, x, y, z, gain: 0.9, rateJitter: 0 })) return
    this.tone(900, 0.08, 0.5, 'sine', true, x, y, z)
  }

  /** 换弹（两段咔哒：CC0 click 采样；未加载回退合成） */
  reload(): void {
    if (this.playSample('reload_a', { gain: 0.7 }) && this.playSample('reload_b', { gain: 0.7, delayMs: 180 })) return
    this.noiseBurst(700, 'bandpass', 0.03, 0.3)
    setTimeout(() => this.noiseBurst(500, 'bandpass', 0.04, 0.3), 180)
  }

  /** 回合胜负短音（CC0 bong / 低频 sub 回落） */
  roundEnd(win: boolean): void {
    if (win) {
      if (this.playSample('round_win', { gain: 0.6 })) return
      this.tone(660, 0.12, 0.4, 'sine')
      setTimeout(() => this.tone(880, 0.16, 0.4, 'sine'), 120)
    } else {
      if (this.playSample('explosion_sub', { gain: 0.35, rateJitter: 0.1 })) return
      this.tone(330, 0.16, 0.4, 'sawtooth')
      setTimeout(() => this.tone(220, 0.22, 0.4, 'sawtooth'), 160)
    }
  }
}
