/**
 * 全局可调参数单一来源：调参与单测共用本表，源码中禁止散落魔法数字。
 * 单位制：1u = 1 Three.js 场景单位 = CS 世界单位（1u ≈ 3cm，玩家站立 72u ≈ 2.16m）。
 * 数值目标：严格对标 CS 手感，M1 起逐 tick 校准。
 */
/** V3+V6 地图天空/光照色板（renderer.configure + addSkyDome 按图切换） */
export interface SkyPalette {
  readonly sky: number
  readonly fogNear: number
  readonly fogFar: number
  readonly top: number
  readonly mid: number
  readonly horizon: number
  readonly sun: number
  readonly far: number
  readonly sunIntensity: number
  readonly sunAltitudeDeg: number
  readonly sunAzimuthDeg: number
  readonly hemiIntensity: number
}

export const CONFIG = {
  tickRate: 64,

  // 运动（Source 风格）
  moveMaxSpeed: 250, // u/s
  walkSpeed: 85,
  duckSpeed: 85,
  groundAccel: 5.5, // 地面加速率（乘 maxspeed*dt 得每 tick 增量）
  airAccel: 12, // 空中加速率（bhop 增速来源）
  airSpeedCap: 30, // 空中每 tick 速度增量上限
  airMaxSpeed: 325, // 空中速度总量上限（bhop 上限，≈ CS 320）
  groundFriction: 3.0, // 地面指数衰减率 /s（CS mv_friction）
  groundStopSpeed: 60, // 地面停速地板：低于后线性衰减至 0（CS stop_speed）
  stepHeight: 18, // 可步行跨上台阶高度 u（CS mv_stepheight=18）
  airFriction: 0.02,
  jumpImpulse: 301.993, // u/s
  bhopWindowMs: 40, // 落地自动起跳窗口（M1 启用）
  fallDamageThreshold: 400, // 坠落伤害起始速度 u/s（≈一层楼，CS 量级）
  maxFallSpeed: 700,
  gravity: 800, // u/s^2（jumpImpulse^2/2g ≈ 57u 跳跃高度，约 1.7m）

  // 生命值 / 坠落
  healthMax: 100,
  fallDamageScale: 0.5, // 超出阈值后每 1u/s 计 0.5 伤害
  crouchJumpBonus: 24, // 蹲跳额外垂直冲量

  // 梯子
  ladderClimbSpeed: 130, // u/s 上下攀爬速率

  // 投掷物（对标 CS：抛速 ~20m/s，闪光有效距离 30m 级并随距离/朝向衰减）
  grenadeThrowSpeed: 650, // u/s 出手初速（≈19.5m/s，CS ~20m/s）
  grenadeBounceFriction: 0.55, // 反弹速度保留
  heFuseMs: 3000,
  heRadius: 100, // ≈3m，CS 高爆有效半径（不伤投掷者，见 grenade.ts）
  flashFuseMs: 2800,
  flashRadius: 400, // ≈12m 内有效（CS 有效距离 20-50m 取保守档）
  flashMinDist: 80, // 此距离内全量致盲，更远距离按比例衰减
  flashBlindMs: 4000, // 贴脸满盲时长，随距离/朝向衰减
  smokeFuseMs: 2000, // 落地后延迟冒烟
  smokeRadius: 100,
  smokeLifeMs: 15000,
  molotovFuseMs: 1500,
  molotovRadius: 60,
  molotovLifeMs: 8000,
  molotovDps: 30,

  // 角色几何（CS 比例）
  playerHeight: 72,
  crouchHeight: 48,
  playerRadius: 24,
  eyeHeight: 64,
  crouchEyeHeight: 44,
  /** 视觉人物（蒙皮模型）站立身高目标 u。必须与本地玩家同高才"看起来一样高"：
   *  取 playerHeight=72（地图实际按 ~72u 玩家建造：48u 箱=玩家 67%、72u 墙=头高可跳越）。
   *  140u 会是 2 倍巨型（地图注释"玩家 140u"是过时错误标尺）。与 playerHeight 保持一致。 */
  charVisualHeight: 72,

  // 视角
  /** rad/px（≈0.04°/px，对标 CS 默认 sens 1.0 量级；设置层可再乘倍率） */
  mouseSens: 0.0007,
  fov: 75,
  /** #9 动态准星：每度散布对应准星间距像素 */
  crosshairGapPerDeg: 6,

  // 战斗
  /** 连射散布增量（°）的时间衰减（°/s，对标 CS 停火回准） */
  spreadDecayPerSec: 4,
  /** G2 后坐序列停火回卷：每 400ms 回卷一步（部分恢复，避免跳变），3s 完全回卷第 1 发（对标 CS 预压后坐） */
  recoilRecoverMs: 400,
  recoilResetMs: 3000,
  /** 开镜（ADS）时的移速倍率（对标 CS 开镜减速） */
  adsSpeedScale: 0.4,
  /** G3 受击减速（tagging）：命中后按伤害比例临时降移速（0.4-0.6s 衰减恢复），护甲降低时长与幅度（CS 标准） */
  tagging: {
    minMs: 400, // 最小 tag 时长
    maxMs: 600, // 满伤害 tag 时长
    strengthPerDmg: 0.01, // 伤害→最大降速比换算（上限 maxStrength）
    maxStrength: 0.5, // 最大降速比上限
    armorReduction: 0.5, // 穿戴护甲时 tag 时长与降速比各 ×(1-该值)
  },
  /** G1 穿墙（wallbang）：可穿透材质白名单 × 单穿伤害衰减；concrete 厚墙不可穿透仅削弱 */
  wallbang: {
    materials: { wood: 0.9, sandbag: 0.7, sand: 0.85 },
    maxLayers: 2, // 单发最多穿透层数（高 wallPenetration 武器可穿双层木板）
  },
  botHoldFireRange: 350, // Bot 不开火的最大距离（狙击枪除外）
  botViewDot: -0.34, // Bot 前向视野余弦下限（≈110° 后向不可见，原散落 -0.34 收口）
  botAimTauTicks: 192, // 瞄准收敛时间常数（tick，约 3s）
  /** 难度表 1-10 档（#19 消费）：反应窗口 [min,max] ms / 瞄准误差乘数 / 收敛时间常数乘数 / 感知距离 u / 走位周期 tick。
   * 第 5 档 = 现行参数（回归基线：reaction [200,400]、sigmaMul 1、tauMul 1、viewRange 480、strafePeriod 32）。 */
  // A-R7：难度档位单一来源（R2-R6 行为能力 + 难度曲线全部读此表，禁止散落魔法数）。
  // 定位偏高硬核：难度 5 ≈ 真人水平（反应 0.35-0.5s），10 档极限。
  // 字段说明：hear 听觉感知；lkpSec 目标记忆追击时长（0=不追）；cover 掩体转移；
  // anchor 防守架点；burst 远距离点射；headBias 瞄准头部倾向（0-1）；radioHear 听声报点。
  BOT_DIFFICULTY: [
    { reactionMs: [850, 1200], sigmaMul: 2.2, tauMul: 1.6, viewRange: 300, strafePeriod: 72, hear: false, lkpSec: 0, cover: false, anchor: false, burst: false, headBias: 0, radioHear: false },
    { reactionMs: [800, 1100], sigmaMul: 2.0, tauMul: 1.5, viewRange: 330, strafePeriod: 64, hear: false, lkpSec: 0, cover: false, anchor: false, burst: false, headBias: 0, radioHear: false },
    { reactionMs: [480, 800], sigmaMul: 1.6, tauMul: 1.3, viewRange: 420, strafePeriod: 48, hear: true, lkpSec: 4, cover: true, anchor: true, burst: true, headBias: 0, radioHear: false },
    { reactionMs: [400, 700], sigmaMul: 1.35, tauMul: 1.15, viewRange: 450, strafePeriod: 40, hear: true, lkpSec: 4, cover: true, anchor: true, burst: true, headBias: 0, radioHear: false },
    { reactionMs: [350, 500], sigmaMul: 1.0, tauMul: 1, viewRange: 480, strafePeriod: 32, hear: true, lkpSec: 4, cover: true, anchor: true, burst: true, headBias: 0, radioHear: false },
    { reactionMs: [250, 350], sigmaMul: 0.85, tauMul: 0.9, viewRange: 510, strafePeriod: 28, hear: true, lkpSec: 4, cover: true, anchor: true, burst: true, headBias: 0.3, radioHear: true },
    { reactionMs: [220, 320], sigmaMul: 0.72, tauMul: 0.8, viewRange: 540, strafePeriod: 26, hear: true, lkpSec: 5, cover: true, anchor: true, burst: true, headBias: 0.4, radioHear: true },
    { reactionMs: [200, 290], sigmaMul: 0.6, tauMul: 0.7, viewRange: 580, strafePeriod: 24, hear: true, lkpSec: 5, cover: true, anchor: true, burst: true, headBias: 0.5, radioHear: true },
    { reactionMs: [180, 260], sigmaMul: 0.48, tauMul: 0.6, viewRange: 620, strafePeriod: 22, hear: true, lkpSec: 5, cover: true, anchor: true, burst: true, headBias: 0.55, radioHear: true },
    { reactionMs: [140, 220], sigmaMul: 0.38, tauMul: 0.5, viewRange: 680, strafePeriod: 20, hear: true, lkpSec: 6, cover: true, anchor: true, burst: true, headBias: 0.6, radioHear: true },
  ] as const,
  /** 部位倍率（CS2 hitgroup：头 4（逐枪 headMul 可覆盖）/ 胸 1 / 腹 1.25 / 臂 1 / 腿 0.75；腿免甲见 weapon.shotDamage） */
  hitboxMultipliers: {
    head: 4,
    chest: 1,
    stomach: 1.25,
    arms: 1,
    legs: 0.75,
  } as Record<'head' | 'chest' | 'stomach' | 'arms' | 'legs', number>,

  // 地图
  killFallY: -1000,

  // 回合与经济（对标 CS:GO 现行规则）
  warmupMs: 5000,
  freezeMs: 5000,
  buyTimeMs: 5000, // live 期购买窗口（CS：冻结 5s + live 5s = 10s）
  roundTimeMs: 115000,
  c4TimerMs: 40000,
  c4InteractRadius: 40, // 下包/拾取/拆包的有效交互半径 u（原散落 40*40 收口）
  plantMs: 3200,
  defuseMs: 10000,
  defuseWithKitMs: 5000,
  roundEndMs: 5000,
  halftimeMs: 15000,
  winRounds: 16,
  /** #36 死斗：个人先 N 杀 / 团队死斗队先 N 杀 */
  dmKillTarget: 30,
  tdmKillTarget: 50,
  /** #36 死斗复活延迟 ms */
  ffaRespawnMs: 3000,
  startMoney: 800,
  moneyCap: 16000,
  roundWinBonus: 3250,
  lossBonus: [1400, 1900, 2400, 2900, 3400], // 连败 2-6+ 档
  killRewardCap: 1500, // 单回合击杀赏金上限（CS：$1500/回合）
  buyZoneMargin: 250, // 出生区外包扩 u，构成购买区（CS 买区≈出生区）
  /** 首回合（roundNumber=1）手枪轮：只允许刀/手枪/装备 */
  pistolRound: true,

  // 渲染
  skyColor: 0x8fb8d8,
  fogNear: 1400,
  fogFar: 6000,
  /** V3 明暗分层 + V6 地图色温调色板：太阳强度/角度（长影）、半球环境光、天空三段色、雾 */
  SKY_PALETTES: {
    de_sahara: {
      sky: 0xe8d9b8, fogNear: 1400, fogFar: 6000,
      top: 0x3a6ea8, mid: 0x8fb8d8, horizon: 0xe8cfa0, sun: 0xfff1cf, far: 0xb09a72,
      sunIntensity: 2.8, sunAltitudeDeg: 24, sunAzimuthDeg: 205, hemiIntensity: 0.45,
    },
    de_plaza: {
      sky: 0xd8e4e8, fogNear: 1200, fogFar: 5600,
      top: 0x2e5f9e, mid: 0x7fa8d0, horizon: 0xdce8ec, sun: 0xfff6e0, far: 0x7f95a8,
      sunIntensity: 3.0, sunAltitudeDeg: 32, sunAzimuthDeg: 155, hemiIntensity: 0.5,
    },
    training: {
      sky: 0xdfe8ee, fogNear: 1400, fogFar: 6000,
      top: 0x4a7ab0, mid: 0x9fc0dd, horizon: 0xe0e8ee, sun: 0xfff1cf, far: 0x8a97a5,
      sunIntensity: 2.6, sunAltitudeDeg: 40, sunAzimuthDeg: 180, hemiIntensity: 0.5,
    },
    de_costa: {
      sky: 0xcfe0ea, fogNear: 1200, fogFar: 5400,
      top: 0x2f6ba8, mid: 0x7fb0d8, horizon: 0xd8e6ee, sun: 0xfff6e6, far: 0x6f8ea0,
      sunIntensity: 2.9, sunAltitudeDeg: 28, sunAzimuthDeg: 140, hemiIntensity: 0.48,
    },
  } as Record<string, SkyPalette>,
  /** #11 屏幕震动：按距离衰减的半径与最大幅度（原散落 800/3 收口） */
  shakeDecayDist: 800,
  shakeMaxAmp: 3,
} as const
