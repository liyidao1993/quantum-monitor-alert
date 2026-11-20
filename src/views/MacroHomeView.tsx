import {
  AlertTriangle,
  BarChart3,
  Brain,
  CircleDollarSign,
  Newspaper,
  Pause,
  Play,
  Radio,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MacroNewsItem, MacroNewsSummary } from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes";
import type { QuantumAlert, QuantumTick, ModuleRuntime, SSEStatus, StocksCnHeatSnapshot } from "../useQuantumSSE";

interface HomeProps {
  alerts: QuantumAlert[];
  lastDataAt: number;
  moduleStatuses: ModuleRuntime[];
  onControlModule: (market: string, action: "start" | "stop") => void | Promise<void>;
  stocksCnHeat: StocksCnHeatSnapshot | null;
  ticks: QuantumTick[];
}

type RankKey = "change_24h" | "ma60_dev_1m" | "ma60_dev_15m" | "ma60_dev_1d";

interface MarketIndexQuote {
  symbol: string;
  label: string;
  market: string;
  price: number | null;
  changePercent: number | null;
  updated_at: string;
  status?: "ok" | "error";
  error?: string;
}

interface MarketIndexSummary {
  updated_at: string;
  items: MarketIndexQuote[];
}

interface RankingRow {
  label: string;
  key: RankKey;
  mode: "max" | "min" | "abs";
  tick?: QuantumTick;
}

interface MarketRankingGroup {
  market: string;
  label: string;
  rows: RankingRow[];
}

const moduleLabels: Record<string, string> = {
  Crypto_Binance: "币安合约",
  Futures_CN: "国内期货",
  Futures_Global: "外盘期货",
  Stocks_US: "美股",
  Stocks_CN: "国内股票",
  Macro_Home: "宏观首页",
};

const controlledMarkets = ["Crypto_Binance", "Futures_CN", "Stocks_CN", "Futures_Global", "Stocks_US"] as const;

const usSectorEtfs: Record<string, string> = {
  XLK: "科技",
  XLF: "金融",
  XLE: "能源",
  XLV: "医疗",
  XLY: "可选消费",
  XLP: "日常消费",
  XLI: "工业",
  XLB: "原材料",
  XLU: "公用事业",
  XLRE: "房地产",
  XLC: "通信服务",
};

const rankingMarkets = [
  { market: "Crypto_Binance", label: "加密合约" },
  { market: "Futures_CN", label: "国内期货" },
  { market: "Stocks_CN", label: "A股热度" },
  { market: "Futures_Global", label: "外盘期货" },
  { market: "Stocks_US", label: "美股" },
];

export function MacroHomeView({
  alerts,
  lastDataAt,
  moduleStatuses,
  onControlModule,
  stocksCnHeat,
  ticks,
}: HomeProps) {
  const ranked = useMemo(() => buildMarketRankings(ticks), [ticks]);
  const { news, newsState } = useMacroNews();
  const { indices, indexState } = useMarketIndices();
  const marketClock = useDualMarketClock();

  return (
    <div className="home-dashboard">
      <section className="module-control-strip" aria-label="运行模块控制">
        {controlledMarkets.map((market) => {
          const runtime = moduleStatuses.find((item) => item.market === market);
          const status = runtime?.status ?? "unregistered";
          const count = ticks.filter((tick) => tick.market === market).length;
          const isRunning = status === "running" || status === "starting";
          const disabled = status === "starting" || status === "stopping" || status === "unregistered";
          const visualStatus = status;
          const staleCount = ticks.filter((tick) => tick.market === market && !isFreshTick(tick.updated_at)).length;
          const cnHeatCount = market === "Stocks_CN" ? stocksCnHeat?.hot_stocks.length ?? count : count;
          return (
            <article className={`module-control-card ${visualStatus}`} key={market}>
              <div className="module-control-main">
                <span className={`module-light ${visualStatus}`} />
                <div>
                  <strong>{moduleLabels[market]}</strong>
                  <span>{statusLabel(status)} / {cnHeatCount} 品种 / {staleCount} 过期</span>
                </div>
              </div>
              <button
                className={`icon-command ${isRunning ? "danger" : "primary"}`}
                disabled={disabled}
                onClick={() => void onControlModule(market, isRunning ? "stop" : "start")}
                title={isRunning ? `停止${moduleLabels[market]}` : `启动${moduleLabels[market]}`}
                type="button"
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
                <span>{isRunning ? "停止" : "启动"}</span>
              </button>
            </article>
          );
        })}
      </section>

      <section className="home-main-grid">
        <section className="home-hero-grid">
          <Panel className="stock-heat-board" icon={TrendingUp} title="中美板块雷达">
            <StockHeatBoard heat={stocksCnHeat} usSectorRows={ticks.filter((tick) => tick.market === "Stocks_US" && usSectorEtfs[tick.symbol])} />
          </Panel>
          <Panel className="index-board" icon={CircleDollarSign} title="全球指数与宏观锚">
            <div className="index-board-meta">
              <span>{indexState === "ready" ? "指数接口正常" : indexState === "loading" ? "加载中" : "等待指数数据"}</span>
              <DualMarketClock clock={marketClock} />
            </div>
            <GroupedIndexGrid items={indices?.items ?? []} state={indexState} />
          </Panel>
        </section>

        <Panel className="ranking-board" icon={BarChart3} title="跨市场异动矩阵">
          <div className="market-ranking-grid">
            {ranked.map((group) => <MarketRankingCard group={group} key={group.market} />)}
          </div>
        </Panel>
      </section>

      <section className="home-bottom-grid">
        <Panel className="news-board enhanced-news-board" icon={Newspaper} title="新闻冲击与 AI 解读">
          <div className="news-ai-status">
            <Brain size={15} />
            <strong>{news?.analyzer.provider === "openai_compatible" ? "AI 中转站" : news?.analyzer.provider === "google" ? "Google AI" : news?.analyzer.provider === "rules" ? "规则分析" : "AI 未启用"}</strong>
            <span>{newsState === "loading" ? "加载中" : analyzerLabel(news?.analyzer.status)}</span>
          </div>
          <div className="news-impact-grid">
            {(news?.ai_highlights?.length ? news.ai_highlights : news?.key ?? []).slice(0, 4).map((item) => <NewsImpactCard item={item} key={item.id} />)}
            {(!news || ((news.ai_highlights?.length ?? 0) === 0 && news.key.length === 0)) && <EmptyLine text={newsState === "error" ? "新闻接口暂不可用" : "等待重点新闻"} />}
          </div>
        </Panel>

        <Panel className="home-alert-panel" icon={AlertTriangle} title="预警流">
          <div className="home-alert-list">
            {alerts.slice(0, 5).map((alert) => (
              <article className={`home-alert-item ${alert.severity}`} key={alert.id}>
                <strong>{alert.symbol}</strong>
                <span>{alert.message}</span>
                <time>{new Date(alert.created_at).toLocaleTimeString("zh-CN", { hour12: false })}</time>
              </article>
            ))}
            {alerts.length === 0 && <EmptyLine text="暂无预警" />}
          </div>
        </Panel>
      </section>

      <section className="home-bottom-grid news-secondary-grid">
        <Panel className="news-board" icon={Radio} title="突发新闻">
          <div className="news-board-section breaking">
            <div className="news-board-title">
              <strong>最新市场标题</strong>
              <span>{newsState === "loading" ? "加载中" : formatNewsUpdatedAt(news?.updated_at)}</span>
            </div>
            {news?.breaking.slice(0, 6).map((item) => <NewsLine item={item} key={item.id} />)}
            {(!news || news.breaking.length === 0) && <EmptyLine text={newsState === "error" ? "新闻接口暂不可用" : "等待突发新闻"} />}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function DualMarketClock({ clock }: { clock: ReturnType<typeof useDualMarketClock> }) {
  return (
    <div className="dual-market-clock" aria-label="中国和美国时间">
      <time dateTime={clock.iso}>
        <span>中国</span>
        <strong>{clock.china}</strong>
      </time>
      <time dateTime={clock.iso}>
        <span>美国</span>
        <strong>{clock.us}</strong>
      </time>
    </div>
  );
}

function StockHeatBoard({ heat, usSectorRows }: { heat: StocksCnHeatSnapshot | null; usSectorRows: QuantumTick[] }) {
  const sectorSignals = buildSectorSignals(heat);
  const industrySignals = sectorSignals.filter((item) => item.kind === "industry").slice(0, 5);
  const conceptSignals = sectorSignals.filter((item) => item.kind === "concept").slice(0, 5);
  const hotRank = heat?.hot_rank.slice(0, 5) ?? [];
  const hasData = industrySignals.length > 0 || conceptSignals.length > 0 || hotRank.length > 0;
  const statusText = heat?.status === "active" ? "监控中" : heat?.status === "error" ? "接口异常" : heat?.reason ?? "等待启动";

  if (!hasData && heat?.status !== "active") {
    return (
      <div className="stock-heat-paused">
        <div>
          <strong>{statusText}</strong>
          <span>启动国内股票模块后刷新板块和热门股榜单，默认 60 秒同步到首页。</span>
        </div>
        <time>{heat ? formatIndexUpdatedAt(heat.updated_at, 0) : "--"}</time>
      </div>
    );
  }

  return (
    <div className="stock-heat-layout">
      <div className={`stock-heat-status ${heat?.status ?? "paused"}`}>
        <span>{statusText}</span>
        <time>{heat ? formatIndexUpdatedAt(heat.updated_at, 0) : "--"}</time>
      </div>
      <HeatColumn title="行业强度" rows={industrySignals} />
      <HeatColumn title="概念强度" rows={conceptSignals} />
      <UsSectorColumn rows={usSectorRows} />
      <div className="heat-column hot-stock-column">
        <div className="heat-column-head">
          <strong>东方财富热榜</strong>
          <span>人气排名</span>
        </div>
        {hotRank.map((item) => (
          <article className="heat-row" key={item.code}>
            <div>
              <strong>{item.name}</strong>
              <span>{item.code} / 人气第 {item.rank}</span>
            </div>
            <ValueBadge value={item.change_percent} />
          </article>
        ))}
        {hotRank.length === 0 && <EmptyLine text={heat?.reason ?? "等待东方财富热榜"} />}
      </div>
    </div>
  );
}

function HeatColumn({ rows, title }: { rows: StocksCnHeatSnapshot["sectors"]["industries"]; title: string }) {
  return (
    <div className="heat-column">
      <div className="heat-column-head">
        <strong>{title}</strong>
        <span>强度排序</span>
      </div>
      {rows.map((item) => (
        <article className="heat-row" key={item.code}>
          <div>
            <strong>{item.name}</strong>
            <span>{formatSectorSignalMeta(item)}</span>
          </div>
          <ValueBadge value={item.change_percent} />
        </article>
      ))}
      {rows.length === 0 && <EmptyLine text="等待板块数据" />}
    </div>
  );
}

function UsSectorColumn({ rows }: { rows: QuantumTick[] }) {
  const ranked = [...rows]
    .sort((a, b) => usSectorScore(b) - usSectorScore(a))
    .slice(0, 5);

  return (
    <div className="heat-column us-sector-column">
      <div className="heat-column-head">
        <strong>美股板块</strong>
        <span>ETF强弱</span>
      </div>
      {ranked.map((item) => (
        <article className="heat-row" key={item.symbol}>
          <div>
            <strong>{usSectorEtfs[item.symbol] ?? item.symbol}</strong>
            <span>{item.symbol} / {formatDeviationLabel(item)}</span>
          </div>
          <ValueBadge value={item.change_24h} />
        </article>
      ))}
      {ranked.length === 0 && <EmptyLine text="启动美股模块后显示板块 ETF" />}
    </div>
  );
}

function usSectorScore(item: QuantumTick): number {
  return item.change_24h * 1.2 + (item.ma60_dev_15m ?? 0) * 0.5 + (item.ma60_dev_1d ?? 0) * 0.25;
}

function formatDeviationLabel(item: QuantumTick): string {
  if (typeof item.ma60_dev_15m === "number") return `15m ${formatSignedValue(item.ma60_dev_15m)}%`;
  if (typeof item.ma60_dev_1m === "number") return `1m ${formatSignedValue(item.ma60_dev_1m)}%`;
  if (typeof item.ma60_dev_1d === "number") return `日 ${formatSignedValue(item.ma60_dev_1d)}%`;
  return "等待偏离";
}

function formatSignedValue(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

type SectorSignal = StocksCnHeatSnapshot["sectors"]["industries"][number];
function buildSectorSignals(heat: StocksCnHeatSnapshot | null): SectorSignal[] {
  const rows = [...(heat?.sectors.industries ?? []), ...(heat?.sectors.concepts ?? [])];
  return rows.sort((a, b) => sectorScore(b) - sectorScore(a));
}

function sectorScore(item: SectorSignal): number {
  const breadth = (item.rising_count ?? 0) - (item.falling_count ?? 0);
  const leader = Math.abs(item.leading_change_percent ?? 0) * 0.35;
  const inflow = Math.min(Math.abs(item.main_net_inflow ?? 0) / 100000000, 8) * 0.18;
  return item.change_percent * 1.4 + breadth * 0.03 + leader + inflow;
}

function formatSectorSignalMeta(item: SectorSignal): string {
  const breadth = `${item.rising_count ?? 0}涨/${item.falling_count ?? 0}跌`;
  if (item.leading_stock) return `领涨 ${item.leading_stock} / ${breadth}`;
  return breadth;
}

function Panel({ children, className, icon: Icon, title }: { children: ReactNode; className?: string; icon: typeof BarChart3; title: string }) {
  return (
    <section className={`home-panel ${className ?? ""}`}>
      <div className="section-title">
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function MarketRankingCard({ group }: { group: MarketRankingGroup }) {
  return (
    <article className="market-ranking-card">
      <div className="market-ranking-head">
        <strong>{group.label}</strong>
        <span>{group.rows.filter((row) => row.tick).length}/5</span>
      </div>
      {group.rows.map((item) => {
        const row = item.tick;
        const value = row ? Number(row[item.key]) : Number.NaN;
        return (
          <div className="market-ranking-row" key={`${group.market}:${item.label}`}>
            <span>{item.label}</span>
            {row ? (
              <>
                <strong>{row.symbol}</strong>
                <em>{formatFreshness(row.updated_at)} / {row.display_name ?? row.symbol}</em>
                <ValueBadge value={Number.isFinite(value) ? value : 0} />
              </>
            ) : (
              <small>等待数据</small>
            )}
          </div>
        );
      })}
    </article>
  );
}

function GroupedIndexGrid({ items, state }: { items: MarketIndexQuote[]; state: "idle" | "loading" | "ready" | "error" }) {
  if (items.length === 0) {
    return <EmptyLine text={state === "error" ? "指数接口暂不可用" : "等待指数数据"} />;
  }
  const orderedItems = [...items].sort((a, b) => Number(isVolatilityIndex(a)) - Number(isVolatilityIndex(b)));
  return (
    <div className="index-grid flat">
      {orderedItems.map((item) => <IndexTile item={item} key={`${item.market}:${item.symbol}`} />)}
    </div>
  );
}

function isVolatilityIndex(item: MarketIndexQuote): boolean {
  return item.symbol.toUpperCase().includes("VIX") || item.label.toUpperCase().includes("VIX") || item.market.includes("波动");
}

function IndexTile({ item }: { item: MarketIndexQuote }) {
  const value = item.changePercent;
  return (
    <article className={`index-tile ${item.status === "error" ? "error" : ""}`}>
      <div>
        <strong>{item.label}</strong>
        <span>{item.symbol}</span>
      </div>
      {typeof item.price === "number" ? <em>{formatIndexPrice(item.price)}</em> : <em>--</em>}
      {typeof value === "number" ? <ValueBadge value={value} /> : <small>{item.error ?? "无数据"}</small>}
    </article>
  );
}

function NewsImpactCard({ item }: { item: MacroNewsItem }) {
  const direction = item.impact_direction ?? "neutral";
  const summary = getDistinctNewsSummary(item);
  return (
    <article className={`news-impact-card ${direction}`}>
      <div className="news-impact-head">
        <span>{new Date(item.published_at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</span>
        <span className="news-source-chip">{item.source}</span>
        <strong>{directionLabel(direction)}</strong>
        <em>{Math.round(item.importance_score ?? 0)}</em>
      </div>
      <a href={item.url} rel="noreferrer" target="_blank">{item.title}</a>
      {summary && <p>{summary}</p>}
      <div className="impact-assets">
        {(item.impact_assets?.length ? item.impact_assets : item.tags).slice(0, 5).map((asset) => <span key={asset}>{asset}</span>)}
      </div>
      <small>{item.impact_reason ?? `${item.source} / ${item.tags.join("/")}`}</small>
    </article>
  );
}

function NewsLine({ item }: { item: MacroNewsItem }) {
  return (
    <article className="news-board-line">
      <span>{new Date(item.published_at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</span>
      <p>
        <a href={item.url} rel="noreferrer" target="_blank">{item.title}</a>
        <em>{item.source} / {item.tags.join("/")}</em>
      </p>
    </article>
  );
}

function getDistinctNewsSummary(item: MacroNewsItem): string | null {
  const candidate = item.summary ?? item.ai_summary ?? null;
  if (!candidate) return null;
  if (item.original_language === "en" && !hasCjk(candidate)) return null;
  const normalizedTitle = normalizeNewsText(item.title);
  const normalizedSummary = normalizeNewsText(candidate);
  if (!normalizedSummary || normalizedSummary === normalizedTitle) return null;
  if (normalizedSummary.includes(normalizedTitle) || normalizedTitle.includes(normalizedSummary)) return null;
  return candidate;
}

function normalizeNewsText(value: string): string {
  return value.toLowerCase().replace(/[\s"'“”‘’：:，,。.!！?？\-—_/\\()[\]【】]+/g, "");
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function EmptyLine({ text }: { text: string }) {
  return <div className="empty-line">{text}</div>;
}

function buildMarketRankings(ticks: QuantumTick[]): MarketRankingGroup[] {
  return rankingMarkets.map((market) => {
    const rows = ticks.filter((tick) => tick.market === market.market);
    return {
      ...market,
      rows: [
        { label: "领涨", key: "change_24h", mode: "max", tick: pickRank(rows, "change_24h", "max") },
        { label: "领跌", key: "change_24h", mode: "min", tick: pickRank(rows, "change_24h", "min") },
        { label: "1分钟偏离", key: "ma60_dev_1m", mode: "abs", tick: pickRank(rows, "ma60_dev_1m", "abs") },
        { label: "15分钟偏离", key: "ma60_dev_15m", mode: "abs", tick: pickRank(rows, "ma60_dev_15m", "abs") },
        { label: "日线偏离", key: "ma60_dev_1d", mode: "abs", tick: pickRank(rows, "ma60_dev_1d", "abs") },
      ],
    };
  });
}

function pickRank(ticks: QuantumTick[], key: RankKey, mode: RankingRow["mode"]): QuantumTick | undefined {
  const usable = ticks.filter((tick) => Number.isFinite(Number(tick[key])));
  if (mode === "min") return usable.sort((a, b) => Number(a[key]) - Number(b[key]))[0];
  if (mode === "abs") return usable.sort((a, b) => Math.abs(Number(b[key])) - Math.abs(Number(a[key])))[0];
  return usable.sort((a, b) => Number(b[key]) - Number(a[key]))[0];
}

function ValueBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={`home-value ${positive ? "positive-green" : "negative-red"}`}>
      {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function statusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "starting") return "启动中";
  if (status === "stopping") return "停止中";
  if (status === "sleeping") return "已暂停";
  if (status === "error") return "异常";
  return "未接入";
}

function useMacroNews(): { news: MacroNewsSummary | null; newsState: "idle" | "loading" | "ready" | "error" } {
  const [news, setNews] = useState<MacroNewsSummary | null>(null);
  const [newsState, setNewsState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setNewsState((current) => current === "ready" ? "ready" : "loading");
      try {
        const response = await fetch("/api/news/summary");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as MacroNewsSummary;
        if (!cancelled) {
          setNews(payload);
          setNewsState("ready");
        }
      } catch {
        if (!cancelled) setNewsState("error");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { news, newsState };
}

function useMarketIndices(): { indices: MarketIndexSummary | null; indexState: "idle" | "loading" | "ready" | "error" } {
  const [indices, setIndices] = useState<MarketIndexSummary | null>(null);
  const [indexState, setIndexState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIndexState((current) => current === "ready" ? "ready" : "loading");
      try {
        const response = await fetch("/api/market-indices");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as MarketIndexSummary;
        if (!cancelled) {
          setIndices(payload);
          setIndexState("ready");
        }
      } catch {
        if (!cancelled) setIndexState("error");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { indices, indexState };
}

function useDualMarketClock(): { china: string; us: string; iso: string } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => ({
    china: formatTimeInZone(now, "Asia/Shanghai"),
    us: formatTimeInZone(now, "America/New_York"),
    iso: now.toISOString(),
  }), [now]);
}

function formatTimeInZone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(value);
}

function formatNewsUpdatedAt(value: string | undefined): string {
  if (!value) return "等待更新";
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function formatIndexUpdatedAt(value: string | undefined, fallback: number): string {
  const raw = value || (fallback ? new Date(fallback).toISOString() : "");
  if (!raw) return "等待更新";
  return new Date(raw).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function formatIndexPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function isFreshTick(updatedAt: string): boolean {
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) && Date.now() - ms < 5 * 60 * 1000;
}

function formatFreshness(updatedAt: string): string {
  return isFreshTick(updatedAt) ? "新鲜" : "延迟";
}

function analyzerLabel(status: MacroNewsSummary["analyzer"]["status"] | undefined): string {
  if (status === "ready") return "AI 分析就绪";
  if (status === "fallback") return "规则分析兜底";
  if (status === "error") return "AI 失败，已兜底";
  if (status === "disabled") return "AI 未启用";
  return "等待分析";
}

function directionLabel(direction: NonNullable<MacroNewsItem["impact_direction"]>): string {
  if (direction === "bullish") return "偏利多";
  if (direction === "bearish") return "偏利空";
  if (direction === "mixed") return "多空交织";
  return "中性";
}
