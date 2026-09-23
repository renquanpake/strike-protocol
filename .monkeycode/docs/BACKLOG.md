# STRIKE PROTOCOL 任务书（完整化 Backlog · 详细版）

> 基线：commit `c4ed893`（Vanguard 人物 + 沙漠地图），75 测试全绿，tsc/build 干净。
> 范围：单机完善。网络多人、反作弊按项目范围边界**明确不做**（见 `docs/INDEX.md` 范围边界）。
> 用法：每项含「现状（文件级）/ 实现要点（步骤级）/ 验收 / 规模」。编号即任务 ID，供互相引用，已固请勿改号。

---

## 零、执行 AI 必读（没有会话上下文时从这里开始）

### 0.1 架构速览

浏览器端 CS 风格 FPS，TypeScript strict + Vite + Three.js，零外部素材（贴图 imggen 生成 / 音效 WebAudio 合成 / 人物开源 GLB）。

| 文件 | 职责 | 关键点 |
|---|---|---|
| `src/main.ts` | 装配层 + 渲染帧循环 | 顶层直接执行：建图→建 state→init() 异步加载→`requestAnimationFrame(frame)`。`frame()` 每帧：`loop.step(now, stepLogic)` → UI sync → 插值相机 → 渲染 → 音频监听 → HUD |
| `src/engine/loop.ts` | FixedLoop 固定 64Hz 逻辑步长（accumulator） | `step(nowMs, fn)` 返回 `{ticks, alpha}`；alpha 供渲染插值。**暂停=帧内跳过 step**（渲染照常） |
| `src/engine/input.ts` | 键鼠采集，`InputFrame` 每逻辑 tick 被 poll | 键位硬编码：WASD/方向键、Space 跳、R 换弹、B 买枪、Tab 计分、Digit1-7 切槽、KeyE `useHeld`、Ctrl 蹲、Shift 走。**鼠标只处理左键 button===0；右键完全空闲（ADS 接入点）**。指针锁定：点击 canvas 进入；Esc 由浏览器自动解锁（监听 `pointerlockchange` 可感知暂停意图） |
| `src/engine/eventbus.ts` | 类型化事件总线 | 14 种事件：`shot/surfaceHit/hit/targetKilled/playerKilled/reloadStarted/reloadFinished/roundEnd/bombPlanted/bombDefused/bombExploded/grenadeExploded/c4Beep/footstep`。`hit` 携带 `{victimId, part, damage, attackerId}`——伤害统计埋点直接用 |
| `src/engine/renderer.ts` | Three.js 封装 | API：`configure(sky,fogNear,fogFar,shadowExtent)`、`addBox`、`addDynamicBox/Sphere(id,…)`+`updateDynamic…`、`addDecalPool/spawnDecal/clearDecals`、`addHumanoid/updateHumanoid`、`addViewmodel*`、`loadCharacterModel(url)`（蒙皮人物，克隆用 SkeletonUtils）、`setCamera(pose)`、`render()`。**构造时定 FOV，无运行时 setFov——开镜需先加该 API** |
| `src/engine/audio.ts` | WebAudio 全合成音效 | `shot/footstep/explosion/hitmarker/c4Beep/reload/roundEnd`。master.gain 0.7 硬编码（音量设置接入点）。PannerNode 3D 空间化 |
| `src/engine/settings.ts` | （待建，#3） | localStorage 持久化的运行时覆盖层 |
| `src/game/state.ts` | GameState/PlayerEntity/RoundPhase/C4State | **players[0] 固定本地玩家（T 队 id0）**；5v5 写死在 `createGameState`（4 个 T bot + 5 个 CT bot push，改 bot 数量动这里）；`createGameState(spawnT, spawnCT, healthMax, startMoney, rngSeed=0x5eed)` **种子参数已存在**。PlayerEntity 无伤害/爆头统计字段（结算屏需加） |
| `src/game/config.ts` | CONFIG 全局参数单一来源（`as const` 深只读） | 64Hz、运动（bhop/摩擦/空中加速）、投掷物参数、回合与经济（winRounds 16、连败阶梯）、hitbox 倍率。**改数值一律进本表；运行时可调项走 #3 Settings 覆盖层** |
| `src/game/weapons.ts` | 武器数据表（11 枪 + 4 投掷 + 刀），零运行时硬编码分支 | WeaponDef：伤害/穿透/衰减/射速/后坐力序列/散布四态/moveSpeedScale |
| `src/game/systems/weapon.ts` | 开火/命中/换弹/切枪 | `activeWeapon(p)`、`shotDamage(def,part,dist,armor)`（护甲公式就绪但 armor 恒 0）、`fireWeapon`（含 C4 掉落 242-244 行）、**`spreadDegrees(p, def)`（309 行，动态准星现成数据源）**、`viewForward/viewRight` |
| `src/game/systems/movement.ts` | Source 风格移动 | **灵敏度应用点 25-26 行：`p.yaw -= inp.mouseDX * CONFIG.mouseSens`** |
| `src/game/systems/bot.ts` | Bot 大脑 | 硬编码参数位置：感知距离 480（274 行）、视野前向点积 >-0.34≈100°（292 行）、反应窗口 200+rng*200ms（298 行）、瞄准误差 `sigma0=0.02+0.00012*dist`（142 行）、瞄准收敛 tau=CONFIG.botAimTauTicks。投掷物只用 grenades[0]=he（T 交战）与 grenades[2]=smoke（CT 已下包）。**经济从不买 flash；molotov 买了从不扔** |
| `src/game/systems/round.ts` | 回合状态机 | warmup→freeze→live→(bombPlanted)→roundEnd/halftime/matchEnd；`siteAt` 安放判定；换边 roundNumber%15；**C4 拾取逻辑应挂在 updateRound 的 live 段** |
| `src/game/economy.ts` | 经济 | `buyItem(state,p,itemId,events)`（'kit' 分支是加装备项的模板）、`canBuyNow`（freeze 全程+live 前 buyTimeMs）、`resetEquipment`（败方重置为 glock+刀）、`GEAR_PRICES`（现仅 kit:500） |
| `src/game/map/layout.ts` | Brush 类型 | 材质 10 种（concrete/metal/wood/sand/glass/ladder/stone/roof/sandbag/rusted）+ `clip`（仅碰撞）+ `ladder` + `decor`（纯视觉不碰撞不入导航）标志 |
| `src/game/map/match.ts` | 当前正式地图 de_sahara（`matchLevel()`） | 多图化时改为按 id 选图 |
| `src/engine/textures.ts` | 材质→贴图 | **新材质键必须双登记：`buildTextures()`（canvas 回退）+ `loadImageTextures()`（PNG 覆盖）** |
| `src/game/particles.ts` | 弹壳/枪口火光池 | Shell/MuzzleFlash 池模式是 tracer/血雾的参考实现 |
| `src/ui/hud.ts` | HUD 文本更新 | `#status`（调试：POS/SPD/HP）、`#weapon`、`#round`（顶部计分行）、准星仅随锁定显隐 |
| `src/ui/buymenu.ts` | 买枪菜单 | `SECTIONS` 静态数组驱动（副武器/主武器/投掷物/装备），`refresh()` 刷灰已持有/买不起 |
| `src/ui/scoreboard.ts` | Tab 记分板 | kills/deaths 表 |
| `src/ui/radar.ts` | 雷达（跟随玩家） | C4 三态图标已有（carried/dropped/planted 都画） |
| `src/ui/viewmodel.ts` | 第一人称枪模 | **`upgradeWithGLB(category, url, targetLen, zShift)`（164 行）按枪类接入 GLB，现仅 'rifle'→m4.glb** |
| `index.html` | 全部 HUD DOM + 内联 CSS | `#crosshair` 22px 静态 CSS 渐变准星；`#lock-hint`（文案过时"M6"）；`#blind/#hitmarker/#dmg/#roundmsg` |

### 0.2 工作流约定（每个任务都要遵守）

1. **验证三件套**（完成后必须全绿再提交）：`npx tsc --noEmit` → `npx vitest run`（当前基线 75 通过，测试在 `tests/*.test.ts`：bot/combat/grenade/hud/loop/movement/navmesh/particles/round/routes/weapon）→ `npm run build`。
2. **数值改动进 CONFIG 或 Settings**，源码禁止散落魔法数字（现有约定，config.ts 头部注释写明）。
3. **事件边沿在 tick 级累积**：main.ts 的 `pendingBuyToggle` 模式（输入边沿可能被一帧多 tick 吞掉，用标志位累积后再消费）。新增边沿输入（如暂停键、丢枪 G）照抄此模式。
4. **UI 是 DOM 面板**：样式写在 index.html 内联 CSS，组件类放 `src/ui/`（如 `src/ui/killfeed.ts`），构造时 append 到 `#hud`，`pointer-events: none` 注意交互面板单独开启。
5. **提交规范**：中文 commit，`feat(模块): 描述` 格式；一个任务一组提交；不 commit secrets。
6. **环境坑（必读）**：
   - 本沙箱 puppeteer+swiftshader **渲染不出蒙皮人物**（SkinnedMesh 绘制调用恒为 0，环境限制非 bug）。人物相关视觉验收：数值断言 + 让用户在真实浏览器打开预览链接确认。普通 box/line 渲染可正常截图验收。
   - 预览：dev 服务器 3000 端口（后台终端 `npm run dev` 管理），构建产物 `npm run build` 出 dist。
   - 命令行**禁止删除类操作**（rm 等），文件由 git 管理。
   - 人物系统已有约定：`skeleton.boneTexture.needsUpdate=true` 是 context 恢复唯一正确姿势；禁调无参 `skeleton.init()`。

### 0.3 对局流程速记（改状态机前必看）

`stepLogic` 每 tick 顺序：`updateBots`（合成 bot 输入）→ 全员 `updatePlayerMovement` → `updateWeaponSystem` → `fireWeapon` → `updateTargets` → `updateGrenades` → `updateRound` → `tick++`。
回合流：warmup(5s) → freeze(5s，可买枪) → live(115s，T 按住 E 在包点安放) → bombPlanted(40s，CT 按住 E 拆) → endRound(胜方结算+5s) → 下一回合 freeze；15 回合半场换边；先到 16 胜进 matchEnd。C4 携带者死亡 → `dropped`（两处：weapon.ts:242、grenade.ts:137），**掉落后 position 停在死亡点且全代码无拾取逻辑（#17 缺口）**。

### 0.4 可复用资产

- 项目 skill（本仓库 `.opencode/skills/`，gitignore 本地生效）：
  - `character-asset-pipeline`：开源人物模型引入全流程（找/压缩/染色/骨骼归一/验收）
  - `map-build-craft`：新地图制作方法论（imggen 贴图/Brush 体系/导航净空/路由回归）
- 贴图生成：`node tools/imggen/gen.mjs [file...]`（队列 `tools/imggen/queue.json`，产 `public/textures/*.png`）
- GLB 压缩管线模板：`/tmp/opencode/gltftrim/`（gltf-transform v4，`io.writeBinary` 返回 Uint8Array 需手写盘；禁 meshopt/quantize 以保 Skin）

---

## 一、里程碑总览

| 里程碑 | 任务 | 出口标准 |
|---|---|---|
| M1 外壳 | #1-#7 | 有入口/暂停/设置/结算，像个完整游戏 |
| M2 手感与规则 | #17 #18（真缺口先做）→ #8-#16 | 规则无漏洞，手感对齐 CS |
| M3 Bot 智能 | #19-#27 | 对抗有层次 |
| M4 内容 | #28-#37 | 有得选、耐玩 |
| M5 工程打磨 | #38-#44 | 长期可维护 |

依赖：#3（设置层）是 #9/#19/#38/#42 的前置；#1（主菜单/对局配置）是 #19/#28/#36/#44 的入口；#17（C4 拾取）与 #27（丢枪）共用掉落物框架。

---

## P0 游戏外壳

### #1 主菜单 + 对局前配置 [M]
**现状**：无任何入口。`main.ts` 顶层 import 即建图开打（34-44 行直接执行 `matchLevel()`→`createGameState`→`init()`）。bot 数量写死 5v5（state.ts:170-179）。对局结束只有一行文字。
**实现要点**：
1. 新建 `src/ui/mainmenu.ts`：全屏 DOM overlay（`pointer-events:auto`），含「开始对局 / 设置(#3) / 操作说明 / 关于」与对局前配置项。
2. 新建 `src/game/matchconfig.ts`：`interface MatchConfig { mapId: string; botCount: number /*1-9*/; difficulty: number /*1-10，#19 前先隐藏*/; roundPreset: 'short'|'standard'|'long'; playerSide: 'T'|'CT'; seed?: number }`，默认值从 CONFIG 推导。
3. 重构 `main.ts`：把「建图→建 state→init→frame」包进 `startMatch(cfg: MatchConfig)`；主菜单点开始时调用。botCount 改 `createGameState` 签名（增加 options 参数：botCount/playerSide/rngSeed），分配规则：剩余 bot 补本地玩家所在队，敌方保持 5。
4. 对局配置影响：roundPreset 映射 CONFIG 的 roundTimeMs/c4TimerMs 等覆盖进 round 初始化；playerSide 决定 players[0] 的 team（注意 `teamSpawn` 的换边逻辑依赖 sidesSwapped，本地玩家换队后雷达/出生点方向自动正确，需回归 routes 测试）。
5. 「回主菜单」先用**整页 reload + localStorage 暂存配置**的简单方案（renderer 无 dispose API，可接受）；M4 做模式扩展时再评估重构成可重入。
**验收**：`npx tsc --noEmit` 绿；手动：主菜单→改 bot 数→开局 bot 数正确；打完一局回主菜单→再开一局正常；players[0] 在 CT 侧时出生点/雷达朝向正确。
**坑**：`state.targets`/粒子池/HP 标签等在 main.ts init 里按玩家 id 硬编码（如 `bot:${p.id}`），重构时保持 key 生成逻辑不变。

### #2 暂停菜单 [S]
**现状**：Esc 退出指针锁后游戏继续跑；无暂停概念。FixedLoop 持续 accumulate。
**实现要点**：
1. main.ts 加 `paused` 标志：`frame()` 里 `paused` 时跳过 `loop.step`（渲染/UI 照常），恢复时调 `loop.reset()` 防止积压帧爆发追帧（loop.ts:44 已有 reset）。
2. 暂停触发：监听 `document.pointerlockchange`（Esc 解锁即暂停，符合 FPS 习惯）；#1 主菜单界面时**不算**暂停。
3. 新建 `src/ui/pausemenu.ts`：继续（重新 requestPointerLock）/ 设置(#3 共用面板) / 重新开局（reload）/ 回主菜单（reload 清配置暂存）。
4. 暂停时 Bot/AI 全冻（stepLogic 不执行即全冻），音频监听不动。
**验收**：手动：Esc 出菜单、回合倒计时冻结、继续后状态无缝；`npx vitest run` 绿（loop.test.ts 补「跳过 step 后 reset 不炸」用例）。
**坑**：pointer lock 请求必须在用户手势里；「继续」按钮 click 即手势。

### #3 设置面板 + 持久化 + CONFIG 运行时覆盖层 [M]
**现状**：灵敏度/FOV/音量全硬编码：`movement.ts:25-26` 读 `CONFIG.mouseSens`、`main.ts:57` `new GameRenderer(canvas, CONFIG.fov)`、`audio.ts:52` `master.gain.value = 0.7`。CONFIG 是 `as const` 深只读，直接赋值 TS 报错。
**实现要点**：
1. 新建 `src/engine/settings.ts`：
   ```ts
   interface Settings { mouseSens: number; fov: number; masterVolume: number; sfxVolume: number;
     quality: 'low'|'medium'|'high'; crosshair: { style: 'cross'|'dot'|'circle'; color: string; gapScale: number };
     keybinds?: Record<string, string> /* #42 再启用 */ }
   ```
   `loadSettings()`（localStorage key `sp_settings`，缺省回退 CONFIG 值）/ `saveSettings()` / `SETTINGS` 单例。
2. 接入点替换（保持行为一致）：movement.ts 灵敏度读 `SETTINGS.mouseSens`；renderer 加 `setFov(fov: number)`（camera.fov + updateProjectionMatrix），main.ts 构造后与设置变更时调用；audio.ts 加 sfxGain 中间节点（noiseBurst/tone 都过它），master 与 sfx 双轨读 SETTINGS。
3. 新建 `src/ui/settingspanel.ts`：共用面板（主菜单与暂停菜单挂同一实例）：灵敏度滑条 0.5-5x、FOV 60-110、音量双轨 0-100、画质档(#38 前置隐藏)、准星样式颜色(#9 接入)。改动即生效 + debounce 200ms save。
4. 应用 FOV/音量需在 `startMatch` 前与设置面板 onChange 两处触发。
**验收**：改灵敏度/FOV 立即生效；刷新页面后保留；音量分轨独立可调；`npx tsc --noEmit` 绿。
**坑**：`CONFIG` 语义保持「数值单一来源」——Settings 缺省值显式引用 `CONFIG.mouseSens` 等，避免两处默认值漂移。

### #4 对局结算屏 [M]
**现状**：matchEnd 时 `#roundmsg` 显示一行 `MATCH OVER — T WINS 16:3`（main.ts:364-366）。PlayerEntity 只有 kills/deaths，无伤害/爆头统计。
**实现要点**：
1. state.ts PlayerEntity 加统计字段：`damage: number; headshotKills: number; firstKills: number`（每回合首杀：round.ts `endRound` 前记录本回合第一个 playerKilled 的 attackerId——埋点放 weapon.ts 击杀处，检查 `state.round` 内是否已有人死过，需新增 `round.killedThisRound: number[]` 或在 PlayerEntity 加 `killedThisRound` 计数于 enterFreeze 重置）。
2. 伤害累计埋点：weapon.ts 命中处理处（`hit` 事件发射点附近）`attacker.damage += dmg`（victim 死亡时全量伤害以剩余 HP 封顶）。
3. 新建 `src/ui/matchend.ts`：全屏面板：胜负大字 / MVP（分数 = kills*2 + damage/100） / 双方表（名字 阵营 K/D 伤害 爆头率 首杀） / 按钮「再来一局」「回主菜单」（#1 reload 方案）。触发点：main.ts frame() 检测 `r.phase === 'matchEnd'` 且未显示过。
4. 复用 scoreboard 的表构建逻辑（抽公共函数或复制，优先抽 `src/ui/table.ts`）。
**验收**：单测：构造 16 胜 state 断言统计字段正确累计（扩 round.test.ts 或 combat.test.ts）；手动：打完一局显示完整数据、两按钮可用。
**坑**：matchEnd 后 stepLogic 仍每 tick 执行（updateRound 直接 return），面板显示逻辑要幂等（显示过标志位）。

### #5 Kill feed 击杀播报 [S]
**现状**：无击杀播报。`playerKilled` 事件已有（victimId/attackerId/weaponId），但无爆头信息。
**实现要点**：
1. eventbus.ts `playerKilled` 类型加 `headshot: boolean`；weapon.ts 击杀发射处传入 `part === 'head'`。
2. 新建 `src/ui/killfeed.ts`：右上角容器，`feed(victim, attacker, weaponId, headshot)` 追加一行：攻击者名（阵营色）→ 武器名（`WEAPONS[weaponId].name`）→ 受害者名，爆头加 `[HS]` 标记；5s 淡出（CSS transition），上限 5 条（超出移除最旧）。
3. main.ts 消费：`events.on('playerKilled', ...)` + `bombExploded`（"C4 爆炸"）/`bombDefused`（"C4 被拆除"）。
4. 玩家名：本地玩家 'YOU'（state.ts:172），bot 名 `T-1`/`CT-1`（#24 会换真名，feed 直接读 `p.name` 不用改）。
**验收**：手动：枪杀/雷杀/烧杀/C4/拆包均有播报且武器名正确；爆头有标记；5s 后消失。

### #6 加载屏 + 资源进度 [S]
**现状**：`init()`（main.ts:393-429）异步加载 PNG 贴图、decal 贴图、soldier.glb，期间黑屏（rAF 未启动）。
**实现要点**：
1. index.html 加 `#loading` overlay（LOGO + 进度条 + 状态文字行）。
2. main.ts init() 内逐步报进度：贴图张数/总数 → decal → 人物模型；每步更新进度条宽度。loadImageTextures 内部是 Promise.all——拆成逐项 `.then` 计数，或在外层包 `Promise.allSettled` 逐个 await。
3. 加载失败降级提示（如 soldier.glb 失败回退 character.glb 时状态行写「人物模型降级」）。
4. 完成 → 淡出 loading → 显示主菜单(#1)。
**验收**：手动冷刷新可见进度推进；`npm run build` 后 dist 打开同样有效。

### #7 键位引导 [S]
**现状**：`#lock-hint`（index.html）有键位文案但过时（写着"M6"），且只在未锁定时显示，无教程属性。
**实现要点**：
1. 抽 `src/ui/keyguide.ts`：键位表组件（主菜单「操作说明」与对局内首次提示共用数据源：`const KEYBINDS = [{keys:'W A S D', act:'移动'}, …]`——列表以 input.ts 实际绑定为准）。
2. 对局首次进入：lock-hint 处显示引导 overlay，`localStorage.sp_guide_seen` 标记后不再自动弹（Esc 可关）。
3. 更新 lock-hint 文案（删除 M6 字样）。
**验收**：手动：首次进入显示、关闭后刷新不再弹；主菜单可再看。

---

## P1 手感与规则补全

### #17 C4 掉落拾取（真缺口，最优先） [S]
**现状**：携包者死亡置 `c4.state='dropped'` + `carrierId=null`（weapon.ts:242-244 与 grenade.ts:137-139 两处），`c4.position` 停在死亡瞬间位置（carried 阶段每 tick 同步，round.ts:107-112）。**全代码无任何拾取逻辑**——C4 掉了永远躺地上，T 无法再安放，回合只能靠超时/团灭结束。
**实现要点**：
1. round.ts `updateRound` 的 live 段加拾取块：`c4.state === 'dropped'` 时遍历 T 方存活玩家，`dist2D(p.position, c4.position) <= 40 && |p.y - c4.position.y| < 60` → `c4.state='carried'; c4.carrierId=p.id`，发事件（eventbus 加 `{type:'c4PickedUp'; playerId:number}`）。
2. HUD（hud.ts roundLine）加 dropped 状态显示：`C4:掉落`（雷达已画 dropped 图标，radar.ts:48 无需动）。
3. kill feed 类提示可选：`c4PickedUp` 事件 → roundmsg 短暂显示「XX 拾取了 C4」。
4. 单测（round.test.ts）：携包者死→另一 T 走近→carrierId 变更→可正常安放；CT 走近不拾取。
**验收**：`npx vitest run` 绿；手动：打死携包 bot → 走过去捡起 → 安放成功。
**坑**：enterFreeze 重置 c4 时 carrierId=0（本地玩家）——拾取逻辑与新 bot 数量配置兼容（遍历而非固定 id）。

### #18 护甲购买（真缺口） [S]
**现状**：护甲体系「只差最后一公里」：`p.armor` 字段存在、`shotDamage`（weapon.ts:37-49）护甲减伤公式就绪（`part !== 'head' && armor > 0` 时 `d *= 1 - 0.5*(1-armorPenetration)`）、round.ts:43 每回合重置 armor=0、HUD 无护甲显示。全代码没有任何设置 armor>0 的路径，也没有头盔概念（爆头不受护甲减伤）。
**实现要点**：
1. economy.ts：`GEAR_PRICES` 加 `kevlar: 650, kevlarHelmet: 1000`；`buyItem` 加分支（照抄 kit 模式）：`kevlar` → `p.armor = 100`；`kevlarHelmet` → `p.armor = 100; p.helmet = true`。Money 不足 return false；已穿甲重复购买允许补满（按 CS 习惯，半价规则可不做，写注释说明简化）。
2. state.ts PlayerEntity 加 `helmet: boolean`（默认 false，enterFreeze 重置）。
3. weapon.ts `shotDamage` 头盔减伤：`part === 'head' && helmet` 时同样套用 armorPenetration 减伤（保留 head 4 倍率在先的顺序：`d = base * 4`，再 `if (helmet) d *= 1 - 0.5*(1-pen)`）。函数签名需加 helmet 参数或改传 victim——**改签名会动 combat.test.ts，同步更新测试**。
4. buymenu.ts 装备区加两行（与 kit 同模式，`owned` 判定 armor>=100）。
5. HUD：`#weapon` 行或 status 加 `AP ${armor}`；头盔加标记。
6. resetEquipment：败方清 armor/helmet，胜方保留剩余值（现状 armor 每回合清零，保持不动也行——按 CS 规则胜方保留，这里二选一并写注释；建议先做「每回合清零重买」的简化版）。
7. 单测（combat.test.ts）：买甲后身体减伤、头盔爆头减伤、无甲爆头全伤。
**验收**：`npx vitest run` 绿；手动：买甲后挨打明显少掉血，HUD 显示护甲值。

### #8 ADS / 开镜 [M]
**现状**：无右键瞄准。狙击枪（awp/ssg08）与步枪同散布逻辑（weapon.ts `spreadDegrees`），无开镜价值。input.ts 鼠标只处理左键。renderer 无运行时 setFov。
**实现要点**：
1. weapons.ts WeaponDef 加 `zoom?: { fovs: number[]; sensScale: number }`：awp `{fovs:[40,15], sensScale:0.3}`、ssg08 `{fovs:[30], sensScale:0.5}`。其余枪不加（无开镜）。
2. input.ts：`onMouseDown/Up` 加 `button === 2` 处理（`aimHeld` 内部标志），`InputFrame` 加 `aimHeld: boolean`；canvas 监听 `contextmenu` → `preventDefault()`（attach() 里加）。
3. weapon.ts `spreadDegrees` 加开镜分支：无 zoom 武器不受 aimHeld 影响；狙击枪未开镜散布 `stand + 8°`（巨惩罚，对标 CS noscope），开镜用 stand 值。
4. main.ts：frame() 内按本地玩家当前武器 zoom 状态算目标 fov（未开镜=SETTINGS.fov，开镜=fovs[stage]），每帧向目标值 lerp（约 8t/s），调 `renderer.setFov(curFov)`（#3 加的 API）。开镜段位切换：再按一次右键升倍镜（内部 stage 计数，松开归零）。
5. 视图模型：开镜时 viewmodel.hide()（AWP 风格整枪下沉隐藏），退出恢复。
6. 镜内 UI：index.html 加 `#scope` overlay（全屏黑边+十字线 DOM，CSS radial-gradient 实现），开镜时显示；未开镜隐藏。
7. 移动惩罚：开镜时移动速度 ×0.4（movement.ts 读本地玩家 aimHeld——通过 `p.input.aimHeld` 已可达）。
8. 灵敏度：开镜时 `mouseSens × sensScale`（movement.ts:25 处按 zoom 状态缩放）。
9. 单测（weapon.test.ts）：noscope 散布 > 开镜散布；aimHeld 不影响无 zoom 武器。
**验收**：`npx vitest run` 绿；手动：AWP 右键开镜 FOV 平滑变化、镜 UI 出现、noscope 打不中、开镜精准；切枪自动退镜（updateWeaponSystem 里 activeSlot 变化时清 aimHeld）。
**坑**：狙击开镜时鼠标灵敏度缩放要同时作用于 movement 的 yaw/pitch 两处（25-26 行同一系数）；`spreadDegrees` 是 bot 交战共享函数——bot 狙击行为会连带变化，跑 bot.test.ts 确认无回归。

### #9 动态准星 [S]
**现状**：`#crosshair` 是 22px 静态 CSS 渐变十字（index.html），hud.ts 只控制显隐。`spreadDegrees(p, def)`（weapon.ts:309）已是现成散布计算（站/走/跳/连射 burstGrow 全覆盖）。
**实现要点**：
1. index.html 准星重构：改为 4 条臂的 div 结构（上下左右各一条绝对定位条），间距由 CSS 变量 `--gap` 控制，颜色 `--color`。
2. hud.ts update() 每帧：`const def = WEAPONS[activeWeapon(p)?.defId ?? 'knife']; const deg = spreadDegrees(p, def)` → `gap = 6 + deg * 6`（换算系数进 CONFIG：`crosshairGapPerDeg`）→ 设置 CSS 变量。125ms 节流（现有 lastTextUpdate）改为每帧更新准星（纯 style 写入无 reparse 压力）。
3. #3 Settings 接入：style（cross/dot/circle：切 DOM 子集显隐）、color、gapScale。
4. 开镜时准星隐藏（#8 联动，镜内十字由 #scope 提供）。
**验收**：手动：跑动准星明显大于站定；连射逐渐扩大；停火回缩；改设置颜色/样式生效。
**坑**：knife 无散布（spread 全 0），gap 取最小值即可，别除零。

### #10 受击方向指示 [S]
**现状**：`#dmg` 全屏红色内阴影，`hit` 事件 `victimId===0` 时白闪 220ms（main.ts:161-163），无方向信息。
**实现要点**：
1. eventbus `hit` 类型加 `attackerPosition: {x,y,z}`（weapon.ts 发射处从 attacker 读，一处改动）。
2. main.ts：victimId===0 时算攻击者相对方位角：`const ang = Math.atan2(ax - px, az - pz)` 与 `p.yaw` 求差 → 归一 [-π, π]，0=正前。
3. index.html 加 `#dmgdir`（屏幕中心环绕的红色弧，SVG 弧或 CSS conic-gradient 扇形），按角度 rotate；多来源：允许同屏 2 个弧（池化 2 个 DOM）。
4. 200ms 淡出，与现有 #dmg 白闪叠加并存。
**验收**：手动：正面/背后/左右侧被打时弧出现在对应方位（背后=屏幕下方）。

### #11 屏幕震动 [S]
**现状**：无震动。相机 pose 每帧在 main.ts setCamera 处组装（带 alpha 插值）。
**实现要点**：
1. main.ts 加震动状态：`shake = { until: 0, amp: 0 }`；触发点：`grenadeExploded` 与 `bombExploded` 事件按距离算 `amp = clamp(1 - dist/800) * 3`（单位：度）。
2. frame() 组装 camera pose 时叠加衰减随机偏移：`amp * (1 - t) * (noise)`，t 为剩余时间比例；用 rng 或 Math.random 均可（渲染层，不进逻辑 tick）。
3. SETTINGS 加 `screenShake: boolean`（默认 true），false 时 amp=0。
**验收**：手动：贴脸 HE 震感明显、远雷无感；关设置后无震动。

### #12 低血量反馈 [S]
**现状**：HP<30 无任何提示；`#dmg` 只在受击瞬间闪。
**实现要点**：
1. audio.ts 加 `heartbeat(intensity: number)`：60-90Hz sine 双跳循环（复用 tone()），由 main.ts 每帧按血量驱动节拍（<30 启动、间隔 800ms；<15 间隔 500ms 音量增）。
2. `#dmg` 加常驻低透明模式：hp<30 时 `opacity` 底 0.25（受击闪在之上叠加）。
3. 濒死渐晕可用 `#dmg` 的 box-shadow 扩散半径随 HP 插值。
**验收**：手动：残血红晕+心跳、脱险消失；不遮挡交战视野。

### #13 曳光弹 tracer [S]
**现状**：子弹无轨迹表现，只有命中 decal。粒子池模式参考 particles.ts（Shell 池：固定数组 + active/until + 每帧 update）。
**实现要点**：
1. 新建 `src/game/particles.ts` 内 Tracer 池（或独立 tracer.ts）：`{from: Vec3, to: Vec3, until}`，容量 32。
2. renderer.ts 加 `addTracer(id, from, to)`: THREE.Line（BufferGeometry 两点，LineBasicMaterial 透明 additive）；`updateTracer(id, x1..z2, visible)`；池化 32 条（照 addDynamicSphere 模式）。
3. 数据源：`shot` 事件有 shooterId（起点=players[shooterId] 眼位+前向 24u，参考 main.ts:146-147 枪口计算），落点用同 tick 的 `surfaceHit`（shooterId+point）或 `hit`（victim 位置）——main.ts 里按 shooterId 配对（缓存最近 shot，收到落点事件时生成 tracer）。
4. 每第 3 发生成一条（狙击枪每发），寿命 60ms 淡出。
**验收**：手动：交火可见曳光、能判断火力来向；`npx vitest run` 绿（particles.test.ts 补池复用用例）。

### #14 击杀奖励浮动提示 [S]
**现状**：击杀入账只有钱数变化（HUD 顶部 `$` 数字跳），无即时反馈。
**实现要点**：
1. main.ts 消费 `playerKilled`：attackerId===0 时读 `WEAPONS[e.weaponId].killReward`。
2. index.html 加 `#killreward`（准星右下方浮动文字），CSS 动画（上浮+淡出 800ms），连续击杀重置动画。
3. 爆头时附加红色 `[HS]`（与 #5 的 headshot 字段联动）。
**验收**：手动：击杀显示 `+$300` 等正确金额（对照 weapons 表 killReward）；刀杀 $1500。

### #15 死亡观战视角 [M]
**现状**：本地玩家死亡后相机停在尸体原地（frame() 仍用 players[0] 位置），到回合结束无任何视角变化。
**实现要点**：
1. main.ts frame()：`!p.alive` 且 phase 为 live/bombPlanted 时进入观战：选目标 `spectTarget = 存活队友[cycleIdx]`（队内存活列表轮换，左键点击或按空格切换——输入经 pointerlock 仍在，用 fireQueued 边沿切换即可）。
2. 相机 pose 改用目标玩家 position（脚底+eyeHeight）/yaw/pitch（bot 的 yaw/pitch 每 tick 在更新，直接可用；插值同本地玩家）。
3. HUD：`#roundmsg` 位置显示「观战中：XX」（绿/蓝名字）；无存活队友 → 自由飞模式（复用移动系统代价大，简化为固定俯瞰包点/地图中心相机，标注 V1 简化）。
4. freeze/roundEnd 阶段自动切回本地玩家出生视角（现有逻辑）。
5. viewmodel.hide() 已处理死亡（main.ts:334-336），观战时不显示任何枪模。
**验收**：手动：死亡后跟随队友视角可转动（bot yaw 在动）、空格切换目标、回合结束回正常。
**坑**：观战目标的 `blindUntil`/死亡帧与本地玩家共享 HUD——HUD 血量条显示观战者血量需标注来源，避免误读。

### #16 爆头血雾 + 血迹 decal [S]
**现状**：命中无血表现。decal 池已有三个（bullet/scorch/shot，main.ts:417-425），粒子池模式成熟。
**实现要点**：
1. 血雾：particles.ts 加 BloodBurst 池（16 个，红色 dynamicSphere，半径 4→10 扩散 + 300ms 消失）；触发：`hit` 事件（main.ts 消费处）按 part 决定半径（head 大）。
2. 血迹：命中人体且该 hit 最终致死（或每次命中）时，在受害者脚下地面投影 spawn 血渍 decal——复用 `surfaceBelow()`（main.ts:99）找地面 + 新池 `decal_blood.png`（imggen 生成或 canvas 程序化暗红斑）。
3. roundEnd 时 clearDecals 与现有三池一起清。
**验收**：手动：命中出现血雾、击杀地面留血渍、回合切换清理；`npm run build` 无报错。

---

## P2 Bot 智能

### #19 Bot 难度分级 [M]
**现状**：全体 bot 一套固定参数，散落位置（改全在这几处）：
- 感知距离 480：bot.ts:274 `const range = 480`
- 视野半角（前向点积 >-0.34 ≈ 100°）：bot.ts:292
- 反应窗口 200+rng*200ms：bot.ts:298
- 瞄准误差 `sigma0 = 0.02 + 0.00012*dist`：bot.ts:142-143
- 收敛时间常数：CONFIG.botAimTauTicks=192（config.ts:63）
- 交战走位周期 32 tick：bot.ts:165
- 开火距离：CONFIG.botHoldFireRange=350（config.ts:62）
**实现要点**：
1. config.ts 加难度表（10 档，按 CS 递进感）：
   ```ts
   BOT_DIFFICULTY: [{ reactionMs:[500,700], sigma0Mul: 2.0, tauMul: 1.6, viewRange: 320, strafePeriod: 64 }, ... ] as const
   ```
   档位影响维度：反应窗口上下限、sigma0 乘数、tau 乘数、视距、走位频率；默认 5 档 = 现值（保证回归基线不变）。
2. `MatchConfig.difficulty`（#1）→ `createBotContext(state, sites, difficulty)` → brains 或 ctx 存 `profile`；bot.ts 全部硬编码位置改读 profile。
3. 单测（bot.test.ts）：难度 1 与 10 的感知距离/反应窗口取值断言；默认档位与现值一致（回归保护）。
**验收**：`npx vitest run` 绿；手动：难度 1 明显好打、难度 10 有压迫感。

### #20 Bot 购买与投掷闪光弹 [S]
**现状**：buymenu 玩家可买 flash（grenades[1]），但 botEconomy（bot.ts:342-370）从不买；投掷逻辑只有 T 的 he（184-188）与 CT 的 smoke（191-199）。flash 对 bot 全程零使用。
**实现要点**：
1. botEconomy：T 无 flash 且 money>=300 时买 1 颗（进攻包）；CT 买点防守 flash（低优先级，钱多才买）。
2. bot.ts 交战前预投：`perceiveEnemy` 首次发现目标（`brain.perceivedId` 变化）且 dist<500 且有 flash 且 `tick >= brain.nextThrowTick` → 向目标方向 `throwGrenade(state, p, 'flash', origin, dir, events)`（参考 he 投掷，dir 加 0.2 仰角让弹飞更远）；`brain.nextThrowTick` 复用现有冷却（8000ms）。
3. 投掷后立即切回主武器（activeSlot 复位），别让 bot 空手冲锋。
4. 单测（bot.test.ts）：构造有 flash 的 T bot + 可见敌人 → tick 推进后 grenades[1] 耗尽且 state.grenades 出现 flash 弹体。
**验收**：单测绿；手动：对局中 bot 闪光弹致盲自己/敌人可复现；被闪 bot 停火（blindUntil 逻辑已有，bot.ts:132 已读）。

### #21 Bot 投掷燃烧瓶 [S]
**现状**：CT bot 会买 molotov（botEconomy:367，grenades[3]）但投掷代码不存在——买了背一辈子。T 同样不扔。
**实现要点**：
1. CT 守点投掷：`assignObjectives` 后 bot 到达 objective 进入 idle 时，若 grenades[3] 有货且未扔过（brain 加 `moloThrown: boolean`）→ 向「守点前方通道」投：方向 = objective 朝敌方出生方向（复用 idleYaw：`dir = v3(sin(idleYaw+π), 0.1, cos(idleYaw+π))`），落点约 200-300u 外。
2. T 拖延投掷：T 已下包（bombPlanted）且敌 CT 接近 c4 <400u 时向包点投。
3. 冷却与去重：`brain.nextThrowTick` + 每回合限 1 颗。
4. 单测：构造 CT bot 到达守点 → 推进 tick → burns 出现燃烧区。
**验收**：单测绿；手动：CT bot 守 B 点烧地的行为可观察到。

### #22 Bot 战术节奏 [M]
**现状**：每回合固定目标分配 `assignObjectives`（bot.ts:307-339）：T 按 `i%3` 攻点（2/3 打 A、1/3 打 B），CT 固定 2A/2B/1 中路。节奏永远一样。
**实现要点**：
1. `brain` 加 `waitUntilTick`（freeze 结束后延迟出发）。
2. 回合初 `rng` 抽战术（T）：
   - `rush`：全队同一 site，直接冲；
   - `default`：现分配；
   - `slow`：waitUntilTick = live 开始 + 3-8s 随机，分批走；
   - `lurk`：1 人绕 opposite 路线（objective 换成另一侧迂回点）。
3. CT 对应：`aggro`（1 人前压中路）/`stack`（3 人堆一 site，仅连败局）/`default`。
4. 战术权重：rush/slow/lurk 各 ~30%，连败≥3 时 stack 概率升。
5. 单测：固定 rng 种子断言目标分配符合战术意图（assignObjectives 可测试性：抽出 `pickTactic(rng, streak): Tactic` 纯函数）。
**验收**：单测绿；手动连打 10 回合可观察到至少 3 种节奏（bot 到点时间分布明显不同）。
**坑**：waitUntilTick 期间 bot 别罚站门口堵路——等待点用出生区。

### #23 无线电播报 [S]
**现状**：无战场播报。关键事件（下包/拆包/发现敌人）只有音效。
**实现要点**：
1. eventbus 加 `{type:'radio'; team:'T'|'CT'; key: RadioKey; playerId:number}`，RadioKey 枚举：`bombPlanted/bombDefused/enemySpotted/needBackup/flashOut/niceShot`。
2. 触发点（bot.ts/round.ts 已有逻辑处 emit）：bombPlanted/bombDefused 事件处理处；perceiveEnemy 首次发现（reactionUntil 设置时，限频 10s/人）；本队存活 ≤2 时随机 needBackup。
3. UI：hud.ts 加 radio 条（屏幕左下，队色文字 + 说话人名），3s 消失，队列最多 2 条。
4. 音效：audio.ts 加 `radioBeep()`（两声短 beep，收音机感：方波 1200/900Hz）。
**验收**：手动：下包后本队 HUD 出现播报；敌方事件不播给我听。

### #24 Bot 名字系统 [S]
**现状**：bot 名 `T-1`…`CT-5`（state.ts:174-178 createGameState 硬编码）。
**实现要点**：
1. state.ts 加 `BOT_NAMES: string[]`（CS 风格名单 10+ 个，如 ['Blaze','Havoc','Viper','Falcon','Dagger','Ghost','Storm','Reaper','Cobra','Wolf']）。
2. createGameState 加 options.namePool 或直接按序取名（名字去重：截取池前 N 个）；本地玩家名从 MatchConfig 读（#1 顺带做玩家名输入框，默认 'YOU'）。
3. 记分板/killfeed/radar 名牌读 `p.name` 自动生效（radar 名牌若太挤可缩写首 4 字符）。
**验收**：手动：记分板与击杀播报显示名单名字，无重复。

### #25 残局逻辑 [M]
**现状**：残局（1vX）行为与常规相同（T 攻点、CT 守点），无特殊决策。
**实现要点**：
1. bot.ts 每回合检测本队存活数（死亡事件驱动或每 tick 低频检查——用 `playerKilled` 事件更新 `ctx.aliveCount` 缓存）。
2. CT 1vX 且已下包：强制 objective=c4 位置（现有 planted 分支已做），补充：拆除优先于交战——交战中若 c4 剩余 <15s，脱离交火跑包点（objective 重置 + path=null）。
3. T 保枪：bombPlanted 无、live 末段（剩余 <20s）且本回合无法下包（c4 不在自己或队友手里）→ objective 改为远离 CT 的逃逸点（自家出生区），idle 等超时。
4. 1v1：感知距离与反应窗口放宽 20%（残局架枪更稳）。
5. 单测：构造 1v2 已下包残局 → tick 推进 → CT bot 移向 c4。
**验收**：单测绿；手动：可观察到「时间不足放弃进攻转保枪」。

### #26 加时赛 MR3 [S]
**现状**：先到 16 胜（config winRounds=16），roundNumber 无上限。30 回合 15:15 后继续打「金回合」（31 回合有人到 16 即结束），无 CS 式加时概念。半场换边固定 `roundNumber % 15 === 0`（round.ts:72）。
**实现要点**：
1. RoundState 加 `overtime: number`（第几节加时，0=常规）。
2. round.ts `endRound`：常规时间 15:15（roundNumber==30 且 16:15 未达成）→ 进入 overtime=1；加时节内每 3 回合换边（`overtime > 0` 时换边条件改 `roundNumber % 3 === 0`——注意与 halftime 逻辑共用，抽函数）。
3. 胜利条件：`score[winner] >= 16 + overtime * 3` 且非平局节末；节末 3:3 平 → overtime++ 继续下一节。
4. HUD roundLine 加时显示「OT1」；结算屏（#4）显示加时标记。
5. 单测（round.test.ts）：构造 15:15 → 断言进入 overtime、换边正确、19:15 结束。
**验收**：单测绿；手动打满 30 回合进加时（可用 CONFIG 临时缩短回合调试）。

### #27 丢弃装备 [S]
**现状**：G 键无功能；掉落物系统只有 C4（#17 拾取框架可复用其 position/碰撞思路）。
**实现要点**：
1. input.ts：KeyG 边沿 → `InputFrame.dropQueued`（照抄 buyQueued 模式，含 tick 级累积）。
2. state.ts 加掉落物：`state.droppedWeapons: { id: number; defId: string; position: Vec3; ammoMag: number; ammoReserve: number }[]` + `nextDropId`。
3. weapon.ts 或新 `src/game/systems/drops.ts`：
   - 丢弃：主/副武器任一在持时按 G → 对应槽清空（primary 或 secondary），生成 drop（位置=玩家脚下前方）；
   - C4 丢弃：carrierId===0 且按 G → `c4.state='dropped'`（与 #17 拾取互通）；
   - 拾取：live 阶段每 tick 检查玩家脚下 40u 内 drop → 空槽自动拾取（primary 有货则不捡主武器）；CT 可捡 T 的枪（CS 允许）。
4. 渲染：main.ts ensureDyn 扩展 `d:${id}` dynamicBox（小箱模型按武器染色），消失隐藏（照 grenades 模式 main.ts:243-270）。
5. 回合结束清空 droppedWeapons（enterFreeze）。
6. 单测（新 drops.test.ts 或挂 weapon.test.ts）：丢→捡流程、槽位满不捡、回合重置清场。
**验收**：单测绿；手动：G 丢枪换手枪、走过去捡回、C4 可传包。

---

## P3 内容量

### #28 第二张地图 + 地图选择 [L]
**现状**：仅 de_sahara（`matchLevel()` 无参）。地图方法论已沉淀为 skill：`.opencode/skills/map-build-craft/SKILL.md`（必读，含 Brush 体系/净空规则/贴图管线/回归测试）。
**实现要点**：
1. 新建 `src/game/map/<新图名>.ts`：导出 `build(): LevelDef`（对照 match.ts 结构：spawns/sites/brushes）。骨架建议巷战/连廊型（结构差异于沙漠图：双纵轴 + 中路横连），尺寸 3600-4200u 级。
2. match.ts 改注册表：`const MAPS: Record<string, () => LevelDef>`，`matchLevel(mapId?: string)`。
3. 贴图：复用现有 10 材质优先；需新材质走 imggen（`node tools/imggen/gen.mjs`）+ textures.ts **双登记**（buildTextures + loadImageTextures，0.2 节坑）。
4. main.ts/MatchConfig：mapId 进配置，主菜单下拉选择（附小图预览：用 navmesh 俯视截帧或简化色块图，V1 可无预览）。
5. 测试：routes.test.ts 参数化跑每张图（现有断言按图适配：T→B 上洞等路由断言是 de_sahara 专属，新图写自己的路由断言）；navmesh.test.ts 连通性断言对新图同样跑。
**验收**：`npx vitest run` 全绿（含新图路由）；手动：菜单选图进对局，bot 攻防正常；截图验收新图观感。
**坑**：净空规则（门洞 ≥150u 顶棚、通道 ≥120u 宽、台阶 ≤32u）不满足会导致 bot 不过点——routes 测试会暴露，逐个修 brush。

### #29 全武器 GLB 化 [M]
**现状**：仅 M4 有 GLB（main.ts:398 `viewmodel.upgradeWithGLB('rifle', '/models/m4.glb', 38, -0.28)`），其余 9 把枪是程序化盒子拼装。
**实现要点**：
1. viewmodel.ts：`upgradeWithGLB` 现按 category 键控，同 category 多武器（glock/deagle 同 pistol）会覆盖——改为 `upgradeWithGLBById(defId, url, targetLen, zShift)`（内部 model key 用 defId），保留旧 API 兼容或直接迁移 main.ts 调用点。
2. 模型来源（CC0/开源许可，逐把确认 license）：Kenney blaster kit（CC0）、Quaternius（CC0）、three.js examples。下载 → `/tmp/opencode/gltftrim/` 管线压缩（skill `character-asset-pipeline` 的压缩流程同适用）→ `public/models/<枪名>.glb`（每把目标 <300KB）。
3. main.ts init 逐把 `upgradeWithGLBById('deagle', '/models/deagle.glb', 20, -0.2)` 失败静默回退程序化模型（现有 try/catch 模式）。
4. 每把验证 `getMuzzle()` 返回枪口位置（曳光 #13 依赖）。
**验收**：手动逐把切换 1-7 槽位观感正常、无加载卡顿（预加载不阻塞进入）、枪口位置大致正确；license 记录进 commit message。
**坑**：GLB 尺寸/朝向各异，`targetLen/zShift` 需逐把目测调参（现有 m4 调参过程：38/-0.28）；沙箱截图可验（viewmodel 非 skinned）。

### #30 第二人物模型 / 阵营差异化 [M]
**现状**：双方共用 Soldier.glb（Vanguard）+ mannequin 染色区分（T 橙/CT 蓝）。管线 skill：`.opencode/skills/character-asset-pipeline/SKILL.md`（必读：压缩/染色/骨骼归一/验收全流程）。
**实现要点**：
1. 选型：再找一个剪影差异明显的开源 skinned GLB（CT 用护甲厚重型 / T 用轻装型；three.js examples / Mixamo 导出 CC 授权）。数量与动画要求同 skill 标准（idle/run 必需）。
2. renderer.ts `loadCharacterModel` 现单 template 全员克隆——扩展为按 team 双 template：`loadCharacterModels({T: url, CT: url})` 或两次调用存 `templates[team]`；`addSkinnedHumanoid` 按 p.team 选。
3. 染色体系保留：CHAR_TINTS 阵营色不变（mannequin 身体纯色是远距阵营可读性的关键，skill 里有说明）。
4. 骨骼归一：两模型各自按骨骼极端点算 charScale（skill 3.x 节，禁用 bbox）。
**验收**：数值断言（两模型站立均 ≈140u）；`npx vitest run` 绿；**视觉验收交用户真实浏览器**（沙箱渲染不出蒙皮——0.2 节环境坑）。

### #31 死亡动画 / Ragdoll [M]
**现状**：`renderer.updateHumanoid(id, x, y, z, yaw, alive, flash, moving)`（renderer.ts:501）alive=false 时模型处理方式以实际代码为准（隐藏或定格），无倒地动画。Soldier.glb 动画只有 Idle/Run/Walk（TPose 已裁剪），无 death clip。
**实现要点**（两方案，先 A 后评估）：
- **方案 A 倒地表现（推荐先行）**：renderer.ts 死亡时对 humanoid group 做插值动画：pitch 0→90°（向前倒）+ 沉降至地面 + 轻微随机偏航，600ms ease-in；尸体保留至 enterFreeze（main.ts refreshDynamic 已每帧刷，加 alive 分支持续应用倒地姿态即可）。
- **方案 B 换带 death 动画的模型**：skill 管线支持动画候选名匹配（`pick(...candidates)`），death 缺失自动降级隐藏——找到含 Death01 类 clip 的开源模型时按 #30 流程替换。
**验收**：方案 A：手动死亡倒地无穿模（重点：死在墙边/楼梯）；方案 B：死亡动画触发正确。
**坑**：倒地方向与死前 yaw 对齐，别做全向翻滚；雷达/命中判定与尸体无关（死者已出 teamPlayers alive 过滤），纯渲染层改动。

### #32 烟雾/火焰粒子化 [M]
**现状**：烟雾=半透明盒（main.ts:235 `addDynamicBox(key, r*2, 90, r*2, 0x9fb4c4, 0.45)`），燃烧=贴地橙色薄盒（240 行）。
**实现要点**：
1. renderer.ts 加粒子云 API：`addParticleCloud(id, count, color, size)` + `updateParticleCloud(id, center, visible)`——内部 THREE.Points（随机球面分布 offset 固定，center 移动整体跟随；简单不追求流体感）。
2. main.ts ensureDyn：`sm:` 键改用粒子云（count≈40，低画质档减半——#38 联动），`fn:` 改火焰双层（橙黄两点云错相位）。
3. 性能预算：全场同屏 ≤6 团烟 + 4 团火（state 生成节流已有），粒子总量 ≤1000。
**验收**：手动：烟视觉有体积感、火有跳动；低配档（#38）减半后帧率稳定；`npx vitest run` 绿（grenade.test.ts 不受渲染影响）。

### #33 天空盒与氛围 [S]
**现状**：纯色 `scene.background = skyColor`（0x8fb8d8）+ 线性雾（configure）。
**实现要点**：
1. renderer.ts configure 扩展：程序化渐变天穹——大球 SphereGeometry BackSide + 顶点色渐变（天顶深蓝→地平线暖白）或 ShaderMaterial 简单 mix；雾色与地平线色一致（防穿帮）。
2. 远景剪影：地图外围 2-4 面 simple plane（远山/城市轮廓，顶点色深灰，不受雾影响或半透明）。
3. 太阳：Billboard 亮斑（sprite，方向固定）。
**验收**：手动：地平线有层次、雾色衔接自然；沙箱截图验收可行（非 skinned）。

### #34 环境音与 BGM [S]
**现状**：音效全事件驱动，无环境底噪无音乐。audio.ts master.gain 单轨（#3 会拆 sfx 轨）。
**实现要点**：
1. audio.ts 加 `startAmbient()`/`stopAmbient()`：噪声 buffer 循环 lowpass（风声）+ 极低音量随机远处「交火」脉冲（每 8-20s 一次弱 noiseBurst）；对局 live 阶段启动、菜单停止。
2. 主菜单 BGM：程序化 pad 和弦循环（2-3 个 detune 锯齿/三角波 + 慢 LFO 音量），`startMenuMusic()/stopMenuMusic()`，音量走 #3 的 amb 轨（新 GainNode）。
3. 分轨：master/sfx/amb 三个 GainNode 串联，SETTINGS 加 `ambVolume`。
**验收**：手动：对局有底噪不刺耳、菜单有 BGM、进对局 BGM 停；音量三轨独立。

### #35 玻璃破碎 [S]
**现状**：glass 材质有半透明渲染（main.ts:406 opacity 0.45）与脚步/命中音效参数（audio.ts:32），但子弹打玻璃只留弹孔（surfaceHit 走通用逻辑），brush 永不消失。
**实现要点**：
1. state 加 `state.brokenBrushes: number[]`（存 level.brushes 的 index）。
2. weapon.ts surfaceHit 处理：命中 brush material==='glass' → 一次性碎裂（简化，不做血量）或 2 发碎（brush 附带耐久 Map）；碎裂 → index 进 brokenBrushes + 事件 `{type:'glassBreak', x,y,z}`。
3. 生效范围三处过滤（全部按 `brokenBrushes` 集合排除）：
   - collision.ts `prepareLevel`（ solids 构建时排除——**注意 solids 是开局预计算的，需支持重建或在 collideBrushes 查询时跳过**，选后者改动小）；
   - main.ts 渲染（box visible=false）；
   - raycast 调用方（weapon.ts fireWeapon 的 boxes 列表、bot.ts:277 感知 LOS、main.ts:100 surfaceBelow）。
4. 表现：audio.ts 加玻璃碎裂音（高频 noiseBurst + 玻璃 ping，stepParams.glass 已有 ping 参数可参考）；碎片粒子（复用 BloodBurst 池思路换白青色）。
5. 回合重置恢复（enterFreeze 清 brokenBrushes + 渲染恢复）。
6. 单测：碎后弹道可穿透（grenade/weapon 测试扩用例）。
**验收**：单测绿；手动：打碎玻璃后可穿行、音效/粒子到位、回合恢复。
**坑**：de_sahara 玻璃 brush 很少或没有——本任务先做机制，#28 新图大量使用玻璃验证。

### #36 死斗 / 团队死斗模式 [M]
**现状**：仅爆破模式（round.ts 全部逻辑耦合 de 规则：C4/经济/回合）。
**实现要点**：
1. MatchConfig.mode: `'de'|'dm'|'tdm'`；state.round 加 `mode` 字段（round.ts 各分支判断）。
2. round.ts 分支改造：
   - dm/tdm：无 freeze/c4/buy 窗口限制（canBuyNow 恒 true 或开局全配装——简化用后者：固定 m4+deagle+全套雷）；死亡 3s 后随机 spawn 复活（新逻辑：round.ts 检测死亡超时重生，health 满、alive=true）；
   - 胜利条件：dm 个人先 30 杀、tdm 队先 50 杀（进 CONFIG：dmKillTarget/tdmKillTarget）；
   - endRound/enterFreeze 跳过（无回合概念），matchEnd 按 killTarget。
3. HUD：顶部计分改击杀数；雷达敌我显示保持（DM 全员敌对显示红——radar.ts 按 mode 分支）。
4. 出生点保护：复活点避开 300u 内敌人（遍历 spawns 选最远敌点）。
5. 单测：round.test.ts 加 dm 分支用例（击杀达标→matchEnd、死亡复活计时）。
**验收**：单测绿；手动：DM 模式完整可玩、分数/复活正确；主菜单模式选择（#1 配置项）。

### #37 训练场 [M]
**现状**：无。targets 系统（state.targets/`updateTargets`/entities/target.ts，TARGET_PART_LOCAL hitbox 部位判定）可复用——M6 前的打靶遗留系统，当前 state.targets=[] 空跑。
**实现要点**：
1. 新建 `src/game/map/training.ts`：靶场 LevelDef（封闭区域：静靶墙 10 个 target 挂位、移动靶轨道、投掷练习区开阔地、无包点）。
2. 模式挂载：MatchConfig.mapId='training' 时自动 `state.targets` 填充（targetDefs 渲染管线已有，main.ts:46-54 的 targetDefs 机制现成）；移动靶 = targets 加路径速度字段，updateTargets 驱动往返。
3. 训练特性（mode='training' 分支）：无限弹药（fireWeapon 不扣）、金钱锁 16000、击中显示伤害数字（HUD 浮动文字，复用 #14 浮动组件）与部位名（head/chest…）。
4. 投掷轨迹：grenade.ts 飞行时每 tick 记录路径点（上限 200），renderer 画渐隐线（复用 #13 tracer 思路常驻版）。
**验收**：手动：训练场可压枪（部位伤害数字）/甩狙/练投掷落点；`npx vitest run` 绿。

---

## P4 工程与打磨

### #38 画质档位 [M]
**现状**：渲染参数固定：shadow 2048 + extent 2600（main.ts:58 configure）、fog 1400/6000（CONFIG:94-95）、设备像素比未管理、粒子无上限分级。
**实现要点**：
1. renderer.ts `configure` 扩展参数对象：`{sky, fogNear, fogFar, shadowExtent, shadowMapSize, dpr}`；`resize()` 按 dpr 设 `renderer.setPixelRatio`。
2. SETTINGS.quality 三档映射（进 settings.ts 或 config.ts 质量表）：
   - low：阴影关（shadowMap.enabled=false）/fog 1000/4000/dpr=1/粒子云减半（#32）/曳光减半；
   - medium：shadow 1024/extent 2000/dpr=min(1.5, native)；
   - high：现值（shadow 2048/extent 2600/dpr=min(2, native)）。
3. 变更即时生效：settingspanel onChange → renderer 重建阴影参数（shadow.map?.dispose() 后重配，Three.js 标准做法）。
4. main.ts applySettings() 统一入口（#3 的 setFov/音量/画质都走这里）。
**验收**：手动切档：观感/帧率差异明显（swiftshader 沙箱 low 档可跑、high 档蒙皮除外）；`npx vitest run` 绿。

### #39 PWA 离线缓存 [S]
**现状**：无 Service Worker，二次打开仍全量拉资源（soldier.glb 1.06MB + 贴图 + models）。
**实现要点**：
1. 装 `vite-plugin-pwa`（devDependencies），vite.config.ts 配置：`registerType: 'autoUpdate'`，`includeAssets: ['models/*', 'textures/*']`，precache 全 public。
2. manifest：名称 STRIKE PROTOCOL、主题色取 skyColor、图标（可用现有 LOGO 或 canvas 导出 192/512）。
3. 更新提示：`onNeedRefresh` → 简单 toast「新版本可用，刷新生效」。
**验收**：`npm run build` 产物断网二次打开可进对局；Lighthouse PWA 项通过。

### #40 生涯战绩持久化 [S]
**现状**：对局数据关页面即失。
**实现要点**：
1. 新建 `src/game/career.ts`：localStorage key `sp_career_v1`：`{ matches: {date, mapId, mode, result, score:[t,ct], k, d, hs}[] (上限 100 条，FIFO), totals: {games, wins, kills, deaths, hs} }`。
2. 写入点：matchend（#4）显示时保存；matchEnd 阶段一次性写。
3. 展示：主菜单「生涯」页（#1 扩 tab）：总场次/胜率/KD/爆头率 + 最近 10 局表。
**验收**：手动：打两局数据累计正确、刷新保留。

### #41 成就系统 [S]
**现状**：无。
**实现要点**：
1. 新建 `src/game/achievements.ts`：定义表 `[{id, name, desc, test(evt, stats)}]` 首批 12 个：首胜、单局 10 杀、爆头 10 连（跨局累计）、1v5 残局胜（bot 存活数 + 回合胜负判定）、刀杀、HE 三杀、下包后胜利、拆包成功、连败 5 局后赢、AWP 千里之外（击杀距离 >800u，需要 fireWeapon 埋 dist）、防守 10s 拆包、全武器击杀集邮。
2. 事件驱动检查：main.ts 统一消费事件 + roundEnd/matchEnd 快照 stats → 逐成就 test() → 触发 `{type:'achievement', id}`。
3. toast：屏幕下方横幅（复用 killfeed 容器风格）+ audio 提示音。
4. 存档：localStorage `sp_achievements`（id→date），与 #40 分文件。
**验收**：手动触发 2-3 个验证（首胜最易）；只弹一次。

### #42 键位重绑定 + 色盲模式 + i18n [M]
**现状**：键位硬编码在 input.ts（KeyW/Space/R/B/KeyE/Tab/Digit1-7…）；队伍色固定；文案中英混杂（HUD 中英混排、buymenu 中文、roundmsg 英文）。
**实现要点**：
1. 改键：input.ts 建 `DEFAULT_KEYBINDS: Record<Action, string>`（Action 枚举：forward/back/left/right/jump/reload/buy/scoreboard/use/drop/…）；poll() 按 binds 反查；settingspanel 改键 UI（点击监听下一次按键，冲突检测提示）；`InputFrame` 结构不变。
2. 色盲：CHAR_TINTS/mannequin 阵营色改方案表（`TEAM_COLORS: Record<'default'|'deuteranopia', {T, CT}>`，色盲方案 T=橙、CT=青偏白——避开红绿轴）；radar/HUD 队色同源引用。
3. i18n：新建 `src/ui/strings.ts`：`{zh: {...}, en: {...}}` 字典 + `t(key)`；HUD/menu/buymenu/结算屏文案全部换 t()；语言进 SETTINGS（默认 zh）。
**验收**：手动：改键全功能正常（含边沿输入）、冲突被拦截；色盲模式远距可辨阵营；中英切换全 UI 生效；`npx vitest run` 绿（hud.test.ts 文案断言可能要跟着改）。

### #43 错误兜底 UI [S]
**现状**：WebGL 不可用/资源加载失败 → 白屏或裸 console 报错；无全局错误处理。
**实现要点**：
1. main.ts 最前：`canvas.getContext('webgl2')` 判空 → `#fatal` overlay（WebGL2 不可用提示 + 浏览器建议文案），阻止后续 init。
2. `window.addEventListener('error')` + `unhandledrejection` → 非致命错误收集到 `#error-log`（折叠面板，开发友好）；init 阶段 try/catch → 失败显示「加载失败 [原因] + 重试按钮（reload）」。
3. 资源加载失败已有回退链（贴图 canvas 化/模型降级），兜底 UI 只是最后防线。
**验收**：手动制造失败（DevTools 断网刷新）→ 有友好页面；正常路径零打扰。

### #44 对局种子与可复现 [S]
**现状**：`createGameState(..., rngSeed=0x5eed)` 参数存在（state.ts:168），Rng 类（engine/rng.ts）确定性——但种子从不对外暴露、不可指定。
**实现要点**：
1. MatchConfig.seed?: number（#1 表单可选填）；未填时 `Date.now() & 0xffff` 随机，**实际种子写回 `state.rngSeed` 字段**（state 加字段）。
2. HUD 或结算屏显示种子号；主菜单/URL 支持 `?seed=12345` 预填。
3. 复现路径说明（写进本文档）：同种子 + 同玩家输入序列 → bot 行为一致（bot rng 全走 state.rng，已满足；注意 Math.random 出现在渲染层不进逻辑，如 #11 震屏——无影响）。
4. 单测：同种子两次 createGameState + 1000 tick 无输入 → players 位置一致。
**验收**：单测绿；手动：同种子连开两局开局 30s 内 bot 走位一致（肉眼对比雷达）。

---

## 附：执行顺序建议与依赖图

```
#3 设置层 ──┬── #9 动态准星 ── #42 改键/色盲/i18n
            ├── #38 画质档位
            └── #8 ADS（用 setFov）
#1 主菜单 ──┬── #19 难度 ── #22 战术 ── #25 残局
            ├── #28 多图 ── #36 DM ── #37 训练场
            └── #44 种子
#17 C4拾取 ──── #27 丢枪（共用掉落物思路）
#8 ADS ──── #9（准星隐藏联动）
#13 曳光 ──── #32 粒子化 ──── #38（密度分级）
#4 结算屏 ── #40 生涯 ── #41 成就
#31 死亡动画（先方案 A 倒地）── #30 阵营模型（同管线顺路做）
```

**推荐批次**：M2 开工先 #17+#18（规则漏洞）；M1 先 #3（多任务前置）；#8+#9 一起做（准星/开镜手感联动调参）。

**每任务收尾清单**：`npx tsc --noEmit` → `npx vitest run` → `npm run build` → 手动验收（本任务「验收」小节）→ 中文 commit（feat(模块): 描述）→ 更新本文档对应条目状态（标题后追加 ✅ 与日期）。

**状态追踪**：2026-09-22 全部 44 项完成（基线 c4ed893 → 见 git log）
- P0 外壳 #1-#7：✅（主菜单/暂停/结算/击杀播报/小地图开关/设置面板/设置层）
- P1 手感 #8-#18：✅（ADS/动态准星/受击方向/震屏/低血量/曳光/击杀奖励/观战/血雾血迹/C4拾取/护甲）
- P2 Bot #19-#27：✅（难度/闪光/燃烧瓶/战术/无线电/名字/残局/加时/丢枪）
- P3 内容 #28-#37：✅（de_plaza 第二图/武器GLB管线/阵营模型/死亡动画/粒子/天空盒/环境音/玻璃/死斗/训练场）
- P4 打磨 #38-#44：✅（画质档/PWA/生涯/成就/改键i18n色盲/兜底/种子）
- 说明：#29/#30 资产落位为即插即用管线（代码侧完成，CT 第二模型与全武器 GLB 放 public/models 即生效，人物视觉验收需真实浏览器）；测试基线 75→79

**审计与缺陷修复**：2026-09-23 规划书符合性审计（逐项对照 44 项验收标准）+ 修复
- 真实缺陷修复：#12 低血量红晕与受击闪合并单处写入（不再互相覆盖）；#9 动态准星 gapScale 生效（feedback.ts 消费）；#13 曳光节流（新 src/game/tracer.ts：狙击每发/自动每 3 发/单发每发）；#23 无线电补 4 触发点（下包/拆包/投闪/残局+击杀）且按本地阵营过滤；#27 掉落物 3D 渲染（按武器类染色）；#41 成就 12 项全部真实判定（MatchStats 埋点 + 跨局 sp_ach_meta 累计）；#6 加载屏落地（#loading overlay + init 分步进度）
- 审计发现的真 bug：C4/武器丢弃后同 tick 被原地秒捡 → 60 tick 拾取冷却 + 落点前移 12u；无爆点地图（training）bot 站点索引越界崩溃 → sites.length 守卫；击杀负血量 HUD 显示 → weapon.ts 钳制 0；开始对局后主菜单 overlay 常驻遮挡 → onStart hideAll / 回主菜单 showMenu
- 测试基线 79→111（16 文件）：补 #13/#17/#19/#20/#22/#26/#27/#35/#36/#44 等 11 个规划单测点 + 4 条玩家视角对抗用例（脚本化本地玩家下包+近身交火，bot 保留 AI 输入不覆盖）
- headless（swiftshader）走查 7 张截图验收：加载屏/种子预填/训练场靶子+killfeed+radio/丢包丢枪/低血量红晕/bot 交火，pageErrors 0；人物视觉与真实浏览器交互仍需实机确认
