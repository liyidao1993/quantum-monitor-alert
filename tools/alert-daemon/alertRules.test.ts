import assert from "node:assert/strict";
import type { EffectiveDaemonConfig } from "./config.js";
import { InstantMoveRule, Ma60DeviationRule } from "./alertRules.js";
import type { DaemonTick } from "./marketStore.js";

const config = {
  enabled: true,
  instant_move: {
    enabled: true,
    effective_window_seconds: 90,
    effective_threshold_percent: 3,
    effective_watchlist_threshold_percent: 1,
  },
  cooldown: {
    effective_base_seconds: 0,
    same_direction_step_percent: 2,
    max_alerts_per_symbol_per_10min: 6,
    separate_up_down: true,
  },
  ma60_alerts: {
    enabled: true,
    cooldown_seconds: 0,
    same_direction_step_percent: 3,
    intervals: {
      "1m": { enabled: true, threshold_percent: 8 },
      "15m": { enabled: false, threshold_percent: 12 },
      "1d": { enabled: false, threshold_percent: 20 },
    },
  },
} as EffectiveDaemonConfig;

function tick(price: number, extra: Partial<DaemonTick> = {}): DaemonTick {
  return {
    origin: "binance",
    symbol: "BTC/USDT",
    price,
    change_24h: 5.42,
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

const instant = new InstantMoveRule(config);
assert.equal(instant.evaluate(tick(100)), null);

const upward = instant.evaluate(tick(104));
assert.equal(upward?.type, "instant_move");
assert.equal(upward?.value, 4);
assert.equal(upward?.period, "90秒");
assert.doesNotMatch(upward?.message ?? "", /窗口低点|窗口高点/, "window low/high lines must be omitted");

assert.equal(instant.evaluate(tick(103)), null, "without a new extreme there should be no duplicate alert");

const steppedUpward = instant.evaluate(tick(106));
assert.equal(steppedUpward?.value, 6);

const downward = instant.evaluate(tick(99));
assert.ok((downward?.value ?? 0) < 0, "a new lower extreme should produce a down alert");

const ma60 = new Ma60DeviationRule(config);
const maAlerts = ma60.evaluate(tick(110, {
  ma60_dev_1m: 9,
  ma60_value_1m: 100,
}));
assert.equal(maAlerts.length, 1);
assert.equal(maAlerts[0]?.type, "ma60_deviation");
assert.equal(maAlerts[0]?.period, "1m");
assert.equal(maAlerts[0]?.value, 9);

// Watchlist single-sample glitch filtering (pre-market price flip-flop)
const watchlistInstant = new InstantMoveRule(config);
const wlTick = (symbol: string, price: number): DaemonTick =>
  tick(price, { origin: "watchlist", symbol });

assert.equal(watchlistInstant.evaluate(wlTick("SNDK", 812.5)), null);
assert.equal(watchlistInstant.evaluate(wlTick("SNDK", 786.0)), null, "isolated single-frame spike must wait for confirmation");
assert.equal(watchlistInstant.evaluate(wlTick("SNDK", 812.0)), null, "reverted glitch must not trigger up or down alert");

// Watchlist sustained real drop must trigger on second confirming sample
assert.equal(watchlistInstant.evaluate(wlTick("NVDA", 150.0)), null);
assert.equal(watchlistInstant.evaluate(wlTick("NVDA", 146.5)), null, "first large jump waits for confirmation");
const confirmedDrop = watchlistInstant.evaluate(wlTick("NVDA", 146.0));
assert.equal(confirmedDrop?.type, "instant_move");
assert.ok((confirmedDrop?.value ?? 0) <= -2.5, "confirmed sustained drop must alert");

// Watchlist gradual move triggers immediately without waiting
assert.equal(watchlistInstant.evaluate(wlTick("MU", 100.0)), null);
assert.equal(watchlistInstant.evaluate(wlTick("MU", 99.4)), null);
const gradualDrop = watchlistInstant.evaluate(wlTick("MU", 98.8));
assert.equal(gradualDrop?.type, "instant_move");
assert.ok((gradualDrop?.value ?? 0) <= -1.1, "gradual move crossing threshold should alert immediately");

console.log("alert rule tests passed");
