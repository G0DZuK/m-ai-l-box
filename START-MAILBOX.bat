@echo off
title M-Ai-L Box Launcher
echo ============================================
echo   Starting M-Ai-L Box (public demo)
echo   Site: https://app.justjerri.dpdns.org
echo ============================================
echo.

REM 0) Build the latest frontend into dist/ (fast if nothing changed)
echo [1/3] Building frontend...
cd /d Z:\M-Ai-L-Box\frontend
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed. Fix the error and try again.
    pause
    exit /b 1
)
echo Frontend build done.
echo.

REM 1) Start the app (keeps running in its own window)
echo [2/3] Starting backend...
start "M-Ai-L Box - APP" cmd /k "cd /d Z:\M-Ai-L-Box\backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1"

REM Give the app a few seconds to come up
timeout /t 5 /nobreak >nul

REM 2) Start the Cloudflare tunnel (keeps running in its own window)
echo [3/3] Starting tunnel...
start "M-Ai-L Box - TUNNEL" cmd /k "Z:\cloudflared\cloudflared.exe tunnel --config Z:/cloudflared/config.yml run mailbox"

echo.
echo Two windows have opened: APP and TUNNEL. Leave them BOTH open.
echo Wait about 15 seconds, then open:  https://app.justjerri.dpdns.org
echo.
echo To STOP later: just close both of those windows.
echo.
pause
