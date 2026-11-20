import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Agent } from 'node:https';
import type { IBinanceApiClient, BinanceInterval, BinanceKlineCandle, PriceUpdate } from './IBinanceApiClient.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// REST and WS must point at the same market environment, otherwise MA60
// snapshots and live prices will be calculated from different data sets.
const DEFAULT_FAPI_BASE = 'https://fapi.binance.com';
const DEFAULT_WS_BASE = 'wss://fstream.binance.com/market/stream';

const WEIGHT_LIMIT = 2400;       // per-minute IP weight limit
const WEIGHT_SAFETY_MARGIN = 200; // stop sending when remaining < this
const REST_TIMEOUT_MS = 15_000;
const MAX_RETRY_ATTEMPTS = 3;
const WS_STALE_TIMEOUT_MS = 60_000;
const EXCLUDED_NON_CRYPTO_USDT_SYMBOLS = new Set([
  'USDCUSDT',
  'FDUSDUSDT',
  'TUSDUSDT',
  'USDPUSDT',
  'USDEUSDT',
  'PAXGUSDT',
  'XAUTUSDT',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProxyAgent(): Agent | undefined {
  // Support SOCKS5 proxy (V2rayN default: socks5://127.0.0.1:10808)
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) {
    logProxy(`[BinanceApiClient] Using SOCKS proxy: ${socksProxy}`);
    return new SocksProxyAgent(socksProxy);
  }

  // Support HTTP/HTTPS proxy (Clash default: http://127.0.0.1:7890)
  const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpProxy) {
    logProxy(`[BinanceApiClient] Using HTTP proxy: ${httpProxy}`);
    return new HttpsProxyAgent(httpProxy);
  }

  return undefined;
}

function logProxy(message: string): void {
  if (process.env.BINANCE_PROXY_LOG === 'false') return;
  console.log(message);
}

/** Convert REST symbol (BTCUSDT) to display symbol (BTC/USDT) */
function toDisplaySymbol(raw: string): string {
  if (raw.endsWith('USDT')) return `${raw.slice(0, -4)}/USDT`;
  if (raw.endsWith('BUSD')) return `${raw.slice(0, -4)}/BUSD`;
  return raw;
}

/** Convert display symbol (BTC/USDT) to REST symbol (BTCUSDT) */
function toApiSymbol(display: string): string {
  return display.replace('/', '');
}

/** Convert display symbol (BTC/USDT) to WS stream name (btcusdt@miniTicker) */
function toStreamName(display: string): string {
  return `${toApiSymbol(display).toLowerCase()}@miniTicker`;
}

// ---------------------------------------------------------------------------
// Rate limiter (per-minute weight tracker)
// ---------------------------------------------------------------------------
class WeightTracker {
  private usedWeight = 0;
  private resetTimer: NodeJS.Timeout | null = null;

  recordUsage(weight: number): void {
    this.usedWeight += weight;
    if (!this.resetTimer) {
      this.resetTimer = setTimeout(() => {
        this.usedWeight = 0;
        this.resetTimer = null;
      }, 60_000);
    }
  }

  updateFromHeader(headerValue: string | undefined): void {
    if (headerValue) {
      const parsed = parseInt(headerValue, 10);
      if (!isNaN(parsed)) this.usedWeight = parsed;
    }
  }

  canRequest(weight: number): boolean {
    return (this.usedWeight + weight) < (WEIGHT_LIMIT - WEIGHT_SAFETY_MARGIN);
  }

  get remaining(): number {
    return WEIGHT_LIMIT - this.usedWeight;
  }
}

// ---------------------------------------------------------------------------
// Real Binance Futures API Client
// ---------------------------------------------------------------------------
export class BinanceApiClient implements IBinanceApiClient {
  private readonly weightTracker = new WeightTracker();

  constructor() {
    console.log('[BinanceApiClient] Initialized');
  }

  // -------------------------------------------------------------------------
  // REST: fetch with rate-limit awareness
  // -------------------------------------------------------------------------
  private async apiFetch(path: string, weight: number, attempt = 0): Promise<Response> {
    // Wait if approaching rate limit
    if (!this.weightTracker.canRequest(weight)) {
      console.warn(`[BinanceApiClient] Rate limit approaching (remaining: ${this.weightTracker.remaining}), waiting 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }

    const url = `${getFapiBase()}${path}`;
    let response: Response;

    const agent = getProxyAgent();
    if (agent) {
      const http = await import('node:https');
      response = await new Promise<Response>((resolve, reject) => {
        const req = http.get(url, { agent: agent as never, signal: AbortSignal.timeout(REST_TIMEOUT_MS) }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
            }
            resolve(new Response(body, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? '',
              headers,
            }));
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
    } else {
      response = await fetch(url, { signal: AbortSignal.timeout(REST_TIMEOUT_MS) });
    }

    // Track weight from response header
    this.weightTracker.updateFromHeader(
      response.headers.get('x-mbx-used-weight-1m') ?? undefined
    );
    this.weightTracker.recordUsage(weight);

    // Handle errors with bounded retries
    if (response.status === 429) {
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        throw new Error(`[BinanceApiClient] 429 Rate Limited after ${MAX_RETRY_ATTEMPTS} retries on ${path}`);
      }
      const retryAfter = Math.min(120, Math.max(5, parseInt(response.headers.get('retry-after') ?? '60', 10) || 60));
      console.error(`[BinanceApiClient] 429 Rate Limited! Waiting ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return this.apiFetch(path, weight, attempt + 1);
    }

    if (response.status === 418) {
      if (attempt >= 1) {
        throw new Error(`[BinanceApiClient] 418 IP Banned on ${path}`);
      }
      console.error('[BinanceApiClient] 418 IP Banned! Halting requests for 2 minutes.');
      await new Promise(resolve => setTimeout(resolve, 120_000));
      return this.apiFetch(path, weight, attempt + 1);
    }

    if (response.status === 451) {
      throw new Error('[BinanceApiClient] 451 Region Restricted. Ensure SOCKS_PROXY/HTTPS_PROXY routes Node.js traffic through an eligible region.');
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[BinanceApiClient] HTTP ${response.status}: ${body}`);
    }

    return response;
  }

  // -------------------------------------------------------------------------
  // IBinanceApiClient implementation
  // -------------------------------------------------------------------------

  async getTopSymbolsByVolume(limit: number): Promise<string[]> {
    console.log(`[BinanceApiClient] Fetching top ${limit} crypto perpetual symbols by volume...`);
    let cryptoSymbolSet: Set<string> | null = null;
    try {
      const exRes = await this.apiFetch('/fapi/v1/exchangeInfo', 1);
      const exData = await exRes.json() as {
        symbols?: Array<{
          symbol: string;
          status?: string;
          contractType?: string;
          underlyingType?: string;
          quoteAsset?: string;
        }>;
      };
      if (Array.isArray(exData.symbols)) {
        cryptoSymbolSet = new Set(
          exData.symbols
            .filter(s =>
              s.status === 'TRADING' &&
              s.contractType === 'PERPETUAL' &&
              s.underlyingType === 'COIN' &&
              s.quoteAsset === 'USDT' &&
              !EXCLUDED_NON_CRYPTO_USDT_SYMBOLS.has(s.symbol),
            )
            .map(s => s.symbol),
        );
      }
    } catch (err) {
      console.warn('[BinanceApiClient] Failed to fetch exchangeInfo for crypto filter; falling back to all USDT pairs:', err);
    }

    const response = await this.apiFetch('/fapi/v1/ticker/24hr', 40);
    const tickers = await response.json() as Array<{
      symbol: string;
      quoteVolume: string;
      status?: string;
    }>;

    // Filter active pure-crypto USDT perpetual pairs only, sort by quote volume desc
    const usdtPairs = tickers
      .filter(t => cryptoSymbolSet ? cryptoSymbolSet.has(t.symbol) : (t.symbol.endsWith('USDT') && !EXCLUDED_NON_CRYPTO_USDT_SYMBOLS.has(t.symbol)))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit);

    const symbols = usdtPairs.map(t => toDisplaySymbol(t.symbol));
    console.log(`[BinanceApiClient] Got ${symbols.length} crypto symbols. Top 5: ${symbols.slice(0, 5).join(', ')}`);
    return symbols;
  }

  async getRecentCloses(symbol: string, interval: BinanceInterval, limit: number): Promise<number[]> {
    const candles = await this.getKlines(symbol, interval, limit);
    return candles.map(candle => candle.close);
  }

  async getKlines(symbol: string, interval: BinanceInterval, limit: number): Promise<BinanceKlineCandle[]> {
    const apiSymbol = toApiSymbol(symbol);
    const weight = limit < 100 ? 1 : limit < 500 ? 2 : 5;
    const response = await this.apiFetch(
      `/fapi/v1/klines?symbol=${apiSymbol}&interval=${interval}&limit=${limit}`,
      weight,
    );
    // Kline response: array of arrays, index 4 = close price
    const klines = await response.json() as Array<[
      number, string, string, string, string, string, number, string, number, string, string, string
    ]>;

    return klines.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  subscribePrices(symbols: string[], onUpdate: (update: PriceUpdate) => void): () => void {
    if (symbols.length === 0) return () => {};

    let ws: WebSocket | null = null;
    let destroyed = false;
    let reconnectDelay = 5_000;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pingTimer: NodeJS.Timeout | null = null;
    let lastActivityAt = Date.now();

    const symbolSet = new Set(symbols);

    const connect = () => {
      if (destroyed) return;

      const allTickerStream = useAllTickerStream();
      const streams = allTickerStream ? '!miniTicker@arr' : symbols.map(toStreamName).join('/');
      const url = `${getWsBase()}?streams=${streams}`;

      const wsOptions: WebSocket.ClientOptions = {};
      const agent = getProxyAgent();
      if (agent) {
        wsOptions.agent = agent as never;
      }

      ws = new WebSocket(url, wsOptions);

      ws.on('open', () => {
        const mode = allTickerStream
          ? `all-market miniTicker stream, filtered to ${symbols.length} symbols`
          : `${symbols.length} symbol streams`;
        console.log(`[BinanceApiClient] WebSocket connected (${mode})`);
        reconnectDelay = 5_000; // reset backoff
        lastActivityAt = Date.now();

        // Ping every 30s and terminate half-open connections silent for >60s
        pingTimer = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastActivityAt > WS_STALE_TIMEOUT_MS) {
            console.warn(`[BinanceApiClient] WebSocket silent for >${WS_STALE_TIMEOUT_MS / 1000}s; forcing reconnect`);
            ws.terminate();
            return;
          }
          ws.ping();
        }, 30_000);
      });

      ws.on('pong', () => {
        lastActivityAt = Date.now();
      });

      ws.on('message', (raw: WebSocket.RawData) => {
        lastActivityAt = Date.now();
        try {
          const msg = JSON.parse(raw.toString()) as {
            stream: string;
            data:
              | Array<{
                  e: string;
                  s: string;
                  c: string;
                  o: string;
                  h: string;
                  l: string;
                  v: string;
                  q: string;
                }>
              | {
              e: string;
              s: string;
              c: string; // close price
              o: string; // open price
              h: string;
              l: string;
              v: string;
              q: string; // quote volume
            };
          };

          const updates = Array.isArray(msg.data) ? msg.data : [msg.data];
          for (const item of updates) {
            if (item?.e === '24hrMiniTicker') {
              const displaySymbol = toDisplaySymbol(item.s);
              if (!symbolSet.has(displaySymbol)) continue;

              const closePrice = parseFloat(item.c);
              const openPrice = parseFloat(item.o);

              // Calculate 24h change percent
              const change24h = openPrice > 0
                ? ((closePrice - openPrice) / openPrice) * 100
                : 0;

              onUpdate({
                symbol: displaySymbol,
                price: closePrice,
                change_24h: roundPercent(change24h),
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('close', (code, reason) => {
        console.warn(`[BinanceApiClient] WebSocket closed: ${code} ${reason?.toString() ?? ''}`);
        cleanup();
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        console.error(`[BinanceApiClient] WebSocket error: ${err.message}`);
        ws?.close();
      });
    };

    const cleanup = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (destroyed) return;
      console.log(`[BinanceApiClient] Reconnecting in ${reconnectDelay / 1000}s...`);
      reconnectTimer = setTimeout(() => {
        connect();
        reconnectDelay = Math.min(reconnectDelay * 1.5, 60_000); // exponential backoff, max 60s
      }, reconnectDelay);
    };

    // Start connection
    connect();

    // Return unsubscribe function
    return () => {
      destroyed = true;
      cleanup();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
      }
      console.log('[BinanceApiClient] WebSocket unsubscribed');
    };
  }
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

function useAllTickerStream(): boolean {
  return process.env.BINANCE_USE_ALL_TICKER_STREAM !== 'false';
}

function getFapiBase(): string {
  return process.env.BINANCE_FAPI_BASE || DEFAULT_FAPI_BASE;
}

function getWsBase(): string {
  return process.env.BINANCE_WS_BASE || DEFAULT_WS_BASE;
}
