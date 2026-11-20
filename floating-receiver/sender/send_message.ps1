param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$Body,

    [ValidateSet("info", "success", "warning", "error")]
    [string]$Level = "info"
)

$headers = @{ Authorization = "Bearer $Token" }
$payload = @{
    title = $Title
    body = $Body
    level = $Level
} | ConvertTo-Json
$endpoint = "$($ServerUrl.TrimEnd('/'))/api/messages"

Invoke-RestMethod `
    -Uri $endpoint `
    -Method Post `
    -Headers $headers `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
