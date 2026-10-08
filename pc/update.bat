@echo off
REM ============================================================
REM Anti-Detect Browser - ONE CLICK UPDATE (private repo)
REM Pehli dafa GitHub token 1 dafa paste karna parega,
REM uske baad hamesha 1 click = auto update.
REM Tumhara data (.venv, profiles, settings) mehfooz rahega.
REM ============================================================
setlocal
cd /d "%~dp0\.."
set INSTALL_DIR=%CD%
set TOKEN_FILE=%~dp0.github-token

if not exist "%TOKEN_FILE%" (
    echo.
    echo  Pehli dafa 1-time setup: GitHub token chahiye.
    echo.
    echo  STEP 1: Browser mein ye page khul raha hai...
    echo          https://github.com/settings/tokens?type=beta
    echo  STEP 2: "Generate new token" dabao
    echo  STEP 3: "Only select repositories" -^> antidetect-browser select karo
    echo  STEP 4: Neeche "Contents" ko "Read-only" karo
    echo  STEP 5: "Generate token" dabao, token COPY karo
    echo.
    start https://github.com/settings/tokens?type=beta
    echo  Token paste karo neeche (right-click = paste):
    powershell -NoProfile -Command "$t = Read-Host 'TOKEN'; [IO.File]::WriteAllText('%TOKEN_FILE%', $t.Trim())"
    echo  Token save ho gaya. Ab se 1 click hi kaafi hai.
    echo.
)

echo  Update download ho raha hai GitHub se...
powershell -NoProfile -Command "$t = [IO.File]::ReadAllText('%TOKEN_FILE%').Trim(); Invoke-WebRequest -Headers @{Authorization=('Bearer ' + $t)} -Uri 'https://github.com/protectvibe14/antidetect-browser/archive/refs/heads/main.zip' -OutFile '%TEMP%\antidetect-update.zip'"
if errorlevel 1 (
    echo  ERROR: Download fail hua.
    echo  Token galat ho sakta hai - %TOKEN_FILE% delete karke dobara chalao.
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
