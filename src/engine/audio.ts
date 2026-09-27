/**
 * WebAudio 程序化音频引擎：全部音效合成，零外部素材。
 * 3D 声源用 PannerNode 空间化，本地玩家音效直达 master。
 */

type Ctx = AudioContext

const weaponParams: Record<string, { filter: number; dur: number; gain: number; sub: number }> = {
  glock: { filter: 1800, dur: 0.08, gain: 0.5, sub: 90 },
  deagle: { filter: 900, dur: 0.16, gain: 0.75, sub: 60 },
  mp9: { filter: 1500, dur: 0.09, gain: 0.5, sub: 80 },
  p90: { filter: 1400, dur: 0.08, gain: 0.55, sub: 75 },
  m4: { filter: 1000, dur: 0.12, gain: 0.6, sub: 70 },
  m249: { filter: 900, dur: 0.13, gain: 0.6, sub: 65 },
  awp: { filter: 500, dur: 0.22, gain: 0.85, sub: 55 },
  ssg08: { filter: 550, dur: 0.2, gain: 0.8, sub: 55 },
  xm1014: { filter: 400, dur: 0.18, gain: 0.8, sub: 50 },
  sawnoff: { filter: 450, dur: 0.16, gain: 0.75, sub: 50 },
  knife: { filter: 900, dur: 0.05, gain: 0.2, sub: 0 },
  he: { filter: 600, dur: 0.05, gain: 0.15, sub: 0 },
  flash: { filter: 2000, dur: 0.04, gain: 0.15, sub: 0 },
  smoke: { filter: 500, dur: 0.05, gain: 0.12, sub: 0 },
  molotov: { filter: 700, dur: 0.05, gain: 0.12, sub: 0 },
}

const stepParams: Record<string, { filter: number; gain: number; ping: number }> = {
  sand: { filter: 400, gain: 0.22, ping: 0 },
  concrete: { filter: 900, gain: 0.3, ping: 0 },
  metal: { filter: 1600, gain: 0.3, ping: 2400 },
  wood: { filter: 600, gain: 0.3, ping: 0 },
  ladder: { filter: 800, gain: 0.2, ping: 0 },
  glass: { filter: 2000, gain: 0.2, ping: 3000 },
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

  /** 设置初始主音量（init 前调用，供 #3 设置层注入） */
  setInitialVolume(v: number): void {
    this.initialVolume = v
  }

  /** 运行时改主音量（0-1），未 init 时仅暂存。 */
  setMasterVolume(v: number): void {
    this.initialVolume = v
    if (this.master) this.master.gain.value = v
  }

  /** 运行时改环境/音乐音量（0-1） */
  setAmbientVolume(v: number): void {
    if (this.amb) this.amb.gain.value = v
  }

  /** #12 低血量心跳（双跳），intensity 0-1 控制音量 */
  heartbeat(intensity: number): void {
    if (!this.ctx || !this.master) return
    const g = Math.max(0.05, intensity)
    this.tone(70, 0.12, g, 'sine')
    setTimeout(() => this.tone(60, 0.14, g * 0.8, 'sine'), 180)
  }

  /** #23 无线电提示音（两声短 beep，收音机感） */
  radioBeep(): void {
    if (!this.ctx || !this.master) return
    this.tone(1200, 0.06, 0.12, 'square')
    setTimeout(() => this.tone(900, 0.08, 0.12, 'square'), 80)
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
    // 简单双振荡 pad（A3 + E4 五度），慢 LFO 音量
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

  /** 需在用户手势中调用以解锁 AudioContext */
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
    // 预生成噪声缓冲
    const len = this.ctx.sampleRate * 1
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.started = true
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
      const p = ctx.createPanner()
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
      g.connect(p)
      p.connect(this.master)
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
      const p = ctx.createPanner()
      p.panningModel = 'equalpower'
      p.distanceModel = 'linear'
      p.refDistance = 120
      p.maxDistance = 2500
      const pos = p as unknown as { positionX?: AudioParam; setPosition?: (a: number, b: number, c: number) => void }
      if (pos.positionX) {
        pos.positionX.value = x
        ;(pos as unknown as { positionY: AudioParam }).positionY.value = y
        ;(pos as unknown as { positionZ: AudioParam }).positionZ.value = z
      } else pos.setPosition?.(x, y, z)
      g.connect(p)
      p.connect(this.master)
    } else {
      g.connect(this.master)
    }
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /** 枪声（武器差异化 + 低频冲击）；muffled=G1 穿墙命中闷声（大幅低通） */
  shot(weaponId: string, x: number, y: number, z: number, isLocal: boolean, muffled = false): void {
    const p = weaponParams[weaponId] ?? weaponParams.m4
    const f = muffled ? Math.round(p.filter * 0.25) : p.filter
    const g = muffled ? p.gain * 0.7 : p.gain
    if (f > 0) this.noiseBurst(f, muffled ? 'lowpass' : 'bandpass', p.dur, g, !isLocal, x, y, z)
    if (p.sub > 0) this.tone(p.sub, p.dur * 0.8, (muffled ? 0.5 : 0.6) * p.gain, 'sine', !isLocal, x, y, z)
  }

  /** 脚步（材质区分） */
  footstep(material: string, x: number, y: number, z: number, isLocal: boolean): void {
    const p = stepParams[material] ?? stepParams.sand
    this.noiseBurst(p.filter, 'bandpass', 0.06, p.gain, !isLocal, x, y, z)
    if (p.ping > 0) this.tone(p.ping, 0.05, p.gain * 0.4, 'triangle', !isLocal, x, y, z)
  }

  /** #35 玻璃碎裂（高频脆响 + 玻璃 ping） */
  glassBreak(x: number, y: number, z: number): void {
    const spatial = Math.hypot(x, z) > 120
    this.noiseBurst(4500, 'highpass', 0.18, 0.25, spatial, x, y, z)
    this.tone(2400, 0.12, 0.08, 'triangle', spatial, x, y, z)
  }

  /** 爆炸（HE / C4 / 燃烧瓶） */
  explosion(kind: string, x: number, y: number, z: number): void {
    const big = kind === 'he' || kind === 'c4'
    this.noiseBurst(big ? 300 : 700, 'lowpass', big ? 0.7 : 0.4, big ? 0.9 : 0.5, true, x, y, z)
    if (big) this.tone(48, 0.5, 0.7, 'sine', true, x, y, z)
    if (kind === 'flash') this.noiseBurst(3000, 'highpass', 0.06, 0.5, true, x, y, z)
  }

  /** 命中反馈（本地，头部音调更高） */
  hitmarker(part: string): void {
    this.tone(part === 'head' ? 2000 : 1400, 0.05, 0.3, 'square')
  }

  /** C4 滴答（越临近越快由调用方控制频率） */
  c4Beep(x: number, y: number, z: number): void {
    this.tone(900, 0.08, 0.5, 'sine', true, x, y, z)
  }

  /** 换弹（两段咔哒） */
  reload(): void {
    this.noiseBurst(700, 'bandpass', 0.03, 0.3)
    setTimeout(() => this.noiseBurst(500, 'bandpass', 0.04, 0.3), 180)
  }

  /** 回合胜负短音 */
  roundEnd(win: boolean): void {
    if (win) {
      this.tone(660, 0.12, 0.4, 'sine')
      setTimeout(() => this.tone(880, 0.16, 0.4, 'sine'), 120)
    } else {
      this.tone(330, 0.16, 0.4, 'sawtooth')
      setTimeout(() => this.tone(220, 0.22, 0.4, 'sawtooth'), 160)
    }
  }
}
