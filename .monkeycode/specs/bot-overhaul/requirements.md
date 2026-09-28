# Requirements Document — Bot 大修（智能 + 视觉）

Feature Name: bot-overhaul
Updated: 2026-09-28
Status: 已确认（2026-09-28 用户决策）

## 用户决策记录（2026-09-28）

1. **R1 视觉方案**：分两步——第一批先修复回退色块人形的材质/光照适配（敌人立刻可见），第二批走 character-asset-pipeline 管线补 CT 专属 GLB 模型。
2. **R2-R7 智能范围**：一次性单批次全部实现，接受改动面大与联调风险。
3. **难度定位**：偏高难度硬核——难度 5 档接近真人水平（反应 0.35-0.5s），10 档为极限（瞬狙/压枪/极限反应）。R7 验收数值已按此校准。

## Introduction

当前对局中敌方 bot 存在两类问题：

1. **视觉**：CT 阵营专属模型资产缺失（`/models/ct_soldier.glb` 404），CT bot 回退为色块盒人形；回退人形使用金属深色贴图 + Lambert 材质，在现行 PBR + ACES 色调映射管线中曝光不足，玩家看到的敌人近乎纯黑。
2. **智能**：bot 具备战术抽签、A* 寻路、反应时间窗、瞄准误差收敛等基础能力，但行为模式单一可预测——只有视觉感知（无听觉）、敌人丢失视野后立即忘记（无目标记忆）、交战只会原地左右平移（无掩体利用、无换弹掩护、无血量撤退）、CT 防守不架点、无队友协同。

本文档定义两项改进的需求。验收基准：真实浏览器实测 + `npx vitest run` 全绿（当前基线 140 用例）。

## Glossary

- **感知（Perceive）**: bot 通过视觉或听觉判定某敌人存在的内部状态
- **最后已知位置（LKP）**: bot 最后一次视觉确认某敌人时该敌人的坐标
- **声源**: 产生枪声、脚步声、投掷物爆炸声的事件位置
- **掩体**: 阻断 bot 与威胁点之间视线（LOS）的地形块
- **架点**: bot 停止移动，将准星持续指向爆点入口方向的防守姿态
- **交战中（Engaging）**: bot 已感知敌人且反应窗口已过、开火条件成立的内部状态
- **难度档位**: 主菜单「Bot 难度」滑条的 1-10 档（config.ts 的 BOT_DIFFICULTY）

## Requirements

### R1 — 敌人视觉正确性

**User Story:** AS 玩家，I want 敌方 CT 拥有清晰的专属外观，so that 对战中敌我辨识一目了然。

#### Acceptance Criteria

1. WHEN 对局加载完成，系统 SHALL 为每个 CT bot 实例化 CT 阵营专属蒙皮模型（独立资产，外观与 T 阵营可区分）。
2. WHEN CT 阵营模板加载失败，系统 SHALL 让回退色块人形在三档画质（low/medium/high）下均达到可辨识亮度（玩家可在 300u 距离肉眼分辨敌我）。
3. WHILE 任一 bot 使用回退人形渲染，系统 SHALL 保持阵营色条与地面光环等既有敌我标识生效。
4. IF 阵营模型加载失败，系统 SHALL 在加载进度条上显示「人物模型已降级」提示。

### R2 — 听觉感知

**User Story:** AS 玩家，I want 敌人听到我的脚步和枪声后做出反应，so that 声音信息成为可用战术资源。

#### Acceptance Criteria

1. WHEN 600u 半径内出现声源且声源制造者在 bot 视锥外，bot SHALL 在 0.6s 内将视线水平转向声源方向。
2. WHEN bot 因声源转向后在 3s 内获得视觉，bot SHALL 进入交战状态。
3. WHILE bot 行走（Shift 静走）移动，bot 的脚步 SHALL 低音量播放，且 600u 内的敌方 bot 触发 R2.1 的概率按音量比例降低。
4. IF 同一声源已触发转向且 5s 内重复出现，bot SHALL 保持当前朝向，避免周期性甩头。

### R3 — 目标记忆与追击

**User Story:** AS 玩家，I want 敌人在我进烟或绕后拉断视线后仍保持威胁，so that 拉扯和绕后需要真实博弈。

#### Acceptance Criteria

1. WHEN bot 已交战的敌人连续 0.5s 脱离视觉，bot SHALL 向该敌人的最后已知位置方向保持瞄准并移动。
2. WHILE 追击 LKP 且追击时长 ≤ 4s，bot SHALL 沿 navmesh 向 LKP 移动并周期性扫视左右 ±45°。
3. IF 追击超过 4s 且无视觉，bot SHALL 回归当前战术目标并清除该目标的记忆。
4. WHEN 敌人消失于烟雾中，bot SHALL 对烟雾中心持续开火 1.5s 后停止。

### R4 — 掩体与生存

**User Story:** AS 玩家，I want 敌人残血时躲掩体、换弹时找掩护，so that 交战有回合感和压制价值。

#### Acceptance Criteria

1. WHEN bot 交战中且血量 ≤ 30，bot SHALL 在 1s 内选定最近的可阻断 LOS 掩体并移动至其后方。
2. WHILE bot 换弹（reloadUntilTick 生效期间），bot SHALL 向最近掩体移动。
3. WHEN bot 进入掩体后 2s 且换弹完成，bot SHALL 从掩体另一侧重新探出接敌。
4. IF 同一次交战中 bot 已执行过 1 次掩体转移，bot SHALL 继续原地交战（转移每场交战限 1 次）。

### R5 — 防守架点

**User Story:** AS 玩家，I want CT 敌人下包前守点、架在掩体后瞄入口，so that 进攻需要道具清点和预瞄。

#### Acceptance Criteria

1. WHILE bot 属于 CT 且回合处于防守阶段且无任何感知，bot SHALL 在分配的守点掩体后站定并将准星指向爆点入口方向。
2. WHEN 守点 bot 在其 800u 半径内感知到枪声，bot SHALL 沿 navmesh 向声源方向移动支援。
3. WHEN C4 已安放且 bot 属于 CT，bot SHALL 向 C4 位置移动（retake 既有逻辑保留）。
4. IF 守点超过 40s 无接触，bot SHALL 在爆点区域内变换一次站位。

### R6 — 交战品质

**User Story:** AS 玩家，I want 敌人交战有节奏（burst、换弹时机、远程点射），so that 交火体验接近真人对抗。

#### Acceptance Criteria

1. WHEN 交战距离超过 600u 且使用自动武器，bot SHALL 以 2-4 发点射节奏开火，间隔 0.3-0.5s。
2. WHEN bot 弹匣余量 ≤ 30% 且 3s 内无视觉，bot SHALL 换弹。
3. WHEN bot 弹匣打空且敌人仍在视觉内，bot SHALL 边向掩体移动边换弹。
4. WHILE 交战距离 ≤ 200u，bot SHALL 保持全自动压射并加大垂直平移幅度。

### R7 — 难度曲线可感知

**User Story:** AS 玩家，I want 难度滑条带来可感知的行为差异，so that 1 档休闲、10 档硬核。

#### Acceptance Criteria

1. WHEN 难度 ≤ 2，bot SHALL 表现为：反应窗 ≥ 0.8s、追击距离 ≤ 300u、不使用掩体转移（R4 降级）。
2. WHEN 难度 ∈ [3, 5]，bot SHALL 启用 R2-R6 全部行为，反应窗 ∈ [0.35, 0.8]s（难度 5 ≈ 真人水平）。
3. WHEN 难度 ∈ [6, 9]，bot SHALL 表现为：反应窗 ∈ [0.2, 0.35]s、优先瞄准头部、听声报点（radio 事件）。
4. WHEN 难度 = 10，bot SHALL 表现为：反应窗 ≤ 0.2s、LKP 追击 6s、burst 压枪命中收敛、狙击瞬镜。
5. WHEN 难度档位变化，bot 反应窗/瞄准 sigma/strafe 周期 SHALL 严格取自 BOT_DIFFICULTY 档位表（单一来源，无散落魔法数）。

## 排除项（本轮不做）

- 联机对战
- bot 语音播报真人配音
- 新地图 / 新武器

## 历史规格关联

- 改正书 `.monkeycode/docs/RECTIFICATION.md`：甲部 P0（V1 枪模、V2 音效）已完成记录，本规格为乙部玩法续篇，与改正书冲突处以改正书为准。
