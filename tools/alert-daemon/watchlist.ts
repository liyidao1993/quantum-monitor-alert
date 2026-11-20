import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { mapMarketSymbol } from "../../Quantum_Monitor_System/4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.js";
import { resolveDisplayName } from "../../Quantum_Monitor_System/4_Shared_Types/symbol_mapping/DisplayNameMapper.js";
import type { IBinanceApiClient } from "../../Quantum_Monitor_System/2_Market_Modules/Crypto_Binance/api_client/IBinanceApiClient.js";
import { SinaFuturesApiClient } from "../../Quantum_Monitor_System/2_Market_Modules/Futures_CN/api_client/SinaFuturesApiClient.js";
import { YahooFuturesApiClient } from "../../Quantum_Monitor_System/2_Market_Modules/Futures_Global/api_client/YahooFuturesApiClient.js";
import { YahooUsStocksApiClient } from "../../Quantum_Monitor_System/2_Market_Modules/Stocks_US/api_client/YahooUsStocksApiClient.js";
import type { BinanceMarketStore, DaemonTick } from "./marketStore.js";
import type { DaemonLogger } from "./logger.js";
import type { WatchlistItemSettings, WatchlistSettings } from "./config.js";

interface PricePoint {
  ts: number;
  price: number;
}

interface WatchlistHistoryRow {
  history: PricePoint[];
  referenceClose?: {
    value: number;
    updatedAt: number;
  };
}

interface WatchlistHistoryFile {
  rows: Record<string, WatchlistHistoryRow>;
}

interface WatchlistClients {
  futuresGlobal: YahooFuturesApiClient;
  stocksUs: YahooUsStocksApiClient;
  futuresCn: SinaFuturesApiClient;
  binance?: IBinanceApiClient;
}

interface PriceSample {
  price: number;
  candleTimeMs?: number;
}

interface FailureBackoff {
  count: number;
  nextRetryAt: number;
}

export class WatchlistMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private readonly history = new Map<string, WatchlistHistoryRow>();
  private readonly lastCandleTimeMs = new Map<string, number>();
  private readonly failureStates = new Map<string, FailureBackoff>();
  private readonly interval15mRefCache = new Map<string, { value: number; updatedAt: number }>();
  private sinaQuoteBlockedUntil = 0;
  private lastSavedAt = 0;
  private historySaveChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: BinanceMarketStore,
    private readonly settings: WatchlistSettings,
    private readonly clients: WatchlistClients,
    private readonly logger: DaemonLogger,
    private readonly historyPath = path.resolve(process.cwd(), ".runtime/alert-daemon/watchlist-history.json"),
  ) {}

  async start(onTick: (tick: DaemonTick) => void): Promise<void> {
    if (this.running || !this.settings.enabled) return;
    this.running = true;
    await this.loadHistory();
    void this.runCycle(onTick);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async destroy(): Promise<void> {
    this.stop();
    try {
      await this.saveHistory();
    } catch (err) {
      this.logger.warn("Failed to save watchlist history on shutdown", err);
    }
    this.history.clear();
  }

  getConfiguredItems(): WatchlistItemSettings[] {
    return this.settings.items.filter(item => item.enabled);
  }

  private async runCycle(onTick: (tick: DaemonTick) => void): Promise<void> {
    if (!this.running || this.processing) return;
    this.processing = true;
    const startedAt = Date.now();

    try {
      await this.refreshAll(onTick);
    } finally {
      this.processing = false;
      if (this.running) {
        const elapsed = Date.now() - startedAt;
        this.timer = setTimeout(() => void this.runCycle(onTick), Math.max(1000, this.settings.price_seconds * 1000 - elapsed));
      }
    }
  }

  private async refreshAll(onTick: (tick: DaemonTick) => void): Promise<void> {
    const items = this.getConfiguredItems().filter(item => {
      const backoff = this.failureStates.get(item.symbol);
      return !backoff || Date.now() >= backoff.nextRetryAt;
    });
    const batchSize = 3;
    for (let i = 0; i < items.length; i += batchSize) {
      if (!this.running) return;
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(async item => {
        try {
          const tick = await this.refreshItem(item);
          this.failureStates.delete(item.symbol);
          if (!tick) return;
          this.store.upsertExternalTick(tick);
          onTick(tick);
        } catch (err) {
          this.recordFailure(item.symbol, err);
        }
      }));
      if (i + batchSize < items.length && this.running) {
        await sleep(150);
      }
    }
    if (Date.now() - this.lastSavedAt >= 2 * 60 * 1000) {
      try {
        await this.saveHistory();
      } catch (err) {
        this.logger.warn("Failed to save watchlist history", err);
      }
    }
  }

  private recordFailure(symbol: string, err: unknown): void {
    const prev = this.failureStates.get(symbol);
    const count = (prev?.count ?? 0) + 1;
    const backoffSeconds = Math.min(1800, 60 * Math.pow(3, Math.min(count - 1, 3)));
    this.failureStates.set(symbol, {
      count,
      nextRetryAt: Date.now() + backoffSeconds * 1000,
    });
    if (count === 1 || count === 3 || count % 5 === 0) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Watchlist refresh failed for ${symbol} (failures=${count}, retry in ${backoffSeconds}s): ${reason}`);
    }
  }

  private async refreshItem(item: WatchlistItemSettings): Promise<DaemonTick | null> {
    const mapping = mapMarketSymbol(item.symbol, item.market);
    const now = Date.now();
    const sample = await this.fetchPrice(item);
    const price = sample.price;
    if (!Number.isFinite(price) || price <= 0) return null;

    if (sample.candleTimeMs !== undefined && Number.isFinite(sample.candleTimeMs)) {
      const lastTs = this.lastCandleTimeMs.get(mapping.displaySymbol);
      if (lastTs !== undefined && sample.candleTimeMs < lastTs) {
        this.logger.debug(`Ignored out-of-order candle for ${mapping.displaySymbol}`, {
          candleTimeMs: sample.candleTimeMs,
          lastTs,
        });
        return null;
      }
      this.lastCandleTimeMs.set(mapping.displaySymbol, sample.candleTimeMs);
    }

    const row = this.history.get(mapping.displaySymbol) ?? { history: [] };
    row.history.push({ ts: now, price });
    this.pruneHistory(row.history, now);

    const referenceClose = await this.getReferenceClose(item, mapping.displaySymbol);
    const referenceCloseValue = referenceClose?.value;
    const change24h = referenceCloseValue && referenceCloseValue > 0
      ? roundPercent(((price - referenceCloseValue) / referenceCloseValue) * 100)
      : 0;
    const change1m = calculateWindowChange(row.history, 1 * 60 * 1000, price, now);
    const localChange15m = calculateWindowChange(row.history, 15 * 60 * 1000, price, now);
    const change15m = localChange15m ?? await this.fetchIntervalChange(item, mapping.displaySymbol, price, now);

    row.referenceClose = referenceClose ?? row.referenceClose;
    this.history.set(mapping.displaySymbol, row);

    return {
      origin: "watchlist",
      symbol: mapping.displaySymbol,
      display_name: item.label ?? resolveWatchlistDisplayName(item, mapping.displaySymbol),
      price,
      change_24h: change24h,
      change_1m: change1m,
      change_15m: change15m,
      updated_at: new Date(now).toISOString(),
    };
  }

  private async fetchPrice(item: WatchlistItemSettings): Promise<PriceSample> {
    if (item.market === "Crypto_Binance") {
      if (!this.clients.binance) throw new Error("Binance client is not configured for watchlist");
      const candles = await this.clients.binance.getKlines(item.symbol, "1m", 2);
      const latest = candles.at(-1);
      return { price: latest?.close ?? NaN, candleTimeMs: latest ? latest.time * 1000 : undefined };
    }
    if (item.market === "Futures_Global") {
      const candles = await this.clients.futuresGlobal.getKlines(item.symbol, "1m", 2);
      const latest = candles.at(-1);
      return { price: latest?.close ?? NaN, candleTimeMs: parseCandleTime(latest?.time) };
    }
    if (item.market === "Stocks_US") {
      const candles = await this.clients.stocksUs.getKlines(item.symbol, "1m", 2);
      const latest = candles.at(-1);
      return { price: latest?.close ?? NaN, candleTimeMs: parseCandleTime(latest?.time) };
    }
    if (Date.now() >= this.sinaQuoteBlockedUntil) {
      try {
        const quote = await this.clients.futuresCn.getQuote(item.symbol);
        if (quote?.price && quote.price > 0) return { price: quote.price };
      } catch {
        // Temporarily bypass hq.sinajs.cn for 1h when blocked (e.g. HTTP 403 from overseas IP)
        this.sinaQuoteBlockedUntil = Date.now() + 60 * 60 * 1000;
      }
    }
    const candles = await this.clients.futuresCn.getKlines(item.symbol, "1m", 2);
    const latest = candles.at(-1);
    return { price: latest?.close ?? NaN, candleTimeMs: parseCandleTime(latest?.time) };
  }

  private async fetchIntervalChange(
    item: WatchlistItemSettings,
    displaySymbol: string,
    currentPrice: number,
    now: number,
  ): Promise<number | undefined> {
    const cached = this.interval15mRefCache.get(displaySymbol);
    const ttlMs = 3 * 60 * 1000;
    if (cached && now - cached.updatedAt < ttlMs && cached.value > 0) {
      return roundPercent(((currentPrice - cached.value) / cached.value) * 100);
    }

    try {
      let closes: number[];
      if (item.market === "Crypto_Binance") {
        if (!this.clients.binance) return undefined;
        closes = (await this.clients.binance.getKlines(item.symbol, "15m", 2)).map(c => c.close);
      } else if (item.market === "Futures_Global") {
        closes = (await this.clients.futuresGlobal.getKlines(item.symbol, "15m", 2)).map(c => c.close);
      } else if (item.market === "Stocks_US") {
        closes = (await this.clients.stocksUs.getKlines(item.symbol, "15m", 2)).map(c => c.close);
      } else {
        closes = (await this.clients.futuresCn.getKlines(item.symbol, "15m", 2)).map(c => c.close);
      }
      const ref = closes.length >= 2 ? closes.at(-2) : undefined;
      if (typeof ref === "number" && Number.isFinite(ref) && ref > 0) {
        this.interval15mRefCache.set(displaySymbol, { value: ref, updatedAt: now });
      }
      return calculateIntervalChange(closes, currentPrice);
    } catch (err) {
      this.logger.warn(`Failed to refresh 15m change for ${item.symbol}`, err);
      return undefined;
    }
  }

  private async getReferenceClose(item: WatchlistItemSettings, symbol: string): Promise<WatchlistHistoryRow["referenceClose"]> {
    const row = this.history.get(symbol);
    const cached = row?.referenceClose;
    const ttlMs = 12 * 60 * 60 * 1000;
    if (cached && Date.now() - cached.updatedAt < ttlMs) {
      return cached;
    }

    try {
      if (item.market === "Crypto_Binance") {
        if (!this.clients.binance) return row?.referenceClose;
        const candles = await this.clients.binance.getKlines(item.symbol, "1d", 2);
        const previous = candles.at(-2)?.close ?? candles.at(-1)?.close;
        if (previous && previous > 0) return { value: previous, updatedAt: Date.now() };
      } else if (item.market === "Futures_CN") {
        if (Date.now() >= this.sinaQuoteBlockedUntil) {
          try {
            const quote = await this.clients.futuresCn.getQuote(item.symbol);
            if (quote?.previousClose && quote.previousClose > 0) return { value: quote.previousClose, updatedAt: Date.now() };
          } catch {
            this.sinaQuoteBlockedUntil = Date.now() + 60 * 60 * 1000;
          }
        }
        const candles = await this.clients.futuresCn.getKlines(item.symbol, "1d", 2);
        const previous = candles.at(-2)?.close ?? candles.at(-1)?.close;
        if (previous && previous > 0) return { value: previous, updatedAt: Date.now() };
      } else if (item.market === "Futures_Global") {
        const candles = await this.clients.futuresGlobal.getKlines(item.symbol, "1d", 2);
        const previous = candles.at(-2)?.close ?? candles.at(-1)?.close;
        if (previous && previous > 0) return { value: previous, updatedAt: Date.now() };
      } else {
        const candles = await this.clients.stocksUs.getKlines(item.symbol, "1d", 2);
        const previous = candles.at(-2)?.close ?? candles.at(-1)?.close;
        if (previous && previous > 0) return { value: previous, updatedAt: Date.now() };
      }
    } catch (err) {
      this.logger.warn(`Failed to refresh reference close for ${item.symbol}`, err);
    }

    return row?.referenceClose;
  }

  private pruneHistory(points: PricePoint[], now: number): void {
    const retentionMinutes = 60;
    const cutoff = now - retentionMinutes * 60 * 1000;
    while (points.length > 0 && points[0].ts < cutoff) {
      points.shift();
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const raw = await readFile(this.historyPath, "utf8");
      const parsed = JSON.parse(raw) as WatchlistHistoryFile;
      for (const [symbol, row] of Object.entries(parsed.rows ?? {})) {
        this.history.set(symbol, {
          history: Array.isArray(row.history) ? row.history.filter(point => Number.isFinite(point.ts) && Number.isFinite(point.price) && point.price > 0) : [],
          referenceClose: row.referenceClose && Number.isFinite(row.referenceClose.value) && Number.isFinite(row.referenceClose.updatedAt)
            ? { value: row.referenceClose.value, updatedAt: row.referenceClose.updatedAt }
            : undefined,
        });
      }
    } catch {
      this.logger.debug("No watchlist history cache loaded");
    }
  }

  private async saveHistory(): Promise<void> {
    const rows: Record<string, WatchlistHistoryRow> = {};
    for (const [symbol, row] of this.history.entries()) {
      rows[symbol] = {
        history: row.history.slice(-2000),
        referenceClose: row.referenceClose,
      };
    }
    const payload = `${JSON.stringify({ rows } as WatchlistHistoryFile)}\n`;
    const task = this.historySaveChain.then(async () => {
      await mkdir(path.dirname(this.historyPath), { recursive: true });
      const tmpPath = `${this.historyPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await writeFile(tmpPath, payload, "utf8");
      await rename(tmpPath, this.historyPath);
      this.lastSavedAt = Date.now();
    });
    this.historySaveChain = task.catch(() => undefined);
    await task;
  }
}

function calculateWindowChange(points: PricePoint[], windowMs: number, currentPrice: number, now: number): number | undefined {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return undefined;
  const cutoff = now - windowMs;
  let reference: PricePoint | undefined;
  for (const point of points) {
    if (point.ts <= cutoff) {
      reference = point;
    } else {
      break;
    }
  }
  if (!reference || !Number.isFinite(reference.price) || reference.price <= 0) return undefined;
  return roundPercent(((currentPrice - reference.price) / reference.price) * 100);
}

function calculateIntervalChange(closes: number[], currentPrice: number): number | undefined {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return undefined;
  if (!Array.isArray(closes) || closes.length < 2) return undefined;
  const reference = closes.at(-2);
  if (!Number.isFinite(reference ?? NaN) || (reference ?? 0) <= 0) return undefined;
  return roundPercent(((currentPrice - (reference as number)) / (reference as number)) * 100);
}

function resolveWatchlistDisplayName(item: WatchlistItemSettings, symbol: string): string {
  if (item.market === "Futures_CN") {
    return resolveDisplayName(symbol, "Futures_CN").displayName ?? symbol;
  }
  if (item.market === "Futures_Global") {
    return resolveDisplayName(symbol, "Futures_Global").displayName ?? symbol;
  }
  return symbol;
}

function parseCandleTime(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const parsed = Date.parse(time);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(3));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
