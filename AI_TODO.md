# AI TODO

This file tracks current follow-ups and guardrails. Keep it short and update it after important changes.

## Highest Priority

- Keep `HANDOVER.md` and `aliyun/README.md` updated whenever alert rules, watchlist structure, or Aliyun ECS deployment changes.
- Keep cloud daemon configuration safe:
  - no desktop notifications on Linux VM
  - no local proxy values in cloud `settings.json`
  - JSON files UTF-8 without BOM
  - never expose or commit secrets (`alert-daemon.config.json`, `settings.json`, `aliyun/local-secrets/`, `.runtime/weixin/`)

## Cloud Alert Daemon (Aliyun ECS)

- One-click build and deploy script: `aliyun/deploy-aliyun-alert.ps1` (supports `-SkipBuild` for config-only updates).
- One-click status check script: `aliyun/check-aliyun-status.ps1`.
- Monitor 30 pure-crypto Binance perpetuals (`90s >= 5%`) and 20 Watchlist items including A-share/US major indices (`90s >= 1%`), currently running unrestricted (`base_seconds=0`, `max_alerts_per_symbol_per_10min=0`, `watchlist_confirm_spike=false`).
- Keep active MA60 deviation alerts disabled unless explicitly requested; MA60 deviations remain in the 10-minute periodic broadcast.
