@echo off
chcp 65001 >nul
echo Installing AuditDesk audit plugins...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
