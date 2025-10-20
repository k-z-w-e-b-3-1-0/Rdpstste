@echo off
setlocal enabledelayedexpansion

REM Configuration
if "%~1"=="" (
    echo Usage: %~nx0 ^<server_url^>
    exit /b 1
)

set "SERVER=%~1"
if "%SERVER:~-1%"=="/" (
    set "ENDPOINT=%SERVER%api/sessions/auto-heartbeat"
) else (
    set "ENDPOINT=%SERVER%/api/sessions/auto-heartbeat"
)
set "TARGET_PROCESSES=mstsc.exe custom-tool.exe"

REM Build comma-separated list of expected processes
set "EXPECTED_PROCESSES="
for %%P in (%TARGET_PROCESSES%) do (
    if defined EXPECTED_PROCESSES (
        set "EXPECTED_PROCESSES=!EXPECTED_PROCESSES!,%%P"
    ) else (
        set "EXPECTED_PROCESSES=%%P"
    )
)

REM Detect running target processes
set "RUNNING_PROCESSES="
for %%P in (%TARGET_PROCESSES%) do (
    tasklist /FI "IMAGENAME eq %%P" /FO CSV /NH 2>NUL | findstr /I /C:"\"%%P\"" >NUL
    if not errorlevel 1 (
        if defined RUNNING_PROCESSES (
            set "RUNNING_PROCESSES=!RUNNING_PROCESSES!,%%P"
        ) else (
            set "RUNNING_PROCESSES=%%P"
        )
    )
)
if not defined RUNNING_PROCESSES set "RUNNING_PROCESSES="

REM Collect session metadata
if defined CLIENTNAME (
    set "REMOTE_HOST=%CLIENTNAME%"
) else (
    set "REMOTE_HOST="
)

set "REMOTE_HOST_IP="
set "POWERSHELL_CMD="
for %%S in (powershell pwsh) do (
    where %%S >NUL 2>&1
    if not errorlevel 1 (
        set "POWERSHELL_CMD=%%S"
        goto :FOUND_POWERSHELL
    )
)
goto :AFTER_REMOTE_IP_SCAN

:FOUND_POWERSHELL
for /f "usebackq tokens=*" %%A in (`!POWERSHELL_CMD! -NoProfile -Command "try { $conn = Get-NetTCPConnection -State Established -LocalPort 3389 | Select-Object -First 1; if ($conn -and $conn.RemoteAddress) { $candidate = $conn.RemoteAddress.ToString(); $parsed = $null; if ([System.Net.IPAddress]::TryParse($candidate, [ref]$parsed)) { $parsed.ToString() } } } catch { }"`) do (
    set "REMOTE_HOST_IP=%%A"
    goto :AFTER_REMOTE_IP_SCAN
)

:AFTER_REMOTE_IP_SCAN

if defined SESSIONNAME (
    set "SESSION_NAME=%SESSIONNAME%"
) else (
    set "SESSION_NAME="
)

set "REMOTE_CONTROLLED=null"
if defined SESSION_NAME (
    set "PREFIX=!SESSION_NAME:~0,7!"
    if /I "!PREFIX!"=="RDP-Tcp" (
        set "REMOTE_CONTROLLED=true"
    )
)

REM Prepare JSON payload file
set "TEMP_PAYLOAD=%TEMP%\session_payload_%RANDOM%%RANDOM%.json"
(
    echo {
    echo   "hostname": "%COMPUTERNAME%",
    echo   "username": "%USERNAME%",
    echo   "remoteUser": "%USERNAME%",
) > "%TEMP_PAYLOAD%"

if defined REMOTE_HOST (
    >> "%TEMP_PAYLOAD%" echo   "remoteHost": "%REMOTE_HOST%",
) else (
    >> "%TEMP_PAYLOAD%" echo   "remoteHost": null,
)

if defined REMOTE_HOST_IP (
    >> "%TEMP_PAYLOAD%" echo   "remoteHostIpAddress": "%REMOTE_HOST_IP%",
) else (
    >> "%TEMP_PAYLOAD%" echo   "remoteHostIpAddress": null,
)

if defined SESSION_NAME (
    >> "%TEMP_PAYLOAD%" echo   "sessionName": "%SESSION_NAME%",
) else (
    >> "%TEMP_PAYLOAD%" echo   "sessionName": null,
)

if /I "%REMOTE_CONTROLLED%"=="true" (
    >> "%TEMP_PAYLOAD%" echo   "remoteControlled": true,
) else (
    >> "%TEMP_PAYLOAD%" echo   "remoteControlled": null,
)

>> "%TEMP_PAYLOAD%" echo   "expectedProcesses": "!EXPECTED_PROCESSES!",

if defined RUNNING_PROCESSES (
    >> "%TEMP_PAYLOAD%" echo   "runningProcesses": "!RUNNING_PROCESSES!"
) else (
    >> "%TEMP_PAYLOAD%" echo   "runningProcesses": ""
)
>> "%TEMP_PAYLOAD%" echo }

REM Send heartbeat
curl -s --fail --show-error -X POST -H "Content-Type: application/json" -d @"%TEMP_PAYLOAD%" "%ENDPOINT%"
set "CURL_EXIT=%ERRORLEVEL%"

del "%TEMP_PAYLOAD%" >NUL 2>&1

if not "%CURL_EXIT%"=="0" (
    echo Failed to send session heartbeat. Curl exited with code %CURL_EXIT%.
    exit /b %CURL_EXIT%
)

echo Session heartbeat sent successfully.
endlocal
