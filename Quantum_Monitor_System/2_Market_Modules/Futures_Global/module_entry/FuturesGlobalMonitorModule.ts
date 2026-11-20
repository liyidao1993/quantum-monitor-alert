import type { ConfigManager } from '../../../1_Core_Engine/ConfigManager/ConfigManager.js';
import type { EventBus } from '../../../1_Core_Engine/EventBus/EventBus.js';
import { SystemEvents } from '../../../4_Shared_Types/standard_models/eventTypes.js';
import type { MarketRefreshIntervalSettings, StandardMarketTick } from '../../../4_Shared_Types/standard_models/marketTypes.js';
import type { MarketModule } from '../../../4_Shared_Types/standard_models/moduleTypes.js';
import { resolveDisplayName } from '../../../4_Shared_Types/symbol_mapping/DisplayNameMapper.js';
import { mapMarketSymbol } from '../../../4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.js';
import type { GlobalFuturesCandle, GlobalFuturesInterval, IFuturesGlobalApiClient } from '../api_client/IFuturesGlobalApiClient.js';

interface FuturesGlobalRuntimeRow {
  symbol: string;
  price: number;
  previousPrice?: number;
  ma60_dev_1m?: number;
  ma60_dev_15m?: number;
  ma60_dev_1d?: number;
  updated_at: string;
}

interface FuturesGlobalMaSnapshot {
  candles: GlobalFuturesCandle[];
  updatedAt: number;
}

const DEFAULT_SYMBOLS = ['GC1!', 'NQ1!', 'ES1!', 'CL1!', 'SI1!', 'YM1!'];

export class FuturesGlobalMonitorModule implements MarketModule {
  readonly name = 'Futures_Global' as const;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private refreshingMa = false;
  private activeSymbols: string[] = [];
  private refreshIntervals: MarketRefreshIntervalSettings = DEFAULT_REFRESH_INTERVALS;
  private maTimers: NodeJS.Timeout[] = [];
  private readonly lastRows = new Map<string, FuturesGlobalRuntimeRow>();
  private readonly maSnapshots = new Map<string, Partial<Record<GlobalFuturesInterval, FuturesGlobalMaSnapshot>>>();
  private runId = 0;

  constructor(
    private readonly eventBus: EventBus,
    private readonly configManager: ConfigManager,
    private readonly apiClient: IFuturesGlobalApiClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const runId = this.runId + 1;
    this.runId = runId;

    const settings = await this.configManager.load();
    if (this.runId !== runId) return;
    this.refreshIntervals = {
      ...DEFAULT_REFRESH_INTERVALS,
      ...(settings.RefreshIntervalSettings?.Futures_Global ?? {}),
    };
    this.activeSymbols = normalizeSymbols(settings.CustomMarketSettings.futures_global_list ?? DEFAULT_SYMBOLS);
    this.running = true;
    void this.runCycle(runId);
    this.startMaTimers(runId);
    void this.refreshAllMaSnapshots(runId);
  }

  async stop(): Promise<void> {
    this.runId += 1;
    this.running = false;
    this.processing = false;
    this.refreshingMa = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const timer of this.maTimers) {
      clearInterval(timer);
    }
    this.maTimers = [];
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
      await this.refreshSymbolPrice(symbol, runId);
      } catch (err) {
        console.warn(`[FuturesGlobalMonitorModule] Failed to refresh ${symbol}:`, err);
      }

      await sleep(250);
    }
  }

  private async refreshSymbolPrice(symbol: string, runId: number): Promise<void> {
    const mapping = mapMarketSymbol(symbol, 'Futures_Global');
    const priceCandles = await this.apiClient.getKlines(mapping.dataSymbol, '1m', 5);

    if (!this.isCurrentRun(runId)) return;

    const m1Candles = this.getCachedMaCandles(mapping.displaySymbol, '1m');
    const m15Candles = this.getCachedMaCandles(mapping.displaySymbol, '15m');
    const d1Candles = this.getCachedMaCandles(mapping.displaySymbol, '1d');
    const lastPriceCandle = priceCandles.at(-1) ?? m1Candles.at(-1);
    const price = lastPriceCandle?.close;
    if (!price || price <= 0) return;

    const previousRow = this.lastRows.get(mapping.displaySymbol);
    const previousPrice = previousRow?.price;
    const previousDayClose = d1Candles.at(-2)?.close;
    const change_24h = previousDayClose && previousDayClose > 0
      ? roundPercent(((price - previousDayClose) / previousDayClose) * 100)
      : previousPrice && previousPrice > 0
        ? roundPercent(((price - previousPrice) / previousPrice) * 100)
        : 0;

    const row: FuturesGlobalRuntimeRow = {
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
      display_name: resolveDisplayName(mapping.displaySymbol, this.name, mapping.name).displayName,
      price: roundPrice(price),
      change_24h,
      ma60_dev_1m: row.ma60_dev_1m,
      ma60_dev_15m: row.ma60_dev_15m,
      ma60_dev_1d: row.ma60_dev_1d,
      updated_at: row.updated_at,
    };

    this.eventBus.publish(SystemEvents.MarketDataUpdated, payload);
  }

  private async refreshAllMaSnapshots(runId: number): Promise<void> {
    if (this.refreshingMa) return;
    this.refreshingMa = true;
    try {
    for (const interval of ['1m', '15m', '1d'] as const) {
      for (const symbol of this.activeSymbols) {
        if (!this.isCurrentRun(runId)) return;
        const mapping = mapMarketSymbol(symbol, 'Futures_Global');
        await this.getMaCandles(mapping.displaySymbol, mapping.dataSymbol, interval, runId);
        await sleep(150);
      }
    }
    } finally {
      this.refreshingMa = false;
    }
  }

  private startMaTimers(runId: number): void {
    this.maTimers.push(
      setInterval(() => void this.refreshMaInterval('1m', runId), secondsToMs(this.refreshIntervals.ma60_1m_seconds)),
      setInterval(() => void this.refreshMaInterval('15m', runId), secondsToMs(this.refreshIntervals.ma60_15m_seconds)),
      setInterval(() => void this.refreshMaInterval('1d', runId), secondsToMs(this.refreshIntervals.ma60_1d_seconds)),
    );
  }

  private async refreshMaInterval(interval: GlobalFuturesInterval, runId: number): Promise<void> {
    if (this.refreshingMa) return;
    this.refreshingMa = true;
    try {
      for (const symbol of this.activeSymbols) {
        if (!this.isCurrentRun(runId)) return;
        const mapping = mapMarketSymbol(symbol, 'Futures_Global');
        await this.getMaCandles(mapping.displaySymbol, mapping.dataSymbol, interval, runId);
        await sleep(150);
      }
    } finally {
      this.refreshingMa = false;
    }
  }

  private getCachedMaCandles(displaySymbol: string, interval: GlobalFuturesInterval): GlobalFuturesCandle[] {
    return this.maSnapshots.get(displaySymbol)?.[interval]?.candles ?? [];
  }

  private async getMaCandles(displaySymbol: string, dataSymbol: string, interval: GlobalFuturesInterval, runId: number): Promise<GlobalFuturesCandle[]> {
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
      console.warn(`[FuturesGlobalMonitorModule] Failed to refresh ${displaySymbol} ${interval} MA60 candles:`, err);
      return cached?.candles ?? [];
    }
  }

  private maRefreshSeconds(interval: GlobalFuturesInterval): number {
    if (interval === '1m') return this.refreshIntervals.ma60_1m_seconds;
    if (interval === '15m') return this.refreshIntervals.ma60_15m_seconds;
    return this.refreshIntervals.ma60_1d_seconds;
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }
}

const DEFAULT_REFRESH_INTERVALS: MarketRefreshIntervalSettings = {
  price_seconds: 30,
  ma60_1m_seconds: 60,
  ma60_15m_seconds: 300,
  ma60_1d_seconds: 3600,
};

function calculateMaDeviation(candles: GlobalFuturesCandle[], price: number): number | undefined {
  const closes = candles
    .map(candle => candle.close)
    .filter(close => Number.isFinite(close) && close > 0)
    .slice(-60);
  if (closes.length < 60) return undefined;

  const ma60 = closes.reduce((sum, close) => sum + close, 0) / closes.length;
  return ma60 > 0 ? roundPercent(((price - ma60) / ma60) * 100) : undefined;
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

function normalizeSymbols(symbols: string[]): string[] {
  const normalized = symbols
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : DEFAULT_SYMBOLS;
}
