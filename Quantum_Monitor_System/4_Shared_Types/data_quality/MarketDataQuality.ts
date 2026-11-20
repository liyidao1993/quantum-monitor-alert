export type DataQualityStatus = 'ok' | 'stale' | 'empty' | 'diverged';

export interface DataQualityResult {
  status: DataQualityStatus;
  reason?: string;
}

export interface TimestampedClose {
  time: string | number;
  close: number;
}

export function checkKlineFreshness(
  candles: TimestampedClose[],
  maxAgeMs: number,
  nowMs = Date.now(),
): DataQualityResult {
  if (candles.length === 0) {
    return { status: 'empty', reason: 'no candles returned' };
  }

  const last = candles.at(-1);
  if (!last) {
    return { status: 'empty', reason: 'no last candle' };
  }

  const lastTime = typeof last.time === 'number'
    ? last.time * (last.time > 10_000_000_000 ? 1 : 1000)
    : Date.parse(last.time);

  if (Number.isNaN(lastTime)) {
    return { status: 'stale', reason: 'invalid candle timestamp' };
  }

  const age = nowMs - lastTime;
  if (age > maxAgeMs) {
    return { status: 'stale', reason: `last candle age ${Math.round(age / 1000)}s exceeds ${Math.round(maxAgeMs / 1000)}s` };
  }

  return { status: 'ok' };
}

export function checkPriceDivergence(
  livePrice: number,
  referenceClose: number | undefined,
  maxDivergencePercent: number,
): DataQualityResult {
  if (referenceClose === undefined || referenceClose <= 0) {
    return { status: 'empty', reason: 'missing reference close' };
  }

  const divergence = Math.abs(((livePrice - referenceClose) / referenceClose) * 100);
  if (divergence > maxDivergencePercent) {
    return {
      status: 'diverged',
      reason: `price divergence ${divergence.toFixed(2)}% exceeds ${maxDivergencePercent.toFixed(2)}%`,
    };
  }

  return { status: 'ok' };
}
