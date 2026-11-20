import type { MacroNewsItem, NewsSettings } from '../../4_Shared_Types/standard_models/marketTypes.js';

export interface NewsAnalyzerResult {
  items: MacroNewsItem[];
  status: {
    enabled: boolean;
    provider: 'none' | 'google' | 'openai_compatible' | 'rules';
    status: 'ready' | 'fallback' | 'disabled' | 'error';
    message?: string;
  };
}

type Direction = NonNullable<MacroNewsItem['impact_direction']>;

interface AiNewsPayload {
  id: string;
  ai_summary?: string;
  impact_assets?: string[];
  impact_direction?: Direction;
  impact_reason?: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const ANALYSIS_LIMIT = 12;

export class NewsAnalyzer {
  async analyze(items: MacroNewsItem[], settings: NewsSettings): Promise<NewsAnalyzerResult> {
    const ruleAnalyzed = items.map(analyzeWithRules);
    if (!settings.ai_analysis_enabled) {
      return {
        items: ruleAnalyzed,
        status: { enabled: false, provider: 'none', status: 'disabled', message: 'AI analysis is disabled' },
      };
    }

    const configuredKey = settings.ai_api_key.trim();
    const configuredBase = settings.ai_api_base.trim();
    if (settings.ai_provider === 'openai_compatible' && configuredBase && configuredKey) {
      try {
        const aiItems = await analyzeWithOpenAiCompatible(ruleAnalyzed, configuredBase, configuredKey, settings.ai_model || DEFAULT_MODEL);
        const byId = new Map(aiItems.map((item) => [item.id, item]));
        return {
          items: ruleAnalyzed.map((item) => ({ ...item, ...(byId.get(item.id) ?? {}) })),
          status: { enabled: true, provider: 'openai_compatible', status: 'ready', message: normalizedBaseMessage(configuredBase, settings.ai_model) },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          items: ruleAnalyzed,
          status: { enabled: true, provider: 'rules', status: 'error', message: message.slice(0, 160) },
        };
      }
    }

    const apiKey = configuredKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey || settings.ai_provider !== 'google') {
      return {
        items: ruleAnalyzed,
        status: {
          enabled: true,
          provider: 'rules',
          status: 'fallback',
          message: apiKey ? 'AI provider is disabled; using rule analysis' : 'Missing API key; using rule analysis',
        },
      };
    }

    try {
      const aiItems = await analyzeWithGoogle(ruleAnalyzed, apiKey, settings.ai_model || DEFAULT_MODEL);
      const byId = new Map(aiItems.map((item) => [item.id, item]));
      return {
        items: ruleAnalyzed.map((item) => ({ ...item, ...(byId.get(item.id) ?? {}) })),
        status: { enabled: true, provider: 'google', status: 'ready', message: settings.ai_model || DEFAULT_MODEL },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        items: ruleAnalyzed,
        status: { enabled: true, provider: 'rules', status: 'error', message: message.slice(0, 160) },
      };
    }
  }
}

async function analyzeWithOpenAiCompatible(items: MacroNewsItem[], baseUrl: string, apiKey: string, model: string): Promise<AiNewsPayload[]> {
  const targets = [...items]
    .sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0))
    .slice(0, ANALYSIS_LIMIT);
  if (targets.length === 0) return [];

  const endpoint = normalizeChatCompletionsUrl(baseUrl);
  let response = await requestOpenAiCompatible(endpoint, apiKey, model, targets, true);
  let raw = await response.text();
  if (!response.ok && shouldRetryWithoutResponseFormat(response.status, raw)) {
    response = await requestOpenAiCompatible(endpoint, apiKey, model, targets, false);
    raw = await response.text();
  }

  if (!response.ok) {
    throw new Error(`AI gateway HTTP ${response.status}: ${raw.slice(0, 180)}`);
  }
  const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(content)) as { items?: AiNewsPayload[] } | AiNewsPayload[];
  const payload = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  return payload.filter((item) => typeof item.id === 'string');
}

function requestOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  targets: MacroNewsItem[],
  includeResponseFormat: boolean,
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: '你是金融市场新闻分析器。只返回 JSON。' },
        { role: 'user', content: buildPrompt(targets) },
      ],
    }),
  });
}

function shouldRetryWithoutResponseFormat(status: number, body: string): boolean {
  return status === 400 || /response_format|json_object|unsupported|invalid/i.test(body);
}

function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function normalizedBaseMessage(baseUrl: string, model: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.host} / ${model || DEFAULT_MODEL}`;
  } catch {
    return model || DEFAULT_MODEL;
  }
}

function analyzeWithRules(item: MacroNewsItem): MacroNewsItem {
  const text = `${item.title} ${item.original_title ?? ''} ${item.summary ?? ''}`;
  const impactAssets = inferImpactAssets(text, item.tags);
  const direction = inferDirection(text);
  const score = scoreImportance(item, impactAssets, direction);
  return {
    ...item,
    impact_assets: item.impact_assets?.length ? item.impact_assets : impactAssets,
    impact_direction: item.impact_direction ?? direction,
    impact_reason: item.impact_reason ?? buildImpactReason(impactAssets, direction, item.tags),
    importance_score: item.importance_score ?? score,
    ai_summary: item.ai_summary ?? buildRuleSummary(item),
  };
}

function inferImpactAssets(text: string, tags: string[]): string[] {
  const source = text.toLowerCase();
  const assets = new Set<string>();
  if (tags.includes('宏观') || /fed|fomc|powell|cpi|pce|inflation|rate|treasury|yield|美元|美联储|通胀|利率|降息|加息|非农/i.test(source)) {
    assets.add('美元指数');
    assets.add('美债收益率');
    assets.add('美股指数');
  }
  if (tags.includes('商品') || /oil|crude|brent|wti|opec|gold|silver|copper|原油|黄金|白银|铜|商品/i.test(source)) {
    assets.add(/gold|黄金/i.test(source) ? '黄金' : '原油');
    assets.add('商品期货');
  }
  if (tags.includes('加密') || /bitcoin|btc|ethereum|eth|crypto|stablecoin|binance|比特币|以太坊|加密|稳定币/i.test(source)) {
    assets.add('BTC/ETH');
    assets.add('加密合约');
  }
  if (tags.includes('股市') || /stock|stocks|nasdaq|s&p|dow|earnings|shares|equity|美股|A股|港股|财报|纳指|标普|道指/i.test(source)) {
    assets.add('美股');
  }
  if (/china|yuan|a股|中国|人民币|地产|消费|央行|a-share/i.test(source)) {
    assets.add('A股');
    assets.add('人民币');
  }
  return [...assets].slice(0, 5);
}

function inferDirection(text: string): Direction {
  const source = text.toLowerCase();
  const bearish = /plunge|crash|selloff|slump|war|sanction|higher rates|hot inflation|misses|cuts guidance|暴跌|急跌|冲突|制裁|通胀升温|高利率|下调指引/i.test(source);
  const bullish = /surge|soar|rally|record high|rate cut|cooling inflation|beats|upgrade|stimulus|大涨|飙升|新高|降息|刺激|超预期|上调评级/i.test(source);
  if (bullish && bearish) return 'mixed';
  if (bearish) return 'bearish';
  if (bullish) return 'bullish';
  return 'neutral';
}

function scoreImportance(item: MacroNewsItem, assets: string[], direction: Direction): number {
  const ageHours = Math.max(0, (Date.now() - Date.parse(item.published_at)) / 3_600_000);
  let score = 100 - Math.min(ageHours, 72);
  score += assets.length * 7;
  if (item.importance === 'key') score += 28;
  if (item.importance === 'breaking') score += 12;
  if (direction === 'bearish' || direction === 'bullish') score += 8;
  if (item.tags.includes('宏观')) score += 18;
  if (item.tags.includes('商品')) score += 12;
  return Math.max(0, Math.round(score));
}

function buildRuleSummary(item: MacroNewsItem): string {
  const summary = item.summary || item.title;
  return summary.length > 72 ? `${summary.slice(0, 72)}...` : summary;
}

function buildImpactReason(assets: string[], direction: Direction, tags: string[]): string {
  if (assets.length === 0) return '未识别到明确资产映射，按一般市场新闻处理。';
  const directionText: Record<Direction, string> = {
    bullish: '偏利多',
    bearish: '偏利空',
    mixed: '多空交织',
    neutral: '方向中性',
  };
  return `${tags.slice(0, 2).join('/')}事件，对${assets.slice(0, 3).join('、')}影响${directionText[direction]}。`;
}

async function analyzeWithGoogle(items: MacroNewsItem[], apiKey: string, model: string): Promise<AiNewsPayload[]> {
  const targets = [...items]
    .sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0))
    .slice(0, ANALYSIS_LIMIT);
  if (targets.length === 0) return [];

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [{ text: buildPrompt(targets) }],
    }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });
  const text = response.text ?? '';
  const parsed = JSON.parse(stripJsonFence(text)) as { items?: AiNewsPayload[] } | AiNewsPayload[];
  const payload = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  return payload.filter((item) => typeof item.id === 'string');
}

function buildPrompt(items: MacroNewsItem[]): string {
  return `你是金融市场新闻分析器。请只返回 JSON，格式为 {"items":[{"id":"...","ai_summary":"不超过40字中文摘要","impact_assets":["资产1"],"impact_direction":"bullish|bearish|mixed|neutral","impact_reason":"不超过50字中文理由"}]}。
分析这些新闻对股票、商品、加密、美元、利率、A股的短线影响：
${items.map((item) => `- id=${item.id}\n  title=${item.title}\n  summary=${item.summary ?? ''}\n  tags=${item.tags.join('/')}`).join('\n')}`;
}

function stripJsonFence(value: string): string {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}
