# AI TODO

This file tracks current follow-ups, risks, and useful next actions. Keep it short and update it after important changes.

## Highest Priority

- Keep `AI_DEPLOY_BINANCE_ALERT_ALIYUN.md` and `aliyun/README.md` updated whenever the Aliyun ECS deployment process changes.
- Keep cloud daemon configuration safe:
  - no desktop notifications on Linux VM
  - no local proxy values in cloud `settings.json`
  - JSON files UTF-8 without BOM
  - do not expose Telegram secrets

## Cloud Binance Alert Daemon (Aliyun ECS)

- One-click build and deploy script: `aliyun/deploy-aliyun-alert.ps1` (supports `-SkipBuild` for config-only updates).
- One-click status check script: `aliyun/check-aliyun-status.ps1`.

## Full UI App

- Continue watching for UI text overlap in compact dashboard cards.
- Keep homepage dense and readable.
- Avoid expensive animations that may cause lag.

## Alerts And News

- Price movement alerts should remain independent from MA60.
- MA60 deviation should be ranking/broadcast data only unless user explicitly asks for MA60 alert notifications.
- News should not replay old items in the top notification strip on every refresh.
- News cards should show source labels.
