import { useMemo, useState } from "react";
import { BarChart3, Search, TrendingDown, TrendingUp } from "lucide-react";
import type { QuantumTick } from "../useQuantumSSE";
import type { ChartInterval } from "../components/ChartWindow";

type PriceColorStyle = "RedUpGreenDown" | "GreenUpRedDown";
type FuturesCnSortKey =
  | "symbol"
  | "price"
  | "change_24h"
  | "ma60_dev_1m"
  | "ma60_dev_15m"
  | "ma60_dev_1d";
type SortDirection = "asc" | "desc";

export function FuturesCnView({
  onOpenChart,
  priceColorStyle,
  rows,
}: {
  onOpenChart: (item: QuantumTick, interval: ChartInterval) => void;
  priceColorStyle: PriceColorStyle;
  rows: QuantumTick[];
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<FuturesCnSortKey>("ma60_dev_1m");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => matchesQuery(row, normalizedQuery))
      .sort((a, b) => compareSortValues(a[sortKey], b[sortKey], sortDirection));
  }, [query, rows, sortDirection, sortKey]);

  function toggleSort(key: FuturesCnSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("desc");
  }

  return (
    <section className="table-panel futures-panel">
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="搜索期货..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="toolbar-meta">
          <span>国内期货</span>
          <strong>Sina Futures 实时监控</strong>
          <em>表格偏离轻量快照，图表按需加载</em>
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
                onClick={() => toggleSort("symbol")}
              />
              <SortableHeader
                active={sortKey === "price"}
                align="right"
                direction={sortDirection}
                label="最新价"
                onClick={() => toggleSort("price")}
              />
              <SortableHeader
                active={sortKey === "change_24h"}
                align="right"
                direction={sortDirection}
                label="涨跌"
                onClick={() => toggleSort("change_24h")}
              />
              <SortableHeader
                active={sortKey === "ma60_dev_1m"}
                align="right"
                direction={sortDirection}
                label="1分钟MA60偏离"
                onClick={() => toggleSort("ma60_dev_1m")}
              />
              <SortableHeader
                active={sortKey === "ma60_dev_15m"}
                align="right"
                direction={sortDirection}
                label="15分钟偏离"
                onClick={() => toggleSort("ma60_dev_15m")}
              />
              <SortableHeader
                active={sortKey === "ma60_dev_1d"}
                align="right"
                direction={sortDirection}
                label="日线偏离"
                onClick={() => toggleSort("ma60_dev_1d")}
              />
              <th className="align-right">图表</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.symbol}>
                <td>
                  <div className="symbol-cell">
                    <span>{row.symbol}</span>
                    {row.display_name && <small>{row.display_name}</small>}
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
                  <button
                    className="icon-metric-button"
                    type="button"
                    title="打开图表"
                    onClick={() => onOpenChart(row, "15")}
                  >
                    <BarChart3 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7}>暂无实时数据。请先启动国内期货模块。</td>
              </tr>
            )}
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
  priceColorStyle,
  value,
}: {
  priceColorStyle: PriceColorStyle;
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

function compareSortValues(
  left: string | number | undefined,
  right: string | number | undefined,
  direction: SortDirection,
): number {
  if (typeof left === "string" || typeof right === "string") {
    const result = String(left ?? "").localeCompare(String(right ?? ""));
    return direction === "asc" ? result : -result;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftValid = Number.isFinite(leftNumber);
  const rightValid = Number.isFinite(rightNumber);

  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return 1;
  if (!rightValid) return -1;

  const result = leftNumber - rightNumber;
  return direction === "asc" ? result : -result;
}

function matchesQuery(row: QuantumTick, query: string): boolean {
  if (!query) return true;
  return [
    row.symbol,
    row.display_name,
  ].some((value) => value?.toLowerCase().includes(query));
}

function formatPrice(value: number): string {
  if (value < 1) return value.toFixed(5);
  if (value < 100) return value.toFixed(2);
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
