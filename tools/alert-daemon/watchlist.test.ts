import assert from "node:assert/strict";
import type { WatchlistItemSettings } from "./config.js";
import { WatchlistMonitor } from "./watchlist.js";

const dailyCloses = [100, 110];
let dailyRequests = 0;

const stocksUs = {
  async getKlines(_symbol: string, interval: string): Promise<Array<{ time: string; close: number }>> {
    if (interval === "1m") return [{ time: new Date().toISOString(), close: 115 }];
    if (interval === "15m") return [
      { time: new Date().toISOString(), close: 114 },
      { time: new Date().toISOString(), close: 115 },
    ];
    dailyRequests += 1;
    return dailyCloses.map(close => ({ time: new Date().toISOString(), close }));
  },
};

const monitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [] },
  {
    stocksUs,
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: { getQuote: async () => null, getKlines: async () => [] },
  } as never,
  { warn() {}, debug() {} } as never,
);

const item = { symbol: "TEST", market: "Stocks_US", label: "Test", enabled: true } as const;
const refreshItem = (monitor as unknown as { refreshItem(value: typeof item): Promise<unknown> }).refreshItem.bind(monitor);

await refreshItem(item);
const history = (monitor as unknown as { history: Map<string, { referenceClose?: { value: number; updatedAt: number } }> }).history;
const firstReference = history.get("TEST")?.referenceClose;
assert.equal(firstReference?.value, 100);
assert.equal(dailyRequests, 1);

await new Promise(resolve => setTimeout(resolve, 5));
await refreshItem(item);
const cachedReference = history.get("TEST")?.referenceClose;
assert.equal(cachedReference?.updatedAt, firstReference?.updatedAt, "cache hits must not extend the reference-close TTL");
assert.equal(dailyRequests, 1);

if (!cachedReference) throw new Error("missing cached reference close");
cachedReference.updatedAt = Date.now() - 13 * 60 * 60 * 1000;
dailyCloses[0] = 105;
await refreshItem(item);
assert.equal(history.get("TEST")?.referenceClose?.value, 105);
assert.equal(dailyRequests, 2);

// Regression: out-of-order (stale CDN) candle timestamps must be rejected
let tsMode: "new" | "stale" = "new";
const baseNow = Date.now();
const orderMonitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [] },
  {
    stocksUs: {
      async getKlines(_symbol: string, interval: string) {
        if (interval === "1m") {
          return tsMode === "new"
            ? [{ time: new Date(baseNow).toISOString(), close: 812 }]
            : [{ time: new Date(baseNow - 60_000).toISOString(), close: 786 }];
        }
        return [
          { time: new Date(baseNow - 900_000).toISOString(), close: 810 },
          { time: new Date(baseNow).toISOString(), close: 812 },
        ];
      },
    },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: { getQuote: async () => null, getKlines: async () => [] },
  } as never,
  { warn() {}, debug() {} } as never,
);
const orderRefresh = (orderMonitor as unknown as { refreshItem(value: WatchlistItemSettings): Promise<{ price: number } | null> }).refreshItem.bind(orderMonitor);
const freshTick = await orderRefresh({ symbol: "SNDK", market: "Stocks_US", label: "闪迪", enabled: true });
assert.equal(freshTick?.price, 812);
tsMode = "stale";
const staleTick = await orderRefresh({ symbol: "SNDK", market: "Stocks_US", label: "闪迪", enabled: true });
assert.equal(staleTick, null, "stale candle timestamp must be rejected");

// Regression: Futures_CN getQuote 403 falls back to getKlines
let cnQuoteCalls = 0;
let cnKlineCalls = 0;
const cnMonitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [] },
  {
    stocksUs: { getKlines: async () => [] },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: {
      async getQuote() {
        cnQuoteCalls += 1;
        throw new Error("HTTP 403");
      },
      async getKlines(_symbol: string, interval: string) {
        cnKlineCalls += 1;
        if (interval === "1m") return [{ time: new Date(baseNow).toISOString(), close: 2200 }];
        return [
          { time: new Date(baseNow - 900_000).toISOString(), close: 2190 },
          { time: new Date(baseNow).toISOString(), close: 2200 },
        ];
      },
    },
  } as never,
  { warn() {}, debug() {} } as never,
);
const cnRefresh = (cnMonitor as unknown as { refreshItem(value: { symbol: string; market: "Futures_CN"; label: string; enabled: boolean }): Promise<{ price: number } | null> }).refreshItem.bind(cnMonitor);
const cnTick = await cnRefresh({ symbol: "C0", market: "Futures_CN", label: "玉米", enabled: true });
assert.equal(cnTick?.price, 2200, "Futures_CN must fall back to klines when getQuote throws 403");
assert.ok(cnQuoteCalls >= 1 && cnKlineCalls >= 2);

// Regression: exponential failure backoff skips failing symbol on subsequent cycle
let failAttempts = 0;
const backoffMonitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [{ symbol: "C0", market: "Futures_CN", label: "玉米", enabled: true }] },
  {
    stocksUs: { getKlines: async () => [] },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: {
      async getQuote() {
        failAttempts += 1;
        throw new Error("HTTP 403");
      },
      async getKlines() {
        throw new Error("HTTP 403");
      },
    },
  } as never,
  { warn() {}, debug() {} } as never,
);
(backoffMonitor as unknown as { running: boolean }).running = true;
const refreshAll = (backoffMonitor as unknown as { refreshAll(onTick: () => void): Promise<void> }).refreshAll.bind(backoffMonitor);
await refreshAll(() => {});
await refreshAll(() => {});
assert.equal(failAttempts, 1, "second immediate cycle must be skipped due to failure backoff");

// Regression: 15m change uses local history first and caches remote 15m fallback
let remote15mCalls = 0;
const fast15mMonitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [] },
  {
    stocksUs: {
      async getKlines(_symbol: string, interval: string) {
        if (interval === "1m") return [{ time: new Date().toISOString(), close: 105 }];
        if (interval === "15m") {
          remote15mCalls += 1;
          return [
            { time: new Date(Date.now() - 900_000).toISOString(), close: 100 },
            { time: new Date().toISOString(), close: 105 },
          ];
        }
        return [
          { time: new Date(Date.now() - 86_400_000).toISOString(), close: 100 },
          { time: new Date().toISOString(), close: 105 },
        ];
      },
    },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: { getQuote: async () => null, getKlines: async () => [] },
  } as never,
  { warn() {}, debug() {} } as never,
);
const fastRefresh = (fast15mMonitor as unknown as { refreshItem(value: WatchlistItemSettings): Promise<{ change_15m?: number } | null> }).refreshItem.bind(fast15mMonitor);
const t1 = await fastRefresh({ symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true });
const t2 = await fastRefresh({ symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true });
assert.equal(t1?.change_15m, 5);
assert.equal(t2?.change_15m, 5);
assert.equal(remote15mCalls, 1, "remote 15m fallback must be cached within TTL");

// When 16-minute-old local history exists, remote 15m endpoint must not be called at all
const fastHistory = (fast15mMonitor as unknown as { history: Map<string, { history: Array<{ ts: number; price: number }> }> }).history;
fastHistory.get("NVDA")?.history.unshift({ ts: Date.now() - 16 * 60 * 1000, price: 100 });
(fast15mMonitor as unknown as { interval15mRefCache: Map<string, unknown> }).interval15mRefCache.clear();
const t3 = await fastRefresh({ symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true });
assert.equal(t3?.change_15m, 5);
assert.equal(remote15mCalls, 1, "local 15m history must eliminate remote 15m requests");

// Regression: Crypto_Binance watchlist item (e.g. SAMSUNGUSDT) works without colliding with binance top-50
const binanceWlMonitor = new WatchlistMonitor(
  { upsertExternalTick() {} } as never,
  { enabled: true, price_seconds: 15, items: [] },
  {
    stocksUs: { getKlines: async () => [] },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: { getQuote: async () => null, getKlines: async () => [] },
    binance: {
      async getTopSymbolsByVolume() { return []; },
      async getRecentCloses() { return []; },
      subscribePrices() { return () => {}; },
      async getKlines(_symbol: string, interval: string) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (interval === "1m") return [{ time: nowSec, open: 143, high: 144, low: 142, close: 143.6, volume: 100 }];
        if (interval === "15m") return [
          { time: nowSec - 900, open: 142, high: 143, low: 142, close: 142.5, volume: 100 },
          { time: nowSec, open: 142.5, high: 144, low: 142.5, close: 143.6, volume: 100 },
        ];
        return [
          { time: nowSec - 86400, open: 140, high: 146, low: 140, close: 145.5, volume: 100 },
          { time: nowSec, open: 145.5, high: 146, low: 142, close: 143.6, volume: 100 },
        ];
      },
    },
  } as never,
  { warn() {}, debug() {} } as never,
);
const binanceRefresh = (binanceWlMonitor as unknown as { refreshItem(value: WatchlistItemSettings): Promise<{ symbol: string; price: number; display_name?: string } | null> }).refreshItem.bind(binanceWlMonitor);
const samsungTick = await binanceRefresh({ symbol: "SAMSUNGUSDT", market: "Crypto_Binance", label: "三星电子", enabled: true });
assert.equal(samsungTick?.symbol, "SAMSUNG/USDT");
assert.equal(samsungTick?.display_name, "三星电子");
assert.equal(samsungTick?.price, 143.6);

// Stocks_CN real-time EastMoney quote + alert_enabled=false suppresses onTick alerts while still storing tick
const storedSymbols: string[] = [];
const alertedSymbols: string[] = [];
const cnIndexMonitor = new WatchlistMonitor(
  { upsertExternalTick(t: { symbol: string }) { storedSymbols.push(t.symbol); } } as never,
  {
    enabled: true,
    price_seconds: 15,
    items: [
      { symbol: "SH000001", market: "Stocks_CN", label: "上证", group: "index_cn", alert_enabled: false, enabled: true },
      { symbol: "SZ399006", market: "Stocks_CN", label: "创业", group: "index_cn", alert_enabled: false, enabled: true },
    ],
  },
  {
    stocksUs: {
      async getKlines(sym: string) {
        assert.equal(sym, "399006.SZ", "fallback for SZ399006 must map to Yahoo .SZ ticker");
        return [{ time: new Date().toISOString(), close: 2239.11, previousClose: 2212.13 }];
      },
    },
    stocksCn: {
      async getQuote(sym: string) {
        if (sym === "SH000001") return { symbol: "SH000001", name: "上证指数", price: 3499.91, changePercent: -0.96, previousClose: 3533.79 };
        throw new Error("EastMoney temporary outage");
      },
    },
    futuresGlobal: { getKlines: async () => [] },
    futuresCn: { getQuote: async () => null, getKlines: async () => [] },
  } as never,
  { warn() {}, debug() {} } as never,
);
(cnIndexMonitor as unknown as { running: boolean }).running = true;
await (cnIndexMonitor as unknown as { refreshAll(cb: (t: { symbol: string }) => void): Promise<void> }).refreshAll(t => alertedSymbols.push(t.symbol));
assert.deepEqual(storedSymbols.sort(), ["SH000001", "SZ399006"], "both EastMoney and Yahoo-fallback CN indices must be stored");
assert.deepEqual(alertedSymbols, [], "alert_enabled=false items must not emit instant-move alert ticks");

console.log("watchlist tests passed");
