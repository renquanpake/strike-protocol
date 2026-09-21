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
