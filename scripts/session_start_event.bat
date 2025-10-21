@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: %~nx0 ^<server_url^> [additional PowerShell parameters]
    exit /b 1
)

set "SERVER_URL=%~1"
set "ALL_ARGS=%*"
set "REMAINING_ARGS="

for /f "tokens=1* delims= " %%A in ("!ALL_ARGS!") do (
    if not "%%B"=="" set "REMAINING_ARGS=%%B"
)

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%session_start_event.ps1"
set "POWERSHELL_EXE="

for %%S in (pwsh.exe powershell.exe) do (
    where %%S >NUL 2>&1
    if not errorlevel 1 (
        set "POWERSHELL_EXE=%%S"
        goto :FOUND_PS
    )
)

echo PowerShell executable not found.
exit /b 1

:FOUND_PS
if defined REMAINING_ARGS (
    "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ServerUrl "%SERVER_URL%" !REMAINING_ARGS!
) else (
    "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ServerUrl "%SERVER_URL%"
)
exit /b %ERRORLEVEL%
