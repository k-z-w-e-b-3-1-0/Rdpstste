@echo off
setlocal

if "%~1"=="" (
    echo Usage: %~nx0 ^<slack_webhook_url^> [additional Node.js arguments]
    exit /b 1
)

set "WEBHOOK_URL=%~1"
shift

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"
set "SERVER_JS=%PROJECT_ROOT%\server.js"

if not exist "%SERVER_JS%" (
    echo Could not find server.js in "%PROJECT_ROOT%".
    exit /b 1
)

pushd "%PROJECT_ROOT%" >nul
node "%SERVER_JS%" --webhook "%WEBHOOK_URL%" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
