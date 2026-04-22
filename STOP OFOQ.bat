@echo off
title Stop OFOQ Servers
echo Stopping OFOQ servers...
taskkill /FI "WINDOWTITLE eq OFOQ API Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq OFOQ Frontend*" /T /F >nul 2>&1
echo Done. All OFOQ servers stopped.
timeout /t 2 /nobreak >nul
