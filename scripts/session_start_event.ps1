[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [string]$SessionId,
    [string]$ResourceId,
    [string]$UserId,
    [string]$Channel,
    [string]$ClientApplication,
    [string]$MfaResult
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
    $stateDirectory = Join-Path -Path $programData -ChildPath 'Rdpstste'
    if (-not (Test-Path -LiteralPath $stateDirectory)) {
        New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    }
    return Join-Path -Path $stateDirectory -ChildPath 'session-state.json'
}

function Save-SessionState {
    param([hashtable]$State)
    $path = Get-SessionStatePath
    $json = $State | ConvertTo-Json -Depth 6
    Set-Content -Path $path -Value $json -Encoding UTF8
}

if (-not $SessionId) { $SessionId = $env:SESSIONNAME }
if (-not $ResourceId) { $ResourceId = $env:COMPUTERNAME }
if (-not $UserId) { $UserId = $env:USERNAME }
if (-not $Channel) { $Channel = $env:RDP_CHANNEL }
if (-not $ClientApplication) { $ClientApplication = $env:RDP_CLIENT_APP }
if (-not $MfaResult) { $MfaResult = $env:RDP_MFA_STATUS }

$baseUrl = Get-NormalizedBaseUrl -Url $ServerUrl
$endpoint = "$baseUrl/api/sessions/start"

$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue | Select-Object -First 1 Caption, Version, BuildNumber
$clientOs = if ($osInfo) {
    ($osInfo.Caption.Trim() + " (Build " + $osInfo.BuildNumber + ")").Trim()
} else {
    [System.Environment]::OSVersion.VersionString
}

$timestamp = (Get-Date).ToUniversalTime()

$payload = [ordered]@{
    timestamp = $timestamp.ToString('o')
    event     = 'session.start'
}

if ($SessionId) { $payload.sessionId = $SessionId }
if ($ResourceId) { $payload.resourceId = $ResourceId }
if ($UserId) { $payload.userId = $UserId }

$clientEnvironment = @{}
if ($clientOs) { $clientEnvironment.operatingSystem = $clientOs }
if ($ClientApplication) { $clientEnvironment.application = $ClientApplication } else { $clientEnvironment.application = 'mstsc.exe' }
if ($clientEnvironment.Count -gt 0) { $payload.clientEnvironment = $clientEnvironment }

if ($Channel) { $payload.channel = $Channel }

if ($MfaResult) {
    $payload.authentication = @{ mfa = $MfaResult }
}

$state = [ordered]@{
    sessionId   = $SessionId
    resourceId  = $ResourceId
    userId      = $UserId
    startedAt   = $timestamp.ToString('o')
    lastHeartbeatAt = $null
}

try {
    $json = $payload | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $json -ContentType 'application/json' | Out-Null
    Write-Host "Session start event sent to $endpoint"
}
catch {
    Write-Warning ("Failed to send session start event: {0}" -f $_.Exception.Message)
    throw
}
finally {
    Save-SessionState -State $state
}
