@echo off
cd /d "%~dp0"
echo Starting Dermatology Appointment App...
echo.
echo Keep this window open while using the app.
echo Open http://127.0.0.1:3000 in your browser.
echo.
node server/start.js
pause
