@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Precisas de instalar o Node.js: https://nodejs.org & pause & exit /b)
start "" http://localhost:3000
node servidor-local.js
