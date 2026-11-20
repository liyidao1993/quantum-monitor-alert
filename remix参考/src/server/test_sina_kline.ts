import https from 'https';

function fetchSinaKline(symbol: string, type: '1' | '15') {
    return new Promise((resolve, reject) => {
        https.get(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine?symbol=${symbol}&type=${type}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function test() {
    console.log("1m:\n", (await fetchSinaKline('C0', '1')).toString().substring(0, 200));
    console.log("15m:\n", (await fetchSinaKline('C0', '15')).toString().substring(0, 200));
}
test();
