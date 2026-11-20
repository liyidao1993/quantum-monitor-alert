export type MarketModuleName =
  | 'Crypto_Binance'
  | 'Stocks_CN'
  | 'Stocks_US'
  | 'Futures_CN'
  | 'Futures_Global'
  | 'Macro_Home';

export type ModuleStatus = 'sleeping' | 'starting' | 'running' | 'stopping' | 'destroyed' | 'error';

export type PriceColorStyle = 'RedUpGreenDown' | 'GreenUpRedDown';

export type ThemeMode = 'Dark' | 'Light';

export interface StandardMarketTick {
  market: MarketModuleName;
  symbol: string;
  display_name?: string;
  price: number;
  change_24h: number;
  ma60_dev_1m?: number;
  ma60_dev_15m?: number;
  ma60_dev_1d?: number;
  updated_at: string;
}

export type AlertType = 'ma60_deviation' | 'instant_move' | 'module_error' | 'data_quality';

export interface AlertEvent {
  id: string;
  type: AlertType;
  market: MarketModuleName;
  symbol: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  value?: number;
  threshold?: number;
  created_at: string;
}

export interface ModuleStatusPayload {
  market: MarketModuleName;
  status: ModuleStatus;
  reason?: string;
  updated_at: string;
}

export interface TradingViewWindowPayload {
  symbol: string;
  tradingViewSymbol: string;
  interval: '1' | '15' | 'D';
}

export interface GlobalSettings {
  color_theme: ThemeMode;
  price_color_style: PriceColorStyle;
  auto_start_modules: MarketModuleName[];
}

export interface BinanceSettings {
  monitor_top_volume: number;
  visible_columns: {
    show_price: boolean;
    show_24h_change: boolean;
    show_abnormal_change: boolean;
    show_ma60_1m: boolean;
    show_ma60_15m: boolean;
    show_ma60_1d: boolean;
  };
  abnormal_calc_rule: {
    time_window_min: number;
    threshold_percent: number;
  };
}

export interface CustomMarketSettings {
  cn_stocks_list: string[];
  us_stocks_list: string[];
  cn_futures_list: string[];
  futures_global_list: string[];
}

export interface AlertThresholdSettings {
  ma60_dev_1m: number;
  ma60_dev_15m: number;
  ma60_dev_1d: number;
  instant_move_percent: number;
  instant_window_seconds: number;
}

export interface AlertSettings {
  enabled: boolean;
  cooldown_seconds: number;
  history_limit: number;
  desktop_notify: boolean;
  sound_alert: boolean;
  telegram_enabled: boolean;
  telegram_bot_token: string;
  telegram_chat_id: string;
  thresholds: Partial<Record<MarketModuleName, AlertThresholdSettings>>;
}

export interface ApiEndpointSettings {
  binance_fapi_base: string;
  binance_ws_base: string;
  binance_use_all_ticker_stream: boolean;
  socks_proxy: string;
  https_proxy: string;
  sina_min_line_url: string;
  sina_quote_url: string;
  yahoo_chart_base: string;
  tradingview_widget_url: string;
}

export interface MarketRefreshIntervalSettings {
  price_seconds: number;
  ma60_1m_seconds: number;
  ma60_15m_seconds: number;
  ma60_1d_seconds: number;
}

export interface NewsSourceSettings {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
}

export interface NewsSettings {
  enabled: boolean;
  key_refresh_seconds: number;
  breaking_refresh_seconds: number;
  cache_limit: number;
  translate_english: boolean;
  translation_provider: 'none' | 'mymemory';
  translation_api_url: string;
  ai_analysis_enabled: boolean;
  ai_provider: 'none' | 'google' | 'openai_compatible';
  ai_api_base: string;
  ai_api_key: string;
  ai_model: string;
  sources: NewsSourceSettings[];
}

export interface MacroNewsItem {
  id: string;
  title: string;
  original_title?: string;
  original_language?: string;
  source: string;
  url: string;
  summary?: string;
  ai_summary?: string;
  impact_assets?: string[];
  impact_direction?: 'bullish' | 'bearish' | 'mixed' | 'neutral';
  impact_reason?: string;
  importance_score?: number;
  published_at: string;
  fetched_at: string;
  tags: string[];
  importance: 'key' | 'breaking' | 'normal';
}

export interface MacroNewsSummary {
  key: MacroNewsItem[];
  breaking: MacroNewsItem[];
  ai_highlights?: MacroNewsItem[];
  analyzer: {
    enabled: boolean;
    provider: 'none' | 'google' | 'openai_compatible' | 'rules';
    status: 'ready' | 'fallback' | 'disabled' | 'error';
    message?: string;
  };
  updated_at: string;
  source_count: number;
  errors: Array<{ source: string; message: string }>;
}

export interface StocksCnSectorHeatItem {
  code: string;
  name: string;
  kind: 'industry' | 'concept';
  change_percent: number;
  main_net_inflow?: number;
  rising_count?: number;
  falling_count?: number;
  leading_stock?: string;
  leading_stock_code?: string;
  leading_change_percent?: number;
}

export interface StocksCnHotStockItem {
  code: string;
  name: string;
  price: number;
  change_percent: number;
  amount?: number;
  turnover_rate?: number;
  volume_ratio?: number;
  list: 'gainers' | 'amount' | 'turnover' | 'volume_ratio';
}

export interface StocksCnHotRankItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  change_percent: number;
  rank_change?: number;
  previous_rank?: number;
  source: 'eastmoney';
}

export interface StocksCnHeatSnapshot {
  market: 'Stocks_CN';
  status: 'active' | 'paused' | 'error';
  reason?: string;
  updated_at: string;
  next_refresh_at?: string;
  sectors: {
    industries: StocksCnSectorHeatItem[];
    concepts: StocksCnSectorHeatItem[];
  };
  hot_stocks: StocksCnHotStockItem[];
  hot_rank: StocksCnHotRankItem[];
}

export interface AppSettings {
  GlobalSettings: GlobalSettings;
  BinanceSettings: BinanceSettings;
  CustomMarketSettings: CustomMarketSettings;
  AlertSettings: AlertSettings;
  ApiEndpointSettings: ApiEndpointSettings;
  RefreshIntervalSettings: Partial<Record<MarketModuleName, MarketRefreshIntervalSettings>>;
  NewsSettings: NewsSettings;
}
