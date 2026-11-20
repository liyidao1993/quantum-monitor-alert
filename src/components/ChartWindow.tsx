import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import type { QuantumTick } from "../useQuantumSSE";
import { mapMarketSymbol } from "../../Quantum_Monitor_System/4_Shared_Types/symbol_mapping/TradingViewSymbolMapper";

export type ChartInterval = "1" | "15" | "D";

type TradingViewGlobal = Window & {
  TradingView?: {
    widget: new (options: Record<string, unknown>) => unknown;
  };
};

interface KlinePoint {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface NormalizedKlinePoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export function ChartWindow({
  initialInterval = "1",
  item,
  onClose,
}: {
  initialInterval?: ChartInterval;
  item: QuantumTick;
  onClose: () => void;
}) {
  const [interval, setIntervalValue] = useState<ChartInterval>(initialInterval);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tradingViewContainerId = useMemo(
    () => `tv_chart_${item.market}_${item.symbol.replace(/[^a-zA-Z0-9]/g, "_")}`,
    [item.market, item.symbol],
  );
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradingViewScriptUrl, setTradingViewScriptUrl] = useState("https://s3.tradingview.com/tv.js");
  const chartSource = useMemo(() => resolveChartSource(item, interval), [interval, item]);
  const symbolMapping = useMemo(
    () => mapMarketSymbol(item.symbol, chartSymbolMarket(item.market)),
    [item.market, item.symbol],
  );

  useEffect(() => {
    if (item.market !== "Crypto_Binance") return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settings: { ApiEndpointSettings?: { tradingview_widget_url?: string } }) => {
        const url = settings.ApiEndpointSettings?.tradingview_widget_url?.trim();
        if (!cancelled && url) setTradingViewScriptUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.market]);

  useEffect(() => {
    if (item.market !== "Crypto_Binance") return;

    let disposed = false;

    const renderTradingView = () => {
      const tvWindow = window as TradingViewGlobal;
      if (disposed || !tvWindow.TradingView) return false;
      const container = document.getElementById(tradingViewContainerId);
      if (!container) return false;
      container.innerHTML = "";
      new tvWindow.TradingView.widget({
        autosize: true,
        symbol: symbolMapping.tradingViewSymbol,
        interval,
        timezone: "Asia/Shanghai",
        theme: "dark",
        style: "1",
        locale: "zh_CN",
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        container_id: tradingViewContainerId,
        studies: [
          {
            id: "MASimple@tv-basicstudies",
            inputs: { length: 60 },
          },
        ],
      });
      return true;
    };

    if (!renderTradingView()) {
      let script = document.getElementById("tradingview-script") as HTMLScriptElement | null;
      if (script && script.src !== new URL(tradingViewScriptUrl, window.location.href).href) {
        script.remove();
        script = null;
        delete (window as TradingViewGlobal).TradingView;
      }
      if (!script) {
        script = document.createElement("script");
        script.id = "tradingview-script";
        script.src = tradingViewScriptUrl;
        script.async = true;
        document.body.appendChild(script);
      }

      const timer = window.setInterval(() => {
        if (renderTradingView()) {
          window.clearInterval(timer);
        }
      }, 300);

      return () => {
        disposed = true;
        window.clearInterval(timer);
        const container = document.getElementById(tradingViewContainerId);
        if (container) container.innerHTML = "";
        cleanupTradingViewRuntime();
      };
    }

    return () => {
      disposed = true;
      const container = document.getElementById(tradingViewContainerId);
      if (container) container.innerHTML = "";
      cleanupTradingViewRuntime();
    };
  }, [interval, item.market, symbolMapping.tradingViewSymbol, tradingViewContainerId, tradingViewScriptUrl]);

  useEffect(() => {
    if (item.market === "Crypto_Binance") {
      setLoading(false);
      return;
    }

    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: { background: { type: ColorType.Solid, color: "#0d1117" }, textColor: "#8b949e" },
      grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#30363d", timeVisible: true },
      rightPriceScale: { borderColor: "#30363d" },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const ma60Series = chart.addSeries(LineSeries, {
      color: "#f0b90b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "MA60",
    });

    const controller = new AbortController();
    let mounted = true;
    setLoading(true);
    fetch(chartSource.url, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        const candles = normalizeCandles(json.candles ?? []);
        if (candles.length === 0) return;

        candleSeries.setData(candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })));

        if (candles[0]?.volume !== undefined) {
          volumeSeries.setData(candles.map((c) => ({
            time: c.time,
            value: c.volume ?? 0,
            color: c.close >= c.open ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)",
          })));
        }

        const ma60Data = calculateMa60(candles);
        if (ma60Data.length > 0) {
          ma60Series.setData(ma60Data);
        }

        chart.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const ro = new ResizeObserver(() => {
      if (container) chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      mounted = false;
      controller.abort();
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartSource.url, item.market]);

  const intervalLabel = interval === "D" ? "日线" : `${interval}分钟`;

  return (
    <div className="modal-layer">
      <section className="chart-window" data-tv-symbol={symbolMapping.tradingViewSymbol}>
        <header>
          <div>
            <strong>{item.symbol} 按需图表窗口</strong>
            <span>
              {chartSource.label} — {intervalLabel}
              {item.market === "Crypto_Binance" ? " — TradingView" : " — 本地按需 K 线"}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭图表窗口">
            <X size={18} />
          </button>
        </header>
        <div className="chart-controls">
          {(["1", "15", "D"] as ChartInterval[]).map((value) => (
            <button
              className={interval === value ? "active" : ""}
              key={value}
              type="button"
              onClick={() => setIntervalValue(value)}
            >
              {value === "D" ? "日线" : `${value}分钟`}
            </button>
          ))}
        </div>
        {item.market === "Crypto_Binance" ? (
          <div
            className="tradingview-frame"
            id={tradingViewContainerId}
          />
        ) : (
          <div className="mock-chart" ref={chartContainerRef} style={{ position: "relative", minHeight: 420 }}>
            {loading && <div className="chart-watermark">加载 K 线数据中...</div>}
          </div>
        )}
      </section>
    </div>
  );
}

function resolveChartSource(item: QuantumTick, interval: ChartInterval): { label: string; url: string } {
  const intervalMap: Record<ChartInterval, string> = { "1": "1m", "15": "15m", D: "1d" };
  if (item.market === "Futures_CN") {
    return {
      label: `SINA:${item.symbol}`,
      url: `/api/futures-cn/klines?symbol=${encodeURIComponent(item.symbol)}&interval=${intervalMap[interval]}&limit=300`,
    };
  }

  if (item.market === "Futures_Global") {
    return {
      label: `YAHOO:${item.symbol}`,
      url: `/api/futures-global/klines?symbol=${encodeURIComponent(item.symbol)}&interval=${intervalMap[interval]}&limit=300`,
    };
  }

  if (item.market === "Stocks_US") {
    return {
      label: `YAHOO:${item.symbol}`,
      url: `/api/stocks-us/klines?symbol=${encodeURIComponent(item.symbol)}&interval=${intervalMap[interval]}&limit=300`,
    };
  }

  return {
    label: `BINANCE:${item.symbol.replace("/", "")}.P`,
    url: "",
  };
}

function chartSymbolMarket(market: string): "Crypto_Binance" | "Futures_CN" | "Futures_Global" | "Stocks_US" {
  if (market === "Crypto_Binance") return "Crypto_Binance";
  if (market === "Futures_CN") return "Futures_CN";
  if (market === "Stocks_US") return "Stocks_US";
  return "Futures_Global";
}

function cleanupTradingViewRuntime(): void {
  document.getElementById("tradingview-script")?.remove();
  delete (window as TradingViewGlobal).TradingView;
}

function normalizeCandles(candles: KlinePoint[]): NormalizedKlinePoint[] {
  return candles
    .map((candle) => {
      const time = typeof candle.time === "string"
        ? Math.floor(Date.parse(candle.time) / 1000)
        : candle.time;
      return { ...candle, time: time as Time };
    })
    .filter((candle) => Number.isFinite(Number(candle.time)));
}

function calculateMa60(candles: NormalizedKlinePoint[]): Array<{ time: Time; value: number }> {
  const maPeriod = 60;
  const ma60Data: Array<{ time: Time; value: number }> = [];
  let rollingSum = 0;

  for (let i = 0; i < candles.length; i += 1) {
    rollingSum += candles[i].close;
    if (i >= maPeriod) {
      rollingSum -= candles[i - maPeriod].close;
    }
    if (i >= maPeriod - 1) {
      ma60Data.push({ time: candles[i].time, value: rollingSum / maPeriod });
    }
  }

  return ma60Data;
}
