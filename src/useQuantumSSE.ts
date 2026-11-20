import { useEffect, useRef, useState, useCallback } from "react";
import type { AppSettings } from "../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes";

export interface QuantumTick {
  market: string;
  symbol: string;
  display_name?: string;
  price: number;
  change_24h: number;
  ma60_dev_1m?: number;
  ma60_dev_15m?: number;
  ma60_dev_1d?: number;
  updated_at: string;
}

export interface QuantumAlert {
  id: string;
  type: string;
  market: string;
  symbol: string;
  message: string;
  severity: "info" | "warning" | "critical";
  value?: number;
  threshold?: number;
  created_at: string;
}

export type SSEStatus = "connecting" | "connected" | "disconnected" | "error";

export interface ModuleRuntime {
  market: string;
  status: string;
  reason?: string;
  updated_at?: string;
}

export interface StocksCnSectorHeatItem {
  code: string;
  name: string;
  kind: "industry" | "concept";
  change_percent: number;
  main_net_inflow?: number;
  rising_count?: number;
  falling_count?: number;
  leading_stock?: string;
  leading_stock_code?: string;
  leading_change_percent?: number;
}

export interface StocksCnHotStockItem {
  code: string;
  name: string;
  price: number;
  change_percent: number;
  amount?: number;
  turnover_rate?: number;
  volume_ratio?: number;
  list: "gainers" | "amount" | "turnover" | "volume_ratio";
}

export interface StocksCnHotRankItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  change_percent: number;
  rank_change?: number;
  previous_rank?: number;
  source: "eastmoney";
}

export interface StocksCnHeatSnapshot {
  market: "Stocks_CN";
  status: "active" | "paused" | "error";
  reason?: string;
  updated_at: string;
  next_refresh_at?: string;
  sectors: {
    industries: StocksCnSectorHeatItem[];
    concepts: StocksCnSectorHeatItem[];
  };
  hot_stocks: StocksCnHotStockItem[];
  hot_rank: StocksCnHotRankItem[];
}

export function useQuantumSSE() {
  const [ticks, setTicks] = useState<Map<string, QuantumTick>>(new Map());
  const [sseStatus, setSseStatus] = useState<SSEStatus>("connecting");
  const [moduleStatuses, setModuleStatuses] = useState<ModuleRuntime[]>([]);
  const [alerts, setAlerts] = useState<QuantumAlert[]>([]);
  const [lastDataAt, setLastDataAt] = useState<number>(0);
  const [stocksCnHeat, setStocksCnHeat] = useState<StocksCnHeatSnapshot | null>(null);
  const [alertHistoryLimit, setAlertHistoryLimit] = useState(100);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertHistoryLimitRef = useRef(100);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    alertHistoryLimitRef.current = alertHistoryLimit;
    setAlerts((prev) => prev.slice(0, alertHistoryLimit));
  }, [alertHistoryLimit]);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settings: { AlertSettings?: { history_limit?: number } }) => {
        const limit = Number(settings.AlertSettings?.history_limit);
        if (Number.isFinite(limit) && limit > 0) {
          setAlertHistoryLimit(Math.max(1, Math.floor(limit)));
        }
      })
      .catch(() => undefined);
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    setSseStatus("connecting");

    const es = new EventSource("/api/quantum/stream");
    esRef.current = es;

    es.onopen = () => {
      setSseStatus("connected");
      if (!hasOpenedRef.current) {
        setAlerts([]);
        hasOpenedRef.current = true;
      }
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "tick") {
          const tick = msg.data as QuantumTick;
          setTicks((prev) => {
            const next = new Map(prev);
            next.set(`${tick.market}:${tick.symbol}`, tick);
            return next;
          });
          setLastDataAt(Date.now());
        } else if (msg.type === "snapshot") {
          const items = msg.data as QuantumTick[];
          setTicks(() => {
            const m = new Map<string, QuantumTick>();
            for (const t of items) m.set(`${t.market}:${t.symbol}`, t);
            return m;
          });
          setLastDataAt(Date.now());
        } else if (msg.type === "module_status") {
          const s = msg.data as ModuleRuntime;
          setModuleStatuses((prev) => {
            const idx = prev.findIndex((x) => x.market === s.market);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = s;
              return next;
            }
            return [...prev, s];
          });
        } else if (msg.type === "module_statuses") {
          setModuleStatuses(msg.data as ModuleRuntime[]);
        } else if (msg.type === "alert") {
          const alert = msg.data as QuantumAlert;
          setAlerts((prev) => [alert, ...prev].slice(0, alertHistoryLimitRef.current));
        } else if (msg.type === "stocks_cn_heat") {
          setStocksCnHeat(msg.data as StocksCnHeatSnapshot);
        } else if (msg.type === "heartbeat") {
          setLastDataAt((prev) => prev || Date.now());
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setSseStatus("error");
      es.close();
      esRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => connect(), 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  const binanceStatus = moduleStatuses.find((m) => m.market === "Crypto_Binance")?.status ?? "unknown";

  return { ticks, sseStatus, lastDataAt, binanceStatus, moduleStatuses, alerts, stocksCnHeat };
}

export interface ControlModuleResult {
  ok: boolean;
  settings?: AppSettings;
  status?: string;
}

export async function controlModule(name: string, action: "start" | "stop"): Promise<ControlModuleResult> {
  try {
    const res = await fetch(`/api/quantum/module/${name}/${action}`, { method: "POST" });
    const json = await res.json() as ControlModuleResult;
    return { ok: json.ok === true, settings: json.settings, status: json.status };
  } catch {
    return { ok: false };
  }
}
