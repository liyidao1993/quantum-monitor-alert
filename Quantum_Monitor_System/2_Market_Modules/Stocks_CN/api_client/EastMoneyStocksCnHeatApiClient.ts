import type { StocksCnHotRankItem, StocksCnHotStockItem, StocksCnSectorHeatItem } from '../../../4_Shared_Types/standard_models/marketTypes.js';
import type { IStocksCnHeatApiClient } from './IStocksCnHeatApiClient.js';

const EASTMONEY_CLIST = 'https://push2.eastmoney.com/api/qt/clist/get';
const EASTMONEY_ULIST = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const EASTMONEY_HOT_RANK = 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList';
const A_SHARE_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

interface EastMoneyListResponse<T> {
  rc?: number;
  data?: {
    total?: number;
    diff?: T[];
  };
}

interface EastMoneySectorRow {
  f3?: number;
  f12?: string;
  f14?: string;
  f62?: number;
  f104?: number;
  f105?: number;
  f128?: string;
  f140?: string;
  f136?: number;
}

interface EastMoneyStockRow {
  f2?: number;
  f3?: number;
  f6?: number;
  f8?: number;
  f10?: number | string;
  f12?: string;
  f14?: string;
}

interface EastMoneyHotRankRow {
  sc?: string;
  rk?: number;
  rc?: number;
  hisRc?: number;
}

interface EastMoneyHotRankResponse {
  code?: number;
  status?: number;
  data?: EastMoneyHotRankRow[];
}

export class EastMoneyStocksCnHeatApiClient implements IStocksCnHeatApiClient {
  async getSectorHeat(kind: 'industry' | 'concept', limit: number): Promise<StocksCnSectorHeatItem[]> {
    const fs = kind === 'industry' ? 'm:90+t:2' : 'm:90+t:3';
    const json = await eastMoneyRequest<EastMoneySectorRow>({
      fid: 'f3',
      fs,
      fields: 'f12,f14,f3,f62,f128,f136,f140,f104,f105',
      limit,
    });

    return (json.data?.diff ?? [])
      .map((row) => ({
        code: String(row.f12 ?? ''),
        name: String(row.f14 ?? ''),
        kind,
        change_percent: toNumber(row.f3) ?? 0,
        main_net_inflow: toNumber(row.f62),
        rising_count: toNumber(row.f104),
        falling_count: toNumber(row.f105),
        leading_stock: row.f128 ? String(row.f128) : undefined,
        leading_stock_code: row.f140 ? String(row.f140) : undefined,
        leading_change_percent: toNumber(row.f136),
      }))
      .filter((item) => item.code && item.name);
  }

  async getHotStocks(limitPerList: number): Promise<StocksCnHotStockItem[]> {
    const lists = await Promise.all([
      this.getHotStockList('gainers', 'f3', limitPerList),
      this.getHotStockList('amount', 'f6', limitPerList),
      this.getHotStockList('turnover', 'f8', limitPerList),
      this.getHotStockList('volume_ratio', 'f10', limitPerList),
    ]);
    const seen = new Set<string>();
    const merged: StocksCnHotStockItem[] = [];
    for (const item of lists.flat()) {
      const key = `${item.list}:${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }

  async getHotRank(limit: number): Promise<StocksCnHotRankItem[]> {
    const rankResponse = await eastMoneyHotRankRequest(Math.max(1, limit));
    const rankRows = (rankResponse.data ?? [])
      .filter((row) => row.sc && Number.isFinite(row.rk))
      .slice(0, limit);
    if (rankRows.length === 0) return [];

    const secids = rankRows.map((row) => eastMoneySecid(String(row.sc))).filter(Boolean).join(',');
    const quoteRows = await eastMoneyQuoteRequest(secids);
    const quotes = new Map(quoteRows.map((row) => [String(row.f12 ?? ''), row]));

    return rankRows.map((row) => {
      const rawCode = String(row.sc ?? '');
      const code = rawCode.replace(/^(SH|SZ|BJ)/, '');
      const quote = quotes.get(code);
      return {
        rank: Number(row.rk ?? 0),
        code: rawCode,
        name: quote?.f14 ? String(quote.f14) : rawCode,
        price: toNumber(quote?.f2) ?? 0,
        change_percent: toNumber(quote?.f3) ?? 0,
        rank_change: toNumber(row.rc),
        previous_rank: toNumber(row.hisRc),
        source: 'eastmoney' as const,
      };
    });
  }

  private async getHotStockList(list: StocksCnHotStockItem['list'], fid: string, limit: number): Promise<StocksCnHotStockItem[]> {
    const json = await eastMoneyRequest<EastMoneyStockRow>({
      fid,
      fs: A_SHARE_FS,
      fields: 'f12,f14,f2,f3,f6,f8,f10',
      limit,
    });

    return (json.data?.diff ?? [])
      .map((row) => ({
        code: String(row.f12 ?? ''),
        name: String(row.f14 ?? ''),
        price: toNumber(row.f2) ?? 0,
        change_percent: toNumber(row.f3) ?? 0,
        amount: toNumber(row.f6),
        turnover_rate: toNumber(row.f8),
        volume_ratio: toNumber(row.f10),
        list,
      }))
      .filter((item) => item.code && item.name && item.price > 0);
  }
}

async function eastMoneyHotRankRequest(limit: number): Promise<EastMoneyHotRankResponse> {
  const response = await fetch(EASTMONEY_HOT_RANK, {
    method: 'POST',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Referer: 'https://guba.eastmoney.com/rank/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      appId: 'appId01',
      globalId: '786e4c21-70dc-435a-93bb-38',
      marketType: '',
      pageNo: 1,
      pageSize: limit,
    }),
  });
  if (!response.ok) {
    throw new Error(`[EastMoneyStocksCnHeatApiClient] hot rank HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  return await response.json() as EastMoneyHotRankResponse;
}

async function eastMoneyQuoteRequest(secids: string): Promise<EastMoneyStockRow[]> {
  if (!secids) return [];
  const url = new URL(EASTMONEY_ULIST);
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fields', 'f12,f14,f2,f3');
  url.searchParams.set('secids', secids);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) {
    throw new Error(`[EastMoneyStocksCnHeatApiClient] hot rank quote HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  const json = await response.json() as EastMoneyListResponse<EastMoneyStockRow>;
  return json.data?.diff ?? [];
}

function eastMoneySecid(code: string): string {
  if (code.startsWith('SH')) return `1.${code.slice(2)}`;
  if (code.startsWith('SZ')) return `0.${code.slice(2)}`;
  if (code.startsWith('BJ')) return `0.${code.slice(2)}`;
  return code;
}

async function eastMoneyRequest<T>(params: { fid: string; fs: string; fields: string; limit: number }): Promise<EastMoneyListResponse<T>> {
  const url = new URL(EASTMONEY_CLIST);
  url.searchParams.set('pn', '1');
  url.searchParams.set('pz', String(Math.max(1, params.limit)));
  url.searchParams.set('po', '1');
  url.searchParams.set('np', '1');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fid', params.fid);
  url.searchParams.set('fs', params.fs);
  url.searchParams.set('fields', params.fields);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) {
    throw new Error(`[EastMoneyStocksCnHeatApiClient] HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  return await response.json() as EastMoneyListResponse<T>;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
