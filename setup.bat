@echo off
setlocal

echo ============================================
echo   Depósito Delmy - Instalación local
echo ============================================

where py >nul 2>nul
if %errorlevel%==0 (
    set PY_CMD=py
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set PY_CMD=python
    ) else (
        echo No se encontró Python instalado. Instalalo desde https://www.python.org/downloads/
        pause
        exit /b 1
    )
)

echo Usando: %PY_CMD%
%PY_CMD% -m venv .venv
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
".venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet

echo.
if exist ".env" (
    findstr /r /c:"^ANTHROPIC_API_KEY=.+" .env >nul 2>nul
    if errorlevel 1 (
        echo ============================================
        echo   ATENCION: falta cargar ANTHROPIC_API_KEY en .env
        echo   El lector automatico de remitos no va a
        echo   funcionar hasta configurarla.
        echo   Conseguila en https://console.anthropic.com/settings/keys
        echo ============================================
    ) else (
        echo Clave de Claude configurada correctamente.
    )
) else (
    echo ============================================
    echo   ATENCION: no existe el archivo .env
    echo   Copia .env.example a .env y cargale tu
    echo   ANTHROPIC_API_KEY para que el lector
    echo   automatico de remitos funcione.
    echo   Conseguila en https://console.anthropic.com/settings/keys
    echo ============================================
)

echo.
echo Instalación terminada. Usá iniciar.bat para arrancar la app.
pause
