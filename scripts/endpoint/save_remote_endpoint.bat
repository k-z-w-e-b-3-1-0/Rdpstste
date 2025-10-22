@echo off
setlocal EnableExtensions EnableDelayedExpansion

if "%~1"=="/?" goto :SHOW_USAGE
if "%~1"=="-h" goto :SHOW_USAGE
if "%~1"=="--help" goto :SHOW_USAGE

set "OUTPUT_DIR=%ProgramData%\Rdpstste"
set "RDP_PORT=3389"

if not "%~1"=="" set "OUTPUT_DIR=%~1"
if not "%~2"=="" set "RDP_PORT=%~2"

set "POWERSHELL_CMD="
for %%S in (powershell pwsh) do (
    where %%S >NUL 2>&1
    if not errorlevel 1 (
        set "POWERSHELL_CMD=%%S"
        goto :FOUND_POWERSHELL
    )
)

echo [WARN] PowerShell was not found. Falling back to batch-only capture.
goto :BATCH_FALLBACK

:FOUND_POWERSHELL
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%save_remote_endpoint.ps1"

if not exist "%PS_SCRIPT%" (
    echo [ERROR] Unable to locate PowerShell helper: %PS_SCRIPT%
    goto :BATCH_FALLBACK
)

"%POWERSHELL_CMD%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -OutputDirectory "%OUTPUT_DIR%" -RdpPort %RDP_PORT%
if errorlevel 1 (
    echo [WARN] PowerShell helper failed (error %ERRORLEVEL%). Using batch-only capture instead.
    goto :BATCH_FALLBACK
)
exit /b 0

:BATCH_FALLBACK
rem Try to write a simplified remote-session.json without PowerShell.
call :CaptureWithBatch "%OUTPUT_DIR%" %RDP_PORT%
exit /b %ERRORLEVEL%

:SHOW_USAGE
echo Usage: %~nx0 [output_directory] [rdp_port]
echo.
echo   output_directory  Optional. Defaults to %ProgramData%\Rdpstste

echo   rdp_port         Optional. Defaults to 3389
exit /b 0

:CaptureWithBatch
setlocal EnableExtensions EnableDelayedExpansion
set "OUTPUT_DIR=%~1"
set "RDP_PORT=%~2"

if not defined OUTPUT_DIR (
    echo [ERROR] Output directory was not provided to batch fallback.
    exit /b 2
)

if not exist "%OUTPUT_DIR%" (
    mkdir "%OUTPUT_DIR%" >NUL 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to create output directory "%OUTPUT_DIR%".
        exit /b 3
    )
)

set "REMOTE_HOST="
if defined CLIENTNAME set "REMOTE_HOST=%CLIENTNAME%"

set "SESSION_NAME="
if defined SESSIONNAME set "SESSION_NAME=%SESSIONNAME%"

if not defined SESSION_NAME (
    if defined USERNAME (
        for /f "tokens=1,2 delims= " %%A in ('quser ^| findstr /R /C:"^>%USERNAME% " /C:"^ %USERNAME% "') do (
            if not defined SESSION_NAME set "SESSION_NAME=%%B"
        )
    )
)

set "REMOTE_CONTROLLED_JSON=null"
if defined SESSION_NAME (
    if /I "%SESSION_NAME:~0,7%"=="RDP-TCP" set "REMOTE_CONTROLLED_JSON=true"
)

set "REMOTE_HOST_IP="
for /f "tokens=3" %%A in ('netstat -ano -p tcp ^| findstr /R /C:":%RDP_PORT% " ^| findstr /I "ESTABLISHED"') do (
    if not defined REMOTE_HOST_IP (
        set "__REMOTE_ADDR=%%A"
        if defined __REMOTE_ADDR (
            if "!__REMOTE_ADDR:~0,1!"=="[" (
                for /f "delims=[]" %%B in ("!__REMOTE_ADDR!") do set "REMOTE_HOST_IP=%%B"
            ) else (
                for /f "tokens=1 delims=:" %%B in ("!__REMOTE_ADDR!") do set "REMOTE_HOST_IP=%%B"
            )
        )
    )
)

set "RAW_TS="
for /f "tokens=2 delims==" %%A in ('wmic os get localdatetime /value ^| find "=" 2^>NUL') do set "RAW_TS=%%A"

set "TIMESTAMP="
if defined RAW_TS (
    set "RAW_TS=!RAW_TS:.=!"
    set "TIMESTAMP=!RAW_TS:~0,4!-!RAW_TS:~4,2!-!RAW_TS:~6,2!T!RAW_TS:~8,2!:!RAW_TS:~10,2!:!RAW_TS:~12,2!.0000000"
)

call :EscapeJsonValue REMOTE_HOST JSON_REMOTE_HOST
call :EscapeJsonValue REMOTE_HOST_IP JSON_REMOTE_HOST_IP
call :EscapeJsonValue SESSION_NAME JSON_SESSION_NAME

if defined TIMESTAMP (
    set "JSON_TIMESTAMP=\"!TIMESTAMP!\""
) else (
    set "JSON_TIMESTAMP=null"
)

set "TARGET_FILE=%OUTPUT_DIR%\remote-session.json"
(
    echo {
    echo   "timestamp": !JSON_TIMESTAMP!,
    echo   "remoteHost": !JSON_REMOTE_HOST!,
    echo   "remoteHostIpAddress": !JSON_REMOTE_HOST_IP!,
    echo   "sessionName": !JSON_SESSION_NAME!,
    echo   "remoteControlled": %REMOTE_CONTROLLED_JSON%
    echo }
) > "%TARGET_FILE%"

if errorlevel 1 (
    echo [ERROR] Failed to write "%TARGET_FILE%".
    exit /b 4
)

endlocal
exit /b 0

:EscapeJsonValue
set "__VALUE=!%~1!"
if not defined __VALUE (
    set "%~2=null"
    exit /b 0
)
set "__VALUE=!__VALUE:\=\\!"
set "__VALUE=!__VALUE:"=\"!"
set "%~2=\"!__VALUE!\""
exit /b 0
