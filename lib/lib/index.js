// dsh-opencode-quota — host face.
//
// Registers three same-origin JSON routes on the DSH web server:
//
//   GET /opencode-quota — OpenCode Go plan usage. Reads the opencode-go
//       access token from opencode's auth.json (never exposed), calls
//       GET https://opencode.ai/zen/go/v1/usage, and returns the normalized
//       rolling / weekly / monthly quota windows.
//
//   GET /deepseek-quota — DeepSeek API balance + local usage. Resolves the
//       DEEPSEEK_API_KEY through the DSH credentials service, calls
//       GET https://api.deepseek.com/user/balance, and aggregates the
//       durable per-session token totals persisted by the harness in
//       $DSH_HOME/storages/session_projcache.json.
//
//   GET /quota-session?session=<id>&provider=<p>&model=<m> — one session's
//       task stats (sessionStats + tokenUsage projections from the projection
//       cache) plus an ESTIMATED cost for the given model. Prices come from a
//       daily-refreshed table (litellm → openrouter → builtin fallback), the
//       USD→CNY rate from a daily FX fetch (frankfurter → 7.2 fallback), so
//       provider price changes (e.g. DeepSeek's) apply automatically next day.
//
// All responses are cached briefly so the browser polling loop does not
// hammer the upstream APIs. The browser half (lib/client.js) renders a
// floating monitor window at the bottom-left of the interface.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Stable cordis plugin name. */
const name = "opencode-quota";
/** Services required before the routes can be registered. */
const inject = ["webServer", "credentials"];
/** The official OpenCode Go usage endpoint (opencode CLI's own source of truth). */
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
/** The official DeepSeek balance endpoint. */
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
/** Quota windows reported by the OpenCode API, in display order. */
const WINDOWS = ["rolling", "weekly", "monthly"];
/** How long a fetched payload is served from the in-memory cache. */
const CACHE_TTL_MS = 5_000;
/** Upstream request timeout. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Daily price-table refresh: fetched at most once per day (per process). */
const PRICE_TTL_MS = 24 * 3600 * 1_000;
/** Daily FX-rate refresh. */
const FX_TTL_MS = 24 * 3600 * 1_000;
/** Fallback USD→CNY rate when the daily FX fetch fails. */
const BUILTIN_RATE = 7.2;
/** Per-session stats route cache TTL. */
const SESSION_CACHE_TTL_MS = 2_000;

/** Price-table sources, tried in order (all JSON). */
const PRICE_SOURCES = [
  { id: "litellm", url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json" },
  { id: "openrouter", url: "https://openrouter.ai/api/v1/models" }
];
/** Daily FX rate (USD base, ECB-published). */
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=CNY";

/** Builtin USD-per-token fallbacks (offline); the daily fetch normally replaces them. */
const BUILTIN_PRICES = [
  { match: /deepseek/i, input: 2.8e-7, output: 4.2e-7, cacheRead: 2.8e-8 },
  { match: /sonnet/i, input: 3e-6, output: 15e-6, cacheRead: 3e-7 },
  { match: /opus/i, input: 15e-6, output: 75e-6, cacheRead: 1.5e-6 },
  { match: /haiku/i, input: 1e-6, output: 5e-6, cacheRead: 1e-7 },
  { match: /gpt-5/i, input: 1.25e-6, output: 10e-6, cacheRead: 1.25e-7 },
  { match: /gemini/i, input: 1.25e-6, output: 10e-6, cacheRead: 1.25e-7 },
  { match: /.*/, input: 2e-6, output: 8e-6, cacheRead: 5e-7 }
];

/** Resolve the DSH home directory (env wins, same rule as dsh-home-paths). */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** The durable per-session projection cache written by session-projection-cache. */
function projCachePath() {
  return join(dshHome(), "storages", "session_projcache.json");
}

/**
 * Candidate auth.json locations, in probe order. Override with the
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
async function loadToken() {
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

/** Strip the access token out of any string that may reach a log or the client. */
function redact(text, token) {
  return token ? String(text).replaceAll(token, "[redacted]") : String(text);
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

/** Parse the durable projection cache once per call. */
async function readProjCache() {
  try {
    return JSON.parse(await readFile(projCachePath(), "utf8"));
  } catch {
    return null;
  }
}

//#region price & fx (daily refresh + in-memory cache)
/** Current price-table state; `source: "builtin"` until a fetch succeeds. */
let priceState = { at: 0, table: null, source: "builtin" };
/** Current FX state. */
let fxState = { at: 0, rate: BUILTIN_RATE, source: "builtin" };

/** Refresh the price table if the daily TTL elapsed (fetches at most once a day). */
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
 * @param model - model id ("deepseek-v4-flash", "claude-sonnet-4", ...).
 * @param table - the fetched price table (litellm or openrouter shape), or null.
 * @returns { input, output, cacheRead, key, source } or null when unknown.
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
//#endregion

//#region upstream fetchers
/**
 * Fetch and validate the usage payload from the zen API.
 * @param token - the opencode-go access token.
 * @returns normalized windows keyed by window name.
 */
async function fetchUsage(token) {
  const res = await fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenCode Go API error ${res.status}: ${redact(text, token).slice(0, 200)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("OpenCode Go API returned a non-JSON response");
  }
  const usage = payload?.usage;
  if (usage === null || typeof usage !== "object") {
    throw new Error("OpenCode Go API response is missing the usage object");
  }
  const out = {};
  for (const windowKey of WINDOWS) {
    const win = usage[windowKey];
    if (
      win === null ||
      typeof win !== "object" ||
      win.status !== "ok" ||
      typeof win.percent !== "number" ||
      !Number.isFinite(win.percent) ||
      typeof win.resetsAt !== "string"
    ) {
      throw new Error(`OpenCode Go API response is missing a valid "${windowKey}" window`);
    }
    out[windowKey] = {
      status: "ok",
      percent: win.percent,
      percentRemaining: Math.max(0, 100 - win.percent),
      resetsAt: win.resetsAt
    };
  }
  return out;
}

/**
 * Fetch and validate the DeepSeek balance payload.
 * @param apiKey - the DeepSeek API key.
 * @returns normalized balance info.
 */
async function fetchBalance(apiKey) {
  const res = await fetch(DEEPSEEK_BALANCE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek API error ${res.status}: ${redact(text, apiKey).slice(0, 200)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("DeepSeek API returned a non-JSON response");
  }
  if (typeof payload !== "object" || payload === null || typeof payload.is_available !== "boolean") {
    throw new Error("DeepSeek API response is missing is_available");
  }
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  const info = infos[0] ?? {};
  const toBalance = (value) => {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    isAvailable: payload.is_available,
    currency: typeof info.currency === "string" ? info.currency : "CNY",
    totalBalance: toBalance(info.total_balance),
    grantedBalance: toBalance(info.granted_balance),
    toppedUpBalance: toBalance(info.topped_up_balance)
  };
}

/**
 * Aggregate durable per-session token totals from the projection cache.
 * Returns null when the cache is missing or holds no token usage yet.
 */
async function aggregateLocalUsage() {
  const cache = await readProjCache();
  const tables = cache?.tables?.sessions;
  if (tables === null || typeof tables !== "object") return null;
  let sessions = 0;
  let uncachedInputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  for (const row of Object.values(tables)) {
    const totals = row?.rows?.tokenUsage?.val?.totals;
    if (totals === null || typeof totals !== "object") continue;
    sessions += 1;
    uncachedInputTokens += toCount(totals.uncachedInputTokens);
    outputTokens += toCount(totals.outputTokens);
    cacheReadTokens += toCount(totals.cacheReadTokens);
    cacheWriteTokens += toCount(totals.cacheWriteTokens);
  }
  if (sessions === 0) return null;
  return {
    sessions,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  };
}

/**
 * One session's task stats + token usage from the projection cache.
 * @param sessionId - the session id.
 * @returns { stats, usage } or null when the session has no cached rows.
 */
async function readSessionProjections(sessionId) {
  const cache = await readProjCache();
  const row = cache?.tables?.sessions?.[sessionId];
  if (row === null || typeof row !== "object") return null;
  const stats = row.rows?.sessionStats?.val;
  const totals = row.rows?.tokenUsage?.val?.totals;
  if (stats === null || typeof stats !== "object" || totals === null || typeof totals !== "object") return null;
  return {
    stats: {
      turns: toCount(stats.turns),
      steps: toCount(stats.steps),
      llmMs: typeof stats.llmMs === "number" && Number.isFinite(stats.llmMs) ? stats.llmMs : null,
      toolMs: typeof stats.toolMs === "number" && Number.isFinite(stats.toolMs) ? stats.toolMs : null,
      decodeMs: typeof stats.decodeMs === "number" && Number.isFinite(stats.decodeMs) ? stats.decodeMs : null,
      decodeTokens: toCount(stats.decodeTokens)
    },
    usage: {
      uncachedInputTokens: toCount(totals.uncachedInputTokens),
      outputTokens: toCount(totals.outputTokens),
      cacheReadTokens: toCount(totals.cacheReadTokens),
      cacheWriteTokens: toCount(totals.cacheWriteTokens)
    }
  };
}

/**
 * Estimate the cost of a session's token usage for a model, in CNY.
 * @param usage - session token totals.
 * @param price - USD per-token prices.
 * @param rate - USD→CNY rate.
 * @returns { input, output, cacheRead, total } in CNY, and `{ source, key }` meta.
 */
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
//#endregion

/** One shared route cache entry. */
function makeCache() {
  return { at: 0, body: null };
}

/**
 * Mount the quota routes.
 * @param ctx - host plugin context carrying webServer and credentials.
 */
function apply(ctx) {
  const opencodeCache = makeCache();
  const deepseekCache = makeCache();
  let sessionCache = { key: "", at: 0, body: null };

  /** Route handler factory: serve cached JSON, refetch past the TTL. */
  const serve = (cache, producer) => async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const now = Date.now();
    if (cache.body === null || now - cache.at >= CACHE_TTL_MS) {
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
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache"
    });
    res.end(cache.body);
  };

  const produceOpenCode = async () => {
    const cred = await loadToken();
    if (cred === null) {
      throw new Error(
        `opencode-go token not found (probed ${authCandidates().join(", ")}) — run "opencode auth login" first`
      );
    }
    const usage = await fetchUsage(cred.token);
    return { provider: "opencode-go", usage };
  };

  const produceDeepSeek = async () => {
    const cred = await ctx.credentials.resolve("DEEPSEEK_API_KEY");
    if (cred === void 0 || typeof cred.value !== "string" || cred.value.length === 0) {
      throw new Error('DEEPSEEK_API_KEY not configured — add it to the DSH credentials or environment');
    }
    const [balance, usage] = await Promise.all([fetchBalance(cred.value), aggregateLocalUsage()]);
    return { provider: "deepseek", balance, usage };
  };

  /** GET /quota-session?session=<id>&provider=<p>&model=<m> */
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
    if (sessionCache.key !== cacheKey || sessionCache.body === null || now - sessionCache.at >= SESSION_CACHE_TTL_MS) {
      try {
        if (sessionId.length === 0) throw new Error("missing session parameter");
        const projections = await readSessionProjections(sessionId);
        if (projections === null) {
          sessionCache = { key: cacheKey, at: now, body: JSON.stringify({ ok: true, stats: null, usage: null, cost: null, prices: null, fetchedAt: new Date(now).toISOString() }) };
        } else {
          const [priceStateNow, fx] = await Promise.all([ensurePrices(), ensureFx()]);
          const price = lookupPrice(model, priceStateNow.table);
          const cost = price === null ? null : estimateCost(projections.usage, price, fx.rate);
          sessionCache = {
            key: cacheKey,
            at: now,
            body: JSON.stringify({
              ok: true,
              provider,
              model,
              stats: projections.stats,
              usage: projections.usage,
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
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache"
    });
    res.end(sessionCache.body);
  };

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: "prefix",
        path: "/opencode-quota",
        handler: serve(opencodeCache, produceOpenCode)
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/deepseek-quota",
        handler: serve(deepseekCache, produceDeepSeek)
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/quota-session",
        handler: serveSession
      })
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "opencode-quota: quota routes");
}

export { apply, inject, name };
