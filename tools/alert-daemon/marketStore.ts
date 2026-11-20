import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BinanceInterval, IBinanceApiClient, PriceUpdate } from "../../Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/api_client/IBinanceApiClient.js";
import type { MarketRefreshIntervalSettings } from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes.js";
import type { DaemonLogger } from "./logger.js";

interface Sum59Snapshots {
  sum59_1m?: number;
  sum59_15m?: number;
  sum59_1d?: number;
  updated_at_1m?: number;
  updated_at_15m?: number;
  updated_at_1d?: number;
}

export type TickOrigin = "binance" | "watchlist";

export interface DaemonTick {
  origin: TickOrigin;
  symbol: string;
  display_name?: string;
  price: number;
  change_24h: number;
  change_1m?: number;
  change_15m?: number;
  ma60_dev_1m?: number;
  ma60_dev_15m?: number;
  ma60_dev_1d?: number;
  ma60_value_1m?: number;
  ma60_value_15m?: number;
  ma60_value_1d?: number;
  updated_at: string;
}

export type RankingKind = "change_up" | "change_down" | "ma60_1m" | "ma60_15m" | "ma60_1d";

export interface RankingRow {
  rank: number;
  symbol: string;
  price: number;
  value: number;
  updated_at: string;
}

export interface MarketStoreOptions {
  limit: number;
  priceSeconds: number;
  refreshIntervals: MarketRefreshIntervalSettings;
  snapshotCachePath: string;
}

export interface MarketStoreStats {
  symbols: number;
  watchlistSymbols: number;
  ticks: number;
  startedAt: number;
  latestTicks: number;
  trackedSymbols: number;
}

export class BinanceMarketStore {
  private readonly snapshots = new Map<string, Sum59Snapshots>();
  private readonly latestTicks = new Map<string, DaemonTick>();
  private readonly watchlistTicks = new Map<string, DaemonTick>();
  private readonly refreshingIntervals = new Set<BinanceInterval>();
  private snapshotSaveChain: Promise<void> = Promise.resolve();
  private timers: NodeJS.Timeout[] = [];
  private unsubscribePrices: (() => void) | null = null;
  private onTickCallback: ((tick: DaemonTick) => void) | null = null;
  private refreshingSymbols = false;
  private lastPublishedAt = new Map<string, number>();
  private activeSymbols: string[] = [];
  private startedAt = 0;
  private tickCount = 0;
  private running = false;

  constructor(
    private readonly apiClient: IBinanceApiClient,
    private readonly options: MarketStoreOptions,
    private readonly logger: DaemonLogger,
  ) {}

  async start(onTick: (tick: DaemonTick) => void): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.onTickCallback = onTick;
    this.activeSymbols = await this.apiClient.getTopSymbolsByVolume(this.options.limit);
    await this.loadSnapshotCache();
    this.logger.info(`Monitoring ${this.activeSymbols.length} Binance symbols`);

    this.subscribeActiveSymbols();

    await this.refreshSnapshots(false);
    this.startSnapshotTimers();
  }

  private subscribeActiveSymbols(): void {
    if (this.unsubscribePrices) {
      this.unsubscribePrices();
      this.unsubscribePrices = null;
    }
    if (!this.running || !this.onTickCallback) return;
    const onTick = this.onTickCallback;
    this.unsubscribePrices = this.apiClient.subscribePrices(this.activeSymbols, update => {
      if (!this.running || !this.shouldPublish(update.symbol)) return;
      const tick = this.buildTick(update);
      this.latestTicks.set(tick.symbol, tick);
      this.tickCount += 1;
      onTick(tick);
    });
  }

  async refreshActiveSymbols(): Promise<void> {
    if (!this.running || this.refreshingSymbols) return;
    this.refreshingSymbols = true;
    try {
      const nextSymbols = await this.apiClient.getTopSymbolsByVolume(this.options.limit);
      if (!this.running || nextSymbols.length === 0) return;

      const prevSet = new Set(this.activeSymbols);
      const nextSet = new Set(nextSymbols);
      const added = nextSymbols.filter(s => !prevSet.has(s));
      const removed = this.activeSymbols.filter(s => !nextSet.has(s));
      if (added.length === 0 && removed.length === 0) return;

      this.activeSymbols = nextSymbols;
      for (const symbol of removed) {
        const existing = this.latestTicks.get(symbol);
        if (existing?.origin === "binance") {
          this.latestTicks.delete(symbol);
        }
        this.lastPublishedAt.delete(symbol);
        this.snapshots.delete(symbol);
      }
      this.subscribeActiveSymbols();
      this.logger.info("Refreshed active Binance Top symbols", {
        total: nextSymbols.length,
        added: added.slice(0, 10),
        removed: removed.slice(0, 10),
      });
      await this.refreshSnapshots(false);
    } catch (err) {
      this.logger.warn("Failed to refresh active Binance Top symbols; keeping previous list", err);
    } finally {
      this.refreshingSymbols = false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.unsubscribePrices) {
      this.unsubscribePrices();
      this.unsubscribePrices = null;
    }
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.lastPublishedAt.clear();
  }

  getStats(): MarketStoreStats {
    const freshBinance = this.getFreshTicksFrom(this.latestTicks);
    const freshWatchlist = this.getFreshTicksFrom(this.watchlistTicks);
    const total = freshBinance.length + freshWatchlist.length;
    return {
      symbols: this.activeSymbols.length,
      watchlistSymbols: freshWatchlist.length,
      ticks: this.tickCount,
      startedAt: this.startedAt,
      latestTicks: total,
      trackedSymbols: total,
    };
  }

  getAllTicks(): DaemonTick[] {
    return [
      ...this.getFreshTicksFrom(this.latestTicks),
      ...this.getFreshTicksFrom(this.watchlistTicks),
    ];
  }

  getTicksByOrigin(origin: TickOrigin): DaemonTick[] {
    return origin === "binance"
      ? this.getFreshTicksFrom(this.latestTicks)
      : this.getFreshTicksFrom(this.watchlistTicks);
  }

  getWatchlistTick(symbol: string): DaemonTick | undefined {
    const normalized = normalizeSymbol(symbol);
    const upper = symbol.toUpperCase();
    return this.getFreshTicksFrom(this.watchlistTicks).find(tick => tick.symbol === normalized || tick.symbol === upper);
  }

  getTick(symbol: string): DaemonTick | undefined {
    const normalized = normalizeSymbol(symbol);
    const upper = symbol.toUpperCase();
    return this.getFreshTicksFrom(this.latestTicks).find(tick => tick.symbol === normalized || tick.symbol === upper)
      ?? this.getFreshTicksFrom(this.watchlistTicks).find(tick => tick.symbol === normalized || tick.symbol === upper);
  }

  upsertExternalTick(tick: DaemonTick): void {
    const normalized = normalizeSymbol(tick.symbol);
    const targetMap = tick.origin === "watchlist" ? this.watchlistTicks : this.latestTicks;
    targetMap.set(normalized, { ...tick, symbol: normalized });
    this.tickCount += 1;
  }

  getRankings(kind: RankingKind, topN: number): RankingRow[] {
    return rankTicks(this.getFreshTicksFrom(this.latestTicks), kind).slice(0, topN);
  }

  getSymbolRanks(symbol: string): Partial<Record<RankingKind, number>> {
    const ranks: Partial<Record<RankingKind, number>> = {};
    const binanceTicks = this.getFreshTicksFrom(this.latestTicks);
    for (const kind of ["change_up", "change_down", "ma60_1m", "ma60_15m", "ma60_1d"] as const) {
      const row = rankTicks(binanceTicks, kind).find(item => item.symbol === symbol);
      if (row) ranks[kind] = row.rank;
    }
    return ranks;
  }

  private getFreshTicksFrom(map: Map<string, DaemonTick>): DaemonTick[] {
    const cutoff = Date.now() - this.maxTickAgeMs();
    return [...map.values()].filter(tick => {
      const updatedAt = Date.parse(tick.updated_at);
      return Number.isFinite(updatedAt) && updatedAt >= cutoff;
    });
  }

  private buildTick(update: PriceUpdate): DaemonTick {
    const snap = this.snapshots.get(update.symbol);
    const ma1m = calculateDeviation(snap?.sum59_1m, update.price);
    const ma15m = calculateDeviation(snap?.sum59_15m, update.price);
    const ma1d = calculateDeviation(snap?.sum59_1d, update.price);
    return {
      origin: "binance",
      symbol: update.symbol,
      display_name: update.symbol,
      price: update.price,
      change_24h: update.change_24h,
      ma60_dev_1m: ma1m?.dev,
      ma60_dev_15m: ma15m?.dev,
      ma60_dev_1d: ma1d?.dev,
      ma60_value_1m: ma1m?.ma,
      ma60_value_15m: ma15m?.ma,
      ma60_value_1d: ma1d?.ma,
      updated_at: new Date().toISOString(),
    };
  }

  private maxTickAgeMs(): number {
    return Math.max(120_000, Math.max(1, this.options.priceSeconds) * 5_000);
  }

  private shouldPublish(symbol: string): boolean {
    const now = Date.now();
    const minIntervalMs = Math.max(1, this.options.priceSeconds) * 1000;
    const last = this.lastPublishedAt.get(symbol) ?? 0;
    if (now - last < minIntervalMs) return false;
    this.lastPublishedAt.set(symbol, now);
    return true;
  }

  private startSnapshotTimers(): void {
    this.timers.push(
      setInterval(() => void this.refreshSnapshotInterval("1m", true), secondsToMs(this.options.refreshIntervals.ma60_1m_seconds)),
      setInterval(() => void this.refreshSnapshotInterval("15m", true), secondsToMs(this.options.refreshIntervals.ma60_15m_seconds)),
      setInterval(() => void this.refreshSnapshotInterval("1d", true), secondsToMs(this.options.refreshIntervals.ma60_1d_seconds)),
      setInterval(() => void this.refreshActiveSymbols(), 4 * 60 * 60 * 1000),
    );
  }

  private async refreshSnapshots(force: boolean): Promise<void> {
    await Promise.all([
      this.refreshSnapshotInterval("1m", force),
      this.refreshSnapshotInterval("15m", force),
      this.refreshSnapshotInterval("1d", force),
    ]);
  }

  private async refreshSnapshotInterval(interval: BinanceInterval, force: boolean): Promise<void> {
    if (!this.running) return;
    if (this.refreshingIntervals.has(interval)) {
      this.logger.warn(`Skipping ${interval} MA60 refresh; previous refresh is still running`);
      return;
    }

    this.refreshingIntervals.add(interval);
    const batchSize = 5;
    let refreshed = 0;
    try {
      const symbols = this.activeSymbols.filter(symbol => force || this.isSnapshotStale(symbol, interval));
      if (symbols.length === 0) return;

      for (let index = 0; index < symbols.length; index += batchSize) {
        if (!this.running) return;
        const batch = symbols.slice(index, index + batchSize);
        const results = await Promise.allSettled(batch.map(async symbol => ({ symbol, sum59: await this.getSum59(symbol, interval) })));
        for (const result of results) {
          if (result.status === "fulfilled") {
            const { symbol, sum59 } = result.value;
            const row = this.snapshots.get(symbol) ?? {};
            if (sum59 === undefined) {
              delete row[sumKeyForInterval(interval)];
              delete row[updatedKeyForInterval(interval)];
            } else {
              row[sumKeyForInterval(interval)] = sum59;
              row[updatedKeyForInterval(interval)] = Date.now();
              refreshed += 1;
            }
            this.snapshots.set(symbol, row);
          } else {
            this.logger.warn(`Failed to refresh ${interval} MA60 snapshot`, result.reason);
          }
        }
        if (index + batchSize < symbols.length) await sleep(500);
      }
      await this.saveSnapshotCache();
      this.logger.info(`MA60 ${interval} snapshots refreshed for ${refreshed}/${symbols.length} symbols`);
    } finally {
      this.refreshingIntervals.delete(interval);
    }
  }

  private async getSum59(symbol: string, interval: BinanceInterval): Promise<number | undefined> {
    const closes = await this.apiClient.getRecentCloses(symbol, interval, 61);
    const completed = closes.slice(0, -1);
    const last59 = completed.slice(-59);
    if (last59.length < 59) return undefined;
    return last59.reduce((sum, close) => sum + close, 0);
  }

  private isSnapshotStale(symbol: string, interval: BinanceInterval): boolean {
    const snapshot = this.snapshots.get(symbol);
    const sum = snapshot?.[sumKeyForInterval(interval)];
    const updatedAt = snapshot?.[updatedKeyForInterval(interval)];
    if (sum === undefined || updatedAt === undefined) return true;
    return Date.now() - updatedAt >= secondsToMs(snapshotMaxAgeSeconds(interval, this.options.refreshIntervals));
  }

  private async loadSnapshotCache(): Promise<void> {
    try {
      const raw = await readFile(this.options.snapshotCachePath, "utf8");
      const rows = JSON.parse(raw) as Record<string, Sum59Snapshots>;
      for (const symbol of this.activeSymbols) {
        const row = rows[symbol];
        if (row) this.snapshots.set(symbol, row);
      }
    } catch {
      this.logger.debug("No MA60 snapshot cache loaded");
    }
  }

  private async saveSnapshotCache(): Promise<void> {
    const rows = Object.fromEntries(this.activeSymbols.map(symbol => [symbol, this.snapshots.get(symbol) ?? {}]));
    const payload = `${JSON.stringify(rows)}\n`;
    const task = this.snapshotSaveChain.then(async () => {
      await mkdir(path.dirname(this.options.snapshotCachePath), { recursive: true });
      const tmpPath = `${this.options.snapshotCachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await writeFile(tmpPath, payload, "utf8");
      await rename(tmpPath, this.options.snapshotCachePath);
    });
    this.snapshotSaveChain = task.catch(() => undefined);
    await task;
  }
}

export function normalizeSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return upper;
  if (upper.includes("/")) return upper;
  if (upper.endsWith("USDT")) return `${upper.slice(0, -4)}/USDT`;
  return upper;
}

function rankTicks(ticks: DaemonTick[], kind: RankingKind): RankingRow[] {
  const rows = ticks
    .map(tick => {
      const value = valueForRanking(tick, kind);
      return value === undefined ? null : { symbol: tick.symbol, price: tick.price, value, updated_at: tick.updated_at };
    })
    .filter((row): row is Omit<RankingRow, "rank"> => Boolean(row));

  rows.sort((a, b) => kind === "change_down" ? a.value - b.value : Math.abs(b.value) - Math.abs(a.value));
  if (kind === "change_up") rows.sort((a, b) => b.value - a.value);
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function valueForRanking(tick: DaemonTick, kind: RankingKind): number | undefined {
  if (kind === "change_up" || kind === "change_down") return tick.change_24h;
  if (kind === "ma60_1m") return tick.ma60_dev_1m;
  if (kind === "ma60_15m") return tick.ma60_dev_15m;
  return tick.ma60_dev_1d;
}

function calculateDeviation(sum59: number | undefined, livePrice: number): { dev: number; ma: number } | undefined {
  if (sum59 === undefined || livePrice <= 0) return undefined;
  const ma = (sum59 + livePrice) / 60;
  if (ma <= 0) return undefined;
  return {
    ma,
    dev: Number((((livePrice - ma) / ma) * 100).toFixed(3)),
  };
}

function sumKeyForInterval(interval: BinanceInterval): keyof Sum59Snapshots {
  if (interval === "1m") return "sum59_1m";
  if (interval === "15m") return "sum59_15m";
  return "sum59_1d";
}

function updatedKeyForInterval(interval: BinanceInterval): keyof Sum59Snapshots {
  if (interval === "1m") return "updated_at_1m";
  if (interval === "15m") return "updated_at_15m";
  return "updated_at_1d";
}

function snapshotMaxAgeSeconds(interval: BinanceInterval, settings: MarketRefreshIntervalSettings): number {
  if (interval === "1m") return settings.ma60_1m_seconds;
  if (interval === "15m") return settings.ma60_15m_seconds;
  return settings.ma60_1d_seconds;
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
