# Changelog

## 0.6.1 (2026-08-18)

- **改名**：包名由 `dsh-opencode-quota` 改为 `dsh-quota-monitor`（repository /
  npm / bundle id / 内部 cordis 名 / 账本文件名同步更新）。
- **新增 MiniMax Token Plan 监控**：
  - 供应商抽象层新增 `minimax-cn`（`kind: windows`），通过
    `https://api.minimax.chat/v1/token_plan/remains` 查询，用 `parse.source` 把
    `model_remains` 拍平为 `rolling` / `weekly` 两个窗口（已用% / 重置时间）。
  - 展开面板新增独立 "MiniMax Token Plan" 段落；折叠卡片在切到 MiniMax 模型时
    显示其 5h 额度视图。
- **展开面板改为 Tab 切换**：概览区移除，改为 `任务详情 / OpenCode / DeepSeek /
  MiniMax` 四个 tab；详情区用 grid 重叠，面板高度恒等于最高 tab，切换不再跳动。
- **任务详情数据对齐 harness**：`/quota-session` 的 token 用量改为优先读 harness
  投影缓存的 `tokenUsage.val.totals`（与对话框底部任务信息同源），费用仍按插件
  单价表估算；轮数/步数/时长本就来自投影缓存，现已完全一致。

## 0.6.0 (2026-08-16)

- **P0 自建计量（核心重构）**：
  - 新增 `llm/stream` 瀑布记账：每次模型调用的 token（输入/输出/缓存读取/写入 +
    会话 id + 耗时）写入自有账本 `$DSH_HOME/storages/dsh-opencode-quota-usage.jsonl`
    （追加写、不阻塞热路径、90 天留存、app 重启不丢）。
  - 累计用量 / 会话用量全部改从自有账本聚合，**不再硬依赖
    `session_projcache.json` 的 tokenUsage 投影**（格式变更不再影响核心功能）。
  - 投影缓存降级为可选增强：仅补齐会话遥测（轮数/步骤/工具时长），缺失或损坏时
    自动回落到自有口径（调用次数 ≈ 轮数、累计流时长 ≈ LLM 耗时），静默降级。
- **P1 供应商抽象**：
  - 引擎抽象为 `kind: balance | windows` 两类 + 查询/解析/缓存统一管线。
  - 内置预设：`deepseek-official`（余额）、`opencode-go`（限额百分比）、
    `new-api`（one-api 系网关）、`sub2api`（订阅配额网关）。
  - 解析器三形态：内置预设 / `parse.source` 粘贴 JS / `parse.file` 脚本文件；
    新增 `generic-balance` 通用余额解析器。
  - 新增 `/quota-providers` 路由（additive）：暴露全部已配置供应商及其快照，
    供即将到来的设置页使用；`ctx.runtime.opencodeQuota` 暴露内部 API。
  - 配置层：包条目 `config.providers.*` 可覆盖预设或新增自定义供应商，零代码。
- **P1 bundle 打包**：新增包内 `cordis.patch.yml` + `dsh.bundle.patch` 声明，
  `dsh plugin add` 一条命令即完成挂载，**不再需要手动编辑 profile 的 loader 行**；
  新增 `dsh.displayName` / `dsh.category` 元数据。
- 兼容性：三条旧路由（/opencode-quota、/deepseek-quota、/quota-session）契约不变，
  浏览器端 `lib/client.js` 未改动，升级无需动 UI。
- 测试：新增 `.research/test-refactor-smoke.mjs`（mock ctx + 桩上游，43 项断言全过）。

## 0.5.1 (2026-08-14)

- **监控窗口任务区重构**：原来的逐行 label+value 改为 **4 列指标网格**
  （轮数/步数/LLM/工具/缓存/输入/输出/费用，label 小字 + 数值加粗），
  长文本（缓存拆分、费用明细）移入单元格 tooltip —— 不再换行。
- **层级优化**：当前模型区改为 模型名大标题 + 套餐标签 + 单行元信息
  （供应商 · 推理 · 路由状态着色）；价格依据压缩为单行脚注；Go 窗口已用% 加大加粗。

## 0.5.0 (2026-08-14)

- **模型切换实时同步**：订阅聊天框模型选择器的 ModelDirectory store —— 用户在输入框
  切换模型（DeepSeek ↔ OpenCode Go）的瞬间，小药丸立即切换成对应套餐的额度/余额视图，
  无需等待轮询。软依赖：ui-model-selection 缺席时自动降级为轮询。
- **5h 重置倒计时**：OpenCode Go 卡片新增整行 `5h 重置倒计时 · X 小时 X 分后`（与
  展开面板的 5小时 行同源）。
- 截图更新（含 5h 倒计时行）。

## 0.4.2 (2026-08-14)

- **小药丸视觉分层**（五个区带，重点突出）：
  - 头部：模型名（加粗）+ 套餐标签胶囊；
  - **主数字区**：余额/5h 已用% 放大到 21px 超粗体 —— 余额金色高亮、Go 按使用率着色，
    右侧小字显示 可用/充值 或 余量·周·月；
  - 分隔线 + 用量行（DeepSeek 累计用量 / Go 5h 进度条）；
  - **任务指标网格**：缓存（按命中率着色）/输入/输出/费用 四格，label 小字 + 数值加粗，
    **费用金色高亮**；
  - 底部脚注：更新时间（最弱视觉层级）。
- 修复：tooltip 中"任务："与任务行前缀重复。

## 0.4.1 (2026-08-14)

- **小药丸加宽**：宽度跟随侧边栏（`侧边栏宽 - 16px`，224~408px，收起侧边栏时保底 224px），
  变成底部状态条风格，可容纳更多信息：
  - DeepSeek 模型卡片新增整行 **累计用量**（输入 / 缓存读取 / 输出），余额行显示充值明细；
  - 任务行、更新时间行整行铺开，不再截断。

## 0.4.0 (2026-08-14)

- **任务信息重做**：小药丸任务行改为 **缓存命中率 · 输入 token · 输出 token · 预估费用**；
  轮数/步数/LLM/工具时长、费用明细与价格来源移入展开面板。
- **费用预估**：新路由 `GET /quota-session?session=&provider=&model=`，按当前会话的
  tokenUsage 投影 + 模型单价估算费用（USD→CNY 按当日汇率折算）。
- **价格每日刷新**：宿主端每日拉取一次价格表（litellm → openrouter → 内置兜底）
  与 USD→CNY 汇率（frankfurter → 7.2 兜底），DeepSeek 8/17 调价次日自动生效；
  模型匹配：精确键 → 名称包含 → 家族前缀 → 内置表。
- 模型 RPC 失败时任务统计区仍正常显示（不再被模型错误整块挡住）。

## 0.3.1 (2026-08-14)

- **Go 套餐展示优先级调整**：小药丸按 **5小时（滚动）→ 周 → 月** 展示 ——
  主位大字 `5h 已用%`（按使用率着色）+ 整行 5h 进度条 + `余% · 周% · 月%` 一行并列；
  面板中"滚动窗口"改名为"5小时"，状态圆点也改按 5h 窗口着色。

## 0.3.0 (2026-08-14)

- **收起态卡片重构**：只聚焦当前使用的模型 —— 模型名 + 套餐标签 + 该套餐的额度/余额
  （DeepSeek 模型显示余额 + 输入/输出，OpenCode Go 模型显示已用% + 进度条 + 余量）+ **当前任务统计**
  （轮数/步数/输出 token/LLM 时长，直接读取对话区统计条同源的 `sessionStats` 投影，
  随会话实时更新）。
- **展开面板**：显示所有绑定套餐（当前模型 + OpenCode Go + DeepSeek 全量明细），
  当前模型卡片新增"任务统计"行；点击展开时立即刷新一次数据。
- 注入面新增 `currentStats` / `subscribeSessions`（会话列表订阅，统计实时性更好）。

## 0.2.1 (2026-08-14)

- **修复**：`sessions.models` RPC 信封解析错误（typert 协议为 `{ result: { ok, value } }`，
  此前按 `result.current` 解析导致"当前模型获取失败"）；解析逻辑抽为
  `normalizeModelsResult` 纯函数并加回归测试。
- **UI**：收起态从单行胶囊升级为 218px **多行分列摘要卡片**
  （Go 已用%/DS 余额 + 整行进度条 + 滚动/本周 + 输入/输出 token + 模型 + 更新时间）。
- 文档：新增 `docs/DEVELOPMENT.md`（开发过程/踩坑/成果）、`LICENSE`（MIT）、本文件。

## 0.2.0 (2026-08-14)

- 新增 DeepSeek API 监控：`GET /deepseek-quota`（官方余额接口
  `https://api.deepseek.com/user/balance` + 本地会话投影缓存 token 聚合）。
- UI 升级为 384px 监控面板（`shell.overlay` 插槽，自动避让侧边栏，锚定左下角）。

## 0.2.0-交互迭代 (2026-08-14)

- 摘要条可拖拽（位置持久化到 localStorage，拖动与点击智能区分）。
- 面板新增"当前模型"卡片（模型/供应商/套餐标签/推理强度/路由状态）。
- 点击空白处或按 Esc 自动关闭面板。

## 0.1.0 (2026-08-14)

- 首个版本：OpenCode Go 套餐额度监控。
- 宿主端 `GET /opencode-quota`（官方接口 `https://opencode.ai/zen/go/v1/usage`，
  令牌读自 opencode auth.json，不出服务器）。
- 浏览器端左下角小胶囊（`sidebar.footer.action` 插槽）：已用%/余量%/重置时间。
