// dsh-opencode-quota — browser face (client bundle).
//
// Loaded by the web shell's module loader (window.__ModuleLoader__). The only
// externals it may require are the platform modules shared by the shell:
// react / react/jsx-runtime (plus the other static modules — unused here).
//
// Renders a floating monitor at the bottom-left of the interface (anchored to
// the center column, so it never covers the sidebar) via the "shell.overlay"
// slot:
//   - a compact, DRAGGABLE summary card (multi-row/multi-column; position
//     persisted in localStorage);
//   - expanding into a dashboard showing the current session's model/plan,
//     OpenCode Go usage (rolling/weekly/monthly) and the DeepSeek API balance
//     + local token usage;
//   - click outside (or press Escape) closes the dashboard.
// Data comes from the same-origin /opencode-quota and /deepseek-quota routes
// (host face) plus the sessions gateway RPC for the current model; API keys
// never leave the host.
window.__ModuleLoader__.load({
	id: "dsh-opencode-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		//#region styles
		const tagId = "dsh-opencode-quota/Monitor.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-opencode-quota";
			tag.dataset.pluginCss = tagId;
			tag.textContent = [
				/* compact summary card (draggable; layered zones with a hero number) */
				".oq-card{position:absolute;width:218px;max-width:calc(100vw - 32px);display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:12px;row-gap:5px;padding:9px 12px;border-radius:12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.35;white-space:nowrap;text-align:left;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:grab;z-index:30;pointer-events:auto;touch-action:none;user-select:none}",
				".oq-card:active{cursor:grabbing}",
				".oq-card:hover{border-color:var(--dsw-alias-border-l2)}",
				".oq-card:focus-visible{outline:2px solid var(--dsw-alias-accent-fg);outline-offset:1px}",
				/* zone 1: model header */
				".oq-card .oq-c-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:1px}",
				".oq-card .oq-c-model{font-weight:800;font-size:12.5px;display:inline-flex;align-items:center;min-width:0;overflow:hidden;text-overflow:ellipsis}",
				".oq-card .oq-c-tag{max-width:110px;overflow:hidden;text-overflow:ellipsis;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(88,142,255,.16);color:var(--dsw-alias-accent-fg,#588eff);flex:none;justify-self:end;letter-spacing:.02em}",
				/* zone 2: hero number + sub */
				".oq-card .oq-c-hero{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;display:inline-flex;align-items:baseline;gap:2px}",
				".oq-card .oq-c-hero.oq-money{color:#f0a63c}",
				".oq-card .oq-c-hero-prefix{font-size:11px;font-weight:700;opacity:.75}",
				".oq-card .oq-c-hero-sub{text-align:right;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}",
				/* zone separator */
				".oq-card .oq-c-sep{grid-column:1/-1;height:1px;background:var(--dsw-alias-border-l1);margin:1px 0}",
				/* zone 3: usage line / progress bar */
				".oq-card .oq-c-usage{grid-column:1/-1;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}",
				".oq-card .oq-c-bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden;margin:1px 0}",
				".oq-card .oq-c-bar>i{display:block;height:100%;border-radius:3px}",
				/* zone 4: task metrics grid (label + value cells) */
				".oq-card .oq-c-tasks{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:5px;margin-top:1px}",
				".oq-card .oq-c-cell{display:flex;flex-direction:column;gap:1px;min-width:0}",
				".oq-card .oq-c-cell-label{font-size:9.5px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));letter-spacing:.05em;white-space:nowrap}",
				".oq-card .oq-c-cell-value{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".oq-card .oq-c-cell-value.oq-money{color:#f0a63c}",
				".oq-card .oq-c-task{grid-column:1/-1;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--dsw-alias-border-l1);padding-top:4px;margin-top:1px;white-space:nowrap}",
				/* zone 5: footer */
				".oq-card .oq-c-time{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:10px;text-align:right;max-width:none;letter-spacing:.02em}",
				/* click-away backdrop */
				".oq-backdrop{position:absolute;inset:0;z-index:25;pointer-events:auto;background:transparent}",
				/* monitor window */
				".oq-panel{position:absolute;width:384px;max-width:calc(100vw - 32px);max-height:min(620px,calc(100vh - 32px));overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:30;pointer-events:auto}",
				".oq-head{display:flex;align-items:center;gap:8px}",
				".oq-title{font-size:14px;font-weight:700;flex:1;display:flex;align-items:center;gap:6px}",
				".oq-updated{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}",
				".oq-btn{width:24px;height:24px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}",
				".oq-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
				".oq-sec{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base))}",
				".oq-sec-title{margin:0;font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}",
				/* model section */
				".oq-model-title{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:800;font-variant-numeric:tabular-nums;min-width:0}",
				".oq-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".oq-model-meta{color:var(--dsw-alias-label-secondary);font-size:11.5px;display:flex;flex-wrap:wrap;gap:2px 10px;font-variant-numeric:tabular-nums}",
				".oq-task-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;margin-top:4px}",
				".oq-cell{display:flex;flex-direction:column;gap:1px;min-width:0}",
				".oq-cell-label{font-size:9.5px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".oq-cell-value{font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".oq-cell-value.oq-money{color:#f0a63c}",
				".oq-task-foot{color:var(--dsw-alias-label-secondary);font-size:10.5px;margin-top:6px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".oq-tag{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:rgba(88,142,255,.16);color:var(--dsw-alias-accent-fg,#588eff);flex:none}",
				/* opencode windows */
				".oq-wrow{display:flex;flex-direction:column;gap:4px}",
				".oq-wrow-top{display:flex;align-items:baseline;gap:8px}",
				".oq-wrow-label{font-weight:600;flex:none}",
				".oq-wrow-pct{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;flex:none}",
				".oq-wrow-remain{color:var(--dsw-alias-label-secondary);font-size:11px;flex:1;text-align:right;font-variant-numeric:tabular-nums}",
				".oq-wrow-bar{height:5px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden}",
				".oq-wrow-bar>span{display:block;height:100%;border-radius:3px}",
				".oq-wrow-meta{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}",
				/* deepseek */
				".oq-ds-balance{display:flex;flex-wrap:wrap;align-items:center;gap:8px}",
				".oq-ds-big{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;flex:none}",
				".oq-chip{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;flex:none}",
				".oq-chip-ok{color:#0a7d33;background:rgba(46,204,113,.16)}",
				".oq-chip-bad{color:#b3261e;background:rgba(239,83,80,.16)}",
				".oq-ds-sub{width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}",
				".oq-ds-usage{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}",
				".oq-ds-usage-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".oq-urow{display:flex;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}",
				".oq-urow-label{color:var(--dsw-alias-label-secondary);flex:none}",
				".oq-urow-value{font-weight:600;flex:1;text-align:right}",
				/* status blocks */
				".oq-err{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;border:1px solid rgba(239,83,80,.4);background:rgba(239,83,80,.08);color:var(--dsw-alias-label-primary);font-size:12px;word-break:break-all}",
				".oq-err-btn{align-self:flex-start;font-size:11px;padding:2px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}",
				".oq-loading{color:var(--dsw-alias-label-secondary);font-size:12px;padding:4px 0}",
				".oq-foot{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:right;font-variant-numeric:tabular-nums}"
			].join("");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region helpers
		/** Poll interval; the host caches upstream payloads for a few seconds. */
		const POLL_INTERVAL_MS = 60_000;
		/** Window order as reported by the OpenCode API. */
		const WINDOW_ORDER = ["rolling", "weekly", "monthly"];
		/** "good" / "warn" / "bad" thresholds for usage color. */
		const WARN_AT = 60;
		const BAD_AT = 85;
		/** localStorage key for the dragged pill position. */
		const POS_KEY = "dsh-opencode-quota.pos";

		function windowLabel(key) {
			return { rolling: "5小时", weekly: "本周", monthly: "本月" }[key] ?? key;
		}

		/** Usage color ramp: green < 60%, amber < 85%, red above. */
		function percentColor(percent) {
			if (percent < WARN_AT) return "#2ecc71";
			if (percent < BAD_AT) return "#f5a623";
			return "#ef5350";
		}

		function clamp(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}

		function pad2(value) {
			return String(value).padStart(2, "0");
		}

		function formatClock(iso) {
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return String(iso);
			return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
		}

		function formatTime(date) {
			return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
		}

		/** Human countdown until a reset time ("3 小时 12 分后", "2 天后…"). */
		function formatCountdown(iso) {
			const ms = new Date(iso).getTime() - Date.now();
			if (!Number.isFinite(ms)) return "";
			if (ms <= 0) return "已到重置时间";
			const totalMinutes = Math.floor(ms / 60_000);
			if (totalMinutes < 60) return `${totalMinutes} 分钟后`;
			const hours = Math.floor(totalMinutes / 60);
			const minutes = totalMinutes % 60;
			if (hours < 24) return minutes === 0 ? `${hours} 小时后` : `${hours} 小时 ${minutes} 分后`;
			const days = Math.floor(hours / 24);
			return `${days} 天 ${hours % 24} 小时后`;
		}

		/** Compact token count ("164.3K", "15.71M"). */
		function fmtTokens(count) {
			if (count >= 1e6) return `${(count / 1e6).toFixed(2)}M`;
			if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
			return String(count);
		}

		/** Compact duration: "45.2s" under a minute, "2m42s" from there on. */
		function fmtDuration(ms) {
			if (!Number.isFinite(ms)) return "…";
			const s = ms / 1e3;
			if (s < 60) return `${Math.round(s * 10) / 10}s`;
			const whole = Math.round(s);
			return `${Math.floor(whole / 60)}m${whole % 60}s`;
		}

		/** Adaptive money formatting: 4 decimals under ¥0.01, 3 under ¥1, 2 above. */
		function fmtCost(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return "…";
			if (n >= 100) return n.toFixed(0);
			if (n >= 1) return n.toFixed(2);
			if (n >= 0.01) return n.toFixed(3);
			return n.toFixed(4);
		}

		/** Input-cache hit rate (cacheRead / total input) as a percent string. */
		function cacheHitText(usage) {
			const totalIn = usage.uncachedInputTokens + usage.cacheReadTokens;
			if (totalIn <= 0) return "0%";
			return `${((usage.cacheReadTokens / totalIn) * 100).toFixed(1)}%`;
		}

		/**
		 * One-line task metrics for the collapsed card:
		 * cache hit rate · input tokens · output tokens · estimated cost (CNY).
		 */
		function taskLine(payload) {
			if (payload === null || payload === void 0 || payload.usage === null || typeof payload.usage !== "object") return "任务 …";
			const usage = payload.usage;
			const parts = [
				`缓存${cacheHitText(usage)}`,
				`入${fmtTokens(usage.uncachedInputTokens + usage.cacheReadTokens)}`,
				`出${fmtTokens(usage.outputTokens)}`
			];
			if (payload.cost !== null && payload.cost !== void 0 && Number.isFinite(payload.cost.total)) {
				parts.push(`¥${fmtCost(payload.cost.total)}`);
			}
			return `任务 ${parts.join(" · ")}`;
		}

		/**
		 * Structured task metrics for the card's metric grid:
		 * [{ label, value, color?, money? }] — cache hit (color-coded), input,
		 * output, estimated cost (highlighted).
		 */
		function taskCells(payload) {
			if (payload === null || payload === void 0 || payload.usage === null || typeof payload.usage !== "object") return null;
			const usage = payload.usage;
			const totalIn = usage.uncachedInputTokens + usage.cacheReadTokens;
			const hit = totalIn > 0 ? (usage.cacheReadTokens / totalIn) * 100 : 0;
			const cells = [
				{ label: "缓存", value: `${hit.toFixed(1)}%`, color: percentColor(100 - hit) },
				{ label: "输入", value: fmtTokens(totalIn) },
				{ label: "输出", value: fmtTokens(usage.outputTokens) }
			];
			if (payload.cost !== null && payload.cost !== void 0 && Number.isFinite(payload.cost.total)) {
				cells.push({ label: "费用", value: `¥${fmtCost(payload.cost.total)}`, money: true });
			}
			return cells;
		}

		function fmtMoney(value) {
			return `¥${Number(value).toFixed(2)}`;
		}

		/** Human-friendly plan tag for a provider id. */
		function planTag(provider) {
			const p = String(provider ?? "").toLowerCase();
			if (p.includes("opencode") || p.includes("pi-ai")) return "OpenCode Go 套餐";
			if (p.includes("deepseek")) return "DeepSeek API";
			return provider ?? "";
		}

		/** Short display name for a model id ("deepseek-v4-flash" → "v4-flash"). */
		function shortModel(model) {
			const m = String(model ?? "");
			const stripped = m.replace(/^[a-z0-9]+[-_:/]/i, "");
			return stripped || m;
		}

		/** Whether a provider id belongs to the OpenCode Go plan. */
		function isGoPlan(provider) {
			return /opencode|pi-ai/i.test(String(provider ?? ""));
		}

		/** Whether a provider id belongs to the DeepSeek API plan. */
		function isDsPlan(provider) {
			return /deepseek/i.test(String(provider ?? ""));
		}
		//#endregion

		//#region positioning
		/**
		 * Track the sidebar column width so the monitor stays anchored to the
		 * bottom-left of the CENTER column (never covering the sidebar). Reads the
		 * frame's inline grid-template-columns, watching it for sidebar drags.
		 */
		function useSidebarOffset() {
			const [offset, setOffset] = react.useState(280);
			react.useEffect(() => {
				const read = () => {
					const overlay = document.querySelector("[data-shell-overlay]");
					const frame = overlay?.parentElement;
					if (frame === null || frame === void 0) return;
					const first = getComputedStyle(frame).gridTemplateColumns.split(" ")[0];
					const px = Number.parseFloat(first);
					if (Number.isFinite(px)) setOffset(px);
				};
				read();
				const overlay = document.querySelector("[data-shell-overlay]");
				const frame = overlay?.parentElement;
				if (frame !== null && frame !== void 0) {
					const observer = new MutationObserver(read);
					observer.observe(frame, { attributes: true, attributeFilter: ["style"] });
					window.addEventListener("resize", read);
					return () => {
						observer.disconnect();
						window.removeEventListener("resize", read);
					};
				}
				window.addEventListener("resize", read);
				return () => {
					window.removeEventListener("resize", read);
				};
			}, []);
			return offset;
		}
		//#endregion

		//#region QuotaMonitor
		/** Fetch one route into a normalized state record. */
		function fetchRoute(path) {
			return fetch(path, { cache: "no-store" })
				.then((res) => res.json())
				.then((payload) => {
					if (payload !== null && typeof payload === "object" && payload.ok === true) {
						return { status: "ok", payload, at: new Date() };
					}
					return { status: "error", error: (payload && payload.error) || "unexpected response", at: new Date() };
				})
				.catch((error) => ({
					status: "error",
					error: String((error && error.message) || error),
					at: new Date()
				}));
		}

		/**
		 * Normalize the sessions.models RPC envelope into a monitor state record.
		 * The wire returns `{ result: { ok, value | error } }`; `value` carries
		 * `{ current, routable, groups, failures }`.
		 * @param result - the envelope's `result` field.
		 * @param at - fetch timestamp.
		 * @returns a { status, ... } state record.
		 */
		function normalizeModelsResult(result, at) {
			if (result !== null && typeof result === "object" && result.ok === true && result.value !== null && typeof result.value === "object") {
				return { status: "ok", payload: { current: result.value.current, routable: result.value.routable }, at };
			}
			if (result !== null && typeof result === "object" && "error" in result) {
				const message = result.error && result.error.message ? String(result.error.message) : "unknown error";
				const code = result.error && result.error.code ? `${String(result.error.code)}: ` : "";
				return { status: "error", error: `${code}${message}`, at };
			}
			return { status: "error", error: "unexpected models response", at };
		}

		/** One quota window row inside the OpenCode section. */
		function WindowRow({ label, win }) {
			const color = percentColor(win.percent);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "oq-wrow",
				title: `${label}：已用 ${win.percent}% · 余 ${win.percentRemaining}% · ${win.resetsAt} 重置`,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "oq-wrow-top",
						children: [
							(0, react_jsx_runtime.jsx)("span", { className: "oq-wrow-label", children: label }, "label"),
							(0, react_jsx_runtime.jsx)("span", { className: "oq-wrow-pct", style: { color }, children: `${Math.round(win.percent)}%` }, "pct"),
							(0, react_jsx_runtime.jsx)("span", { className: "oq-wrow-remain", children: `余 ${Math.round(win.percentRemaining)}%` }, "remain")
						]
					}, "top"),
					(0, react_jsx_runtime.jsx)("div", {
						className: "oq-wrow-bar",
						children: (0, react_jsx_runtime.jsx)("span", {
							style: { width: `${Math.min(100, Math.max(0, win.percent))}%`, background: color }
						})
					}, "bar"),
					(0, react_jsx_runtime.jsx)("div", {
						className: "oq-wrow-meta",
						children: `${formatClock(win.resetsAt)} 重置 · ${formatCountdown(win.resetsAt)}`
					}, "meta")
				]
			});
		}

		/** OpenCode Go section body for a state. */
		function OpenCodeBody({ state, onRetry }) {
			if (state.status === "loading") {
				return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "加载中…" });
			}
			if (state.status === "error") {
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "oq-err",
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: `获取失败：${state.error}` }, "msg"),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "oq-err-btn", onClick: onRetry, children: "重试" }, "retry")
					]
				});
			}
			const usage = state.payload.usage;
			return WINDOW_ORDER.map((key) => {
				const win = usage[key];
				if (win === void 0 || win === null) {
					return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: `${windowLabel(key)}：无数据` }, key);
				}
				return (0, react_jsx_runtime.jsx)(WindowRow, { label: windowLabel(key), win }, key);
			});
		}

		/** One metric cell: tiny label above a bold value (grid layout). */
		function metricCell(label, value, key, extra) {
			return (0, react_jsx_runtime.jsxs)("span", {
				className: "oq-cell",
				title: extra !== null && extra !== void 0 && extra.title !== void 0 ? extra.title : void 0,
				children: [
					(0, react_jsx_runtime.jsx)("span", { className: "oq-cell-label", children: label }, "label"),
					(0, react_jsx_runtime.jsx)("span", {
						className: extra !== null && extra !== void 0 && extra.money === true ? "oq-cell-value oq-money" : "oq-cell-value",
						style: extra !== null && extra !== void 0 && extra.color !== void 0 ? { color: extra.color } : void 0,
						children: value
					}, "value")
				]
			}, key);
		}

		/**
		 * Full task detail: a compact 4-column metric grid (turns/steps/durations,
		 * cache hit rate, tokens, estimated cost) plus one small price foot line.
		 * Breakdowns (cache split, cost items) live in per-cell tooltips so no
		 * row ever wraps.
		 */
		function TaskRows({ task, onRetry }) {
			if (task.status === "loading") {
				return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "任务统计：加载中…" });
			}
			if (task.status === "none") {
				return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "任务统计：未选择会话" });
			}
			if (task.status === "error") {
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "oq-err",
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: `任务统计获取失败：${task.error}` }, "msg"),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "oq-err-btn", onClick: onRetry, children: "重试" }, "retry")
					]
				});
			}
			const payload = task.payload;
			const stats = payload.stats;
			const usage = payload.usage;
			const cost = payload.cost;
			const prices = payload.prices;
			if (stats === null && usage === null) {
				return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "任务统计：暂无数据" });
			}
			const cells = [];
			if (stats !== null && typeof stats === "object") {
				cells.push(metricCell("轮数", String(stats.turns), "turns"));
				cells.push(metricCell("步数", String(stats.steps), "steps"));
				if (stats.llmMs !== null && stats.llmMs !== void 0) cells.push(metricCell("LLM", fmtDuration(stats.llmMs), "llm"));
				if (stats.toolMs !== null && stats.toolMs !== void 0) cells.push(metricCell("工具", fmtDuration(stats.toolMs), "tool"));
			}
			if (usage !== null && typeof usage === "object") {
				const totalIn = usage.uncachedInputTokens + usage.cacheReadTokens;
				const hit = totalIn > 0 ? (usage.cacheReadTokens / totalIn) * 100 : 0;
				cells.push(metricCell("缓存", `${hit.toFixed(1)}%`, "hit", {
					color: percentColor(100 - hit),
					title: `缓存读取 ${fmtTokens(usage.cacheReadTokens)} / 输入 ${fmtTokens(totalIn)}`
				}));
				cells.push(metricCell("输入", fmtTokens(totalIn), "input", {
					title: `未缓存 ${fmtTokens(usage.uncachedInputTokens)} · 缓存读取 ${fmtTokens(usage.cacheReadTokens)}`
				}));
				cells.push(metricCell("输出", fmtTokens(usage.outputTokens), "output"));
			}
			if (cost !== null && cost !== void 0) {
				cells.push(metricCell("费用", `¥${fmtCost(cost.total)}`, "cost", {
					money: true,
					title: `输入 ¥${fmtCost(cost.input)} · 输出 ¥${fmtCost(cost.output)} · 缓存 ¥${fmtCost(cost.cacheRead)}`
				}));
			}
			let foot = null;
			if (prices !== null && prices !== void 0) {
				const source = prices.source === "builtin" ? "内置价格" : prices.source;
				const matched = prices.matched ? ` · ${prices.matched}` : "";
				const rate = prices.rate ? ` · 汇率 ${prices.rate}` : "";
				foot = (0, react_jsx_runtime.jsx)("div", { className: "oq-task-foot", children: `价格 ${source}${matched}${rate}（每日刷新）` }, "foot");
			}
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("div", { className: "oq-task-grid", children: cells }, "grid"),
					foot
				]
			});
		}

		/** Current-model section body: model info + full task detail. */
		function ModelBody({ state, task, onRetry }) {
			let modelPart;
			if (state.status === "loading") {
				modelPart = (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "加载中…" });
			} else if (state.status === "none") {
				modelPart = (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "未选择会话" });
			} else if (state.status === "error") {
				modelPart = (0, react_jsx_runtime.jsxs)("div", {
					className: "oq-err",
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: `获取失败：${state.error}` }, "msg"),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "oq-err-btn", onClick: onRetry, children: "重试" }, "retry")
					]
				});
			} else {
				const current = state.payload.current;
				const tag = planTag(current.provider);
				const routable = state.payload.routable !== false;
				modelPart = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: "oq-model-title",
							children: [
								(0, react_jsx_runtime.jsx)("span", { className: "oq-model-name", children: current.model }, "name"),
								(0, react_jsx_runtime.jsx)("span", { className: "oq-tag", children: tag }, "tag")
							]
						}, "title"),
						(0, react_jsx_runtime.jsxs)("div", {
							className: "oq-model-meta",
							children: [
								(0, react_jsx_runtime.jsx)("span", { children: `供应商 ${current.provider}` }, "provider"),
								(current.reasoningEffort !== void 0 && current.reasoningEffort !== null
									? (0, react_jsx_runtime.jsx)("span", { children: `推理 ${String(current.reasoningEffort)}` }, "effort")
									: null),
								(0, react_jsx_runtime.jsxs)("span", {
									children: [
										"路由 ",
										(0, react_jsx_runtime.jsx)("span", {
											style: { color: routable ? "#2ecc71" : "#ef5350", fontWeight: 700 },
											children: routable ? "可用" : "不可用"
										}, "v")
									]
								}, "routable")
							]
						}, "meta")
					]
				});
			}
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [modelPart, (0, react_jsx_runtime.jsx)(TaskRows, { task, onRetry }, "task")]
			});
		}

		/** DeepSeek section body for a state. */
		function DeepSeekBody({ state, onRetry }) {
			if (state.status === "loading") {
				return (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "加载中…" });
			}
			if (state.status === "error") {
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "oq-err",
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: `获取失败：${state.error}` }, "msg"),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "oq-err-btn", onClick: onRetry, children: "重试" }, "retry")
					]
				});
			}
			const balance = state.payload.balance;
			const usage = state.payload.usage;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "oq-ds-balance",
						children: [
							(0, react_jsx_runtime.jsx)("span", { className: "oq-ds-big", children: fmtMoney(balance.totalBalance) }, "big"),
							(0, react_jsx_runtime.jsx)("span", {
								className: balance.isAvailable ? "oq-chip oq-chip-ok" : "oq-chip oq-chip-bad",
								children: balance.isAvailable ? "可用" : "不可用"
							}, "chip"),
							(0, react_jsx_runtime.jsx)("div", {
								className: "oq-ds-sub",
								children: `充值 ${fmtMoney(balance.toppedUpBalance)} · 赠送 ${fmtMoney(balance.grantedBalance)} · ${balance.currency}`
							}, "sub")
						]
					}, "balance"),
					usage === null || usage === void 0
						? (0, react_jsx_runtime.jsx)("div", { className: "oq-loading", children: "暂无本地用量记录（会话投影缓存为空）" }, "none")
						: (0, react_jsx_runtime.jsxs)("div", {
							className: "oq-ds-usage",
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: "oq-ds-usage-title", children: `累计用量 · ${usage.sessions} 个会话（本地记录）` }, "title"),
								(0, react_jsx_runtime.jsxs)("div", { className: "oq-urow", children: [(0, react_jsx_runtime.jsx)("span", { className: "oq-urow-label", children: "输入（未缓存）" }, "l"), (0, react_jsx_runtime.jsx)("span", { className: "oq-urow-value", children: fmtTokens(usage.uncachedInputTokens) }, "v")] }, "in"),
								(0, react_jsx_runtime.jsxs)("div", { className: "oq-urow", children: [(0, react_jsx_runtime.jsx)("span", { className: "oq-urow-label", children: "输出" }, "l"), (0, react_jsx_runtime.jsx)("span", { className: "oq-urow-value", children: fmtTokens(usage.outputTokens) }, "v")] }, "out"),
								(0, react_jsx_runtime.jsxs)("div", { className: "oq-urow", children: [(0, react_jsx_runtime.jsx)("span", { className: "oq-urow-label", children: "缓存读取" }, "l"), (0, react_jsx_runtime.jsx)("span", { className: "oq-urow-value", children: fmtTokens(usage.cacheReadTokens) }, "v")] }, "cache"),
								(0, react_jsx_runtime.jsxs)("div", { className: "oq-urow", children: [(0, react_jsx_runtime.jsx)("span", { className: "oq-urow-label", children: "合计" }, "l"), (0, react_jsx_runtime.jsx)("span", { className: "oq-urow-value", children: fmtTokens(usage.totalTokens) }, "v")] }, "total")
							]
						}, "usage")
				]
			});
		}

		/**
		 * The monitor widget: compact draggable summary card (collapsed) /
		 * dashboard window (expanded), registered into the "shell.overlay" slot.
		 * @param props - slot props incl. `sessionsApi` (Remote face of the sessions
		 * gateway), `currentSessionId` (live reader) and `subscribeModelStore`
		 * (composer model-directory subscription for instant switch detection).
		 */
		function QuotaMonitor({ sessionsApi, currentSessionId, subscribeModelStore }) {
			const [open, setOpen] = react.useState(false);
			const [opencode, setOpencode] = react.useState({ status: "loading", at: new Date() });
			const [deepseek, setDeepseek] = react.useState({ status: "loading", at: new Date() });
			const [model, setModel] = react.useState({ status: "loading", at: new Date() });
			const [task, setTask] = react.useState({ status: "loading", at: new Date() });
			const offset = useSidebarOffset();
			const [pos, setPos] = react.useState(() => {
				try {
					if (typeof localStorage === "undefined") return null;
					const raw = localStorage.getItem(POS_KEY);
					if (raw === null) return null;
					const parsed = JSON.parse(raw);
					if (parsed !== null && typeof parsed === "object" && Number.isFinite(parsed.left) && Number.isFinite(parsed.bottom)) {
						return { left: parsed.left, bottom: parsed.bottom };
					}
				} catch {
					// unreadable position — fall back to the anchor
				}
				return null;
			});
			const cardRef = react.useRef(null);
			const suppressClickRef = react.useRef(false);
			const modelSubRef = react.useRef(null);
			const refreshRef = react.useRef(null);

			/** Fetch the current session's stats/usage/cost (needs provider+model for pricing). */
			const fetchTask = react.useCallback((provider, modelName, at) => {
				const sessionId = typeof currentSessionId === "function" ? currentSessionId() : void 0;
				if (sessionId === void 0 || sessionId === null) {
					setTask({ status: "none", at });
					return;
				}
				const query = new URLSearchParams({
					session: sessionId,
					provider: provider ?? "",
					model: modelName ?? ""
				});
				fetch(`/quota-session?${query.toString()}`, { cache: "no-store" })
					.then((res) => res.json())
					.then((payload) => {
						if (payload !== null && typeof payload === "object" && payload.ok === true) {
							setTask({ status: "ok", payload, at });
						} else {
							setTask({ status: "error", error: (payload && payload.error) || "unexpected response", at });
						}
					})
					.catch((error) => {
						setTask({ status: "error", error: String((error && error.message) || error), at });
					});
			}, [currentSessionId]);

			const refresh = react.useCallback(() => {
				const at = new Date();
				Promise.all([fetchRoute("/opencode-quota"), fetchRoute("/deepseek-quota")]).then(([oc, ds]) => {
					setOpencode(oc);
					setDeepseek(ds);
				});
				const sessionId = typeof currentSessionId === "function" ? currentSessionId() : void 0;
				/* keep the composer model-directory subscription on the current session */
				if (modelSubRef.current !== null && modelSubRef.current.sessionId !== sessionId) {
					modelSubRef.current.unsubscribe();
					modelSubRef.current = null;
				}
				if (modelSubRef.current === null && typeof subscribeModelStore === "function") {
					modelSubRef.current = {
						sessionId,
						unsubscribe: subscribeModelStore(sessionId, () => {
							/* model switch in the chat box: update immediately */
							if (refreshRef.current !== null) refreshRef.current();
						})
					};
				}
				if (sessionId === void 0 || sessionId === null) {
					setModel({ status: "none", at });
					setTask({ status: "none", at });
					return;
				}
				if (sessionsApi === void 0 || sessionsApi === null) {
					setModel({ status: "error", error: "sessions gateway unavailable", at });
					fetchTask("", "", at);
					return;
				}
				sessionsApi
					.models({ sessionId })
					.then(({ result }) => {
						const normalized = normalizeModelsResult(result, at);
						setModel(normalized);
						const provider = normalized.status === "ok" ? normalized.payload.current.provider : "";
						const modelName = normalized.status === "ok" ? normalized.payload.current.model : "";
						fetchTask(provider, modelName, at);
					})
					.catch((error) => {
						setModel({ status: "error", error: String((error && error.message) || error), at });
						fetchTask("", "", at);
					});
			}, [sessionsApi, currentSessionId, fetchTask, subscribeModelStore]);

			refreshRef.current = refresh;

			react.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, POLL_INTERVAL_MS);
				const onVisible = () => {
					if (document.visibilityState === "visible") refresh();
				};
				document.addEventListener("visibilitychange", onVisible);
				window.addEventListener("focus", onVisible);
				return () => {
					if (modelSubRef.current !== null) {
						modelSubRef.current.unsubscribe();
						modelSubRef.current = null;
					}
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
					window.removeEventListener("focus", onVisible);
				};
			}, [refresh]);

			react.useEffect(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [open]);

			/** Drag the collapsed card: pointer capture + window move/up listeners. */
			const onCardPointerDown = (event) => {
				event.preventDefault();
				const startX = event.clientX;
				const startY = event.clientY;
				const startLeft = pos === null ? offset + 8 : pos.left;
				const startBottom = pos === null ? 8 : pos.bottom;
				const width = cardRef.current?.offsetWidth ?? 264;
				const height = 104;
				let moved = false;
				let current = { left: startLeft, bottom: startBottom };
				const onMove = (ev) => {
					const dx = ev.clientX - startX;
					const dy = ev.clientY - startY;
					if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
					moved = true;
					current = {
						left: clamp(startLeft + dx, 8, Math.max(8, (window.innerWidth ?? 1280) - width - 8)),
						bottom: clamp(startBottom - dy, 8, Math.max(8, (window.innerHeight ?? 800) - height - 8))
					};
					setPos(current);
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					if (moved) {
						// Suppress the follow-up click (which fires on the button when the
						// pointer is released over it); reset next frame so a later genuine
						// click is never swallowed. A release outside the button dispatches
						// no click on it, so the rAF reset also covers that path.
						suppressClickRef.current = true;
						requestAnimationFrame(() => {
							suppressClickRef.current = false;
						});
						try {
							if (typeof localStorage !== "undefined") localStorage.setItem(POS_KEY, JSON.stringify(current));
						} catch {
							// storage unavailable — position stays in-memory
						}
					}
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};

			const anchorLeft = offset + 8;
			const effLeft = pos === null ? anchorLeft : pos.left;
			const effBottom = pos === null ? 8 : pos.bottom;
			/* status dot follows the 5h (rolling) window, then weekly, then monthly */
			const ocHeadline =
				opencode.status === "ok" ? (opencode.payload.usage.rolling ?? opencode.payload.usage.weekly ?? opencode.payload.usage.monthly) : void 0;
			const ocColor = ocHeadline === void 0 ? "#ef5350" : percentColor(ocHeadline.percent);
			const latest = [opencode.at, deepseek.at, model.at].reduce((a, b) => (a > b ? a : b));

			if (!open) {
				// ---- collapsed card: current model + its plan + task stats ----
				const provider = model.status === "ok" ? model.payload.current.provider : null;
				const modelName = model.status === "ok" ? model.payload.current.model : null;
				const useGo = provider !== null && isGoPlan(provider);
				const useDs = provider !== null && isDsPlan(provider);
				const ocUsage = opencode.status === "ok" ? opencode.payload.usage : null;
				const dsBalance = deepseek.status === "ok" ? deepseek.payload.balance : null;
				const dsUsage = deepseek.status === "ok" ? deepseek.payload.usage : null;
				/* Go windows, display priority: 5h (rolling) > weekly > monthly */
				const goRolling = ocUsage && ocUsage.rolling ? ocUsage.rolling : null;
				const goWeekly = ocUsage && ocUsage.weekly ? ocUsage.weekly : null;
				const goMonthly = ocUsage && ocUsage.monthly ? ocUsage.monthly : null;
				const goHeadline = goRolling ?? goWeekly ?? goMonthly;
				const rollingPct = goRolling === null ? null : Math.round(goRolling.percent);
				const weeklyPct = goWeekly === null ? null : Math.round(goWeekly.percent);
				const monthlyPct = goMonthly === null ? null : Math.round(goMonthly.percent);
				const taskText =
					task.status === "ok"
						? taskLine(task.payload)
						: task.status === "error"
							? "任务 ✕"
							: "任务 …";
				const cardTitle = [
					"点击展开额度监控 · 拖动可移动位置",
					model.status === "ok" ? `当前模型：${modelName}（${planTag(provider)}）` : "当前模型：不可用",
					useDs && dsBalance
						? `DeepSeek API 余额：${fmtMoney(dsBalance.totalBalance)}`
						: opencode.status === "ok"
							? `OpenCode Go：5h 已用 ${rollingPct === null ? "…" : `${rollingPct}%`}（余 ${goRolling === null ? "…" : Math.round(goRolling.percentRemaining)}%）· 周 ${weeklyPct === null ? "…" : `${weeklyPct}%`} · 月 ${monthlyPct === null ? "…" : `${monthlyPct}%`}`
							: "套餐数据不可用",
					task.status === "ok" ? `任务：${taskLine(task.payload).replace(/^任务 /, "")}` : "任务：无数据"
				].join("\n");
				const cardWidth = Math.min(408, Math.max(224, offset - 16));
				/* layered card: header → hero (plan number) → usage/bar → task metric grid → footer */
				const cells = task.status === "ok" ? taskCells(task.payload) : null;
				const heroSub = useDs
					? (dsBalance === null ? "…" : `${dsBalance.isAvailable ? "可用" : "不可用"} · 充值 ${fmtMoney(dsBalance.toppedUpBalance)}`)
					: (goHeadline === null
						? "…"
						: `余 ${Math.round(goHeadline.percentRemaining)}% · 周${weeklyPct === null ? "…" : `${weeklyPct}%`} · 月${monthlyPct === null ? "…" : `${monthlyPct}%`}`);
				return (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					ref: cardRef,
					className: "oq-card",
					style: { left: effLeft, bottom: effBottom, width: cardWidth },
					title: cardTitle,
					"aria-label": "展开额度监控（可拖动）",
					onPointerDown: onCardPointerDown,
					onClick: () => {
						if (suppressClickRef.current) {
							suppressClickRef.current = false;
							return;
						}
						setOpen(true);
						refresh();
					},
					children: [
						/* zone 1: current model + plan tag */
						(0, react_jsx_runtime.jsxs)("span", {
							className: "oq-c-model",
							children: [
								(0, react_jsx_runtime.jsx)("span", { className: "oq-c-dot", style: { background: ocColor } }, "dot"),
								modelName === null ? "模型 …" : shortModel(modelName)
							]
						}, "model"),
						(0, react_jsx_runtime.jsx)("span", { className: "oq-c-tag", children: provider === null ? "—" : planTag(provider) }, "tag"),
						/* zone 2: hero plan number + sub */
						useDs
							? (0, react_jsx_runtime.jsxs)("span", {
								className: "oq-c-hero oq-money",
								children: [
									(0, react_jsx_runtime.jsx)("span", { className: "oq-c-hero-prefix", children: "¥" }, "cur"),
									(0, react_jsx_runtime.jsx)("span", { children: dsBalance === null ? "…" : Number(dsBalance.totalBalance).toFixed(2) }, "amt")
								]
							}, "plan")
							: (0, react_jsx_runtime.jsxs)("span", {
								className: "oq-c-hero",
								style: { color: goHeadline === null ? "#ef5350" : percentColor(goHeadline.percent) },
								children: [
									(0, react_jsx_runtime.jsx)("span", { className: "oq-c-hero-prefix", children: "5h " }, "pre"),
									(0, react_jsx_runtime.jsx)("span", { children: goHeadline === null ? "…" : `${Math.round(goHeadline.percent)}%` }, "amt")
								]
							}, "plan"),
						(0, react_jsx_runtime.jsx)("span", { className: "oq-c-hero-sub", children: heroSub }, "plan-sub"),
						/* zone separator */
						(0, react_jsx_runtime.jsx)("span", { className: "oq-c-sep" }, "sep"),
						/* zone 3: 5h progress bar + reset countdown (Go) or usage line (DeepSeek) */
						useDs
							? (0, react_jsx_runtime.jsx)("span", {
								className: "oq-c-usage",
								children: dsUsage === null
									? "累计用量 …"
									: `累计 输入 ${fmtTokens(dsUsage.uncachedInputTokens)} · 缓存读取 ${fmtTokens(dsUsage.cacheReadTokens)} · 输出 ${fmtTokens(dsUsage.outputTokens)}`
							}, "usage")
							: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: "oq-c-bar",
										children: (0, react_jsx_runtime.jsx)("i", {
											style: {
												width: `${goHeadline === null ? 0 : clamp(goHeadline.percent, 0, 100)}%`,
												background: goHeadline === null ? "#ef5350" : percentColor(goHeadline.percent)
											}
										})
									}, "bar"),
									(0, react_jsx_runtime.jsx)("span", {
										className: "oq-c-usage",
										children: `5h 重置倒计时 · ${goRolling === null ? "…" : formatCountdown(goRolling.resetsAt)}`
									}, "countdown")
								]
							}, "usage"),
						/* zone 4: task metric grid (label + value cells) */
						cells !== null
							? (0, react_jsx_runtime.jsx)("div", {
								className: "oq-c-tasks",
								children: cells.map((cell, index) => (0, react_jsx_runtime.jsxs)("span", {
									className: "oq-c-cell",
									children: [
										(0, react_jsx_runtime.jsx)("span", { className: "oq-c-cell-label", children: cell.label }, "label"),
										(0, react_jsx_runtime.jsx)("span", {
											className: cell.money ? "oq-c-cell-value oq-money" : "oq-c-cell-value",
											style: cell.color !== void 0 ? { color: cell.color } : void 0,
											children: cell.value
										}, "value")
									]
								}, `cell-${index}`))
							}, "tasks")
							: (0, react_jsx_runtime.jsx)("span", { className: "oq-c-task", children: taskText }, "tasks"),
						/* zone 5: footer */
						(0, react_jsx_runtime.jsx)("span", { className: "oq-c-time", children: `更新 ${formatTime(latest)}` }, "time")
					]
				});
			}

			const panelStyle = {
				left: clamp(effLeft, 8, Math.max(8, (window.innerWidth ?? 1280) - 404)),
				bottom: clamp(effBottom, 8, Math.max(8, (window.innerHeight ?? 800) - 640))
			};
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						className: "oq-backdrop",
						onClick: () => {
							setOpen(false);
						}
					}, "backdrop"),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "oq-panel",
						style: panelStyle,
						role: "dialog",
						"aria-label": "额度监控",
						onClick: (event) => {
							event.stopPropagation();
						},
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "oq-head",
								children: [
									(0, react_jsx_runtime.jsxs)("span", {
										className: "oq-title",
										children: [
											(0, react_jsx_runtime.jsx)("span", { className: "oq-c-dot", style: { background: ocColor } }, "dot"),
											"额度监控"
										]
									}, "title"),
									(0, react_jsx_runtime.jsx)("span", { className: "oq-updated", children: `更新 ${formatTime(latest)}` }, "updated"),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "oq-btn",
										title: "立即刷新",
										"aria-label": "立即刷新",
										onClick: refresh,
										children: "⟳"
									}, "refresh"),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "oq-btn",
										title: "收起（点击空白处也可关闭）",
										"aria-label": "收起监控窗口",
										onClick: () => {
											setOpen(false);
										},
										children: "×"
									}, "close")
								]
							}, "head"),
							(0, react_jsx_runtime.jsxs)("section", {
								className: "oq-sec",
								children: [
									(0, react_jsx_runtime.jsx)("h3", { className: "oq-sec-title", children: "当前模型" }, "title"),
									(0, react_jsx_runtime.jsx)(ModelBody, { state: model, task, onRetry: refresh }, "body")
								]
							}, "sec-model"),
							(0, react_jsx_runtime.jsxs)("section", {
								className: "oq-sec",
								children: [
									(0, react_jsx_runtime.jsx)("h3", { className: "oq-sec-title", children: "OpenCode Go 套餐" }, "title"),
									(0, react_jsx_runtime.jsx)(OpenCodeBody, { state: opencode, onRetry: refresh }, "body")
								]
							}, "sec-opencode"),
							(0, react_jsx_runtime.jsxs)("section", {
								className: "oq-sec",
								children: [
									(0, react_jsx_runtime.jsx)("h3", { className: "oq-sec-title", children: "DeepSeek API" }, "title"),
									(0, react_jsx_runtime.jsx)(DeepSeekBody, { state: deepseek, onRetry: refresh }, "body")
								]
							}, "sec-deepseek"),
							(0, react_jsx_runtime.jsx)("div", { className: "oq-foot", children: "每 60 秒自动刷新 · 点击空白处或 Esc 关闭 · 拖动卡片可移动" }, "foot")
						]
					}, "panel")
				]
			});
		}
		//#endregion

		//#region plugin body
		/** Services required by the browser half. */
		const inject = ["slots", "connection", "sessions"];

		/**
		 * Client plugin body: wait for the shell overlay slot declaration, then
		 * register the monitor widget into it.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "opencode-quota-monitor",
				order: 0,
				registrant: "dsh-opencode-quota",
				inject: () => {
					/**
					 * Subscribe to the composer's per-session model directory store so a
					 * model switch in the chat box updates the monitor immediately.
					 * Soft dependency: no-ops when ui-model-selection is absent.
					 */
					const subscribeModelStore = (sessionId, listener) => {
						const directories = ctx.get("modelDirectories");
						if (directories === void 0 || directories === null) return () => {};
						try {
							return directories.directoryFor(sessionId).store.subscribe(listener);
						} catch {
							return () => {};
						}
					};
					return {
						sessionsApi: ctx.connection?.api?.sessions,
						currentSessionId: () => ctx.sessions?.list?.getSnapshot()?.current,
						subscribeModelStore
					};
				}
			}, QuotaMonitor));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.normalizeModelsResult = normalizeModelsResult;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
