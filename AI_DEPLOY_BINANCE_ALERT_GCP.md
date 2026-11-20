# AI Handoff: Deploy Binance Alert Daemon To Google Cloud

This file is for future AI agents. If the user asks to update, package, upload, redeploy, or verify the standalone Binance alert daemon on Google Cloud, read this file first.

Do not print or expose Telegram `bot_token`, `chat_id`, SSH private keys, `.env`, or API keys.

## Current Target

- Workspace: `D:\AI\remix`
- Google Cloud account: `599267295@qq.com`
- Project ID: `gen-lang-client-0499133969`
- VM name: `quantum-binance-alert-asia`
- VM zone: `asia-east1-b`
- VM type: `e2-micro`
- Remote app dir: `/opt/quantum-alert`
- systemd service: `quantum-binance-alert.service`
- Local gcloud path: `C:\Users\ligongzi\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`

Avoid US regions for this daemon. `us-central1` created successfully but Binance returned `451 Region Restricted`. `asia-east1-b` worked.

## Files To Package

- `dist-alert/binance-alert-daemon.cjs`
- `alert-daemon.config.json`
- `Quantum_Monitor_System/1_Core_Engine/settings.json`

Staging package:

- `.runtime/gcp-deploy/*`
- `.runtime/alert-daemon-gcp-deploy.zip`

## Cloud Config Rules

Before packaging for cloud:

- Set `desktop_notify.enabled=false`.
- Set `ranking_broadcast.desktop_enabled=false`.
- Remove local proxy values in cloud `settings.json`:
  - `ApiEndpointSettings.socks_proxy=""`
  - `ApiEndpointSettings.https_proxy=""`
- Ensure JSON files are UTF-8 without BOM.

BOM failure looks like:

```text
SyntaxError: Unexpected token ﻿ in JSON at position 0
```

## Fast Full Update

Run from PowerShell in `D:\AI\remix`.

```powershell
$ErrorActionPreference = "Stop"
$gcloud = "C:\Users\ligongzi\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

rtk npm run build:alert

Remove-Item -LiteralPath ".runtime\gcp-deploy" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path ".runtime\gcp-deploy\dist-alert" | Out-Null
New-Item -ItemType Directory -Force -Path ".runtime\gcp-deploy\Quantum_Monitor_System\1_Core_Engine" | Out-Null

Copy-Item -LiteralPath "dist-alert\binance-alert-daemon.cjs" -Destination ".runtime\gcp-deploy\dist-alert\binance-alert-daemon.cjs" -Force
Copy-Item -LiteralPath "alert-daemon.config.json" -Destination ".runtime\gcp-deploy\alert-daemon.config.json" -Force
Copy-Item -LiteralPath "Quantum_Monitor_System\1_Core_Engine\settings.json" -Destination ".runtime\gcp-deploy\Quantum_Monitor_System\1_Core_Engine\settings.json" -Force

$configPath = ".runtime\gcp-deploy\alert-daemon.config.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.desktop_notify) { $config.desktop_notify.enabled = $false }
if ($config.ranking_broadcast) { $config.ranking_broadcast.desktop_enabled = $false }
$config | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $configPath -Encoding UTF8

$settingsPath = ".runtime\gcp-deploy\Quantum_Monitor_System\1_Core_Engine\settings.json"
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
if ($settings.ApiEndpointSettings) {
  $settings.ApiEndpointSettings.socks_proxy = ""
  $settings.ApiEndpointSettings.https_proxy = ""
}
$settings | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($p in @($configPath, $settingsPath)) {
  $resolved = Resolve-Path $p
  $text = [IO.File]::ReadAllText($resolved, [Text.Encoding]::UTF8)
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  [IO.File]::WriteAllText($resolved, $text, $utf8NoBom)
}

if (Test-Path ".runtime\alert-daemon-gcp-deploy.zip") {
  Remove-Item -LiteralPath ".runtime\alert-daemon-gcp-deploy.zip" -Force
}
Compress-Archive -Path ".runtime\gcp-deploy\*" -DestinationPath ".runtime\alert-daemon-gcp-deploy.zip" -Force
```

Ensure service file:

```powershell
@"
[Unit]
Description=Quantum Binance Alert Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/quantum-alert
ExecStart=/usr/bin/node /opt/quantum-alert/dist-alert/binance-alert-daemon.cjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
"@ | Set-Content -LiteralPath ".runtime\quantum-binance-alert.service" -Encoding ASCII
```

Upload and restart:

```powershell
& $gcloud compute scp ".runtime\alert-daemon-gcp-deploy.zip" "quantum-binance-alert-asia:/tmp/alert-daemon-gcp-deploy.zip" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" --quiet

& $gcloud compute scp ".runtime\quantum-binance-alert.service" "quantum-binance-alert-asia:/tmp/quantum-binance-alert.service" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" --quiet

$remote = "sudo mkdir -p /opt/quantum-alert && sudo unzip -o /tmp/alert-daemon-gcp-deploy.zip -d /opt/quantum-alert && sudo cp /tmp/quantum-binance-alert.service /etc/systemd/system/quantum-binance-alert.service && sudo systemctl daemon-reload && sudo systemctl enable --now quantum-binance-alert && sudo systemctl restart quantum-binance-alert && sleep 8 && sudo systemctl is-active quantum-binance-alert && sudo journalctl -u quantum-binance-alert -n 100 --no-pager"

& $gcloud compute ssh "quantum-binance-alert-asia" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" `
  --command=$remote --quiet
```

## Config-Only Update

```powershell
$gcloud = "C:\Users\ligongzi\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

& $gcloud compute scp "D:\AI\remix\alert-daemon.config.json" "quantum-binance-alert-asia:/tmp/alert-daemon.config.json" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" --quiet

& $gcloud compute ssh "quantum-binance-alert-asia" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" `
  --command="sudo cp /tmp/alert-daemon.config.json /opt/quantum-alert/alert-daemon.config.json && sudo systemctl restart quantum-binance-alert && sleep 5 && sudo systemctl is-active quantum-binance-alert && sudo journalctl -u quantum-binance-alert -n 80 --no-pager" `
  --quiet
```

## Verification

```powershell
$gcloud = "C:\Users\ligongzi\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

& $gcloud compute ssh "quantum-binance-alert-asia" `
  --project="gen-lang-client-0499133969" --zone="asia-east1-b" `
  --command="sudo systemctl --no-pager --full status quantum-binance-alert; sudo journalctl -u quantum-binance-alert -n 120 --no-pager; ps -o pid,rss,pcpu,cmd -C node" `
  --quiet
```

Expected:

- `Active: active (running)`
- `Binance alert daemon starting`
- `Monitoring 50 Binance symbols`
- `WebSocket connected`
- `Telegram ranking broadcast sent`

## Related Files

- `D:\AI\remix\AI_PROJECT_CONTEXT.md`
- `D:\AI\remix\AI_TODO.md`
- `D:\AI\remix\Quantum_Monitor_System\0_Docs\GoogleCloud_币安预警守护部署经验.md`
- `C:\Users\ligongzi\.codex\skills\gcp-binance-alert-deploy\SKILL.md`

