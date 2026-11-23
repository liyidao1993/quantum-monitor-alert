import type { MarketModuleName } from '../standard_models/marketTypes.js';

export type SymbolMarket = Extract<MarketModuleName, 'Crypto_Binance' | 'Stocks_CN' | 'Stocks_US' | 'Futures_CN' | 'Futures_Global'>;

export type DataProvider = 'binance_futures' | 'sina_futures' | 'yahoo_finance' | 'eastmoney';

export interface SymbolMappingResult {
  market: SymbolMarket;
  input: string;
  displaySymbol: string;
  dataProvider: DataProvider;
  dataSymbol: string;
  tradingViewSymbol: string;
  exchange?: string;
  name?: string;
}

const GLOBAL_FUTURES: Record<string, { yahoo: string; tv: string; exchange: string; name: string }> = {
  GC: { yahoo: 'GC=F', tv: 'COMEX:GC1!', exchange: 'COMEX', name: 'Gold' },
  SI: { yahoo: 'SI=F', tv: 'COMEX:SI1!', exchange: 'COMEX', name: 'Silver' },
  HG: { yahoo: 'HG=F', tv: 'COMEX:HG1!', exchange: 'COMEX', name: 'Copper' },
  CL: { yahoo: 'CL=F', tv: 'NYMEX:CL1!', exchange: 'NYMEX', name: 'Crude Oil' },
  NG: { yahoo: 'NG=F', tv: 'NYMEX:NG1!', exchange: 'NYMEX', name: 'Natural Gas' },
  RB: { yahoo: 'RB=F', tv: 'NYMEX:RB1!', exchange: 'NYMEX', name: 'RBOB Gasoline' },
  ES: { yahoo: 'ES=F', tv: 'CME:ES1!', exchange: 'CME', name: 'S&P 500 Futures' },
  NQ: { yahoo: 'NQ=F', tv: 'CME:NQ1!', exchange: 'CME', name: 'Nasdaq 100 Futures' },
  YM: { yahoo: 'YM=F', tv: 'CBOT:YM1!', exchange: 'CBOT', name: 'Dow Futures' },
  RTY: { yahoo: 'RTY=F', tv: 'CME:RTY1!', exchange: 'CME', name: 'Russell 2000 Futures' },
  ZC: { yahoo: 'ZC=F', tv: 'CBOT:ZC1!', exchange: 'CBOT', name: 'Corn' },
  ZW: { yahoo: 'ZW=F', tv: 'CBOT:ZW1!', exchange: 'CBOT', name: 'Wheat' },
  ZS: { yahoo: 'ZS=F', tv: 'CBOT:ZS1!', exchange: 'CBOT', name: 'Soybeans' },
};

const CN_FUTURES_PREFIXES: Array<{ exchange: string; prefixes: string[] }> = [
  { exchange: 'SHFE', prefixes: ['RB', 'HC', 'CU', 'AL', 'ZN', 'PB', 'NI', 'SN', 'AU', 'AG', 'BU', 'RU', 'SP', 'SS', 'AO', 'BR', 'FU'] },
  { exchange: 'DCE', prefixes: ['JM', 'PP', 'EB', 'PG', 'LH', 'I', 'J', 'P', 'Y', 'M', 'C', 'L', 'V', 'A', 'B', 'CS', 'JD', 'RR', 'FB', 'BB'] },
  { exchange: 'ZCE', prefixes: ['TA', 'MA', 'FG', 'SF', 'SM', 'SA', 'UR', 'PF', 'AP', 'CJ', 'CF', 'SR', 'OI', 'RM', 'RS', 'JR', 'LR', 'PM', 'WH', 'CY'] },
  { exchange: 'CFFEX', prefixes: ['IF', 'IH', 'IC', 'IM', 'T', 'TF', 'TS', 'TL'] },
  { exchange: 'INE', prefixes: ['SC', 'LU', 'NR', 'BC', 'EC'] },
  { exchange: 'GFEX', prefixes: ['SI', 'LC'] },
];

export function mapMarketSymbol(input: string, market: SymbolMarket): SymbolMappingResult {
  const normalized = normalizeInput(input);
  if (!normalized) {
    throw new Error('symbol is required');
  }

  if (market === 'Crypto_Binance') {
    return mapBinanceSymbol(normalized);
  }

  if (market === 'Futures_Global') {
    return mapGlobalFutureSymbol(normalized);
  }

  if (market === 'Stocks_CN') {
    return mapCnStockSymbol(normalized);
  }

  if (market === 'Stocks_US') {
    return mapUsStockSymbol(normalized);
  }

  return mapCnFutureSymbol(normalized);
}

export function mapBinanceSymbol(input: string): SymbolMappingResult {
  const apiSymbol = input.replace(/^BINANCE:/, '').replace(/\.P$/, '').replace('/', '');
  const displaySymbol = apiSymbol.endsWith('USDT')
    ? `${apiSymbol.slice(0, -4)}/USDT`
    : apiSymbol;

  return {
    market: 'Crypto_Binance',
    input,
    displaySymbol,
    dataProvider: 'binance_futures',
    dataSymbol: apiSymbol,
    tradingViewSymbol: `BINANCE:${apiSymbol}.P`,
    exchange: 'BINANCE',
  };
}

export function mapGlobalFutureSymbol(input: string): SymbolMappingResult {
  const root = globalRoot(input);
  const known = GLOBAL_FUTURES[root];

  if (known) {
    return {
      market: 'Futures_Global',
      input,
      displaySymbol: `${root}1!`,
      dataProvider: 'yahoo_finance',
      dataSymbol: known.yahoo,
      tradingViewSymbol: known.tv,
      exchange: known.exchange,
      name: known.name,
    };
  }

  const yahoo = input.endsWith('=F') ? input : `${root}=F`;
  const tv = input.includes(':') ? input : `${root}1!`;

  return {
    market: 'Futures_Global',
    input,
    displaySymbol: input,
    dataProvider: 'yahoo_finance',
    dataSymbol: yahoo,
    tradingViewSymbol: tv,
  };
}

export function mapUsStockSymbol(input: string): SymbolMappingResult {
  const withoutExchange = input.includes(':') ? input.split(':').at(-1) ?? input : input;
  const symbol = withoutExchange.replace(/^US:/, '').toUpperCase();
  const exchange = inferUsExchange(symbol);

  return {
    market: 'Stocks_US',
    input,
    displaySymbol: symbol,
    dataProvider: 'yahoo_finance',
    dataSymbol: symbol,
    tradingViewSymbol: exchange ? `${exchange}:${symbol}` : symbol,
    exchange,
    name: symbol,
  };
}

export function mapCnStockSymbol(input: string): SymbolMappingResult {
  const withoutExchange = input.includes(':') ? input.split(':').at(-1) ?? input : input;
  const cleaned = withoutExchange.toUpperCase();
  const displaySymbol = cleaned.endsWith('.SS')
    ? `SH${cleaned.slice(0, -3)}`
    : cleaned.endsWith('.SZ')
      ? `SZ${cleaned.slice(0, -3)}`
      : cleaned;
  const exchange = displaySymbol.startsWith('SZ')
    ? 'SZSE'
    : displaySymbol.startsWith('BJ')
      ? 'BSE'
      : 'SSE';
  const rawCode = displaySymbol.replace(/^(SH|SZ|BJ)/, '');

  return {
    market: 'Stocks_CN',
    input,
    displaySymbol,
    dataProvider: 'eastmoney',
    dataSymbol: displaySymbol,
    tradingViewSymbol: `${exchange}:${rawCode}`,
    exchange,
    name: displaySymbol,
  };
}

function inferUsExchange(symbol: string): string {
  const nasdaqSymbols = new Set(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMZN', 'GOOGL', 'GOOG', 'NFLX', 'AMD', 'AVGO', 'COST']);
  return nasdaqSymbols.has(symbol) ? 'NASDAQ' : 'NYSE';
}

export function mapCnFutureSymbol(input: string): SymbolMappingResult {
  const symbol = input.toUpperCase();
  const root = cnRoot(symbol);
  const exchange = findCnExchange(root);

  return {
    market: 'Futures_CN',
    input,
    displaySymbol: symbol,
    dataProvider: 'sina_futures',
    dataSymbol: symbol,
    tradingViewSymbol: exchange ? `${exchange}:${symbol}` : symbol,
    exchange,
  };
}

function normalizeInput(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

function globalRoot(input: string): string {
  const withoutExchange = input.includes(':') ? input.split(':').at(-1) ?? input : input;
  return withoutExchange.replace(/=F$/, '').replace(/1!$/, '');
}

function cnRoot(symbol: string): string {
  const match = symbol.match(/^[A-Z]+/);
  return match?.[0] ?? symbol;
}

function findCnExchange(root: string): string | undefined {
  const sorted = CN_FUTURES_PREFIXES.map(group => ({
    exchange: group.exchange,
    prefixes: [...group.prefixes].sort((a, b) => b.length - a.length),
  }));

  for (const group of sorted) {
    if (group.prefixes.some(prefix => root === prefix)) {
      return group.exchange;
    }
  }

  return undefined;
}
