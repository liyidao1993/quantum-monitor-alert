export type GlobalFuturesInterval = '1m' | '15m' | '1d';

export interface GlobalFuturesCandle {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface IFuturesGlobalApiClient {
  getKlines(symbol: string, interval: GlobalFuturesInterval, limit: number): Promise<GlobalFuturesCandle[]>;
}
