@echo off
title OFOQ Accelerator - Setup and Run
echo ============================================
echo   OFOQ NetSuite Accelerator - Setup
echo ============================================
echo.

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js version: %%i

:: Check pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [INFO] pnpm not found. Installing pnpm...
    npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm. Try running: npm install -g pnpm
        pause
        exit /b 1
    )
)
echo [OK] pnpm is available

:: Install dependencies
echo.
echo [STEP 1/3] Installing dependencies...
cd /d "%~dp0"
call pnpm install --no-frozen-lockfile
if errorlevel 1 (
    echo [ERROR] pnpm install failed. Trying again...
    call pnpm install --no-frozen-lockfile --force
)

:: Create outputs directory
echo.
echo [STEP 2/3] Creating required directories...
if not exist "apps\api\outputs" mkdir "apps\api\outputs"
if not exist "apps\api\uploads" mkdir "apps\api\uploads"
echo [OK] Directories ready

:: Check .env
if not exist "apps\api\.env" (
    echo [WARN] No .env file found. Copying from .env.example...
    copy "apps\api\.env.example" "apps\api\.env" >nul 2>nul
    if not exist "apps\api\.env" (
        echo [ERROR] No .env or .env.example found. Create apps\api\.env manually.
        pause
        exit /b 1
    )
)
echo [OK] .env file exists

:: Start the API server
echo.
echo [STEP 3/3] Starting API server...
echo ============================================
echo   Server starting at http://localhost:3000
echo   Test credentials:
echo     Email: consultant@test.ofoq.app
echo     Password: password123
echo.
echo   Press Ctrl+C to stop the server
echo ============================================
echo.

cd apps\api
node dist\server.js
pause
