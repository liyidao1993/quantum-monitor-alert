export type CnFuturesInterval = '1m' | '15m' | '1d';

export interface CnFuturesCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CnFuturesQuote {
  symbol: string;
  name?: string;
  exchange?: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  openInterest?: number;
  date?: string;
  time?: string;
}

export interface IFuturesCnApiClient {
  getKlines(symbol: string, interval: CnFuturesInterval, limit: number): Promise<CnFuturesCandle[]>;
  getQuote(symbol: string): Promise<CnFuturesQuote | null>;
}
