[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [string]$SessionId,
    [string]$ResourceId,
    [string]$UserId,
    [string]$DisconnectReason,
    [string]$SessionStartedAt,
    [switch]$IncludeProcessMetrics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedBaseUrl {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) {
        throw "ServerUrl is required."
    }
    return $Url.TrimEnd('/')
}

function Get-SessionStatePath {
    $programData = if ($env:ProgramData) { $env:ProgramData } else { Join-Path -Path $env:SystemDrive -ChildPath 'ProgramData' }
    return Join-Path -Path (Join-Path -Path $programData -ChildPath 'Rdpstste') -ChildPath 'session-state.json'
}

function ConvertTo-Hashtable {
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    $table = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
        $table[$property.Name] = $property.Value
    }
    return $table
}

function Load-SessionState {
    $path = Get-SessionStatePath
    if (Test-Path -LiteralPath $path) {
        try {
            $raw = Get-Content -Path $path -Raw | ConvertFrom-Json -ErrorAction Stop
            return ConvertTo-Hashtable -InputObject $raw
        }
        catch {
            Write-Warning ("Unable to read session state: {0}" -f $_.Exception.Message)
        }
    }
    return $null
}

function Remove-SessionState {
    $path = Get-SessionStatePath
    if (Test-Path -LiteralPath $path) {
        try {
            Remove-Item -LiteralPath $path -Force
        }
        catch {
            Write-Warning ("Unable to remove session state file: {0}" -f $_.Exception.Message)
        }
    }
}

$state = Load-SessionState

if (-not $SessionId -and $state) { $SessionId = $state.sessionId }
if (-not $ResourceId -and $state) { $ResourceId = $state.resourceId }
if (-not $UserId -and $state) { $UserId = $state.userId }
if (-not $SessionStartedAt -and $state) { $SessionStartedAt = $state.startedAt }
if (-not $DisconnectReason) { $DisconnectReason = $env:RDP_DISCONNECT_REASON }
if (-not $SessionId) { $SessionId = $env:SESSIONNAME }
if (-not $ResourceId) { $ResourceId = $env:COMPUTERNAME }
if (-not $UserId) { $UserId = $env:USERNAME }

$baseUrl = Get-NormalizedBaseUrl -Url $ServerUrl
$endpoint = "$baseUrl/api/sessions/end"

$timestamp = (Get-Date).ToUniversalTime()
$payload = [ordered]@{
    timestamp = $timestamp.ToString('o')
    event     = 'session.end'
}

if ($SessionId) { $payload.sessionId = $SessionId }
if ($ResourceId) { $payload.resourceId = $ResourceId }
if ($UserId) { $payload.userId = $UserId }

if (-not [string]::IsNullOrWhiteSpace($SessionStartedAt)) {
    try {
        $startTime = [DateTime]::Parse($SessionStartedAt).ToUniversalTime()
        $payload.sessionDurationSeconds = [Math]::Round(($timestamp - $startTime).TotalSeconds, 0)
    }
    catch {
        Write-Warning ("Unable to parse SessionStartedAt '{0}': {1}" -f $SessionStartedAt, $_.Exception.Message)
    }
}

if (-not [string]::IsNullOrWhiteSpace($DisconnectReason)) {
    $payload.disconnectReason = $DisconnectReason
}

if ($state -and -not [string]::IsNullOrWhiteSpace($state.lastHeartbeatAt)) {
    try {
        $lastHeartbeat = [DateTime]::Parse($state.lastHeartbeatAt).ToUniversalTime()
        $payload.secondsSinceLastHeartbeat = [Math]::Round(($timestamp - $lastHeartbeat).TotalSeconds, 0)
    }
    catch {
        Write-Warning ("Unable to parse lastHeartbeatAt '{0}': {1}" -f $state.lastHeartbeatAt, $_.Exception.Message)
    }
}

if ($state -and ($state.ContainsKey('lastIdleSeconds')) -and $null -ne $state['lastIdleSeconds']) {
    $payload.lastObservedIdleSeconds = [Math]::Round([double]$state['lastIdleSeconds'], 0)
}

if ($IncludeProcessMetrics) {
    try {
        $currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.SI -eq $currentSessionId }
        if ($processes) {
            $cpuSeconds = ($processes | Measure-Object -Property CPU -Sum).Sum
            $workingSet = ($processes | Measure-Object -Property WorkingSet64 -Sum).Sum
            $payload.resourceMetrics = [ordered]@{}
            if ($cpuSeconds) { $payload.resourceMetrics.cpuTimeSeconds = [Math]::Round($cpuSeconds, 2) }
            if ($workingSet) { $payload.resourceMetrics.workingSetBytes = [int64]$workingSet }
            $payload.resourceMetrics.processCount = $processes.Count
        }
    }
    catch {
        Write-Warning ("Unable to gather process metrics: {0}" -f $_.Exception.Message)
    }
}

try {
    $json = $payload | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $json -ContentType 'application/json' | Out-Null
    Write-Host "Session end event sent to $endpoint"
}
catch {
    Write-Warning ("Failed to send session end event: {0}" -f $_.Exception.Message)
    throw
}
finally {
    Remove-SessionState
}
