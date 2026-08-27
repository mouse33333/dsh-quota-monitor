// dsh-quota-monitor — host face (v0.6.0).
//
// Refactored (P0/P1):
//   - P0  SELF METERING: an `llm/stream` waterfall hook records every model
//        call's token usage into a private JSONL store
//        ($DSH_HOME/storages/dsh-quota-monitor-usage.jsonl). All "local
//        usage" numbers now come from OUR ledger; the harness's session
//        projection cache is demoted to an OPTIONAL enrichment for
//        session telemetry (turns/steps/timings) and degrades silently.
//   - P1  PROVIDER ABSTRACTION: every monitored target is a provider entry
//        with `kind: balance | windows`, a preset registry, builtin/script
//        parsers and an entryConfig override layer. The two legacy routes
//        below map to the `opencode-go` and `deepseek-official` presets so
//        the browser half keeps working UNCHANGED.
//
// Routes (contract frozen, do not rename/reshape):
//   GET /opencode-quota  -> { ok, provider:"opencode-go", usage:{rolling,
//                            weekly, monthly:{status,percent,percentRemaining,
//                            resetsAt}}, fetchedAt }
//   GET /deepseek-quota  -> { ok, provider:"deepseek",
//                            balance:{isAvailable,currency,totalBalance,
//                            grantedBalance,toppedUpBalance},
//                            usage:{sessions,uncachedInputTokens,outputTokens,
//                            cacheReadTokens,cacheWriteTokens,totalTokens}|null,
//                            fetchedAt }
//   GET /quota-session?session=&provider=&model= -> { ok, provider, model,
//                            stats, usage, cost, prices, fetchedAt }
//   GET /quota-providers -> { ok, providers:[{id,label,kind,error?}],
//                            snapshots, fetchedAt }   (new, additive)
//
// Security: API keys are resolved on the host (credentials service, env, or
// the opencode auth.json file) and only ever sent as the Authorization header
// to the configured provider URL; errors are token-redacted before they can
// reach a log or the browser.
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Stable cordis plugin name (also the loader insert id). */
const name = "dsh-quota-monitor";
/** Services required before the routes can be registered. */
const inject = ["webServer", "credentials"];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The official OpenCode Go usage endpoint (opencode CLI's own source of truth). */
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
/** The official DeepSeek balance endpoint. */
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
/** OpenCode Go window keys, in display order (legacy client order). */
const WINDOW_KEYS = ["rolling", "weekly", "monthly"];
/** Seconds per OpenCode Go window (for display metadata). */
const WINDOW_SECONDS = { rolling: 5 * 3600, weekly: 7 * 86400, monthly: 30 * 86400 };
/** Route-level payload cache TTL. */
const CACHE_TTL_MS = 5_000;
/** Per-session stats route cache TTL. */
const SESSION_CACHE_TTL_MS = 2_000;
/** Upstream request timeout. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Daily price-table refresh (at most once per day, per process). */
const PRICE_TTL_MS = 24 * 3600 * 1_000;
/** Daily FX-rate refresh. */
const FX_TTL_MS = 24 * 3600 * 1_000;
/** Fallback USD→CNY rate when the daily FX fetch fails. */
const BUILTIN_RATE = 7.2;
/** How long metered rows are kept in the ledger before being pruned. */
const USAGE_RETENTION_DAYS = 90;

/** Price-table sources, tried in order (all JSON). */
const PRICE_SOURCES = [
  { id: "litellm", url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json" },
  { id: "openrouter", url: "https://openrouter.ai/api/v1/models" }
];
/** Daily FX rate (USD base, ECB-published). */
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=CNY";

/** Builtin USD-per-token fallbacks (offline); the daily fetch normally replaces them. */
const BUILTIN_PRICES = [
  /* deepseek-v4-flash official (off-peak, per DeepSeek pricing page):
     input(cache miss) $0.22/M, output $0.66/M, input(cache hit) $0.007/M.
     Peak (Mon-Fri 01-04 & 06-10 UTC) is 2x. DeepSeek has no separate cache-write fee. */
  { match: /deepseek/i, input: 2.2e-7, output: 6.6e-7, cacheRead: 7e-9 },
  { match: /sonnet/i, input: 3e-6, output: 15e-6, cacheRead: 3e-7 },
  { match: /opus/i, input: 15e-6, output: 75e-6, cacheRead: 1.5e-6 },
  { match: /haiku/i, input: 1e-6, output: 5e-6, cacheRead: 1e-7 },
  { match: /gpt-5/i, input: 1.25e-6, output: 10e-6, cacheRead: 1.25e-7 },
  { match: /gemini/i, input: 1.25e-6, output: 10e-6, cacheRead: 1.25e-7 },
  { match: /.*/, input: 2e-6, output: 8e-6, cacheRead: 5e-7 }
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Resolve the DSH home directory (env wins, same rule as dsh-home-paths). */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Our own meter ledger path (P0: no dependency on other storage formats). */
function meterPath() {
  return join(dshHome(), "storages", "dsh-quota-monitor-usage.jsonl");
}

/** The harness's session projection cache — OPTIONAL enrichment only (P0). */
function projCachePath() {
  return join(dshHome(), "storages", "session_projcache.json");
}

/**
 * Candidate opencode auth.json locations, in probe order. Override with the
 * OPENCODE_QUOTA_AUTH environment variable (absolute path to a JSON file
 * holding `{ "opencode-go": { "type": "...", "key": "..." } }`).
 */
function authCandidates() {
  const override = process.env.OPENCODE_QUOTA_AUTH;
  if (override) return [override];
  const home = homedir();
  return [
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
    join(home, "AppData", "Roaming", "opencode", "auth.json")
  ];
}

/** Read the opencode-go access token from the first readable auth.json. */
async function loadOpenCodeToken() {
  for (const path of authCandidates()) {
    try {
      const auth = JSON.parse(await readFile(path, "utf8"));
      const key = auth?.["opencode-go"]?.key;
      if (typeof key === "string" && key.length > 0) return { token: key, path };
    } catch {
      // unreadable or malformed file — try the next candidate
    }
  }
  return null;
}

/** Strip a secret out of any string that may reach a log or the client. */
function redact(text, secret) {
  return secret ? String(text).replaceAll(secret, "[redacted]") : String(text);
}

/** Coerce an unknown JSON number/string into a non-negative integer. */
function toCount(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Coerce an unknown JSON number/string into a non-negative price per token. */
function toPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const n = Number.parseFloat(String(value).replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// P0 — self metering ledger (llm/stream waterfall → own JSONL)
// ---------------------------------------------------------------------------

/**
 * Append-only JSONL ledger of metered model calls. Rows:
 *   { at, provider, model?, sessionId?, input, output, cacheRead, cacheWrite,
 *     tokens, ms }
 * `tokens` is the billable total (input + output + cacheRead + cacheWrite).
 * Appends are asynchronous (fire-and-forget) so the model-call hot path never
 * blocks on disk I/O.
 */
function createMeter(file) {
  const rows = [];
  let writeChain = Promise.resolve();

  /** Load rows once at boot; prune rows older than the retention window. */
  async function boot() {
    try {
      const dir = join(file, "..");
      await mkdir(dir, { recursive: true });
    } catch { /* best effort */ }
    try {
      const text = await readFile(file, "utf8");
      const cutoff = Date.now() - USAGE_RETENTION_DAYS * 24 * 3600 * 1000;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (typeof row.at === "number" && typeof row.tokens === "number" && row.at >= cutoff) {
            rows.push(row);
          }
        } catch { /* skip corrupt lines */ }
      }
      rows.sort((a, b) => a.at - b.at);
    } catch {
      // missing ledger — start empty
    }
  }

  /** Record one metered call. Never throws. */
  function record(entry) {
    const row = {
      at: Date.now(),
      provider: String(entry.provider ?? "unknown"),
      ...(entry.model ? { model: String(entry.model) } : {}),
      ...(entry.sessionId ? { sessionId: String(entry.sessionId) } : {}),
      input: entry.input ?? 0,
      output: entry.output ?? 0,
      cacheRead: entry.cacheRead ?? 0,
      cacheWrite: entry.cacheWrite ?? 0,
      tokens: entry.tokens,
      ms: entry.ms ?? 0
    };
    rows.push(row);
    writeChain = writeChain
      .then(() => appendFile(file, `${JSON.stringify(row)}\n`))
      .catch(() => { /* disk hiccup — in-memory totals still correct until exit */ });
    return row;
  }

  /** Aggregate ALL metered usage (legacy /deepseek-quota shape). */
  function aggregateAll() {
    let sessions = 0;
    let uncachedInputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let totalTokens = 0;
    const seen = new Set();
    for (const r of rows) {
      const key = r.sessionId ?? `__noid__:${r.at}`;
      if (!seen.has(key)) { seen.add(key); sessions += 1; }
      uncachedInputTokens += r.input;
      outputTokens += r.output;
      cacheReadTokens += r.cacheRead;
      cacheWriteTokens += r.cacheWrite;
      totalTokens += r.tokens;
    }
    return sessions === 0
      ? null
      : { sessions, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens };
  }

  /** Aggregate usage for a given time range [startMs, endMs). */
  function aggregateRange(startMs, endMs) {
    let sessions = 0;
    let uncachedInputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let totalTokens = 0;
    const seen = new Set();
    for (const r of rows) {
      if (r.at < startMs || r.at >= endMs) continue;
      const key = r.sessionId ?? `__noid__:${r.at}`;
      if (!seen.has(key)) { seen.add(key); sessions += 1; }
      uncachedInputTokens += r.input;
      outputTokens += r.output;
      cacheReadTokens += r.cacheRead;
      cacheWriteTokens += r.cacheWrite;
      totalTokens += r.tokens;
    }
    return sessions === 0
      ? null
      : { sessions, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens };
  }

  /** Aggregate today's usage (00:00 → now). */
  function aggregateToday() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return aggregateRange(start, Date.now());
  }

  /** Aggregate current month's usage (1st 00:00 → now). */
  function aggregateMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return aggregateRange(start, Date.now());
  }

  /** Aggregate one session's metered usage. */
  function sessionUsage(sessionId) {
    let calls = 0;
    let uncachedInputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let ms = 0;
    for (const r of rows) {
      if (r.sessionId !== sessionId) continue;
      calls += 1;
      uncachedInputTokens += r.input;
      outputTokens += r.output;
      cacheReadTokens += r.cacheRead;
      cacheWriteTokens += r.cacheWrite;
      ms += r.ms;
    }
    if (calls === 0) return null;
    return {
      calls,
      uncachedInputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      ms
    };
  }

  /** Our own session stats approximation (used when the harness projection
   * cache is absent): turns/calls measured on the waterfall, LLM wall time
   * accumulated from stream durations. */
  function sessionStatsOwn(sessionId) {
    const usage = sessionUsage(sessionId);
    if (usage === null) return null;
    return {
      turns: usage.calls,
      steps: null,
      llmMs: usage.ms > 0 ? usage.ms : null,
      toolMs: null,
      decodeMs: null,
      decodeTokens: usage.outputTokens
    };
  }

  return { boot, record, aggregateAll, aggregateToday, aggregateMonth, sessionUsage, sessionStatsOwn, rows: () => rows };
}

// ---------------------------------------------------------------------------
// P1 — provider presets & parsers
// ---------------------------------------------------------------------------

/** Builtin parsers: raw JSON from the queried url -> a snapshot partial.
 * `balance`-kind parsers return { balance: {...} };
 * `windows`-kind parsers return { windows: [{ key, label, seconds?, percent?,
 * percentRemaining?, resetsAt? }] }. */
const BUILTINS = {
  "deepseek-balance": (raw) => {
    const info = raw && Array.isArray(raw.balance_infos) ? raw.balance_infos[0] : undefined;
    if (!info) throw new Error("deepseek-balance: response missing balance_infos[0]");
    const toBalance = (value) => {
      const n = typeof value === "number" ? value : Number.parseFloat(String(value));
      return Number.isFinite(n) ? n : 0;
    };
    return {
      balance: {
        isAvailable: raw.is_available === true,
        currency: typeof info.currency === "string" ? info.currency : "CNY",
        totalBalance: toBalance(info.total_balance),
        grantedBalance: toBalance(info.granted_balance),
        toppedUpBalance: toBalance(info.topped_up_balance)
      }
    };
  },

  "opencode-go-usage": (raw) => {
    const u = raw && raw.usage;
    if (!u || typeof u !== "object") throw new Error("opencode-go-usage: response missing usage");
    const windows = [];
    for (const key of WINDOW_KEYS) {
      const win = u[key];
      if (!win || typeof win !== "object" || win.status !== "ok") continue;
      if (typeof win.percent !== "number" || !Number.isFinite(win.percent)) continue;
      if (typeof win.resetsAt !== "string") continue;
      windows.push({
        key,
        label: { rolling: "5小时", weekly: "本周", monthly: "本月" }[key] ?? key,
        seconds: WINDOW_SECONDS[key],
        status: "ok",
        percent: win.percent,
        percentRemaining: Math.max(0, 100 - win.percent),
        resetsAt: win.resetsAt
      });
    }
    if (windows.length === 0) throw new Error("opencode-go-usage: no usable windows in response");
    return { windows };
  },

  "new-api-self": (raw) => {
    // new-api (one-api family): GET /api/user/self with a System Access Token
    // -> { data: { quota, used_quota } }, quota units ÷ 500000 = USD.
    const data = raw && raw.data;
    if (!data || typeof data !== "object") throw new Error("new-api-self: response missing data");
    const quota = toPrice(data.quota);
    const used = toPrice(data.used_quota);
    if (quota === null) throw new Error("new-api-self: response missing quota");
    const remaining = used === null ? quota : Math.max(0, quota - used);
    return {
      balance: {
        isAvailable: remaining > 0,
        currency: "USD",
        totalBalance: quota / 500000,
        grantedBalance: 0,
        toppedUpBalance: remaining / 500000
      }
    };
  },

  "sub2api-usage": (raw) => {
    // sub2api: GET /v1/usage -> { remaining | quota.remaining | balance,
    // unit | quota.unit }
    const q = raw && raw.quota;
    const remainingRaw = raw?.remaining ?? q?.remaining ?? raw?.balance;
    const unit = typeof raw?.unit === "string" ? raw.unit : (q?.unit ?? "");
    const remaining = toPrice(remainingRaw);
    if (remaining === null) throw new Error("sub2api-usage: response missing remaining");
    return {
      balance: {
        isAvailable: remaining > 0,
        currency: unit.toUpperCase() === "USD" ? "USD" : "CNY",
        totalBalance: remaining,
        grantedBalance: 0,
        toppedUpBalance: remaining
      }
    };
  },

  "generic-balance": (raw) => {
    // balance_infos array OR flat { balance|total_balance|total|amount,
    // currency } (optionally under `data`).
    const root = raw?.data ?? raw;
    const arr = Array.isArray(root?.balance_infos) ? root.balance_infos : [];
    const info = arr[0] ?? root;
    if (!info || typeof info !== "object") throw new Error("generic-balance: no balance object");
    const total = toPrice(info.total_balance) ?? toPrice(info.balance) ?? toPrice(info.total) ?? toPrice(info.amount);
    if (total === null) throw new Error("generic-balance: no recognizable balance field");
    const currency = typeof info.currency === "string" ? info.currency : "CNY";
    return {
      balance: {
        isAvailable: toPrice(info.available ?? (info.is_available === false ? 0 : 1)) > 0,
        currency,
        totalBalance: total,
        grantedBalance: toPrice(info.granted_balance) ?? toPrice(info.granted) ?? 0,
        toppedUpBalance: toPrice(info.topped_up_balance) ?? toPrice(info.recharge) ?? total
      }
    };
  }
};

/** Whole-provider presets: one pick fills kind/url/key/parser for monitoring.
 * Config entries (entryConfig.providers[id]) merge over these. */
const PRESETS = {
  "deepseek-official": {
    label: "DeepSeek 官方",
    kind: "balance",
    url: DEEPSEEK_BALANCE_URL,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    parse: { builtin: "deepseek-balance" },
    currency: "CNY",
    auth: "bearer"
  },
  "opencode-go": {
    label: "OpenCode GO 订阅",
    kind: "windows",
    url: USAGE_URL,
    apiKeyEnv: "OPENCODE_API_KEY",
    tokenFile: true,
    parse: { builtin: "opencode-go-usage" },
    currency: "USD",
    auth: "bearer"
  },
  "new-api": {
    label: "new-api 网关",
    kind: "balance",
    url: "http://localhost:3000/api/user/self",
    apiKeyEnv: "NEWAPI_TOKEN",
    headers: { "New-Api-User": "1" },
    parse: { builtin: "new-api-self" },
    currency: "USD",
    auth: "raw"
  },
  "sub2api": {
    label: "sub2api 网关",
    kind: "balance",
    url: "http://localhost:8080/v1/usage",
    apiKeyEnv: "SUB2API_API_KEY",
    parse: { builtin: "sub2api-usage" },
    currency: "USD",
    auth: "bearer"
  }
};

/** Resolve a parser config to an async function (raw) -> snapshot partial. */
async function loadParser(parse) {
  if (!parse) return null;
  if (parse.builtin) {
    const fn = BUILTINS[parse.builtin];
    if (!fn) throw new Error(`opencode-quota: unknown builtin parser "${parse.builtin}"`);
    return fn;
  }
  if (parse.source) {
    return new Function("raw", `"use strict"; return (${parse.source})(raw)`); // eslint-disable-line no-new-func
  }
  if (parse.file) {
    const mod = await import(pathToFileURL(join(process.cwd(), parse.file)).href);
    const fn = mod.default ?? mod;
    if (typeof fn !== "function") throw new Error(`opencode-quota: parser file "${parse.file}" must export a function`);
    return fn;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Price & FX (daily refresh + in-memory cache; unchanged behavior)
// ---------------------------------------------------------------------------

/** Current price-table state; `source: "builtin"` until a fetch succeeds. */
let priceState = { at: 0, table: null, source: "builtin" };
/** Current FX state. */
let fxState = { at: 0, rate: BUILTIN_RATE, source: "builtin" };

/** Refresh the price table if the daily TTL elapsed (at most once a day). */
async function ensurePrices() {
  const now = Date.now();
  if (priceState.table !== null && now - priceState.at < PRICE_TTL_MS) return priceState;
  for (const source of PRICE_SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": "dsh-opencode-quota" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (source.id === "litellm") {
        priceState = { at: now, table: json, source: "litellm" };
      } else {
        // openrouter: [ { id, pricing: { prompt, completion } } ]
        const table = {};
        for (const entry of Array.isArray(json.data) ? json.data : []) {
          if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
          const pricing = entry.pricing;
          if (pricing === null || typeof pricing !== "object") continue;
          const input = toPrice(pricing.prompt);
          const output = toPrice(pricing.completion);
          if (input !== null && output !== null) table[entry.id] = { input_cost_per_token: input, output_cost_per_token: output };
        }
        priceState = { at: now, table, source: "openrouter" };
      }
      return priceState;
    } catch {
      // try the next source
    }
  }
  priceState = { at: now, table: null, source: "builtin" };
  return priceState;
}

/** Refresh the USD→CNY rate if the daily TTL elapsed. */
async function ensureFx() {
  const now = Date.now();
  if (now - fxState.at < FX_TTL_MS) return fxState;
  try {
    const res = await fetch(FX_URL, {
      headers: { "User-Agent": "dsh-opencode-quota" },
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) {
      const json = await res.json();
      const rate = toPrice(json?.rates?.CNY);
      if (rate !== null && rate > 0) {
        fxState = { at: now, rate, source: "frankfurter" };
        return fxState;
      }
    }
  } catch {
    // fall through to builtin
  }
  fxState = { at: now, rate: BUILTIN_RATE, source: "builtin" };
  return fxState;
}

/**
 * Look up USD-per-token prices for a model id: exact key, then family match,
 * then the builtin fallback table.
 */
function lookupPrice(model, table) {
  const m = String(model ?? "").trim().toLowerCase();
  if (m.length === 0) return null;
  const pick = (entry) => {
    if (entry === null || typeof entry !== "object") return null;
    const input = toPrice(entry.input_cost_per_token);
    const output = toPrice(entry.output_cost_per_token);
    if (input === null || output === null) return null;
    const cacheRead = toPrice(entry.cache_read_input_token_cost) ?? input * 0.25;
    return { input, output, cacheRead };
  };
  if (table !== null && typeof table === "object") {
    for (const key of [m, `deepseek/${m}`, `anthropic/${m}`]) {
      const price = pick(table[key]);
      if (price !== null) return { ...price, key };
    }
    const bare = m.replace(/^[a-z0-9-]+\//, "");
    const keys = Object.keys(table);
    const byName = keys.find((key) => key.toLowerCase().includes(bare));
    if (byName !== void 0) {
      const price = pick(table[byName]);
      if (price !== null) return { ...price, key: byName };
    }
    const family = bare.split(/[-_:/.]/)[0];
    if (family.length > 0) {
      const familyRe = new RegExp(`(^|/)${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([/-]|$)`);
      const byFamily = keys.find((key) => familyRe.test(key.toLowerCase()));
      if (byFamily !== void 0) {
        const price = pick(table[byFamily]);
        if (price !== null) return { ...price, key: byFamily };
      }
    }
  }
  for (const builtin of BUILTIN_PRICES) {
    if (builtin.match.test(m)) return { input: builtin.input, output: builtin.output, cacheRead: builtin.cacheRead, key: `builtin:${builtin.match.source}` };
  }
  return null;
}

/** Estimate the cost of a session's token usage for a model, in CNY. */
function estimateCost(usage, price, rate) {
  const usd = {
    input: usage.uncachedInputTokens * price.input,
    cacheRead: usage.cacheReadTokens * price.cacheRead,
    output: usage.outputTokens * price.output
  };
  const totalUsd = usd.input + usd.cacheRead + usd.output;
  return {
    input: usd.input * rate,
    cacheRead: usd.cacheRead * rate,
    output: usd.output * rate,
    total: totalUsd * rate
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Mount the quota routes and the metering waterfall.
 * @param ctx - host plugin context (webServer + credentials).
 * @param entryConfig - optional loader config: { providers: { id: partial
 *   preset override }, cacheTtlMs, sessionCacheTtlMs, timeoutMs,
 *   lowBalanceThreshold }.
 */
function apply(ctx, entryConfig) {
  // --- config layer (P1): entryConfig merges over the presets -------------
  const cfg = {
    cacheTtlMs: entryConfig?.cacheTtlMs ?? CACHE_TTL_MS,
    sessionCacheTtlMs: entryConfig?.sessionCacheTtlMs ?? SESSION_CACHE_TTL_MS,
    timeoutMs: entryConfig?.timeoutMs ?? REQUEST_TIMEOUT_MS,
    lowBalanceThreshold: entryConfig?.lowBalanceThreshold ?? 20,
    providers: entryConfig?.providers ?? {}
  };

  // --- P0: self metering ledger + waterfall hook ---------------------------
  const meter = createMeter(meterPath());

  /** Hook every model call: record billable tokens + stream wall time. */
  ctx.on("llm/stream", (options, next) => {
    const provider = options?.provider;
    const model = options?.model;
    const sessionId = options?.sessionId;
    const started = Date.now();
    const inner = next();
    return (async function* () {
      try {
        for await (const chunk of inner) {
          if (chunk && chunk.type === "usage" && chunk.usage) {
            const u = chunk.usage;
            // TokenUsage fields are DISJOINT: inputTokens is uncached input;
            // billed input = input + cacheRead + cacheWrite.
            const input = u.inputTokens ?? 0;
            const output = u.outputTokens ?? 0;
            const cacheRead = u.cacheReadTokens ?? 0;
            const cacheWrite = u.cacheWriteTokens ?? 0;
            meter.record({
              provider,
              model,
              sessionId,
              input,
              output,
              cacheRead,
              cacheWrite,
              tokens: input + output + cacheRead + cacheWrite,
              ms: Date.now() - started
            });
          }
          yield chunk;
        }
      } finally {
        // stream ended (or errored) — nothing to clean up
      }
    })();
  });

  // --- key resolution (P1) -------------------------------------------------
  const resolveKey = async (pcfg) => {
    const ref = pcfg.apiKeyEnv;
    if (ref) {
      try {
        const credentials = ctx.get("credentials");
        const hit = credentials && typeof credentials.resolve === "function"
          ? await credentials.resolve(ref)
          : undefined;
        if (hit && typeof hit.value === "string" && hit.value.length > 0) {
          return { value: hit.value, source: "credentials" };
        }
      } catch { /* fall through */ }
      const env = process.env[ref];
      if (env && env.length > 0) return { value: env, source: "env" };
    }
    if (pcfg.tokenFile) {
      const cred = await loadOpenCodeToken();
      if (cred) return { value: cred.token, source: "opencode-auth.json", path: cred.path };
    }
    return undefined;
  };

  const fail = (providerName, error, kind = "balance") => ({
    provider: providerName, kind, fetchedAt: new Date().toISOString(), error
  });

  // --- query engine (P1) ---------------------------------------------------
  const queryBalance = async (providerName, pcfg) => {
    const key = await resolveKey(pcfg);
    if (!key) return fail(providerName, "no-key", "balance");
    let res;
    try {
      res = await fetch(pcfg.url, {
        method: "GET",
        headers: {
          authorization: pcfg.auth === "raw" ? key.value : `Bearer ${key.value}`,
          accept: "application/json",
          ...(pcfg.headers ?? {})
        },
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch {
      return fail(providerName, "network", "balance");
    }
    if (!res.ok) return fail(providerName, `http-${res.status}`, "balance");
    let raw;
    try { raw = await res.json(); } catch { return fail(providerName, "bad-json", "balance"); }
    try {
      const parser = await loadParser(pcfg.parse);
      const parsed = parser ? await parser(raw) : { balance: undefined };
      if (!parsed.balance || typeof parsed.balance !== "object") {
        throw new Error("parser returned no balance object");
      }
      return {
        provider: providerName,
        kind: "balance",
        fetchedAt: new Date().toISOString(),
        balance: parsed.balance,
        currency: typeof pcfg.currency === "string" ? pcfg.currency : "CNY"
      };
    } catch (e) {
      return fail(providerName, `parse:${String((e && e.message) ?? e)}`, "balance");
    }
  };

  const queryWindows = async (providerName, pcfg) => {
    const key = await resolveKey(pcfg);
    if (!key) return fail(providerName, "no-key", "windows");
    let res;
    try {
      res = await fetch(pcfg.url, {
        method: "GET",
        headers: {
          authorization: pcfg.auth === "raw" ? key.value : `Bearer ${key.value}`,
          accept: "application/json",
          ...(pcfg.headers ?? {})
        },
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch {
      return fail(providerName, "network", "windows");
    }
    if (!res.ok) return fail(providerName, `http-${res.status}`, "windows");
    let raw;
    try { raw = await res.json(); } catch { return fail(providerName, "bad-json", "windows"); }
    try {
      const parser = await loadParser(pcfg.parse);
      const parsed = parser ? await parser(raw) : { windows: [] };
      const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
      if (windows.length === 0) throw new Error("parser returned no windows");
      return {
        provider: providerName,
        kind: "windows",
        fetchedAt: new Date().toISOString(),
        windows
      };
    } catch (e) {
      return fail(providerName, `parse:${String((e && e.message) ?? e)}`, "windows");
    }
  };

  /** Merge config with the preset and collect one provider's snapshot. */
  const collectOne = async (providerId) => {
    const userCfg = cfg.providers[providerId];
    const preset = PRESETS[providerId];
    if (!preset && !userCfg) return null;
    const pcfg = {
      ...(preset ?? {}),
      ...(userCfg ?? {}),
      parse: userCfg?.parse ?? preset?.parse,
      headers: userCfg?.headers ?? preset?.headers
    };
    if (pcfg.kind === "balance") return queryBalance(providerId, pcfg);
    if (pcfg.kind === "windows") return queryWindows(providerId, pcfg);
    return fail(providerId, "unsupported-kind", "balance");
  };

  // --- optional session enrichment from the harness projection cache (P0) ----
  const readProjCache = async () => {
    try {
      return JSON.parse(await readFile(projCachePath(), "utf8"));
    } catch {
      return null;
    }
  };

  /**
   * Session stats: prefer the harness projection cache (turns/steps/timings);
   * fall back to our own metered approximations. Never throws.
   */
  const sessionStats = async (sessionId) => {
    const own = meter.sessionStatsOwn(sessionId);
    try {
      const cache = await readProjCache();
      const row = cache?.tables?.sessions?.[sessionId];
      const stats = row?.rows?.sessionStats?.val;
      if (stats && typeof stats === "object") {
        return {
          turns: toCount(stats.turns) || own?.turns || 0,
          steps: toCount(stats.steps) || null,
          llmMs: typeof stats.llmMs === "number" && Number.isFinite(stats.llmMs)
            ? stats.llmMs
            : (own?.llmMs ?? null),
          toolMs: typeof stats.toolMs === "number" && Number.isFinite(stats.toolMs) ? stats.toolMs : null,
          decodeMs: typeof stats.decodeMs === "number" && Number.isFinite(stats.decodeMs) ? stats.decodeMs : null,
          decodeTokens: toCount(stats.decodeTokens) || own?.decodeTokens || 0
        };
      }
    } catch { /* projection cache invalid or absent — use own stats */ }
    return own;
  };

  /**
   * Session token usage: prefer the harness projection cache
   * (`tokenUsage.val.totals`) — the SAME source the harness surfaces at the
   * bottom of the conversation — so our numbers match the product exactly;
   * fall back to our own metered ledger when the cache is absent. Never throws.
   */
  const sessionTokenUsage = async (sessionId) => {
    try {
      const cache = await readProjCache();
      const row = cache?.tables?.sessions?.[sessionId];
      const totals = row?.rows?.tokenUsage?.val?.totals;
      if (totals && typeof totals === "object") {
        const u = {
          uncachedInputTokens: toCount(totals.uncachedInputTokens),
          outputTokens: toCount(totals.outputTokens),
          cacheReadTokens: toCount(totals.cacheReadTokens),
          cacheWriteTokens: toCount(totals.cacheWriteTokens)
        };
        if (u.uncachedInputTokens || u.outputTokens || u.cacheReadTokens || u.cacheWriteTokens) return u;
      }
    } catch { /* projection cache invalid or absent — use own ledger */ }
    return meter.sessionUsage(sessionId);
  };

  // --- legacy route helpers -------------------------------------------------
  const serve = (cache, producer) => async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const now = Date.now();
    if (cache.body === null || now - cache.at >= cfg.cacheTtlMs) {
      try {
        const payload = await producer();
        cache.at = now;
        cache.body = JSON.stringify({ ok: true, ...payload, fetchedAt: new Date(now).toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cache.at = now;
        cache.body = JSON.stringify({ ok: false, error: message });
      }
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(cache.body);
  };

  const opencodeCache = { at: 0, body: null };
  const deepseekCache = { at: 0, body: null };
  let sessionCache = { key: "", at: 0, body: null };
  const providersCache = { at: 0, body: null };

  /** GET /opencode-quota — legacy shape: usage keyed by window name. */
  const produceOpenCode = async () => {
    const snap = await collectOne("opencode-go");
    if (!snap) return fail("opencode-go", "no-preset", "windows");
    if (snap.error) throw new Error(`OpenCode Go: ${snap.error}`);
    const usage = {};
    for (const w of snap.windows) usage[w.key] = w;
    return { provider: "opencode-go", usage };
  };

  /** GET /deepseek-quota — legacy shape: balance + all-sessions usage. */
  /** GET /deepseek-quota — legacy shape + daily/monthly cost. */
  const produceDeepSeek = async () => {
    const [snap, usage, priceStateNow, fx] = await Promise.all([
      collectOne("deepseek-official"),
      meter.aggregateAll(),
      ensurePrices(),
      ensureFx()
    ]);
    if (!snap) return fail("deepseek", "no-preset", "balance");
    if (snap.error) throw new Error(`DeepSeek: ${snap.error}`);

    /** Cost for a usage aggregate (calls estimateCost with average pricing). */
    const costOf = (u) => {
      if (u === null) return null;
      // Build a synthetic usage for cost estimation (average across all models).
      // We use a per-row approach below for accuracy; fallback to a simple
      // weighted average price.
      return { sessions: u.sessions, uncachedInputTokens: u.uncachedInputTokens,
        outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens };
    };

    // Per-row cost aggregation for daily/monthly/total (model-accurate pricing).
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    let totalCostUsd = 0, todayCostUsd = 0, monthCostUsd = 0;
    for (const r of meter.rows()) {
      const price = lookupPrice(r.model, priceStateNow.table);
      if (price === null) continue;
      const rowUsd = r.input * price.input + r.cacheRead * price.cacheRead + r.output * price.output;
      totalCostUsd += rowUsd;
      if (r.at >= todayStart) todayCostUsd += rowUsd;
      if (r.at >= monthStart) monthCostUsd += rowUsd;
    }
    const rate = fx.rate;
    const totalCost = totalCostUsd > 0 ? { total: totalCostUsd * rate } : null;
    const todayCost = todayCostUsd > 0 ? { total: todayCostUsd * rate } : null;
    const monthCost = monthCostUsd > 0 ? { total: monthCostUsd * rate } : null;

    return {
      provider: "deepseek",
      balance: snap.balance,
      totalCost,
      todayCost,
      monthCost,
      todayUsage: meter.aggregateToday(),
      monthUsage: meter.aggregateMonth()
    };
  };

  /** GET /quota-session?session=&provider=&model= — legacy shape. */
  const serveSession = async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    const sessionId = url.searchParams.get("session") ?? "";
    const provider = url.searchParams.get("provider") ?? "";
    const model = url.searchParams.get("model") ?? "";
    const cacheKey = `${sessionId}\u0000${model}`;
    const now = Date.now();
    if (sessionCache.key !== cacheKey || sessionCache.body === null || now - sessionCache.at >= cfg.sessionCacheTtlMs) {
      try {
        if (sessionId.length === 0) throw new Error("missing session parameter");
        const [usage, stats] = await Promise.all([
          sessionTokenUsage(sessionId),
          sessionStats(sessionId)
        ]);
        if (stats === null && usage === null) {
          sessionCache = {
            key: cacheKey,
            at: now,
            body: JSON.stringify({
              ok: true, stats: null, usage: null, cost: null, prices: null,
              fetchedAt: new Date(now).toISOString()
            })
          };
        } else {
          const [priceStateNow, fx] = await Promise.all([ensurePrices(), ensureFx()]);
          const price = lookupPrice(model, priceStateNow.table);
          const cost = price === null || usage === null ? null : estimateCost(usage, price, fx.rate);
          sessionCache = {
            key: cacheKey,
            at: now,
            body: JSON.stringify({
              ok: true,
              provider,
              model,
              stats,
              usage: usage === null ? null : {
                uncachedInputTokens: usage.uncachedInputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheWriteTokens: usage.cacheWriteTokens
              },
              cost,
              prices: price === null
                ? { source: priceStateNow.source, fetchedAt: new Date(priceStateNow.at).toISOString(), matched: null }
                : { source: priceStateNow.source, fetchedAt: new Date(priceStateNow.at).toISOString(), matched: price.key, rate: fx.rate, currency: "CNY" },
              fetchedAt: new Date(now).toISOString()
            })
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sessionCache = { key: cacheKey, at: now, body: JSON.stringify({ ok: false, error: message }) };
      }
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(sessionCache.body);
  };

  /** GET /quota-providers — NEW (additive): every configured/preset provider. */
  const produceProviders = async () => {
    const ids = [...new Set([...Object.keys(PRESETS), ...Object.keys(cfg.providers)])];
    const all = await Promise.all(
      ids.map(async (id) => {
        const preset = PRESETS[id];
        const userCfg = cfg.providers[id];
        const base = {
          id,
          label: userCfg?.label ?? preset?.label ?? id,
          kind: userCfg?.kind ?? preset?.kind ?? "windows",
          currency: userCfg?.currency ?? preset?.currency ?? "CNY",
          lowBalanceThreshold: userCfg?.lowBalanceThreshold ?? cfg.lowBalanceThreshold,
          ...(userCfg ? { ...userCfg } : {})
        };
        return {
          ...base,
          ...(await collectOne(id) ?? { error: "unconfigured" })
        };
      })
    );
    return { providers: all };
  };

  // --- route registration ---------------------------------------------------
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: "prefix", path: "/opencode-quota", handler: serve(opencodeCache, produceOpenCode) }),
      ctx.webServer.register({ kind: "prefix", path: "/deepseek-quota", handler: serve(deepseekCache, produceDeepSeek) }),
      ctx.webServer.register({ kind: "prefix", path: "/quota-session", handler: serveSession }),
      ctx.webServer.register({ kind: "prefix", path: "/quota-providers", handler: serve(providersCache, produceProviders) })
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "opencode-quota: quota routes");

  // --- boot the meter asynchronously (never blocks apply) -------------------
  meter.boot().catch(() => { /* ledger boot is best-effort */ });

  // Expose internals for tests / a future settings UI.
  ctx.runtime ??= {};
  ctx.runtime.opencodeQuota = { meter, collectOne, presets: PRESETS, config: cfg };
}

export { apply, inject, name };