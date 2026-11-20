@echo off
setlocal
chcp 65001 >nul
title Quantum Monitor Launcher

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-remix.ps1"

echo.
echo Launcher window has ended. Press any key to close...
pause >nul
