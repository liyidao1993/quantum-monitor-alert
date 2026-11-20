import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes.js";

export type RankingSection = "change_up" | "change_down" | "ma60_1m" | "ma60_15m" | "ma60_1d";
export type Severity = "info" | "warning" | "critical";
export type WatchlistMarket = "Futures_Global" | "Stocks_US" | "Futures_CN" | "Crypto_Binance";

export interface WatchlistItemSettings {
  symbol: string;
  market: WatchlistMarket;
  label?: string;
  enabled: boolean;
}

export interface WatchlistSettings {
  enabled: boolean;
  price_seconds: number;
  items: WatchlistItemSettings[];
}

export interface AlertDaemonConfig {
  enabled: boolean;
  monitor: {
    top_volume: number;
    price_seconds: number;
    status_log_seconds: number;
  };
  instant_move: {
    enabled: boolean;
    window_seconds: number;
    threshold_percent: number;
    watchlist_threshold_percent: number;
  };
  cooldown: {
    base_seconds: number;
    same_direction_step_percent: number;
    max_alerts_per_symbol_per_10min: number;
    separate_up_down: boolean;
  };
  ma60_alerts: {
    enabled: boolean;
    cooldown_seconds: number;
    same_direction_step_percent: number;
    intervals: {
      "1m": { enabled: boolean; threshold_percent: number };
      "15m": { enabled: boolean; threshold_percent: number };
      "1d": { enabled: boolean; threshold_percent: number };
    };
  };
  ranking_broadcast: {
    enabled: boolean;
    log_enabled: boolean;
    broadcast_on_startup: boolean;
    telegram_enabled: boolean;
    weixin_enabled: boolean;
    ntfy_enabled: boolean;
    desktop_enabled: boolean;
    interval_seconds: number;
    top_n: number;
    sections: RankingSection[];
  };
  watchlist: WatchlistSettings;
  telegram: {
    enabled: boolean;
    bot_token: string;
    chat_id: string;
    command_polling_enabled: boolean;
    command_poll_interval_seconds: number;
    send_startup_message: boolean;
  };
  weixin: {
    enabled: boolean;
    alert_enabled: boolean;
    credential_path: string;
    state_path: string;
    command_polling_enabled: boolean;
    send_startup_message: boolean;
  };
  ntfy: {
    enabled: boolean;
    base_url: string;
    topic: string;
    token: string;
    alert_priority: number;
    broadcast_priority: number;
  };
  desktop_notify: {
    enabled: boolean;
    sound: boolean;
    min_severity: Severity;
  };
  commands: {
    enabled: boolean;
    max_top_n: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file_enabled: boolean;
    file_path: string;
  };
}

export interface EffectiveDaemonConfig extends AlertDaemonConfig {
  monitor: AlertDaemonConfig["monitor"] & {
    effective_top_volume: number;
    effective_price_seconds: number;
  };
  instant_move: AlertDaemonConfig["instant_move"] & {
    effective_window_seconds: number;
    effective_threshold_percent: number;
    effective_watchlist_threshold_percent: number;
  };
  cooldown: AlertDaemonConfig["cooldown"] & {
    effective_base_seconds: number;
  };
  telegram: AlertDaemonConfig["telegram"] & {
    effective_bot_token: string;
    effective_chat_id: string;
  };
}

export const DEFAULT_DAEMON_CONFIG: AlertDaemonConfig = {
  enabled: true,
  monitor: {
    top_volume: 0,
    price_seconds: 0,
    status_log_seconds: 60,
  },
  instant_move: {
    enabled: true,
    window_seconds: 90,
    threshold_percent: 3,
    watchlist_threshold_percent: 1,
  },
  cooldown: {
    base_seconds: 0,
    same_direction_step_percent: 2,
    max_alerts_per_symbol_per_10min: 6,
    separate_up_down: true,
  },
  ma60_alerts: {
    enabled: false,
    cooldown_seconds: 300,
    same_direction_step_percent: 3,
    intervals: {
      "1m": { enabled: true, threshold_percent: 8 },
      "15m": { enabled: true, threshold_percent: 12 },
      "1d": { enabled: false, threshold_percent: 20 },
    },
  },
  ranking_broadcast: {
    enabled: true,
    log_enabled: true,
    broadcast_on_startup: true,
    telegram_enabled: true,
    weixin_enabled: false,
    ntfy_enabled: true,
    desktop_enabled: false,
    interval_seconds: 900,
    top_n: 10,
    sections: ["change_up", "change_down", "ma60_1m", "ma60_15m", "ma60_1d"],
  },
  watchlist: {
    enabled: true,
    price_seconds: 15,
    items: [
      { symbol: "GC1!", market: "Futures_Global", label: "黄金", enabled: true },
      { symbol: "CL1!", market: "Futures_Global", label: "石油", enabled: true },
      { symbol: "NVDA", market: "Stocks_US", label: "英伟达", enabled: true },
      { symbol: "ZC1!", market: "Futures_Global", label: "美玉米", enabled: true },
      { symbol: "C0", market: "Futures_CN", label: "国内玉米主力", enabled: true },
    ],
  },
  telegram: {
    enabled: true,
    bot_token: "",
    chat_id: "",
    command_polling_enabled: true,
    command_poll_interval_seconds: 5,
    send_startup_message: false,
  },
  weixin: {
    enabled: false,
    alert_enabled: false,
    credential_path: ".runtime/weixin/token.json",
    state_path: ".runtime/weixin/state.json",
    command_polling_enabled: true,
    send_startup_message: false,
  },
  ntfy: {
    enabled: false,
    base_url: "http://127.0.0.1:80",
    topic: "",
    token: "",
    alert_priority: 4,
    broadcast_priority: 2,
  },
  desktop_notify: {
    enabled: false,
    sound: true,
    min_severity: "warning",
  },
  commands: {
    enabled: true,
    max_top_n: 20,
  },
  logging: {
    level: "info",
    file_enabled: true,
    file_path: ".runtime/alert-daemon/binance-alert-daemon.log",
  },
};

export async function loadAppSettings(projectRoot = process.cwd()): Promise<AppSettings> {
  const settingsPath = path.join(projectRoot, "Quantum_Monitor_System/1_Core_Engine/settings.json");
  const raw = await readFile(settingsPath, "utf8");
  return JSON.parse(raw) as AppSettings;
}

export async function loadDaemonConfig(projectRoot = process.cwd()): Promise<AlertDaemonConfig> {
  const configPath = path.join(projectRoot, "alert-daemon.config.json");
  const raw = await readFile(configPath, "utf8");
  return normalizeDaemonConfig(deepMerge(DEFAULT_DAEMON_CONFIG, JSON.parse(raw) as Partial<AlertDaemonConfig>));
}

export function buildEffectiveConfig(settings: AppSettings, config: AlertDaemonConfig): EffectiveDaemonConfig {
  const cryptoThresholds = settings.AlertSettings.thresholds.Crypto_Binance;
  const refresh = settings.RefreshIntervalSettings.Crypto_Binance;
  const telegramToken = config.telegram.bot_token || settings.AlertSettings.telegram_bot_token || "";
  const telegramChatId = config.telegram.chat_id || settings.AlertSettings.telegram_chat_id || "";

  return {
    ...config,
    monitor: {
      ...config.monitor,
      effective_top_volume: clampInteger(config.monitor.top_volume || settings.BinanceSettings.monitor_top_volume || 50, 1, 200),
      effective_price_seconds: clampNumber(config.monitor.price_seconds || refresh?.price_seconds || 1, 1, 3600),
    },
    instant_move: {
      ...config.instant_move,
      effective_window_seconds: clampNumber(config.instant_move.window_seconds || cryptoThresholds?.instant_window_seconds || 60, 5, 3600),
      effective_threshold_percent: clampNumber(config.instant_move.threshold_percent || cryptoThresholds?.instant_move_percent || 1, 0.01, 100),
      effective_watchlist_threshold_percent: clampNumber(config.instant_move.watchlist_threshold_percent || 1, 0.01, 100),
    },
    cooldown: {
      ...config.cooldown,
      effective_base_seconds: clampNumber(config.cooldown.base_seconds || settings.AlertSettings.cooldown_seconds || 90, 1, 3600),
    },
    watchlist: normalizeWatchlistConfig(config.watchlist),
    telegram: {
      ...config.telegram,
      effective_bot_token: telegramToken,
      effective_chat_id: telegramChatId,
    },
  };
}

export function applyBinanceEnvironment(settings: AppSettings): void {
  const api = settings.ApiEndpointSettings;
  process.env.BINANCE_FAPI_BASE = api.binance_fapi_base;
  process.env.BINANCE_WS_BASE = api.binance_ws_base;
  process.env.BINANCE_USE_ALL_TICKER_STREAM = String(api.binance_use_all_ticker_stream);
  process.env.BINANCE_PROXY_LOG = "false";

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

function normalizeDaemonConfig(config: AlertDaemonConfig): AlertDaemonConfig {
  return {
    ...config,
    monitor: {
      ...config.monitor,
      status_log_seconds: clampNumber(config.monitor.status_log_seconds, 10, 3600),
    },
    instant_move: {
      ...config.instant_move,
      window_seconds: clampNumber(config.instant_move.window_seconds, 5, 3600),
      threshold_percent: clampNumber(config.instant_move.threshold_percent, 0.01, 100),
      watchlist_threshold_percent: clampNumber(config.instant_move.watchlist_threshold_percent || 1, 0.01, 100),
    },
    cooldown: {
      ...config.cooldown,
      same_direction_step_percent: clampNumber(config.cooldown.same_direction_step_percent, 0, 100),
      max_alerts_per_symbol_per_10min: clampInteger(config.cooldown.max_alerts_per_symbol_per_10min, 1, 100),
    },
    ma60_alerts: {
      ...config.ma60_alerts,
      cooldown_seconds: clampNumber(config.ma60_alerts.cooldown_seconds, 1, 7200),
      same_direction_step_percent: clampNumber(config.ma60_alerts.same_direction_step_percent, 0, 100),
    },
    ranking_broadcast: {
      ...config.ranking_broadcast,
      interval_seconds: clampNumber(config.ranking_broadcast.interval_seconds, 30, 86400),
      top_n: clampInteger(config.ranking_broadcast.top_n, 1, 20),
      sections: config.ranking_broadcast.sections.filter(isRankingSection),
    },
    watchlist: normalizeWatchlistConfig(config.watchlist),
    telegram: {
      ...config.telegram,
      command_poll_interval_seconds: clampNumber(config.telegram.command_poll_interval_seconds, 2, 300),
    },
    ntfy: {
      ...config.ntfy,
      base_url: (config.ntfy.base_url || "").trim().replace(/\/+$/, ""),
      topic: (config.ntfy.topic || "").trim(),
      token: (config.ntfy.token || "").trim(),
      alert_priority: clampInteger(config.ntfy.alert_priority || 4, 1, 5),
      broadcast_priority: clampInteger(config.ntfy.broadcast_priority || 2, 1, 5),
    },
    commands: {
      ...config.commands,
      max_top_n: clampInteger(config.commands.max_top_n, 1, 50),
    },
  };
}

function normalizeWatchlistConfig(config: WatchlistSettings): WatchlistSettings {
  const items = Array.isArray(config.items)
    ? config.items.map(normalizeWatchlistItem).filter((item): item is WatchlistItemSettings => item !== null)
    : [];

  return {
    enabled: config.enabled !== false,
    price_seconds: clampNumber(config.price_seconds || 30, 5, 3600),
    items: items.length > 0 ? items : DEFAULT_DAEMON_CONFIG.watchlist.items.map(item => ({ ...item })),
  };
}

function normalizeWatchlistItem(item: WatchlistItemSettings): WatchlistItemSettings | null {
  const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
  const market = isWatchlistMarket(item.market) ? item.market : null;
  if (!symbol || !market) return null;
  return {
    symbol,
    market,
    label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined,
    enabled: item.enabled !== false,
  };
}

function isWatchlistMarket(value: string): value is WatchlistMarket {
  return value === "Futures_Global" || value === "Stocks_US" || value === "Futures_CN" || value === "Crypto_Binance";
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isRecord(base) || !isRecord(override)) return override === undefined ? base : override as T;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = output[key];
    output[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return output as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRankingSection(value: string): value is RankingSection {
  return value === "change_up" || value === "change_down" || value === "ma60_1m" || value === "ma60_15m" || value === "ma60_1d";
}

function clampNumber(value: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(Math.max(parsed, min), max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}
