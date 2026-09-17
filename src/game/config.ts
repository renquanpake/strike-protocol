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

  // 角色几何（CS 比例）
  playerHeight: 72,
  crouchHeight: 48,
  playerRadius: 24,
  eyeHeight: 64,
  crouchEyeHeight: 44,

  // 视角
  mouseSens: 0.0021,
  fov: 75,

  // 地图
  killFallY: -1000,

  // 渲染
  skyColor: 0x8fb8d8,
  fogNear: 800,
  fogFar: 3600,
} as const
