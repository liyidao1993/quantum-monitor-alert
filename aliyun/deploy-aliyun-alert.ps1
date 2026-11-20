param(
  [string]$HostIp = "47.83.122.79",
  [string]$SshUser = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\aliyun_remix_ed25519",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $ProjectRoot "tools\deploy-aliyun-alert.ps1") -HostIp $HostIp -SshUser $SshUser -KeyPath $KeyPath -SkipBuild:$SkipBuild
