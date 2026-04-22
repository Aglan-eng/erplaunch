@echo off
title OFOQ - Fix Login / Setup Database

echo Setting up OFOQ database and creating test user...
echo.
echo This may take 10-20 seconds. Please wait.
echo.

cd /d "%~dp0"

pnpm --filter @ofoq/api seed

echo.
echo Done! You can now log in with:
echo   Email:    consultant@test.ofoq.app
echo   Password: password123
echo.
pause
