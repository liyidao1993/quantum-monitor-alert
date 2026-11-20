# VANGUARD - AI Developer Context Document

**🚨 TO ANY AI ASSISTANT READING THIS 🚨**
This document provides the architectural blueprint, domain logic, and historical context of the VANGUARD market monitoring system. Read this carefully before making any modifications to the codebase.

## 1. Project Overview
VANGUARD is a real-time market monitoring and anomaly detection dashboard. It tracks financial instruments across two main categories:
1.  **Crypto** (via Binance API)
2.  **Traditional Futures** (International via Yahoo Finance, Domestic/Chinese via Sina Finance)

**Core Value Proposition**: The system calculates the **MA60 (60-period Moving Average)** for 1-minute and 15-minute timeframes, computes the current price's **deviation percentage** from this MA60, and triggers real-time alerts if the deviation or instantaneous price jumps exceed user-defined thresholds.

## 2. Tech Stack
*   **Frontend**: React 18, TypeScript, Tailwind CSS, Vite.
*   **Backend**: Node.js, Express, TypeScript (`tsx` for execution).
*   **Communication**: Server-Sent Events (SSE) for real-time one-way data pushing from Backend -> Frontend.
*   **Charting**: TradingView Lightweight Widget (injected via script in `App.tsx`).

## 3. Architecture & Data Flow
The application runs as a monolith where Express serves both the API/SSE endpoints and the Vite frontend (in development via middleware, in production via static files).

*   **`server.ts`**: The entry point. Initializes `MarketEngine` and sets up the `/api/stream` (SSE) and `/api/config` REST endpoints.
*   **`src/server/engine/MarketEngine.ts`**: The core brain. 
    *   Runs a continuous loop based on `refreshIntervalSeconds`.
    *   Fetches data via `BinanceService`, `YahooFinanceService`, and `SinaFinanceService`.
    *   Maintains the `MarketState` (price, MA60, deviation) in memory.
    *   Calculates anomalies (price jumps within a timeframe).
    *   Broadcasts state and alerts to all connected SSE clients.
*   **`src/App.tsx`**: The main UI. Connects to the SSE stream, manages sortable tables, renders the alert history, and handles the TradingView `ChartModal`.

## 4. Critical Domain Logic & Quirks

### 4.1 Symbol Mapping & Data Sources (CRITICAL)
Handling symbols across various APIs and TradingView is the most complex part of this app. The system must map user-friendly inputs to specific provider formats:

*   **Crypto (Binance)**: Standard format `BTCUSDT`.
*   **International Futures (Yahoo -> TradingView)**:
    *   User might input `GC1!` (TV format) or `GC=F` (Yahoo format).
    *   *Backend Logic*: Normalizes `1!` to `=F` to fetch data from Yahoo Finance.
    *   *Frontend Logic*: Maps `GC1!` to `COMEX:GC1!` for the TradingView widget to render correctly.
*   **Domestic Chinese Futures (Sina -> TradingView)**:
    *   User inputs e.g., `C0` (Corn Continuous), `C2607` (Corn specific month), `RB2501` (Rebar).
    *   *Backend Logic*: Passes the symbol directly to `SinaFinanceService` but uses `.toUpperCase()` for strict matching. Sina is used because Yahoo strictly rate-limits or lacks 1m data for Chinese futures.
    *   *Frontend Logic*: Uses regex (`/^[A-Z]{1,2}[0-9]{3,4}$/`) to detect domestic futures and attaches the correct Chinese exchange prefix (`SHFE:`, `DCE:`, `ZCE:`, `CFFEX:`) to make TradingView display the K-line. *Note: Data availability on TV for domestic futures varies by their data subscription, but the prefix logic is mathematically required.*

### 4.2 Calculation Rules
*   **MA60**: Requires exactly 60 data points. If the API returns fewer (e.g., Yahoo returning 0 points because the market is closed or rate limited), the backend will retain the last valid state instead of crashing.
*   **Deviation (偏离度)**: Formula is `((Current Price - MA60) / MA60) * 100`.

### 4.3 Background Polling vs Rate Limits
*   `YahooFinanceService` is prone to strict rate limits. 
*   `BinanceService` uses the `/api/v3/klines` REST endpoint, not websockets (to maintain consistency across all fetchers in the `MarketEngine`).

## 5. Known Pain Points for Future Development
1.  **Yahoo Finance Stability**: The `yahoo-finance2` library is used. If international futures stop updating, it's 99% likely a rate limit or a weekend market closure. 
2.  **Chart Modal Sync**: The `ChartModal` component in `App.tsx` completely relies on `window.TradingView`. Do not remove the fallback script injection logic there.
3.  **SSE Connection Dropping**: The browser might drop SSE connections if idle. The frontend `EventSource` handles basic auto-reconnects, but state might briefly blink empty (`[]`) during reconnection.

## 6. How to Continue Development
1.  Start the app with `npm run dev` (which runs `tsx server.ts`).
2.  Always verify symbol routing in `MarketEngine.ts` (lines ~140-160) if adding a new exchange.
3.  Do not attempt to convert the REST-based engine to WebSockets unless you are prepared to rewrite `YahooFinanceService` and `SinaFinanceService` (which do not support WS natively for K-lines).

---
*Document generated for AI handover. Safe to parse and ingest context.*
