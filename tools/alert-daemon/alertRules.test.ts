import assert from "node:assert/strict";
import { buildEffectiveConfig, DEFAULT_DAEMON_CONFIG, type EffectiveDaemonConfig } from "./config.js";
import { InstantMoveRule, Ma60DeviationRule } from "./alertRules.js";
import type { DaemonTick } from "./marketStore.js";
import type { AppSettings } from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes.js";

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

assert.equal(instant.evaluate(tick(103)), null, "small pullback from new anchor 104 must not trigger");
assert.equal(instant.evaluate(tick(106)), null, "move from new anchor 104 (+1.92%) below 3% threshold must not re-trigger");

const steppedUpward = instant.evaluate(tick(108));
assert.equal(steppedUpward?.type, "instant_move", "new +3.85% wave from anchor 104 (or +4.85% from 103) must trigger");

const downward = instant.evaluate(tick(99));
assert.ok((downward?.value ?? 0) < 0, "a new >3% drop from anchor 108 should produce a down alert");

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

// Strict 20-minute per-symbol cooldown (unified direction, no step bypass, shared across binance/watchlist)
const strictConfig = {
  ...config,
  cooldown: {
    effective_base_seconds: 1200,
    same_direction_step_percent: 0,
    max_alerts_per_symbol_per_10min: 1,
    separate_up_down: false,
  },
} as EffectiveDaemonConfig;
const strictRule = new InstantMoveRule(strictConfig);
const t0 = 1_700_000_000_000;
assert.equal(strictRule.evaluate(tick(100), t0), null);
const firstHit = strictRule.evaluate(tick(104), t0 + 10_000);
assert.equal(firstHit?.type, "instant_move", "initial move should trigger");
assert.equal(strictRule.evaluate(tick(109), t0 + 40_000), null, "same-direction move within 20m must be blocked");
assert.equal(strictRule.evaluate(tick(98), t0 + 70_000), null, "opposite-direction move within 20m must be blocked");
// Watchlist tick on the same symbol must also share the 20-minute cooldown
assert.equal(strictRule.evaluate(wlTick("BTC/USDT", 100), t0 + 80_000), null);
assert.equal(strictRule.evaluate(wlTick("BTC/USDT", 102), t0 + 95_000), null);
assert.equal(strictRule.evaluate(wlTick("BTC/USDT", 102.5), t0 + 110_000), null, "watchlist alert for same symbol within 20m must be blocked");
// Different symbol still alerts independently
assert.equal(strictRule.evaluate(tick(200, { symbol: "ETH/USDT" }), t0 + 120_000), null);
const otherSymbolHit = strictRule.evaluate(tick(208, { symbol: "ETH/USDT" }), t0 + 130_000);
assert.equal(otherSymbolHit?.symbol, "ETH/USDT", "different symbol should not be blocked");
// After 20 minutes (1200s), the original symbol can trigger again
assert.equal(strictRule.evaluate(tick(100), t0 + 1_215_000), null);
const afterCooldown = strictRule.evaluate(tick(104), t0 + 1_225_000);
assert.equal(afterCooldown?.type, "instant_move", "same symbol should alert again once 20m cooldown passes");

// Regression test: when same_direction_step_percent > 0, cooldown bypass requires >= threshold + step
const steppedConfig = {
  ...config,
  cooldown: {
    effective_base_seconds: 1200,
    same_direction_step_percent: 2,
    max_alerts_per_symbol_per_10min: 6,
    separate_up_down: false,
  },
} as EffectiveDaemonConfig;
const steppedRule = new InstantMoveRule(steppedConfig);
assert.equal(steppedRule.evaluate(tick(100), t0), null);
assert.equal(steppedRule.evaluate(tick(103.5), t0 + 5_000)?.type, "instant_move");
assert.equal(steppedRule.evaluate(tick(107.2), t0 + 15_000), null, "+3.57% within cooldown must not bypass when threshold+step=5%");
const bigBreakout = steppedRule.evaluate(tick(109.5), t0 + 25_000);
assert.equal(bigBreakout?.type, "instant_move", "+5.8% (>= threshold 3% + step 2%) should bypass cooldown");

// Unrestricted mode: zero cooldown, unlimited alerts per 10m, immediate watchlist trigger (no 2-frame spike wait), 5% crypto threshold
const unrestrictedEffective = buildEffectiveConfig(
  {
    AlertSettings: {
      enabled: true,
      cooldown_seconds: 180,
      thresholds: { Crypto_Binance: { instant_window_seconds: 90, instant_move_percent: 3 } },
    },
    BinanceSettings: { monitor_top_volume: 20 },
    RefreshIntervalSettings: { Crypto_Binance: { price_seconds: 1 } },
  } as unknown as AppSettings,
  {
    ...DEFAULT_DAEMON_CONFIG,
    monitor: { ...DEFAULT_DAEMON_CONFIG.monitor, top_volume: 30 },
    instant_move: {
      enabled: true,
      window_seconds: 90,
      threshold_percent: 5,
      watchlist_threshold_percent: 1,
      watchlist_confirm_spike: false,
    },
    cooldown: {
      base_seconds: 0,
      same_direction_step_percent: 0,
      max_alerts_per_symbol_per_10min: 0,
      separate_up_down: true,
    },
  },
);
assert.equal(unrestrictedEffective.monitor.effective_top_volume, 30);
assert.equal(unrestrictedEffective.instant_move.effective_threshold_percent, 5);
assert.equal(unrestrictedEffective.instant_move.watchlist_confirm_spike, false);
assert.equal(unrestrictedEffective.cooldown.effective_base_seconds, 0, "explicit base_seconds=0 must not fall back to settings.json");
assert.equal(unrestrictedEffective.cooldown.max_alerts_per_symbol_per_10min, 0, "max_alerts_per_symbol_per_10min=0 must remain unlimited");

const freeRule = new InstantMoveRule(unrestrictedEffective);
// Watchlist index triggers immediately on the very first >=1% move without waiting for a second frame
assert.equal(freeRule.evaluate(wlTick("SH000001", 3500), t0), null);
const immediateIndexHit = freeRule.evaluate(wlTick("SH000001", 3540), t0 + 15_000);
assert.equal(immediateIndexHit?.type, "instant_move", "watchlist/index must alert on first spike when watchlist_confirm_spike=false");

// Unlimited rapid consecutive waves on crypto (>=5% each) and watchlist (>=1% each) with zero cooldown/cap
let cryptoPrice = 100;
assert.equal(freeRule.evaluate(tick(cryptoPrice, { symbol: "SOL/USDT" }), t0), null);
for (let i = 1; i <= 12; i++) {
  cryptoPrice = Number((cryptoPrice * (i % 2 === 1 ? 1.055 : 0.945)).toFixed(4));
  const hit = freeRule.evaluate(tick(cryptoPrice, { symbol: "SOL/USDT" }), t0 + i * 10_000);
  assert.equal(hit?.type, "instant_move", `unrestricted crypto wave #${i} should trigger without cooldown or 10m cap`);
}
// Sub-5% crypto move still stays quiet
assert.equal(freeRule.evaluate(tick(cryptoPrice * 1.04, { symbol: "SOL/USDT" }), t0 + 130_000), null, "4% crypto move must stay below 5% threshold");

console.log("alert rule tests passed");
