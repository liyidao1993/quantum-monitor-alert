import type { ConfigManager } from '../../../1_Core_Engine/ConfigManager/ConfigManager.js';
import type { EventBus } from '../../../1_Core_Engine/EventBus/EventBus.js';
import { SystemEvents } from '../../../4_Shared_Types/standard_models/eventTypes.js';
import type {
  AlertEvent,
  MarketRefreshIntervalSettings,
  StandardMarketTick,
  StocksCnHotRankItem,
  StocksCnHeatSnapshot,
  StocksCnHotStockItem,
  StocksCnSectorHeatItem,
} from '../../../4_Shared_Types/standard_models/marketTypes.js';
import type { MarketModule } from '../../../4_Shared_Types/standard_models/moduleTypes.js';
import type { IStocksCnHeatApiClient } from '../api_client/IStocksCnHeatApiClient.js';

export class StocksCnHeatMonitorModule implements MarketModule {
  readonly name = 'Stocks_CN' as const;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private runId = 0;
  private refreshIntervals: MarketRefreshIntervalSettings = DEFAULT_REFRESH_INTERVALS;
  private snapshot: StocksCnHeatSnapshot = createEmptySnapshot('paused', '模块尚未启动');
  private previousStocks = new Map<string, StocksCnHotStockItem>();
  private previousSectors = new Map<string, StocksCnSectorHeatItem>();
  private alertCooldown = new Map<string, number>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly configManager: ConfigManager,
    private readonly apiClient: IStocksCnHeatApiClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const runId = this.runId + 1;
    this.runId = runId;
    const settings = await this.configManager.load();
    if (this.runId !== runId) return;
    this.refreshIntervals = {
      ...DEFAULT_REFRESH_INTERVALS,
      ...(settings.RefreshIntervalSettings?.Stocks_CN ?? {}),
      price_seconds: 60,
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
    this.snapshot = createEmptySnapshot('paused', '模块已暂停');
    this.publishSnapshot();
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.previousStocks.clear();
    this.previousSectors.clear();
    this.alertCooldown.clear();
  }

  getSnapshot(): StocksCnHeatSnapshot {
    return {
      ...this.snapshot,
      sectors: {
        industries: [...this.snapshot.sectors.industries],
        concepts: [...this.snapshot.sectors.concepts],
      },
      hot_stocks: [...this.snapshot.hot_stocks],
      hot_rank: [...this.snapshot.hot_rank],
    };
  }

  private async runCycle(runId: number): Promise<void> {
    if (!this.isCurrentRun(runId) || this.processing) return;
    this.processing = true;
    const startedAt = Date.now();

    try {
      await this.refreshHeat(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.snapshot = {
        ...createEmptySnapshot('error', message.slice(0, 160)),
        next_refresh_at: new Date(Date.now() + secondsToMs(60)).toISOString(),
      };
      this.publishSnapshot();
    } finally {
      this.processing = false;
      if (this.isCurrentRun(runId)) {
        const elapsed = Date.now() - startedAt;
        this.timer = setTimeout(
          () => void this.runCycle(runId),
          Math.max(1000, secondsToMs(60) - elapsed),
        );
      }
    }
  }

  private async refreshHeat(runId: number): Promise<void> {
    const [industries, concepts, hotStocks, hotRank] = await Promise.all([
      this.apiClient.getSectorHeat('industry', 12),
      this.apiClient.getSectorHeat('concept', 12),
      this.apiClient.getHotStocks(12),
      this.getHotRankSafe(30),
    ]);
    if (!this.isCurrentRun(runId)) return;

    this.snapshot = {
      market: this.name,
      status: 'active',
      updated_at: new Date().toISOString(),
      next_refresh_at: new Date(Date.now() + secondsToMs(60)).toISOString(),
      sectors: { industries, concepts },
      hot_stocks: hotStocks,
      hot_rank: hotRank,
    };
    this.publishSnapshot();
    this.publishHotStockTicks(hotStocks);
    await this.detectMoves(industries, concepts, hotStocks);
    this.previousStocks = new Map(hotStocks.map((item) => [item.code, item]));
    this.previousSectors = new Map([...industries, ...concepts].map((item) => [item.code, item]));
  }

  private async getHotRankSafe(limit: number): Promise<StocksCnHotRankItem[]> {
    try {
      return await this.apiClient.getHotRank(limit);
    } catch (err) {
      console.warn('[StocksCnHeatMonitorModule] Failed to refresh EastMoney hot rank:', err);
      return this.snapshot.hot_rank ?? [];
    }
  }

  private publishSnapshot(): void {
    this.eventBus.publish(SystemEvents.StocksCnHeatUpdated, this.getSnapshot());
  }

  private publishHotStockTicks(hotStocks: StocksCnHotStockItem[]): void {
    const ranked = [...hotStocks]
      .filter((item) => item.list === 'gainers')
      .slice(0, 30);
    for (const item of ranked) {
      const payload: StandardMarketTick = {
        market: this.name,
        symbol: item.code,
        display_name: item.name,
        price: roundPrice(item.price),
        change_24h: roundPercent(item.change_percent),
        updated_at: this.snapshot.updated_at,
      };
      this.eventBus.publish(SystemEvents.MarketDataUpdated, payload);
    }
  }

  private async detectMoves(
    industries: StocksCnSectorHeatItem[],
    concepts: StocksCnSectorHeatItem[],
    hotStocks: StocksCnHotStockItem[],
  ): Promise<void> {
    const settings = await this.configManager.load();
    if (!settings.AlertSettings.enabled) return;
    const cooldownSeconds = Math.max(30, settings.AlertSettings.cooldown_seconds || 300);
    const threshold = settings.AlertSettings.thresholds.Stocks_CN?.instant_move_percent ?? 3;

    for (const stock of dedupeStocks(hotStocks)) {
      const previous = this.previousStocks.get(stock.code);
      if (!previous || previous.price <= 0) continue;
      const move = ((stock.price - previous.price) / previous.price) * 100;
      if (Math.abs(move) >= threshold) {
        this.raiseAlert(
          `stock:${stock.code}`,
          `${stock.name} ${stock.code} 60秒${move >= 0 ? '上涨' : '下跌'} ${formatSigned(move)}%，当前涨跌幅 ${formatSigned(stock.change_percent)}%`,
          stock.code,
          move,
          threshold,
          Math.abs(move) >= threshold * 2 ? 'critical' : 'warning',
          cooldownSeconds,
        );
      }
    }

    for (const sector of [...industries.slice(0, 8), ...concepts.slice(0, 8)]) {
      const previous = this.previousSectors.get(sector.code);
      if (!previous) continue;
      const move = sector.change_percent - previous.change_percent;
      if (Math.abs(move) >= 1.2) {
        this.raiseAlert(
          `sector:${sector.code}`,
          `${sector.kind === 'industry' ? '行业板块' : '概念板块'} ${sector.name} 60秒变化 ${formatSigned(move)} 个百分点，当前 ${formatSigned(sector.change_percent)}%，领涨 ${sector.leading_stock ?? '--'}`,
          sector.code,
          move,
          1.2,
          'warning',
          cooldownSeconds,
        );
      }
    }
  }

  private raiseAlert(
    key: string,
    message: string,
    symbol: string,
    value: number,
    threshold: number,
    severity: AlertEvent['severity'],
    cooldownSeconds: number,
  ): void {
    const now = Date.now();
    const lastAt = this.alertCooldown.get(key) ?? 0;
    if (now - lastAt < secondsToMs(cooldownSeconds)) return;
    this.alertCooldown.set(key, now);
    this.eventBus.publish(SystemEvents.AlertRaised, {
      id: `stocks-cn-${key}-${now}`,
      type: 'instant_move',
      market: this.name,
      symbol,
      message,
      severity,
      value: roundPercent(value),
      threshold,
      created_at: new Date(now).toISOString(),
    });
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }
}

const DEFAULT_REFRESH_INTERVALS: MarketRefreshIntervalSettings = {
  price_seconds: 60,
  ma60_1m_seconds: 60,
  ma60_15m_seconds: 300,
  ma60_1d_seconds: 3600,
};

function createEmptySnapshot(status: StocksCnHeatSnapshot['status'], reason: string): StocksCnHeatSnapshot {
  return {
    market: 'Stocks_CN',
    status,
    reason,
    updated_at: new Date().toISOString(),
    sectors: { industries: [], concepts: [] },
    hot_stocks: [],
    hot_rank: [],
  };
}

function dedupeStocks(items: StocksCnHotStockItem[]): StocksCnHotStockItem[] {
  const result = new Map<string, StocksCnHotStockItem>();
  for (const item of items) {
    const existing = result.get(item.code);
    if (!existing || item.list === 'gainers') {
      result.set(item.code, item);
    }
  }
  return [...result.values()];
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(3));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value >= 10 ? 2 : 4));
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
