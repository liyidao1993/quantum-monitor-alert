export type BinanceInterval = '1m' | '15m' | '1d';

export interface PriceUpdate {
  symbol: string;
  price: number;
  change_24h: number;
}

interface BinanceKlineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SymbolSeed {
  symbol: string;
  basePrice: number;
  quoteVolume: number;
  change_24h: number;
}

const symbolSeeds: SymbolSeed[] = [
  { symbol: 'BTC/USDT', basePrice: 64500.2, quoteVolume: 9820000000, change_24h: 2.45 },
  { symbol: 'ETH/USDT', basePrice: 3120.55, quoteVolume: 5120000000, change_24h: -1.2 },
  { symbol: 'SOL/USDT', basePrice: 145.3, quoteVolume: 1840000000, change_24h: 8.5 },
  { symbol: 'ORDI/USDT', basePrice: 42.1, quoteVolume: 760000000, change_24h: -5.1 },
  { symbol: 'BNB/USDT', basePrice: 585.8, quoteVolume: 720000000, change_24h: 1.15 },
  { symbol: 'DOGE/USDT', basePrice: 0.161, quoteVolume: 680000000, change_24h: 3.22 },
  { symbol: 'XRP/USDT', basePrice: 0.52, quoteVolume: 610000000, change_24h: -0.75 },
  { symbol: 'LINK/USDT', basePrice: 14.92, quoteVolume: 420000000, change_24h: 2.05 },
];

export class MockBinanceApiClient {
  private latestPrices = new Map(symbolSeeds.map(seed => [seed.symbol, seed.basePrice]));

  async getTopSymbolsByVolume(limit: number): Promise<string[]> {
    return symbolSeeds
      .slice()
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, limit)
      .map(seed => seed.symbol);
  }

  async getRecentCloses(symbol: string, interval: BinanceInterval, limit: number): Promise<number[]> {
    const candles = await this.getKlines(symbol, interval, limit);
    return candles.map(candle => candle.close);
  }

  async getKlines(symbol: string, interval: BinanceInterval, limit: number): Promise<BinanceKlineCandle[]> {
    const seed = this.getSeed(symbol);
    const intervalNoise = interval === '1m' ? 0.0018 : interval === '15m' ? 0.006 : 0.018;
    const now = Math.floor(Date.now() / 1000);

    return Array.from({ length: limit }, (_, index) => {
      const wave = Math.sin(index / 4) * seed.basePrice * intervalNoise;
      const trend = (index - limit / 2) * seed.basePrice * intervalNoise * 0.03;
      const close = roundPrice(seed.basePrice + wave + trend);
      return {
        time: now - (limit - index) * intervalSeconds(interval),
        open: close,
        high: roundPrice(close * 1.001),
        low: roundPrice(close * 0.999),
        close,
        volume: seed.quoteVolume / limit,
      };
    });
  }

  subscribePrices(symbols: string[], onUpdate: (update: PriceUpdate) => void): () => void {
    const timer = setInterval(() => {
      for (const symbol of symbols) {
        const seed = this.getSeed(symbol);
        const previous = this.latestPrices.get(symbol) ?? seed.basePrice;
        const drift = previous * (Math.random() - 0.48) * 0.0012;
        const next = roundPrice(Math.max(previous + drift, previous * 0.98));

        this.latestPrices.set(symbol, next);
        onUpdate({
          symbol,
          price: next,
          change_24h: seed.change_24h,
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }

  private getSeed(symbol: string): SymbolSeed {
    const seed = symbolSeeds.find(item => item.symbol === symbol);
    if (!seed) {
      throw new Error(`Unknown mock Binance symbol: ${symbol}`);
    }
    return seed;
  }
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value >= 10 ? 2 : 5));
}

function intervalSeconds(interval: BinanceInterval): number {
  if (interval === '1m') return 60;
  if (interval === '15m') return 15 * 60;
  return 24 * 60 * 60;
}
