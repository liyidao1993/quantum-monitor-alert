import https from 'https';

function fetchSina(symbol: string) {
    return new Promise((resolve, reject) => {
        https.get(`https://hq.sinajs.cn/list=${symbol}`, {
           headers: {
               'Referer': 'https://finance.sina.com.cn/'
           }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function test() {
    console.log("nf_C0:", await fetchSina('nf_C0'));
    console.log("C0:", await fetchSina('C0'));
    console.log("c0:", await fetchSina('c0'));
}
test();
