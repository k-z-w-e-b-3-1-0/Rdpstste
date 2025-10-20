@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: %~nx0 ^<server_url^> [additional PowerShell parameters]
    exit /b 1
)

set "SERVER_URL=%~1"
shift

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
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ServerUrl "%SERVER_URL%" %*
exit /b %ERRORLEVEL%
