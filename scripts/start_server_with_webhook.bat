@echo off
setlocal

if "%~1"=="" (
    echo Usage: %~nx0 ^<slack_webhook_url^> [additional Node.js arguments]
    exit /b 1
)

set "WEBHOOK_URL=%~1"
shift

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."

node server.js --webhook "%WEBHOOK_URL%" %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
