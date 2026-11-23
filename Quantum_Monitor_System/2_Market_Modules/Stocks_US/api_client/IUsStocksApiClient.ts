export type UsStocksInterval = '1m' | '15m' | '1d';

export interface UsStockCandle {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  previousClose?: number;
}

export interface IUsStocksApiClient {
  getKlines(symbol: string, interval: UsStocksInterval, limit: number): Promise<UsStockCandle[]>;
}
