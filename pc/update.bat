@echo off
REM ============================================================
REM Anti-Detect Browser - ONE CLICK UPDATE
REM Naya code GitHub se download karke khud apply kar dega.
REM Tumhara data (.venv, profiles, settings) mehfooz rahega.
REM ============================================================
setlocal
cd /d "%~dp0\.."
set INSTALL_DIR=%CD%

echo.
echo  Update download ho raha hai GitHub se...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/protectvibe14/antidetect-browser/archive/refs/heads/main.zip' -OutFile '%TEMP%\antidetect-update.zip'"
if errorlevel 1 (
    echo  ERROR: Download fail hua. Internet check karo.
    pause
    exit /b 1
)

echo  Extract ho raha hai...
if exist "%TEMP%\antidetect-update" rmdir /s /q "%TEMP%\antidetect-update"
powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\antidetect-update.zip' -DestinationPath '%TEMP%\antidetect-update' -Force"

echo  Naya code apply ho raha hai (tumhara data mehfooz rahega)...
powershell -NoProfile -Command "$src='%TEMP%\antidetect-update\antidetect-browser-main'; $dst='%INSTALL_DIR%'; Get-ChildItem $src | Where-Object { $_.Name -ne '.venv' -and $_.Name -ne '.git' } | ForEach-Object { Copy-Item $_.FullName -Destination $dst -Recurse -Force }"

echo  Libraries refresh ho rahi hain...
if exist .venv (
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt -q
)

del "%TEMP%\antidetect-update.zip" >nul 2>&1
rmdir /s /q "%TEMP%\antidetect-update" >nul 2>&1

echo.
echo  ============================================================
echo   UPDATE COMPLETE! Ab pc\run.bat se chalao.
echo  ============================================================
echo.
pause
