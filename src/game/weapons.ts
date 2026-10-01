/**
 * 武器数值表（数据驱动）：新增武器只改本表，运行时零武器硬编码分支。
 * 单位：距离 u，时间 ms；recoilPattern 为弧度。
 * 数值基准：CS2 公开 wiki 一致数据（damage/armorPenetration/RPM/弹匣/价格/killReward/移速/rangeModifier），
 * 实机调参在 FLAGSHIP 批次 A 验收时微调；注释来源 = cs2 community consensus。
 * 部位倍率/护甲公式见 config.hitboxMultipliers 与 weapon.shotDamage（CS 护甲模型）。
 */

export type WeaponCategory =
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'sniper'
  | 'shotgun'
  | 'lmg'
  | 'grenade'
  | 'gear'
  | 'knife'

export interface WeaponDef {
  id: string
  name: string
  category: WeaponCategory
  /** 阵营限定（CS2 购买规则）：缺省 = 双方可买 */
  team?: 'T' | 'CT'
  price: number
  killReward: number
  /** 单发基础伤害（霰弹枪为单发弹丸伤害） */
  damage: number
  /** 头部倍率（默认 4，CS2 全枪一致） */
  headMul?: number
  pellets: number
  /** 护甲穿透 0-1（CS 护甲模型：最终伤害 = 原伤 × 本值；甲损耗 = 最终伤 × 0.5） */
  armorPenetration: number
  /** G1 穿墙（wallbang）能力 0-1：≥0.9 可穿 maxLayers 层，0.01-0.89 穿 1 层，缺省=不可穿透（刀/投掷物） */
  wallPenetration?: number
  falloffStart: number
  falloffEnd: number
  rangeModifier: number
  fireRateMs: number
  auto: boolean
  magazine: number
  reserve: number
  reloadMs: number
  /** 固定后坐力序列 [pitchKick, yawKick]（弧度）；全自动武器 30 发独立条目（G2 完整弹道图）；
   * 停火每 400ms 回卷一步（recoilRecoverMs），3s 完全回卷（recoilResetMs，对标 CS 预压后坐） */
  recoilPattern: [number, number][]
  /** 散布锥角（度）：stand=站定基础；crouch=蹲下站定基础（G4：约 stand 的 60-70%）；
   * move/air=满速时额外量（按速度连续插值）；burstGrow=逐发增量（时间衰减）。
   * 蹲下取 crouch 与移动插值的最小值（蹲射更准）。 */
  spreadDeg: { stand: number; crouch?: number; move: number; air: number; burstGrow: number }
  /** 持枪移速比（CS2 wiki 移速 u/s ÷ 250：knife 1.0 / SMG 0.96 / 步枪 0.86-0.90 / AWP 0.80 / LMG 0.78） */
  moveSpeedScale: number
  /** 近战参数（knife/zeus） */
  meleeRange?: number
  meleeDamage?: number
  /** #8 开镜（ADS）：有则支持右键瞄准。fovs=[单倍镜,双倍镜...]；
   * sensScales[i] 为第 i+1 档开镜的灵敏度缩放（= CONFIG.fov / fovs[i]，对标 CS 反比缩放），缺省回退 sensScale */
  zoom?: { fovs: number[]; sensScale: number; sensScales?: number[] }
}

const P = (id: string, name: string, mag: number, res: number, fireRateMs: number, dmg: number, pen: number, price: number, opts: Partial<WeaponDef> = {}): WeaponDef => ({
  id, name,
  category: 'pistol', price, killReward: 300, damage: dmg, pellets: 1, armorPenetration: pen,
  falloffStart: 500, falloffEnd: 2500, rangeModifier: 0.79, fireRateMs, auto: false,
  magazine: mag, reserve: res, reloadMs: 2000,
  recoilPattern: [[0.0044, 0], [0.0038, 0.0008], [0.0034, -0.0008], [0.004, 0.0012], [0.0044, 0], [0.0048, -0.001]],
  spreadDeg: { stand: 0.8, crouch: 0.55, move: 4.0, air: 8.0, burstGrow: 0 },
  moveSpeedScale: 0.96,
  ...opts,
})

/** 全自动枪械共享 pattern 生成形态（手写紧凑条目，对标 CS 弹道形态：前段直上→侧漂→回摆） */
const R = (id: string, name: string, mag: number, res: number, fireRateMs: number, dmg: number, pen: number, price: number, kill: number, speed: number, opts: Partial<WeaponDef> = {}): WeaponDef => ({
  id, name,
  category: 'rifle', price, killReward: kill, damage: dmg, pellets: 1, armorPenetration: pen,
  falloffStart: 500, falloffEnd: 4000, rangeModifier: 0.97, fireRateMs, auto: true,
  magazine: mag, reserve: res, reloadMs: 2500,
  recoilPattern: [[0.008, 0], [0.009, 0.0005], [0.008, -0.0005], [0.01, 0.001], [0.011, -0.001]],
  spreadDeg: { stand: 0.65, crouch: 0.42, move: 2.2, air: 4.5, burstGrow: 0.3 },
  moveSpeedScale: speed,
  ...opts,
})

export const WEAPONS: Record<string, WeaponDef> = {
  knife: {
    id: 'knife', name: '小刀', category: 'knife', price: 0, killReward: 1500, damage: 55, pellets: 1,
    armorPenetration: 0.85, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 400, auto: false,
    magazine: 0, reserve: 0, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 1, meleeRange: 48, meleeDamage: 55,
  },
  // ── 手枪（10）──────────────────────────────
  glock: P('glock', 'Glock-18', 20, 120, 150, 30, 0.47, 200, { team: 'T', wallPenetration: 0.2, rangeModifier: 0.75, reloadMs: 1900 }),
  usp: P('usp', 'USP-S', 12, 24, 170, 35, 0.505, 200, { team: 'CT', wallPenetration: 0.15, rangeModifier: 0.79, reloadMs: 2000 }),
  p2000: P('p2000', 'P2000', 13, 52, 170, 35, 0.505, 200, { team: 'CT', wallPenetration: 0.15 }),
  p250: P('p250', 'P-250', 13, 26, 150, 38, 0.642, 300, { wallPenetration: 0.2, rangeModifier: 0.75 }),
  fiveSeven: P('fiveSeven', 'Five-SeveN', 20, 100, 150, 32, 0.91, 500, { team: 'CT', wallPenetration: 0.2, rangeModifier: 0.885, reloadMs: 2400 }),
  tec9: P('tec9', 'TEC-9', 18, 90, 86, 33, 0.9025, 500, { team: 'T', wallPenetration: 0.18, rangeModifier: 0.81, reloadMs: 2200 }),
  cz75: P('cz75', 'CZ75-Auto', 12, 12, 75, 31, 0.78, 500, { team: 'T', wallPenetration: 0.15, auto: true, rangeModifier: 0.885 }),
  dualies: P('dualies', '双持贝瑞塔', 30, 120, 120, 38, 0.505, 400, { wallPenetration: 0.15, rangeModifier: 0.75, reloadMs: 3600 }),
  deagle: P('deagle', '沙漠之鹰', 7, 35, 225, 63, 0.939, 700, { wallPenetration: 0.5, rangeModifier: 0.81, reloadMs: 1800, moveSpeedScale: 0.92,
    recoilPattern: [[0.02, 0.002], [0.018, -0.002]], spreadDeg: { stand: 1.2, crouch: 0.8, move: 4.5, air: 9.0, burstGrow: 0 } }),
  r8: P('r8', 'R8 左轮', 8, 8, 400, 86, 0.939, 600, { wallPenetration: 0.6, rangeModifier: 0.85, moveSpeedScale: 0.92,
    recoilPattern: [[0.03, 0]], spreadDeg: { stand: 0.6, crouch: 0.4, move: 5.0, air: 10.0, burstGrow: 0 } }),
  // ── 冲锋枪（7）──────────────────────────────
  mac10: { id: 'mac10', name: 'MAC-10', category: 'smg', team: 'T', price: 1050, killReward: 600, damage: 29, pellets: 1,
    armorPenetration: 0.69, wallPenetration: 0.3, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.83, fireRateMs: 75, auto: true,
    magazine: 30, reserve: 100, reloadMs: 2400,
    recoilPattern: [[0.003, 0], [0.003, 0.001], [0.0028, -0.001], [0.0032, 0.0008], [0.0026, 0.0004], [0.003, -0.0006], [0.0024, 0], [0.002, 0.0003]],
    spreadDeg: { stand: 1.2, crouch: 0.8, move: 3.0, air: 7.0, burstGrow: 0.25 }, moveSpeedScale: 0.96 },
  mp9: { id: 'mp9', name: 'MP-9', category: 'smg', team: 'CT', price: 1250, killReward: 600, damage: 26, pellets: 1,
    armorPenetration: 0.6, wallPenetration: 0.3, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.79, fireRateMs: 70, auto: true,
    magazine: 30, reserve: 120, reloadMs: 2400,
    recoilPattern: [[0.003, 0], [0.003, 0.001], [0.0028, -0.001], [0.0032, 0.0008], [0.0026, 0.0004], [0.003, -0.0006], [0.0024, 0], [0.002, 0.0003]],
    spreadDeg: { stand: 1.1, crouch: 0.75, move: 2.8, air: 7.0, burstGrow: 0.25 }, moveSpeedScale: 0.96 },
  mp7: { id: 'mp7', name: 'MP7', category: 'smg', price: 1500, killReward: 600, damage: 29, pellets: 1,
    armorPenetration: 0.625, wallPenetration: 0.3, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.79, fireRateMs: 80, auto: true,
    magazine: 30, reserve: 120, reloadMs: 3000,
    recoilPattern: [[0.0028, 0], [0.0028, 0.0008], [0.0026, -0.0008], [0.003, 0.0006], [0.0024, 0.0003], [0.0028, -0.0005]],
    spreadDeg: { stand: 1.1, crouch: 0.75, move: 2.8, air: 7.0, burstGrow: 0.2 }, moveSpeedScale: 0.96 },
  mp5sd: { id: 'mp5sd', name: 'MP5-SD', category: 'smg', price: 1500, killReward: 600, damage: 27, pellets: 1,
    armorPenetration: 0.675, wallPenetration: 0.3, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.79, fireRateMs: 75, auto: true,
    magazine: 30, reserve: 120, reloadMs: 2800,
    recoilPattern: [[0.0028, 0], [0.0028, 0.0008], [0.0026, -0.0008], [0.003, 0.0006], [0.0024, 0.0003], [0.0028, -0.0005]],
    spreadDeg: { stand: 1.05, crouch: 0.7, move: 2.8, air: 7.0, burstGrow: 0.2 }, moveSpeedScale: 0.94 },
  ump45: { id: 'ump45', name: 'UMP-45', category: 'smg', price: 1200, killReward: 600, damage: 35, pellets: 1,
    armorPenetration: 0.65, wallPenetration: 0.35, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.65, fireRateMs: 90, auto: true,
    magazine: 25, reserve: 100, reloadMs: 3500,
    recoilPattern: [[0.0035, 0], [0.0035, 0.001], [0.0032, -0.001], [0.0038, 0.0008], [0.003, 0.0004], [0.0034, -0.0006]],
    spreadDeg: { stand: 1.0, crouch: 0.65, move: 2.6, air: 6.5, burstGrow: 0.2 }, moveSpeedScale: 0.92 },
  p90: { id: 'p90', name: 'P-90', category: 'smg', price: 2350, killReward: 300, damage: 26, pellets: 1,
    armorPenetration: 0.69, wallPenetration: 0.35, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.75, fireRateMs: 70, auto: true,
    magazine: 50, reserve: 100, reloadMs: 3300,
    recoilPattern: [[0.004, 0], [0.0038, 0.001], [0.0036, -0.001], [0.004, 0.0008], [0.0034, 0.0005], [0.0038, -0.0006], [0.0032, 0], [0.0035, 0.0007], [0.003, -0.0004], [0.0033, 0.0003]],
    spreadDeg: { stand: 1.4, crouch: 0.9, move: 3.2, air: 8.0, burstGrow: 0.25 }, moveSpeedScale: 0.94 },
  bizon: { id: 'bizon', name: 'PP-野牛', category: 'smg', price: 1400, killReward: 600, damage: 27, pellets: 1,
    armorPenetration: 0.645, wallPenetration: 0.25, falloffStart: 500, falloffEnd: 3000, rangeModifier: 0.78, fireRateMs: 80, auto: true,
    magazine: 64, reserve: 120, reloadMs: 2400,
    recoilPattern: [[0.0026, 0], [0.0026, 0.0007], [0.0024, -0.0007], [0.0028, 0.0005], [0.0022, 0.0003], [0.0026, -0.0004]],
    spreadDeg: { stand: 1.2, crouch: 0.8, move: 3.0, air: 7.5, burstGrow: 0.15 }, moveSpeedScale: 0.96 },
  // ── 步枪（7）──────────────────────────────
  galil: R('galil', '加利尔 AR', 35, 90, 90, 30, 0.775, 1800, 300, 0.86, { team: 'T', rangeModifier: 0.98, reloadMs: 3000,
    recoilPattern: [[0.007, 0], [0.008, 0.0005], [0.008, -0.0005], [0.009, 0.001], [0.01, -0.001], [0.011, 0], [0.012, 0.002], [0.013, -0.002], [0.014, -0.004], [0.015, -0.006], [0.016, -0.005], [0.017, -0.003], [0.018, 0.003], [0.019, 0.008], [0.02, 0.012], [0.019, 0.01], [0.018, 0.014], [0.017, 0.009], [0.016, 0.011], [0.015, 0.006], [0.014, 0.008], [0.013, 0.004], [0.012, 0.006], [0.011, 0.002], [0.01, 0.004], [0.009, 0.001], [0.008, 0.003], [0.007, 0], [0.007, 0.002], [0.006, -0.001]] }),
  famas: R('famas', 'FAMAS', 25, 90, 90, 33, 0.7, 2050, 300, 0.88, { team: 'CT', rangeModifier: 0.96, reloadMs: 3400,
    recoilPattern: [[0.006, 0], [0.007, 0.001], [0.007, -0.001], [0.008, 0], [0.008, 0.001], [0.009, 0], [0.009, -0.001], [0.01, 0.001], [0.011, 0], [0.012, 0.002], [0.013, 0.004], [0.014, 0.005], [0.014, 0.004], [0.015, 0.006], [0.015, 0.005], [0.016, 0.007], [0.015, 0.006], [0.014, 0.008], [0.013, 0.006], [0.012, 0.007], [0.011, 0.005], [0.01, 0.006], [0.009, 0.004], [0.008, 0.003], [0.007, 0.002]] }),
  ak: R('ak', 'AK-47', 30, 90, 100, 36, 0.775, 2700, 300, 0.86, { team: 'T', wallPenetration: 0.55, rangeModifier: 0.98, reloadMs: 2500,
    spreadDeg: { stand: 0.7, crouch: 0.45, move: 2.2, air: 4.5, burstGrow: 0.35 },
    recoilPattern: [[0.008, 0], [0.009, 0.0005], [0.008, -0.0005], [0.009, 0], [0.01, 0.001], [0.009, -0.001], [0.01, 0], [0.014, 0.002], [0.016, -0.002], [0.018, -0.006], [0.019, -0.008], [0.02, -0.007], [0.021, -0.006], [0.022, -0.004], [0.022, -0.002], [0.023, 0.004], [0.024, 0.01], [0.025, 0.014], [0.026, 0.012], [0.026, 0.016], [0.025, 0.014], [0.024, 0.018], [0.023, 0.012], [0.022, 0.008], [0.021, 0.004], [0.019, 0.008], [0.018, 0.002], [0.017, 0.005], [0.016, 0], [0.015, -0.003]] }),
  m4: R('m4', 'M4A4', 30, 90, 90, 33, 0.7, 3100, 300, 0.9, { team: 'CT', wallPenetration: 0.5, rangeModifier: 0.97, reloadMs: 3100,
    spreadDeg: { stand: 0.6, crouch: 0.4, move: 2.0, air: 4.0, burstGrow: 0.3 },
    recoilPattern: [[0.006, 0], [0.007, 0.001], [0.007, -0.001], [0.008, 0], [0.008, 0.001], [0.009, 0], [0.009, -0.001], [0.01, 0.001], [0.011, 0], [0.012, 0.001], [0.013, 0.003], [0.014, 0.005], [0.015, 0.004], [0.016, 0.006], [0.017, 0.005], [0.018, 0.007], [0.018, 0.006], [0.019, 0.008], [0.02, 0.007], [0.02, 0.009], [0.021, 0.008], [0.02, 0.01], [0.02, 0.008], [0.019, 0.009], [0.018, 0.007], [0.017, 0.005], [0.016, 0.006], [0.015, 0.003], [0.014, 0.004], [0.013, 0]] }),
  m4a1s: R('m4a1s', 'M4A1-S', 20, 80, 100, 29, 0.7, 2900, 300, 0.9, { team: 'CT', wallPenetration: 0.5, rangeModifier: 0.99, reloadMs: 3100,
    spreadDeg: { stand: 0.55, crouch: 0.36, move: 2.0, air: 4.0, burstGrow: 0.22 },
    recoilPattern: [[0.005, 0], [0.006, 0.0006], [0.006, -0.0006], [0.007, 0], [0.007, 0.0008], [0.008, 0], [0.008, -0.0008], [0.009, 0.0008], [0.01, 0], [0.011, 0.001], [0.012, 0.002], [0.013, 0.003], [0.013, 0.002], [0.014, 0.004], [0.014, 0.003], [0.015, 0.005], [0.014, 0.004], [0.013, 0.005], [0.012, 0.004], [0.011, 0.004]] }),
  sg553: R('sg553', 'SG 553', 30, 90, 110, 30, 1.0, 3000, 300, 0.84, { team: 'T', wallPenetration: 0.55, rangeModifier: 0.98, reloadMs: 3000,
    zoom: { fovs: [45], sensScale: 0.6, sensScales: [0.6] },
    recoilPattern: [[0.009, 0], [0.01, 0.0005], [0.009, -0.0005], [0.011, 0.001], [0.012, -0.001], [0.013, 0], [0.014, 0.002], [0.016, -0.002], [0.018, -0.005], [0.02, -0.008], [0.021, -0.006], [0.022, -0.004], [0.022, -0.002], [0.023, 0.004], [0.024, 0.01], [0.025, 0.013], [0.025, 0.011], [0.024, 0.015], [0.023, 0.012], [0.022, 0.014], [0.021, 0.01], [0.02, 0.008], [0.019, 0.01], [0.018, 0.006], [0.017, 0.007], [0.016, 0.003], [0.015, 0.005], [0.014, 0.001], [0.013, 0.003], [0.012, 0]] }),
  aug: R('aug', 'AUG', 30, 90, 100, 28, 0.9, 3300, 300, 0.88, { team: 'CT', wallPenetration: 0.5, rangeModifier: 0.98, reloadMs: 3400,
    zoom: { fovs: [45], sensScale: 0.6, sensScales: [0.6] },
    recoilPattern: [[0.006, 0], [0.007, 0.0008], [0.007, -0.0008], [0.008, 0], [0.008, 0.001], [0.009, 0.0005], [0.009, -0.0008], [0.01, 0.001], [0.011, 0.0005], [0.012, 0.002], [0.013, 0.004], [0.014, 0.005], [0.014, 0.004], [0.015, 0.006], [0.015, 0.005], [0.016, 0.007], [0.015, 0.006], [0.014, 0.008], [0.013, 0.006], [0.012, 0.007], [0.011, 0.005], [0.01, 0.006], [0.009, 0.004], [0.008, 0.005], [0.007, 0.003], [0.006, 0.004], [0.006, 0.002], [0.005, 0.003], [0.005, 0.001], [0.004, 0.002]] }),
  // ── 狙击（4）──────────────────────────────
  ssg08: { id: 'ssg08', name: 'SSG 08', category: 'sniper', price: 1700, killReward: 300, damage: 88, pellets: 1,
    armorPenetration: 0.85, wallPenetration: 0.8, falloffStart: 500, falloffEnd: 5000, rangeModifier: 0.98, fireRateMs: 1250, auto: false,
    magazine: 10, reserve: 90, reloadMs: 3200, recoilPattern: [[0.015, 0]],
    spreadDeg: { stand: 0.3, crouch: 0.2, move: 3.5, air: 7.0, burstGrow: 0 }, moveSpeedScale: 0.92,
    zoom: { fovs: [30], sensScale: 0.4, sensScales: [0.4] } },
  awp: { id: 'awp', name: 'AWP', category: 'sniper', price: 4750, killReward: 100, damage: 115, pellets: 1,
    armorPenetration: 0.975, wallPenetration: 0.95, falloffStart: 500, falloffEnd: 5000, rangeModifier: 0.99, fireRateMs: 1460, auto: false,
    magazine: 10, reserve: 30, reloadMs: 3800, recoilPattern: [[0.02, 0]],
    spreadDeg: { stand: 0.2, crouch: 0.15, move: 3.0, air: 6.0, burstGrow: 0 }, moveSpeedScale: 0.8,
    zoom: { fovs: [40, 18], sensScale: 0.53, sensScales: [0.53, 0.19] } },
  scar20: { id: 'scar20', name: 'SCAR-20', category: 'sniper', team: 'CT', price: 5000, killReward: 300, damage: 80, pellets: 1,
    armorPenetration: 0.825, wallPenetration: 0.75, falloffStart: 500, falloffEnd: 5000, rangeModifier: 0.98, fireRateMs: 120, auto: true,
    magazine: 20, reserve: 90, reloadMs: 3600, recoilPattern: [[0.014, 0]],
    spreadDeg: { stand: 0.4, crouch: 0.3, move: 4.0, air: 8.0, burstGrow: 0.1 }, moveSpeedScale: 0.84,
    zoom: { fovs: [40, 18], sensScale: 0.53, sensScales: [0.53, 0.19] } },
  g3sg1: { id: 'g3sg1', name: 'G3SG1', category: 'sniper', team: 'T', price: 5000, killReward: 300, damage: 80, pellets: 1,
    armorPenetration: 0.8, wallPenetration: 0.75, falloffStart: 500, falloffEnd: 5000, rangeModifier: 0.98, fireRateMs: 120, auto: true,
    magazine: 20, reserve: 90, reloadMs: 3600, recoilPattern: [[0.014, 0]],
    spreadDeg: { stand: 0.4, crouch: 0.3, move: 4.0, air: 8.0, burstGrow: 0.1 }, moveSpeedScale: 0.86,
    zoom: { fovs: [40, 18], sensScale: 0.53, sensScales: [0.53, 0.19] } },
  // ── 霰弹（4）──────────────────────────────
  nova: { id: 'nova', name: 'Nova', category: 'shotgun', price: 1050, killReward: 900, damage: 26, pellets: 9,
    armorPenetration: 0.5, wallPenetration: 0.25, falloffStart: 200, falloffEnd: 800, rangeModifier: 0.75, fireRateMs: 705, auto: false,
    magazine: 8, reserve: 32, reloadMs: 2800, recoilPattern: [[0.01, 0]],
    spreadDeg: { stand: 0.9, crouch: 0.6, move: 3.5, air: 8.0, burstGrow: 0 }, moveSpeedScale: 0.88 },
  xm1014: { id: 'xm1014', name: 'XM1014', category: 'shotgun', price: 2000, killReward: 900, damage: 20, pellets: 6,
    armorPenetration: 0.8, wallPenetration: 0.25, falloffStart: 200, falloffEnd: 800, rangeModifier: 0.75, fireRateMs: 350, auto: true,
    magazine: 7, reserve: 32, reloadMs: 2800, recoilPattern: [[0.009, 0]],
    spreadDeg: { stand: 0.9, crouch: 0.6, move: 3.5, air: 8.0, burstGrow: 0 }, moveSpeedScale: 0.88 },
  mag7: { id: 'mag7', name: 'MAG-7', category: 'shotgun', team: 'CT', price: 1300, killReward: 900, damage: 30, pellets: 8,
    armorPenetration: 0.75, wallPenetration: 0.25, falloffStart: 150, falloffEnd: 600, rangeModifier: 0.86, fireRateMs: 570, auto: false,
    magazine: 5, reserve: 32, reloadMs: 2800, recoilPattern: [[0.011, 0]],
    spreadDeg: { stand: 0.8, crouch: 0.55, move: 3.5, air: 8.0, burstGrow: 0 }, moveSpeedScale: 0.88 },
  sawnoff: { id: 'sawnoff', name: '短管霰弹枪', category: 'shotgun', team: 'T', price: 1100, killReward: 900, damage: 32, pellets: 9,
    armorPenetration: 0.5, wallPenetration: 0.2, falloffStart: 100, falloffEnd: 500, rangeModifier: 0.71, fireRateMs: 238, auto: false,
    magazine: 7, reserve: 32, reloadMs: 3200, recoilPattern: [[0.012, 0]],
    spreadDeg: { stand: 1.1, crouch: 0.75, move: 4.0, air: 9.0, burstGrow: 0 }, moveSpeedScale: 0.84 },
  // ── 机枪（2）──────────────────────────────
  m249: { id: 'm249', name: 'M-249', category: 'lmg', price: 5200, killReward: 300, damage: 38, pellets: 1,
    armorPenetration: 0.8, wallPenetration: 0.5, falloffStart: 500, falloffEnd: 4000, rangeModifier: 0.98, fireRateMs: 80, auto: true,
    magazine: 100, reserve: 200, reloadMs: 5700,
    recoilPattern: [[0.006, 0], [0.0055, 0.001], [0.005, -0.001], [0.0055, 0.0008], [0.005, 0.0004], [0.005, -0.0005]],
    spreadDeg: { stand: 1.0, crouch: 0.65, move: 2.4, air: 5.0, burstGrow: 0.25 }, moveSpeedScale: 0.78 },
  negev: { id: 'negev', name: '内格夫', category: 'lmg', price: 1700, killReward: 300, damage: 35, pellets: 1,
    armorPenetration: 0.75, wallPenetration: 0.5, falloffStart: 500, falloffEnd: 4000, rangeModifier: 0.98, fireRateMs: 60, auto: true,
    magazine: 150, reserve: 200, reloadMs: 5700,
    recoilPattern: [[0.004, 0], [0.0045, 0.002], [0.005, -0.002], [0.0055, 0.0015], [0.006, 0.001], [0.006, -0.001]],
    spreadDeg: { stand: 1.6, crouch: 1.0, move: 3.0, air: 6.0, burstGrow: 0.15 }, moveSpeedScale: 0.78 },
  // ── 投掷物（6）──────────────────────────────
  he: { id: 'he', name: '高爆手雷', category: 'grenade', price: 300, killReward: 300, damage: 110, pellets: 1,
    armorPenetration: 0.5, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 3, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  flash: { id: 'flash', name: '闪光弹', category: 'grenade', price: 200, killReward: 300, damage: 0, pellets: 1,
    armorPenetration: 0, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 5, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  smoke: { id: 'smoke', name: '烟雾弹', category: 'grenade', price: 300, killReward: 300, damage: 0, pellets: 1,
    armorPenetration: 0, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 3, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  molotov: { id: 'molotov', name: '燃烧瓶', category: 'grenade', team: 'T', price: 400, killReward: 300, damage: 30, pellets: 1,
    armorPenetration: 0.2, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 2, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  incendiary: { id: 'incendiary', name: '燃烧弹', category: 'grenade', team: 'CT', price: 500, killReward: 300, damage: 30, pellets: 1,
    armorPenetration: 0.2, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 2, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  decoy: { id: 'decoy', name: '诱饵弹', category: 'grenade', price: 50, killReward: 300, damage: 0, pellets: 1,
    armorPenetration: 0, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 2, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.98 },
  // ── 装备/近战 ──────────────────────────────
  zeus: { id: 'zeus', name: 'Zeus x27', category: 'gear', price: 200, killReward: 0, damage: 500, pellets: 1,
    armorPenetration: 1, falloffStart: 0, falloffEnd: 0, rangeModifier: 1, fireRateMs: 1000, auto: false,
    magazine: 1, reserve: 0, reloadMs: 0, recoilPattern: [],
    spreadDeg: { stand: 0, crouch: 0, move: 0, air: 0, burstGrow: 0 }, moveSpeedScale: 0.96,
    meleeRange: 100, meleeDamage: 500 },
}

/** 武器实例（弹药与运行时状态） */
export interface WeaponInstance {
  defId: string
  ammoMag: number
  ammoReserve: number
  nextFireTick: number
  reloadUntilTick: number
  /** 当前后坐力序列位置 */
  recoilIndex: number
  /** 连射计数（驱动 burst 散布） */
  burstCount: number
  /** 最近开火 tick（停火 3s 后后坐序列回卷，对标 CS） */
  lastShotTick: number
  /** G2 停火回卷基准：进入停火时的 recoilIndex 快照（0=未在停火恢复中），避免逐 tick 重复扣减 */
  recoilStopIndex: number
}

export function newWeaponInstance(defId: string): WeaponInstance {
  const def = WEAPONS[defId]
  return {
    defId,
    ammoMag: def.magazine,
    ammoReserve: def.reserve,
    nextFireTick: 0,
    reloadUntilTick: 0,
    recoilIndex: 0,
    burstCount: 0,
    lastShotTick: 0,
    recoilStopIndex: 0,
  }
}
