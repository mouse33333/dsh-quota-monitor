# 开发记录：dsh-opencode-quota

> 一个 DeepSeek Harness (DSH) Web 插件：左下角额度监控窗口，同时监控
> **OpenCode Go 套餐** 与 **DeepSeek API**（余额 + 用量）。
> 本文记录从零到 v0.2.1 的开发过程、踩过的坑、以及最终成果。
> 版本：0.2.1（2026-08-14）

---

## 一、目标与总体设计

### 需求

1. 监控 opencode **Go 套餐**的额度：已用 / 余量 / 重置时间 / 刷新时间，显示在 GUI 左下角；
2. 追加监控 **DeepSeek API**：余额 + 用量；
3. UI 迭代：小胶囊 → 监控窗口 → 可拖拽 + 当前模型提示 + 点击空白关闭 → 多行分列摘要卡片。

### 架构（双面插件）

```
┌────────────────────────── 浏览器（GUI） ──────────────────────────┐
│ dsh-opencode-quota/lib/client.js（模块加载器格式 bundle）          │
│  · 注册进 "shell.overlay" 插槽（全局浮层，左下角）                  │
│  · 收起态：可拖拽的多行分列摘要卡片（位置存 localStorage）           │
│  · 展开态：384px 监控面板（点击空白 / Esc 关闭）                    │
│  · 数据：GET /opencode-quota、GET /deepseek-quota、sessions.models │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 同源 HTTP + 网关 RPC（密钥不出服务器）
┌──────────────────────────────┴───────────────────────────────────┐
│ dsh-opencode-quota/lib/index.js（Node ESM 宿主插件）               │
│  · 路由 /opencode-quota：读 opencode auth.json 令牌 → 官方接口     │
│    GET https://opencode.ai/zen/go/v1/usage（5s 缓存）              │
│  · 路由 /deepseek-quota：凭据服务解析 DEEPSEEK_API_KEY →           │
│    GET https://api.deepseek.com/user/balance + 本地用量聚合         │
│    （$DSH_HOME/storages/session_projcache.json 的 tokenUsage 投影）│
└───────────────────────────────────────────────────────────────────┘
```

**安全设计**：两个 API 密钥（opencode-go 令牌、DEEPSEEK_API_KEY）都只存在于宿主进程，
浏览器只拿经过处理的额度/余额数据；错误信息中令牌一律脱敏。

---

## 二、关键调研结论（数据源怎么找到的）

### OpenCode Go 额度接口

- 官方没有公开文档，但 opencode CLI 自己会调用一个接口：
  **`GET https://opencode.ai/zen/go/v1/usage`**，请求头 `Authorization: Bearer <token>`；
- 通过 web 搜索定位到社区项目 [slkiser/opencode-quota](https://github.com/slkiser/opencode-quota)
  （它逆向维护了各家的额度接口），下载其 `src/lib/opencode-go.ts` 源码确认了
  URL、请求头、响应结构；
- 响应结构（实测）：
  ```json
  { "usage": {
      "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-08-14T05:20:35Z" },
      "weekly":  { "status": "ok", "percent": 14, "resetsAt": "2026-08-17T00:00:00Z" },
      "monthly": { "status": "ok", "percent": 31, "resetsAt": "2026-09-03T07:58:22Z" } } }
  ```
  三个窗口：滚动 / 本周 / 本月，`percent` 是已用百分比，`resetsAt` 是重置时间；
- 令牌位置：`~/.local/share/opencode/auth.json` 里的 `opencode-go.key`
  （本机实测存在，`{ type, key }` 结构）。

### DeepSeek 余额接口

- 官方接口：**`GET https://api.deepseek.com/user/balance`**，Bearer 认证；
- 实测响应：
  ```json
  { "is_available": true, "balance_infos": [
      { "currency": "CNY", "total_balance": "20.66", "granted_balance": "0.00", "topped_up_balance": "20.66" } ] }
  ```

### DeepSeek 用量（无官方 API 的替代方案）

- DeepSeek 官方没有公开的用量查询 API；
- 发现 DSH 自己持久化了每会话 token 用量：`$DSH_HOME/storages/session_projcache.json`
  （storage-domain JSON 后端，明文可读，无需解压 zstd 会话日志），
  其中 `tables.sessions.<id>.rows.tokenUsage.val.totals` 有
  `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`；
- 于是宿主端直接聚合该文件：会话数、输入/输出/缓存读取/合计 token ——
  即"本机所有 DSH 会话的累计用量"，余额仍是官方实时数据。

### DSH 客户端插件架构（逆向结论）

- 插件包通过 profile 的 `dsh.profile.bundles` / `cordis.patch.yml` 进入 loader 树；
- 浏览器端 bundle 由包内 `dsh.client.platform: "web"` + `exports["./client"]` 声明，
  被 `dsh-client-modules` 扫描后注入 `window.__DSH_BOOT__` 启动清单，
  通过 `GET /plugins/<id>/client.js` 下发浏览器；
- bundle 格式：`window.__ModuleLoader__.load({ id, factory })`，
  `factory(require)` 只能 require shell 共享的**平台模块**
  （react、react/jsx-runtime、@deepseek-ai/cordis、dsh-client-ui-* 等）；
- UI 插槽系统：`ctx.slots.inject("shell.overlay", () => ctx.slots.register({...}, 组件))`，
  用 `inject` 等声明就绪、`register` 时 slot 必须已声明（AppFrame 声明了 shell.overlay）；
- 当前会话模型：`ctx.connection.api.sessions.models({ sessionId })` RPC。

---

## 三、开发过程（时间线）

| 阶段 | 内容 |
|---|---|
| 1. 调研 | 摸清 DSH profile/bundle/patch 机制、模块加载器、slot 系统；找到 opencode Go 接口与令牌位置；实测两个 API |
| 2. v0.1.0 | 双面插件骨架：宿主 `/opencode-quota` 路由 + 浏览器端"小胶囊"（sidebar.footer.action 插槽） |
| 3. 安装 | `dsh plugin --profile web add <path>` + 手动编辑 `cordis.patch.yml` 加 loader 行；服务器自动重启后路由生效 |
| 4. v0.2.0 | 新增 `/deepseek-quota`（余额 + 本地用量聚合）；UI 升级为 384px 监控面板（shell.overlay 插槽，避让侧边栏） |
| 5. v0.2.1a | 三个交互优化：胶囊可拖拽（localStorage 记忆）、当前模型/套餐显示（sessions RPC）、点击空白/Esc 关闭 |
| 6. v0.2.1 | 修复 models RPC 信封解析 bug；胶囊升级为多行分列摘要卡片 |
| 7. 测试 | 宿主端真实 API 全链路测试；浏览器端接线测试 + 三态渲染测试（stub hooks）+ 信封解析回归测试 |

### 验证手段（无浏览器的情况下怎么测）

- **宿主端**：`test-host.mjs` —— 伪造 cordis ctx（webServer/credentials 桩），
  直接调用注册的路由 handler，走真实 API + 真实本地文件，断言 JSON 输出与缓存命中；
- **浏览器端**：`test-client.mjs` —— 用 node:vm 伪造 `window.__ModuleLoader__`，
  执行 bundle、运行 factory、调用 apply、捕获 register 调用，再用
  react-dom/server 渲染组件（加载态）；
- **渲染分支**：`test-client-data.mjs` —— 用 stub react（useState 按调用顺序返回
  固定状态）强制进入 数据/错误/无会话 分支，`renderToStaticMarkup` 断言关键文案；
- **信封回归**：`normalizeModelsResult` 导出为纯函数，直接喂真实信封形状断言解析结果。

---

## 四、踩过的坑（按严重程度）

### 1. 沙箱网络全挂：HTTPS 在 PowerShell 里根本连不上

- 现象：`Invoke-WebRequest`/`Invoke-RestMethod` 一律
  `SEC_E_NO_CREDENTIALS（安全包中没有可用的凭证）`；`netsh`/`tasklist`/WMI 全被拒；
- 原因：pwsh 的 TLS 走 Windows SSPI，在受限环境里拿不到凭据；系统工具被沙箱拦截；
- 解法：**改用 Node 直接跑**（Node 自带 OpenSSL，不依赖 SSPI）：
  `node script.mjs` 用内置 fetch 下载源码、调 API，结果写文件而非 stdout 管道；
- 附带坑：`2>&1`、`| Select-Object` 这类输出重定向会让 node/npm 直接起不来
  （"StandardOutputEncoding is only supported when standard output is redirected"），
  必须让命令直接写 stdout 或写文件。

### 2. 沙箱文件权限：profile 目录在 workspace 之外

- `dsh plugin --profile web add` 要写 `%DSH_HOME%\profiles\web`（pnpm 装包 + 包仓库），
  被文件沙箱 EPERM 拒绝（报错还是诡异的 `C:\d\OneDrive\...` 路径）；
- 解法：同一命令带 `sandbox_permissions: danger-full-access` 重试一次（按规则允许的
  一次性升级）；后续手动编辑 profile 的 package.json / cordis.patch.yml 同理。

### 3. `dsh plugin add` 不会把包加进 loader 树

- `dsh plugin` 的 reconcile 逻辑只把声明了 **`dsh.bundle.patch`** 的包加入
  `dsh.profile.bundles`（bundle = 补丁层）；普通插件包只写进 dependencies 并警告；
- 解法：手动在 `cordis.patch.yml` 里 `- insert: [{ id: opencode-quota, name: dsh-opencode-quota }]`；
- 教训：读 `dsh` 包源码 `lib/plugin-*.js` 确认行为，别猜。

### 4. 服务器重启不可控（HMR 只热替换浏览器端）

- 第一次装好插件后服务器**自动重启**过（workbuddy 观察 profile 变更），
  新路由直接生效，且会话因 JSONL 持久化幸存 —— 之后想主动复现这个重启，
  改了 patch 注释、跑 dump-config、动 package.json 都没触发；
- 结论：**浏览器端 bundle 内容变更 = HMR 自动热替换**（client-hmr 轮询 mtime，
  SSE 推 rebuilt 帧）；**新插件条目 / 宿主端代码变更 = 必须重启应用**；
- 当前状态：`/deepseek-quota` 宿主路由仍依赖用户手动重启一次 GUI 应用。

### 5. models RPC 信封解析错误（用户报的 bug）

- 现象：面板"当前模型"永远"获取失败：unexpected models response"；
- 原因：typert 远程协议的信封是 `{ result: { ok, value | error } }`，
  我按 `result.current` 直接读，永远落空；
- 排查：对照官方 `dsh-client-ui-model-selection/lib/client.js` 源码
  （`const { result } = await sessions.models(...)`；`if (!result.ok)`；`result.value.current`）才发现；
- 修复：`normalizeModelsResult(result, at)` 纯函数 + 回归测试；
- 教训：**远程 RPC 先看同仓已有调用方的解析方式，别按直觉猜信封**。

### 6. React 无 key 警告与 SSR 环境缺失

- bundle 里数组 children 缺 key → 控制台警告；全部补上显式 key；
- vm 沙箱没有 `window.innerWidth/innerHeight/localStorage/document` →
  渲染出 `NaN` 的 left 样式 + 报错；给视口尺寸加 `?? 1280/800` 兜底、
  localStorage 访问包 try/catch、`typeof document` 守卫。

### 7. CSS 主题变量依赖

- 界面颜色全部依赖 DSH 主题变量 `--dsw-alias-*`（如 `--dsw-alias-bg-base`、
  `--dsw-alias-border-l1`、`--dsw-alias-label-secondary`）；
- 坑：个别变量（`--dsw-alias-bg-elevated`、`--dsw-alias-accent-fg`）不确定存在 →
  用 `var(a, var(b))` / 硬编码 fallback 兜底。

### 8. pnpm link 依赖的落点

- `dsh plugin add <绝对路径>` 在 Windows 上写成 `link:` 依赖，
  包实际落在 `profiles/web/node_modules/dsh-opencode-quota`（符号链接），
  不是 hoisted 顶层 —— 但 loader 的 baseUrl 就是 profile 目录，解析没问题；
- 验证方式：`createRequire(profileDir).resolve("dsh-opencode-quota")`。

---

## 五、达成的结果

### 功能

- **OpenCode Go 套餐**：滚动/本周/本月三窗口 —— 进度条、已用%、余量%、重置时间 + 倒计时；
- **DeepSeek API**：余额（大字 + 可用状态 + 充值/赠送明细）+ 累计用量
  （输入/输出/缓存读取/合计，K/M 缩写，会话数）；
- **当前模型**：模型名 + 供应商 + 套餐标签（自动识别 DeepSeek API / OpenCode Go 套餐）
  + 推理强度 + 路由状态；
- **交互**：摘要卡片可拖拽（localStorage 记忆位置）、点击展开、点击空白/Esc 关闭、
  60s 自动轮询 + 聚焦刷新 + 手动刷新、错误重试；
- **安全**：两个密钥都不进浏览器；错误信息令牌脱敏；上游 15s 超时 + 5s 缓存。

### 实测数据（本机）

- OpenCode Go：滚动 0%、本周 14%、本月 31%（2026-08-14）；
- DeepSeek 余额：¥20.66（充值 ¥20.66 / 赠送 ¥0.00，可用）；
- 本地累计用量（2 个会话）：输入 ~166K、输出 ~219K、缓存读取 ~17.1M tokens。

### 交付物

```
dsh-plugins/opencode-quota/
├── package.json          # v0.2.1；dsh.client.platform: web
├── lib/index.js          # 宿主端：两条路由（Node ESM，零依赖）
├── lib/client.js         # 浏览器端：监控窗口 bundle（零依赖，手写加载器格式）
├── README.md             # 功能/安装/配置/开发说明
├── docs/DEVELOPMENT.md   # 本文
├── CHANGELOG.md
└── LICENSE               # MIT
.research/                # 测试与调研脚本（test-host / test-client* / test-endpoint*）
```

### 测试

- 宿主两条路由真实全链路通过（含缓存命中）；
- 浏览器端接线 + 全部渲染分支 + 信封解析回归通过，无 React 警告。

---

## 六、遗留与展望

- [ ] `/deepseek-quota` 需要用户手动重启 GUI 应用一次才能生效（宿主端变更）；
- [ ] opencode zen usage 接口无官方文档，属于逆向接口，上游变动需要跟进；
- [ ] 用量是"本地累计"口径（session_projcache 聚合），非官方账单口径；
- [ ] 可考虑：阈值告警（使用率 ≥85% 变红提示）、每日用量趋势、多模型套餐并列。
