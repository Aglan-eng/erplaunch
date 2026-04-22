@echo off
cd /d "%~dp0apps\web"
"%~dp0node_modules\.bin\vite.cmd" --port 5173
