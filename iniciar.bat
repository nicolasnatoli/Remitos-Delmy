@echo off
setlocal

if not exist ".venv\Scripts\python.exe" (
    echo Todavia no corriste setup.bat. Ejecutalo primero.
    pause
    exit /b 1
)

start "" abrir_navegador.bat
".venv\Scripts\python.exe" app.py

pause
