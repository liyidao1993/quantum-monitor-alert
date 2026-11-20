import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { NewsAnalyzer, type NewsAnalyzerResult } from './NewsAnalyzer.js';
import type { MacroNewsItem, MacroNewsSummary, NewsSettings, NewsSourceSettings } from '../../4_Shared_Types/standard_models/marketTypes.js';

interface NewsCacheFile {
  updated_at: string;
  items: MacroNewsItem[];
  analyzer?: NewsAnalyzerResult['status'];
  errors: Array<{ source: string; message: string }>;
}

interface RawFeedItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  description?: unknown;
  summary?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
}

interface TonghuashunNewsItem {
  id?: unknown;
  seq?: unknown;
  title?: unknown;
  digest?: unknown;
  short?: unknown;
  url?: unknown;
  ctime?: unknown;
  rtime?: unknown;
  tag?: unknown;
  source?: unknown;
}

interface Jin10FlashItem {
  id?: unknown;
  time?: unknown;
  important?: unknown;
  data?: {
    title?: unknown;
    content?: unknown;
    source?: unknown;
    source_link?: unknown;
  };
  tags?: unknown;
}

const PROJECT_RUNTIME_DIR = path.resolve(process.cwd(), '.runtime');
const CACHE_PATH = path.join(PROJECT_RUNTIME_DIR, 'news_cache.json');
const DEFAULT_REFRESH_SECONDS = 60;
const TRANSLATION_LIMIT_PER_REFRESH = 40;

export class NewsAggregator {
  private memory: NewsCacheFile | null = null;
  private refreshTask: Promise<MacroNewsSummary> | null = null;
  private readonly analyzer = new NewsAnalyzer();
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: true,
    removeNSPrefix: true,
  });

  async getSummary(settings: NewsSettings, force = false): Promise<MacroNewsSummary> {
    const normalized = normalizeNewsSettings(settings);
    await this.ensureCacheLoaded();

    if (!force && this.memory) {
      if (!isStale(this.memory.updated_at, normalized.breaking_refresh_seconds)) {
        return toSummary(this.memory, normalized);
      }
      if (this.memory.items.length > 0) {
        if (!this.refreshTask) {
          this.refreshTask = this.refresh(normalized).finally(() => {
            this.refreshTask = null;
          });
        }
        return toSummary(this.memory, normalized);
      }
    }

    if (!this.refreshTask) {
      this.refreshTask = this.refresh(normalized).finally(() => {
        this.refreshTask = null;
      });
    }

    return this.refreshTask;
  }

  private async refresh(settings: NewsSettings): Promise<MacroNewsSummary> {
    const enabledSources = settings.sources.filter((source) => source.enabled && source.url);
    const results = await Promise.allSettled(enabledSources.map((source) => this.fetchSource(source)));
    const errors: Array<{ source: string; message: string }> = [];
    const items: MacroNewsItem[] = [];

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const source = enabledSources[index];
      if (result.status === 'fulfilled') {
        items.push(...result.value);
      } else {
        errors.push({ source: source.label || source.id, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      }
    }

    const enabledSourceLabels = new Set(enabledSources.map((source) => source.label || source.id));
    const existingItems = (this.memory?.items ?? []).filter((item) => enabledSourceLabels.has(item.source));
    const merged = mergeNewsItems([...existingItems, ...items], settings.cache_limit);
    const translated = await translateNewsItems(merged, settings);
    const analyzed = await this.analyzer.analyze(translated, settings);
    this.memory = {
      updated_at: new Date().toISOString(),
      items: analyzed.items,
      analyzer: analyzed.status,
      errors,
    };
    await this.persistCache(this.memory);
    return toSummary(this.memory, settings);
  }

  private async fetchSource(source: NewsSourceSettings): Promise<MacroNewsItem[]> {
    if (source.id === 'tonghuashun_7x24' || source.url.includes('10jqka.com.cn/tapp/news/push')) {
      return this.fetchTonghuashunSource(source);
    }
    if (source.id.startsWith('jin10_') || source.url.includes('flash-api.jin10.com/get_flash_list')) {
      return this.fetchJin10Source(source);
    }

    const response = await fetchText(source.url, 10_000);
    const feed = this.parser.parse(response);
    const rawItems = extractFeedItems(feed);
    const fetchedAt = new Date().toISOString();

    return rawItems.map((item) => {
      const title = cleanText(readText(item.title));
      const url = normalizeLink(item.link) || normalizeLink(item.guid) || source.url;
      const publishedAt = normalizeDate(readText(item.pubDate) || readText(item.published) || readText(item.updated)) ?? fetchedAt;
      const summary = cleanText(readText(item.description) || readText(item.summary)).slice(0, 220);
      const tags = classifyTags(`${title} ${summary}`);

      return {
        id: stableNewsId(source.id, url, title),
        title,
        source: source.label || source.id,
        url,
        summary: summary || undefined,
        published_at: publishedAt,
        fetched_at: fetchedAt,
        tags,
        importance: classifyImportance(title, tags, publishedAt),
      };
    }).filter((item) => item.title && item.url && isMarketRelevant(item));
  }

  private async fetchTonghuashunSource(source: NewsSourceSettings): Promise<MacroNewsItem[]> {
    const response = await fetchText(source.url, 10_000);
    const payload = JSON.parse(response) as { data?: { list?: TonghuashunNewsItem[] } };
    const fetchedAt = new Date().toISOString();
    const rawItems = Array.isArray(payload.data?.list) ? payload.data.list : [];

    return rawItems.map((item) => {
      const title = cleanText(readText(item.title));
      const summary = cleanText(readText(item.digest) || readText(item.short)).slice(0, 220);
      const url = normalizeLink(item.url) || source.url;
      const timestamp = Number(readText(item.rtime) || readText(item.ctime));
      const publishedAt = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : fetchedAt;
      const tags = classifyDomesticTags(`${title} ${summary} ${readText(item.tag)}`);

      return {
        id: stableNewsId(source.id, url, title),
        title,
        source: source.label || source.id,
        url,
        summary: summary || undefined,
        published_at: publishedAt,
        fetched_at: fetchedAt,
        tags,
        importance: classifyImportance(title, tags, publishedAt),
      };
    }).filter((item) => item.title && item.url);
  }

  private async fetchJin10Source(source: NewsSourceSettings): Promise<MacroNewsItem[]> {
    const response = await fetchText(source.url, 10_000, {
      'x-app-id': 'bVBF4FyRTn5NJF5n',
      'x-version': '1.0.0',
      Referer: 'https://www.jin10.com/',
    });
    const payload = JSON.parse(response) as { data?: Jin10FlashItem[] };
    const fetchedAt = new Date().toISOString();
    const onlyImportant = source.id.includes('important');
    const rawItems = Array.isArray(payload.data) ? payload.data : [];

    return rawItems
      .filter((item) => !onlyImportant || Number(item.important) === 1)
      .map((item) => {
        const title = cleanText(readText(item.data?.title) || readText(item.data?.content));
        const summary = cleanText(readText(item.data?.content)).slice(0, 220);
        const sourceLink = normalizeLink(item.data?.source_link);
        const url = sourceLink || 'https://www.jin10.com/';
        const publishedAt = normalizeJin10Time(readText(item.time)) ?? fetchedAt;
        const tags = classifyDomesticTags(`${title} ${summary} ${readText(item.data?.source)} ${JSON.stringify(item.tags ?? '')}`);

        return {
          id: stableNewsId(source.id, url, `${readText(item.id)}:${title}`),
          title,
          source: source.label || source.id,
          url,
          summary: summary && summary !== title ? summary : undefined,
          published_at: publishedAt,
          fetched_at: fetchedAt,
          tags,
          importance: Number(item.important) === 1 ? 'key' : classifyImportance(title, tags, publishedAt),
        };
      })
      .filter((item) => item.title && item.url);
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.memory) return;
    try {
      const raw = await readFile(CACHE_PATH, 'utf8');
      this.memory = JSON.parse(raw) as NewsCacheFile;
    } catch {
      this.memory = {
        updated_at: new Date(0).toISOString(),
        items: [],
        analyzer: { enabled: false, provider: 'none', status: 'disabled', message: 'No cache loaded yet' },
        errors: [],
      };
    }
  }

  private async persistCache(cache: NewsCacheFile): Promise<void> {
    await mkdir(PROJECT_RUNTIME_DIR, { recursive: true });
    await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }
}

export function defaultNewsSettings(): NewsSettings {
  return {
    enabled: true,
    key_refresh_seconds: 900,
    breaking_refresh_seconds: DEFAULT_REFRESH_SECONDS,
    cache_limit: 120,
    translate_english: true,
    translation_provider: 'mymemory',
    translation_api_url: 'https://api.mymemory.translated.net/get',
    ai_analysis_enabled: true,
    ai_provider: 'openai_compatible',
    ai_api_base: '',
    ai_api_key: '',
    ai_model: 'gpt-4o-mini',
    sources: [
      { id: 'investing_cn_macro', label: '英为财情宏观', url: 'https://cn.investing.com/rss/news_14.rss', enabled: true },
      { id: 'investing_cn_futures', label: '英为财情期货', url: 'https://cn.investing.com/rss/news_11.rss', enabled: true },
      { id: 'investing_cn_stocks', label: '英为财情股票', url: 'https://cn.investing.com/rss/news_25.rss', enabled: true },
      { id: 'investing_cn_crypto', label: '英为财情加密', url: 'https://cn.investing.com/rss/news_301.rss', enabled: true },
      { id: 'investing_cn_market_overview', label: '英为财情市场概况', url: 'https://cn.investing.com/rss/market_overview.rss', enabled: true },
      { id: 'sina_us_stock', label: '新浪财经美股', url: 'https://rss.sina.com.cn/finance/usstock.xml', enabled: true },
      { id: 'tonghuashun_7x24', label: '同花顺7x24', url: 'https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=50', enabled: true },
      { id: 'jin10_important', label: '金十重要快讯', url: 'https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1', enabled: true },
      { id: 'jin10_market', label: '金十市场快讯', url: 'https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1', enabled: true },
      { id: 'cnbc_top', label: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', enabled: true },
      { id: 'marketwatch_realtime', label: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/realtimeheadlines/', enabled: true },
      { id: 'nasdaq_markets', label: 'Nasdaq', url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets', enabled: true },
      { id: 'yahoo_finance', label: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', enabled: true },
      { id: 'coindesk', label: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', enabled: true },
      { id: 'cointelegraph', label: 'Cointelegraph', url: 'https://cointelegraph.com/rss', enabled: true },
    ],
  };
}

export function normalizeNewsSettings(settings: NewsSettings | undefined): NewsSettings {
  const defaults = defaultNewsSettings();
  if (!settings) return defaults;
  return {
    enabled: settings.enabled ?? defaults.enabled,
    key_refresh_seconds: Math.max(60, Number(settings.key_refresh_seconds) || defaults.key_refresh_seconds),
    breaking_refresh_seconds: Math.max(30, Number(settings.breaking_refresh_seconds) || defaults.breaking_refresh_seconds),
    cache_limit: Math.max(20, Number(settings.cache_limit) || defaults.cache_limit),
    translate_english: settings.translate_english ?? defaults.translate_english,
    translation_provider: settings.translation_provider === 'none' || settings.translation_provider === 'mymemory' ? settings.translation_provider : defaults.translation_provider,
    translation_api_url: typeof settings.translation_api_url === 'string' && settings.translation_api_url ? settings.translation_api_url : defaults.translation_api_url,
    ai_analysis_enabled: settings.ai_analysis_enabled ?? defaults.ai_analysis_enabled,
    ai_provider: settings.ai_provider === 'none' || settings.ai_provider === 'google' || settings.ai_provider === 'openai_compatible' ? settings.ai_provider : defaults.ai_provider,
    ai_api_base: typeof settings.ai_api_base === 'string' ? settings.ai_api_base : defaults.ai_api_base,
    ai_api_key: typeof settings.ai_api_key === 'string' ? settings.ai_api_key : defaults.ai_api_key,
    ai_model: typeof settings.ai_model === 'string' && settings.ai_model ? settings.ai_model : defaults.ai_model,
    sources: mergeDefaultSources(Array.isArray(settings.sources) && settings.sources.length > 0 ? settings.sources : [], defaults.sources),
  };
}

function mergeDefaultSources(sources: NewsSourceSettings[], defaults: NewsSourceSettings[]): NewsSourceSettings[] {
  const byId = new Map<string, NewsSourceSettings>();
  for (const source of sources) {
    byId.set(source.id, source);
  }
  for (const source of defaults) {
    if (!byId.has(source.id)) byId.set(source.id, source);
  }
  return [...byId.values()];
}

function toSummary(cache: NewsCacheFile, settings: NewsSettings): MacroNewsSummary {
  const items = mergeNewsItems(cache.items, settings.cache_limit);
  const keyCandidates = items
    .filter((item) => item.importance === 'key')
    .filter((item) => !isLowSignalNews(item))
    .filter((item) => newsPriorityScore(item) >= 115)
    .sort((a, b) => newsFreshPriorityScore(b) - newsFreshPriorityScore(a));
  const breakingCandidates = items
    .filter((item) => item.importance !== 'key')
    .sort((a, b) => breakingPriorityScore(b) - breakingPriorityScore(a));
  const aiHighlights = items
    .filter((item) => !isLowSignalNews(item))
    .filter((item) => newsPriorityScore(item) >= 105 || item.importance === 'breaking')
    .sort((a, b) => newsDisplayPriorityScore(b) - newsDisplayPriorityScore(a));

  return {
    key: diversifyBySource(keyCandidates, 6, 2),
    breaking: diversifyBySource(breakingCandidates, 10, 3),
    ai_highlights: diversifyBySource(aiHighlights, 5, 2),
    analyzer: cache.analyzer ?? {
      enabled: settings.ai_analysis_enabled,
      provider: settings.ai_analysis_enabled ? 'rules' : 'none',
      status: settings.ai_analysis_enabled ? 'fallback' : 'disabled',
    },
    updated_at: cache.updated_at,
    source_count: settings.sources.filter((source) => source.enabled).length,
    errors: cache.errors,
  };
}

function extractFeedItems(feed: unknown): RawFeedItem[] {
  if (!isRecord(feed)) return [];
  const rss = feed.rss;
  if (isRecord(rss) && isRecord(rss.channel)) {
    return asArray(rss.channel.item) as RawFeedItem[];
  }
  const atomFeed = feed.feed;
  if (isRecord(atomFeed)) {
    return asArray(atomFeed.entry) as RawFeedItem[];
  }
  return [];
}

function mergeNewsItems(items: MacroNewsItem[], limit: number): MacroNewsItem[] {
  const deduped = new Map<string, MacroNewsItem>();
  for (const item of items.map(normalizeNewsItem).filter(isMarketRelevant)) {
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  }
  return [...deduped.values()]
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, limit);
}

function normalizeNewsItem(item: MacroNewsItem): MacroNewsItem {
  const computedTags = classifyTags(`${item.title} ${item.original_title ?? ''} ${item.summary ?? ''}`);
  const tags = item.tags.some((tag) => tag !== '综合' && tag !== '缁煎悎') ? item.tags : computedTags;
  return {
    ...item,
    tags,
    importance: classifyImportance(`${item.title} ${item.original_title ?? ''}`, tags, item.published_at),
  };
}

async function translateNewsItems(items: MacroNewsItem[], settings: NewsSettings): Promise<MacroNewsItem[]> {
  if (!settings.translate_english || settings.translation_provider === 'none') return items;

  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => shouldTranslate(item))
    .sort((a, b) => newsPriorityScore(b.item) - newsPriorityScore(a.item))
    .slice(0, TRANSLATION_LIMIT_PER_REFRESH);
  const translatedItems = new Map<number, MacroNewsItem>();
  await Promise.all(targets.map(async ({ item, index }) => {
    try {
      const translatedTitle = await translateText(item.original_title ?? item.title, settings);
      translatedItems.set(index, {
        ...item,
        title: translatedTitle || item.title,
        original_title: item.original_title ?? item.title,
        original_language: 'en',
      });
    } catch {
      // Keep the original title if a free translation endpoint is slow or unavailable.
    }
  }));

  return items.map((item, index) => translatedItems.get(index) ?? item);
}

function shouldTranslate(item: MacroNewsItem): boolean {
  if (item.original_language === 'en' && item.original_title) return false;
  if (hasCjk(item.title)) return false;
  return /[a-zA-Z]{5,}/.test(item.title);
}

async function translateText(text: string, settings: NewsSettings): Promise<string> {
  if (settings.translation_provider !== 'mymemory') return text;
  const baseUrl = settings.translation_api_url || 'https://api.mymemory.translated.net/get';
  const url = `${baseUrl}?q=${encodeURIComponent(text.slice(0, 450))}&langpair=en%7Czh-CN`;
  let raw: string;
  try {
    raw = await fetchText(url, 5_000);
  } catch (err) {
    if (!baseUrl.includes('mymemory.translated.net')) throw err;
    raw = await fetchTextDirect(url, 5_000);
  }
  const json = JSON.parse(raw) as { responseData?: { translatedText?: string } };
  return cleanText(json.responseData?.translatedText ?? text);
}

function classifyTags(text: string): string[] {
  const source = text.toLowerCase();
  const tags: string[] = [];
  if (/\b(fed|fomc|powell|rate|rates|inflation|cpi|pce|treasury|treasuries|bond|bonds|jobs|payrolls|gdp)\b|美联储|鲍威尔|利率|通胀|降息|加息|央行|国债|收益率|非农|宏观/i.test(source)) tags.push('宏观');
  if (/\b(oil|crude|brent|wti|gold|silver|copper|commodity|commodities|hormuz|opec)\b|原油|黄金|白银|铜|商品|期货|布伦特|欧佩克|霍尔木兹/i.test(source)) tags.push('商品');
  if (/\b(bitcoin|btc|crypto|ethereum|eth|binance|stablecoin|xrp|solana|spot bitcoin etf|crypto etf)\b|比特币|以太坊|加密|数字货币|币安|稳定币|瑞波|比特币etf|加密etf/i.test(source)) tags.push('加密');
  if (/\b(stock|stocks|nasdaq|s&p|dow|earnings|shares|equity|market|markets|ipo|analyst|upgrade|downgrade)\b|股票|股市|美股|a股|港股|纳指|标普|道指|财报|盈利|营收|上市|评级|市场/i.test(source)) tags.push('股市');
  if (/\b(china|yuan|asia|japan|europe|russia|middle east|argentina)\b|中国|人民币|亚洲|日本|欧洲|俄罗斯|中东|阿根廷/i.test(source)) tags.push('区域');
  return tags.length > 0 ? tags : ['综合'];
}

function classifyDomesticTags(text: string): string[] {
  const source = text.toLowerCase();
  const tags: string[] = [];
  if (/美联储|鲍威尔|利率|通胀|降息|加息|央行|国债|收益率|非农|宏观|财政|货币政策|社融|pmi|gdp|cpi/.test(source)) tags.push('宏观');
  if (/原油|黄金|白银|铜|商品|期货|布伦特|欧佩克|霍尔木兹|铁矿|螺纹|焦煤|焦炭/.test(source)) tags.push('商品');
  if (/比特币|以太坊|加密|数字货币|币安|稳定币|瑞波|btc|eth|crypto/.test(source)) tags.push('加密');
  if (/股票|股市|美股|a股|港股|沪指|深成指|创业板|科创板|纳指|标普|道指|财报|盈利|营收|上市|评级|市场/.test(source)) tags.push('股市');
  if (/中国|人民币|亚洲|日本|欧洲|俄罗斯|中东|阿根廷|白俄罗斯|土耳其/.test(source)) tags.push('区域');
  return tags.length > 0 ? tags : ['股市'];
}

function classifyImportance(title: string, tags: string[], publishedAt: string): MacroNewsItem['importance'] {
  const text = title.toLowerCase();
  const ageMs = Date.now() - Date.parse(publishedAt);
  if (/\b(breaking|urgent|alert|surge|plunge|crash|soar|war|sanction|fed|cpi|inflation|hormuz|opec)\b|rate decision|突发|急跌|暴跌|大涨|飙升|战争|制裁|美联储|利率决议|通胀|霍尔木兹|欧佩克/i.test(text)) return 'key';
  if (tags.includes('宏观') || tags.includes('商品')) return 'key';
  return ageMs <= 2 * 60 * 60 * 1000 ? 'breaking' : 'normal';
}

function isMarketRelevant(item: MacroNewsItem): boolean {
  if (item.tags.some((tag) => tag !== '综合')) return true;
  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  return /\b(market|markets|finance|financial|economy|economic|central bank|bank|trading|futures|forex|currency|dollar|earnings|revenue|profit|loss|guidance|shares|stock|bond|yield|crypto|commodity)\b|市场|财经|金融|经济|央行|银行|交易|期货|外汇|货币|美元|财报|营收|利润|亏损|指引|股票|债券|收益率|加密|商品/i.test(text);
}

function newsPriorityScore(item: MacroNewsItem): number {
  if (typeof item.importance_score === 'number') return item.importance_score;
  const ageHours = Math.max(0, (Date.now() - Date.parse(item.published_at)) / 3_600_000);
  let score = 100 - Math.min(ageHours, 72);
  if (item.tags.includes('宏观')) score += 34;
  if (item.tags.includes('商品')) score += 28;
  if (item.tags.includes('加密')) score += 14;
  if (item.tags.includes('股市')) score += 10;
  if (item.original_language === 'en') score -= 4;
  if (/\([A-Z]{1,6}\)|（[A-Z]{1,6}）/.test(`${item.title} ${item.original_title ?? ''}`)) score -= 28;
  if (isLowSignalNews(item)) score -= 70;
  if (/analyst|research calls|penny stock|best day trading|评级|个股|目标价/i.test(`${item.title} ${item.original_title ?? ''}`)) score -= 34;
  if (/fed|fomc|inflation|cpi|pce|opec|hormuz|war|sanction|美联储|通胀|利率|欧佩克|霍尔木兹|制裁/i.test(`${item.title} ${item.original_title ?? ''}`)) score += 42;
  return score;
}

function newsFreshPriorityScore(item: MacroNewsItem): number {
  const ageHours = Math.max(0, (Date.now() - Date.parse(item.published_at)) / 3_600_000);
  return newsPriorityScore(item) - Math.min(ageHours, 24) * 3;
}

function breakingPriorityScore(item: MacroNewsItem): number {
  const ageMinutes = Math.max(0, (Date.now() - Date.parse(item.published_at)) / 60_000);
  const freshness = 240 - Math.min(ageMinutes, 240);
  return freshness + Math.min(newsPriorityScore(item), 160) * 0.35;
}

function newsDisplayPriorityScore(item: MacroNewsItem): number {
  const ageMinutes = Math.max(0, (Date.now() - Date.parse(item.published_at)) / 60_000);
  const freshness = 360 - Math.min(ageMinutes, 360);
  return freshness + Math.min(newsPriorityScore(item), 180) * 0.25;
}

function isLowSignalNews(item: MacroNewsItem): boolean {
  const text = `${item.title} ${item.original_title ?? ''}`.toLowerCase();
  return /should you buy|experts say|warren buffett favorite|notable etf outflow|etf .*outflow|outflow|inflow|options begin trading|penny stock|best .*stocks?|research calls|worth buying|值得购买|专家怎么说|最喜欢|etf流出|期权开始交易|资金外流|大额资金外流|大流出/i.test(text);
}

function diversifyBySource(items: MacroNewsItem[], limit: number, perSourceLimit: number): MacroNewsItem[] {
  const counts = new Map<string, number>();
  const selected: MacroNewsItem[] = [];
  for (const item of items) {
    const count = counts.get(item.source) ?? 0;
    if (count >= perSourceLimit) continue;
    selected.push(item);
    counts.set(item.source, count + 1);
    if (selected.length >= limit) return selected;
  }

  for (const item of items) {
    if (selected.some((selectedItem) => selectedItem.id === item.id)) continue;
    selected.push(item);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function normalizeDate(value: string): string | undefined {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function normalizeJin10Time(value: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const ms = Date.parse(`${normalized}+08:00`);
  if (!Number.isFinite(ms)) return normalizeDate(value);
  return new Date(ms).toISOString();
}

function stableNewsId(sourceId: string, url: string, title: string): string {
  const raw = `${sourceId}:${url || title}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return `${sourceId}:${Math.abs(hash)}`;
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isRecord(value)) {
    if (typeof value['#text'] === 'string') return value['#text'];
    if (typeof value.href === 'string') return value.href;
  }
  return '';
}

function normalizeLink(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    if (typeof value.href === 'string') return value.href;
    if (typeof value['@_href'] === 'string') return value['@_href'];
    if (typeof value['#text'] === 'string') return value['#text'];
  }
  return '';
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStale(updatedAt: string, refreshSeconds: number): boolean {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms > refreshSeconds * 1000;
}

async function fetchText(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const agent = getProxyAgent();
    if (agent) {
      const http = await import('node:https');
      return await new Promise<string>((resolve, reject) => {
        const req = http.get(url, { agent: agent as never, headers: { 'User-Agent': 'QuantumMonitor/3.0', ...headers } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 160)}`));
            } else {
              resolve(body);
            }
          });
          res.on('error', reject);
        });
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error('request timeout'));
        });
        req.on('error', reject);
        req.end();
      });
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'QuantumMonitor/3.0', ...headers },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextDirect(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'QuantumMonitor/3.0' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function getProxyAgent(): Agent | undefined {
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) return new SocksProxyAgent(socksProxy);

  const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpProxy) return new HttpsProxyAgent(httpProxy);

  return undefined;
}
