# AI Project Context

> **Start Here**: Read [`HANDOVER.md`](HANDOVER.md) first for the latest end-to-end production topology, alert rules, push channels, and pitfalls.

## Project

- Workspace: `D:\AI\remix`
- Repo: `https://github.com/liyidao1993/quantum-monitor-alert`
- Runtime: Standalone headless market alert daemon (`tools/binance-alert-daemon.ts` -> bundled via `esbuild` to `dist-alert/binance-alert-daemon.cjs`)
- User preference: pragmatic, direct, avoid excessive details unless needed

## Critical Security Rule

Never print, log, or commit secrets:
- Telegram `bot_token` / `chat_id`
- Private `ntfy.topic`
- SSH private keys (`aliyun_remix_ed25519`)
- Weixin iLink credentials (`.runtime/weixin/token.json`, `state.json`)
- `.env` contents and local notes (`aliyun/总知识库.md`, `aliyun/网络资产.md`)

## Architecture

- `tools/binance-alert-daemon.ts`: Standalone headless alert daemon entry
- `tools/alert-daemon/*`: Config, alert rules, watchlist polling, market store, compact ntfy ranking formatter, notifiers, unit tests
- `Quantum_Monitor_System/2_Market_Modules/*/api_client/*`: Market API clients (Binance Futures, EastMoney A-share indices, Yahoo US stocks/indices/global futures, Sina CN futures)
- `Quantum_Monitor_System/4_Shared_Types/*`: Shared market types and symbol/display-name mappers
- `Quantum_Monitor_System/1_Core_Engine/settings.json`: Upstream endpoint config (gitignored; auto-sanitized on cloud deploy)
- `aliyun/`: One-click deploy & status scripts, sanitized config examples, and local-only `local-secrets/` backup

## Common Commands

```powershell
npm run lint
npm run test:alert-rules
npm run test:alert-watchlist
npm run test:market-store
npm run test:telegram-rich
npm run test:floating-receiver
npm run build:alert
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```

## Cloud Target (Aliyun ECS)

- Region / Instance: `cn-hongkong` (Zone C) / `i-j6cch8046l3vexqajegj`
- Public IP: `47.83.122.79`
- Remote dir: `/opt/quantum-alert` (user `quantum`)
- Services: `quantum-binance-alert.service` + `ntfy.service` (port `8090`)
- Always pass `-c safe.directory=D:/AI/remix` per Git command instead of changing global Git config.
