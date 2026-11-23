param(
  [string]$HostIp = "47.83.122.79",
  [string]$SshUser = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\aliyun_remix_ed25519",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath $KeyPath)) {
  $fallbackKey = Join-Path $ProjectRoot "aliyun\local-secrets\aliyun_remix_ed25519"
  if (Test-Path -LiteralPath $fallbackKey) {
    $KeyPath = $fallbackKey
  } else {
    throw "SSH private key not found: $KeyPath (fallback also missing: $fallbackKey)"
  }
}

if (-not $SkipBuild) {
  Write-Host "=== 1. Building alert daemon ==="
  npm run build:alert
}

Write-Host "=== 2. Staging cloud-sanitized package ==="
$StageDir = Join-Path $ProjectRoot ".runtime\aliyun-deploy"
$TarPath = Join-Path $ProjectRoot ".runtime\alert-daemon-aliyun-deploy.tar.gz"
$ServicePath = Join-Path $ProjectRoot ".runtime\quantum-binance-alert.service"

Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "dist-alert") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "Quantum_Monitor_System\1_Core_Engine") | Out-Null

Copy-Item -LiteralPath "dist-alert\binance-alert-daemon.cjs" -Destination (Join-Path $StageDir "dist-alert\binance-alert-daemon.cjs") -Force
Copy-Item -LiteralPath "alert-daemon.config.json" -Destination (Join-Path $StageDir "alert-daemon.config.json") -Force
Copy-Item -LiteralPath "Quantum_Monitor_System\1_Core_Engine\settings.json" -Destination (Join-Path $StageDir "Quantum_Monitor_System\1_Core_Engine\settings.json") -Force

@'
const fs = require("fs");
const stripBom = (s) => s.replace(/^\uFEFF/, "");

const hasWeixinCreds = fs.existsSync(".runtime/weixin/token.json");
const cfgPath = ".runtime/aliyun-deploy/alert-daemon.config.json";
const cfg = JSON.parse(stripBom(fs.readFileSync(cfgPath, "utf8")));
if (cfg.desktop_notify) cfg.desktop_notify.enabled = false;
if (cfg.ranking_broadcast) {
  cfg.ranking_broadcast.desktop_enabled = false;
  if (!hasWeixinCreds) cfg.ranking_broadcast.weixin_enabled = false;
}
if (cfg.weixin && !hasWeixinCreds) cfg.weixin.enabled = false;
if (cfg.logging) cfg.logging.file_enabled = false;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");

const setPath = ".runtime/aliyun-deploy/Quantum_Monitor_System/1_Core_Engine/settings.json";
const setObj = JSON.parse(stripBom(fs.readFileSync(setPath, "utf8")));
if (setObj.ApiEndpointSettings) {
  setObj.ApiEndpointSettings.socks_proxy = "";
  setObj.ApiEndpointSettings.https_proxy = "";
}
fs.writeFileSync(setPath, JSON.stringify(setObj, null, 2) + "\n", "utf8");
console.log("Cloud configs sanitized (UTF-8 no BOM, file logging/desktop disabled, proxies cleared, weixin_enabled=" + Boolean(cfg.weixin && cfg.weixin.enabled) + ").");
'@ | node -

if (Test-Path -LiteralPath ".runtime\weixin\token.json") {
  New-Item -ItemType Directory -Force -Path (Join-Path $StageDir ".runtime\weixin") | Out-Null
  Copy-Item -LiteralPath ".runtime\weixin\token.json" -Destination (Join-Path $StageDir ".runtime\weixin\token.json") -Force
  # Keep remote live state.json intact; only ship state.json.seed for first-time initialization
  if (Test-Path -LiteralPath ".runtime\weixin\state.json") {
    Copy-Item -LiteralPath ".runtime\weixin\state.json" -Destination (Join-Path $StageDir ".runtime\weixin\state.json.seed") -Force
  }
}

Remove-Item -LiteralPath $TarPath -Force -ErrorAction SilentlyContinue
tar -czf $TarPath -C $StageDir .

$serviceContent = @"
[Unit]
Description=Quantum Binance Alert Daemon
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=quantum
Group=quantum
WorkingDirectory=/opt/quantum-alert
ExecStart=/usr/bin/node /opt/quantum-alert/dist-alert/binance-alert-daemon.cjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
MemoryHigh=384M
MemoryMax=512M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/quantum-alert/.runtime

[Install]
WantedBy=multi-user.target
"@ -replace "`r`n", "`n"
[IO.File]::WriteAllText($ServicePath, $serviceContent, (New-Object System.Text.UTF8Encoding($false)))

# Bypass FlClash/TUN if active by binding to physical LAN IPv4
$physIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.InterfaceAlias -notmatch 'FlClash|Clash|Loopback|vEthernet|WSL|Tailscale|ZeroTier' -and
  $_.IPAddress -notmatch '^169\.254\.'
} | Select-Object -First 1).IPAddress

$sshOpts = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15")
if ($physIp) {
  Write-Host "Binding SSH to physical interface IP: $physIp"
  $sshOpts += @("-o", "BindAddress=$physIp")
}

Write-Host "=== 3. Uploading tar.gz & service unit to ${SshUser}@${HostIp} ==="
scp @sshOpts $TarPath "${SshUser}@${HostIp}:/tmp/alert-daemon-aliyun-deploy.tar.gz"
scp @sshOpts $ServicePath "${SshUser}@${HostIp}:/tmp/quantum-binance-alert.service"

Write-Host "=== 4. Deploying & restarting systemd service ==="
$remoteScript = @'
set -euo pipefail
if ! id -u quantum >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin quantum
fi
mkdir -p /opt/quantum-alert/.runtime/alert-daemon
tar -xzf /tmp/alert-daemon-aliyun-deploy.tar.gz -C /opt/quantum-alert
if [ -f /opt/quantum-alert/.runtime/weixin/state.json.seed ]; then
  if [ ! -f /opt/quantum-alert/.runtime/weixin/state.json ]; then
    mv /opt/quantum-alert/.runtime/weixin/state.json.seed /opt/quantum-alert/.runtime/weixin/state.json
  else
    rm -f /opt/quantum-alert/.runtime/weixin/state.json.seed
  fi
fi
chown -R quantum:quantum /opt/quantum-alert
chmod 750 /opt/quantum-alert
chmod 600 /opt/quantum-alert/alert-daemon.config.json /opt/quantum-alert/Quantum_Monitor_System/1_Core_Engine/settings.json
if [ -d /opt/quantum-alert/.runtime/weixin ]; then
  chmod 700 /opt/quantum-alert/.runtime/weixin
  chmod 600 /opt/quantum-alert/.runtime/weixin/*.json 2>/dev/null || true
fi
cp /tmp/quantum-binance-alert.service /etc/systemd/system/quantum-binance-alert.service
chmod 644 /etc/systemd/system/quantum-binance-alert.service
systemctl daemon-reload
systemctl enable quantum-binance-alert
systemctl restart quantum-binance-alert
rm -f /opt/quantum-alert/.runtime/alert-daemon/binance-alert-daemon.log
sleep 12
systemctl is-active quantum-binance-alert
systemctl --no-pager status quantum-binance-alert | head -n 16
journalctl -u quantum-binance-alert --since "20 seconds ago" --no-pager -n 40
'@

$remoteScript | ssh @sshOpts "${SshUser}@${HostIp}" "tr -d '\r' | bash -s"
