import { mapMarketSymbol } from './TradingViewSymbolMapper.js';

const cases = [
  ['BTC/USDT', 'Crypto_Binance', 'BTCUSDT', 'BINANCE:BTCUSDT.P'],
  ['btcusdt', 'Crypto_Binance', 'BTCUSDT', 'BINANCE:BTCUSDT.P'],
  ['GC1!', 'Futures_Global', 'GC=F', 'COMEX:GC1!'],
  ['GC=F', 'Futures_Global', 'GC=F', 'COMEX:GC1!'],
  ['COMEX:GC1!', 'Futures_Global', 'GC=F', 'COMEX:GC1!'],
  ['NQ1!', 'Futures_Global', 'NQ=F', 'CME:NQ1!'],
  ['CL=F', 'Futures_Global', 'CL=F', 'NYMEX:CL1!'],
  ['AAPL', 'Stocks_US', 'AAPL', 'NASDAQ:AAPL'],
  ['NYSE:BRK.B', 'Stocks_US', 'BRK.B', 'NYSE:BRK.B'],
  ['RB2501', 'Futures_CN', 'RB2501', 'SHFE:RB2501'],
  ['C0', 'Futures_CN', 'C0', 'DCE:C0'],
  ['TA501', 'Futures_CN', 'TA501', 'ZCE:TA501'],
  ['IF2506', 'Futures_CN', 'IF2506', 'CFFEX:IF2506'],
] as const;

let failures = 0;

for (const [input, market, dataSymbol, tradingViewSymbol] of cases) {
  const mapped = mapMarketSymbol(input, market);
  const ok = mapped.dataSymbol === dataSymbol && mapped.tradingViewSymbol === tradingViewSymbol;
  if (!ok) {
    failures += 1;
    console.error('FAIL', { input, market, expected: { dataSymbol, tradingViewSymbol }, actual: mapped });
  } else {
    console.log('OK', input, '=>', mapped.dataSymbol, mapped.tradingViewSymbol);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
