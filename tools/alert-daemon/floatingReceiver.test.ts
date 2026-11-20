import assert from "node:assert/strict";
import type { DaemonLogger } from "./logger.js";
import { buildFloatingAlertFields, FloatingReceiverNotifier } from "./notifiers.js";

process.env.FLOATING_RECEIVER_URL = "http://receiver.test/api/messages";
process.env.RECEIVER_TOKEN = "test-receiver-token";

const requests: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  requests.push({ url: String(input), init });
  return new Response("{}", { status: 201 });
};

const logger = {
  info: () => undefined,
  warn: () => undefined,
} as unknown as DaemonLogger;

try {
  const notifier = new FloatingReceiverNotifier(logger);
  assert.equal(notifier.enabled, true);
  await notifier.send(
    "真实告警",
    "**正文**",
    "critical",
    "alert",
    {
      id: "alert-1",
      timestamp: "2026-07-20T12:00:00.000Z",
      alert: {
        schema_version: 1,
        type: "instant_move",
        symbol: "BTCUSDT",
        period: "30秒",
        direction: "up",
        change_percent: 1.25,
        threshold_percent: 1,
        triggered_at: "2026-07-20T12:00:00.000Z",
      },
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://receiver.test/api/messages");
  assert.equal(requests[0].init?.method, "POST");
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer test-receiver-token");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    id: "alert-1",
    timestamp: "2026-07-20T12:00:00.000Z",
    alert: {
      schema_version: 1,
      type: "instant_move",
      symbol: "BTCUSDT",
      period: "30秒",
      direction: "up",
      change_percent: 1.25,
      threshold_percent: 1,
      triggered_at: "2026-07-20T12:00:00.000Z",
    },
    title: "真实告警",
    body: "**正文**",
    level: "error",
    kind: "alert",
  });

  assert.deepEqual(buildFloatingAlertFields({
    id: "ma60:SPCX:15m:down:1",
    type: "ma60_deviation",
    symbol: "SPCX",
    period: "15m",
    title: "SPCX",
    message: "details",
    severity: "warning",
    value: -2.345,
    threshold: 2,
    created_at: "2026-07-20T12:01:00.000Z",
  }), {
    schema_version: 1,
    type: "ma60_deviation",
    symbol: "SPCX",
    period: "15m",
    direction: "down",
    change_percent: -2.345,
    threshold_percent: 2,
    triggered_at: "2026-07-20T12:01:00.000Z",
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log("floating receiver notifier tests passed");
