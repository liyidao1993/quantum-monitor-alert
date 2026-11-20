import { BarChart3, Search, TrendingDown, TrendingUp } from "lucide-react";
import type { QuantumTick } from "../useQuantumSSE";
import type { ChartInterval } from "../components/ChartWindow";

export type BinanceSortKey =
  | "symbol"
  | "price"
  | "change_24h"
  | "ma60_dev_1m"
  | "ma60_dev_15m"
  | "ma60_dev_1d";

export type SortDirection = "asc" | "desc";
type PriceColorStyle = "RedUpGreenDown" | "GreenUpRedDown";

export function BinanceView({
  onOpenChart,
  onQueryChange,
  onSort,
  priceColorStyle,
  query,
  rows,
  sortDirection,
  sortKey,
}: {
  onOpenChart: (item: QuantumTick, interval: ChartInterval) => void;
  onQueryChange: (value: string) => void;
  onSort: (key: BinanceSortKey) => void;
  priceColorStyle: PriceColorStyle;
  query: string;
  rows: QuantumTick[];
  sortDirection: SortDirection;
  sortKey: BinanceSortKey;
}) {
  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="搜索币种..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <div className="toolbar-meta">
          <span>刷新频率</span>
          <strong>Binance WebSocket 实时流</strong>
          <em>偏离值轻量计算，图表按需加载 TradingView</em>
        </div>
      </div>

      <div className="data-grid">
        <table>
          <thead>
            <tr>
              <SortableHeader
                active={sortKey === "symbol"}
                direction={sortDirection}
                label="品种"
                onClick={() => onSort("symbol")}
              />
              <SortableHeader
                active={sortKey === "price"}
                direction={sortDirection}
                label="最新价格"
                onClick={() => onSort("price")}
                align="right"
              />
              <SortableHeader
                active={sortKey === "change_24h"}
                direction={sortDirection}
                label="24H涨幅"
                onClick={() => onSort("change_24h")}
                align="right"
              />
              <SortableHeader
                active={sortKey === "ma60_dev_1m"}
                direction={sortDirection}
                label="1分钟MA60偏离"
                onClick={() => onSort("ma60_dev_1m")}
                align="right"
              />
              <SortableHeader
                active={sortKey === "ma60_dev_15m"}
                direction={sortDirection}
                label="15分钟偏离"
                onClick={() => onSort("ma60_dev_15m")}
                align="right"
              />
              <SortableHeader
                active={sortKey === "ma60_dev_1d"}
                direction={sortDirection}
                label="日线偏离"
                onClick={() => onSort("ma60_dev_1d")}
                align="right"
              />
              <th className="align-right">图表</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td>
                  <div className="symbol-cell">
                    <span>{row.symbol}</span>
                    <small>BINANCE:{row.symbol.replace("/", "")}.P</small>
                  </div>
                </td>
                <td className="numeric">{formatPrice(row.price)}</td>
                <td className="numeric">
                  <ValueBadge priceColorStyle={priceColorStyle} value={row.change_24h} />
                </td>
                <td className="numeric">
                  <MetricBadge priceColorStyle={priceColorStyle} value={row.ma60_dev_1m} />
                </td>
                <td className="numeric">
                  <MetricBadge priceColorStyle={priceColorStyle} value={row.ma60_dev_15m} />
                </td>
                <td className="numeric">
                  <MetricBadge priceColorStyle={priceColorStyle} value={row.ma60_dev_1d} />
                </td>
                <td className="numeric">
                  <button className="icon-metric-button" type="button" onClick={() => onOpenChart(row, "15")} title="打开 TradingView 图表">
                    <BarChart3 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableHeader({
  active,
  align,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  align?: "right";
  direction: SortDirection;
  label: string;
  onClick: () => void;
}) {
  return (
    <th className={align === "right" ? "align-right" : undefined}>
      <button type="button" onClick={onClick}>
        {label}
        {active && <span>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function ValueBadge({
  priceColorStyle = "RedUpGreenDown",
  value,
}: {
  priceColorStyle?: PriceColorStyle;
  value: number;
}) {
  const isPositive = value >= 0;
  const positiveClass = priceColorStyle === "RedUpGreenDown" ? "positive-red" : "positive-green";
  const negativeClass = priceColorStyle === "RedUpGreenDown" ? "negative-green" : "negative-red";

  return (
    <span className={`value-badge ${isPositive ? positiveClass : negativeClass}`}>
      {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {isPositive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function MetricBadge({
  priceColorStyle,
  value,
}: {
  priceColorStyle: PriceColorStyle;
  value: number | undefined;
}) {
  const metricValue = Number(value);
  if (!Number.isFinite(metricValue)) {
    return <span className="value-badge empty">--</span>;
  }

  return <ValueBadge priceColorStyle={priceColorStyle} value={metricValue} />;
}

function formatPrice(value: number): string {
  if (value < 1) return value.toFixed(5);
  if (value < 100) return value.toFixed(2);
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
