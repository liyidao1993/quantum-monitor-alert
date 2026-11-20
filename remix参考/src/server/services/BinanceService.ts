import axios from 'axios';

export class BinanceService {
  private restBaseUrl = 'https://fapi.binance.com';

  async getTop50SymbolsByVolume(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.restBaseUrl}/fapi/v1/ticker/24hr`);
      const tickers = response.data;
      tickers.sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
      const usdtPairs = tickers.filter((t: any) => t.symbol.endsWith('USDT'));
      return usdtPairs.slice(0, 50).map((t: any) => t.symbol.toLowerCase());
    } catch (error) {
      console.error("Error fetching top 50 symbols:", error);
      return [];
    }
  }

  async getKlines(symbol: string, interval: string, limit: number = 60): Promise<number[]> {
    try {
      const response = await axios.get(`${this.restBaseUrl}/fapi/v1/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval,
          limit
        }
      });
      return response.data.map((k: any) => parseFloat(k[4]));
    } catch (error) {
      console.error(`Error fetching klines for ${symbol} ${interval}:`, error);
      return [];
    }
  }
}
