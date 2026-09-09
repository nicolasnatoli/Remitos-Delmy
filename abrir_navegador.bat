@echo off
rem Espera a que el servidor responda antes de abrir el navegador,
rem en vez de una demora fija que a veces no alcanza.
setlocal
for /l %%i in (1,1,40) do (
    curl -s -o nul http://localhost:5000/login
    if not errorlevel 1 (
        start http://localhost:5000
        exit /b 0
    )
    timeout /t 1 >nul
)
rem Si despues de 40 segundos no respondio, lo abrimos igual por las dudas.
start http://localhost:5000
