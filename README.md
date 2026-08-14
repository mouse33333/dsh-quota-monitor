# dsh-opencode-quota

DeepSeek Harness (DSH) Web 插件：界面**左下角**的**额度监控窗口**，实时展示
**OpenCode Go 套餐**（5小时/周/月额度）与 **DeepSeek API**（余额/用量），
以及当前任务的 token 消耗与预估费用。

## 截图

| 折叠状态（小药丸） | 展开状态（监控窗口） |
|---|---|
| ![折叠状态](docs/screenshots/collapsed.png) | ![展开状态](docs/screenshots/expanded.png) |

## 功能

- **收起态**：可拖拽的状态条卡片，宽度跟随侧边栏。显示当前模型与套餐标签、
  当前套餐额度/余额（余额金色大字；Go 5h 已用% + 进度条 + 重置倒计时）、
  任务四指标（缓存命中率 · 输入 · 输出 · 预估费用）。
- **展开态**：384px 监控面板（点击空白 / Esc 关闭），展示全部套餐明细：
  当前模型（名称 / 套餐 / 推理 / 路由）、任务指标网格（轮数 / 步数 / 时长 /
  缓存 / 输入 / 输出 / 费用，明细在 tooltip）、OpenCode Go 三窗口
  （5小时 / 本周 / 本月）、DeepSeek 余额与累计用量。
- **实时同步**：与聊天框模型选择同步，切换 DeepSeek ↔ OpenCode Go 的瞬间
  卡片即切换对应套餐视图。
- **费用预估**：按 API 单价 × 用量折算（USD→CNY）；价格与汇率每日自动刷新
  （litellm → openrouter → 内置兜底），DeepSeek 调价次日自动生效。
- 60 秒自动轮询 + 聚焦刷新 + 手动刷新；密钥只留在宿主机，不进浏览器。

## 安装

前置：已用 `opencode auth login` 登录；DSH 凭据配置了 `DEEPSEEK_API_KEY`。

```sh
# 推荐：npm 安装
dsh plugin --profile web add dsh-opencode-quota
# 或：GitHub 源码安装
dsh plugin --profile web add github:mouse33333/dsh-quota-monitor
```

然后编辑 `%DSH_HOME%\profiles\web\cordis.patch.yml`，加入 loader 行：

```yaml
- insert:
    - id: opencode-quota
      name: dsh-opencode-quota
```

**重启 GUI 应用**使宿主端生效（浏览器端 UI 变更可 HMR 热替换，宿主端路由/价格服务需重启）。

> `dsh plugin add` 只负责装包；loader 行必须手动添加（本插件不是 bundle 型包）。

## 更新

```sh
npm view dsh-opencode-quota version                    # 查看最新版本
dsh plugin --profile web update dsh-opencode-quota     # 升级
# 生效：UI 刷新页面即可；宿主端变更重启应用
```

## 配置

- OpenCode 令牌：`~/.local/share/opencode/auth.json`（环境变量 `OPENCODE_QUOTA_AUTH` 可覆盖）。
- DeepSeek 密钥：DSH 凭据中的 `DEEPSEEK_API_KEY`。
- 价格/汇率：每日刷新一次并缓存 24h；离线回落内置价格表（面板标注"内置价格"）。
- 轮询间隔：60 秒（`lib/client.js` 中 `POLL_INTERVAL_MS`）。

## 安全说明

- 两个 API 密钥只存在于宿主机，浏览器端仅拿到额度/余额数据，错误信息令牌脱敏；
- opencode zen usage 接口无官方文档（逆向接口），上游变更需跟进。

## 开发与发布

- 源码：`lib/index.js`（宿主端，零依赖 Node ESM）+ `lib/client.js`（浏览器端 bundle）。
- 开发记录：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · 变更历史：[CHANGELOG.md](CHANGELOG.md)
- npm: <https://www.npmjs.com/package/dsh-opencode-quota> · GitHub: <https://github.com/mouse33333/dsh-quota-monitor>
