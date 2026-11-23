import assert from "node:assert/strict";
import type { DaemonTick } from "./marketStore.js";
import { buildFloatingAlertMarkdown, buildNtfyAlertPayload, buildNtfyAlertTitle, buildTelegramAlertMarkdown } from "./notifiers.js";
import { buildNtfyBroadcastPayload, formatAlertContext, formatTelegramRankingBroadcast, formatTelegramWatchlistBroadcast } from "./ranking.js";

const rankingRows = [
  { rank: 1, symbol: "BTC/USDT", price: 118520, value: 3.21, updated_at: new Date().toISOString() },
];
const ticks = new Map([
  ["NVDA", {
    origin: "watchlist" as const,
    symbol: "NVDA",
    display_name: "英伟达",
    price: 202.49,
    change_24h: -2.37,
    change_1m: 0.12,
    change_15m: -0.5,
    updated_at: new Date().toISOString(),
  }],
]);
const store = {
  getRankings: () => rankingRows,
  getTick: (symbol: string) => ticks.get(symbol),
} as never;

const ranking = formatTelegramRankingBroadcast(store, ["change_up"], 3);
assert.match(ranking, /# 📊 行情广播/);
assert.match(ranking, /\| 1 \| BTC\/USDT \| \+3\.21% \| 118520\.00 \|/);

const watchlist = formatTelegramWatchlistBroadcast(store, {
  enabled: true,
  price_seconds: 15,
  items: [{ symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true }],
});
assert.match(watchlist, /英伟达 \(NVDA\)/);
assert.match(watchlist, /-2\.37%/);

const alert = buildTelegramAlertMarkdown({
  id: "test",
  type: "instant_move",
  symbol: "BTC/USDT",
  period: "90秒",
  title: "[价格异动] BTC/USDT",
  severity: "warning",
  value: 3.21,
  threshold: 3,
  created_at: new Date().toISOString(),
  message: "90秒窗口：+3.21%\n当前价：118520.00\n24H涨跌：+5.42%\n\n今日涨幅：+5.42% / 涨幅第1\n时间：中国 12:00:00 / 美国 00:00:00",
});
const floatingAlert = buildFloatingAlertMarkdown({
  id: "test",
  type: "instant_move",
  symbol: "BTC/USDT",
  period: "90秒",
  title: "[价格异动] BTC/USDT",
  severity: "warning",
  value: 3.21,
  threshold: 3,
  created_at: new Date().toISOString(),
  message: "90秒窗口：+3.21%\n当前价：118520.00\n24H涨跌：+5.42%\n\n今日涨幅：+5.42% / 涨幅第1\n时间：中国 12:00:00 / 美国 00:00:00",
});
assert.match(alert, /# 🚨 价格异动 · BTC\/USDT/);
assert.match(alert, /\| BTC\/USDT \| 90秒 \| \+3\.21% \|/);
assert.match(alert, /\| 90秒窗口 \| \+3\.21% \|/);
assert.match(alert, /\| 今日涨幅 \| \+5\.42% \/ 涨幅第1 \|/);
assert.match(alert, /自动预警/);
assert.match(floatingAlert, /\| 当前价 \| 118520\.00 \|/);
assert.doesNotMatch(floatingAlert, /\| 窗口低点 \|/);
assert.doesNotMatch(floatingAlert, /\| 今日涨幅 \|/);

const ctx = formatAlertContext({
  getTick: (symbol: string) => ticks.get(symbol),
  getSymbolRanks: () => ({}),
} as never, "NVDA");
assert.doesNotMatch(ctx, /快照：|当前价格：/, "alert context must omit snapshot header and duplicate price line");
assert.match(ctx, /今日涨幅：-2\.37%/);
assert.equal(buildNtfyAlertTitle({
  id: "t",
  type: "instant_move",
  symbol: "BTC/USDT",
  period: "90秒",
  title: "[价格异动] BTC/USDT",
  severity: "warning",
  value: 3.21,
  threshold: 3,
  created_at: new Date().toISOString(),
  message: "",
}), "BTC +3.21% (90s)");

const ntfyWlAlert = buildNtfyAlertPayload({
  id: "wl",
  type: "instant_move",
  symbol: "NVDA",
  period: "90秒",
  title: "[价格异动] NVDA",
  severity: "warning",
  value: -1.08,
  threshold: 1,
  created_at: new Date().toISOString(),
  message: "",
}, {
  getTick: (symbol: string) => ticks.get(symbol),
  getSymbolRanks: () => ({}),
} as never);
assert.equal(ntfyWlAlert.title, "英伟达 NVDA -1.08% (90s) · 202.49");
assert.match(ntfyWlAlert.message, /^今日 -2\.37% \| 1m \+0\.12% · 15m -0\.50%\n/);

const ntfyBroadcast = buildNtfyBroadcastPayload(store, {
  ranking_broadcast: {
    enabled: true,
    log_enabled: true,
    broadcast_on_startup: true,
    telegram_enabled: false,
    weixin_enabled: false,
    ntfy_enabled: true,
    desktop_enabled: false,
    interval_seconds: 600,
    top_n: 3,
    sections: ["change_up", "change_down", "ma60_1m", "ma60_15m", "ma60_1d"],
  },
  watchlist: {
    enabled: true,
    price_seconds: 15,
    items: [{ symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true }],
  },
});
assert.match(ntfyBroadcast.title, /^行情广播 · /);
assert.match(ntfyBroadcast.message, /\*\*🔥 24H 涨跌 TOP 3\*\*/);
assert.match(ntfyBroadcast.message, /\*\*📐 MA60 偏离 TOP 3\*\*/);
assert.match(ntfyBroadcast.message, /\*\*👀 自选快照 \(现价 \/ 今日 \/ 15m\)\*\*/);
assert.doesNotMatch(ntfyBroadcast.message, /\/USDT/);

// Condensed CN & US index strip placed at the top of watchlist snapshot for cross-reference
const indexTicks = new Map<string, DaemonTick>([
  ...ticks.entries(),
  ["SH000001", { origin: "watchlist" as const, symbol: "SH000001", display_name: "上证", price: 3499.91, change_24h: -0.96, updated_at: new Date().toISOString() }],
  ["SZ399006", { origin: "watchlist" as const, symbol: "SZ399006", display_name: "创业", price: 2239.11, change_24h: 1.22, updated_at: new Date().toISOString() }],
  ["SH000688", { origin: "watchlist" as const, symbol: "SH000688", display_name: "科创", price: 1198.46, change_24h: -2.65, updated_at: new Date().toISOString() }],
  ["^GSPC", { origin: "watchlist" as const, symbol: "^GSPC", display_name: "标普", price: 6910.39, change_24h: -3.70, updated_at: new Date().toISOString() }],
  ["^IXIC", { origin: "watchlist" as const, symbol: "^IXIC", display_name: "纳指", price: 22617.73, change_24h: -5.28, updated_at: new Date().toISOString() }],
  ["^DJI", { origin: "watchlist" as const, symbol: "^DJI", display_name: "道指", price: 48147.33, change_24h: -1.93, updated_at: new Date().toISOString() }],
]);
const indexStore = {
  getRankings: () => rankingRows,
  getTick: (symbol: string) => indexTicks.get(symbol),
  getWatchlistTick: (symbol: string) => indexTicks.get(symbol),
} as never;
const indexNtfy = buildNtfyBroadcastPayload(indexStore, {
  ranking_broadcast: {
    enabled: true,
    log_enabled: true,
    broadcast_on_startup: true,
    telegram_enabled: false,
    weixin_enabled: false,
    ntfy_enabled: true,
    desktop_enabled: false,
    interval_seconds: 600,
    top_n: 3,
    sections: ["change_up", "change_down"],
  },
  watchlist: {
    enabled: true,
    price_seconds: 15,
    items: [
      { symbol: "SH000001", market: "Stocks_CN", label: "上证", group: "index_cn", alert_enabled: false, enabled: true },
      { symbol: "SZ399006", market: "Stocks_CN", label: "创业", group: "index_cn", alert_enabled: false, enabled: true },
      { symbol: "SH000688", market: "Stocks_CN", label: "科创", group: "index_cn", alert_enabled: false, enabled: true },
      { symbol: "^GSPC", market: "Stocks_US", label: "标普", group: "index_us", alert_enabled: false, enabled: true },
      { symbol: "^IXIC", market: "Stocks_US", label: "纳指", group: "index_us", alert_enabled: false, enabled: true },
      { symbol: "^DJI", market: "Stocks_US", label: "道指", group: "index_us", alert_enabled: false, enabled: true },
      { symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true },
    ],
  },
});
const cnPos = indexNtfy.message.indexOf("上证");
const usPos = indexNtfy.message.indexOf("标普");
const nvdaPos = indexNtfy.message.indexOf("NVDA");
assert.ok(cnPos > 0 && usPos > cnPos && nvdaPos > usPos, "CN indices must appear first, US indices below CN, and regular watchlist below divider");
assert.match(indexNtfy.message, /3500 -1\.0% {1,2}2239 \+1\.2% {1,3}1198 -2\.6%/);
assert.match(indexNtfy.message, /6910 -3\.7% {1,2}22618 -5\.3% {1,2}48147 -1\.9%/);
assert.doesNotMatch(indexNtfy.message, /SH000001|\^GSPC/, "condensed index strip must omit raw ticker symbols");

console.log("telegram rich formatting tests passed");
