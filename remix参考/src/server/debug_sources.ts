import https from 'https';

async function testSina(symbol: string) {
    return new Promise((resolve) => {
        const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine?symbol=${symbol}&type=1`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Sina ${symbol} status:`, res.statusCode);
                console.log(`Sina ${symbol} data (first 100):`, data.substring(0, 100));
                resolve(data);
            });
        }).on('error', (e) => {
            console.error(`Sina ${symbol} error:`, e.message);
            resolve(null);
        });
    });
}

async function runTests() {
    await testSina('AU2412');
    await testSina('rb2410');
}

runTests();
