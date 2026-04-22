@echo off
title OFOQ NetSuite Accelerator

echo ============================================
echo   OFOQ NetSuite Accelerator - Starting...
echo ============================================
echo.

cd /d "%~dp0"

where node >/dev/null 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found

where pnpm >/dev/null 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Installing pnpm...
    call npm install -g pnpm
)
echo [OK] pnpm available
echo.

echo [1/2] Starting API server on port 3000...
start "OFOQ API Server" cmd /k "cd /d "%~dp0" && pnpm --filter @ofoq/api dev"

timeout /t 5 /nobreak >/dev/null

echo [2/2] Starting Frontend on port 5173...
start "OFOQ Frontend" cmd /k "cd /d "%~dp0" && pnpm --filter @ofoq/web dev"

timeout /t 6 /nobreak >/dev/null

start "" "http://localhost:5173"

echo.
echo ============================================
echo   Both servers are running!
echo ============================================
echo.
echo   App:      http://localhost:5173
echo   API:      http://localhost:3000
echo.
echo   Login:
echo     Email:    consultant@test.ofoq.app
echo     Password: password123
echo.
echo   Keep the two server windows open.
echo   Close them when you're done.
echo ============================================
pause
