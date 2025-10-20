[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [int]$IdleThresholdSeconds = 300,
    [string]$SessionId,
    [string]$ResourceId,
    [string]$UserId
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

function Ensure-StateDirectory {
    $path = Get-SessionStatePath
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
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

function Save-SessionState {
    param($State)
    Ensure-StateDirectory
    $path = Get-SessionStatePath
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $path -Encoding UTF8
}

if (-not ('UserIdleTime' -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class UserIdleTime
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public static TimeSpan GetIdleTime()
    {
        LASTINPUTINFO lastInput = new LASTINPUTINFO();
        lastInput.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref lastInput))
        {
            throw new System.ComponentModel.Win32Exception();
        }

        uint tickCount = (uint)Environment.TickCount;
        uint idleTicks = tickCount - lastInput.dwTime;
        return TimeSpan.FromMilliseconds(idleTicks);
    }
}
"@
}

$state = Load-SessionState

if (-not $SessionId -and $state) { $SessionId = $state.sessionId }
if (-not $ResourceId -and $state) { $ResourceId = $state.resourceId }
if (-not $UserId -and $state) { $UserId = $state.userId }
if (-not $SessionId) { $SessionId = $env:SESSIONNAME }
if (-not $ResourceId) { $ResourceId = $env:COMPUTERNAME }
if (-not $UserId) { $UserId = $env:USERNAME }

$baseUrl = Get-NormalizedBaseUrl -Url $ServerUrl
$endpoint = "$baseUrl/api/sessions/heartbeat"

$idleSeconds = [Math]::Round(([UserIdleTime]::GetIdleTime()).TotalSeconds, 2)
$inactivityExceeded = $idleSeconds -ge $IdleThresholdSeconds

$currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$activeApps = @()
try {
    $activeApps = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.SI -eq $currentSessionId -and $_.MainWindowTitle } |
        Select-Object -First 5 Name, MainWindowTitle |
        ForEach-Object {
            [ordered]@{
                name  = $_.Name
                title = $_.MainWindowTitle
            }
        }
}
catch {
    Write-Warning ("Unable to enumerate active applications: {0}" -f $_.Exception.Message)
}

$timestamp = (Get-Date).ToUniversalTime()

$payload = [ordered]@{
    timestamp     = $timestamp.ToString('o')
    event         = 'session.heartbeat'
    sessionId     = $SessionId
}

if ($ResourceId) { $payload.resourceId = $ResourceId }
if ($UserId) { $payload.userId = $UserId }
$payload.idleSeconds = $idleSeconds
$payload.isIdle = $inactivityExceeded

if ($activeApps -and $activeApps.Count -gt 0) {
    $payload.activeApplications = $activeApps
}

try {
    $json = $payload | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $json -ContentType 'application/json' | Out-Null
    Write-Host "Heartbeat event sent to $endpoint"

    if (-not $state) {
        $state = [ordered]@{}
    }
    $state.sessionId = $SessionId
    $state.resourceId = $ResourceId
    $state.userId = $UserId
    $state.lastHeartbeatAt = $timestamp.ToString('o')
    if ($state.startedAt -eq $null) {
        $state.startedAt = $timestamp.ToString('o')
    }
    $state.lastIdleSeconds = $idleSeconds
    Save-SessionState -State $state
}
catch {
    Write-Warning ("Failed to send heartbeat event: {0}" -f $_.Exception.Message)
    throw
}
