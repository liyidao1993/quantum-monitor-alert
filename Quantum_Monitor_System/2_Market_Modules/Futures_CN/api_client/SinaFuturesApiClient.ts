import type { CnFuturesCandle, CnFuturesInterval, CnFuturesQuote, IFuturesCnApiClient } from './IFuturesCnApiClient.js';

const DEFAULT_SINA_MIN_LINE_URL = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine';
const DEFAULT_SINA_QUOTE_URL = 'https://hq.sinajs.cn/list=';
const DEFAULT_SINA_DAILY_LINE_URL = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var';
const REQUEST_TIMEOUT_MS = 10_000;

interface SinaMinLineItem {
  d?: string;
  o?: string;
  h?: string;
  l?: string;
  c?: string;
  v?: string;
}

export class SinaFuturesApiClient implements IFuturesCnApiClient {
  async getKlines(symbol: string, interval: CnFuturesInterval, limit: number): Promise<CnFuturesCandle[]> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return [];

    if (interval === '1d') {
      return this.getDailyKlines(normalized, limit);
    }

    const type = interval === '1m' ? '1' : '15';
    const url = `${getSinaMinLineUrl()}?symbol=${encodeURIComponent(normalized)}&type=${type}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`[SinaFuturesApiClient] HTTP ${response.status} for ${normalized}`);
    }

    const text = await response.text();
    const items = parseSinaJsonp(text);

    return items
      .map(toCandle)
      .filter((item): item is CnFuturesCandle => item !== null)
      .slice(-limit);
  }

  private async getDailyKlines(symbol: string, limit: number): Promise<CnFuturesCandle[]> {
    const callback = `_${symbol}`;
    const url = `${getSinaDailyLineUrl()}%20${callback}=/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(symbol)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`[SinaFuturesApiClient] daily HTTP ${response.status} for ${symbol}`);
    }

    const text = await response.text();
    const items = parseSinaJsonp(text);

    return items
      .map(toCandle)
      .filter((item): item is CnFuturesCandle => item !== null)
      .slice(-limit);
  }

  async getQuote(symbol: string): Promise<CnFuturesQuote | null> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return null;

    const quoteSymbol = `nf_${normalized}`;
    const response = await fetch(`${getSinaQuoteUrl()}${encodeURIComponent(quoteSymbol)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`[SinaFuturesApiClient] quote HTTP ${response.status} for ${normalized}`);
    }

    const text = await responseText(response, 'gb18030');
    return parseSinaQuote(text, normalized);
  }
}

function getSinaMinLineUrl(): string {
  return process.env.SINA_MIN_LINE_URL || DEFAULT_SINA_MIN_LINE_URL;
}

function getSinaQuoteUrl(): string {
  return process.env.SINA_QUOTE_URL || DEFAULT_SINA_QUOTE_URL;
}

function getSinaDailyLineUrl(): string {
  return process.env.SINA_DAILY_LINE_URL || DEFAULT_SINA_DAILY_LINE_URL;
}

function parseSinaJsonp(text: string): SinaMinLineItem[] {
  const match = text.match(/var\((.*)\);?$/s) ?? text.match(/\((\[.*\])\)/s) ?? text.match(/=\s*(\[.*\]);?$/s);
  if (!match?.[1]) return [];

  const parsed = JSON.parse(match[1]) as unknown;
  return Array.isArray(parsed) ? parsed as SinaMinLineItem[] : [];
}

function toCandle(item: SinaMinLineItem): CnFuturesCandle | null {
  const open = Number(item.o);
  const high = Number(item.h);
  const low = Number(item.l);
  const close = Number(item.c);
  if (!item.d || [open, high, low, close].some(Number.isNaN)) return null;

  const volume = item.v === undefined ? undefined : Number(item.v);
  return {
    time: item.d,
    open,
    high,
    low,
    close,
    volume: volume !== undefined && !Number.isNaN(volume) ? volume : undefined,
  };
}

function parseSinaQuote(text: string, symbol: string): CnFuturesQuote | null {
  const match = text.match(/="(.*)";?\s*$/s);
  const raw = match?.[1] ?? '';
  if (!raw) return null;

  const fields = raw.split(',');
  if (fields.length < 10) return null;

  if (fields[0] && Number.isNaN(Number(fields[0]))) {
    return parseCommodityQuote(fields, symbol);
  }

  return parseFinancialQuote(fields, symbol);
}

function parseCommodityQuote(fields: string[], symbol: string): CnFuturesQuote | null {
  const price = Number(fields[5]);
  if (Number.isNaN(price)) return null;

  return {
    symbol,
    name: fields[0] || undefined,
    time: normalizeQuoteTime(fields[1]),
    open: optionalNumber(fields[2]),
    high: optionalNumber(fields[3]),
    low: optionalNumber(fields[4]),
    price,
    previousClose: optionalNumber(fields[10]),
    volume: optionalNumber(fields[13]),
    openInterest: optionalNumber(fields[14]),
    exchange: fields[15] || undefined,
    date: fields[17] || undefined,
  };
}

function parseFinancialQuote(fields: string[], symbol: string): CnFuturesQuote | null {
  const price = Number(fields[3]);
  if (Number.isNaN(price)) return null;

  return {
    symbol,
    name: fields.at(-1) || undefined,
    open: optionalNumber(fields[0]),
    high: optionalNumber(fields[1]),
    low: optionalNumber(fields[2]),
    price,
    volume: optionalNumber(fields[4]),
    openInterest: optionalNumber(fields[6]),
    previousClose: optionalNumber(fields[25]),
    date: fields[36] || undefined,
    time: fields[37] || undefined,
  };
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeQuoteTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.padStart(6, '0');
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

async function responseText(response: Response, encoding: string): Promise<string> {
  const buffer = await response.arrayBuffer();
  return new TextDecoder(encoding).decode(buffer);
}
