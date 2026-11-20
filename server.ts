import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { get as httpsGet } from "node:https";

// --- Quantum Core Engine ---
import { ConfigManager } from "./Quantum_Monitor_System/1_Core_Engine/ConfigManager/ConfigManager.js";
import { eventBus } from "./Quantum_Monitor_System/1_Core_Engine/EventBus/EventBus.js";
import { AlertEngine } from "./Quantum_Monitor_System/1_Core_Engine/AlertEngine/AlertEngine.js";
import { LifecycleController } from "./Quantum_Monitor_System/1_Core_Engine/LifecycleController/LifecycleController.js";
import { BinanceMonitorModule } from "./Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/module_entry/BinanceMonitorModule.js";
import { BinanceApiClient } from "./Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/api_client/BinanceApiClient.js";
import { SinaFuturesApiClient } from "./Quantum_Monitor_System/2_Market_Modules/Futures_CN/api_client/SinaFuturesApiClient.js";
import { FuturesCnMonitorModule } from "./Quantum_Monitor_System/2_Market_Modules/Futures_CN/module_entry/FuturesCnMonitorModule.js";
import { YahooFuturesApiClient } from "./Quantum_Monitor_System/2_Market_Modules/Futures_Global/api_client/YahooFuturesApiClient.js";
import { FuturesGlobalMonitorModule } from "./Quantum_Monitor_System/2_Market_Modules/Futures_Global/module_entry/FuturesGlobalMonitorModule.js";
import { NewsAggregator, normalizeNewsSettings } from "./Quantum_Monitor_System/2_Market_Modules/Macro_News/NewsAggregator.js";
import { EastMoneyStocksCnHeatApiClient } from "./Quantum_Monitor_System/2_Market_Modules/Stocks_CN/api_client/EastMoneyStocksCnHeatApiClient.js";
import { StocksCnHeatMonitorModule } from "./Quantum_Monitor_System/2_Market_Modules/Stocks_CN/module_entry/StocksCnHeatMonitorModule.js";
import { YahooUsStocksApiClient } from "./Quantum_Monitor_System/2_Market_Modules/Stocks_US/api_client/YahooUsStocksApiClient.js";
import { StocksUsMonitorModule } from "./Quantum_Monitor_System/2_Market_Modules/Stocks_US/module_entry/StocksUsMonitorModule.js";
import { checkKlineFreshness } from "./Quantum_Monitor_System/4_Shared_Types/data_quality/MarketDataQuality.js";
import { mapMarketSymbol } from "./Quantum_Monitor_System/4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.js";
import { SystemEvents } from "./Quantum_Monitor_System/4_Shared_Types/standard_models/eventTypes.js";
import type { AppSettings, MarketModuleName, StandardMarketTick } from "./Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes.js";
import type { BinanceInterval } from "./Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/api_client/IBinanceApiClient.js";
import type { CnFuturesInterval } from "./Quantum_Monitor_System/2_Market_Modules/Futures_CN/api_client/IFuturesCnApiClient.js";
import type { GlobalFuturesInterval } from "./Quantum_Monitor_System/2_Market_Modules/Futures_Global/api_client/IFuturesGlobalApiClient.js";
import type { UsStocksInterval } from "./Quantum_Monitor_System/2_Market_Modules/Stocks_US/api_client/IUsStocksApiClient.js";

type IndexSource = "sina-index" | "yahoo-stock" | "yahoo-future";

interface MarketIndexDefinition {
  label: string;
  symbol: string;
  market: string;
  source: IndexSource;
}

interface MarketIndexQuote {
  symbol: string;
  label: string;
  market: string;
  price: number | null;
  changePercent: number | null;
  updated_at: string;
  status: "ok" | "error";
  error?: string;
}

interface CandleLike {
  close: number;
  time?: string | number;
}

const SETTINGS_SECRET_PLACEHOLDER = "********";

// ---------------------------------------------------------------------------
// Quantum Core bootstrap
// ---------------------------------------------------------------------------
const configManager = new ConfigManager();
const initialSettings = withDefaultSettings(await configManager.load());
applyApiEndpointSettings(initialSettings);
const lifecycle = new LifecycleController(eventBus);
const alertEngine = new AlertEngine(eventBus, configManager);
const newsAggregator = new NewsAggregator();
const binanceApiClient = new BinanceApiClient();
const sinaFuturesApiClient = new SinaFuturesApiClient();
const yahooFuturesApiClient = new YahooFuturesApiClient();
const yahooUsStocksApiClient = new YahooUsStocksApiClient();
const eastMoneyStocksCnHeatApiClient = new EastMoneyStocksCnHeatApiClient();
const binanceModule = new BinanceMonitorModule(eventBus, configManager, binanceApiClient);
const futuresCnModule = new FuturesCnMonitorModule(eventBus, configManager, sinaFuturesApiClient);
const futuresGlobalModule = new FuturesGlobalMonitorModule(eventBus, configManager, yahooFuturesApiClient);
const stocksCnHeatModule = new StocksCnHeatMonitorModule(eventBus, configManager, eastMoneyStocksCnHeatApiClient);
const stocksUsModule = new StocksUsMonitorModule(eventBus, configManager, yahooUsStocksApiClient);
lifecycle.register(binanceModule);
lifecycle.register(futuresCnModule);
lifecycle.register(futuresGlobalModule);
lifecycle.register(stocksCnHeatModule);
lifecycle.register(stocksUsModule);
alertEngine.start().catch(err => {
  console.error("[Quantum] AlertEngine start failed:", err);
});
let newsRefreshTimer: NodeJS.Timeout | null = null;
let newsRefreshInFlight = false;
scheduleNewsBackgroundRefresh(5_000);

function applyApiEndpointSettings(settings: AppSettings): void {
  const api = settings.ApiEndpointSettings;
  if (!api) return;

  process.env.BINANCE_FAPI_BASE = api.binance_fapi_base || process.env.BINANCE_FAPI_BASE;
  process.env.BINANCE_WS_BASE = api.binance_ws_base || process.env.BINANCE_WS_BASE;
  process.env.BINANCE_USE_ALL_TICKER_STREAM = String(api.binance_use_all_ticker_stream);
  process.env.SINA_MIN_LINE_URL = api.sina_min_line_url || process.env.SINA_MIN_LINE_URL;
  process.env.SINA_QUOTE_URL = api.sina_quote_url || process.env.SINA_QUOTE_URL;
  process.env.YAHOO_CHART_BASE = api.yahoo_chart_base || process.env.YAHOO_CHART_BASE;
  process.env.TRADINGVIEW_WIDGET_URL = api.tradingview_widget_url || process.env.TRADINGVIEW_WIDGET_URL;

  if (api.socks_proxy) {
    process.env.SOCKS_PROXY = api.socks_proxy;
  } else {
    delete process.env.SOCKS_PROXY;
  }

  if (api.https_proxy) {
    process.env.HTTPS_PROXY = api.https_proxy;
  } else {
    delete process.env.HTTPS_PROXY;
  }
}

function scheduleNewsBackgroundRefresh(delayMs: number): void {
  if (newsRefreshTimer) clearTimeout(newsRefreshTimer);
  newsRefreshTimer = setTimeout(() => {
    void refreshNewsInBackground();
  }, delayMs);
}

async function refreshNewsInBackground(): Promise<void> {
  let nextDelayMs = 60_000;
  try {
    const settings = withDefaultSettings(await configManager.load());
    const newsSettings = normalizeNewsSettings(settings.NewsSettings);
    nextDelayMs = Math.max(30, newsSettings.breaking_refresh_seconds) * 1000;
    if (!newsSettings.enabled || newsRefreshInFlight) return;
    newsRefreshInFlight = true;
    await newsAggregator.getSummary(newsSettings, false);
  } catch (err) {
    console.warn("[Quantum] Background news refresh failed:", err);
  } finally {
    newsRefreshInFlight = false;
    scheduleNewsBackgroundRefresh(nextDelayMs);
  }
}

function validateAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    throw new Error("settings body must be an object");
  }

  const requiredSections = [
    "GlobalSettings",
    "BinanceSettings",
    "CustomMarketSettings",
    "AlertSettings",
    "ApiEndpointSettings",
    "RefreshIntervalSettings",
    "NewsSettings",
  ];
  for (const section of requiredSections) {
    if (!isRecord(value[section])) {
      throw new Error(`settings.${section} must be an object`);
    }
  }

  const settings = value as unknown as AppSettings;
  if (!Array.isArray(settings.GlobalSettings.auto_start_modules)) {
    throw new Error("GlobalSettings.auto_start_modules must be an array");
  }
  for (const key of ["cn_stocks_list", "us_stocks_list", "cn_futures_list", "futures_global_list"] as const) {
    if (!Array.isArray(settings.CustomMarketSettings[key])) {
      throw new Error(`CustomMarketSettings.${key} must be an array`);
    }
  }
  if (typeof settings.BinanceSettings.monitor_top_volume !== "number") {
    throw new Error("BinanceSettings.monitor_top_volume must be a number");
  }
  if (typeof settings.AlertSettings.enabled !== "boolean") {
    throw new Error("AlertSettings.enabled must be a boolean");
  }
  if (!isRecord(settings.AlertSettings.thresholds)) {
    throw new Error("AlertSettings.thresholds must be an object");
  }

  const api = settings.ApiEndpointSettings;
  for (const key of [
    "binance_fapi_base",
    "binance_ws_base",
    "socks_proxy",
    "https_proxy",
    "sina_min_line_url",
    "sina_quote_url",
    "yahoo_chart_base",
    "tradingview_widget_url",
  ] as const) {
    if (typeof api[key] !== "string") {
      throw new Error(`ApiEndpointSettings.${key} must be a string`);
    }
  }
  if (typeof api.binance_use_all_ticker_stream !== "boolean") {
    throw new Error("ApiEndpointSettings.binance_use_all_ticker_stream must be a boolean");
  }

  for (const [market, intervals] of Object.entries(settings.RefreshIntervalSettings ?? {})) {
    if (!isRecord(intervals)) {
      throw new Error(`RefreshIntervalSettings.${market} must be an object`);
    }
    for (const key of ["price_seconds", "ma60_1m_seconds", "ma60_15m_seconds", "ma60_1d_seconds"] as const) {
      if (typeof intervals[key] !== "number" || !Number.isFinite(intervals[key]) || intervals[key] <= 0) {
        throw new Error(`RefreshIntervalSettings.${market}.${key} must be a positive number`);
      }
    }
  }

  const news = settings.NewsSettings;
  if (typeof news.enabled !== "boolean") {
    throw new Error("NewsSettings.enabled must be a boolean");
  }
  for (const key of ["key_refresh_seconds", "breaking_refresh_seconds", "cache_limit"] as const) {
    if (typeof news[key] !== "number" || !Number.isFinite(news[key]) || news[key] <= 0) {
      throw new Error(`NewsSettings.${key} must be a positive number`);
    }
  }
  if (typeof news.translate_english !== "boolean") {
    throw new Error("NewsSettings.translate_english must be a boolean");
  }
  if (news.translation_provider !== "none" && news.translation_provider !== "mymemory") {
    throw new Error("NewsSettings.translation_provider must be none or mymemory");
  }
  if (typeof news.translation_api_url !== "string") {
    throw new Error("NewsSettings.translation_api_url must be a string");
  }
  if (typeof news.ai_analysis_enabled !== "boolean") {
    throw new Error("NewsSettings.ai_analysis_enabled must be a boolean");
  }
  if (news.ai_provider !== "none" && news.ai_provider !== "google" && news.ai_provider !== "openai_compatible") {
    throw new Error("NewsSettings.ai_provider must be none, google or openai_compatible");
  }
  if (typeof news.ai_api_base !== "string") {
    throw new Error("NewsSettings.ai_api_base must be a string");
  }
  if (typeof news.ai_api_key !== "string") {
    throw new Error("NewsSettings.ai_api_key must be a string");
  }
  if (typeof news.ai_model !== "string") {
    throw new Error("NewsSettings.ai_model must be a string");
  }
  if (!Array.isArray(news.sources)) {
    throw new Error("NewsSettings.sources must be an array");
  }
  for (const source of news.sources) {
    if (!isRecord(source) || typeof source.id !== "string" || typeof source.label !== "string" || typeof source.url !== "string" || typeof source.enabled !== "boolean") {
      throw new Error("NewsSettings.sources items must include id, label, url and enabled");
    }
  }

  return withDefaultSettings(settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withDefaultSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    NewsSettings: normalizeNewsSettings(settings.NewsSettings),
  };
}

function settingsForClient(settings: AppSettings): AppSettings {
  const normalized = withDefaultSettings(settings);
  return {
    ...normalized,
    NewsSettings: {
      ...normalized.NewsSettings,
      ai_api_key: normalized.NewsSettings.ai_api_key ? SETTINGS_SECRET_PLACEHOLDER : "",
    },
  };
}

function preserveSettingsSecrets(next: AppSettings, current: AppSettings): AppSettings {
  const normalizedNext = withDefaultSettings(next);
  const normalizedCurrent = withDefaultSettings(current);
  const incomingKey = normalizedNext.NewsSettings.ai_api_key;
  return {
    ...normalizedNext,
    NewsSettings: {
      ...normalizedNext.NewsSettings,
      ai_api_key: incomingKey === SETTINGS_SECRET_PLACEHOLDER
        ? normalizedCurrent.NewsSettings.ai_api_key
        : incomingKey,
    },
  };
}

async function persistModuleRunPreference(moduleName: MarketModuleName, shouldRun: boolean): Promise<AppSettings> {
  const settings = withDefaultSettings(await configManager.load());
  const registered = new Set(lifecycle.getRegisteredModuleNames());
  const currentAutoStart = settings.GlobalSettings.auto_start_modules.filter((name) => registered.has(name));
  const nextAutoStart = shouldRun
    ? Array.from(new Set([...currentAutoStart, moduleName]))
    : currentAutoStart.filter((name) => name !== moduleName);
  const nextSettings: AppSettings = {
    ...settings,
    GlobalSettings: {
      ...settings.GlobalSettings,
      auto_start_modules: nextAutoStart,
    },
  };
  await configManager.save(nextSettings);
  eventBus.publish(SystemEvents.SettingsUpdated, nextSettings);
  return nextSettings;
}

async function reconcileModulesWithAutoStart(settings: AppSettings, broadcast?: () => void): Promise<void> {
  const targetModules = new Set(settings.GlobalSettings.auto_start_modules);
  for (const moduleName of lifecycle.getRegisteredModuleNames()) {
    const status = lifecycle.getStatus(moduleName);
    const shouldRun = targetModules.has(moduleName);
    try {
      if (shouldRun && status !== "running" && status !== "starting") {
        await lifecycle.start(moduleName);
      }
      if (!shouldRun && status !== "sleeping" && status !== "stopping" && status !== "destroyed") {
        await lifecycle.stop(moduleName);
        clearLatestTicksForModule(moduleName);
      }
    } catch (err) {
      console.error(`[Quantum] Failed to reconcile ${moduleName} with saved auto_start_modules:`, err);
    }
  }
  broadcast?.();
}

// Latest tick cache: UI clients that connect late still get a full snapshot
const latestTicks = new Map<string, StandardMarketTick>();
const latestTickCleanup = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, tick] of latestTicks.entries()) {
    if (Date.parse(tick.updated_at) < cutoff) {
      latestTicks.delete(key);
    }
  }
}, 10 * 60 * 1000);

const majorIndexDefinitions: MarketIndexDefinition[] = [
  { label: "上证指数", symbol: "sh000001", market: "A股", source: "sina-index" },
  { label: "深证成指", symbol: "sz399001", market: "A股", source: "sina-index" },
  { label: "创业板指", symbol: "sz399006", market: "A股", source: "sina-index" },
  { label: "标普500", symbol: "^GSPC", market: "美股", source: "yahoo-stock" },
  { label: "纳斯达克", symbol: "^IXIC", market: "美股", source: "yahoo-stock" },
  { label: "道琼斯", symbol: "^DJI", market: "美股", source: "yahoo-stock" },
  { label: "VIX", symbol: "^VIX", market: "波动率", source: "yahoo-stock" },
  { label: "美元指数", symbol: "DX-Y.NYB", market: "外汇", source: "yahoo-stock" },
  { label: "黄金连续", symbol: "GC=F", market: "商品", source: "yahoo-future" },
  { label: "WTI原油", symbol: "CL=F", market: "商品", source: "yahoo-future" },
];

let marketIndexCache: { updated_at: string; items: MarketIndexQuote[] } | null = null;
let marketIndexCacheAt = 0;

eventBus.subscribe(SystemEvents.MarketDataUpdated, (payload) => {
  latestTicks.set(`${payload.market}:${payload.symbol}`, { ...payload });
});

function clearLatestTicksForModule(moduleName: MarketModuleName): void {
  for (const key of Array.from(latestTicks.keys())) {
    if (key.startsWith(`${moduleName}:`)) {
      latestTicks.delete(key);
    }
  }
}

async function getMarketIndexSummary(force = false): Promise<{ updated_at: string; items: MarketIndexQuote[] }> {
  const cacheMs = 60_000;
  if (!force && marketIndexCache && Date.now() - marketIndexCacheAt < cacheMs) {
    return marketIndexCache;
  }

  const items = await Promise.all(majorIndexDefinitions.map((definition) => getMarketIndexQuote(definition)));
  const summary = {
    updated_at: new Date().toISOString(),
    items,
  };
  marketIndexCache = summary;
  marketIndexCacheAt = Date.now();
  return summary;
}

async function getMarketIndexQuote(definition: MarketIndexDefinition): Promise<MarketIndexQuote> {
  try {
    if (definition.source === "sina-index") {
      return await getSinaIndexQuote(definition);
    }

    const candles = definition.source === "yahoo-future"
      ? await yahooFuturesApiClient.getKlines(definition.symbol, "1d", 5)
      : await yahooUsStocksApiClient.getKlines(definition.symbol, "1d", 5);
    const quote = quoteFromCandles(candles);
    if (!quote) throw new Error("not enough candles");
    return {
      symbol: definition.symbol,
      label: definition.label,
      market: definition.market,
      price: quote.price,
      changePercent: quote.changePercent,
      updated_at: quote.updated_at,
      status: "ok",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      symbol: definition.symbol,
      label: definition.label,
      market: definition.market,
      price: null,
      changePercent: null,
      updated_at: new Date().toISOString(),
      status: "error",
      error: message.slice(0, 120),
    };
  }
}

async function getSinaIndexQuote(definition: MarketIndexDefinition): Promise<MarketIndexQuote> {
  const base = process.env.SINA_QUOTE_URL || "https://hq.sinajs.cn/list=";
  const url = `${base}${definition.symbol}`;
  const body = await requestText(url);
  const match = body.match(/="([^"]*)"/);
  const fields = match?.[1]?.split(",") ?? [];
  const previousClose = Number(fields[2]);
  const current = Number(fields[3]);
  if (!Number.isFinite(current) || !Number.isFinite(previousClose) || previousClose === 0) {
    throw new Error("invalid Sina index quote");
  }
  return {
    symbol: definition.symbol,
    label: definition.label,
    market: definition.market,
    price: current,
    changePercent: ((current - previousClose) / previousClose) * 100,
    updated_at: new Date().toISOString(),
    status: "ok",
  };
}

function quoteFromCandles(candles: CandleLike[]): { price: number; changePercent: number; updated_at: string } | null {
  const usable = candles.filter((candle) => Number.isFinite(candle.close));
  if (usable.length < 2) return null;
  const latest = usable.at(-1);
  const previous = usable.at(-2);
  if (!latest || !previous || previous.close === 0) return null;
  const time = typeof latest.time === "string"
    ? latest.time
    : typeof latest.time === "number"
      ? new Date(latest.time * 1000).toISOString()
      : new Date().toISOString();
  return {
    price: latest.close,
    changePercent: ((latest.close - previous.close) / previous.close) * 100,
    updated_at: time,
  };
}

function requestText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, {
      headers: {
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Connection: "close",
        Referer: "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0",
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk as Buffer));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("binary");
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
          return;
        }
        resolve(body);
      });
    });
    req.setTimeout(10_000, () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

// Auto-start configured modules only. Binance can be disabled while its network
// outlet is unavailable, so other markets keep a clean startup.
(async () => {
  const registeredModules = new Set(lifecycle.getRegisteredModuleNames());
  for (const moduleName of initialSettings.GlobalSettings.auto_start_modules.filter((name) => registeredModules.has(name))) {
    try {
      await lifecycle.start(moduleName);
      console.log(`[Quantum] ${moduleName} module started.`);
    } catch (err) {
      console.error(`[Quantum] Failed to start ${moduleName}:`, err);
    }
  }
})();

// ---------------------------------------------------------------------------
// Express server
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = withDefaultSettings(await configManager.load());
      res.json(settingsForClient(settings));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const currentSettings = withDefaultSettings(await configManager.load());
      const settings = preserveSettingsSecrets(validateAppSettings(req.body), currentSettings);
      await configManager.save(settings);
      applyApiEndpointSettings(settings);
      eventBus.publish(SystemEvents.SettingsUpdated, settings);
      void reconcileModulesWithAutoStart(settings, broadcastSnapshot);
      res.json({ ok: true, settings: settingsForClient(settings), modules: "sync_scheduled" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.get("/api/settings/test-endpoints", async (_req, res) => {
    const settings = withDefaultSettings(await configManager.load());
    applyApiEndpointSettings(settings);

    const startedAt = Date.now();
    const results = await Promise.all([
      testEndpoint("binance_fapi", async () => {
        const symbols = await binanceApiClient.getTopSymbolsByVolume(1);
        return `top symbol ${symbols[0] ?? "none"}`;
      }),
      testEndpoint("sina_futures", async () => {
        const mapping = mapMarketSymbol("C0", "Futures_CN");
        const [candles, quote] = await Promise.all([
          sinaFuturesApiClient.getKlines(mapping.dataSymbol, "1m", 5),
          sinaFuturesApiClient.getQuote(mapping.dataSymbol),
        ]);
        const quality = checkKlineFreshness(candles, 10 * 24 * 60 * 60 * 1000);
        return `${candles.length} candles, ${quality.status}, quote ${quote?.date ?? "none"}`;
      }),
      testEndpoint("yahoo_futures", async () => {
        const mapping = mapMarketSymbol("GC1!", "Futures_Global");
        const candles = await yahooFuturesApiClient.getKlines(mapping.dataSymbol, "1m", 5);
        const quality = checkKlineFreshness(candles, 30 * 60 * 1000);
        return `${candles.length} candles, ${quality.status}`;
      }),
      testEndpoint("yahoo_us_stocks", async () => {
        const mapping = mapMarketSymbol("AAPL", "Stocks_US");
        const candles = await yahooUsStocksApiClient.getKlines(mapping.dataSymbol, "1m", 5);
        const quality = checkKlineFreshness(candles, 24 * 60 * 60 * 1000);
        return `${candles.length} candles, ${quality.status}`;
      }),
      testEndpoint("eastmoney_stocks_cn_heat", async () => {
        const [sectors, stocks] = await Promise.all([
          eastMoneyStocksCnHeatApiClient.getSectorHeat("industry", 3),
          eastMoneyStocksCnHeatApiClient.getHotStocks(3),
        ]);
        return `${sectors.length} sectors, ${stocks.length} hot stock rows`;
      }),
      testEndpoint("tradingview_widget", async () => {
        const url = new URL(settings.ApiEndpointSettings.tradingview_widget_url);
        if (url.protocol !== "https:") {
          throw new Error("TradingView widget URL must use https");
        }
        return `browser-side widget URL configured: ${url.host}`;
      }),
      testEndpoint("macro_news", async () => {
        const summary = await newsAggregator.getSummary(settings.NewsSettings, true);
        return `${summary.key.length} key, ${summary.breaking.length} breaking, ${summary.errors.length} source errors`;
      }),
    ]);

    res.json({
      ok: results.every((result) => result.ok),
      elapsed_ms: Date.now() - startedAt,
      results,
    });
  });

  // =========================================================================
  // Quantum SSE & API endpoints
  // =========================================================================

  // --- SSE stream ---
  let quantumClients: express.Response[] = [];

  const broadcastSnapshot = () => {
    const snapshot = Array.from(latestTicks.values()).map(tick => ({ ...tick }));
    const msg = `data: ${JSON.stringify({ type: "snapshot", data: snapshot })}\n\n`;
    for (const client of quantumClients) {
      client.write(msg);
    }
  };

  // Forward EventBus ticks to all SSE clients
  eventBus.subscribe(SystemEvents.MarketDataUpdated, (payload) => {
    if (quantumClients.length === 0) return;
    const msg = `data: ${JSON.stringify({ type: "tick", data: { ...payload } })}\n\n`;
    for (const client of quantumClients) {
      client.write(msg);
    }
  });

  eventBus.subscribe(SystemEvents.ModuleStatusChanged, (payload) => {
    if (quantumClients.length === 0) return;
    const msg = `data: ${JSON.stringify({ type: "module_status", data: payload })}\n\n`;
    for (const client of quantumClients) {
      client.write(msg);
    }
  });

  eventBus.subscribe(SystemEvents.AlertRaised, (payload) => {
    if (quantumClients.length === 0) return;
    const msg = `data: ${JSON.stringify({ type: "alert", data: payload })}\n\n`;
    for (const client of quantumClients) {
      client.write(msg);
    }
  });

  eventBus.subscribe(SystemEvents.StocksCnHeatUpdated, (payload) => {
    if (quantumClients.length === 0) return;
    const msg = `data: ${JSON.stringify({ type: "stocks_cn_heat", data: payload })}\n\n`;
    for (const client of quantumClients) {
      client.write(msg);
    }
  });

  app.get("/api/quantum/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    quantumClients.push(res);

    // Send initial snapshot so late-joiners get full state
    const snapshot = Array.from(latestTicks.values()).map(tick => ({ ...tick }));
    if (snapshot.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "snapshot", data: snapshot })}\n\n`);
    }

    // Send current module statuses
    const moduleStatuses = lifecycle.getAllStatuses();
    res.write(`data: ${JSON.stringify({ type: "module_statuses", data: moduleStatuses })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "stocks_cn_heat", data: stocksCnHeatModule.getSnapshot() })}\n\n`);

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: "heartbeat", ts: Date.now() })}\n\n`);
    }, 15000);

    _req.on("close", () => {
      clearInterval(heartbeat);
      quantumClients = quantumClients.filter((c) => c !== res);
    });
  });

  app.get("/api/news/summary", async (req, res) => {
    try {
      const settings = withDefaultSettings(await configManager.load());
      if (!settings.NewsSettings.enabled) {
        res.json({
          key: [],
          breaking: [],
          ai_highlights: [],
          analyzer: {
            enabled: false,
            provider: "none",
            status: "disabled",
            message: "News aggregation is disabled",
          },
          updated_at: new Date().toISOString(),
          source_count: 0,
          errors: [],
        });
        return;
      }
      const force = String(req.query.force || "") === "1";
      const summary = await newsAggregator.getSummary(settings.NewsSettings, force);
      res.json(summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get("/api/market-indices", async (req, res) => {
    try {
      const force = String(req.query.force || "") === "1";
      res.json(await getMarketIndexSummary(force));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get("/api/stocks-cn/heat", (_req, res) => {
    res.json(stocksCnHeatModule.getSnapshot());
  });

  app.post("/api/alerts/test", async (_req, res) => {
    try {
      const alert = await alertEngine.raiseTestAlert();
      res.json({ ok: true, alert });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // --- Module lifecycle control ---
  app.post("/api/quantum/module/:name/start", async (req, res) => {
    const moduleName = req.params.name as MarketModuleName;
    try {
      await lifecycle.start(moduleName);
      const settings = await persistModuleRunPreference(moduleName, true);
      res.json({ ok: true, status: lifecycle.getStatus(moduleName), settings: settingsForClient(settings) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post("/api/quantum/module/:name/stop", async (req, res) => {
    const moduleName = req.params.name as MarketModuleName;
    try {
      await lifecycle.stop(moduleName);
      clearLatestTicksForModule(moduleName);
      broadcastSnapshot();
      const settings = await persistModuleRunPreference(moduleName, false);
      res.json({ ok: true, status: lifecycle.getStatus(moduleName), settings: settingsForClient(settings) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  // --- Quantum K-line data (real Binance API) ---
  app.get("/api/quantum/klines", async (req, res) => {
    const symbol = String(req.query.symbol || "");
    const intervalParam = String(req.query.interval || "1m");
    const interval = (["1m", "15m", "1d"].includes(intervalParam) ? intervalParam : "1m") as BinanceInterval;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 10), 500);

    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }

    try {
      const candles = await binanceApiClient.getKlines(symbol, interval, limit);
      res.json({ symbol, interval, candles });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/futures-cn/klines", async (req, res) => {
    const symbol = String(req.query.symbol || "");
    const intervalParam = String(req.query.interval || "1m");
    const interval = (["1m", "15m", "1d"].includes(intervalParam) ? intervalParam : "1m") as CnFuturesInterval;
    const limit = Math.min(Math.max(Number(req.query.limit) || 120, 10), 300);

    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }

    try {
      const mapping = mapMarketSymbol(symbol, "Futures_CN");
      const [candles, quote] = await Promise.all([
        sinaFuturesApiClient.getKlines(mapping.dataSymbol, interval, limit),
        sinaFuturesApiClient.getQuote(mapping.dataSymbol),
      ]);
      const maxAgeMs = interval === "1d" ? 10 * 24 * 60 * 60 * 1000 : 10 * 24 * 60 * 60 * 1000;
      const quality = checkKlineFreshness(candles, maxAgeMs);
      res.json({ symbol: mapping.displaySymbol, interval, mapping, candles, quote, quality });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/futures-global/klines", async (req, res) => {
    const symbol = String(req.query.symbol || "");
    const intervalParam = String(req.query.interval || "1m");
    const interval = (["1m", "15m", "1d"].includes(intervalParam) ? intervalParam : "1m") as GlobalFuturesInterval;
    const limit = Math.min(Math.max(Number(req.query.limit) || 120, 10), 300);

    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }

    try {
      const mapping = mapMarketSymbol(symbol, "Futures_Global");
      const candles = await yahooFuturesApiClient.getKlines(mapping.dataSymbol, interval, limit);
      const maxAgeMs = interval === "1d" ? 5 * 24 * 60 * 60 * 1000 : interval === "1m" ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;
      const quality = checkKlineFreshness(candles, maxAgeMs);
      res.json({ symbol: mapping.displaySymbol, interval, mapping, candles, quality });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/stocks-us/klines", async (req, res) => {
    const symbol = String(req.query.symbol || "");
    const intervalParam = String(req.query.interval || "1m");
    const interval = (["1m", "15m", "1d"].includes(intervalParam) ? intervalParam : "1m") as UsStocksInterval;
    const limit = Math.min(Math.max(Number(req.query.limit) || 120, 10), 300);

    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }

    try {
      const mapping = mapMarketSymbol(symbol, "Stocks_US");
      const candles = await yahooUsStocksApiClient.getKlines(mapping.dataSymbol, interval, limit);
      const maxAgeMs = interval === "1d" ? 5 * 24 * 60 * 60 * 1000 : interval === "1m" ? 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
      const quality = checkKlineFreshness(candles, maxAgeMs);
      res.json({ symbol: mapping.displaySymbol, interval, mapping, candles, quality });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // =========================================================================
  // Vite middleware for development
  // =========================================================================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    clearInterval(latestTickCleanup);
    if (newsRefreshTimer) clearTimeout(newsRefreshTimer);
    alertEngine.stop();
    for (const moduleName of lifecycle.getRegisteredModuleNames()) {
      try {
        await lifecycle.stop(moduleName);
      } catch (err) {
        console.error(`[Quantum] Failed to stop ${moduleName}:`, err);
      }
    }
    server.close(() => process.exit(0));
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

async function testEndpoint(
  name: string,
  run: () => Promise<string>,
): Promise<{ name: string; ok: boolean; elapsed_ms: number; message: string }> {
  const startedAt = Date.now();
  try {
    const message = await run();
    return {
      name,
      ok: true,
      elapsed_ms: Date.now() - startedAt,
      message,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      ok: false,
      elapsed_ms: Date.now() - startedAt,
      message,
    };
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

startServer();
