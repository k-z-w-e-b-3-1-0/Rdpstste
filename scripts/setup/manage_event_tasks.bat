@echo off
setlocal enabledelayedexpansion

:: Directory containing the XML definition files (defaults to the batch file directory)
set "TASK_XML_DIR=%~dp0"

if not "%~2"=="" (
    set "TASK_XML_DIR=%~f2"
    if not "!TASK_XML_DIR:~-1!"=="\\" set "TASK_XML_DIR=!TASK_XML_DIR!\\"
)

:: List of task identifiers (without extension)
set "TASK_LIST=login logoff sessionstart sessionend"

if "%~1"=="" goto :usage

set "ACTION=%~1"
if /I "%ACTION%"=="register" goto :register
if /I "%ACTION%"=="delete" goto :delete

echo [ERROR] Unknown action: %ACTION%
goto :usage

:register
echo Registering scheduled tasks from XML definitions...
for %%T in (%TASK_LIST%) do (
    set "XML_FILE=%TASK_XML_DIR%%%T.xml"
    if exist "!XML_FILE!" (
        echo   -> Importing %%T from "!XML_FILE!"
        schtasks /Create /TN "\\Monitoring\%%T" /XML "!XML_FILE!" /F >nul 2>&1
        if errorlevel 1 (
            echo      [FAILED] %%T
        ) else (
            echo      [OK]
        )
    ) else (
        echo   -> [MISSING] %%T ("!XML_FILE!")
    )
)
goto :eof

:delete
echo Deleting scheduled tasks...
for %%T in (%TASK_LIST%) do (
    echo   -> Removing %%T (\\Monitoring\%%T)
    schtasks /Delete /TN "\\Monitoring\%%T" /F >nul 2>&1
    if errorlevel 1 (
        echo      [FAILED] %%T (task may not exist)
    ) else (
        echo      [OK]
    )
)
goto :eof

:usage
echo Usage: %~nx0 ^<register^|delete^> [optional-xml-directory]
echo.
echo   register : Import all tasks listed in TASK_LIST from XML files.
echo   delete   : Remove the corresponding scheduled tasks.
echo.
echo You can override the XML directory by passing it as the second argument.
endlocal
exit /b 1
