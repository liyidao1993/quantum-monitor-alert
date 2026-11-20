import assert from "node:assert/strict";
import { buildFloatingAlertMarkdown, buildNtfyAlertTitle, buildTelegramAlertMarkdown } from "./notifiers.js";
import { formatAlertContext, formatTelegramRankingBroadcast, formatTelegramWatchlistBroadcast } from "./ranking.js";

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
}), "📈 BTC/USDT +3.21% (90秒)");

console.log("telegram rich formatting tests passed");
