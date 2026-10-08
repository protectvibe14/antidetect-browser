@echo off
REM ============================================================
REM Anti-Detect Browser - ONE CLICK UPDATE (private repo via Git)
REM Pehli dafa: Git install + GitHub login (browser mein 1 click).
REM Uske baad hamesha: 1 click = auto update.
REM Tumhara data (.venv, profiles, settings) mehfooz rahega.
REM ============================================================
setlocal
cd /d "%~dp0\.."
set INSTALL_DIR=%CD%

where git >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Git install ho raha hai (sirf 1 dafa)...
    winget install Git.Git -e --silent --accept-source-agreements --accept-package-agreements
    echo.
    echo  Git install ho gaya. Ab update.bat DOBARA chalao.
    pause
    exit /b 0
)

if not exist ".git" (
    echo.
    echo  Pehli dafa setup: ab browser mein GitHub login khulega.
    echo  Login karo aur "Authorize" dabao. Bas 1 dafa karna hai.
    echo.
    if exist "%TEMP%\adrepo" rmdir /s /q "%TEMP%\adrepo"
    git clone https://github.com/protectvibe14/antidetect-browser.git "%TEMP%\adrepo"
    if errorlevel 1 (
        echo.
        echo  ERROR: Clone fail hua. Internet / GitHub login check karo.
        pause
        exit /b 1
    )
    echo  Naya code apply ho raha hai (tumhara data mehfooz rahega)...
    powershell -NoProfile -Command "Copy-Item '%TEMP%\adrepo\*' -Destination '%INSTALL_DIR%' -Recurse -Force"
    rmdir /s /q "%TEMP%\adrepo" >nul 2>&1
) else (
    echo  Update download ho raha hai...
    git fetch origin -q
    git reset --hard origin/main -q
    if errorlevel 1 (
        echo  ERROR: Update fail hua. Internet check karo.
        pause
        exit /b 1
    )
)

echo  Libraries refresh ho rahi hain...
if exist .venv (
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt -q
)

echo.
echo  ============================================================
echo   UPDATE COMPLETE! Ab pc\run.bat se chalao.
echo  ============================================================
echo.
pause
