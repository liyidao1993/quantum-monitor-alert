# AI Handoff: Deploy Binance Alert Daemon To Aliyun ECS

> **Primary Handover**: See [`HANDOVER.md`](HANDOVER.md) and [`aliyun/README.md`](aliyun/README.md) for the latest full operations guide (including `ntfy` push, 20m cooldown, and CN/US index broadcasts).

This file is for future AI agents. If the user asks to update, package, upload, redeploy, or verify the standalone headless Binance alert daemon on Aliyun ECS, read `HANDOVER.md` and this file first.

Do not print or expose Telegram `bot_token`, `chat_id`, SSH private keys, `.env`, or API keys.

## Current Target

- Workspace: `D:\AI\remix`
- Cloud Provider: Aliyun ECS (`cn-hongkong`, 中国香港 C)
- Instance ID: `i-j6cch8046l3vexqajegj`
- Public IP: `47.83.122.79`
- Specs: 2 vCPU / 1.7 GiB RAM + 1 GiB Swap / 40 GB Disk / Ubuntu 22.04
- Node.js: v20 LTS (`/usr/bin/node`)
- Remote app dir: `/opt/quantum-alert` (owned by low-privilege system user `quantum`)
- systemd service: `quantum-binance-alert.service`
- Local SSH private key: `C:\Users\ligongzi\.ssh\aliyun_remix_ed25519` (auto-falls back to `aliyun\local-secrets\aliyun_remix_ed25519`)
- Self-hosted push service: `ntfy.service` (`http://47.83.122.79:8090`, config `/etc/ntfy/server.yml`)

## Important Findings & Rules

1. **Binance Futures Mainnet WebSocket URL**:
   - Use `wss://fstream.binance.com/market/stream` (matches mainnet REST `https://fapi.binance.com`).
   - Do NOT use `wss://fstream.binance.com/stream` (connects but emits 0 frames) or `wss://fstream.binancefuture.com/stream` (misses TradFi/newly listed symbols).
2. **Local FlClash TUN Bypass**:
   - Local Windows often runs FlClash TUN, which drops outbound TCP port 22.
   - Always pass `-o BindAddress=<physical LAN IPv4>` (auto-detected inside `tools/deploy-aliyun-alert.ps1`).
3. **Cloud Config Sanitization (automatic in deploy script)**:
   - `desktop_notify.enabled = false`
   - `ranking_broadcast.desktop_enabled = false`
   - `ranking_broadcast.weixin_enabled = false`
   - `weixin.enabled = false` (unless Weixin QR credentials are deployed)
   - `logging.file_enabled = false` (logs are managed exclusively by `systemd-journald` capped at 200 MB)
   - `ApiEndpointSettings.socks_proxy = ""` and `https_proxy = ""`
   - UTF-8 without BOM; archive via `tar.gz` (avoids Windows backslash zip warnings).
4. **Hardening**:
   - Service runs as non-root `quantum` with `MemoryHigh=384M`, `MemoryMax=512M`, `NODE_OPTIONS=--max-old-space-size=384`, `ProtectSystem=strict`, `NoNewPrivileges=true`.
   - Secrets (`alert-daemon.config.json`, `settings.json`) are `chmod 600`.

## One-Command Full Build & Deploy

Run from PowerShell in `D:\AI\remix`:

```powershell
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1
# Config-only update (skip esbuild):
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1 -SkipBuild
```

## Quick Remote Verification

```powershell
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```
