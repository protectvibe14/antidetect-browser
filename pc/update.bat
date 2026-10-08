@echo off
REM ============================================================
REM Anti-Detect Browser - Update (naya code pull karo)
REM ============================================================
setlocal
cd /d "%~dp0\.."

where git >nul 2>&1
if not errorlevel 1 (
    echo  Git se update ho raha hai...
    git pull
) else (
    echo  Git nahi hai — fresh zip download ho raha hai...
    cd ..
    powershell -c "Invoke-WebRequest -Uri 'https://github.com/protectvibe14/antidetect-browser/archive/refs/heads/main.zip' -OutFile antidetect.zip"
    powershell -c "Expand-Archive -Path antidetect.zip -DestinationPath . -Force"
    echo  Update ho gaya: antidetect-browser-main
)
echo.
pause
