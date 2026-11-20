import yahooFinance from 'yahoo-finance2';

async function testYahoo(symbol: string) {
    try {
        const now = new Date();
        const period1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const result = await yahooFinance.chart(symbol, {
            period1,
            interval: '1m',
        });
        console.log(`Yahoo ${symbol} status: Success`);
        console.log(`Yahoo ${symbol} quotes count:`, result.quotes.length);
        console.log(`Yahoo ${symbol} first quote:`, result.quotes[0]);
    } catch (e: any) {
        console.error(`Yahoo ${symbol} failed:`, e.message);
    }
}

async function run() {
    await testYahoo('GC=F');
    await testYahoo('NQ=F');
}

run();
