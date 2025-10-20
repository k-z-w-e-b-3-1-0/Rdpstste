param(
    [string]$OutputDirectory = $(Join-Path $env:ProgramData 'Rdpstste'),
    [int]$RdpPort = 3389
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    Write-Error 'OutputDirectory must be specified.'
    exit 1
}

try {
    if (-not (Test-Path -Path $OutputDirectory)) {
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    }
} catch {
    Write-Error "Failed to prepare output directory '$OutputDirectory': $($_.Exception.Message)"
    exit 1
}

$remoteHost = if ($env:CLIENTNAME) { $env:CLIENTNAME } else { $null }
$remoteHostIpAddress = $null
$sessionName = if ($env:SESSIONNAME) { $env:SESSIONNAME } else { $null }
$remoteControlled = $null

if (-not $sessionName) {
    try {
        $currentUser = $env:USERNAME
        if ($currentUser) {
            $quserOutput = quser 2>$null
            foreach ($line in $quserOutput) {
                if ([string]::IsNullOrWhiteSpace($line)) {
                    continue
                }

                $trimmed = $line.TrimStart()
                if ($trimmed.StartsWith('USERNAME') -or $trimmed.StartsWith('---')) {
                    continue
                }

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
        # Ignore failures and proceed without session name.
    }
}

if ($sessionName -and $sessionName -like 'RDP-Tcp*') {
    $remoteControlled = $true
}

try {
    $connections = Get-NetTCPConnection -State Established -LocalPort $RdpPort -ErrorAction Stop |
        Where-Object { $_.RemoteAddress }

    foreach ($connection in $connections) {
        $candidate = $connection.RemoteAddress.ToString()
        $parsedAddress = $null
        if ([System.Net.IPAddress]::TryParse($candidate, [ref]$parsedAddress)) {
            $remoteHostIpAddress = $parsedAddress.ToString()
            break
        }
    }
} catch {
    # Ignore failures; we will still write out whatever data we have.
}

$payload = [ordered]@{
    timestamp           = (Get-Date).ToString('o')
    remoteHost          = if ([string]::IsNullOrWhiteSpace($remoteHost)) { $null } else { $remoteHost }
    remoteHostIpAddress = if ([string]::IsNullOrWhiteSpace($remoteHostIpAddress)) { $null } else { $remoteHostIpAddress }
    sessionName         = if ([string]::IsNullOrWhiteSpace($sessionName)) { $null } else { $sessionName }
    remoteControlled    = $remoteControlled
}

$targetFile = Join-Path $OutputDirectory 'remote-session.json'

try {
    $payload | ConvertTo-Json -Depth 3 | Set-Content -Path $targetFile -Encoding UTF8
} catch {
    Write-Error "Failed to write remote session metadata to '$targetFile': $($_.Exception.Message)"
    exit 1
}

exit 0
