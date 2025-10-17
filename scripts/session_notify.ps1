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
$sessionName = if ($env:SESSIONNAME) { $env:SESSIONNAME } else { $null }
$isRemoteSession = if ($sessionName -and $sessionName -like 'RDP-Tcp*') { $true } else { $false }
$remoteControlled = if ($isRemoteSession) { $true } else { $null }

$payload = @{
    hostname          = $env:COMPUTERNAME
    username          = $env:USERNAME
    remoteUser        = $env:USERNAME
    remoteHost        = $remoteHost
    sessionName       = $sessionName
    remoteControlled  = $remoteControlled
    expectedProcesses = ($TargetProcesses -join ",")
    runningProcesses  = $runningList
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
