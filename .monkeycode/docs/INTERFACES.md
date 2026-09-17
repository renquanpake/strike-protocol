# 接口定义

游戏为单进程应用，本文档定义内部模块接口（核心类型签名）与玩家操作接口。

## 核心数据类型

```typescript
type Team = 'T' | 'CT';

type HitboxPart = 'head' | 'chest' | 'stomach' | 'arms' | 'legs';

interface PlayerState {
  id: number;
  team: Team;
  isBot: boolean;
  position: Vec3;           // 脚底中心
  velocity: Vec3;
  yaw: number; pitch: number;
  flags: { onGround: boolean; ducking: boolean; walking: boolean; onLadder: boolean };
  health: number; armor: number; helmet: boolean;
  money: number;
  weapons: WeaponInstance[];  // [primary, secondary, knife, grenades...]
  activeSlot: number;
  alive: boolean;
  lastShotTick: number;
  recoilIndex: number;       // 当前后坐力序列位置
}

interface WeaponInstance {
  defId: string;             // 对应 weapons.ts 数值表键
  ammoMag: number;
  ammoReserve: number;
  nextFireTick: number;
}

interface WeaponDef {
  id: string;
  name: string;
  price: number;
  killReward: number;
  category: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'lmg' | 'grenade' | 'gear';
  damage: number;
  armorPenetration: number;  // 0-1
  rangeModifier: number;     // 每 500 单位伤害衰减系数
  fireRate: number;          // ms/发
  magazine: number;
  reserve: number;
  reloadMs: number;
  recoilPattern: [number, number][];  // 固定序列 [pitchKick, yawKick]
  spread: { stand: number; move: number; air: number };  // 锥角（度）
  moveSpeedScale: number;    // 持枪移速比例
}
```

## 系统接口

所有系统实现统一签名，由主循环按注册顺序调用：

```typescript
interface GameSystem {
  name: string;
  update(state: GameState, events: EventBus, dt: number): void;
}

interface EventBus {
  emit(evt: GameEvent): void;
  on<T extends GameEvent['type']>(type: T, fn: (e: Extract<GameEvent, { type: T }>) => void): void;
}

type GameEvent =
  | { type: 'shot'; playerId: number; weaponId: string }
  | { type: 'hit'; attackerId: number; victimId: number; part: HitboxPart; damage: number }
  | { type: 'kill'; attackerId: number; victimId: number; weaponId: string; headshot: boolean }
  | { type: 'bombPlanted'; site: 'A' | 'B'; playerId: number }
  | { type: 'bombDefused'; playerId: number }
  | { type: 'bombExploded' }
  | { type: 'roundEnd'; winner: Team; reason: 'elimination' | 'timeout' | 'bomb' | 'defuse' }
  | { type: 'matchEnd'; winner: Team };
```

## 回合状态机接口

```typescript
type RoundPhase =
  | 'warmup' | 'freeze' | 'live' | 'bombPlanted'
  | 'roundEnd' | 'halftime' | 'matchEnd';

interface RoundState {
  phase: RoundPhase;
  phaseEndTick: number;      // 当前阶段结束 tick
  roundNumber: number;
  score: { T: number; CT: number };
  lossStreak: { T: number; CT: number };
  bomb: {
    state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
    carrierId: number | null;
    site: 'A' | 'B' | null;
    plantProgress: number;   // 安放进度 0-1
    defuseProgress: number;  // 拆除进度 0-1
    explodeAtTick: number;
  };
}
```

## 玩家操作接口

| 操作 | 键位 | 说明 |
|------|------|------|
| 移动 | W / A / S / D | 相对视角方向 |
| 跳跃 | 空格 | 支持连跳窗口 |
| 蹲 | Ctrl（按住） | 减速、降低碰撞盒 |
| 静走 | Shift（按住） | 消除脚步声 |
| 开火 | 鼠标左键 | 半自动/全自动按武器 |
| 换弹 | R | 中断射击 |
| 购买 | B | 冻结/购买时间内可用 |
| 切换武器 | 1 / 2 / 3 / 4 | 主武器/副武器/刀/投掷物 |
| 丢弃 | G | 掉落当前主武器 |
| 安放/拆除 | E（按住） | bombsite 区域内 / C4 旁 |
| 计分板 | Tab（按住） | 击杀/死亡/金钱统计 |

## 地图数据接口

```typescript
interface Brush {
  min: Vec3;
  max: Vec3;
  material: 'concrete' | 'metal' | 'wood' | 'sand' | 'glass';
  clip?: boolean;            // 仅碰撞不可见
}

interface MapDef {
  name: string;
  brushes: Brush[];
  spawns: { T: Vec3[]; CT: Vec3[] };
  bombsites: { name: 'A' | 'B'; min: Vec3; max: Vec3 }[];
  navGrid: { cell: number; walkable: boolean[][] };  // 运行时由 brush 生成
}
```

## 配置接口

可调参数集中于 `src/game/config.ts`，单测与调参共用：

```typescript
const CONFIG = {
  tickRate: 64,
  moveMaxSpeed: 250,        // u/s
  walkSpeed: 130,
  duckSpeed: 85,
  groundAccel: 5.5,
  airAccel: 12,
  airSpeedCap: 30,
  groundFriction: 5.2,
  jumpImpulse: 301.993,
  bhopWindowMs: 40,         // 落地自动起跳窗口
  fallDamageThreshold: 580, // 坠落伤害起始速度
  c4TimerMs: 40000,
  plantMs: 3200,
  defuseMs: 10000,
  defuseWithKitMs: 5000,
  freezeMs: 5000,
  buyTimeMs: 20000,
  roundTimeMs: 115000,
  maxMoney: 16000,
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  headshotMultiplier: 4,
  winRounds: 16,
  teamSize: 5,
};
```

## 里程碑验收接口

每个里程碑在浏览器暴露统一调试接口（仅开发构建）：

```typescript
// window.__game（import.meta.env.DEV 才挂载）
interface DebugAPI {
  state(): GameState;            // 导出当前状态快照
  giveWeapon(id: number, weapon: string): void;
  teleport(pos: [number, number, number]): void;
  startRound(): void;            // 跳过 warmup
  tickOnce(): void;              // 单步执行一个逻辑 tick
}
```
