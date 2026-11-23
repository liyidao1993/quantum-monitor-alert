# AI Project Context

This file is for future AI agents and for recovering working context when chat history is lost. Read this before making broad changes.

## Project

- Workspace: `D:\AI\remix`
- App name in UI: Quantum Monitor
- Main app: React/Vite frontend + Express/tsx backend in `server.ts`
- Lightweight daemon: standalone Binance alert daemon
- User preference: pragmatic, direct, avoid excessive details unless needed

## Critical Instruction

Do not expose secrets:

- Telegram `bot_token`
- Telegram `chat_id`
- SSH private keys
- `.env` contents
- Any API keys

If a task needs a secret, refer to the local config file path and mask values in summaries.

## Important Local Rules

- Shell commands should be prefixed with `rtk` when practical.
- Prefer `rg` / `rg --files` for search.
- Use `apply_patch` for file edits.
- Do not run destructive git commands.
- The Git repo may trigger `safe.directory` warnings; do not change global Git config unless the user explicitly asks.

## High-Level Architecture

- `server.ts`
  - Express API
  - SSE stream
  - module lifecycle API
  - settings read/write
  - market/news/alert endpoints

- `src/App.tsx`
  - main navigation
  - module power controls
  - SSE event distribution
  - global layout

- `src/views/*`
  - homepage dashboard
  - settings page
  - market pages
  - stock/futures/crypto views

- `Quantum_Monitor_System/2_Market_Modules/*`
  - backend market monitor modules
  - publish standardized ticks

- `Quantum_Monitor_System/1_Core_Engine/*`
  - config, lifecycle, event bus, alert engine

- `tools/binance-alert-daemon.ts`
  - standalone Binance alert daemon entry

- `tools/alert-daemon/*`
  - standalone alert/ranking/notifier logic

- `dist-alert/binance-alert-daemon.cjs`
  - compiled standalone daemon artifact

## Common Commands

Full app:

```powershell
rtk npm run dev
rtk npm run lint
rtk npm run build
```

Standalone Binance daemon:

```powershell
rtk npm run dev:alert
rtk npm run build:alert
rtk npm run start:alert
```

Local one-click scripts:

```text
D:\AI\remix\一键启动.bat
D:\AI\remix\币安预警守护.bat
D:\AI\remix\start-remix.ps1
D:\AI\remix\stop-remix-watchdog.ps1
```

## Current Cloud Deployment

Standalone Binance alert daemon is deployed on Aliyun ECS (`cn-hongkong`).

Read this file for exact deployment/update steps:

```text
D:\AI\remix\AI_DEPLOY_BINANCE_ALERT_ALIYUN.md
D:\AI\remix\aliyun\README.md
```

Current successful target:

- Cloud Provider: Aliyun ECS (`cn-hongkong`, 中国香港 C)
- Instance ID: `i-j6cch8046l3vexqajegj`
- Public IP: `47.83.122.79`
- Remote dir: `/opt/quantum-alert`
- Service: `quantum-binance-alert.service`

Important cloud notes:

- Cloud config disables desktop notifications.
- JSON files must be UTF-8 without BOM.

## Current Alert Daemon Behavior

The standalone Binance daemon is designed to be lightweight:

- No React
- No Vite
- No full Express backend
- Node single-file daemon
- Telegram notifications
- Optional ranking broadcast
- No cloud desktop notifications
- systemd restart on failure

Current expected cloud memory is roughly `68MB` for the Node process.

User requirements already implemented in this daemon:

- Instant price movement alerts are price-move based, not MA60 based.
- No standalone MA60 alert notifications.
- Ranking broadcast can include:
  - 24h gain
  - 24h loss
  - 1m MA60 deviation
  - 15m MA60 deviation
  - day MA60 deviation
- Telegram command/query support exists or is planned around top ranking queries.

## Documentation Files

Deployment handoff:

```text
AI_DEPLOY_BINANCE_ALERT_ALIYUN.md
aliyun\README.md
```

This project context:

```text
AI_PROJECT_CONTEXT.md
```

Task list:

```text
AI_TODO.md
```

## UI State Notes

The full Quantum Monitor UI has undergone visual improvements:

- Dark trading terminal style
- Compact homepage dashboard
- Top notification strip
- Market ranking matrix
- News cards with source labels
- Alert stream
- Settings page code reference entries
- Market pages with compact tables

Known preference:

- Keep UI dense, readable, and practical.
- Avoid oversized marketing layout.
- Avoid heavy blur/glow animations that cause lag.

## Useful Verification

Full app local health:

```powershell
rtk powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health"
```

Cloud daemon status:

```powershell
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```

Expected cloud logs:

```text
Binance alert daemon starting
Monitoring 50 Binance symbols
WebSocket connected
Telegram ranking broadcast sent
```

