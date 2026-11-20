import * as yf from 'yahoo-finance2';
console.log('Module keys:', Object.keys(yf));
console.log('Default export:', typeof (yf as any).default);
if ((yf as any).yahooFinance) {
    console.log('yahooFinance named export exists');
}
