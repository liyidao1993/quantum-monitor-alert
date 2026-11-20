param(
  [Parameter(Mandatory = $true)]
  [int]$ParentPid,

  [Parameter(Mandatory = $true)]
  [int]$ServerPid
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-ProcessTree {
  param([int]$RootProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootProcessId"
  foreach ($child in $children) {
    Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $RootProcessId
  if ($process) {
    Stop-Process -Id $RootProcessId -Force
  }
}

while ($true) {
  $parent = Get-Process -Id $ParentPid
  $server = Get-Process -Id $ServerPid

  if (-not $server) {
    exit 0
  }

  if (-not $parent) {
    Stop-ProcessTree -RootProcessId $ServerPid
    exit 0
  }

  Start-Sleep -Seconds 1
}
