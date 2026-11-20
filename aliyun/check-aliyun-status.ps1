param(
  [string]$HostIp = "47.83.122.79",
  [string]$SshUser = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\aliyun_remix_ed25519",
  [int]$LogLines = 30
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $KeyPath)) {
  $fallbackKey = Join-Path $PSScriptRoot "local-secrets\aliyun_remix_ed25519"
  if (Test-Path -LiteralPath $fallbackKey) { $KeyPath = $fallbackKey }
}

$physIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.InterfaceAlias -notmatch 'FlClash|Clash|Loopback|vEthernet|WSL|Tailscale|ZeroTier' -and
  $_.IPAddress -notmatch '^169\.254\.'
} | Select-Object -First 1).IPAddress

$sshOpts = @("-i", $KeyPath, "-o", "ConnectTimeout=10")
if ($physIp) { $sshOpts += @("-o", "BindAddress=$physIp") }

$remote = @"
echo "=== 1. LOAD & MEMORY ==="
uptime
free -h
df -h /
echo "=== 2. SERVICES ==="
systemctl is-active quantum-binance-alert ntfy
ps -eo user,pid,etime,rss,%mem,%cpu,comm --sort=-rss | head -n 7
echo "=== 3. NTFY CLIENTS (port 8090) ==="
ss -tnp 'sport = :8090'
echo "=== 4. RECENT LOGS (last $LogLines lines) ==="
journalctl -u quantum-binance-alert -n $LogLines --no-pager
"@

$remote | ssh @sshOpts "${SshUser}@${HostIp}" "tr -d '\r' | bash -s"
