import { Activity, BookOpen, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AlertThresholdSettings,
  AppSettings,
  MarketModuleName,
  MarketRefreshIntervalSettings,
  NewsSourceSettings,
} from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes";

type PriceColorStyle = "RedUpGreenDown" | "GreenUpRedDown";
type SettingsSaveState = "idle" | "saving" | "saved" | "error";
type EndpointTestState = "idle" | "testing" | "done" | "error";
type AlertTestState = "idle" | "testing" | "done" | "error";
type SymbolReferenceKind = "cn_futures" | "global_futures" | "us_stocks";

interface EndpointTestResult {
  name: string;
  ok: boolean;
  elapsed_ms: number;
  message: string;
}

const DEFAULT_ALERT_THRESHOLD: AlertThresholdSettings = {
  ma60_dev_1m: 5,
  ma60_dev_15m: 10,
  ma60_dev_1d: 20,
  instant_move_percent: 2,
  instant_window_seconds: 30,
};

const DEFAULT_REFRESH_INTERVAL: MarketRefreshIntervalSettings = {
  price_seconds: 30,
  ma60_1m_seconds: 60,
  ma60_15m_seconds: 300,
  ma60_1d_seconds: 3600,
};

const REFRESH_GROUPS: Array<{ label: string; description: string; market: MarketModuleName; defaults: MarketRefreshIntervalSettings }> = [
  { label: "币安合约", description: "价格走 WebSocket，MA60 以快照频率刷新。", market: "Crypto_Binance", defaults: { price_seconds: 1, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 } },
  { label: "国内期货", description: "Sina 行情轮询，适合秒到分钟级刷新。", market: "Futures_CN", defaults: { price_seconds: 15, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 } },
  { label: "外盘期货", description: "Yahoo 外盘期货接口刷新间隔。", market: "Futures_Global", defaults: DEFAULT_REFRESH_INTERVAL },
  { label: "美股", description: "Yahoo 美股接口刷新间隔。", market: "Stocks_US", defaults: DEFAULT_REFRESH_INTERVAL },
  { label: "国内股票", description: "A 股热度与自选数据刷新间隔。", market: "Stocks_CN", defaults: DEFAULT_REFRESH_INTERVAL },
  { label: "宏观首页", description: "首页聚合信息刷新间隔。", market: "Macro_Home", defaults: { price_seconds: 60, ma60_1m_seconds: 60, ma60_15m_seconds: 300, ma60_1d_seconds: 3600 } },
];

const ALERT_CATEGORY_GROUPS: Array<{ label: string; description: string; markets: MarketModuleName[]; defaults: AlertThresholdSettings }> = [
  { label: "虚拟货币", description: "适合高频观察，例如 60 秒内 1%。", markets: ["Crypto_Binance"], defaults: { ...DEFAULT_ALERT_THRESHOLD, instant_move_percent: 1, instant_window_seconds: 60 } },
  { label: "期货", description: "国内期货和外盘期货共用一组短线阈值。", markets: ["Futures_CN", "Futures_Global"], defaults: { ma60_dev_1m: 0.5, ma60_dev_15m: 1, ma60_dev_1d: 3, instant_move_percent: 1, instant_window_seconds: 60 } },
  { label: "股票/宏观", description: "股票、宏观模块的默认预警阈值。", markets: ["Stocks_US", "Stocks_CN", "Macro_Home"], defaults: { ma60_dev_1m: 1, ma60_dev_15m: 2, ma60_dev_1d: 5, instant_move_percent: 1, instant_window_seconds: 30 } },
];

const CN_FUTURES_REFERENCE = [
  { exchange: "SHFE", name: "螺纹钢", prefix: "RB", example: "RB0" },
  { exchange: "SHFE", name: "热卷", prefix: "HC", example: "HC0" },
  { exchange: "SHFE", name: "沪铜", prefix: "CU", example: "CU0" },
  { exchange: "SHFE", name: "沪铝", prefix: "AL", example: "AL0" },
  { exchange: "SHFE", name: "黄金", prefix: "AU", example: "AU0" },
  { exchange: "SHFE", name: "白银", prefix: "AG", example: "AG0" },
  { exchange: "INE", name: "原油", prefix: "SC", example: "SC0" },
  { exchange: "DCE", name: "玉米", prefix: "C", example: "C0" },
  { exchange: "DCE", name: "铁矿石", prefix: "I", example: "I0" },
  { exchange: "DCE", name: "焦炭", prefix: "J", example: "J0" },
  { exchange: "DCE", name: "焦煤", prefix: "JM", example: "JM0" },
  { exchange: "ZCE", name: "PTA", prefix: "TA", example: "TA0" },
  { exchange: "ZCE", name: "甲醇", prefix: "MA", example: "MA0" },
  { exchange: "ZCE", name: "玻璃", prefix: "FG", example: "FG0" },
  { exchange: "CFFEX", name: "沪深300股指", prefix: "IF", example: "IF0" },
  { exchange: "CFFEX", name: "中证1000股指", prefix: "IM", example: "IM0" },
  { exchange: "GFEX", name: "工业硅", prefix: "SI", example: "SI0" },
];

const US_STOCKS_REFERENCE = [
  { symbol: "AAPL", name: "Apple", exchange: "NASDAQ", example: "AAPL" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ", example: "MSFT" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", example: "NVDA" },
  { symbol: "TSLA", name: "Tesla", exchange: "NASDAQ", example: "TSLA" },
  { symbol: "META", name: "Meta Platforms", exchange: "NASDAQ", example: "META" },
  { symbol: "AMZN", name: "Amazon", exchange: "NASDAQ", example: "AMZN" },
  { symbol: "GOOGL", name: "Alphabet Class A", exchange: "NASDAQ", example: "GOOGL" },
  { symbol: "AMD", name: "Advanced Micro Devices", exchange: "NASDAQ", example: "AMD" },
  { symbol: "SPY", name: "S&P 500 ETF", exchange: "NYSE Arca", example: "SPY" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", exchange: "NASDAQ", example: "QQQ" },
  { symbol: "DIA", name: "Dow Jones ETF", exchange: "NYSE Arca", example: "DIA" },
  { symbol: "IWM", name: "Russell 2000 ETF", exchange: "NYSE Arca", example: "IWM" },
  { symbol: "XLK", name: "Technology Select Sector", exchange: "NYSE Arca", example: "XLK" },
  { symbol: "XLF", name: "Financial Select Sector", exchange: "NYSE Arca", example: "XLF" },
  { symbol: "XLE", name: "Energy Select Sector", exchange: "NYSE Arca", example: "XLE" },
  { symbol: "XLV", name: "Health Care Select Sector", exchange: "NYSE Arca", example: "XLV" },
  { symbol: "XLY", name: "Consumer Discretionary", exchange: "NYSE Arca", example: "XLY" },
  { symbol: "XLP", name: "Consumer Staples", exchange: "NYSE Arca", example: "XLP" },
  { symbol: "XLI", name: "Industrial Select Sector", exchange: "NYSE Arca", example: "XLI" },
  { symbol: "XLB", name: "Materials Select Sector", exchange: "NYSE Arca", example: "XLB" },
  { symbol: "XLU", name: "Utilities Select Sector", exchange: "NYSE Arca", example: "XLU" },
  { symbol: "XLRE", name: "Real Estate Select Sector", exchange: "NYSE Arca", example: "XLRE" },
  { symbol: "XLC", name: "Communication Services", exchange: "NYSE Arca", example: "XLC" },
];

const GLOBAL_FUTURES_REFERENCE = [
  { symbol: "GC1!", yahoo: "GC=F", name: "黄金", exchange: "COMEX", cnPeer: "AU0" },
  { symbol: "SI1!", yahoo: "SI=F", name: "白银", exchange: "COMEX", cnPeer: "AG0" },
  { symbol: "HG1!", yahoo: "HG=F", name: "美铜", exchange: "COMEX", cnPeer: "CU0" },
  { symbol: "CL1!", yahoo: "CL=F", name: "WTI 原油", exchange: "NYMEX", cnPeer: "SC0" },
  { symbol: "NG1!", yahoo: "NG=F", name: "天然气", exchange: "NYMEX", cnPeer: "PG0 / LU0" },
  { symbol: "ES1!", yahoo: "ES=F", name: "标普500股指", exchange: "CME", cnPeer: "IF0" },
  { symbol: "NQ1!", yahoo: "NQ=F", name: "纳指100股指", exchange: "CME", cnPeer: "IM0" },
  { symbol: "YM1!", yahoo: "YM=F", name: "道指", exchange: "CBOT", cnPeer: "IF0" },
  { symbol: "ZC1!", yahoo: "ZC=F", name: "玉米", exchange: "CBOT", cnPeer: "C0" },
  { symbol: "ZS1!", yahoo: "ZS=F", name: "大豆", exchange: "CBOT", cnPeer: "A0 / M0" },
  { symbol: "ZW1!", yahoo: "ZW=F", name: "小麦", exchange: "CBOT", cnPeer: "WH0" },
];

export function SettingsView({
  appSettings,
  onAppSettingsChange,
  onPriceColorStyleChange,
  onSaveSettings,
  priceColorStyle,
  settingsSaveState,
}: {
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
  onPriceColorStyleChange: (value: PriceColorStyle) => void;
  onSaveSettings: () => void;
  priceColorStyle: PriceColorStyle;
  settingsSaveState: SettingsSaveState;
}) {
  const api = appSettings.ApiEndpointSettings;
  const alerts = appSettings.AlertSettings;
  const news = appSettings.NewsSettings;
  const [endpointTestState, setEndpointTestState] = useState<EndpointTestState>("idle");
  const [endpointTestResults, setEndpointTestResults] = useState<EndpointTestResult[]>([]);
  const [alertTestState, setAlertTestState] = useState<AlertTestState>("idle");

  const updateApi = (key: keyof AppSettings["ApiEndpointSettings"], value: string | boolean) => {
    onAppSettingsChange({ ...appSettings, ApiEndpointSettings: { ...api, [key]: value } });
  };
  const updateAlerts = (nextAlertSettings: AppSettings["AlertSettings"]) => {
    onAppSettingsChange({ ...appSettings, AlertSettings: nextAlertSettings });
  };
  const updateNews = (nextNewsSettings: AppSettings["NewsSettings"]) => {
    onAppSettingsChange({ ...appSettings, NewsSettings: nextNewsSettings });
  };

  const testEndpoints = async () => {
    setEndpointTestState("testing");
    try {
      const response = await fetch("/api/settings/test-endpoints");
      const json = await response.json() as { results?: EndpointTestResult[] };
      setEndpointTestResults(json.results ?? []);
      setEndpointTestState("done");
    } catch {
      setEndpointTestResults([]);
      setEndpointTestState("error");
    }
  };

  const testAlertNotification = async () => {
    setAlertTestState("testing");
    try {
      const response = await fetch("/api/alerts/test", { method: "POST" });
      if (!response.ok) throw new Error("alert test failed");
      setAlertTestState("done");
    } catch {
      setAlertTestState("error");
    }
  };

  return (
    <section className="settings-panel">
      <div className="settings-header">
        <div className="section-title">
          <Settings size={18} />
          <h2>全局配置</h2>
        </div>
        <button className="control-button primary" type="button" onClick={onSaveSettings}>保存设置</button>
        <span className={`settings-save-state ${settingsSaveState}`}>{saveStateLabel(settingsSaveState)}</span>
      </div>

      <nav className="settings-tabs" aria-label="设置分组">
        <a href="#settings-appearance">外观</a>
        <a href="#settings-refresh">刷新间隔</a>
        <a href="#settings-symbols">品种列表</a>
        <a href="#settings-integrations">接口 / 新闻 / AI</a>
        <a href="#settings-alerts">预警</a>
      </nav>

      <div className="settings-section-label" id="settings-appearance">外观偏好</div>

      <div className="settings-row">
        <div>
          <strong>涨跌颜色习惯</strong>
          <span>影响价格、涨跌幅和偏离值的颜色方向。</span>
        </div>
        <div className="segmented">
          <button className={priceColorStyle === "RedUpGreenDown" ? "active" : ""} type="button" onClick={() => onPriceColorStyleChange("RedUpGreenDown")}>红涨绿跌</button>
          <button className={priceColorStyle === "GreenUpRedDown" ? "active" : ""} type="button" onClick={() => onPriceColorStyleChange("GreenUpRedDown")}>绿涨红跌</button>
        </div>
      </div>

      <div className="settings-section-label" id="settings-refresh">刷新间隔</div>
      <RefreshIntervalSettings appSettings={appSettings} onAppSettingsChange={onAppSettingsChange} />

      <div className="settings-section-label" id="settings-symbols">品种列表</div>
      <CustomMarketListSettings appSettings={appSettings} onAppSettingsChange={onAppSettingsChange} />

      <div className="settings-section-label" id="settings-integrations">接口 / 新闻 / AI</div>

      <div className="settings-row stacked">
        <div>
          <strong>API 接口设置</strong>
          <span>统一维护外部行情入口。保存后新连接或服务重启会读取这些地址。</span>
        </div>
        <div className="table-toolbar inline-toolbar">
          <button className="control-button" type="button" onClick={() => void testEndpoints()} disabled={endpointTestState === "testing"}>
            <Activity size={16} />
            {endpointTestState === "testing" ? "测试中" : "测试接口"}
          </button>
          <span className={`settings-save-state ${endpointTestState}`}>{endpointStateLabel(endpointTestState, endpointTestResults)}</span>
        </div>
        {endpointTestResults.length > 0 && (
          <div className="endpoint-test-list">
            {endpointTestResults.map((result) => (
              <div className={`endpoint-test-item ${result.ok ? "ok" : "error"}`} key={result.name}>
                <strong>{endpointLabel(result.name)}</strong>
                <span>{result.ok ? "可用" : "异常"}</span>
                <em>{result.elapsed_ms}ms / {result.message}</em>
              </div>
            ))}
          </div>
        )}
        <div className="settings-grid compact">
          <SettingsField label="币安合约 REST" value={api.binance_fapi_base} onChange={(value) => updateApi("binance_fapi_base", value)} />
          <SettingsField label="币安合约 WebSocket" value={api.binance_ws_base} onChange={(value) => updateApi("binance_ws_base", value)} />
          <SettingsField label="SOCKS 代理" value={api.socks_proxy} onChange={(value) => updateApi("socks_proxy", value)} />
          <SettingsField label="HTTPS 代理" value={api.https_proxy} onChange={(value) => updateApi("https_proxy", value)} />
          <SettingsField label="新浪期货分时" value={api.sina_min_line_url} onChange={(value) => updateApi("sina_min_line_url", value)} />
          <SettingsField label="新浪行情报价" value={api.sina_quote_url} onChange={(value) => updateApi("sina_quote_url", value)} />
          <SettingsField label="Yahoo K 线" value={api.yahoo_chart_base} onChange={(value) => updateApi("yahoo_chart_base", value)} />
          <SettingsField label="TradingView 组件" value={api.tradingview_widget_url} onChange={(value) => updateApi("tradingview_widget_url", value)} />
        </div>
        <div className="toggle-row">
          <label>
            <input checked={api.binance_use_all_ticker_stream} type="checkbox" onChange={(event) => updateApi("binance_use_all_ticker_stream", event.target.checked)} />
            币安使用全市场 miniTicker 流，并在本地过滤成交量 Top 品种
          </label>
        </div>
      </div>

      <div className="settings-row stacked">
        <div>
          <strong>新闻与 AI 分析</strong>
          <span>首页新闻由后端聚合 RSS 源，先规则评分，再按配置调用 AI 分析；缺少 Key 时自动降级。</span>
        </div>
        <div className="settings-grid compact">
          <NumberField label="重点新闻刷新(秒)" value={news.key_refresh_seconds} onChange={(value) => updateNews({ ...news, key_refresh_seconds: value })} />
          <NumberField label="突发新闻刷新(秒)" value={news.breaking_refresh_seconds} onChange={(value) => updateNews({ ...news, breaking_refresh_seconds: value })} />
          <NumberField label="新闻缓存数量" value={news.cache_limit} onChange={(value) => updateNews({ ...news, cache_limit: value })} />
          <SettingsField label="翻译接口" value={news.translation_api_url} onChange={(value) => updateNews({ ...news, translation_api_url: value })} />
        </div>
        <div className="segmented inline-segmented">
          <button className={news.translation_provider === "mymemory" ? "active" : ""} type="button" onClick={() => updateNews({ ...news, translation_provider: "mymemory" })}>MyMemory 翻译</button>
          <button className={news.translation_provider === "none" ? "active" : ""} type="button" onClick={() => updateNews({ ...news, translation_provider: "none" })}>不翻译</button>
          <button className={news.ai_provider === "openai_compatible" ? "active" : ""} type="button" onClick={() => updateNews({ ...news, ai_provider: "openai_compatible" })}>中转站</button>
          <button className={news.ai_provider === "google" ? "active" : ""} type="button" onClick={() => updateNews({ ...news, ai_provider: "google" })}>Google AI</button>
          <button className={news.ai_provider === "none" ? "active" : ""} type="button" onClick={() => updateNews({ ...news, ai_provider: "none" })}>规则分析</button>
        </div>
        {news.ai_provider !== "none" && (
          <div className="settings-row nested-settings-row">
            <div>
              <strong>{news.ai_provider === "openai_compatible" ? "AI 中转站配置" : "Google AI 配置"}</strong>
              <span>
                {news.ai_provider === "openai_compatible"
                  ? "兼容 DeepSeek 官方、OpenAI 第三方中转站，以及其它 OpenAI-compatible 国内模型接口。"
                  : "可填 Google/Gemini Key；留空时仍会尝试读取环境变量。"}
              </span>
            </div>
            <div className="settings-grid compact">
              {news.ai_provider === "openai_compatible" && (
                <SettingsField
                  label="中转站地址"
                  placeholder="https://api.deepseek.com/v1"
                  value={news.ai_api_base}
                  onChange={(value) => updateNews({ ...news, ai_api_base: value })}
                />
              )}
              <SettingsField
                label="API Key"
                placeholder={news.ai_provider === "openai_compatible" ? "sk-..." : "AIza..."}
                type="password"
                value={news.ai_api_key}
                onChange={(value) => updateNews({ ...news, ai_api_key: value })}
              />
              <SettingsField
                label="模型"
                placeholder={news.ai_provider === "openai_compatible" ? "deepseek-chat / gpt-4o-mini" : "gemini-2.5-flash"}
                value={news.ai_model}
                onChange={(value) => updateNews({ ...news, ai_model: value })}
              />
            </div>
          </div>
        )}
        <NewsSourceField
          label="新闻源"
          placeholder="英为财情宏观|https://cn.investing.com/rss/news_14.rss|on"
          value={formatNewsSources(news.sources)}
          onChange={(value) => updateNews({ ...news, sources: parseNewsSources(value) })}
        />
        <div className="toggle-row">
          <label>
            <input checked={news.enabled} type="checkbox" onChange={(event) => updateNews({ ...news, enabled: event.target.checked })} />
            启用首页新闻聚合
          </label>
          <label>
            <input checked={news.translate_english} type="checkbox" onChange={(event) => updateNews({ ...news, translate_english: event.target.checked })} />
            英文标题自动翻译成中文
          </label>
          <label>
            <input checked={news.ai_analysis_enabled} type="checkbox" onChange={(event) => updateNews({ ...news, ai_analysis_enabled: event.target.checked })} />
            启用 AI 影响解读
          </label>
        </div>
      </div>

      <div className="settings-section-label" id="settings-alerts">预警通知</div>

      <div className="settings-grid">
        <SettingsField label="Telegram Bot Token" placeholder="需要机器人通知时填写" type="password" value={alerts.telegram_bot_token} onChange={(value) => updateAlerts({ ...alerts, telegram_bot_token: value })} />
        <SettingsField label="Telegram Chat ID" value={alerts.telegram_chat_id} onChange={(value) => updateAlerts({ ...alerts, telegram_chat_id: value })} />
      </div>

      <AlertCategorySettings appSettings={appSettings} alertSettings={alerts} onAppSettingsChange={onAppSettingsChange} />

      <div className="settings-row stacked">
        <div>
          <strong>预警通知</strong>
          <span>控制预警开关、冷却时间和通知通道。</span>
        </div>
        <div className="table-toolbar inline-toolbar">
          <button className="control-button primary" type="button" onClick={() => void testAlertNotification()} disabled={alertTestState === "testing"}>
            <Activity size={16} />
            {alertTestState === "testing" ? "发送中" : "预警自检"}
          </button>
          <span className={`settings-save-state ${alertTestState}`}>{alertTestState === "done" ? "已发送测试预警" : alertTestState === "error" ? "发送失败" : "用于验证声音、桌面通知和预警流"}</span>
        </div>
        <div className="settings-grid compact">
          <NumberField label="冷却时间(秒)" value={alerts.cooldown_seconds} onChange={(value) => updateAlerts({ ...alerts, cooldown_seconds: value })} />
          <NumberField label="历史保留数量" value={alerts.history_limit} onChange={(value) => updateAlerts({ ...alerts, history_limit: value })} />
        </div>
        <div className="toggle-row">
          <label><input checked={alerts.enabled} type="checkbox" onChange={(event) => updateAlerts({ ...alerts, enabled: event.target.checked })} />启用预警</label>
          <label><input checked={alerts.sound_alert} type="checkbox" onChange={(event) => updateAlerts({ ...alerts, sound_alert: event.target.checked })} />声音提醒</label>
          <label><input checked={alerts.desktop_notify} type="checkbox" onChange={(event) => updateAlerts({ ...alerts, desktop_notify: event.target.checked })} />桌面通知</label>
          <label><input checked={alerts.telegram_enabled} type="checkbox" onChange={(event) => updateAlerts({ ...alerts, telegram_enabled: event.target.checked })} />Telegram 通知</label>
        </div>
      </div>
    </section>
  );
}

function endpointLabel(name: string): string {
  if (name === "binance_fapi") return "币安合约 REST";
  if (name === "sina_futures") return "新浪期货";
  if (name === "yahoo_futures") return "Yahoo 外盘";
  if (name === "yahoo_us_stocks") return "Yahoo 美股";
  if (name === "eastmoney_stocks_cn_heat") return "东方财富热度";
  if (name === "tradingview_widget") return "TradingView";
  if (name === "macro_news") return "宏观新闻";
  return name;
}

function CustomMarketListSettings({ appSettings, onAppSettingsChange }: { appSettings: AppSettings; onAppSettingsChange: (settings: AppSettings) => void }) {
  const custom = appSettings.CustomMarketSettings;
  const [reference, setReference] = useState<SymbolReferenceKind | null>(null);
  return (
    <div className="settings-row stacked">
      <div>
        <strong>自定义监控品种</strong>
        <span>保存后对应模块重启生效。</span>
      </div>
      <div className="settings-grid">
        <ListField label="国内期货" placeholder="C0, RB0, AU0, SC0, IF0" referenceLabel="国内期货代码对照" value={custom.cn_futures_list ?? []} onChange={(value) => updateCustomList(appSettings, onAppSettingsChange, "cn_futures_list", value)} onOpenReference={() => setReference("cn_futures")} />
        <ListField label="外盘期货" placeholder="GC1!, NQ1!, ES1!, CL1!, SI1!, YM1!" referenceLabel="外盘期货代码对照" value={custom.futures_global_list ?? []} onChange={(value) => updateCustomList(appSettings, onAppSettingsChange, "futures_global_list", value)} onOpenReference={() => setReference("global_futures")} />
        <ListField label="美股" placeholder="AAPL, MSFT, NVDA, TSLA, SPY" referenceLabel="美股代码对照" value={custom.us_stocks_list ?? []} onChange={(value) => updateCustomList(appSettings, onAppSettingsChange, "us_stocks_list", value)} onOpenReference={() => setReference("us_stocks")} />
        <ListField label="国内股票" placeholder="sh600519, sz000858" value={custom.cn_stocks_list ?? []} onChange={(value) => updateCustomList(appSettings, onAppSettingsChange, "cn_stocks_list", value)} />
      </div>
      {reference && <SymbolReferenceDialog kind={reference} onClose={() => setReference(null)} />}
    </div>
  );
}

function updateCustomList(appSettings: AppSettings, onAppSettingsChange: (settings: AppSettings) => void, key: keyof AppSettings["CustomMarketSettings"], value: string[]): void {
  onAppSettingsChange({ ...appSettings, CustomMarketSettings: { ...appSettings.CustomMarketSettings, [key]: value } });
}

function RefreshIntervalSettings({ appSettings, onAppSettingsChange }: { appSettings: AppSettings; onAppSettingsChange: (settings: AppSettings) => void }) {
  return (
    <div className="settings-row stacked">
      <div>
        <strong>刷新间隔设置</strong>
        <span>按资产类别独立设置行情和 MA60 快照频率。</span>
      </div>
      <div className="alert-category-grid">
        {REFRESH_GROUPS.map((group) => {
          const value = { ...group.defaults, ...(appSettings.RefreshIntervalSettings?.[group.market] ?? {}) };
          return (
            <div className="alert-category-card" key={group.market}>
              <div>
                <strong>{group.label}</strong>
                <span>{group.description}</span>
              </div>
              <NumberField label="价格刷新(秒)" value={value.price_seconds} onChange={(next) => updateRefreshInterval(appSettings, onAppSettingsChange, group.market, group.defaults, "price_seconds", next)} />
              <NumberField label="1分钟 MA60(秒)" value={value.ma60_1m_seconds} onChange={(next) => updateRefreshInterval(appSettings, onAppSettingsChange, group.market, group.defaults, "ma60_1m_seconds", next)} />
              <NumberField label="15分钟 MA60(秒)" value={value.ma60_15m_seconds} onChange={(next) => updateRefreshInterval(appSettings, onAppSettingsChange, group.market, group.defaults, "ma60_15m_seconds", next)} />
              <NumberField label="日线 MA60(秒)" value={value.ma60_1d_seconds} onChange={(next) => updateRefreshInterval(appSettings, onAppSettingsChange, group.market, group.defaults, "ma60_1d_seconds", next)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function updateRefreshInterval(appSettings: AppSettings, onAppSettingsChange: (settings: AppSettings) => void, market: MarketModuleName, defaults: MarketRefreshIntervalSettings, field: keyof MarketRefreshIntervalSettings, value: number): void {
  const refresh = { ...(appSettings.RefreshIntervalSettings ?? {}) };
  refresh[market] = { ...defaults, ...(refresh[market] ?? {}), [field]: Math.max(1, value) };
  onAppSettingsChange({ ...appSettings, RefreshIntervalSettings: refresh });
}

function AlertCategorySettings({ appSettings, alertSettings, onAppSettingsChange }: { appSettings: AppSettings; alertSettings: AppSettings["AlertSettings"]; onAppSettingsChange: (settings: AppSettings) => void }) {
  return (
    <div className="settings-row stacked">
      <div>
        <strong>分类预警设置</strong>
        <span>按资产类别设置短线波动阈值。</span>
      </div>
      <div className="alert-category-grid">
        {ALERT_CATEGORY_GROUPS.map((group) => (
          <div className="alert-category-card" key={group.label}>
            <div>
              <strong>{group.label}</strong>
              <span>{group.description}</span>
            </div>
            <NumberField label="瞬时波动阈值(%)" value={getCategoryThreshold(alertSettings, group.markets, group.defaults, "instant_move_percent")} onChange={(value) => updateAlertCategoryThreshold(appSettings, onAppSettingsChange, group.markets, group.defaults, "instant_move_percent", value)} />
            <NumberField label="瞬时窗口(秒)" value={getCategoryThreshold(alertSettings, group.markets, group.defaults, "instant_window_seconds")} onChange={(value) => updateAlertCategoryThreshold(appSettings, onAppSettingsChange, group.markets, group.defaults, "instant_window_seconds", value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function updateAlertCategoryThreshold(appSettings: AppSettings, onAppSettingsChange: (settings: AppSettings) => void, markets: MarketModuleName[], defaults: AlertThresholdSettings, field: keyof AlertThresholdSettings, value: number): void {
  const thresholds = { ...appSettings.AlertSettings.thresholds };
  for (const market of markets) {
    thresholds[market] = { ...(thresholds[market] ?? defaults), [field]: value };
  }
  onAppSettingsChange({ ...appSettings, AlertSettings: { ...appSettings.AlertSettings, thresholds } });
}

function getCategoryThreshold(alertSettings: AppSettings["AlertSettings"], markets: MarketModuleName[], defaults: AlertThresholdSettings, field: keyof AlertThresholdSettings): number {
  const market = markets[0];
  return alertSettings.thresholds[market]?.[field] ?? defaults[field] ?? DEFAULT_ALERT_THRESHOLD[field];
}

function SettingsField({ label, onChange, placeholder, type = "text", value }: { label: string; onChange: (value: string) => void; placeholder?: string; type?: "password" | "text"; value: string }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input placeholder={placeholder} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ListField({ label, onChange, onOpenReference, placeholder, referenceLabel, value }: { label: string; onChange: (value: string[]) => void; onOpenReference?: () => void; placeholder?: string; referenceLabel?: string; value: string[] }) {
  const formattedValue = value.join(", ");
  const [draftValue, setDraftValue] = useState(formattedValue);

  useEffect(() => {
    setDraftValue(formattedValue);
  }, [formattedValue]);

  return (
    <div className="settings-field">
      <div className="field-label-row">
        <span>{label}</span>
        {onOpenReference && (
          <button className="field-note-button" type="button" onClick={onOpenReference} title={referenceLabel ?? "代码对照表"} aria-label={referenceLabel ?? "代码对照表"}>
            <BookOpen size={14} />
          </button>
        )}
      </div>
      <textarea
        placeholder={placeholder}
        value={draftValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);
          onChange(parseSymbolList(nextValue));
        }}
      />
    </div>
  );
}

function SymbolReferenceDialog({ kind, onClose }: { kind: SymbolReferenceKind; onClose: () => void }) {
  const isCnFutures = kind === "cn_futures";
  const isGlobalFutures = kind === "global_futures";
  const title = isCnFutures ? "国内期货代码对照表" : isGlobalFutures ? "外盘期货代码对照表" : "美股代码对照表";
  const description = isCnFutures
    ? "连续合约通常用 品种前缀 + 0，例如 RB0；具体月份可输入 RB2605 这类完整合约。"
    : isGlobalFutures
      ? "外盘期货使用 TradingView 连续合约写法，例如 GC1!；这里同时列出 Yahoo 数据代码和常见国内对照品种。"
      : "输入 ticker 即可，多个代码用逗号或空格分隔。";
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <section className="symbol-reference-dialog">
        <header>
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭代码对照表">
            <X size={18} />
          </button>
        </header>
        <div className="symbol-reference-table">
          <table>
            <thead>
              <tr>
                {isCnFutures ? (
                  <>
                    <th>交易所</th>
                    <th>品种</th>
                    <th>前缀</th>
                    <th>输入示例</th>
                  </>
                ) : isGlobalFutures ? (
                  <>
                    <th>输入代码</th>
                    <th>Yahoo</th>
                    <th>品种</th>
                    <th>交易所</th>
                    <th>国内对照</th>
                  </>
                ) : (
                  <>
                    <th>Ticker</th>
                    <th>名称</th>
                    <th>交易所</th>
                    <th>输入示例</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {isCnFutures
                ? CN_FUTURES_REFERENCE.map((item) => (
                  <tr key={`${item.exchange}:${item.prefix}`}>
                    <td>{item.exchange}</td>
                    <td>{item.name}</td>
                    <td>{item.prefix}</td>
                    <td>{item.example}</td>
                  </tr>
                ))
                : isGlobalFutures
                  ? GLOBAL_FUTURES_REFERENCE.map((item) => (
                    <tr key={item.symbol}>
                      <td>{item.symbol}</td>
                      <td>{item.yahoo}</td>
                      <td>{item.name}</td>
                      <td>{item.exchange}</td>
                      <td>{item.cnPeer}</td>
                    </tr>
                  ))
                : US_STOCKS_REFERENCE.map((item) => (
                  <tr key={item.symbol}>
                    <td>{item.symbol}</td>
                    <td>{item.name}</td>
                    <td>{item.exchange}</td>
                    <td>{item.example}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NewsSourceField({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <textarea placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function parseSymbolList(value: string): string[] {
  return value.split(/[\s,，]+/).map((item) => item.trim().toUpperCase()).filter(Boolean);
}

function formatNewsSources(sources: NewsSourceSettings[]): string {
  return sources.map((source) => `${source.label}|${source.url}|${source.enabled ? "on" : "off"}`).join("\n");
}

function parseNewsSources(value: string): NewsSourceSettings[] {
  return value
    .split(/\r?\n/)
    .map((line, index) => {
      const [label = "", url = "", enabled = "on"] = line.split("|").map((part) => part.trim());
      if (!label || !url) return null;
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `news_${index}`,
        label,
        url,
        enabled: enabled.toLowerCase() !== "off",
      };
    })
    .filter((source): source is NewsSourceSettings => Boolean(source));
}

function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input min={1} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function saveStateLabel(state: SettingsSaveState): string {
  if (state === "saving") return "保存中";
  if (state === "saved") return "已保存";
  if (state === "error") return "保存失败";
  return "未保存的修改需要手动保存";
}

function endpointStateLabel(state: EndpointTestState, results: EndpointTestResult[]): string {
  if (state === "done") return results.every((result) => result.ok) ? "全部可用" : "存在异常";
  if (state === "error") return "测试失败";
  if (state === "testing") return "测试中";
  return "按需测试当前后端可连通性";
}
