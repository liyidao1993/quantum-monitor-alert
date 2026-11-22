import type { EffectiveDaemonConfig, WatchlistSettings } from "./config.js";
import { formatPrice, formatSigned } from "./alertRules.js";
import type { BinanceMarketStore, DaemonTick, RankingKind, RankingRow } from "./marketStore.js";
import { compactWatchlistLabel, formatCompactPrice, formatShortClockLine, stripUsdt } from "./notifiers.js";

const sectionLabels: Record<RankingKind, string> = {
  change_up: "24H 涨幅",
  change_down: "24H 跌幅",
  ma60_1m: "1m MA60 偏离",
  ma60_15m: "15m MA60 偏离",
  ma60_1d: "日线 MA60 偏离",
};

export function formatRankingBroadcast(store: BinanceMarketStore, sections: RankingKind[], topN: number): string {
  const lines = [`[行情广播] ${formatClockLine()}`];
  for (const section of sections) {
    const rows = store.getRankings(section, topN);
    lines.push("", `${sectionLabels[section]} TOP ${topN}`);
    if (rows.length === 0) {
      lines.push("暂无数据");
      continue;
    }
    lines.push(...rows.map(formatRankingRow));
  }
  return lines.join("\n");
}

export function formatTelegramRankingBroadcast(store: BinanceMarketStore, sections: RankingKind[], topN: number): string {
  const blocks = ["# 📊 行情广播", `**${formatClockLine()}**`];
  for (const section of sections) {
    const rows = store.getRankings(section, topN);
    blocks.push(`## ${sectionLabels[section]} TOP ${topN}`);
    if (rows.length === 0) {
      blocks.push("暂无数据");
      continue;
    }
    blocks.push([
      "| 排名 | 交易对 | 涨跌幅 | 价格 |",
      "|:---:|---|---:|---:|",
      ...rows.map(row => `| ${row.rank} | ${escapeRichCell(row.symbol)} | ${formatSigned(row.value)}% | ${formatPrice(row.price)} |`),
    ].join("\n"));
  }
  return blocks.join("\n\n");
}

export function formatWatchlistBroadcast(store: BinanceMarketStore, settings: WatchlistSettings): string {
  if (!settings.enabled) return "";
  const rows = settings.items
    .filter(item => item.enabled)
    .map(item => store.getWatchlistTick?.(item.symbol) ?? store.getTick(item.symbol))
    .filter((tick): tick is DaemonTick => Boolean(tick));
  if (rows.length === 0) return "";

  const lines = ["[轻量监控] 行情快照"];
  for (const tick of rows) {
    lines.push(formatWatchlistRow(tick));
  }
  return lines.join("\n");
}

export function formatTelegramWatchlistBroadcast(store: BinanceMarketStore, settings: WatchlistSettings): string {
  if (!settings.enabled) return "";
  const rows = settings.items
    .filter(item => item.enabled)
    .map(item => store.getWatchlistTick?.(item.symbol) ?? store.getTick(item.symbol))
    .filter((tick): tick is DaemonTick => Boolean(tick));
  if (rows.length === 0) return "";

  return [
    "# 👀 自选行情",
    "| 标的 | 现价 | 今日 | 1m | 15m |",
    "|---|---:|---:|---:|---:|",
    ...rows.map(tick => {
      const name = tick.display_name && tick.display_name !== tick.symbol
        ? `${tick.display_name} (${tick.symbol})`
        : tick.symbol;
      return `| ${escapeRichCell(name)} | ${formatPrice(tick.price)} | ${formatSigned(tick.change_24h)}% | ${formatOptionalChange(tick.change_1m)} | ${formatOptionalChange(tick.change_15m)} |`;
    }),
  ].join("\n");
}

export function buildNtfyBroadcastPayload(
  store: Pick<BinanceMarketStore, "getRankings" | "getTick"> & Partial<Pick<BinanceMarketStore, "getWatchlistTick">>,
  config: Pick<EffectiveDaemonConfig, "ranking_broadcast" | "watchlist">,
  binanceOnline = true,
): { title: string; message: string } {
  const title = `行情广播 · ${formatShortClockLine()}`;
  const blocks: string[] = [];
  const topN = config.ranking_broadcast.top_n;
  const sections = config.ranking_broadcast.sections;

  if (binanceOnline) {
    const hasUp = sections.includes("change_up");
    const hasDown = sections.includes("change_down");
    const upRows = hasUp ? store.getRankings("change_up", topN) : [];
    const downRows = hasDown ? store.getRankings("change_down", topN) : [];
    const maSpecs: Array<[RankingKind, string]> = [
      ["ma60_1m", "1m"],
      ["ma60_15m", "15m"],
      ["ma60_1d", "1d"],
    ];
    const maGroups = maSpecs
      .filter(([key]) => sections.includes(key))
      .map(([key, tag]) => ({ tag, rows: store.getRankings(key, topN) }))
      .filter(group => group.rows.length > 0);

    const allCryptoRows = [...upRows, ...downRows, ...maGroups.flatMap(group => group.rows)];
    const symW = Math.min(8, Math.max(6, ...allCryptoRows.map(row => stripUsdt(row.symbol).length)));
    const pctW = Math.max(7, ...allCryptoRows.map(row => `${formatSigned(row.value)}%`.length));
    const priceW = Math.max(7, ...allCryptoRows.map(row => formatCompactPrice(row.price).length));

    const formatCryptoRow = (row: RankingRow): string => {
      const sym = stripUsdt(row.symbol).slice(0, symW).padEnd(symW);
      const pct = `${formatSigned(row.value)}%`.padStart(pctW);
      const prc = formatCompactPrice(row.price).padStart(priceW);
      return `${sym} ${pct}  ${prc}`;
    };

    if (upRows.length > 0 || downRows.length > 0) {
      const tableLines: string[] = [];
      if (upRows.length > 0) tableLines.push(...upRows.map(formatCryptoRow));
      if (upRows.length > 0 && downRows.length > 0) {
        tableLines.push("-".repeat(symW + 1 + pctW + 2 + priceW));
      }
      if (downRows.length > 0) tableLines.push(...downRows.map(formatCryptoRow));
      blocks.push(`**🔥 24H 涨跌 TOP ${topN}**\n\`\`\`\n${tableLines.join("\n")}\n\`\`\``);
    }

    if (maGroups.length > 0) {
      const maLines: string[] = [];
      const divider = "-".repeat(4 + symW + 1 + pctW + 2 + priceW);
      maGroups.forEach((group, groupIndex) => {
        if (groupIndex > 0) maLines.push(divider);
        group.rows.forEach((row, rowIndex) => {
          const prefix = rowIndex === 0 ? group.tag.padEnd(4) : "    ";
          maLines.push(`${prefix}${formatCryptoRow(row)}`);
        });
      });
      blocks.push(`**📐 MA60 偏离 TOP ${topN}**\n\`\`\`\n${maLines.join("\n")}\n\`\`\``);
    }
  }

  if (config.watchlist.enabled) {
    const wlTicks = config.watchlist.items
      .filter(item => item.enabled)
      .map(item => store.getWatchlistTick?.(item.symbol) ?? store.getTick(item.symbol))
      .filter((tick): tick is DaemonTick => Boolean(tick));

    if (wlTicks.length > 0) {
      const prepared = wlTicks.map(tick => {
        const code = stripUsdt(tick.symbol).slice(0, 7);
        const price = formatCompactPrice(tick.price);
        const dayPct = `${formatSigned(tick.change_24h)}%`;
        const isIdle = (tick.change_1m === 0 || tick.change_1m === undefined)
          && (tick.change_15m === 0 || tick.change_15m === undefined);
        const m15Pct = !isIdle && typeof tick.change_15m === "number" ? `${formatSigned(tick.change_15m)}%` : "--";
        const rawLabel = compactWatchlistLabel(tick.display_name);
        const label = rawLabel && rawLabel.toUpperCase() !== code.toUpperCase() ? rawLabel : "";
        return { code, price, dayPct, m15Pct, label };
      });
      const codeW = Math.max(4, ...prepared.map(item => item.code.length));
      const priceW = Math.max(6, ...prepared.map(item => item.price.length));
      const dayW = Math.max(6, ...prepared.map(item => item.dayPct.length));
      const m15W = Math.max(3, ...prepared.map(item => item.m15Pct.length));
      const wlLines = prepared.map(item => {
        const base = `${item.code.padEnd(codeW)} ${item.price.padStart(priceW)} ${item.dayPct.padStart(dayW)} ${item.m15Pct.padStart(m15W)}`;
        return item.label ? `${base} ${item.label}` : base;
      });
      blocks.push(`**👀 自选快照 (现价 / 今日 / 15m)**\n\`\`\`\n${wlLines.join("\n")}\n\`\`\``);
    }
  }

  return { title, message: blocks.join("\n\n") };
}

export function formatDesktopRankingSummary(store: BinanceMarketStore, settings: WatchlistSettings): string {
  const sections: Array<[string, RankingKind]> = [
    ["Up", "change_up"],
    ["Down", "change_down"],
    ["1m", "ma60_1m"],
    ["15m", "ma60_15m"],
  ];
  const lines: string[] = [];
  for (const [label, kind] of sections) {
    const rows = store.getRankings(kind, 4);
    if (rows.length === 0) continue;
    lines.push(`${label}: ${rows.map(formatCompactRankingRow).join(" | ")}`);
  }

  const watchlistText = formatWatchlistBroadcast(store, settings);
  if (watchlistText) {
    const compact = watchlistText
      .split("\n")
      .slice(1)
      .map(line => line.replace(/\s+/g, " "))
      .join(" | ");
    if (compact) lines.push(`Watchlist: ${compact}`);
  }

  lines.push("Full: Telegram/BAT");
  return lines.join("\n");
}

export function formatSymbolInfo(tick: DaemonTick, ranks: Partial<Record<RankingKind, number>>): string {
  const rows = [
    `当前价格：${formatPrice(tick.price)}`,
    `今日涨幅：${formatSigned(tick.change_24h)}%${rankText(ranks.change_up, "涨幅")}${rankText(ranks.change_down, "跌幅")}`,
  ];
  if (typeof tick.change_1m === "number") rows.push(`1m 涨幅：${formatOptionalChange(tick.change_1m)}`);
  if (typeof tick.change_15m === "number") rows.push(`15m 涨幅：${formatOptionalChange(tick.change_15m)}`);
  return [
    `[实时信息] ${tick.display_name ?? tick.symbol}`,
    "",
    ...rows,
    "",
    formatClockLine(),
  ].join("\n");
}

export function formatAlertContext(store: BinanceMarketStore, symbol: string): string {
  const tick = store.getTick(symbol);
  const ranks = store.getSymbolRanks(symbol);
  if (!tick) {
    return `时间：${formatClockLine()}`;
  }

  const rows = [
    `今日涨幅：${formatSigned(tick.change_24h)}%${rankText(ranks.change_up, "涨幅")}${rankText(ranks.change_down, "跌幅")}`,
  ];
  if (typeof tick.change_1m === "number") rows.push(`1m 涨幅：${formatOptionalChange(tick.change_1m)}`);
  if (typeof tick.change_15m === "number") rows.push(`15m 涨幅：${formatOptionalChange(tick.change_15m)}`);

  return [
    ...rows,
    `时间：${formatClockLine()}`,
  ].join("\n");
}

export function formatStatus(store: BinanceMarketStore): string {
  const stats = store.getStats();
  const uptimeSeconds = stats.startedAt ? Math.floor((Date.now() - stats.startedAt) / 1000) : 0;
  return [
    "[轻量守护运行状态]",
    "",
    `运行时长：${formatDuration(uptimeSeconds)}`,
    `币安监控：${stats.symbols}`,
    `轻量监控：${stats.watchlistSymbols}`,
    `当前快照：${stats.trackedSymbols}`,
    `接收Tick：${stats.ticks}`,
    formatClockLine(),
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "[轻量守护命令]",
    "/status - 查看运行状态",
    "/top up [N] - 24H 涨幅榜",
    "/top down [N] - 24H 跌幅榜",
    "/top ma1m [N] - 1m MA60 偏离榜",
    "/top ma15m [N] - 15m MA60 偏离榜",
    "/top ma1d [N] - 日线 MA60 偏离榜",
    "/symbol BTCUSDT - 查询单个品种",
    "/config - 查看关键配置",
  ].join("\n");
}

export function formatTopCommand(store: BinanceMarketStore, kind: RankingKind, topN: number): string {
  const rows = store.getRankings(kind, topN);
  return [
    `[${sectionLabels[kind]} TOP ${topN}]`,
    "",
    ...(rows.length ? rows.map(formatRankingRow) : ["暂无数据"]),
    "",
    formatClockLine(),
  ].join("\n");
}

function formatRankingRow(row: RankingRow): string {
  return `${row.rank}. ${row.symbol} ${formatSigned(row.value)}% @ ${formatPrice(row.price)}`;
}

function formatCompactRankingRow(row: RankingRow): string {
  return `${row.rank}.${row.symbol.replace("/USDT", "")} ${formatSigned(row.value)}%`;
}

function formatWatchlistRow(tick: DaemonTick): string {
  return `${tick.display_name ?? tick.symbol}(${tick.symbol}) ` +
    `价 ${formatPrice(tick.price)} / ` +
    `今 ${formatSigned(tick.change_24h)}% / ` +
    `1m ${formatOptionalChange(tick.change_1m)} / ` +
    `15m ${formatOptionalChange(tick.change_15m)}`;
}

function formatOptionalChange(value: number | undefined): string {
  return typeof value === "number" ? `${formatSigned(value)}%` : "--";
}

function escapeRichCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function rankText(rank: number | undefined, label: string): string {
  return typeof rank === "number" ? ` / ${label}第${rank}` : "";
}

function formatClockLine(): string {
  const now = new Date();
  return `中国 ${formatTime(now, "Asia/Shanghai")} / 美国 ${formatTime(now, "America/New_York")}`;
}

function formatTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
