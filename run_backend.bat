@echo off
cd /d "%~dp0"
echo Starting IBVAP Backend Server...
".\backend\.venv\Scripts\python.exe" backend\run.py %*
pause
