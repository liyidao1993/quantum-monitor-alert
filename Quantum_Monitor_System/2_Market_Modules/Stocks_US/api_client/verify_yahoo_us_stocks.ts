import { checkKlineFreshness } from '../../../4_Shared_Types/data_quality/MarketDataQuality.js';
import { YahooUsStocksApiClient } from './YahooUsStocksApiClient.js';
import type { UsStocksInterval } from './IUsStocksApiClient.js';

const client = new YahooUsStocksApiClient();
const cases: Array<[string, UsStocksInterval]> = [
  ['AAPL', '1m'],
  ['MSFT', '1m'],
  ['NVDA', '1m'],
  ['TSLA', '15m'],
  ['SPY', '1d'],
];

let failures = 0;

for (const [symbol, interval] of cases) {
  try {
    const candles = await client.getKlines(symbol, interval, 5);
    const maxAgeMs = interval === '1d' ? 5 * 24 * 60 * 60 * 1000 : interval === '1m' ? 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
    const quality = checkKlineFreshness(candles, maxAgeMs);
    const last = candles.at(-1);
    console.log(symbol, interval, candles.length, last, quality);
    if (!last || quality.status === 'empty') failures += 1;
  } catch (err) {
    failures += 1;
    console.error(symbol, interval, err);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
