@echo off
rem Double-click to remove the Miracle - Video Downloader companion app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
pause
