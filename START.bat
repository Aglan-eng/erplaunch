@echo off
setlocal EnableDelayedExpansion
title OFOQ NetSuite Accelerator

echo.
echo  ===================================
echo   OFOQ NetSuite Accelerator v0.1
echo  ===================================
echo.

set ROOT=%~dp0

:: -----------------------------------------------
:: 1. Check Node.js
:: -----------------------------------------------
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Please install it from: https://nodejs.org
    echo  Download the "LTS" version, install it, then
    echo  double-click this file again.
    echo.
    pause
    exit /b 1
)
echo  Node.js found:
node --version
echo.

:: -----------------------------------------------
:: 2. First-time setup  (runs once, ~3 minutes)
:: -----------------------------------------------
if not exist "%ROOT%.setup_done" (
    echo  First-time setup - installing packages...
    echo  This will take 2-3 minutes. Please wait.
    echo.

    :: Remove any Linux-installed node_modules so npm installs fresh
    echo  Removing old node_modules...
    if exist "%ROOT%node_modules"                      rmdir /s /q "%ROOT%node_modules"
    if exist "%ROOT%apps\api\node_modules"             rmdir /s /q "%ROOT%apps\api\node_modules"
    if exist "%ROOT%apps\web\node_modules"             rmdir /s /q "%ROOT%apps\web\node_modules"
    if exist "%ROOT%packages\shared\node_modules"      rmdir /s /q "%ROOT%packages\shared\node_modules"
    if exist "%ROOT%packages\rule-engine\node_modules" rmdir /s /q "%ROOT%packages\rule-engine\node_modules"

    :: Install all packages via npm workspaces (single install covers everything)
    cd /d "%ROOT%"
    echo  Running npm install - please wait...
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Package installation failed.
        echo  Check your internet connection and try again.
        pause
        exit /b 1
    )

    :: Seed the database with demo login credentials
    echo.
    echo  Setting up database...
    cd /d "%ROOT%apps\api"
    "%ROOT%node_modules\.bin\tsx.cmd" prisma\seed.ts
    if %errorlevel% neq 0 (
        echo  Warning: seed had an issue, continuing anyway...
    )

    echo done > "%ROOT%.setup_done"
    echo.
    echo  Setup complete!
    echo.
)

:: -----------------------------------------------
:: 3. Start API server  (port 3000)
:: -----------------------------------------------
echo  Starting API server...
start "OFOQ API Server" cmd /k "%ROOT%_start_api.bat"

timeout /t 4 /nobreak > nul

:: -----------------------------------------------
:: 4. Start frontend  (port 5173)
:: -----------------------------------------------
echo  Starting frontend...
start "OFOQ Frontend" cmd /k "%ROOT%_start_web.bat"

timeout /t 5 /nobreak > nul

:: -----------------------------------------------
:: 5. Open browser
:: -----------------------------------------------
echo  Opening browser...
start "" "http://localhost:5173"

echo.
echo  ===================================
echo   App is running!
echo.
echo   URL:      http://localhost:5173
echo   Login:    consultant@test.ofoq.app
echo   Password: password123
echo  ===================================
echo.
echo  Keep this window and the two black
echo  windows open while using the app.
echo.
echo  To stop: close all three black windows.
echo.
pause
