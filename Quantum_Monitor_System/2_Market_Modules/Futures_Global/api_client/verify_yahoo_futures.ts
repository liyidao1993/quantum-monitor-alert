import 'dotenv/config';
import { checkKlineFreshness } from '../../../4_Shared_Types/data_quality/MarketDataQuality.js';
import { YahooFuturesApiClient } from './YahooFuturesApiClient.js';

const client = new YahooFuturesApiClient();
const symbols = ['GC1!', 'NQ=F'];

for (const symbol of symbols) {
  for (const interval of ['1m', '15m', '1d'] as const) {
    try {
      const candles = await client.getKlines(symbol, interval, 5);
      const quality = checkKlineFreshness(candles, interval === '1d' ? 5 * 24 * 60 * 60 * 1000 : interval === '1m' ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000);
      console.log(symbol, interval, candles.length, candles.at(-1), quality);
    } catch (err) {
      console.error(symbol, interval, err);
      process.exitCode = 1;
    }
  }
}
