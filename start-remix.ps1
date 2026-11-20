$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "    $Message" -ForegroundColor Green
}

function Assert-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Get-EnvPort {
  $defaultPort = 3000
  $envPath = Join-Path $projectRoot ".env"

  if (-not (Test-Path -LiteralPath $envPath)) {
    return $defaultPort
  }

  $portLine = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } |
    Select-Object -First 1

  if ($portLine -match '^\s*PORT\s*=\s*(\d+)\s*$') {
    return [int]$Matches[1]
  }

  return $defaultPort
}

function Test-PortInUse {
  param([int]$Port)

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $listener
}

function Stop-ProcessTree {
  param([int]$RootProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-ExistingQuantumOnPort {
  param([int]$Port)

  if (-not (Test-PortInUse -Port $Port)) {
    return
  }

  $healthUrl = "http://127.0.0.1:$Port/api/health"
  $isQuantum = $false
  try {
    $content = (Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 2).Content
    $isQuantum = $content -match '"status"\s*:\s*"ok"'
  } catch {
    $isQuantum = $false
  }

  if (-not $isQuantum) {
    throw "Port $Port is already in use by another program. Close it first or change PORT in .env."
  }

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    Write-Host "    Existing Quantum Monitor found on port $Port; stopping PID $($listener.OwningProcess)..." -ForegroundColor Yellow
    Stop-ProcessTree -RootProcessId ([int]$listener.OwningProcess)
  }

  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Test-PortInUse -Port $Port)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Port $Port is still busy after stopping the existing Quantum Monitor process."
}

$serverProcess = $null
$watchdogProcess = $null

try {
  Write-Host "Quantum Monitor one-click launcher" -ForegroundColor Yellow
  Write-Host "Project: $projectRoot"

  Write-Step "Checking runtime"
  Assert-Command -Name "node" -InstallHint "Please install Node.js LTS first: https://nodejs.org/"
  Assert-Command -Name "npm" -InstallHint "npm is included with a normal Node.js installation."
  Write-Ok "Node: $(node --version)"
  Write-Ok "npm:  $(npm --version)"

  Write-Step "Checking environment config"
  $envPath = Join-Path $projectRoot ".env"
  $envExamplePath = Join-Path $projectRoot ".env.example"
  if (-not (Test-Path -LiteralPath $envPath)) {
    if (Test-Path -LiteralPath $envExamplePath) {
      Copy-Item -LiteralPath $envExamplePath -Destination $envPath
      Write-Ok "Created .env from .env.example"
    } else {
      Write-Host "    .env.example was not found; skipped .env creation." -ForegroundColor Yellow
    }
  } else {
    Write-Ok ".env already exists"
  }

  Write-Step "Checking dependencies"
  $nodeModulesPath = Join-Path $projectRoot "node_modules"
  if (-not (Test-Path -LiteralPath $nodeModulesPath)) {
    Write-Host "    node_modules is missing; running npm install..."
    npm install
  } else {
    Write-Ok "node_modules already exists"
  }

  Write-Step "Checking port"
  $port = Get-EnvPort
  Stop-ExistingQuantumOnPort -Port $port
  $env:PORT = "$port"
  Write-Ok "Port $port is available"

  $url = "http://localhost:$port"
  $logsDir = Join-Path $projectRoot ".runtime\launcher"
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
  $stdoutPath = Join-Path $logsDir "server.out.log"
  $stderrPath = Join-Path $logsDir "server.err.log"
  $watchdogPath = Join-Path $projectRoot "stop-remix-watchdog.ps1"

  Write-Step "Starting server"
  $serverProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/s", "/c", "npm run dev") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru `
    -WindowStyle Hidden

  $watchdogProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $watchdogPath,
      "-ParentPid", "$PID",
      "-ServerPid", "$($serverProcess.Id)"
    ) `
    -WorkingDirectory $projectRoot `
    -PassThru `
    -WindowStyle Hidden

  Write-Ok "Server PID: $($serverProcess.Id)"
  Write-Ok "Watchdog PID: $($watchdogProcess.Id)"
  Write-Host "    Browser URL: $url" -ForegroundColor Green
  Write-Host "    Logs: $logsDir"
  Write-Host ""
  Write-Host "Keep this window open while using Quantum Monitor." -ForegroundColor Yellow
  Write-Host "Close this window, press Ctrl+C, or press Q to stop the backend."
  Write-Host ""

  Start-Sleep -Seconds 3
  Start-Process $url

  while (-not $serverProcess.HasExited) {
    if ([Console]::KeyAvailable) {
      $key = [Console]::ReadKey($true)
      if ($key.Key -eq "Q") {
        break
      }
    }
    Start-Sleep -Milliseconds 250
    $serverProcess.Refresh()
  }
} catch {
  Write-Host ""
  Write-Host "Launch failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "Press any key to close..."
  [void][System.Console]::ReadKey($true)
  exit 1
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Write-Step "Stopping backend"
    Stop-ProcessTree -RootProcessId $serverProcess.Id
    Write-Ok "Backend stopped"
  }

  if ($watchdogProcess -and -not $watchdogProcess.HasExited) {
    Stop-Process -Id $watchdogProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
