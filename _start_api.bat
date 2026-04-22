@echo off
cd /d "%~dp0apps\api"
set NODE_ENV=development
"%~dp0node_modules\.bin\tsx.cmd" src\server.ts
