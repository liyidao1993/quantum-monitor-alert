import type { EventBus } from '../EventBus/EventBus.js';
import type { ConfigManager } from '../ConfigManager/ConfigManager.js';
import { SystemEvents } from '../../4_Shared_Types/standard_models/eventTypes.js';
import type { AlertEvent, AlertSettings, MarketModuleName, StandardMarketTick } from '../../4_Shared_Types/standard_models/marketTypes.js';

interface AlertThresholds {
  ma60_dev_1m: number;
  ma60_dev_15m: number;
  ma60_dev_1d: number;
  instant_move_percent: number;
  instant_window_seconds: number;
}

interface PricePoint {
  ts: number;
  price: number;
}

interface WindowMove {
  reference: PricePoint;
  current: PricePoint;
  movePercent: number;
  direction: 'up' | 'down';
}

const DEFAULT_THRESHOLDS: Record<MarketModuleName, AlertThresholds> = {
  Crypto_Binance: {
    ma60_dev_1m: 5,
    ma60_dev_15m: 10,
    ma60_dev_1d: 20,
    instant_move_percent: 2,
    instant_window_seconds: 30,
  },
  Futures_CN: {
    ma60_dev_1m: 0.5,
    ma60_dev_15m: 1,
    ma60_dev_1d: 3,
    instant_move_percent: 0.5,
    instant_window_seconds: 30,
  },
  Futures_Global: {
    ma60_dev_1m: 0.5,
    ma60_dev_15m: 1,
    ma60_dev_1d: 3,
    instant_move_percent: 0.5,
    instant_window_seconds: 30,
  },
  Stocks_CN: {
    ma60_dev_1m: 1,
    ma60_dev_15m: 2,
    ma60_dev_1d: 5,
    instant_move_percent: 1,
    instant_window_seconds: 30,
  },
  Stocks_US: {
    ma60_dev_1m: 1,
    ma60_dev_15m: 2,
    ma60_dev_1d: 5,
    instant_move_percent: 1,
    instant_window_seconds: 30,
  },
  Macro_Home: {
    ma60_dev_1m: 1,
    ma60_dev_15m: 2,
    ma60_dev_1d: 5,
    instant_move_percent: 1,
    instant_window_seconds: 30,
  },
};

export class AlertEngine {
  private alertSettings: AlertSettings | null = null;
  private readonly lastAlertAt = new Map<string, number>();
  private readonly priceWindows = new Map<string, PricePoint[]>();
  private readonly telegramSentAlertIds = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private unsubscribeAlerts: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly configManager: ConfigManager,
  ) {}

  async start(): Promise<void> {
    if (this.unsubscribe) return;
    const settings = await this.configManager.load();
    this.alertSettings = settings.AlertSettings;

    this.unsubscribe = this.eventBus.subscribe(SystemEvents.MarketDataUpdated, tick => {
      this.evaluateTick(tick);
    });
    this.unsubscribeSettings = this.eventBus.subscribe(SystemEvents.SettingsUpdated, nextSettings => {
      this.alertSettings = nextSettings.AlertSettings;
    });
    this.unsubscribeAlerts = this.eventBus.subscribe(SystemEvents.AlertRaised, alert => {
      void this.sendTelegramOnce(alert);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribeSettings?.();
    this.unsubscribeAlerts?.();
    this.unsubscribe = null;
    this.unsubscribeSettings = null;
    this.unsubscribeAlerts = null;
    this.priceWindows.clear();
    this.lastAlertAt.clear();
    this.telegramSentAlertIds.clear();
  }

  async raiseTestAlert(): Promise<AlertEvent> {
    const event: AlertEvent = {
      id: `alert-self-test:${Date.now()}`,
      type: 'instant_move',
      market: 'Crypto_Binance',
      symbol: '通知测试',
      severity: 'warning',
      value: 1.23,
      threshold: 1,
      message: '这是一条预警自检消息：用于验证 SSE、声音、桌面通知和 Telegram 通道。',
      created_at: new Date().toISOString(),
    };
    this.eventBus.publish(SystemEvents.AlertRaised, event);
    return event;
  }

  private evaluateTick(tick: StandardMarketTick): void {
    if (this.alertSettings?.enabled === false) return;

    const thresholds = this.resolveThresholds(tick);
    if (!thresholds) return;

    this.checkInstantMove(tick, thresholds);
  }

  private resolveThresholds(tick: StandardMarketTick): AlertThresholds | null {
    return {
      ...DEFAULT_THRESHOLDS[tick.market],
      ...(this.alertSettings?.thresholds[tick.market] ?? {}),
    };
  }

  private checkInstantMove(tick: StandardMarketTick, thresholds: AlertThresholds): void {
    const key = `${tick.market}:${tick.symbol}`;
    const now = Date.now();
    const window = this.priceWindows.get(key) ?? [];
    window.push({ ts: now, price: tick.price });

    const windowMs = thresholds.instant_window_seconds * 1000;
    while (window.length > 0 && now - window[0].ts > windowMs) {
      window.shift();
    }
    this.priceWindows.set(key, window);

    const movement = detectWindowMove(window, tick.price);
    if (!movement) return;

    const movePercent = movement.movePercent;
    if (Math.abs(movePercent) < thresholds.instant_move_percent) return;

    const raised = this.raiseOnce(`${tick.market}:${tick.symbol}:instant_move:${movement.direction}`, {
      type: 'instant_move',
      market: tick.market,
      symbol: tick.symbol,
      severity: Math.abs(movePercent) >= thresholds.instant_move_percent * 2 ? 'critical' : 'warning',
      value: Number(movePercent.toFixed(3)),
      threshold: thresholds.instant_move_percent,
      message: `${tick.symbol} 在 ${thresholds.instant_window_seconds} 秒窗口内${movement.direction === 'up' ? '从低点上涨' : '从高点下跌'} ${formatPercent(movePercent)}，超过阈值 ${formatAbsPercent(thresholds.instant_move_percent)}。当前价 ${formatPrice(tick.price)}，窗口低点 ${formatPrice(Math.min(movement.reference.price, movement.current.price))}，窗口高点 ${formatPrice(Math.max(movement.reference.price, movement.current.price))}。`,
    });

    if (raised) {
      this.priceWindows.set(key, window.slice(-1));
    }
  }

  private raiseOnce(
    cooldownKey: string,
    alert: Omit<AlertEvent, 'id' | 'created_at'>,
  ): boolean {
    const now = Date.now();
    const last = this.lastAlertAt.get(cooldownKey) ?? 0;
    const cooldownMs = (this.alertSettings?.cooldown_seconds ?? 300) * 1000;
    if (now - last < cooldownMs) return false;

    this.lastAlertAt.set(cooldownKey, now);
    const event: AlertEvent = {
      ...alert,
      id: `${cooldownKey}:${now}`,
      created_at: new Date(now).toISOString(),
    };
    this.eventBus.publish(SystemEvents.AlertRaised, event);
    return true;
  }

  private async sendTelegramOnce(alert: AlertEvent): Promise<void> {
    if (this.telegramSentAlertIds.has(alert.id)) return;
    this.telegramSentAlertIds.add(alert.id);
    if (this.telegramSentAlertIds.size > 500) {
      const oldest = this.telegramSentAlertIds.values().next().value;
      if (oldest) this.telegramSentAlertIds.delete(oldest);
    }
    await this.sendTelegram(alert);
  }

  private async sendTelegram(alert: AlertEvent): Promise<void> {
    const settings = this.alertSettings;
    if (!settings?.telegram_enabled) return;
    if (!settings.telegram_bot_token || !settings.telegram_chat_id) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegram_chat_id,
          text: [
            'Quantum Monitor 预警',
            `品种：${alert.symbol}`,
            `市场：${marketLabel(alert.market)}`,
            `类型：${alertTypeLabel(alert.type)}`,
            `级别：${severityLabel(alert.severity)}`,
            alert.message,
          ].join('\n'),
        }),
      });
      if (!response.ok) {
        console.warn(`[AlertEngine] Telegram notification failed: HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn('[AlertEngine] Telegram notification failed:', err);
    }
  }
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAbsPercent(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

function detectWindowMove(window: PricePoint[], currentPrice: number): WindowMove | null {
  const points = window.filter(item => Number.isFinite(item.price) && item.price > 0);
  if (points.length < 2 || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  let low = points[0];
  let high = points[0];
  for (const point of points) {
    if (point.price < low.price) low = point;
    if (point.price > high.price) high = point;
  }

  if (low.price <= 0 || high.price <= 0 || low.price === high.price) return null;

  if (low.ts <= high.ts) {
    return {
      reference: low,
      current: high,
      movePercent: ((high.price - low.price) / low.price) * 100,
      direction: 'up',
    };
  }

  return {
    reference: high,
    current: low,
    movePercent: ((low.price - high.price) / high.price) * 100,
    direction: 'down',
  };
}

function marketLabel(market: MarketModuleName): string {
  if (market === 'Crypto_Binance') return '币安合约';
  if (market === 'Futures_CN') return '国内期货';
  if (market === 'Futures_Global') return '外盘期货';
  if (market === 'Stocks_US') return '美股';
  if (market === 'Stocks_CN') return '国内股票';
  return '宏观首页';
}

function alertTypeLabel(type: AlertEvent['type']): string {
  if (type === 'instant_move') return '价格异动';
  if (type === 'ma60_deviation') return 'MA60 偏离';
  if (type === 'module_error') return '模块异常';
  if (type === 'data_quality') return '数据质量';
  return type;
}

function severityLabel(severity: AlertEvent['severity']): string {
  if (severity === 'critical') return '严重';
  if (severity === 'warning') return '警告';
  return '提示';
}
