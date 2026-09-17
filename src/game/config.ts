/**
 * 全局可调参数单一来源：调参与单测共用本表，源码中禁止散落魔法数字。
 * 单位制：1u = 1 Three.js 场景单位 = CS 世界单位（1u ≈ 3cm，玩家站立 72u ≈ 2.16m）。
 * 数值目标：严格对标 CS 手感，M1 起逐 tick 校准。
 */
export const CONFIG = {
  tickRate: 64,

  // 运动（Source 风格）
  moveMaxSpeed: 250, // u/s
  walkSpeed: 130,
  duckSpeed: 85,
  groundAccel: 5.5, // 地面加速率（乘 maxspeed*dt 得每 tick 增量）
  airAccel: 12, // 空中加速率（bhop 增速来源）
  airSpeedCap: 30, // 空中每 tick 速度增量上限
  airMaxSpeed: 325, // 空中速度总量上限（bhop 上限，≈ CS 320）
  groundFriction: 5.2, // 地面指数衰减率 /s
  airFriction: 0.02,
  jumpImpulse: 301.993, // u/s
  bhopWindowMs: 40, // 落地自动起跳窗口（M1 启用）
  fallDamageThreshold: 580, // 坠落伤害起始速度 u/s
  maxFallSpeed: 700,
  gravity: 800, // u/s^2（jumpImpulse^2/2g ≈ 57u 跳跃高度，约 1.7m）

  // 生命值 / 坠落
  healthMax: 100,
  fallDamageScale: 0.5, // 超出阈值后每 1u/s 计 0.5 伤害
  crouchJumpBonus: 24, // 蹲跳额外垂直冲量

  // 梯子
  ladderClimbSpeed: 130, // u/s 上下攀爬速率

  // 角色几何（CS 比例）
  playerHeight: 72,
  crouchHeight: 48,
  playerRadius: 24,
  eyeHeight: 64,
  crouchEyeHeight: 44,

  // 视角
  mouseSens: 0.0021,
  fov: 75,

  // 战斗
  movingSpeedThreshold: 30, // u/s：超过即视为移动态散布
  hitboxMultipliers: {
    head: 4,
    chest: 1,
    stomach: 1,
    arms: 0.7,
    legs: 0.7,
  } as Record<'head' | 'chest' | 'stomach' | 'arms' | 'legs', number>,

  // 地图
  killFallY: -1000,

  // 回合与经济
  warmupMs: 5000,
  freezeMs: 5000,
  buyTimeMs: 20000,
  roundTimeMs: 115000,
  c4TimerMs: 40000,
  plantMs: 3200,
  defuseMs: 10000,
  defuseWithKitMs: 5000,
  roundEndMs: 5000,
  halftimeMs: 15000,
  winRounds: 16,
  startMoney: 800,
  moneyCap: 16000,
  roundWinBonus: 3000,
  lossBonus: [1400, 1900, 2400, 2900, 3400], // 连败 2-6+ 档

  // 渲染
  skyColor: 0x8fb8d8,
  fogNear: 800,
  fogFar: 3600,
} as const
