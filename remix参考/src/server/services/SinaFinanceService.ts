import https from 'https';

export class SinaFinanceService {
    async getKlines(symbol: string, interval: '1m' | '15m', limit: number = 60): Promise<number[]> {
        return new Promise((resolve) => {
            const type = interval === '1m' ? '1' : '15';
            // Sina uses different endpoint for min data
            const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine?symbol=${symbol}&type=${type}`;
            
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                   try {
                       // "/*<script>location.href='//sina.com';</script>*/\nvar([{"d":"2026-04-17...
                       const jsonStrMatch = data.match(/var\((.*?)\);/s) || data.match(/var\((.*)\)/s);
                       if (jsonStrMatch && jsonStrMatch[1]) {
                           const arr = JSON.parse(jsonStrMatch[1]);
                           if (Array.isArray(arr)) {
                               // Map closing prices "c"
                               const closes = arr.map((item: any) => parseFloat(item.c)).filter(c => !isNaN(c));
                               resolve(closes.slice(-limit));
                               return;
                           }
                       }
                       resolve([]);
                   } catch(e) {
                       console.error(`Error parsing Sina data for ${symbol}:`, e);
                       resolve([]);
                   }
                });
            }).on('error', (err) => {
                 console.error(`Request error for Sina ${symbol}:`, err);
                 resolve([]);
            });
        });
    }
}
