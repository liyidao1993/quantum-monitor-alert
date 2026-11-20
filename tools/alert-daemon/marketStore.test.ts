import assert from "node:assert/strict";
import { BinanceMarketStore, type DaemonTick } from "./marketStore.js";

const store = new BinanceMarketStore(
  {} as never,
  {
    limit: 50,
    priceSeconds: 1,
    refreshIntervals: {
      price_seconds: 1,
      ma60_1m_seconds: 60,
      ma60_15m_seconds: 300,
      ma60_1d_seconds: 3600,
    },
    snapshotCachePath: ".runtime/test-market-store-cache.json",
  },
  {} as never,
);

const tick: DaemonTick = {
  origin: "binance",
  symbol: "KORU/USDT",
  price: 491.29,
  change_24h: 0,
  updated_at: new Date(Date.now() - 121_000).toISOString(),
};

store.upsertExternalTick(tick);
assert.equal(store.getAllTicks().length, 0, "stale ticks must not enter rankings");
assert.equal(store.getTick("KORUUSDT"), undefined);

store.upsertExternalTick({ ...tick, price: 19.15, updated_at: new Date().toISOString() });
assert.equal(store.getAllTicks().length, 1);
assert.equal(store.getTick("KORUUSDT")?.price, 19.15);

// Regression: refreshActiveSymbols updates subscriptions and drops delisted/out-of-top binance ticks
let currentList = ["BTC/USDT", "OLD/USDT"];
let subscribeCalls = 0;
let unsubscribedCount = 0;
let emitPrice: ((u: { symbol: string; price: number; change_24h: number }) => void) | undefined;
const refreshStore = new BinanceMarketStore(
  {
    async getTopSymbolsByVolume() {
      return [...currentList];
    },
    async getRecentCloses() {
      return Array.from({ length: 61 }, () => 100);
    },
    async getKlines() {
      return [];
    },
    subscribePrices(_symbols: string[], onUpdate: (u: { symbol: string; price: number; change_24h: number }) => void) {
      subscribeCalls += 1;
      emitPrice = onUpdate;
      return () => {
        unsubscribedCount += 1;
      };
    },
  },
  {
    limit: 2,
    priceSeconds: 1,
    refreshIntervals: {
      price_seconds: 1,
      ma60_1m_seconds: 60,
      ma60_15m_seconds: 300,
      ma60_1d_seconds: 3600,
    },
    snapshotCachePath: ".runtime/test-market-store-refresh-cache.json",
  },
  { info() {}, warn() {}, debug() {}, error() {} } as never,
);

await refreshStore.start(() => {});
if (!emitPrice) throw new Error("expected subscribePrices callback");
(emitPrice as (u: { symbol: string; price: number; change_24h: number }) => void)({ symbol: "OLD/USDT", price: 10, change_24h: 1 });
(emitPrice as (u: { symbol: string; price: number; change_24h: number }) => void)({ symbol: "BTC/USDT", price: 65000, change_24h: 2 });
assert.ok(refreshStore.getTick("OLDUSDT"));

currentList = ["BTC/USDT", "NEW/USDT"];
await refreshStore.refreshActiveSymbols();
assert.equal(subscribeCalls, 2, "must re-subscribe when top list changes");
assert.equal(unsubscribedCount, 1, "must unsubscribe old stream before re-subscribing");
assert.equal(refreshStore.getTick("OLDUSDT"), undefined, "dropped binance symbol must be removed from latestTicks");
assert.ok(refreshStore.getTick("BTCUSDT"), "retained binance symbol must stay");
refreshStore.stop();

console.log("market store tests passed");
