export type BinanceInterval = '1m' | '15m' | '1d';

export interface PriceUpdate {
  symbol: string;
  price: number;
  change_24h: number;
}

export interface BinanceKlineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IBinanceApiClient {
  /** Get top symbols by 24h quote volume, returns symbols in "BTC/USDT" format */
  getTopSymbolsByVolume(limit: number): Promise<string[]>;

  /** Get recent close prices for a symbol and interval */
  getRecentCloses(symbol: string, interval: BinanceInterval, limit: number): Promise<number[]>;

  /** Get recent OHLCV candles for charting and diagnostics */
  getKlines(symbol: string, interval: BinanceInterval, limit: number): Promise<BinanceKlineCandle[]>;

  /** Subscribe to real-time price updates. Returns an unsubscribe function. */
  subscribePrices(symbols: string[], onUpdate: (update: PriceUpdate) => void): () => void;
}
