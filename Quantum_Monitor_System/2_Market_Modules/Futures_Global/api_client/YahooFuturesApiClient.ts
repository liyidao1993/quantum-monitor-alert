import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Agent as HttpsAgent, get, type Agent } from 'node:https';
import { mapMarketSymbol } from '../../../4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.js';
import type { GlobalFuturesCandle, GlobalFuturesInterval, IFuturesGlobalApiClient } from './IFuturesGlobalApiClient.js';

const DEFAULT_YAHOO_CHART_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
const REQUEST_TIMEOUT_MS = 10_000;
const sharedKeepAliveAgent = new HttpsAgent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 30_000 });

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code?: string; description?: string };
  };
}

export class YahooFuturesApiClient implements IFuturesGlobalApiClient {
  async getKlines(symbol: string, interval: GlobalFuturesInterval, limit: number): Promise<GlobalFuturesCandle[]> {
    const mapped = mapMarketSymbol(symbol, 'Futures_Global');
    const query = buildChartQuery(interval, limit);
    const url = `${getYahooChartBase()}/${encodeURIComponent(mapped.dataSymbol)}?${query}`;
    const json = await requestJson<YahooChartResponse>(url, getProxyAgent() ?? sharedKeepAliveAgent);
    const error = json.chart?.error;
    if (error) {
      throw new Error(`[YahooFuturesApiClient] ${error.code ?? 'error'}: ${error.description ?? 'unknown error'}`);
    }

    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    const closes = quote?.close ?? [];

    const candles: GlobalFuturesCandle[] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = closes[i];
      if (typeof close !== 'number') continue;

      candles.push({
        time: new Date(timestamps[i] * 1000).toISOString(),
        open: optionalNumber(quote?.open?.[i]),
        high: optionalNumber(quote?.high?.[i]),
        low: optionalNumber(quote?.low?.[i]),
        close,
        volume: optionalNumber(quote?.volume?.[i]),
      });
    }

    return candles.slice(-limit);
  }
}

function buildChartQuery(interval: GlobalFuturesInterval, limit: number): string {
  if (interval === '1m' && limit <= 10) {
    return 'interval=1m&range=1d&includePrePost=true';
  }
  const now = Math.floor(Date.now() / 1000);
  const period1 = calculatePeriod1(now, interval, limit);
  return `interval=${interval}&period1=${period1}&period2=${now}&includePrePost=true&events=div%2Csplits`;
}

function getYahooChartBase(): string {
  return process.env.YAHOO_CHART_BASE || DEFAULT_YAHOO_CHART_BASE;
}

function calculatePeriod1(now: number, interval: GlobalFuturesInterval, limit: number): number {
  if (interval === '1m') return now - Math.max(limit * 3, 2 * 24 * 60) * 60;
  if (interval === '15m') return now - Math.max(limit * 45, 5 * 24 * 60) * 60;
  return now - Math.max(limit * 2, 120) * 24 * 60 * 60;
}

function requestJson<T>(url: string, agent: Agent | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = get(url, {
      agent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://finance.yahoo.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk as Buffer));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`[YahooFuturesApiClient] HTTP ${res.statusCode}: ${body.slice(0, 240)}`));
          return;
        }

        try {
          resolve(JSON.parse(body) as T);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function getProxyAgent(): Agent | undefined {
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) {
    return new SocksProxyAgent(socksProxy);
  }

  const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpProxy) {
    return new HttpsProxyAgent(httpProxy);
  }

  return undefined;
}
