import path from "node:path";
import { BinanceApiClient } from "../Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/api_client/BinanceApiClient.js";
import { SinaFuturesApiClient } from "../Quantum_Monitor_System/2_Market_Modules/Futures_CN/api_client/SinaFuturesApiClient.js";
import { YahooFuturesApiClient } from "../Quantum_Monitor_System/2_Market_Modules/Futures_Global/api_client/YahooFuturesApiClient.js";
import { YahooUsStocksApiClient } from "../Quantum_Monitor_System/2_Market_Modules/Stocks_US/api_client/YahooUsStocksApiClient.js";
import type { MarketRefreshIntervalSettings } from "../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes.js";
import { appendContext, InstantMoveRule, Ma60DeviationRule, type DaemonAlert } from "./alert-daemon/alertRules.js";
import {
  applyBinanceEnvironment,
  buildEffectiveConfig,
  loadAppSettings,
  loadDaemonConfig,
  type EffectiveDaemonConfig,
  type RankingSection,
} from "./alert-daemon/config.js";
import { DaemonLogger } from "./alert-daemon/logger.js";
import { BinanceMarketStore, normalizeSymbol, type DaemonTick, type RankingKind } from "./alert-daemon/marketStore.js";
import {
  buildAlertText,
  buildFloatingAlertFields,
  buildFloatingAlertMarkdown,
  buildFloatingAlertTitle,
  buildNtfyAlertPayload,
  buildTelegramAlertMarkdown,
  DesktopNotifier,
  FloatingReceiverNotifier,
  NtfyNotifier,
  TelegramNotifier,
  type TelegramUpdate,
} from "./alert-daemon/notifiers.js";
import {
  buildNtfyBroadcastPayload,
  formatAlertContext,
  formatDesktopRankingSummary,
  formatHelp,
  formatRankingBroadcast,
  formatStatus,
  formatSymbolInfo,
  formatTopCommand,
  formatWatchlistBroadcast,
  formatTelegramRankingBroadcast,
  formatTelegramWatchlistBroadcast,
} from "./alert-daemon/ranking.js";
import { StateStore } from "./alert-daemon/state.js";
import { WatchlistMonitor } from "./alert-daemon/watchlist.js";
import { WeixinNotifier } from "./alert-daemon/weixinNotifier.js";

const projectRoot = process.cwd();

async function main(): Promise<void> {
  const settings = await loadAppSettings(projectRoot);
  const daemonConfig = await loadDaemonConfig(projectRoot);
  applyBinanceEnvironment(settings);

  const config = buildEffectiveConfig(settings, {
    ...daemonConfig,
    enabled: daemonConfig.enabled && settings.AlertSettings.enabled,
  });
  const logger = new DaemonLogger(config.logging, projectRoot);
  const stateStore = new StateStore(path.resolve(projectRoot, ".runtime/alert-daemon/state.json"));
  await stateStore.load();

  if (!daemonConfig.enabled) {
    logger.warn("Alert daemon is disabled by alert-daemon.config.json");
    return;
  }
  if (!settings.AlertSettings.enabled) {
    logger.warn("Alert rules are disabled by settings.json AlertSettings.enabled=false; rankings and commands may still run");
  }

  const refreshIntervals = buildRefreshIntervals(settings.RefreshIntervalSettings.Crypto_Binance);
  const apiClient = new BinanceApiClient();
  const yahooFuturesClient = new YahooFuturesApiClient();
  const yahooStocksClient = new YahooUsStocksApiClient();
  const sinaFuturesClient = new SinaFuturesApiClient();
  const store = new BinanceMarketStore(apiClient, {
    limit: config.monitor.effective_top_volume,
    priceSeconds: config.monitor.effective_price_seconds,
    refreshIntervals,
    snapshotCachePath: path.resolve(projectRoot, ".runtime/alert-daemon/ma60_snapshots_binance.json"),
  }, logger);
  const watchlistMonitor = new WatchlistMonitor(
    store,
    config.watchlist,
    {
      futuresGlobal: yahooFuturesClient,
      stocksUs: yahooStocksClient,
      futuresCn: sinaFuturesClient,
      binance: apiClient,
    },
    logger,
    path.resolve(projectRoot, ".runtime/alert-daemon/watchlist-history.json"),
  );
  const instantRule = new InstantMoveRule(config);
  const ma60Rule = new Ma60DeviationRule(config);
  const telegram = new TelegramNotifier(config.telegram, logger);
  const weixin = new WeixinNotifier(config.weixin, logger, projectRoot);
  const ntfy = new NtfyNotifier(config.ntfy, logger);
  const desktop = new DesktopNotifier(config.desktop_notify, logger);
  const floating = new FloatingReceiverNotifier(logger);
  const timers: NodeJS.Timeout[] = [];
  const telegramPollAbort = new AbortController();
  let telegramPollPromise: Promise<void> | null = null;
  let broadcastInFlight = false;
  let binanceOnline = false;

  logger.info("Quantum alert daemon starting", {
    top_volume: config.monitor.effective_top_volume,
    price_seconds: config.monitor.effective_price_seconds,
    instant_move: {
      enabled: config.instant_move.enabled,
      window_seconds: config.instant_move.effective_window_seconds,
      threshold_percent: config.instant_move.effective_threshold_percent,
      watchlist_threshold_percent: config.instant_move.effective_watchlist_threshold_percent,
    },
    cooldown: {
      base_seconds: config.cooldown.effective_base_seconds,
      same_direction_step_percent: config.cooldown.same_direction_step_percent,
      separate_up_down: config.cooldown.separate_up_down,
      max_alerts_per_symbol_per_10min: config.cooldown.max_alerts_per_symbol_per_10min,
    },
    ma60_alerts: {
      enabled: config.ma60_alerts.enabled,
      cooldown_seconds: config.ma60_alerts.cooldown_seconds,
      same_direction_step_percent: config.ma60_alerts.same_direction_step_percent,
      intervals: config.ma60_alerts.intervals,
    },
    watchlist_enabled: config.watchlist.enabled,
    watchlist_items: config.watchlist.items.filter(item => item.enabled).map(item => item.symbol),
    telegram_enabled: config.telegram.enabled && telegram.enabled,
    weixin_enabled: config.weixin.enabled,
    ntfy_enabled: ntfy.enabled,
    desktop_enabled: config.desktop_notify.enabled,
    floating_receiver_enabled: floating.enabled,
  });

  await weixin.start(text => config.commands.enabled ? handleCommand(text, store, config) : null);

  if (config.telegram.send_startup_message && config.telegram.enabled && telegram.enabled) {
    await telegram.send(`[Quantum 轻量守护] 已启动\n${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  }
  if (config.weixin.send_startup_message && config.weixin.enabled && weixin.canSend) {
    await weixin.send(`[Quantum 轻量守护] 已启动\n${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  }
  await floating.send(
    "Quantum 轻量守护已启动",
    `## 悬浮窗通知已接入\n\n启动时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "info",
    "scheduled",
  );

  await primeTelegramOffset(config, telegram, stateStore, logger);

  const handleTick = (tick: DaemonTick): void => {
    const alerts = [
      instantRule.evaluate(tick),
      ...ma60Rule.evaluate(tick),
    ].filter((item): item is DaemonAlert => Boolean(item));

    for (const alert of alerts) {
      void dispatchAlert(appendContext(alert, formatAlertContext(store, alert.symbol)), telegram, weixin, ntfy, desktop, floating, config, logger, store, tick);
    }
  };

  try {
    await store.start(handleTick);
    binanceOnline = true;
  } catch (err) {
    logger.warn("Binance market store failed to start; continuing in watchlist-only mode", err);
  }
  await watchlistMonitor.start(handleTick);

  timers.push(setInterval(() => {
    logger.info("Runtime status", store.getStats());
  }, Math.max(10, config.monitor.status_log_seconds) * 1000));

  if (config.ranking_broadcast.enabled) {
    const runBroadcast = (force: boolean) => {
      if (broadcastInFlight) return;
      broadcastInFlight = true;
      void maybeBroadcastRankings(store, telegram, weixin, ntfy, desktop, floating, config, stateStore, logger, force, binanceOnline)
        .finally(() => {
          broadcastInFlight = false;
        });
    };
    const startRankingInterval = () => {
      timers.push(setInterval(() => runBroadcast(false), 10_000));
    };
    if (config.ranking_broadcast.broadcast_on_startup) {
      timers.push(setTimeout(() => {
        runBroadcast(true);
        startRankingInterval();
      }, 15_000));
    } else {
      startRankingInterval();
      runBroadcast(false);
    }
  }

  if (config.telegram.enabled && config.telegram.command_polling_enabled && config.commands.enabled && telegram.enabled) {
    telegramPollPromise = runTelegramLongPollLoop(store, telegram, config, stateStore, logger, telegramPollAbort.signal);
  }

  const shutdown = async () => {
    logger.info("Quantum alert daemon stopping");
    telegramPollAbort.abort();
    for (const timer of timers) clearInterval(timer);
    store.stop();
    await watchlistMonitor.destroy();
    await weixin.stop();
    await telegramPollPromise?.catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function dispatchAlert(
  alert: DaemonAlert,
  telegram: TelegramNotifier,
  weixin: WeixinNotifier,
  ntfy: NtfyNotifier,
  desktop: DesktopNotifier,
  floating: FloatingReceiverNotifier,
  config: EffectiveDaemonConfig,
  logger: DaemonLogger,
  store?: BinanceMarketStore,
  sourceTick?: DaemonTick,
): Promise<void> {
  const text = buildAlertText(alert.title, alert.message);
  logger.warn(alert.title, { symbol: alert.symbol, value: alert.value, threshold: alert.threshold });
  if (config.telegram.enabled && telegram.enabled) {
    await telegram.sendRich(buildTelegramAlertMarkdown(alert), text);
  }
  if (config.weixin.enabled && config.weixin.alert_enabled && weixin.canSend) {
    await weixin.send(text);
  }
  if (ntfy.enabled) {
    const priority = alert.severity === "critical"
      ? Math.min(5, config.ntfy.alert_priority + 1)
      : config.ntfy.alert_priority;
    const tag = alert.value >= 0 ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
    const ntfyAlert = buildNtfyAlertPayload(alert, store, sourceTick);
    await ntfy.send(ntfyAlert.title, ntfyAlert.message, { priority, tags: [tag] });
  }
  await floating.send(
    buildFloatingAlertTitle(alert),
    buildFloatingAlertMarkdown(alert),
    alert.severity,
    "alert",
    {
      id: alert.id,
      timestamp: alert.created_at,
      alert: buildFloatingAlertFields(alert),
    },
  );
  desktop.notify(alert.title, alert.message, alert.severity);
}

async function maybeBroadcastRankings(
  store: BinanceMarketStore,
  telegram: TelegramNotifier,
  weixin: WeixinNotifier,
  ntfy: NtfyNotifier,
  desktop: DesktopNotifier,
  floating: FloatingReceiverNotifier,
  config: EffectiveDaemonConfig,
  stateStore: StateStore,
  logger: DaemonLogger,
  force = false,
  binanceOnline = true,
): Promise<void> {
  const state = stateStore.get();
  const now = Date.now();
  if (!force && now - state.last_ranking_broadcast_at < config.ranking_broadcast.interval_seconds * 1000) return;
  if (store.getAllTicks().length === 0) return;
  const canWriteLog = config.ranking_broadcast.log_enabled;
  const canSendTelegram = config.ranking_broadcast.telegram_enabled && config.telegram.enabled && telegram.enabled;
  const canSendWeixin = config.ranking_broadcast.weixin_enabled && config.weixin.enabled && weixin.canSend;
  const canSendNtfy = config.ranking_broadcast.ntfy_enabled && ntfy.enabled;
  const canSendDesktop = config.ranking_broadcast.desktop_enabled && config.desktop_notify.enabled;
  const canSendFloating = floating.enabled;
  if (!canWriteLog && !canSendTelegram && !canSendWeixin && !canSendNtfy && !canSendDesktop && !canSendFloating) return;

  const rankingText = binanceOnline
    ? formatRankingBroadcast(store, config.ranking_broadcast.sections, config.ranking_broadcast.top_n)
    : "";
  const watchlistText = formatWatchlistBroadcast(store, config.watchlist);
  const text = [rankingText, watchlistText].filter(Boolean).join("\n\n");
  if (canWriteLog) {
    logger.info(`Ranking broadcast\n${text}`);
  }
  let richText = text;
  if (canSendTelegram || canSendFloating) {
    const telegramRankingText = binanceOnline
      ? formatTelegramRankingBroadcast(store, config.ranking_broadcast.sections, config.ranking_broadcast.top_n)
      : "";
    const telegramWatchlistText = formatTelegramWatchlistBroadcast(store, config.watchlist);
    richText = [telegramRankingText, telegramWatchlistText].filter(Boolean).join("\n\n") || text;
    if (canSendTelegram) {
      await telegram.sendRich(richText, text);
      logger.info("Telegram ranking broadcast sent");
    }
  }
  if (canSendWeixin) {
    const ok = await weixin.send(text);
    if (ok) logger.info("Weixin ranking broadcast sent");
  }
  if (canSendNtfy) {
    const ntfyBroadcast = buildNtfyBroadcastPayload(store, config, binanceOnline);
    const ok = await ntfy.send(ntfyBroadcast.title, ntfyBroadcast.message, {
      markdown: true,
      priority: config.ntfy.broadcast_priority,
      tags: ["bar_chart"],
    });
    if (ok) logger.info("Ntfy ranking broadcast sent");
  }
  if (canSendDesktop) {
    desktop.notifyForced("Quantum Ranking", formatDesktopRankingSummary(store, config.watchlist));
    logger.info("Desktop ranking summary requested");
  }
  if (canSendFloating) {
    await floating.send("Quantum Ranking", richText, "info", "scheduled");
  }
  await stateStore.update(current => ({ ...current, last_ranking_broadcast_at: now }));
  if (canSendTelegram || canSendWeixin || canSendNtfy || canSendDesktop || canSendFloating) {
    logger.info("Ranking broadcast sent");
  }
}

async function primeTelegramOffset(
  config: EffectiveDaemonConfig,
  telegram: TelegramNotifier,
  stateStore: StateStore,
  logger: DaemonLogger,
): Promise<void> {
  if (!config.telegram.enabled || !config.telegram.command_polling_enabled || !config.commands.enabled || !telegram.enabled) return;
  const state = stateStore.get();
  if (state.telegram_update_offset > 0) return;
  try {
    const updates = await telegram.getUpdates(0);
    const latest = Math.max(0, ...updates.map(update => update.update_id));
    if (latest > 0) {
      await stateStore.update(current => ({ ...current, telegram_update_offset: latest + 1 }));
      logger.info(`Skipped ${updates.length} old Telegram updates`);
    }
  } catch (err) {
    logger.warn("Telegram offset priming failed", err);
  }
}

async function runTelegramLongPollLoop(
  store: BinanceMarketStore,
  telegram: TelegramNotifier,
  config: EffectiveDaemonConfig,
  stateStore: StateStore,
  logger: DaemonLogger,
  signal: AbortSignal,
): Promise<void> {
  const retryDelayMs = Math.max(2, config.telegram.command_poll_interval_seconds) * 1000;
  while (!signal.aborted) {
    const ok = await pollTelegramCommands(store, telegram, config, stateStore, logger, signal);
    if (signal.aborted) break;
    if (!ok) {
      await delayWithSignal(retryDelayMs, signal);
    }
  }
}

async function pollTelegramCommands(
  store: BinanceMarketStore,
  telegram: TelegramNotifier,
  config: EffectiveDaemonConfig,
  stateStore: StateStore,
  logger: DaemonLogger,
  signal: AbortSignal,
): Promise<boolean> {
  const offset = stateStore.get().telegram_update_offset;
  let updates: TelegramUpdate[] = [];
  try {
    updates = await telegram.getUpdates(offset, 25, signal);
  } catch (err) {
    if (signal.aborted) return true;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Telegram command polling failed: ${msg}`);
    return false;
  }

  for (const update of updates) {
    await stateStore.update(current => ({ ...current, telegram_update_offset: Math.max(current.telegram_update_offset, update.update_id + 1) }));
    const message = update.message;
    if (!message?.text) continue;
    if (!telegram.isAllowedChat(message.chat.id)) continue;
    const response = handleCommand(message.text, store, config);
    if (response) await telegram.sendToChat(message.chat.id, response);
  }
  return true;
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function handleCommand(text: string, store: BinanceMarketStore, config: EffectiveDaemonConfig): string | null {
  const [commandRaw, arg1, arg2] = text.trim().split(/\s+/);
  const command = commandRaw?.split("@")[0].toLowerCase();
  if (!command) return null;

  if (command === "/help" || command === "help") return formatHelp();
  if (command === "/status" || command === "status") return formatStatus(store);
  if (command === "/config" || command === "config") return formatConfig(config);
  if (command === "/symbol" || command === "symbol") {
    if (!arg1) return "用法：/symbol BTCUSDT";
    const tick = store.getTick(normalizeSymbol(arg1));
    return tick ? formatSymbolInfo(tick, store.getSymbolRanks(tick.symbol)) : `暂无 ${arg1} 的实时数据`;
  }
  if (command === "/top" || command === "top") {
    const kind = parseRankingKind(arg1);
    if (!kind) return "用法：/top up|down|ma1m|ma15m|ma1d [数量]";
    const topN = clampTopN(arg2, config.commands.max_top_n);
    return formatTopCommand(store, kind, topN);
  }
  return null;
}

function parseRankingKind(value: string | undefined): RankingKind | null {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "up" || normalized === "change" || normalized === "change_up") return "change_up";
  if (normalized === "down" || normalized === "change_down") return "change_down";
  if (normalized === "ma1m" || normalized === "ma60_1m") return "ma60_1m";
  if (normalized === "ma15m" || normalized === "ma60_15m") return "ma60_15m";
  if (normalized === "ma1d" || normalized === "ma60_1d" || normalized === "mad") return "ma60_1d";
  return null;
}

function clampTopN(value: string | undefined, max: number): number {
  const parsed = Number(value || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.round(parsed), 1), max);
}

function formatConfig(config: EffectiveDaemonConfig): string {
  const sections: RankingSection[] = config.ranking_broadcast.sections;
  const watchlistItems = config.watchlist.items
    .filter(item => item.enabled)
    .map(item => `${item.symbol}${item.label ? `(${item.label})` : ""}`)
    .join(", ");
  return [
    "[轻量守护配置]",
    `监控 Top：${config.monitor.effective_top_volume}`,
    `价格刷新：${config.monitor.effective_price_seconds}s`,
    `瞬时预警：${config.instant_move.enabled ? "on" : "off"} / ${config.instant_move.effective_window_seconds}s / 币安 ${config.instant_move.effective_threshold_percent}% / Watchlist ${config.instant_move.effective_watchlist_threshold_percent}%`,
    `冷却：${config.cooldown.effective_base_seconds}s / 阶梯 ${config.cooldown.same_direction_step_percent}%`,
    `MA60：${config.ma60_alerts.enabled ? "on" : "off"}`,
    `广播：${config.ranking_broadcast.enabled ? "on" : "off"} / ${config.ranking_broadcast.interval_seconds}s / Top${config.ranking_broadcast.top_n}`,
    `广播栏目：${sections.join(", ")}`,
    `Watchlist：${config.watchlist.enabled ? "on" : "off"} / ${config.watchlist.price_seconds}s`,
    `Watchlist品种：${watchlistItems || "暂无"}`,
  ].join("\n");
}

function buildRefreshIntervals(settings: Partial<MarketRefreshIntervalSettings> | undefined): MarketRefreshIntervalSettings {
  return {
    price_seconds: settings?.price_seconds ?? 1,
    ma60_1m_seconds: settings?.ma60_1m_seconds ?? 60,
    ma60_15m_seconds: settings?.ma60_15m_seconds ?? 300,
    ma60_1d_seconds: settings?.ma60_1d_seconds ?? 3600,
  };
}

main().catch((err) => {
  console.error("[BinanceAlertDaemon] Fatal error:", err);
  process.exit(1);
});
