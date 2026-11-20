import type {
  AppSettings,
  AlertEvent,
  ModuleStatusPayload,
  StandardMarketTick,
  StocksCnHeatSnapshot,
  TradingViewWindowPayload,
} from './marketTypes.js';

export const SystemEvents = {
  MarketDataUpdated: 'MARKET_DATA_UPDATED',
  BinanceDataUpdated: 'BINANCE_DATA_UPDATED',
  ModuleStatusChanged: 'MODULE_STATUS_CHANGED',
  DestroyCnStocks: 'DESTROY_CN_STOCKS',
  SettingsUpdated: 'SETTINGS_UPDATED',
  AlertRaised: 'ALERT_RAISED',
  StocksCnHeatUpdated: 'STOCKS_CN_HEAT_UPDATED',
  TradingViewWindowClosed: 'TRADING_VIEW_WINDOW_CLOSED',
  TradingViewWindowOpenRequested: 'TRADING_VIEW_WINDOW_OPEN_REQUESTED',
} as const;

export type SystemEventName = (typeof SystemEvents)[keyof typeof SystemEvents];

export interface EventPayloadMap {
  [SystemEvents.MarketDataUpdated]: StandardMarketTick;
  [SystemEvents.BinanceDataUpdated]: StandardMarketTick;
  [SystemEvents.ModuleStatusChanged]: ModuleStatusPayload;
  [SystemEvents.DestroyCnStocks]: { requested_at: string };
  [SystemEvents.SettingsUpdated]: AppSettings;
  [SystemEvents.AlertRaised]: AlertEvent;
  [SystemEvents.StocksCnHeatUpdated]: StocksCnHeatSnapshot;
  [SystemEvents.TradingViewWindowClosed]: TradingViewWindowPayload;
  [SystemEvents.TradingViewWindowOpenRequested]: TradingViewWindowPayload;
}

export type EventHandler<TEvent extends SystemEventName> = (payload: EventPayloadMap[TEvent]) => void;
