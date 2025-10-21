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

REM Locate PowerShell (Windows PowerShell or PowerShell Core)
set "POWERSHELL_CMD="
for %%S in (powershell pwsh) do (
    where %%S >NUL 2>&1
    if not errorlevel 1 (
        set "POWERSHELL_CMD=%%S"
        goto :FOUND_POWERSHELL
    )
)
goto :POWERSHELL_DETECTED

:FOUND_POWERSHELL
:POWERSHELL_DETECTED

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
set "REMOTE_DATA_DIR=%ProgramData%\Rdpstste"
set "REMOTE_SESSION_FILE=%REMOTE_DATA_DIR%\remote-session.json"
set "REMOTE_HOST="
set "REMOTE_HOST_IP="
set "REMOTE_HOST_FROM_FILE="
set "REMOTE_HOST_IP_FROM_FILE="
set "SESSION_NAME="
set "SESSION_NAME_FROM_FILE="
set "REMOTE_CONTROLLED=true"
set "REMOTE_CONTROLLED_FROM_FILE="

if exist "%REMOTE_SESSION_FILE%" if defined POWERSHELL_CMD (
    for /f "usebackq tokens=1,2* delims==" %%A in (`%POWERSHELL_CMD% -NoProfile -Command "try { $data = Get-Content -Path '\"%REMOTE_SESSION_FILE%\"' -Raw | ConvertFrom-Json; if ($data.remoteHost) { \"REMOTE_HOST_FROM_FILE=\" + $data.remoteHost }; if ($data.remoteHostIpAddress) { \"REMOTE_HOST_IP_FROM_FILE=\" + $data.remoteHostIpAddress }; if ($data.sessionName) { \"SESSION_NAME_FROM_FILE=\" + $data.sessionName }; if ($null -ne $data.remoteControlled) { \"REMOTE_CONTROLLED_FROM_FILE=\" + ([string]$data.remoteControlled).ToLower() } } catch { }"`) do (
        if /I "%%A"=="REMOTE_HOST_FROM_FILE" (
            set "REMOTE_HOST_FROM_FILE=%%B"
        ) else if /I "%%A"=="REMOTE_HOST_IP_FROM_FILE" (
            set "REMOTE_HOST_IP_FROM_FILE=%%B"
        ) else if /I "%%A"=="SESSION_NAME_FROM_FILE" (
            set "SESSION_NAME_FROM_FILE=%%B"
        ) else if /I "%%A"=="REMOTE_CONTROLLED_FROM_FILE" (
            set "REMOTE_CONTROLLED_FROM_FILE=%%B"
        )
    )
)

if defined REMOTE_HOST_FROM_FILE (
    set "REMOTE_HOST=!REMOTE_HOST_FROM_FILE!"
) else if defined CLIENTNAME (
    set "REMOTE_HOST=%CLIENTNAME%"
)

if defined REMOTE_HOST_IP_FROM_FILE (
    set "REMOTE_HOST_IP=!REMOTE_HOST_IP_FROM_FILE!"
)

if defined SESSION_NAME_FROM_FILE (
    set "SESSION_NAME=!SESSION_NAME_FROM_FILE!"
) else if defined SESSIONNAME (
    set "SESSION_NAME=%SESSIONNAME%"
)

if defined REMOTE_CONTROLLED_FROM_FILE (
    set "REMOTE_CONTROLLED=!REMOTE_CONTROLLED_FROM_FILE!"
)

rem session_notify.bat is only executed while a user session is active, so the
rem monitoring UI should always indicate a remote control session.
set "REMOTE_CONTROLLED=true"

if defined POWERSHELL_CMD if not defined REMOTE_HOST_IP (
    for /f "usebackq tokens=*" %%A in (`%POWERSHELL_CMD% -NoProfile -Command "try { $conn = Get-NetTCPConnection -State Established -LocalPort 3389 | Select-Object -First 1; if ($conn -and $conn.RemoteAddress) { $candidate = $conn.RemoteAddress.ToString(); $parsed = $null; if ([System.Net.IPAddress]::TryParse($candidate, [ref]$parsed)) { $parsed.ToString() } } } catch { }"`) do (
        set "REMOTE_HOST_IP=%%A"
        goto :AFTER_REMOTE_IP_SCAN
    )
)

:AFTER_REMOTE_IP_SCAN

if defined POWERSHELL_CMD if not defined REMOTE_HOST_IP if defined REMOTE_HOST (
    for /f "usebackq tokens=*" %%A in (`%POWERSHELL_CMD% -NoProfile -Command "try { $parsed = $null; if ([System.Net.IPAddress]::TryParse('\"%REMOTE_HOST%\"', [ref]$parsed)) { $parsed.ToString() } } catch { }"`) do (
        set "REMOTE_HOST_IP=%%A"
        goto :AFTER_REMOTE_IP_VALIDATE
    )
)

:AFTER_REMOTE_IP_VALIDATE

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
) else if /I "%REMOTE_CONTROLLED%"=="false" (
    >> "%TEMP_PAYLOAD%" echo   "remoteControlled": false,
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
set "EXIT_CODE=%CURL_EXIT%"

endlocal & exit /b %EXIT_CODE%
