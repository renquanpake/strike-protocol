# 开发指南

## 环境要求

- Node.js 20+
- npm 10+
- 浏览器需支持 WebGL2（Chrome 100+ / Firefox 100+）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（热更新）
npm run dev

# 运行单测（物理/经济/伤害公式）
npm run test

# 类型检查 + 生产构建
npm run typecheck && npm run build
```

## 项目结构说明

- `src/engine/` 引擎层：渲染、输入、主循环、几何工具、音频。与玩法无关，禁止 import `src/game/`。
- `src/game/` 玩法层：GameState、系统链、实体、武器数值表。禁止 import Three.js（逻辑层保持纯数据，保证可单测）。
- `src/map/` 地图：brush 布局、程序化材质、导航网格。
- `src/ui/` HUD：DOM/Canvas 实现，通过 EventBus 消费事件，只读 GameState。
- `tests/` 单测：对 `game/` 纯逻辑层做数值回归。

依赖方向强制单向：`ui -> game -> engine`，`map -> engine`。违反方向的 import 在 code review 与 typecheck 中一律拒绝。

## 开发规范

### 命名规范
- 文件与目录：kebab-case（`recoil-pattern.ts`）
- 类型/接口：PascalCase；常量配置：UPPER_SNAKE_CASE
- 游戏数值单位统一：距离/速度用单位 u（unreal 风格），时间用 tick 或 ms 显式标注于变量名后缀（`plantProgress`、`nextFireTick`）

### 代码风格
- TypeScript strict 模式，禁止 `any`（数值表解析边界处允许 `unknown` + 守卫）
- 系统函数保持纯逻辑：读 state、写 state、发事件，禁止直接操作 DOM 或 Three.js 对象
- 所有武器/经济数值必须进 `weapons.ts` 或 `config.ts`，禁止散落硬编码

### 提交规范
- 格式：`<type>(<scope>): <subject>`，type 取 feat/fix/refactor/test/docs/chore
- 示例：`feat(movement): 实现 air accelerate 与 bhop 窗口`

### 数值回归纪律
任何修改物理/伤害/经济公式的提交必须附单测更新。公式与测试同步改是本项目的硬纪律——这类数值 bug 极难靠试玩发现。

## 常见任务

### 新增一把武器
1. 在 `src/game/weapons.ts` 数值表添加条目（含 recoilPattern 序列）
2. 在 `tests/weapons.test.ts` 补充 DPS/衰减/经济断言
3. 买枪菜单自动读取数值表，无需改 UI

### 调整地图布局
1. 修改 `src/map/layout.ts` 的 brush 列表
2. 运行 `npm run dev`，调试接口 `__game.tickOnce()` 验证碰撞
3. 若地面变化影响寻路，删除 navmesh 缓存让其重新栅格化

### 新增一种投掷物
1. `WeaponDef.category = 'grenade'` 添加数值
2. 在 `systems/grenade.ts` 实现引爆条件与区域效果
3. 效果类事件（如 `flash` 视野遮蔽）进 EventBus，由 UI 与 Bot 感知层分别消费

### 调试技巧
- `window.__game.state()` 导出任意时刻完整状态
- `window.__game.tickOnce()` 单步执行逻辑 tick，配合断点定位物理问题
- 后坐力可视化：dev 构建中准星轨迹层叠加显示 pattern 点位

## 构建与发布

```bash
# 生产构建（产物在 dist/，纯静态文件）
npm run build

# 本地预览生产产物
npm run preview
```

- 产物为纯静态资源，可直接部署到任意静态服务器
- 所有资产程序化生成，构建产物自包含，无外部请求

## 测试策略

| 层 | 测什么 | 怎么测 |
|----|--------|--------|
| 运动物理 | 摩擦收敛、air accel 增速上限、bhop 窗口 | Vitest 逐 tick 模拟输入序列断言速度曲线 |
| 弹道伤害 | 部位倍率、距离衰减、护甲公式、穿透衰减 | 纯函数输入输出断言 |
| 经济 | 击杀奖励、loss bonus 阶梯、上限、购买校验 | 状态转移断言 |
| 回合状态机 | 全部 phase 迁移路径、C4 计时、换边重置 | 事件驱动状态机遍历 |
| Bot | 寻路可达性、瞄准误差分布 | 网格采样 + 统计断言 |

目标：M2 起单测作为合入门槛，公式改动零免测通道。
