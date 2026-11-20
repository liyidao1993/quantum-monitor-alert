import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuantumSSE, controlModule, type QuantumAlert, type QuantumTick } from "./useQuantumSSE";
import { ChartWindow, type ChartInterval } from "./components/ChartWindow";
import { BinanceView, type BinanceSortKey, type SortDirection } from "./views/BinanceView";
import { FuturesCnView } from "./views/FuturesCnView";
import { FuturesGlobalView } from "./views/FuturesGlobalView";
import { MacroHomeView } from "./views/MacroHomeView";
import { SettingsView } from "./views/SettingsView";
import { StocksCnHeatView } from "./views/StocksCnHeatView";
import { StocksUsView } from "./views/StocksUsView";
import { selectTicksByMarket } from "./shared/marketSelectors";
import type { AppSettings, MacroNewsSummary } from "../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes";
import {
  Activity,
  Bitcoin,
  Database,
  Gauge,
  Globe2,
  Home,
  LineChart,
  Pause,
  Play,
  Settings,
} from "lucide-react";

type ModuleId =
  | "Macro_Home"
  | "Crypto_Binance"
  | "Stocks_CN"
  | "Stocks_US"
  | "Futures_CN"
  | "Futures_Global"
  | "Settings";

type MarketTick = QuantumTick;
type SettingsSaveState = "idle" | "saving" | "saved" | "error";
type TickerNotice = {
  id: string;
  kind: "alert" | "breaking";
  title: string;
  meta: string;
  severity?: QuantumAlert["severity"];
};

const navItems: Array<{ id: ModuleId; label: string; icon: typeof Home }> = [
  { id: "Macro_Home", label: "宏观首页", icon: Home },
  { id: "Crypto_Binance", label: "币安合约", icon: Bitcoin },
  { id: "Stocks_CN", label: "国内股票", icon: LineChart },
  { id: "Stocks_US", label: "美股", icon: LineChart },
  { id: "Futures_CN", label: "国内期货", icon: Gauge },
  { id: "Futures_Global", label: "外盘期货", icon: Globe2 },
  { id: "Settings", label: "全局设置", icon: Settings },
];

const DEFAULT_APP_SETTINGS: AppSettings = {
  GlobalSettings: {
    color_theme: "Dark",
    price_color_style: "RedUpGreenDown",
    auto_start_modules: ["Futures_CN", "Stocks_CN"],
  },
  BinanceSettings: {
    monitor_top_volume: 50,
    visible_columns: {
      show_price: true,
      show_24h_change: true,
      show_abnormal_change: false,
      show_ma60_1m: true,
      show_ma60_15m: true,
      show_ma60_1d: true,
    },
    abnormal_calc_rule: {
      time_window_min: 5,
      threshold_percent: 3,
    },
  },
  CustomMarketSettings: {
    cn_stocks_list: [],
    us_stocks_list: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"],
    cn_futures_list: [],
    futures_global_list: ["GC1!", "NQ1!", "ES1!", "CL1!", "SI1!", "YM1!"],
  },
  AlertSettings: {
    enabled: true,
    cooldown_seconds: 300,
    history_limit: 100,
    desktop_notify: false,
    sound_alert: true,
    telegram_enabled: false,
    telegram_bot_token: "",
    telegram_chat_id: "",
    thresholds: {},
  },
  ApiEndpointSettings: {
    binance_fapi_base: "https://fapi.binance.com",
    binance_ws_base: "wss://fstream.binancefuture.com/stream",
    binance_use_all_ticker_stream: true,
    socks_proxy: "socks5://127.0.0.1:10808",
    https_proxy: "",
    sina_min_line_url: "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine",
    sina_quote_url: "https://hq.sinajs.cn/list=",
    yahoo_chart_base: "https://query2.finance.yahoo.com/v8/finance/chart",
    tradingview_widget_url: "https://s3.tradingview.com/tv.js",
  },
  RefreshIntervalSettings: {
    Crypto_Binance: { price_seconds: 1, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
    Futures_CN: { price_seconds: 15, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
    Futures_Global: { price_seconds: 30, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
    Stocks_US: { price_seconds: 30, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
    Stocks_CN: { price_seconds: 30, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
    Macro_Home: { price_seconds: 60, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 },
  },
  NewsSettings: {
    enabled: true,
    key_refresh_seconds: 900,
    breaking_refresh_seconds: 60,
    cache_limit: 120,
    translate_english: true,
    translation_provider: "mymemory",
    translation_api_url: "https://api.mymemory.translated.net/get",
    ai_analysis_enabled: true,
    ai_provider: "openai_compatible",
    ai_api_base: "",
    ai_api_key: "",
    ai_model: "gpt-4o-mini",
    sources: [
      { id: "investing_cn_macro", label: "英为财情宏观", url: "https://cn.investing.com/rss/news_14.rss", enabled: true },
      { id: "investing_cn_futures", label: "英为财情期货", url: "https://cn.investing.com/rss/news_11.rss", enabled: true },
      { id: "investing_cn_stocks", label: "英为财情股票", url: "https://cn.investing.com/rss/news_25.rss", enabled: true },
      { id: "investing_cn_crypto", label: "英为财情加密", url: "https://cn.investing.com/rss/news_301.rss", enabled: true },
      { id: "investing_cn_market_overview", label: "英为财情市场概况", url: "https://cn.investing.com/rss/market_overview.rss", enabled: true },
      { id: "sina_us_stock", label: "新浪财经美股", url: "https://rss.sina.com.cn/finance/usstock.xml", enabled: true },
      { id: "tonghuashun_7x24", label: "同花顺7x24", url: "https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=50", enabled: true },
      { id: "jin10_important", label: "金十重要快讯", url: "https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1", enabled: true },
      { id: "jin10_market", label: "金十市场快讯", url: "https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1", enabled: true },
      { id: "cnbc_top", label: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", enabled: true },
      { id: "marketwatch_realtime", label: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/", enabled: true },
      { id: "nasdaq_markets", label: "Nasdaq", url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets", enabled: true },
      { id: "yahoo_finance", label: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", enabled: true },
      { id: "coindesk", label: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", enabled: true },
      { id: "cointelegraph", label: "Cointelegraph", url: "https://cointelegraph.com/rss", enabled: true },
    ],
  },
};

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>("Macro_Home");
  const { ticks, sseStatus, lastDataAt, binanceStatus, moduleStatuses, alerts, stocksCnHeat } = useQuantumSSE();
  const [monitorTop, setMonitorTop] = useState(50);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<BinanceSortKey>("ma60_dev_1m");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [priceColorStyle, setPriceColorStyle] = useState<"RedUpGreenDown" | "GreenUpRedDown">("RedUpGreenDown");
  const [chartTarget, setChartTarget] = useState<{ item: MarketTick; interval: ChartInterval } | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("idle");
  const [macroNews, setMacroNews] = useState<MacroNewsSummary | null>(null);
  const [tickerNotices, setTickerNotices] = useState<TickerNotice[]>([]);
  const [macroHomeEnabled, setMacroHomeEnabled] = useState(true);
  const lastNotifiedAlertId = useRef<string | null>(null);
  const expiredTickerNoticeIds = useRef<Set<string>>(new Set());
  const seenTickerNoticeIds = useRef<Set<string>>(new Set());
  const hasSeededBreakingNotices = useRef(false);

  const applyServerSettings = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
    setMonitorTop(settings.BinanceSettings.monitor_top_volume);
    setPriceColorStyle(settings.GlobalSettings.price_color_style);
  }, []);

  const activeModuleStatus = moduleStatuses.find((item) => item.market === activeModule)?.status ?? "unregistered";
  const isMacroHome = activeModule === "Macro_Home";
  const effectiveActiveModuleStatus = isMacroHome ? (macroHomeEnabled ? "running" : "sleeping") : activeModuleStatus;
  const isRunning = isMacroHome ? macroHomeEnabled : activeModuleStatus === "running";
  const isModuleControllable = isMacroHome || (activeModuleStatus !== "unregistered" && activeModuleStatus !== "destroyed");
  const binanceRows = useMemo(() => selectTicksByMarket(ticks.values(), "Crypto_Binance"), [ticks]);
  const futuresCnRows = useMemo(() => selectTicksByMarket(ticks.values(), "Futures_CN"), [ticks]);
  const futuresGlobalRows = useMemo(() => selectTicksByMarket(ticks.values(), "Futures_Global"), [ticks]);
  const stocksUsRows = useMemo(() => selectTicksByMarket(ticks.values(), "Stocks_US"), [ticks]);
  const activeTickCount = useMemo(
    () => countActiveTicks(activeModule, ticks.size, binanceRows.length, futuresCnRows.length, futuresGlobalRows.length, stocksUsRows.length, stocksCnHeat?.hot_stocks.length ?? 0),
    [activeModule, binanceRows.length, futuresCnRows.length, futuresGlobalRows.length, stocksCnHeat?.hot_stocks.length, stocksUsRows.length, ticks.size],
  );

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settings: AppSettings) => {
        applyServerSettings(settings);
      })
      .catch(() => setSettingsSaveState("error"));
  }, [applyServerSettings]);

  useEffect(() => {
    let cancelled = false;
    const loadNews = async () => {
      try {
        const response = await fetch("/api/news/summary");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as MacroNewsSummary;
        if (!cancelled) setMacroNews(payload);
      } catch {
        if (!cancelled) setMacroNews(null);
      }
    };
    void loadNews();
    const timer = window.setInterval(() => void loadNews(), 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const alert = alerts[0];
    if (!alert || lastNotifiedAlertId.current === alert.id) return;
    lastNotifiedAlertId.current = alert.id;
    const settings = appSettings.AlertSettings;
    if (!settings.enabled) return;
    if (settings.sound_alert) playAlertTone();
    if (settings.desktop_notify && "Notification" in window) {
      if (Notification.permission === "granted") {
        showDesktopNotification(alert);
      } else if (Notification.permission === "default") {
        void Notification.requestPermission().then((permission) => {
          if (permission === "granted") showDesktopNotification(alert);
        });
      }
    }
  }, [alerts, appSettings.AlertSettings]);

  useEffect(() => {
    const alertNotices: TickerNotice[] = alerts.slice(0, 5).map((alert) => ({
      id: `alert:${alert.id}`,
      kind: "alert" as const,
      title: alert.message,
      meta: `${alert.symbol} / ${alert.type}`,
      severity: alert.severity,
    }));
    const breakingNotices: TickerNotice[] = macroNews?.breaking.slice(0, 5).map((item) => ({
      id: `breaking:${item.id}`,
      kind: "breaking" as const,
      title: item.title,
      meta: `${item.source} / ${formatTickerTime(item.published_at)}`,
    })) ?? [];

    if (!hasSeededBreakingNotices.current && breakingNotices.length > 0) {
      for (const item of breakingNotices) {
        seenTickerNoticeIds.current.add(item.id);
      }
      hasSeededBreakingNotices.current = true;
    }

    const nextNotices: TickerNotice[] = [
      ...alertNotices,
      ...breakingNotices.filter((item) => !seenTickerNoticeIds.current.has(item.id)),
    ].filter((item) => !expiredTickerNoticeIds.current.has(item.id)).slice(0, 5);

    for (const item of nextNotices) {
      seenTickerNoticeIds.current.add(item.id);
    }

    if (nextNotices.length === 0) {
      setTickerNotices([]);
      return;
    }

    setTickerNotices((current) => {
      const currentById = new Map(current.map((item) => [item.id, item]));
      return nextNotices.map((item) => currentById.get(item.id) ?? item);
    });
  }, [alerts, macroNews]);

  const handleTickerNoticeDone = useCallback((id: string) => {
    expiredTickerNoticeIds.current.add(id);
    setTickerNotices((current) => current.filter((item) => item.id !== id));
  }, []);

  const handleToggleRunning = useCallback(async () => {
    if (activeModule === "Macro_Home") {
      setMacroHomeEnabled((current) => !current);
      return;
    }
    if (!isModuleControllable) return;
    const result = await controlModule(activeModule, isRunning ? "stop" : "start");
    if (result.settings) applyServerSettings(result.settings);
  }, [activeModule, applyServerSettings, isModuleControllable, isRunning]);

  const handlePriceColorStyleChange = useCallback((value: "RedUpGreenDown" | "GreenUpRedDown") => {
    setPriceColorStyle(value);
    setAppSettings((current) => ({
      ...current,
      GlobalSettings: { ...current.GlobalSettings, price_color_style: value },
    }));
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaveState("saving");
    try {
      const nextSettings: AppSettings = {
        ...appSettings,
        BinanceSettings: { ...appSettings.BinanceSettings, monitor_top_volume: monitorTop },
        GlobalSettings: { ...appSettings.GlobalSettings, price_color_style: priceColorStyle },
      };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      if (!res.ok) throw new Error("settings save failed");
      const json = await res.json() as { settings?: AppSettings };
      applyServerSettings(json.settings ?? nextSettings);
      setSettingsSaveState("saved");
      window.setTimeout(() => setSettingsSaveState("idle"), 1500);
    } catch {
      setSettingsSaveState("error");
    }
  }, [appSettings, applyServerSettings, monitorTop, priceColorStyle]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return binanceRows
      .filter((row) => row.symbol.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => compareSortValues(a[sortKey], b[sortKey], sortDirection));
  }, [binanceRows, query, sortDirection, sortKey]);

  function toggleSort(key: BinanceSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("desc");
  }

  return (
    <div className="quantum-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Q</div>
          <div>
            <strong>Quantum Monitor</strong>
            <span>Macro Market Console</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = activeModule === item.id;
            return (
              <button key={item.id} className={`nav-item ${selected ? "selected" : ""}`} type="button" onClick={() => setActiveModule(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className={`pulse-dot ${isRunning ? "green" : "red"}`} />
          <span>{moduleLabel(activeModule)} / {isModuleControllable ? statusLabel(effectiveActiveModuleStatus) : "按需页面"}</span>
        </div>
      </aside>

      <section className="workspace">
        <MarketTickerBar
          activeModule={activeModule}
          activeModuleStatus={effectiveActiveModuleStatus}
          isModuleControllable={isModuleControllable}
          isRunning={isRunning}
          notices={tickerNotices}
          onNoticeDone={handleTickerNoticeDone}
          onToggleRunning={() => void handleToggleRunning()}
        />

        <main className="main-view">
          {activeModule === "Macro_Home" && macroHomeEnabled && (
            <MacroHomeView
              alerts={alerts}
              lastDataAt={lastDataAt}
              moduleStatuses={moduleStatuses}
              onControlModule={async (market, action) => {
                const result = await controlModule(market, action);
                if (result.settings) applyServerSettings(result.settings);
              }}
              stocksCnHeat={stocksCnHeat}
              ticks={Array.from(ticks.values())}
            />
          )}
          {activeModule === "Macro_Home" && !macroHomeEnabled && (
            <section className="sleeping-panel">
              <Pause size={34} />
              <h2>首页已暂停</h2>
              <p>顶部通知条仍会接收突发消息；重新点击“首页暂停”按钮即可恢复首页行情驾驶舱。</p>
            </section>
          )}
          {activeModule === "Crypto_Binance" && (
            <BinanceView
              priceColorStyle={priceColorStyle}
              query={query}
              rows={filteredRows}
              sortDirection={sortDirection}
              sortKey={sortKey}
              onOpenChart={(item, interval) => setChartTarget({ item, interval })}
              onQueryChange={setQuery}
              onSort={toggleSort}
            />
          )}
          {activeModule === "Futures_CN" && <FuturesCnView onOpenChart={(item, interval) => setChartTarget({ item, interval })} priceColorStyle={priceColorStyle} rows={futuresCnRows} />}
          {activeModule === "Futures_Global" && <FuturesGlobalView onOpenChart={(item, interval) => setChartTarget({ item, interval })} priceColorStyle={priceColorStyle} rows={futuresGlobalRows} />}
          {activeModule === "Stocks_CN" && <StocksCnHeatView heat={stocksCnHeat} />}
          {activeModule === "Stocks_US" && <StocksUsView onOpenChart={(item, interval) => setChartTarget({ item, interval })} priceColorStyle={priceColorStyle} rows={stocksUsRows} />}
          {activeModule === "Settings" && (
            <SettingsView
              appSettings={appSettings}
              priceColorStyle={priceColorStyle}
              settingsSaveState={settingsSaveState}
              onAppSettingsChange={setAppSettings}
              onPriceColorStyleChange={handlePriceColorStyleChange}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </main>

        <footer className="status-bar">
          <span><Database size={14} /> SSE: {sseStatus === "connected" ? "已连接" : sseStatus === "connecting" ? "连接中" : "已断开"}</span>
          <span>当前模块: {moduleLabel(activeModule)} / {isModuleControllable ? statusLabel(effectiveActiveModuleStatus) : "按需"}</span>
          <span>币安流: {binanceStatus}</span>
          <span>当前页数据: {activeTickCount}</span>
          <span>Alerts: {alerts.length}</span>
          <span>最后更新: {lastDataAt ? new Date(lastDataAt).toLocaleTimeString("zh-CN", { hour12: false }) : "--"}</span>
        </footer>
      </section>

      {chartTarget && <ChartWindow initialInterval={chartTarget.interval} item={chartTarget.item} onClose={() => setChartTarget(null)} />}
    </div>
  );
}

function MarketTickerBar({
  activeModule,
  activeModuleStatus,
  isModuleControllable,
  isRunning,
  notices,
  onNoticeDone,
  onToggleRunning,
}: {
  activeModule: ModuleId;
  activeModuleStatus: string;
  isModuleControllable: boolean;
  isRunning: boolean;
  notices: TickerNotice[];
  onNoticeDone: (id: string) => void;
  onToggleRunning: () => void;
}) {
  const hasNotices = notices.length > 0;
  return (
    <header className="market-ticker-bar">
      <div className="ticker-module">
        <button
          className={`power-toggle compact ${isRunning ? "on" : "off"}`}
          disabled={!isModuleControllable}
          type="button"
          onClick={onToggleRunning}
          aria-label={isRunning ? `暂停${moduleLabel(activeModule)}` : `启动${moduleLabel(activeModule)}`}
        >
          {isRunning ? <Pause size={14} /> : <Play size={14} />}
          {activeModule === "Macro_Home" ? (isRunning ? "首页运行" : "首页暂停") : powerButtonLabel(activeModuleStatus, isModuleControllable)}
        </button>
      </div>

      <div className={`ticker-feed ${hasNotices ? "active" : "idle"}`} aria-live="polite">
        {hasNotices ? (
          <div className="ticker-lane">
            {notices.map((notice) => (
              <article
                className={`ticker-notice ${notice.kind} ${notice.severity ?? ""}`}
                key={notice.id}
                onAnimationEnd={() => onNoticeDone(notice.id)}
              >
                <span className="ticker-notice-kind">{notice.kind === "alert" ? "ALERT" : "BREAKING"}</span>
                <strong>{notice.title}</strong>
                <em>{notice.meta}</em>
              </article>
            ))}
          </div>
        ) : (
          <div className="quantum-wordmark" aria-label="Quantum Monitor">
            {"Quantum Monitor".split("").map((char, index) => (
              <span key={`${char}:${index}`} style={{ "--i": index } as CSSProperties}>{char === " " ? "\u00A0" : char}</span>
            ))}
          </div>
        )}
      </div>

    </header>
  );
}

function AlertDock({ alerts }: { alerts: QuantumAlert[] }) {
  return (
    <aside className="alert-dock">
      <div className="alert-dock-title">
        <Activity size={15} />
        <strong>Alerts</strong>
        <span>{alerts.length}</span>
      </div>
      <div className="alert-list">
        {alerts.slice(0, 5).map((alert) => (
          <div className={`alert-item ${alert.severity}`} key={alert.id}>
            <div>
              <strong>{alert.symbol}</strong>
              <span>{alert.type}</span>
            </div>
            <p>{alert.message}</p>
            <time>{new Date(alert.created_at).toLocaleTimeString("zh-CN", { hour12: false })}</time>
          </div>
        ))}
      </div>
    </aside>
  );
}

function playAlertTone(): void {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.34);
    window.setTimeout(() => void audioContext.close(), 500);
  } catch {
    // Browser autoplay policies may block audio until the user interacts with the page.
  }
}

function showDesktopNotification(alert: QuantumAlert): void {
  new Notification(`Quantum Monitor: ${alert.symbol}`, {
    body: alert.message,
    tag: alert.id,
  });
}

function moduleLabel(moduleId: ModuleId): string {
  return navItems.find((item) => item.id === moduleId)?.label ?? moduleId;
}

function statusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "starting") return "启动中";
  if (status === "stopping") return "停止中";
  if (status === "sleeping") return "已暂停";
  if (status === "error") return "异常";
  if (status === "destroyed") return "已销毁";
  return "未知";
}

function formatTickerTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "--";
  return new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function countActiveTicks(
  moduleId: ModuleId,
  totalTicks: number,
  binanceRows: number,
  futuresCnRows: number,
  futuresGlobalRows: number,
  stocksUsRows: number,
  stocksCnRows: number,
): number {
  if (moduleId === "Crypto_Binance") return binanceRows;
  if (moduleId === "Futures_CN") return futuresCnRows;
  if (moduleId === "Futures_Global") return futuresGlobalRows;
  if (moduleId === "Stocks_US") return stocksUsRows;
  if (moduleId === "Stocks_CN") return stocksCnRows;
  return totalTicks;
}

function compareSortValues(left: string | number | undefined, right: string | number | undefined, direction: SortDirection): number {
  if (typeof left === "string" || typeof right === "string") {
    const result = String(left ?? "").localeCompare(String(right ?? ""));
    return direction === "asc" ? result : -result;
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftValid = Number.isFinite(leftNumber);
  const rightValid = Number.isFinite(rightNumber);
  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return 1;
  if (!rightValid) return -1;
  const result = leftNumber - rightNumber;
  return direction === "asc" ? result : -result;
}

function powerButtonLabel(status: string, controllable: boolean): string {
  if (!controllable) return "按需页面";
  if (status === "running") return "运行中";
  if (status === "starting") return "启动中";
  if (status === "stopping") return "停止中";
  if (status === "error") return "异常";
  return "已暂停";
}
