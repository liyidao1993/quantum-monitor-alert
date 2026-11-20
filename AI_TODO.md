# AI TODO

This file tracks current follow-ups, risks, and useful next actions. Keep it short and update it after important changes.

## Highest Priority

- Keep `AI_DEPLOY_BINANCE_ALERT_GCP.md` updated whenever the Google Cloud deployment process changes.
- Keep cloud daemon configuration safe:
  - no desktop notifications on Linux VM
  - no local proxy values in cloud `settings.json`
  - JSON files UTF-8 without BOM
  - do not expose Telegram secrets

## Cloud Binance Alert Daemon

- Consider adding a one-click local deployment script:
  - `deploy-gcp-binance-alert.ps1`
  - builds `dist-alert`
  - prepares cloud package
  - uploads zip and service
  - restarts systemd
  - verifies logs

- Consider adding a config-only upload script:
  - `upload-alert-config-gcp.ps1`
  - uploads `alert-daemon.config.json`
  - strips BOM remotely or locally
  - restarts service
  - prints last 80 logs

- Consider adding a safe rollback step:
  - keep `/opt/quantum-alert.bak-YYYYMMDD-HHMMSS` before overwriting cloud deployment
  - restore backup if new service fails

- Confirm Telegram bot command support after next daemon changes:
  - 24h gain top N
  - 24h loss top N
  - 1m MA60 deviation top N
  - 15m MA60 deviation top N
  - day MA60 deviation top N

## Full UI App

- Continue watching for UI text overlap in compact dashboard cards.
- Keep homepage dense and readable.
- Avoid expensive animations that may cause lag.
- If frontend changes are made, verify:
  - desktop `1440x960`
  - top strip wide screenshot
  - mobile `390x844`
  - settings page
  - market pages

## Alerts And News

- Price movement alerts should remain independent from MA60.
- MA60 deviation should be ranking/broadcast data only unless user explicitly asks for MA60 alert notifications.
- News should not replay old items in the top notification strip on every refresh.
- News cards should show source labels.

## Deployment Warnings

- Do not deploy Binance daemon to US Google Cloud regions. Binance returned `451 Region Restricted`.
- Cloud Shell was unreliable in this environment; prefer local `gcloud`.
- Browser console VM create was unreliable; prefer local `gcloud compute instances create`.
- Complex `gcloud compute ssh --command` quoting can break on Windows PowerShell; upload scripts/files when commands are complex.

## Useful Next User Prompts

If chat history is lost, the user can say:

```text
先读 D:\AI\remix\AI_PROJECT_CONTEXT.md 和 AI_DEPLOY_BINANCE_ALERT_GCP.md，然后帮我继续。
```

For deployment:

```text
先读 AI_DEPLOY_BINANCE_ALERT_GCP.md，帮我打包并上传币安预警守护到 Google Cloud。
```

For full app work:

```text
先读 AI_PROJECT_CONTEXT.md 和 AI_TODO.md，检查项目现状后继续开发。
```

