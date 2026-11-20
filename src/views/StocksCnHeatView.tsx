import { Flame, Radio } from "lucide-react";
import type { StocksCnHeatSnapshot } from "../useQuantumSSE";

export function StocksCnHeatView({ heat }: { heat: StocksCnHeatSnapshot | null }) {
  const status = heat?.status ?? "paused";
  const statusText = status === "active" ? "热度同步中" : status === "error" ? "接口异常" : heat?.reason ?? "等待启动";

  return (
    <section className="heat-monitor-view">
      <div className={`heat-monitor-status ${status}`}>
        <div>
          <Radio size={17} />
          <strong>{statusText}</strong>
        </div>
        <span>板块异动和热门股榜单由模块开关控制，运行时默认每 60 秒刷新并同步到首页。</span>
        <time>{heat ? new Date(heat.updated_at).toLocaleTimeString("zh-CN", { hour12: false }) : "--"}</time>
      </div>

      <div className="heat-monitor-grid">
        <HeatTable title="行业板块涨幅" rows={heat?.sectors.industries ?? []} />
        <HeatTable title="概念板块涨幅" rows={heat?.sectors.concepts ?? []} />
        <StockTable rows={heat?.hot_stocks ?? []} />
      </div>
    </section>
  );
}

function HeatTable({ rows, title }: { rows: NonNullable<StocksCnHeatSnapshot>["sectors"]["industries"]; title: string }) {
  return (
    <section className="data-panel">
      <div className="section-title">
        <Flame size={18} />
        <h2>{title}</h2>
      </div>
      <div className="heat-table-list">
        {rows.slice(0, 12).map((item) => (
          <article className="heat-table-row" key={item.code}>
            <strong>{item.name}</strong>
            <span>{item.leading_stock ? `领涨 ${item.leading_stock}` : `${item.rising_count ?? 0}涨/${item.falling_count ?? 0}跌`}</span>
            <em className={item.change_percent >= 0 ? "positive-green" : "negative-red"}>{formatSigned(item.change_percent)}%</em>
          </article>
        ))}
        {rows.length === 0 && <div className="empty-line">等待板块数据</div>}
      </div>
    </section>
  );
}

function StockTable({ rows }: { rows: NonNullable<StocksCnHeatSnapshot>["hot_stocks"] }) {
  return (
    <section className="data-panel">
      <div className="section-title">
        <Flame size={18} />
        <h2>热门股异动</h2>
      </div>
      <div className="heat-table-list">
        {rows.slice(0, 16).map((item) => (
          <article className="heat-table-row" key={`${item.list}:${item.code}`}>
            <strong>{item.name}</strong>
            <span>{item.code} / {listLabel(item.list)} / 额 {formatAmount(item.amount)} / 换 {formatNullable(item.turnover_rate)}% / 量比 {formatNullable(item.volume_ratio)}</span>
            <em className={item.change_percent >= 0 ? "positive-green" : "negative-red"}>{formatSigned(item.change_percent)}%</em>
          </article>
        ))}
        {rows.length === 0 && <div className="empty-line">等待热门股数据，请确认国内股票模块已启动</div>}
      </div>
    </section>
  );
}

function listLabel(value: string): string {
  if (value === "amount") return "成交额";
  if (value === "turnover") return "换手率";
  if (value === "volume_ratio") return "量比";
  return "涨幅";
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatNullable(value: number | undefined): string {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toFixed(2);
}

function formatAmount(value: number | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toFixed(0);
}
