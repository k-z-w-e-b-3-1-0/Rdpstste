param(
    [string]$Server = "http://監視サーバーのアドレス:3000",
    [string[]]$TargetProcesses = @("mstsc.exe", "custom-tool.exe")
)

$serverBase = $Server.TrimEnd('/')
$endpoint = "$serverBase/api/sessions/auto-heartbeat"

$running = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $TargetProcesses -contains ($_.ProcessName + ".exe") } |
    Select-Object -ExpandProperty ProcessName -ErrorAction SilentlyContinue

$runningList = if ($running) {
    ($running | ForEach-Object { $_ + ".exe" }) -join ","
} else {
    ""
}

$remoteHost = if ($env:CLIENTNAME) { $env:CLIENTNAME } else { $null }
$remoteHostIpAddress = $null
$sessionName = if ($env:SESSIONNAME) { $env:SESSIONNAME } else { $null }
$remoteControlled = $null

$sessionMetadataPath = Join-Path -Path $env:ProgramData -ChildPath 'Rdpstste\remote-session.json'
if (Test-Path -Path $sessionMetadataPath) {
    try {
        $sessionMetadata = Get-Content -Path $sessionMetadataPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($sessionMetadata.remoteHost) {
            $remoteHost = $sessionMetadata.remoteHost
        }
        if ($sessionMetadata.remoteHostIpAddress) {
            $remoteHostIpAddress = $sessionMetadata.remoteHostIpAddress
        }
        if ($sessionMetadata.sessionName) {
            $sessionName = $sessionMetadata.sessionName
        }
        if ($null -ne $sessionMetadata.remoteControlled) {
            $remoteControlled = [bool]$sessionMetadata.remoteControlled
        }
    } catch {
        # Ignore parsing failures and fall back to runtime detection.
    }
}

try {
    $rdpConnection = Get-NetTCPConnection -State Established -LocalPort 3389 -ErrorAction Stop |
        Select-Object -First 1
    if (-not $remoteHostIpAddress -and $rdpConnection -and $rdpConnection.RemoteAddress) {
        $candidateAddress = $rdpConnection.RemoteAddress.ToString()
        $parsedAddress = $null
        if ([System.Net.IPAddress]::TryParse($candidateAddress, [ref]$parsedAddress)) {
            $remoteHostIpAddress = $parsedAddress.ToString()
        }
    }
} catch {
    # 取得に失敗した場合は無視
}

if (-not $sessionName) {
    try {
        $currentUser = $env:USERNAME
        if ($currentUser) {
            $quserOutput = quser 2>$null
            foreach ($line in $quserOutput) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $trimmed = $line.TrimStart()
                if ($trimmed.StartsWith('USERNAME') -or $trimmed.StartsWith('---')) { continue }
                if ($trimmed -match '^(>?\S+)\s+(\S+)\s+(\d+)\s+') {
                    $user = $matches[1].TrimStart('>')
                    if ($user -ieq $currentUser) {
                        $sessionName = $matches[2]
                        break
                    }
                }
            }
        }
    } catch {
        # Ignore lookup failures.
    }
}

if ($null -eq $remoteControlled -and $sessionName -and $sessionName -like 'RDP-Tcp*') {
    $remoteControlled = $true
}

$payload = @{
    hostname            = $env:COMPUTERNAME
    username            = $env:USERNAME
    remoteUser          = $env:USERNAME
    remoteHost          = $remoteHost
    remoteHostIpAddress = $remoteHostIpAddress
    sessionName         = $sessionName
    remoteControlled    = $remoteControlled
    expectedProcesses   = ($TargetProcesses -join ",")
    runningProcesses    = $runningList
}

try {
    Invoke-WebRequest -UseBasicParsing `
        -Uri $endpoint `
        -Method Post `
        -ContentType "application/json" `
        -Body ($payload | ConvertTo-Json -Depth 3)
} catch {
    Write-Error "Failed to send session heartbeat: $($_.Exception.Message)"
    exit 1
}
