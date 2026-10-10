@echo off
rem Nova print agent. Set the address of your POS below (no trailing slash). Several addresses can be separated by commas.
set PRINT_AGENT_ALLOWED_ORIGINS=https://pos.example.com
cd /d "%~dp0"
node server.js
pause
