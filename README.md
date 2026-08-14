# dsh-opencode-quota

一个 DeepSeek Harness (DSH) Web 插件：在界面**左下角**显示一个**额度监控窗口**，
同时监控：

- **OpenCode Go 套餐** —— 滚动 / 本周 / 本月三个窗口的 已用%、余量%、重置时间；
- **DeepSeek API** —— 余额（`/user/balance` 官方接口）+ 累计用量（本地会话记录聚合）。

## 它做什么

### 宿主端 (`lib/index.js`) — 两个同源 JSON 路由

| 路由 | 数据来源 |
|---|---|
| `GET /opencode-quota` | 读取 opencode 的 `auth.json` 中 `opencode-go` 令牌（令牌只留磁盘），调用官方接口 `GET https://opencode.ai/zen/go/v1/usage` |
| `GET /deepseek-quota` | 通过 DSH 凭据服务解析 `DEEPSEEK_API_KEY`，调用 `GET https://api.deepseek.com/user/balance`；同时聚合 `$DSH_HOME/storages/session_projcache.json` 里的每会话 token 用量（输入/输出/缓存读取） |

两个路由都有 5 秒内存缓存、15 秒上游超时，错误信息中的令牌一律脱敏。

`/deepseek-quota` 返回示例：

```json
{
  "ok": true,
  "provider": "deepseek",
  "balance": {
    "isAvailable": true,
    "currency": "CNY",
    "totalBalance": 20.66,
    "grantedBalance": 0,
    "toppedUpBalance": 20.66
  },
  "usage": {
    "sessions": 2,
    "uncachedInputTokens": 166285,
    "outputTokens": 219034,
    "cacheReadTokens": 17136640,
    "cacheWriteTokens": 0,
    "totalTokens": 17521959
  },
  "fetchedAt": "2026-08-14T02:31:38.090Z"
}
```

> 说明：DeepSeek 官方没有公开的“用量”API；`usage` 来自 DSH 自身持久化的会话投影缓存
> （`tokenUsage` 投影），统计的是本机所有 DSH 会话的累计 token。余额部分始终是官方实时数据。

### 浏览器端 (`lib/client.js`) — 左下角监控窗口

- **收起态**：一张**可拖拽**的状态条式摘要卡片，**宽度跟随侧边栏**（约 `侧边栏宽 - 16px`），
  聚焦**当前使用的模型**：
  - 第 1 行：模型名 + 套餐标签（DeepSeek API / OpenCode Go 套餐）；
  - 第 2-3 行：**当前套餐的额度/余额** —— DeepSeek 模型显示 `¥余额`、可用状态、
    充值明细 + 整行**累计用量**（输入/缓存读取/输出）；OpenCode Go 模型按
    **5小时 → 周 → 月** 优先级展示：`5h 已用%`（大字，按使用率着色）+ 5h 进度条 +
    `余% · 周% · 月%` 并列一行；
  - 第 4 行：**任务四指标** `任务 缓存98.7% · 入3.63M · 出119.0K · ¥0.336`
    —— 缓存命中率 / 输入 token / 输出 token / **预估费用**（按 API 单价 × 用量
    USD→CNY 折算；价格每日自动刷新，见下）；
  - 拖动位置保存到 localStorage；点击展开（并立即刷新数据）；
- **展开态**：384px 宽的监控面板（自动避让侧边栏，锚定在内容区左下角；
  **点击空白处或按 Esc 自动关闭**，也可点 ×），展示**所有绑定套餐**与全部任务详情：
  - **当前模型**：模型、供应商/套餐标签、推理强度、路由状态；
  - **任务详情**：轮数/步数、LLM/工具时长、缓存命中率（含缓存读取/输入拆分）、
    输入/输出 tokens、**预估费用明细**（输入/输出/缓存分项）+ **价格依据**
    （价格源、匹配模型、汇率、每日刷新说明）；
  - **OpenCode Go 套餐**：5小时/本周/本月三行 —— 进度条 + 已用% + 余量% + 重置时间与倒计时；
  - **DeepSeek API**：余额大字（可用/不可用状态徽章、充值/赠送明细）+ 累计用量
    （输入/输出/缓存读取/合计，K/M 缩写，会话数）；
  - 右上角 ⟳ 手动刷新、× 收起；每 60 秒自动轮询，窗口聚焦立即刷新；
  - 任一路由失败显示红色错误块 + 重试按钮；
  - 使用率 < 60% 绿色、< 85% 橙色、≥ 85% 红色。

## 安装

前置：

1. 已用 `opencode auth login` 登录（`~/.local/share/opencode/auth.json` 里有 `opencode-go.key`）；
2. DSH 凭据里配置了 `DEEPSEEK_API_KEY`（设置 → 凭据，或 `~/.dsh/.credentials.yaml`）。

三种安装方式任选其一，之后都要手动加 loader 行（见下）。

### 方式 B（推荐）：npm 安装

```sh
npm i -g pnpm        # 需要 pnpm（dsh plugin 转发给 pnpm）
dsh plugin --profile web add dsh-opencode-quota
```

npm 页面：<https://www.npmjs.com/package/dsh-opencode-quota>

### 方式 C：GitHub 安装（最新源码）

```sh
dsh plugin --profile web add github:mouse33333/dsh-quota-monitor
```

### 方式 A：本地路径（开发模式）

```sh
dsh plugin --profile web add D:\OneDrive\DeepSeek\dsh-plugins\opencode-quota
```

### loader 行（三种方式都需要）

编辑 `%DSH_HOME%\profiles\web\cordis.patch.yml`，加入：

```yaml
- insert:
    - id: opencode-quota
      name: dsh-opencode-quota
```

**重启 GUI 应用**（不是刷新页面）使宿主端生效，然后浏览器刷新页面。
验证：`GET http://127.0.0.1:3080/deepseek-quota` 与
`GET "http://127.0.0.1:3080/quota-session?session=<会话id>&model=deepseek-v4-flash"` 应返回 JSON。

> `dsh plugin add` 只负责把包装进 profile；loader 行必须手动加进 profile 的 patch
> （本插件不是 bundle 型包，`dsh plugin` 不会自动加进 `dsh.profile.bundles`）。
> 浏览器端 bundle 变更可由 HMR 热替换；宿主端代码变更必须重启应用。

## 更新

```sh
# 1. 查看最新版本
npm view dsh-opencode-quota version

# 2. 升级插件（npm / GitHub 安装均可；pnpm 会拉取最新版）
dsh plugin --profile web update dsh-opencode-quota

# 3. 生效
#    - 浏览器端（UI）：HMR 自动热替换，或刷新页面
#    - 宿主端（路由/价格服务）：重启 GUI 应用
```

- 本地路径安装（方式 A）：`git -C D:\OneDrive\DeepSeek\dsh-quota-monitor pull` 拉取最新源码后重启应用；
- 查看已安装版本：`dsh plugin --profile web list` 或检查 `%DSH_HOME%\profiles\web\package.json` 的依赖版本；
- 完整变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 发布到社区（给贡献者的建议）

- **npm**：已发布 —— <https://www.npmjs.com/package/dsh-opencode-quota>（`npm publish` 发布新版本）。
  注意版本耦合：面向 `@deepseek-ai/dsh@0.1.0-rc.6` 的 Web 面（`shell.overlay`
  插槽、模块加载器契约均为当前 rc 的内部接口，上游变更需跟进）。
- **GitHub**：主仓库 <https://github.com/mouse33333/dsh-quota-monitor>，附带本 README
  与 `docs/DEVELOPMENT.md`（开发记录）；贡献请发 issue / PR。
- 安全声明：插件只在宿主机持有 API 密钥，浏览器端只拿到额度/余额数据；
  但 opencode zen usage 接口无官方文档，属逆向接口，请知悉变动风险。

## 配置

- OpenCode 令牌：默认读 `~/.local/share/opencode/auth.json`（备选 `~/.config/opencode/auth.json`、
  `%APPDATA%\opencode\auth.json`）；环境变量 `OPENCODE_QUOTA_AUTH` 可覆盖（指向
  `{ "opencode-go": { "key": "..." } }` 格式的 JSON）。
- DeepSeek 密钥：经 DSH 凭据服务解析 `DEEPSEEK_API_KEY`（环境变量或 `~/.dsh/.credentials.yaml`）。
- **价格与汇率**：宿主端每日拉取一次模型单价（litellm 价格库 → openrouter → 内置兜底）
  与 USD→CNY 汇率（frankfurter → 7.2 兜底）；DeepSeek 调价（如 8/17）次日自动生效；
  缓存 24 小时，首次请求时触发。离线时回落到内置价格表（仍可用，标注"内置价格"）。
- 轮询间隔固定 60 秒（`lib/client.js` 中 `POLL_INTERVAL_MS`）。

## 开发

- 宿主端为纯 Node ESM，浏览器端为按 DSH 模块加载器格式手写的单文件 bundle，
  两者都无构建步骤；浏览器端只依赖 shell 共享的平台模块（`react` / `react/jsx-runtime`）。
- 自检：`node .research/test-host.mjs`（两条路由真实调用）、
  `node .research/test-client.mjs`（接线）、`node .research/test-client-data.mjs`（渲染分支）。
