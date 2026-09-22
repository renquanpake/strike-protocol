/**
 * 武器数值表（数据驱动）：新增武器只改本表，运行时零武器硬编码分支。
 * 单位：距离 u，时间 ms；recoilPattern 为弧度。
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
  price: number
  killReward: number
  /** 单发基础伤害（霰弹枪为单发弹丸伤害） */
  damage: number
  pellets: number
  /** 护甲穿透 0-1 */
  armorPenetration: number
  falloffStart: number
  falloffEnd: number
  rangeModifier: number
  fireRateMs: number
  auto: boolean
  magazine: number
  reserve: number
  reloadMs: number
  /** 固定后坐力序列 [pitchKick, yawKick]（弧度） */
  recoilPattern: [number, number][]
  /** 散布锥角（度）：站定 / 移动 / 空中 + 连射逐发增量 */
  spreadDeg: { stand: number; move: number; air: number; burstGrow: number }
  moveSpeedScale: number
  /** 近战参数（knife） */
  meleeRange?: number
  meleeDamage?: number
  /** #8 开镜（ADS）：有则支持右键瞄准。fovs=[单倍镜,双倍镜...]，sensScale 为开镜时灵敏度缩放 */
  zoom?: { fovs: number[]; sensScale: number }
}

export const WEAPONS: Record<string, WeaponDef> = {
  knife: {
    id: 'knife',
    name: '小刀',
    category: 'knife',
    price: 0,
    killReward: 1500,
    damage: 55,
    pellets: 1,
    armorPenetration: 1,
    falloffStart: 0,
    falloffEnd: 0,
    rangeModifier: 1,
    fireRateMs: 400,
    auto: false,
    magazine: 0,
    reserve: 0,
    reloadMs: 0,
    recoilPattern: [],
    spreadDeg: { stand: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 1,
    meleeRange: 48,
    meleeDamage: 55,
  },
  glock: {
    id: 'glock',
    name: 'G-19 手枪',
    category: 'pistol',
    price: 200,
    killReward: 300,
    damage: 26,
    pellets: 1,
    armorPenetration: 0.6,
    falloffStart: 150,
    falloffEnd: 400,
    rangeModifier: 0.75,
    fireRateMs: 150,
    auto: false,
    magazine: 20,
    reserve: 60,
    reloadMs: 1900,
    recoilPattern: [
      [0.0022, 0],
      [0.0019, 0.0004],
      [0.0017, -0.0004],
      [0.002, 0.0006],
      [0.0022, 0],
      [0.0024, -0.0005],
    ],
    spreadDeg: { stand: 0.1, move: 2.0, air: 4.0, burstGrow: 0 },
    moveSpeedScale: 1,
  },
  deagle: {
    id: 'deagle',
    name: '大雕 沙漠之鹰',
    category: 'pistol',
    price: 700,
    killReward: 300,
    damage: 53,
    pellets: 1,
    armorPenetration: 0.7,
    falloffStart: 200,
    falloffEnd: 450,
    rangeModifier: 0.8,
    fireRateMs: 400,
    auto: false,
    magazine: 7,
    reserve: 35,
    reloadMs: 1800,
    recoilPattern: [[0.012, 0.001], [0.011, -0.001]],
    spreadDeg: { stand: 0.15, move: 3.0, air: 5.0, burstGrow: 0 },
    moveSpeedScale: 1,
  },
  mp9: {
    id: 'mp9',
    name: 'MP-9 冲锋枪',
    category: 'smg',
    price: 1500,
    killReward: 600,
    damage: 20,
    pellets: 1,
    armorPenetration: 0.4,
    falloffStart: 200,
    falloffEnd: 500,
    rangeModifier: 0.7,
    fireRateMs: 70,
    auto: true,
    magazine: 30,
    reserve: 120,
    reloadMs: 2400,
    recoilPattern: [
      [0.003, 0],
      [0.003, 0.001],
      [0.0028, -0.001],
      [0.0032, 0.0008],
      [0.0026, 0.0004],
      [0.003, -0.0006],
      [0.0024, 0],
      [0.002, 0.0003],
    ],
    spreadDeg: { stand: 0.15, move: 2.5, air: 5.0, burstGrow: 0.08 },
    moveSpeedScale: 0.97,
  },
  m4: {
    id: 'm4',
    name: 'M4 步枪',
    category: 'rifle',
    price: 3150,
    killReward: 300,
    damage: 30,
    pellets: 1,
    armorPenetration: 0.75,
    falloffStart: 300,
    falloffEnd: 800,
    rangeModifier: 0.85,
    fireRateMs: 90,
    auto: true,
    magazine: 30,
    reserve: 90,
    reloadMs: 2700,
    recoilPattern: [
      [0.004, 0],
      [0.0035, 0.001],
      [0.003, 0.002],
      [0.0035, 0.0015],
      [0.003, 0.003],
      [0.0032, 0.0025],
      [0.0028, 0.001],
      [0.003, 0.002],
      [0.0034, 0.0018],
      [0.0031, 0.0012],
      [0.0029, 0.0008],
      [0.0027, 0.0005],
    ],
    spreadDeg: { stand: 0.08, move: 1.5, air: 3.0, burstGrow: 0.06 },
    moveSpeedScale: 0.95,
  },
  awp: {
    id: 'awp',
    name: 'AWP 狙击枪',
    category: 'sniper',
    price: 4750,
    killReward: 1000,
    damage: 115,
    pellets: 1,
    armorPenetration: 0.8,
    falloffStart: 100,
    falloffEnd: 700,
    rangeModifier: 0.8,
    fireRateMs: 1400,
    auto: false,
    magazine: 5,
    reserve: 30,
    reloadMs: 3800,
    recoilPattern: [[0.02, 0]],
    spreadDeg: { stand: 0.02, move: 0.8, air: 2.0, burstGrow: 0 },
    moveSpeedScale: 0.85,
    zoom: { fovs: [40, 14], sensScale: 0.3 },
  },
  xm1014: {
    id: 'xm1014',
    name: 'XM-14 霰弹枪',
    category: 'shotgun',
    price: 2000,
    killReward: 600,
    damage: 12,
    pellets: 8,
    armorPenetration: 0.2,
    falloffStart: 50,
    falloffEnd: 200,
    rangeModifier: 0.5,
    fireRateMs: 850,
    auto: false,
    magazine: 7,
    reserve: 28,
    reloadMs: 2200,
    recoilPattern: [[0.008, 0]],
    spreadDeg: { stand: 0.4, move: 3.0, air: 5.0, burstGrow: 0 },
    moveSpeedScale: 0.9,
  },
  p90: {
    id: 'p90',
    name: 'P-90 冲锋枪',
    category: 'smg',
    price: 1900,
    killReward: 600,
    damage: 26,
    pellets: 1,
    armorPenetration: 0.4,
    falloffStart: 200,
    falloffEnd: 550,
    rangeModifier: 0.7,
    fireRateMs: 68,
    auto: true,
    magazine: 50,
    reserve: 100,
    reloadMs: 3100,
    recoilPattern: [
      [0.004, 0],
      [0.0038, 0.0008],
      [0.0036, -0.0008],
      [0.004, 0.001],
      [0.0034, 0.0005],
      [0.0038, -0.0006],
      [0.0032, 0],
      [0.0035, 0.0007],
      [0.003, -0.0004],
      [0.0033, 0.0003],
    ],
    spreadDeg: { stand: 0.2, move: 3.0, air: 5.5, burstGrow: 0.07 },
    moveSpeedScale: 0.97,
  },
  m249: {
    id: 'm249',
    name: 'M-249 轻机枪',
    category: 'lmg',
    price: 4500,
    killReward: 300,
    damage: 24,
    pellets: 1,
    armorPenetration: 0.7,
    falloffStart: 300,
    falloffEnd: 700,
    rangeModifier: 0.85,
    fireRateMs: 80,
    auto: true,
    magazine: 100,
    reserve: 200,
    reloadMs: 6200,
    recoilPattern: [
      [0.003, 0],
      [0.0028, 0.0006],
      [0.0026, -0.0006],
      [0.003, 0.0008],
      [0.0028, 0.0004],
      [0.003, -0.0005],
    ],
    spreadDeg: { stand: 0.12, move: 1.8, air: 3.5, burstGrow: 0.05 },
    moveSpeedScale: 0.75,
  },
  ssg08: {
    id: 'ssg08',
    name: 'SSG 08 狙击枪',
    category: 'sniper',
    price: 4500,
    killReward: 1000,
    damage: 90,
    pellets: 1,
    armorPenetration: 0.8,
    falloffStart: 250,
    falloffEnd: 600,
    rangeModifier: 0.7,
    fireRateMs: 1300,
    auto: false,
    magazine: 10,
    reserve: 30,
    reloadMs: 3200,
    recoilPattern: [[0.015, 0]],
    spreadDeg: { stand: 0.03, move: 1.2, air: 2.5, burstGrow: 0 },
    moveSpeedScale: 0.85,
    zoom: { fovs: [30], sensScale: 0.5 },
  },
  sawnoff: {
    id: 'sawnoff',
    name: '短管霰弹枪',
    category: 'shotgun',
    price: 1300,
    killReward: 600,
    damage: 20,
    pellets: 6,
    armorPenetration: 0.3,
    falloffStart: 40,
    falloffEnd: 150,
    rangeModifier: 0.4,
    fireRateMs: 600,
    auto: false,
    magazine: 7,
    reserve: 14,
    reloadMs: 2600,
    recoilPattern: [[0.01, 0]],
    spreadDeg: { stand: 0.6, move: 4.0, air: 6.0, burstGrow: 0 },
    moveSpeedScale: 0.9,
  },
  he: {
    id: 'he',
    name: '高爆手雷',
    category: 'grenade',
    price: 500,
    killReward: 300,
    damage: 70,
    pellets: 1,
    armorPenetration: 0.8,
    falloffStart: 0,
    falloffEnd: 150,
    rangeModifier: 0,
    fireRateMs: 1000,
    auto: false,
    magazine: 1,
    reserve: 4,
    reloadMs: 0,
    recoilPattern: [],
    spreadDeg: { stand: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 0.97,
  },
  flash: {
    id: 'flash',
    name: '闪光弹',
    category: 'grenade',
    price: 300,
    killReward: 300,
    damage: 0,
    pellets: 1,
    armorPenetration: 0,
    falloffStart: 0,
    falloffEnd: 150,
    rangeModifier: 0,
    fireRateMs: 1000,
    auto: false,
    magazine: 1,
    reserve: 5,
    reloadMs: 0,
    recoilPattern: [],
    spreadDeg: { stand: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 0.97,
  },
  smoke: {
    id: 'smoke',
    name: '烟雾弹',
    category: 'grenade',
    price: 600,
    killReward: 300,
    damage: 0,
    pellets: 1,
    armorPenetration: 0,
    falloffStart: 0,
    falloffEnd: 0,
    rangeModifier: 0,
    fireRateMs: 1000,
    auto: false,
    magazine: 1,
    reserve: 3,
    reloadMs: 0,
    recoilPattern: [],
    spreadDeg: { stand: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 0.97,
  },
  molotov: {
    id: 'molotov',
    name: '燃烧瓶',
    category: 'grenade',
    price: 500,
    killReward: 300,
    damage: 30,
    pellets: 1,
    armorPenetration: 0.2,
    falloffStart: 0,
    falloffEnd: 0,
    rangeModifier: 0,
    fireRateMs: 1000,
    auto: false,
    magazine: 1,
    reserve: 2,
    reloadMs: 0,
    recoilPattern: [],
    spreadDeg: { stand: 0, move: 0, air: 0, burstGrow: 0 },
    moveSpeedScale: 0.97,
  },
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
  }
}
