import 'dotenv/config';
import { checkKlineFreshness } from '../../../4_Shared_Types/data_quality/MarketDataQuality.js';
import { SinaFuturesApiClient } from './SinaFuturesApiClient.js';

const client = new SinaFuturesApiClient();
const symbols = ['C0', 'RB0', 'AU0', 'SC0', 'IF0'];

for (const symbol of symbols) {
  for (const interval of ['1m', '15m', '1d'] as const) {
    try {
      const candles = await client.getKlines(symbol, interval, 5);
      const quote = await client.getQuote(symbol);
      const quality = checkKlineFreshness(candles, 10 * 24 * 60 * 60 * 1000);
      console.log(symbol, interval, candles.length, candles.at(-1), quote, quality);
    } catch (err) {
      console.error(symbol, interval, err);
      process.exitCode = 1;
    }
  }
}
