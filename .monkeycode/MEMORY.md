# User Instruction Memory

## Format

### User Instruction Entry
- [用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及场景]
- Instructions:
  - [指令内容]

## Entries

### [行为指令: 全程中文输出]
- Date: 2026-09-17
- Context: 用户明令强制规则
- Instructions:
  - Agent 的思考过程（thinking）与回答（response）必须全部使用中文，这是强制规则，无例外。
  - 代码、文件名、命令、错误日志中的原文除外，解释与表述一律中文。

### [行为指令: 不死磕单点，先做别的再彻底收尾]
- Date: 2026-09-21
- Context: 人物模型集成阶段反复调试视觉发黑问题时，用户明确打断
- Instructions:
  - 用户已指定技术路线（如"开源找人物模型"）后直接照做，不反复死磕单点细节。
  - 遇到卡点时先切到其他任务推进，最后统一彻底完成卡点项。
  - 收尾方式固定为：检修 + 截图验收（多角度实际渲染画面自查），不靠代码推断代替视觉验收。

### [环境限制: 沙箱 swiftshader 无法渲染 skinned mesh]
- Date: 2026-09-21
- Context: 多轮验证（极简场景/游戏 dev/prod/自然 rAF/关 culling/手工 skinned 全失败，绘制调用恒为 0、context 反复 lost）
- Category: 排障 & 调试
- Instructions:
  - 本沙箱用 puppeteer + swiftshader（`--use-gl=swiftshader`）截图时，three.js 的 SkinnedMesh 永远不产生绘制调用（`renderer.info.render` 三角形数恒为 0、skinned program 从不创建、`skeleton.boneTexture` 恒为 NULL）。这是渲染后端限制，**不是代码 bug**。
  - 因此人物（蒙皮）的视觉验收**必须让用户在真实浏览器（真实 GPU）打开** `public/char_preview.html` 或游戏主页确认，不要在沙箱截图里找"人物消失"。
  - 地图（非 skinned 的普通 box mesh）在 swiftshader 下渲染正常，可正常截图验收。
  - 排障时切勿对 skinned mesh 调无参 `skeleton.init()` 或无 bindMatrix 的 `bind()`（会清空 bones/boneInverses/bindMatrix 彻底破坏蒙皮）；context 恢复只需 `skeleton.boneTexture.needsUpdate = true`。

### [资产管线: 人物/贴图/压缩工具位置]
- Date: 2026-09-21
- Context: 引入 three.js Soldier.glb（Vanguard 战士）并压缩、生成沙漠贴图
- Category: 构建方法
- Instructions:
  - 当前人物模型：`public/models/soldier.glb`（three.js 官方 Soldier "Vanguard"，CC 资产，压缩后 1.06MB，动画 Idle/Run/Walk，骨骼归一化后站立≈140u）；回退链 `character.glb`（Quaternius CC0）→色块人形。
  - 无缝贴图生成：`cd /workspace && node tools/imggen/gen.mjs [file...]`（读 `tools/imggen/queue.json`，调 agnes 生图 API，写 `public/textures/{file}.png`，`--force` 重生成）；新贴图需在 `src/engine/textures.ts` 的 `buildTextures` + `loadImageTextures` 登记键。
  - GLB 压缩管线：`/tmp/opencode/gltftrim/`（gltf-transform v4 + sharp + meshoptimizer），模板 `trim_soldier.mjs`、检查 `inspect.mjs`。v4 注意：`io.writeBinary(doc)` 返回 Uint8Array（自己写盘）；禁用 meshopt/quantize（会删 Skin）。
  - 方法论已沉淀为项目 skill：`.opencode/skills/character-asset-pipeline/SKILL.md`、`.opencode/skills/map-build-craft/SKILL.md`。

### [构建基线: 完整化后测试数与 PWA]
- Date: 2026-09-22
- Context: Agent 完成 44 项 backlog 全量开发
- Category: 构建方法
- Instructions:
  - 完整化后测试基线 75 → **79**；2026-09-23 审计缺陷修复 + 补 11 个规划单测点 + 玩家对抗用例后 79 → **111**（`npx vitest run` 全绿为验收线，16 个测试文件）。
  - 已装 `vite-plugin-pwa@0.21`（devDependency）：`npm run build` 会生成 `dist/sw.js`+workbox，precache 46 项（models/textures，上限 4MB 因 character.glb 3.25MB）；dev 模式 PWA 不生效。
  - 地图现为 3 张：`de_sahara`（默认）/`de_plaza`（第二张对战图）/`training`（训练场），注册在 `src/game/map/match.ts` 的 `MAP_BUILDERS`；新增图需在该表登记 + routes.test.ts 加路由回归。

### [环境限制: headless 游戏 tick 速约为墙钟 5–7x]
- Date: 2026-09-23
- Context: 用 puppeteer+swiftshader 走查游戏做截图/事件断言时（rAF 时间戳漂移）
- Category: 排障 & 调试
- Instructions:
  - 沙箱 headless 下 requestAnimationFrame 时间戳漂移，游戏固定 tick（`CONFIG.tickRate`）跑约 5–7x 墙钟速（实测 40ms 墙钟 ≈ 29 tick）。所有"冷却/淡出/倒计时"类时间窗断言或截图时机要按此换算，或直接按 tick 计数（`state.tick`）而非墙钟 sleep。
  - 走查脚本（如 `/tmp/opencode/shots.mjs`）里 `sleep(ms)` 后要留足 7x 余量；拾取冷却等常量（60 tick）在 headless 下 ≈130ms 墙钟即过。
  - `window.__game`（DEV-only）暴露 `state()/tickOnce()/nav/events/renderer/textures/bulletPool/scorchPool/shotPool/input`，可无鼠标驱动走查（`input` 的边沿键 G/R/B 与移动键在 CDP keydown 下生效，但 fireHeld/aimHeld 因无指针锁恒 false）。
