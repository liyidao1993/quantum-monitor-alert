@echo off
setlocal
chcp 65001 >nul
title Binance Alert Daemon

cd /d "%~dp0"

if not exist "dist-alert\binance-alert-daemon.cjs" (
  echo dist-alert\binance-alert-daemon.cjs not found.
  echo Running npm.cmd run build:alert ...
  npm.cmd run build:alert
  if errorlevel 1 (
    echo.
    echo Build failed. Press any key to close...
    pause >nul
    exit /b 1
  )
)

node "dist-alert\binance-alert-daemon.cjs"

echo.
echo Binance Alert Daemon stopped. Press any key to close...
pause >nul
