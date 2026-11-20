import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ConfigManager } from '../../../1_Core_Engine/ConfigManager/ConfigManager.js';
import type { EventBus } from '../../../1_Core_Engine/EventBus/EventBus.js';
import { SystemEvents } from '../../../4_Shared_Types/standard_models/eventTypes.js';
import type { MarketModule } from '../../../4_Shared_Types/standard_models/moduleTypes.js';
import type { MarketRefreshIntervalSettings, StandardMarketTick } from '../../../4_Shared_Types/standard_models/marketTypes.js';
import type { IBinanceApiClient, BinanceInterval } from '../api_client/IBinanceApiClient.js';

interface Sum59Snapshots {
  sum59_1m?: number;
  sum59_15m?: number;
  sum59_1d?: number;
  updated_at_1m?: number;
  updated_at_15m?: number;
  updated_at_1d?: number;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export class BinanceMonitorModule implements MarketModule {
  readonly name = 'Crypto_Binance' as const;

  private readonly snapshotCachePath = path.join(projectRoot, '.runtime/ma60_snapshots_binance.json');
  private readonly snapshots = new Map<string, Sum59Snapshots>();
  private readonly refreshingIntervals = new Set<BinanceInterval>();
  private refreshIntervals: MarketRefreshIntervalSettings = DEFAULT_REFRESH_INTERVALS;
  private calibrateTimers: NodeJS.Timeout[] = [];
  private unsubscribePrices: (() => void) | null = null;
  private activeSymbols: string[] = [];
  private lastPublishedAt = new Map<string, number>();
  private running = false;
  private runId = 0;

  constructor(
    private readonly eventBus: EventBus,
    private readonly configManager: ConfigManager,
    private readonly apiClient: IBinanceApiClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const runId = this.runId + 1;
    this.runId = runId;
    this.running = true;

    const settings = await this.configManager.load();
    const limit = Math.min(Math.max(settings.BinanceSettings.monitor_top_volume, 1), 200);
    this.refreshIntervals = {
      ...DEFAULT_REFRESH_INTERVALS,
      ...(settings.RefreshIntervalSettings?.Crypto_Binance ?? {}),
    };
    if (!this.isCurrentRun(runId)) return;

    try {
      this.activeSymbols = await this.apiClient.getTopSymbolsByVolume(limit);
    } catch (err) {
      if (this.runId === runId) this.running = false;
      console.error('[BinanceMonitorModule] Failed to fetch top symbols:', err);
      throw err;
    }
    if (!this.isCurrentRun(runId)) return;

    await this.loadSnapshotCache();

    this.unsubscribePrices = this.apiClient.subscribePrices(this.activeSymbols, update => {
      if (!this.isCurrentRun(runId)) return;
      if (!this.shouldPublish(update.symbol)) return;

      const snap = this.snapshots.get(update.symbol);
      const ma60_dev_1m = calculateDeviation(snap?.sum59_1m, update.price);
      const ma60_dev_15m = calculateDeviation(snap?.sum59_15m, update.price);
      const ma60_dev_1d = calculateDeviation(snap?.sum59_1d, update.price);

      const payload: StandardMarketTick = {
        market: this.name,
        symbol: update.symbol,
        price: update.price,
        change_24h: update.change_24h,
        ma60_dev_1m,
        ma60_dev_15m,
        ma60_dev_1d,
        updated_at: new Date().toISOString(),
      };

      this.eventBus.publish(SystemEvents.MarketDataUpdated, payload);
      this.eventBus.publish(SystemEvents.BinanceDataUpdated, payload);
    });

    if (!this.isCurrentRun(runId)) {
      this.clearRuntimeResources();
      return;
    }
    this.startSnapshotTimers();
    void this.refreshSnapshots(runId).catch(err => {
      if (this.isCurrentRun(runId)) {
        console.warn('[BinanceMonitorModule] Background MA60 snapshot refresh failed:', err);
      }
    });
  }

  async stop(): Promise<void> {
    this.runId += 1;
    this.clearRuntimeResources();
    this.running = false;
  }

  async destroy(): Promise<void> {
    this.runId += 1;
    this.clearRuntimeResources();
    this.snapshots.clear();
    this.activeSymbols = [];
    this.running = false;
  }

  private async refreshSnapshots(runId: number): Promise<void> {
    await Promise.all([
      this.refreshSnapshotInterval('1m', false, runId),
      this.refreshSnapshotInterval('15m', false, runId),
      this.refreshSnapshotInterval('1d', false, runId),
    ]);
  }

  private startSnapshotTimers(): void {
    const runId = this.runId;
    this.calibrateTimers.push(
      setInterval(() => void this.refreshSnapshotInterval('1m', true, runId), secondsToMs(this.refreshIntervals.ma60_1m_seconds)),
      setInterval(() => void this.refreshSnapshotInterval('15m', true, runId), secondsToMs(this.refreshIntervals.ma60_15m_seconds)),
      setInterval(() => void this.refreshSnapshotInterval('1d', true, runId), secondsToMs(this.refreshIntervals.ma60_1d_seconds)),
    );
  }

  private async refreshSnapshotInterval(interval: BinanceInterval, force: boolean, runId: number): Promise<void> {
    if (!this.isCurrentRun(runId)) return;
    if (this.refreshingIntervals.has(interval)) {
      console.warn(`[BinanceMonitorModule] Skipping ${interval} MA60 refresh; previous refresh is still running`);
      return;
    }

    this.refreshingIntervals.add(interval);
    const batchSize = 5;
    let refreshedCount = 0;

    try {
      const symbolsToRefresh = this.activeSymbols.filter(symbol => (
        force || this.isSnapshotStale(symbol, interval)
      ));

      if (symbolsToRefresh.length === 0) {
        console.log(`[BinanceMonitorModule] MA60 ${interval} snapshots reused from local cache for ${this.activeSymbols.length}/${this.activeSymbols.length} symbols`);
        return;
      }

      for (let i = 0; i < symbolsToRefresh.length; i += batchSize) {
        if (!this.isCurrentRun(runId)) return;
        const batch = symbolsToRefresh.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async symbol => ({ symbol, sum59: await this.getSum59(symbol, interval) })),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            if (!this.isCurrentRun(runId)) return;
            const { symbol, sum59 } = result.value;
            const snapshot = this.snapshots.get(symbol) ?? {};
            if (sum59 === undefined) {
              delete snapshot[sumKeyForInterval(interval)];
              delete snapshot[updatedKeyForInterval(interval)];
              this.snapshots.set(symbol, snapshot);
              console.warn(`[BinanceMonitorModule] ${symbol} ${interval} MA60 snapshot skipped: insufficient completed candles`);
            } else {
              snapshot[sumKeyForInterval(interval)] = sum59;
              snapshot[updatedKeyForInterval(interval)] = Date.now();
              this.snapshots.set(symbol, snapshot);
              refreshedCount += 1;
            }
          } else {
            console.warn(`[BinanceMonitorModule] Failed to refresh ${interval} MA60 snapshot:`, result.reason);
          }
        }

        if (i + batchSize < symbolsToRefresh.length) {
          await sleep(500);
        }
      }

      await this.saveSnapshotCache();
      console.log(`[BinanceMonitorModule] MA60 ${interval} snapshots refreshed for ${refreshedCount}/${symbolsToRefresh.length} stale symbols`);
    } finally {
      this.refreshingIntervals.delete(interval);
    }
  }

  private async getSum59(symbol: string, interval: BinanceInterval): Promise<number | undefined> {
    const closes = await this.apiClient.getRecentCloses(symbol, interval, 61);
    const completed = closes.slice(0, -1);
    const last59 = completed.slice(-59);
    if (last59.length < 59) {
      closes.length = 0;
      completed.length = 0;
      last59.length = 0;
      return undefined;
    }
    const sum = last59.reduce((total, close) => total + close, 0);
    closes.length = 0;
    completed.length = 0;
    last59.length = 0;
    return sum;
  }

  private shouldPublish(symbol: string): boolean {
    const now = Date.now();
    const minIntervalMs = secondsToMs(this.refreshIntervals.price_seconds);
    const last = this.lastPublishedAt.get(symbol) ?? 0;
    if (now - last < minIntervalMs) return false;
    this.lastPublishedAt.set(symbol, now);
    return true;
  }

  private isSnapshotStale(symbol: string, interval: BinanceInterval): boolean {
    const snapshot = this.snapshots.get(symbol);
    const sum = snapshot?.[sumKeyForInterval(interval)];
    const updatedAt = snapshot?.[updatedKeyForInterval(interval)];
    if (sum === undefined || updatedAt === undefined) return true;
    return Date.now() - updatedAt >= secondsToMs(this.snapshotMaxAgeSeconds(interval));
  }

  private snapshotMaxAgeSeconds(interval: BinanceInterval): number {
    if (interval === '1m') return this.refreshIntervals.ma60_1m_seconds;
    if (interval === '15m') return this.refreshIntervals.ma60_15m_seconds;
    return this.refreshIntervals.ma60_1d_seconds;
  }

  private async loadSnapshotCache(): Promise<void> {
    try {
      const raw = await readFile(this.snapshotCachePath, 'utf8');
      const rows = JSON.parse(raw) as Record<string, Sum59Snapshots>;
      for (const symbol of this.activeSymbols) {
        const row = rows[symbol];
        if (row) this.snapshots.set(symbol, row);
      }
    } catch {
      // Cache is optional. A cold start simply fetches fresh MA snapshots.
    }
  }

  private async saveSnapshotCache(): Promise<void> {
    await mkdir(path.dirname(this.snapshotCachePath), { recursive: true });
    const rows = Object.fromEntries(
      this.activeSymbols.map(symbol => [symbol, this.snapshots.get(symbol) ?? {}]),
    );
    await writeFile(this.snapshotCachePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  }

  private clearRuntimeResources(): void {
    if (this.unsubscribePrices) {
      this.unsubscribePrices();
      this.unsubscribePrices = null;
    }

    for (const timer of this.calibrateTimers) {
      clearInterval(timer);
    }
    this.calibrateTimers = [];
    this.lastPublishedAt.clear();
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }
}

const DEFAULT_REFRESH_INTERVALS: MarketRefreshIntervalSettings = {
  price_seconds: 1,
  ma60_1m_seconds: 60,
  ma60_15m_seconds: 300,
  ma60_1d_seconds: 3600,
};

function calculateDeviation(sum59: number | undefined, livePrice: number): number | undefined {
  if (sum59 === undefined || livePrice <= 0) return undefined;
  const ma60 = (sum59 + livePrice) / 60;
  return ma60 > 0 ? roundPercent(((livePrice - ma60) / ma60) * 100) : undefined;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(3));
}

function sumKeyForInterval(interval: BinanceInterval): keyof Sum59Snapshots {
  if (interval === '1m') return 'sum59_1m';
  if (interval === '15m') return 'sum59_15m';
  return 'sum59_1d';
}

function updatedKeyForInterval(interval: BinanceInterval): keyof Sum59Snapshots {
  if (interval === '1m') return 'updated_at_1m';
  if (interval === '15m') return 'updated_at_15m';
  return 'updated_at_1d';
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
