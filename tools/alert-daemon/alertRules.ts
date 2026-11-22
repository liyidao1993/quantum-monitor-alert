import type { EffectiveDaemonConfig, Severity } from "./config.js";
import type { DaemonTick } from "./marketStore.js";

interface PricePoint {
  ts: number;
  price: number;
}

interface Move {
  direction: "up" | "down";
  movePercent: number;
  low: PricePoint;
  high: PricePoint;
  extremeTs: number;
}

interface AlertRecord {
  lastAt: number;
  lastAbs: number;
  lastExtremeTs: number;
}

export interface DaemonAlert {
  id: string;
  type: "instant_move" | "ma60_deviation";
  symbol: string;
  period: string;
  title: string;
  message: string;
  severity: Severity;
  value: number;
  threshold: number;
  created_at: string;
}

export class InstantMoveRule {
  private readonly windows = new Map<string, PricePoint[]>();
  private readonly records = new Map<string, AlertRecord>();
  private readonly symbolAlertTimes = new Map<string, number[]>();
  private readonly pendingWatchlistSpikes = new Map<string, { ts: number; price: number; direction: "up" | "down" }>();
  private lastEvaluationAt = 0;

  constructor(private readonly config: EffectiveDaemonConfig) {}

  evaluate(tick: DaemonTick, nowMs?: number): DaemonAlert | null {
    if (!this.config.enabled || !this.config.instant_move.enabled) return null;
    if (!Number.isFinite(tick.price) || tick.price <= 0) return null;
    const now = nowMs !== undefined ? nowMs : Math.max(Date.now(), this.lastEvaluationAt + 1);
    this.lastEvaluationAt = Math.max(this.lastEvaluationAt, now);
    const threshold = this.getThresholdForTick(tick);
    const ruleKey = tick.origin === "watchlist" ? `wl:${tick.symbol}` : tick.symbol;
    const window = this.windows.get(ruleKey) ?? [];
    const windowMs = this.config.instant_move.effective_window_seconds * 1000;
    while (window.length > 0 && now - window[0].ts > windowMs) window.shift();

    if (tick.origin === "watchlist" && window.length > 0) {
      const prev = window[window.length - 1];
      const deltaPct = ((tick.price - prev.price) / prev.price) * 100;
      const direction: "up" | "down" = deltaPct >= 0 ? "up" : "down";
      const pending = this.pendingWatchlistSpikes.get(ruleKey);
      const pendingValid = Boolean(pending && now - pending.ts <= windowMs);

      if (pendingValid && pending) {
        this.pendingWatchlistSpikes.delete(ruleKey);
        const confirmed = direction === pending.direction && Math.abs(deltaPct) >= threshold * 0.5;
        if (!confirmed && Math.abs(deltaPct) >= threshold) {
          this.pendingWatchlistSpikes.set(ruleKey, { ts: now, price: tick.price, direction });
          this.windows.set(ruleKey, window);
          return null;
        }
      } else {
        this.pendingWatchlistSpikes.delete(ruleKey);
        if (Math.abs(deltaPct) >= threshold) {
          this.pendingWatchlistSpikes.set(ruleKey, { ts: now, price: tick.price, direction });
          this.windows.set(ruleKey, window);
          return null;
        }
      }
    }

    window.push({ ts: now, price: tick.price });
    while (window.length > 0 && now - window[0].ts > windowMs) window.shift();
    this.windows.set(ruleKey, window);

    const move = detectMove(window);
    if (!move || Math.abs(move.movePercent) < threshold) return null;
    if (!this.canRaise(tick.symbol, move, threshold, now)) return null;

    // Reset sliding window to the current trigger price as the new anchor point,
    // preventing the same price wave from re-triggering as old points slide out.
    this.windows.set(ruleKey, [{ ts: now, price: tick.price }]);
    this.pendingWatchlistSpikes.delete(ruleKey);

    const value = Number(move.movePercent.toFixed(3));
    const severity = Math.abs(value) >= threshold * 2 ? "critical" : "warning";
    return {
      id: `instant:${tick.symbol}:${move.direction}:${now}`,
      type: "instant_move",
      symbol: tick.symbol,
      period: `${this.config.instant_move.effective_window_seconds}秒`,
      title: `[价格异动] ${tick.symbol}`,
      severity,
      value,
      threshold,
      created_at: new Date(now).toISOString(),
      message: [
        `${this.config.instant_move.effective_window_seconds}秒窗口：${formatSigned(value)}%`,
        `当前价：${formatPrice(tick.price)}`,
        `24H涨跌：${formatSigned(tick.change_24h)}%`,
      ].join("\n"),
    };
  }

  private getThresholdForTick(tick: DaemonTick): number {
    if (tick.origin === "watchlist") {
      return this.config.instant_move.effective_watchlist_threshold_percent;
    }
    return this.config.instant_move.effective_threshold_percent;
  }

  private canRaise(symbol: string, move: Move, threshold: number, now: number): boolean {
    const direction = this.config.cooldown.separate_up_down ? move.direction : "both";
    const key = `${symbol}:${direction}`;
    const record = this.records.get(key);
    const absMove = Math.abs(move.movePercent);
    const step = this.config.cooldown.same_direction_step_percent;
    const cooldownMs = this.config.cooldown.effective_base_seconds * 1000;
    const hasNewExtreme = !record || move.extremeTs > record.lastExtremeTs;
    const cooldownPassed = !record || now - record.lastAt >= cooldownMs;
    // Since the window resets to the trigger price after each alert, an early
    // cooldown bypass requires exceeding the base threshold by at least `step`.
    const steppedBeyond = Boolean(record && step > 0 && absMove >= threshold + step);

    if (!hasNewExtreme) return false;
    if (!cooldownPassed && !steppedBeyond) return false;
    if (!this.withinSymbolRateLimit(symbol, now)) return false;

    this.records.set(key, { lastAt: now, lastAbs: absMove, lastExtremeTs: move.extremeTs });
    return true;
  }

  private withinSymbolRateLimit(symbol: string, now: number): boolean {
    const max = this.config.cooldown.max_alerts_per_symbol_per_10min;
    const cutoff = now - 10 * 60 * 1000;
    const rows = (this.symbolAlertTimes.get(symbol) ?? []).filter(ts => ts >= cutoff);
    if (rows.length >= max) {
      this.symbolAlertTimes.set(symbol, rows);
      return false;
    }
    rows.push(now);
    this.symbolAlertTimes.set(symbol, rows);
    return true;
  }
}

export class Ma60DeviationRule {
  private readonly records = new Map<string, AlertRecord>();

  constructor(private readonly config: EffectiveDaemonConfig) {}

  evaluate(tick: DaemonTick): DaemonAlert[] {
    if (!this.config.enabled || !this.config.ma60_alerts.enabled) return [];
    const alerts: DaemonAlert[] = [];
    const now = Date.now();
    for (const interval of ["1m", "15m", "1d"] as const) {
      const intervalConfig = this.config.ma60_alerts.intervals[interval];
      if (!intervalConfig.enabled) continue;
      const value = getMaValue(tick, interval);
      const ma = getMaPrice(tick, interval);
      if (value === undefined || ma === undefined) continue;
      if (Math.abs(value) < intervalConfig.threshold_percent) continue;
      if (!this.canRaise(tick.symbol, interval, value, now)) continue;

      const rounded = Number(value.toFixed(3));
      alerts.push({
        id: `ma60:${tick.symbol}:${interval}:${rounded >= 0 ? "up" : "down"}:${now}`,
        type: "ma60_deviation",
        symbol: tick.symbol,
        period: interval,
        title: `[MA60偏离] ${tick.symbol}`,
        severity: Math.abs(rounded) >= intervalConfig.threshold_percent * 2 ? "critical" : "warning",
        value: rounded,
        threshold: intervalConfig.threshold_percent,
        created_at: new Date(now).toISOString(),
        message: [
          `周期：${interval}`,
          `偏离：${formatSigned(rounded)}%`,
          `当前价：${formatPrice(tick.price)}`,
          `MA60：${formatPrice(ma)}`,
          `24H涨跌：${formatSigned(tick.change_24h)}%`,
        ].join("\n"),
      });
    }
    return alerts;
  }

  private canRaise(symbol: string, interval: "1m" | "15m" | "1d", value: number, now: number): boolean {
    const direction = value >= 0 ? "up" : "down";
    const key = `${symbol}:${interval}:${direction}`;
    const absValue = Math.abs(value);
    const record = this.records.get(key);
    const cooldownMs = this.config.ma60_alerts.cooldown_seconds * 1000;
    const step = this.config.ma60_alerts.same_direction_step_percent;
    const cooldownPassed = !record || now - record.lastAt >= cooldownMs;
    const steppedBeyond = Boolean(record && step > 0 && absValue >= record.lastAbs + step);
    if (!cooldownPassed && !steppedBeyond) return false;
    this.records.set(key, { lastAt: now, lastAbs: absValue, lastExtremeTs: now });
    return true;
  }
}

export function appendContext(alert: DaemonAlert, context: string): DaemonAlert {
  return {
    ...alert,
    message: `${alert.message}\n\n${context}`,
  };
}

export function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(5);
}

function detectMove(window: PricePoint[]): Move | null {
  const points = window.filter(point => Number.isFinite(point.price) && point.price > 0);
  if (points.length < 2) return null;
  let low = points[0];
  let high = points[0];
  for (const point of points) {
    if (point.price < low.price) low = point;
    if (point.price > high.price) high = point;
  }
  if (low.price <= 0 || high.price <= 0 || low.price === high.price) return null;

  if (low.ts <= high.ts) {
    return {
      direction: "up",
      low,
      high,
      extremeTs: high.ts,
      movePercent: ((high.price - low.price) / low.price) * 100,
    };
  }
  return {
    direction: "down",
    low,
    high,
    extremeTs: low.ts,
    movePercent: ((low.price - high.price) / high.price) * 100,
  };
}

function getMaValue(tick: DaemonTick, interval: "1m" | "15m" | "1d"): number | undefined {
  if (interval === "1m") return tick.ma60_dev_1m;
  if (interval === "15m") return tick.ma60_dev_15m;
  return tick.ma60_dev_1d;
}

function getMaPrice(tick: DaemonTick, interval: "1m" | "15m" | "1d"): number | undefined {
  if (interval === "1m") return tick.ma60_value_1m;
  if (interval === "15m") return tick.ma60_value_15m;
  return tick.ma60_value_1d;
}
