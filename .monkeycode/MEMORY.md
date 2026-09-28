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
  - 当前人物模型：`public/models/character.glb`（Mixamo 全动画 PBR，11 段含 Death01/Hit_Chest 死亡帧，3.25MB，主模型）；回退链 `soldier.glb`（three.js 官方 "Vanguard" CC，仅 Idle/Run/Walk）→色块人形。
  - 人物视觉高度：`CONFIG.charVisualHeight`（=72，必须与 `playerHeight` 一致才"看起来一样高"）→ `loadCharacterModel(url, team, targetHeight)` 归一化。**全游戏标尺 = ~72u 玩家**（48u 箱=玩家 67%、72u 墙=头高可跳越、57u 跳≈玩家 80%）；match.ts 早期注释"玩家 140u"是过时误标尺，已修正。人物 140u 会显 2 倍巨型。
  - 人物材质为 PBR Standard（场景已有 RoomEnvironment PMREM IBL，Standard 不发黑）+ 柔和阵营 tint（CHAR_TINTS）；强识别靠地面阵营光环 + 雷达点色。
  - 无缝贴图生成：`cd /workspace && node tools/imggen/gen.mjs [file...]`（读 `tools/imggen/queue.json`，调 agnes 生图 API，写 `public/textures/{file}.png`，`--force` 重生成）；新贴图需在 `src/engine/textures.ts` 的 `buildTextures` + `loadImageTextures` 登记键；法线贴图键 = `{key}_n`（`loadImageTextures` 自动挂 normalMap，缺失静默回退 albedo）。
  - GLB 压缩管线：`/tmp/opencode/gltftrim/`（gltf-transform v4 + sharp + meshoptimizer），模板 `trim_soldier.mjs`、检查 `inspect.mjs`。v4 注意：`io.writeBinary(doc)` 返回 Uint8Array（自己写盘）；禁用 meshopt/quantize（会删 Skin）。
  - 方法论已沉淀为项目 skill：`.opencode/skills/character-asset-pipeline/SKILL.md`、`.opencode/skills/map-build-craft/SKILL.md`。

### [构建基线: 完整化后测试数与 PWA]
- Date: 2026-09-22
- Context: Agent 完成 44 项 backlog 全量开发
- Category: 构建方法
- Instructions:
   - 完整化后测试基线 75 → **79**；2026-09-23 审计缺陷修复 + 补 11 个规划单测点 + 玩家对抗用例后 79 → **111**；2026-09-26 P0 差距修复批次（手感/武器/规则/HUD/Bot，commit a08c047）后 111 → **118**；P1+美术批次（渲染 PBR/ACES/IBL + 法线 + 烟雾 + bot 预投 + MVP + 确定性/预投单测，commit ee04da3）后 118 → **121**；改正书 G1-G4 后 121 → **134**（commit e18e59e）；de_costa 新图路由回归 +6 后 134 → **140**；优化书批次一/二/三全量施工后 140 → **180**（29 个测试文件，`npx vitest run` 全绿为验收线，只增不减；`npx tsc --noEmit` 一并通过）。
   - 已装 `vite-plugin-pwa@0.21`（devDependency）：`npm run build` 会生成 `dist/sw.js`+workbox，precache 174 项（含 45 ogg CC0 音效 + plaster/tile 等新贴图，总包 ~40.6MB）；dev 模式 PWA 不生效。
   - 渲染管线已升级 PBR：ACESFilmicToneMapping + sRGB + RoomEnvironment PMREM IBL + 8×PointLight 动态光池（爆炸/闪光/枪口，`renderer.addFlashLight`/`updateDynLights`）+ 法线贴图（`{key}_n` 键）+ 阴影 2048/4096 分档。人物/地图用 MeshStandardMaterial（IBL 下不发黑）。
   - 地图现为 4 张：`de_sahara`（默认）/`de_plaza`（地中海）/`de_costa`（海滨，G5）/`training`（训练场），注册在 `src/game/map/match.ts` 的 `MAP_BUILDERS`；新增图需在该表登记 + `CONFIG.SKY_PALETTES`（src/game/config.ts，天空/雾/太阳按图切换）+ `src/ui/menu.ts` MAP_CARD + routes.test.ts 加路由回归。

### [环境限制: headless 游戏 tick 速约为墙钟 5–7x]
- Date: 2026-09-23
- Context: 用 puppeteer+swiftshader 走查游戏做截图/事件断言时（rAF 时间戳漂移）
- Category: 排障 & 调试
- Instructions:
  - 沙箱 headless 下 requestAnimationFrame 时间戳漂移，游戏固定 tick（`CONFIG.tickRate`）跑约 5–7x 墙钟速（实测 40ms 墙钟 ≈ 29 tick）。所有"冷却/淡出/倒计时"类时间窗断言或截图时机要按此换算，或直接按 tick 计数（`state.tick`）而非墙钟 sleep。
  - 走查脚本（如 `/tmp/opencode/shots.mjs`）里 `sleep(ms)` 后要留足 7x 余量；拾取冷却等常量（60 tick）在 headless 下 ≈130ms 墙钟即过。
  - `window.__game`（DEV-only）暴露 `state()/tickOnce()/nav/level/events/renderer/textures/bulletPool/scorchPool/shotPool/input/buy(itemId)`，可无鼠标驱动走查（`input` 的边沿键 G/R/B 与移动键在 CDP keydown 下生效，但 fireHeld/aimHeld 因无指针锁恒 false）。
  - 注入玩家输入的正确方式：包一层 `g.input.poll`（`g.input.poll = () => { const f = orig(); f.forward = 1; return f }`），用完 `delete g.input.poll` 还原——直接给 `p.input` 赋值无效（`stepLogic` 每 tick 用 `input.poll()` 的结果覆盖 `players[0].input`）。自然 rAF 循环在后台 tab 几乎不 tick，确定性走查要显式 `g.tickOnce()` 驱动。
  - 台阶碰撞（`step-up`）行为注意：de_sahara 的"三级台阶"是 y∈[0,16/32/48] 的实心 slab 堆叠，玩家 48u 宽 footprint 在台阶区会同时压住多级 slab，Y_TOLERANCE=24 磁吸会沿 brush 列表级联抬升（0→16→32），probe 读数易混；台阶逻辑验证用 `tests/movement.test.ts` 的合成 step18/step32 用例（干净几何）为准。

### [工作纪律: 一切开发必须参照改正书]
- Date: 2026-09-27
- Context: 用户要求把实机审查结论固化为改正书，以后工作必须参照
- Category: 工作流与协作
- Instructions:
  - 用户明确指示：「以后工作必须参照改正书」。改正书位于 `.monkeycode/docs/RECTIFICATION.md`（2026-09-27 实机截图 + 源码探查得出）。
  - 任何新任务开工前先对照改正书：与其冲突的旧 BACKLOG 条目以改正书为准；甲部 P0（V1 枪模、V2 音效）未完成前不启动新玩法功能（G1/G2 可并行，文件域不同）。
   - 改正项完成一项就在改正书「完成记录」表打勾并注明 commit。

### [排障 & 调试: headless 菜单走查的两个坑（字距空格 / 暂停按钮是 div）]
- Date: 2026-09-28
- Context: 用 puppeteer 验收优化书批次三（触控布局预设/暂停菜单滑条/操作方式）时
- Category: 排障 & 调试
- Instructions:
  - UI 文案经 `letter-spacing` 渲染后 `innerText` 里是「开 镜 灵 敏 度」带空格，直接 `includes('开镜灵敏度')` 恒 MISS。断言前先 `document.body.innerText.replace(/\s+/g,'')` 归一化再匹配。
  - 触控暂停按钮是 `div.tb-pause`（非 `<button>`），`$$('button')` 匹配不到；对局中点暂停要 `document.querySelector('.tb-pause').click()`。
  - 回合 0（购买阶段）买菜单默认展开会盖住暂停面板，headless 里「点暂停→断言暂停菜单」不稳定；功能有无以源码（menu.ts 行号）+ vitest 单测为准，headless 截图只作布局坐标辅助。

### [排障 & 调试: headless 截图审计三个坑（自动暂停 / shader 静默失败 / 高画质丢上下文）]
- Date: 2026-09-27
- Context: 用 puppeteer+swiftshader 验收 V3/V6/G5（天空/材质/新图）时踩到
- Category: 排障 & 调试
- Instructions:
  - headless 无指针锁：开局后 pointerlockchange 触发自动暂停，画面被暂停菜单盖住。审计脚本在点"开 始 对 局"后要再点一次暂停菜单里的"继 续"按钮（`button.sp-btn.primary` 文案含"继"），否则所有截图都是暂停菜单。
  - three.js ShaderMaterial 编译失败**不抛 JS 异常**，只在 console 打 `THREE.WebGLProgram: Shader Error`，失败后该材质整体不渲染（天空穹顶静默消失，回退到 `scene.background` 纯色）。审计天空类改动务必监听 console 里的 `shader/program` 关键字（`page.on('console')`）或用 `__game.renderer.scene.children` 探 `material.program` 是否存在。
  - high 画质（4096 阴影图）在 swiftshader 下连续多局会 `CONTEXT_LOST_WEBGL` 丢上下文；审计用 medium 即可，稳定。
   - 相机 pitch 符号：`renderer.camera.rotation.x = pose.pitch`，**正 pitch 朝上看天**（+1.15 拍到天空），负值看地。

### [工作流: 规划先行 + 优化书体系]
- Date: 2026-09-28
- Context: 用户连续两轮强调"只规划不施工"，规划经三问确认后才放行施工
- Category: 工作流与协作
- Instructions:
  - 新功能先出 EARS 需求规划并向用户提关键决策问题（每轮最多 3 个），用户确认后才可施工；用户未放行前只写文档。
   - 全局优化总纲在 `.monkeycode/docs/OPTIMIZATION.md`（优化书，自包含可读，含背景/根因/需求/批次表）；细版 EARS 需求在 `.monkeycode/specs/{feature}/requirements.md`，权威版以优化书为准。
   - 优化书与改正书配合：改正书记录已完成审计修正，优化书是下一轮施工依据；已确认规划：Bot 大修（视觉两步走、智能一批全做、难度偏硬核）与输入/移动端（预设+编辑器、灵敏度四项、横屏提示+可锁）。
   - 2026-09-28 施工完成：批次一/二/三全部落地（commit cb2e4c5→7552fe9，共 13 笔），优化书第 4 章「完成记录」表已补全并入库（8f89a74 起）；测试基线 140→180。
