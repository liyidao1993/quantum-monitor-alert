import type { ConfigManager } from '../../../1_Core_Engine/ConfigManager/ConfigManager.js';
import type { EventBus } from '../../../1_Core_Engine/EventBus/EventBus.js';
import { SystemEvents } from '../../../4_Shared_Types/standard_models/eventTypes.js';
import type { MarketRefreshIntervalSettings, StandardMarketTick } from '../../../4_Shared_Types/standard_models/marketTypes.js';
import type { MarketModule } from '../../../4_Shared_Types/standard_models/moduleTypes.js';
import { resolveDisplayName } from '../../../4_Shared_Types/symbol_mapping/DisplayNameMapper.js';
import { mapMarketSymbol } from '../../../4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.js';
import type { CnFuturesCandle, CnFuturesInterval, IFuturesCnApiClient } from '../api_client/IFuturesCnApiClient.js';

interface FuturesCnRuntimeRow {
  symbol: string;
  price: number;
  previousPrice?: number;
  ma60_dev_1m?: number;
  ma60_dev_15m?: number;
  ma60_dev_1d?: number;
  updated_at: string;
}

interface FuturesCnMaSnapshot {
  candles: CnFuturesCandle[];
  updatedAt: number;
}

export class FuturesCnMonitorModule implements MarketModule {
  readonly name = 'Futures_CN' as const;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private activeSymbols: string[] = [];
  private refreshIntervals: MarketRefreshIntervalSettings = DEFAULT_REFRESH_INTERVALS;
  private readonly lastRows = new Map<string, FuturesCnRuntimeRow>();
  private readonly maSnapshots = new Map<string, Partial<Record<CnFuturesInterval, FuturesCnMaSnapshot>>>();
  private runId = 0;

  constructor(
    private readonly eventBus: EventBus,
    private readonly configManager: ConfigManager,
    private readonly apiClient: IFuturesCnApiClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const runId = this.runId + 1;
    this.runId = runId;

    const settings = await this.configManager.load();
    if (this.runId !== runId) return;
    this.activeSymbols = normalizeSymbols(settings.CustomMarketSettings.cn_futures_list);
    this.refreshIntervals = {
      ...DEFAULT_REFRESH_INTERVALS,
      ...(settings.RefreshIntervalSettings?.Futures_CN ?? {}),
    };
    this.running = true;
    void this.runCycle(runId);
  }

  async stop(): Promise<void> {
    this.runId += 1;
    this.running = false;
    this.processing = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async destroy(): Promise<void> {
    this.runId += 1;
    await this.stop();
    this.activeSymbols = [];
    this.lastRows.clear();
    this.maSnapshots.clear();
  }

  private async runCycle(runId: number): Promise<void> {
    if (!this.isCurrentRun(runId) || this.processing) return;
    this.processing = true;
    const startedAt = Date.now();

    try {
      await this.refreshSymbols(runId);
    } finally {
      this.processing = false;
      if (this.isCurrentRun(runId)) {
        const elapsed = Date.now() - startedAt;
        this.timer = setTimeout(
          () => void this.runCycle(runId),
          Math.max(1000, secondsToMs(this.refreshIntervals.price_seconds) - elapsed),
        );
      }
    }
  }

  private async refreshSymbols(runId: number): Promise<void> {
    for (const symbol of this.activeSymbols) {
      if (!this.isCurrentRun(runId)) return;
      try {
        await this.refreshSymbol(symbol, runId);
      } catch (err) {
        console.warn(`[FuturesCnMonitorModule] Failed to refresh ${symbol}:`, err);
      }

      await sleep(300);
    }
  }

  private async refreshSymbol(symbol: string, runId: number): Promise<void> {
    const mapping = mapMarketSymbol(symbol, 'Futures_CN');
    const [quote, m1Candles, m15Candles, d1Candles] = await Promise.all([
      this.apiClient.getQuote(mapping.dataSymbol),
      this.getMaCandles(mapping.displaySymbol, mapping.dataSymbol, '1m', runId),
      this.getMaCandles(mapping.displaySymbol, mapping.dataSymbol, '15m', runId),
      this.getMaCandles(mapping.displaySymbol, mapping.dataSymbol, '1d', runId),
    ]);

    if (!this.isCurrentRun(runId)) return;

    const previousRow = this.lastRows.get(mapping.displaySymbol);
    const candlePrice = m1Candles.at(-1)?.close;
    const price = quote?.price && quote.price > 0 ? quote.price : candlePrice;
    if (!price || price <= 0) return;

    const previousPrice = previousRow?.price;
    const change_24h = quote?.previousClose && quote.previousClose > 0
      ? roundPercent(((price - quote.previousClose) / quote.previousClose) * 100)
      : previousPrice && previousPrice > 0
        ? roundPercent(((price - previousPrice) / previousPrice) * 100)
        : 0;

    const row: FuturesCnRuntimeRow = {
      symbol: mapping.displaySymbol,
      price,
      previousPrice,
      ma60_dev_1m: calculateMaDeviation(m1Candles, price),
      ma60_dev_15m: calculateMaDeviation(m15Candles, price),
      ma60_dev_1d: calculateMaDeviation(d1Candles, price),
      updated_at: new Date().toISOString(),
    };
    this.lastRows.set(mapping.displaySymbol, row);

    const payload: StandardMarketTick = {
      market: this.name,
      symbol: mapping.displaySymbol,
      display_name: resolveDisplayName(mapping.displaySymbol, this.name, quote?.name).displayName,
      price: roundPrice(price),
      change_24h,
      ma60_dev_1m: row.ma60_dev_1m,
      ma60_dev_15m: row.ma60_dev_15m,
      ma60_dev_1d: row.ma60_dev_1d,
      updated_at: row.updated_at,
    };

    this.eventBus.publish(SystemEvents.MarketDataUpdated, payload);
  }

  private async getMaCandles(displaySymbol: string, dataSymbol: string, interval: CnFuturesInterval, runId: number): Promise<CnFuturesCandle[]> {
    const snapshots = this.maSnapshots.get(displaySymbol) ?? {};
    const cached = snapshots[interval];
    if (cached && Date.now() - cached.updatedAt < secondsToMs(this.maRefreshSeconds(interval))) {
      return cached.candles;
    }

    try {
      const candles = await this.apiClient.getKlines(dataSymbol, interval, 60);
      if (!this.isCurrentRun(runId)) return cached?.candles ?? [];
      snapshots[interval] = { candles, updatedAt: Date.now() };
      this.maSnapshots.set(displaySymbol, snapshots);
      return candles;
    } catch (err) {
      console.warn(`[FuturesCnMonitorModule] Failed to refresh ${displaySymbol} ${interval} MA60 candles:`, err);
      return cached?.candles ?? [];
    }
  }

  private maRefreshSeconds(interval: CnFuturesInterval): number {
    if (interval === '1m') return this.refreshIntervals.ma60_1m_seconds;
    if (interval === '15m') return this.refreshIntervals.ma60_15m_seconds;
    return this.refreshIntervals.ma60_1d_seconds;
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }
}

const DEFAULT_REFRESH_INTERVALS: MarketRefreshIntervalSettings = {
  price_seconds: 15,
  ma60_1m_seconds: 60,
  ma60_15m_seconds: 300,
  ma60_1d_seconds: 3600,
};

function calculateMaDeviation(candles: CnFuturesCandle[], price: number): number | undefined {
  const closes = candles
    .map(candle => candle.close)
    .filter(close => Number.isFinite(close) && close > 0)
    .slice(-60);
  if (closes.length < 60) return undefined;

  const ma60 = closes.reduce((sum, close) => sum + close, 0) / closes.length;
  return ma60 > 0 ? roundPercent(((price - ma60) / ma60) * 100) : undefined;
}

function normalizeSymbols(symbols: string[]): string[] {
  const normalized = symbols
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : ['C0', 'RB0', 'AU0', 'SC0', 'IF0'];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(3));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value >= 10 ? 2 : 5));
}
