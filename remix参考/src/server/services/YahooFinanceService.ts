import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance();

export class YahooFinanceService {
    // Note: Yahoo Finance provides 1m and 15m data but has strict rate limits.
    // We will fetch up to 60 data points.
    async getKlines(symbol: string, interval: '1m' | '15m', limit: number = 60): Promise<number[]> {
        try {
            // Calculate a period1 that covers enough time for the limit
            const now = new Date();
            let period1 = new Date();
            
            if (interval === '1m') {
                // For 1m data, we can't go back too far in Yahoo
                period1 = new Date(now.getTime() - (limit * 2 * 60 * 1000));
            } else {
                period1 = new Date(now.getTime() - (limit * 30 * 60 * 1000));
            }

            const result = await yf.chart(symbol, {
                period1,
                interval: interval === '1m' ? '1m' : '15m',
            });

            if (!result || !result.quotes || result.quotes.length === 0) {
                // If 1m fails, try a slightly longer period
                if (interval === '1m') {
                   const fallback = await yf.chart(symbol, {
                      period1: new Date(now.getTime() - 24 * 60 * 60 * 1000),
                      interval: '1m'
                   });
                   if (fallback?.quotes?.length) {
                      const closes = fallback.quotes.map(k => k.close).filter((c): c is number => c !== null && c !== undefined);
                      return closes.slice(-limit);
                   }
                }
                return [];
            }
            
            // Extract the close prices and slice the last 'limit' items
            const closes = result.quotes.map(k => k.close).filter((c): c is number => c !== null && c !== undefined);
            return closes.slice(-limit);
        } catch (err: any) {
            // Log less verbosely for 404s
            if (err.name !== 'HTTPError') {
               console.error(`Error fetching Yahoo data for ${symbol}:`, err.message);
            }
            return [];
        }
    }
}
