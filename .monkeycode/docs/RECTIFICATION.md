# STRIKE PROTOCOL 改正书

> 基线：commit `756894e`（2026-09-27 审查）。依据：**实机截图 9 张 + 源码逐文件探查**（非记忆）。
> 效力：**本文件为后续一切开发工作的强制参照**。任何新任务必须先对照本文件确认不与改正项冲突；做新功能前若本文件对应项未完成，应优先完成改正项。
> 审查方法存档：截图脚本 `/tmp/opencode/visual_audit.mjs`、`/tmp/opencode/bot_closeup.mjs`（沙箱环境可用时复跑复核）。

---

## 总判定

玩法骨架（经济/赛制/弹道确定性/命中部位/移动技术）已达到 CS:GO 水准的复刻；**「长相」整体停留在程序员美术原型阶段**，观感差距远大于玩法差距。改正重心 = 视觉与听觉，其次为四项玩法硬缺口。

---

## 甲部：视觉/听觉改正项（最高优先级）

### V1 第一人称枪模（P0，全场出现率最高物体）

**现状（证据）**
- 全部枪械为 `BoxGeometry`/`CylinderGeometry` 拼接（`src/ui/viewmodel.ts`，`part()`/`cyl()`）。
- 22 把武器仅 M4 接入 GLB：`src/main.ts:898` `upgradeWithGLB('rifle', '/models/m4.glb', ...)`；且 `m4.glb` 自身 **0 张贴图**（3 材质灰模）。
- AK 单独分组 `vm_rifle_ak`（viewmodel.ts:271），无 GLB，仍为盒子拼装。
- 截图证据：`/tmp/opencode/audit/s4_viewmodel.png` —— 手枪为纯黑多边形楔块，无手臂可见。

**改正要求**
1. 为每个武器类别接入带贴图的 GLB 枪模：pistol / smg / rifle（M4）/ ak / shotgun / sniper 六组全覆盖，替换全部盒子拼装。
2. m4.glb 补 PBR 贴图（baseColor/normal/roughness，可用 imggen 管线）。
3. 加第一人称手臂模型（含持枪姿态），开火后坐动画、换弹动画、切枪出场动画。
4. 枪口火光/抛壳与模型枪口位置对齐（`particles.ts` 池按新模型 muzzle 点发射）。

**验收**：实机截图逐枪检查（每类一张），枪械轮廓可辨识型号；开火/换弹有可见动画；手臂入镜。

### V2 音效真实化（P0）

**现状（证据）**：`src/engine/audio.ts` 100% 程序合成——`noiseBurst()` + oscillator，全项目无一条采样文件（`public/` 无音频资产）。

**改正要求**
1. 引入真实采样（CC0 音效包）：步枪/手枪/狙击枪/霰弹枪单发声、远距离衰减版、子弹命中材质声（金属/沙/木/肉体）、爆头叮声、脚步（跑/走/蹲静默）、爆炸、闪光爆鸣+耳鸣、C4 滴答与起爆、电台语音或至少无线电提示音。
2. 保留 PannerNode 3D 空间化与距离衰减逻辑，替换发声源为采样 buffer。
3. 音量设置接入 master.gain（现硬编码 0.7）。

**验收**：闭眼听感可区分「步枪 vs 手枪 vs 狙击」；命中反馈三态（肉体/爆头/打墙）可听辨。

### V3 地图光照与贴图（P1）

**现状（证据）**
- 贴图全部 1024×1024，砖墙/沙地平铺重复刺眼；192u 墙面拉伸后糊掉。
- 光照读感平坦，截图几乎无明暗分层与投影对比（尽管已有 ACES/IBL/动态光池）。
- 天空 = 双色渐变 ShaderMaterial 球 + 太阳 Sprite + 平沙丘剪影（`src/engine/renderer.ts:192-223`）。

**改正要求**
1. 关键墙面换 2048² 贴图，或引入多平铺混合（两层 UV + blend mask）打破重复感。
2. 大面积平面加 AO/细节灰度贴图（detail texture 二次平铺）。
3. 天空替换：HDRI 环境贴图（或程序云层 + 太阳光晕 + 更暖的沙漠色温），与 fog 颜色联动。
4. 拉开明暗：调 sun 强度/角度制造长影，室内外光比加大；验证 ACES tone mapping 实际生效。
5. 两张地图色彩基调区分（见 V6）。

**验收**：同机位前后对比截图：墙面无肉眼可见平铺重复；场景有明确光暗节奏；天空有云/光晕层次。

### V4 人物模型确认与队服可读性（P1，依赖真实浏览器）

**现状（证据）**：character.glb 规格合格（8.5 万顶点 / 11 动画 / 7 贴图），但沙箱 swiftshader 无法渲染 SkinnedMesh，实机仅见黑色剪影；距离上 T 棕/CT 蓝完全读不出。`char_preview.html` 在沙箱为空页。

**改正要求**
1. 用户在真实浏览器逐项确认：贴图精细度、动画过渡、死亡动画、队服颜色远距离可读性。
2. 若队服不可读：加强 CHAR_TINTS 色相对比或给模型加队色臂章/头巾装饰件。
3. 若模型观感不达标：按 character-asset-pipeline skill 换更高质量开源人物模型。

**验收**：真实浏览器截图，20u/50u/100u 三档距离下敌我身份可一眼区分。

### V5 UI 美术化（P1）

**现状（证据）**
- 主菜单为浏览器原生 `<select>`/`<input>`/`<range>`（截图 `menu_de_sahara.png`）。
- 买菜单为纯文字列表，无武器剪影/图标/网格布局（`s5_buymenu.png`）。
- 全局 Courier New 等宽字体（`public/hud.css:9`）。
- debug 面板（POS/SPD/HP/TICK）默认显示在成品画面左上角。
- 中英混排：顶部计分行 "R1 FREEZE BUY 2.0s · C4:携带"。

**改正要求**
1. 主菜单重做：自定义样式控件（沿用 sp-btn 体系扩展），地图/模式改为卡片选择。
2. 买菜单改网格布局 + 每枪矢量剪影图（imggen 或手绘 SVG），按 CS:GO 分区（手枪/步枪/狙/重型/投掷物/装备），显示按键快捷键。
3. 全局字体换 Stratum2 风格的开源替代（如 Saira/Rajdhani/Exo 2，本地 woff2，不走外链）。
4. debug 面板默认关闭，由设置项或 `?debug=1` 开启。
5. 顶部计分行等 HUD 文案统一中文（术语表进 `strings.ts`）。

**验收**：三屏（主菜单/买菜单/对局 HUD）截图达到可对外展示水准；无原生控件；无 debug 文本。

### V6 地图辨识度（P2）

**现状（证据）**：de_plaza 与 de_sahara 截图同款沙砖配色，几乎无法区分。

**改正要求**：每图定义独有色板（天空色/主贴图色/光照色温），de_plaza 改为非沙漠基调（如地中海白墙灰瓦或工业区混凝土）。

**验收**：两张图各一张远景截图并排，不看雷达可分辨地图。

---

## 乙部：玩法硬缺口（P1-P2）

### G1 穿墙（wallbang，P1）

**现状（证据）**：`src/game/physics/raycast.ts` `raycastBoxes()` 单命中返回；全项目无 penetration 逻辑（grep 验证）。武器表已有 `armorPenetration`（护甲穿透，与穿墙无关）。

**改正要求**
1. `raycastBoxes` 支持穿透：命中 solid 后按材质衰减继续追踪（可穿透材质白名单：wood/sandbag/sand 薄板，concrete 厚墙仅削弱）。
2. WeaponDef 加 `wallPenetration`（awp/rifles 高、手枪低、刀无）。
3. 命中反馈：穿墙击中显示烟尘 decal + 音效变闷。

**验收**：单测——木箱后 10u 处站桩靶，AK 穿箱命中伤害衰减正确； awp 可穿双层木板。

### G2 完整 30 发弹道图（P1）

**现状（证据）**：AK `recoilPattern` 仅 12 段循环（`src/game/weapons.ts`，`recoilIndex % length`）；xm1014 等仅 1-2 条目。真实 AK-47 为 30 发独立曲线（前 7 发近似直线，随后上扬，中段左右摆）。

**改正要求**：AK/M4/Galil 系按真实 CS 弹道曲线补满 30 段独立条目（公开弹道数据反推）；停火 0.4s 后 recoilIndex 归零时加入恢复插值，避免跳变。

**验收**：训练场 30 连发弹孔截图与 CS:GO AK 弹道图并排对比形状吻合；单测断言第 N 发位移序列。

### G3 受击减速 tagging（P2）

**现状（证据）**：命中无速度惩罚（grep tag/slowdown 无结果）。

**改正要求**：`applyPlayerHit` 时按伤害比例临时降 maxSpeed（CS 标准约 0.4-0.6s，衰减恢复）；护甲减慢幅度。

**验收**：单测——受击瞬间速度上限下降并按时间恢复；实机被扫射时走不掉。

### G4 蹲射精度（P2）

**现状（证据）**：`spreadDegrees()`（weapon.ts:391-395）仅站/动/空三态，无蹲下项。

**改正要求**：WeaponDef 加 `spreadDeg.crouch`（约 stand 的 60-70%），蹲下与移动插值取最小。

**验收**：单测 + 实机蹲射弹孔散布肉眼小于站射。

### G5 地图池扩充（P2）

**现状（证据）**：竞技图仅 de_sahara、de_plaza（`src/game/map/`），加 training。

**改正要求**：按 map-build-craft 管线新增 1-2 张完整竞技图（含点位/navmesh/预投点），色板遵循 V6。

**验收**：新图完整跑一局 bot 对局无报错，路由回归测试通过。

---

## 丙部：范围边界（明确不做，勿列为任务）

- 网络多人/netcode/反作弊：项目范围明确单机 Bot（见 `docs/INDEX.md`）。
- 沙箱内的人物模型目视验收：受 swiftshader 限制，必须由用户真实浏览器完成（V4）。

## 丁部：执行纪律

1. **顺序约束**：甲部 P0（V1、V2）完成前，不启动任何新玩法功能；乙部 G1/G2 可与甲部 P1 并行（不同文件域）。
2. **回归底线**：每项改正完成后 `npx tsc --noEmit` + `npx vitest run`（当前基线 134 用例，G1-G4 后由 121 升至 134）必须全绿；涉及渲染的附实机截图入 `/tmp/opencode/audit/` 或用户浏览器确认。
3. **数值入表**：所有新参数（穿透/弹道/tagging/蹲射）一律进 `src/game/config.ts` 或 WeaponDef，禁止硬编码。
4. **文档同步**：完成一项在本文件该项打勾并注明 commit；与本文件冲突的旧 BACKLOG 条目以本文件为准。

---

## 完成记录

| 项 | 状态 | commit | 备注 |
|---|---|---|---|
| V1 | ✅ | 8f7a9df | 枪模 PBR 提亮(gun_steel/gun_wood 非黑盒)+M4 GLB 补 PBR 贴图(baseColor/normal/roughness, imggen 生成)+手臂模型(袖套贴图/握枪姿态)+开火后坐/换弹下探/切枪入场动画+各枪类 muzzle 对齐。GLB 全枪类接入入口保留(现仅 M4 GLB) |
| V2 | ✅ | b605707 | CC0 真实采样(Kenney impact/interface/sci-fi，45 ogg) + 合成枪声 buffer(16 枪类闭眼可区分) + PannerNode 空间化保留；master.gain 接设置层；命中三态(金属/木/沙地)+爆头铃+脚步材质区分 |
| V3 | 未开始 | - | |
| V4 | 待用户浏览器验收 | - | |
| V5 | 未开始 | - | |
| V6 | 未开始 | - | |
| G1 | ✅ | e18e59e | 穿墙：raycastBoxesWithPenetration + wallPenetration（awp 双层）+ 入口点烟尘 decal + muffled shot；白名单 wood/sandbag/sand（concrete 不可穿） |
| G2 | ✅ | e18e59e | AK/M4 补满 30 段独立弹道（前 7 发近直/左漂/右摆形态）+ 停火 400ms 逐步恢复插值（recoilStopIndex 幂等快照）；武器表无 Galil，跳过 |
| G3 | ✅ | e18e59e | 受击 tagging：tagFrom/UntilTick+tagStrength，按伤害 0.4-0.6s 衰减降移速，护甲减半 |
| G4 | ✅ | e18e59e | 全枪 spreadDeg.crouch（stand 的 64-69%），蹲下与移动插值取最小 |
| G5 | 未开始 | - | |
