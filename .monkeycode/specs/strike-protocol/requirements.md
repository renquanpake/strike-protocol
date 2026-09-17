# Requirements Document

## Introduction

STRIKE PROTOCOL（突袭协议）是浏览器端第一人称战术射击游戏（FPS Web 应用），完整实现竞技爆破模式玩法内核：Source 风格运动物理、数据驱动武器与弹道、购买经济、回合制胜负、部位命中判定、Bot AI 对抗。全部美术与音频资产程序化生成，单页应用打开即玩。本文档以 EARS 模式描述全部可验收需求；数值基准引用 `.monkeycode/docs/INTERFACES.md` 的 CONFIG。

## Glossary

- **逻辑 tick**: 固定 64 Hz 的游戏逻辑步进，与渲染帧率解耦。
- **bhop**: 跳跃落地帧内立即再次起跳形成的连跳增速，存在可配置落地窗口（40 ms）。
- **strafe**: 空中斜向输入叠加空中加速度实现的速度累积。
- **recoil pattern**: 每把武器固定的后坐力序列，第 N 发对应固定 [pitchKick, yawKick]。
- **loss bonus**: 连败阶梯补偿，[1400, 1900, 2400, 2900, 3400]。
- **冻结时间（freeze）**: 回合开局仅购买/移动的受限阶段，5000 ms。
- **购买时间（buyTime）**: 可购物的完整窗口，冻结时间之后 20000 ms 内。
- **MR15**: 先取得 16 回合胜利的一方获胜，第 15 回合后换边。
- **hitbox 部位**: head / chest / stomach / arms / legs 五段胶囊。
- **navmesh**: 由地图 brush 栅格化的可走网格，供 Bot A* 寻路。

## Requirements

### R1 启动与主循环

**User Story:** AS 单机玩家, I want 打开页面即进入可玩的对局, so that 我无需安装或配置即可体验。

#### Acceptance Criteria

1. WHEN 应用加载完成, 系统 SHALL 以固定 64 tick/秒 步进执行逻辑系统链，渲染帧间对状态做插值。
2. WHILE 单帧逻辑欠账超过 10 tick, 系统 SHALL 丢弃超出部分并输出一次性能告警，保持渲染帧率不崩。
3. WHEN WebGL2 不可用, 系统 SHALL 显示静态降级说明页。

### R2 输入与视角

**User Story:** AS 玩家, I want 键鼠即典型 FPS 手感, so that 视角与移动操作零学习成本。

#### Acceptance Criteria

1. WHEN 玩家点击画布, 系统 SHALL 请求 pointer lock；pointer lock 期间鼠标位移以 0.002 rad/px 灵敏度旋转 yaw 与 pitch。
2. WHILE pointer lock 激活, 系统 SHALL 将 W/A/S/D 映射为相对视角的前后左右移动意图，Space 映射为跳跃意图。
3. WHEN 玩家按住 Ctrl, 系统 SHALL 启用蹲下姿态；按住 Shift 时脚步音效静音且移速不超过 walkSpeed。
4. WHILE pointer lock 未激活, 系统 SHALL 显示操作提示层并屏蔽移动意图。

### R3 运动系统

**User Story:** AS 玩家, I want 完整 Source 风格移动手感（bhop、strafe、蹲跳、梯子）, so that 对局移动不违和。

#### Acceptance Criteria

1. WHILE 角色处于地面, 运动系统 SHALL 按 groundFriction=5.2 指数衰减水平速度，并按 groundAccel=5.5 朝期望方向加速，水平速度上限 moveMaxSpeed=250 u/s。
2. WHILE 角色处于空中, 运动系统 SHALL 按 airAccel=12 应用空中加速度，且空中速度增量按 airSpeedCap=30 u/s 步进封顶。
3. WHEN 跳跃意图落在落地后 40 ms（bhopWindowMs）窗口内, 运动系统 SHALL 再次施加 jumpImpulse=301.993 的起跳冲量。
4. WHEN 角色垂直坠落速度超过 fallDamageThreshold=580 u/s, 运动系统 SHALL 按超出量线性结算坠落伤害。
5. WHILE 角色蹲下, 运动系统 SHALL 将碰撞盒高度降低、移速上限降至 duckSpeed=85 u/s 并平滑下移视角。
6. WHEN 角色进入梯子区域, 运动系统 SHALL 允许 W/S 沿梯子爬升/下降，爬行期间重力不生效。

### R4 武器与弹道

**User Story:** AS 玩家, I want 每把枪都有独立的后坐力与散布特征, so that 压枪形成肌肉记忆。

#### Acceptance Criteria

1. WHEN 玩家按下开火且满足冷却/弹药条件, 武器系统 SHALL 按武器 fireRate 间隔发射，并推进后坐力序列至下一索引，将 [pitchKick, yawKick] 施加到视角。
2. WHEN 发射发生在站定/移动/空中任一状态, 武器系统 SHALL 采用对应锥角在锥内随机取射向，移动惩罚取 weapon.moveSpeedScale 与当前速度比。
3. WHILE 弹匣为空, 武器系统 SHALL 将射向惩罚切换为空枪状态并在开火键触发 R 等效换弹；换弹时长取 weapon.reloadMs。
4. WHEN 弹药数据缺失或非法, 武器系统 SHALL 回退为手持小刀并记录一条日志。

### R5 命中与伤害

**User Story:** AS 玩家, I want 命中按部位与距离结算, so that 爆头与腰射体验符合竞技标准。

#### Acceptance Criteria

1. WHEN 射线命中目标角色, 战斗系统 SHALL 按部位倍率结算伤害，头部取 headshotMultiplier=4。
2. WHEN 命中距离超过首个衰减段, 战斗系统 SHALL 按 weapon.rangeModifier 每 500 u 递减伤害，下限为该武器声明的最小伤害。
3. WHEN 目标穿戴护甲, 战斗系统 SHALL 按护甲系数与 weapon.armorPenetration 结算减免；穿甲弹型武器减免更低。
4. IF 射线命中薄墙层数在武器允许范围内, 战斗系统 SHALL 沿延长线以衰减后伤害继续投射。
5. WHEN 单次命中使目标生命归零, 战斗系统 SHALL 产出 kill 事件并触发掉落武器逻辑。

### R6 经济与购买

**User Story:** AS 玩家, I want 金钱驱动战术博弈（eco/save/force buy）, so that 回合决策有深度。

#### Acceptance Criteria

1. WHEN kill 事件发生, 经济系统 SHALL 按武器类别向击杀方入账对应 killReward，击杀方死亡时奖金顺延给队伍。
2. WHEN 回合结束, 经济系统 SHALL 向胜方全员入账回合胜利奖金，向败方按 lossStreak 取 lossBonus 阶梯入账。
3. IF 入账后玩家金钱超过 maxMoney=16000, 经济系统 SHALL 将金额钳制在 16000。
4. WHILE 玩家处于冻结或购买时间内且位于出生区, 经济系统 SHALL 允许 B 键购买菜单完成交易；离开该窗口时系统 SHALL 拒绝交易并给出反馈。
5. WHEN 回合开始, 经济系统 SHALL 按规则重置：胜方保留上回合装备，败方仅保留手枪与刀。

### R7 回合与 C4

**User Story:** AS 玩家, I want 完整爆破回合流程与 MR15 节奏, so that 对局有起承转合。

#### Acceptance Criteria

1. WHEN 回合进入冻结阶段, 回合系统 SHALL 计时 5000 ms 后转入 live；购买时间（冻结后 20000 ms）内完成可购。
2. WHEN T 阵营玩家持有 C4 且在 bombsite 内按住 E 达 plantMs=3200, 回合系统 SHALL 将 C4 置为 planted 并启动 40000 ms 爆炸倒计时。
3. WHEN 拆弹者对已安放 C4 按住 E 达 defuseMs=10000（携带拆弹钳 5000）, 回合系统 SHALL 判定拆弹成功并将回合判给 CT。
4. IF C4 倒计时归零, 回合系统 SHALL 立即结算该回合判给 T。
5. WHEN 任一方淘汰对方全队或回合时间 115000 ms 耗尽, 回合系统 SHALL 结算回合并进入 roundEnd 展示。
6. WHEN 第 15 回合结束, 回合系统 SHALL 进入 halftime，交换阵营出生点并重置双方经济与武器；任一队达到 16 胜时系统 SHALL 进入 matchEnd。

### R8 地图与导航

**User Story:** AS 玩家, I want 一张原创双爆破点地图且 Bot 全图可达, so that 攻防路线有意义。

#### Acceptance Criteria

1. WHEN 地图加载完成, 地图系统 SHALL 提供 T/CT 出生点、A/B 两个 bombsite、中路与侧翼通道及高低差掩体，全部几何由 brush 描述。
2. WHEN 地图构建完成, 导航系统 SHALL 生成可走网格并保证每个 bombsite 自 T、CT 出生区均可达。
3. WHILE 地图渲染, 地图系统 SHALL 使用程序化材质（混凝土/金属/木箱/沙地）与静态光照，无外部资源请求。

### R9 Bot AI

**User Story:** AS 玩家, I want Bot 像一个会玩的人, so that 人机对抗有来有回。

#### Acceptance Criteria

1. WHEN Bot 视线内出现敌方目标且 raycast 无遮挡, Bot 系统 SHALL 在 200-400 ms 反应延迟后开始瞄准，瞄准角速度受上限约束。
2. WHILE 交战中, Bot 系统 SHALL 按距离采样高斯瞄准误差，距离越近误差收敛越小。
3. WHEN 回合进入 live 且为进攻队, Bot 系统 SHALL 依据经济状态选择 rush、默认卡点或回防路线并走 A* 路径；防守队 SHALL 优先守住 bombsite。
4. WHILE 回合开始时, Bot 系统 SHALL 依据当前金钱与阵营策略自动完成购买决策。
5. WHEN Bot 死亡, Bot 系统 SHALL 停止行动并把该 Bot 转入观战状态直至回合结束。

### R10 投掷物

**User Story:** AS 玩家, I want 高爆/闪光/烟雾/燃烧四类道具, so that 进攻与防守都有道具战术。

#### Acceptance Criteria

1. WHEN 投掷物引爆, 投掷物系统 SHALL 对范围内目标按距离衰减结算区域伤害（高爆）或点燃燃烧（按秒持续伤害）。
2. WHEN 闪光引爆, 投掷物系统 SHALL 对在闪光锥向内的目标施加视线遮蔽时长，遮蔽强度随视角正对程度递增。
3. WHILE 烟雾存活, 投掷物系统 SHALL 对穿过烟雾的视线 raycast 与 Bot 感知施加完全遮蔽。
4. WHEN 投掷物反弹墙, 投掷物系统 SHALL 按弹道摩擦与反弹衰减更新速度与自旋直至静止或引爆。

### R11 HUD 与界面

**User Story:** AS 玩家, I want 一眼看到血量/弹药/金钱/时间/比分/雷达, so that 对局信息不丢失。

#### Acceptance Criteria

1. WHILE 对局进行, HUD SHALL 实时显示血量、护甲、当前武器弹药、金钱、回合计时与双方比分。
2. WHEN 玩家按住 Tab, HUD SHALL 展开计分板，列出每人的击杀/死亡/金钱与武器。
3. WHILE 对局进行, 雷达 SHALL 以俯视投影显示队友/敌人位置与 bombsite 标记，视野外的敌方目标显示为灰色轮廓。
4. WHEN 玩家命中, HUD SHALL 播放 hitmarker 并以音调反馈命中部位。

### R12 音效系统

**User Story:** AS 玩家, I want 分材质脚步与分武器枪声, so that 听声辨位可用。

#### Acceptance Criteria

1. WHEN 开火/换弹/命中/爆炸事件发生, 音频系统 SHALL 以 WebAudio 合成对应音效，枪声按武器差异化。
2. WHEN 事件源在 3D 空间中, 音频系统 SHALL 通过 PannerNode 与距离衰减做空间化，脚步按地面材质切换滤波。
3. WHILE C4 已安放, 音频系统 SHALL 以随倒计时缩短而加密的滴答声提示剩余时间。

### R13 调试接口

**User Story:** AS 开发者, I want 控制台可驱动与观测状态, so that 数值调参与 AI 回归测试可用。

#### Acceptance Criteria

1. WHILE 开发构建运行, 系统 SHALL 暴露 `__game.state()`、`__game.giveWeapon()`、`__game.teleport()`、`__game.startRound()`、`__game.tickOnce()` 五个调试 API。
2. WHEN 生产构建运行, 系统 SHALL 不暴露调试 API。
