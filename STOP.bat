@echo off
title Stop OFOQ App
echo.
echo  Stopping OFOQ servers...
taskkill /f /fi "WINDOWTITLE eq OFOQ API Server" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq OFOQ Frontend" >nul 2>&1
echo  Done. All servers stopped.
echo.
pause
