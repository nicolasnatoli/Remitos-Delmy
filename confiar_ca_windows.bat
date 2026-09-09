@echo off
REM Instala la CA local del bridge de escaneo como certificado de confianza
REM en esta PC. Se corre UNA SOLA VEZ por PC, para siempre — despues de esto
REM ningun navegador de esta PC va a volver a mostrar avisos de seguridad al
REM usar el escaner, sin importar a cual de las IPs de la oficina se mueva.
REM
REM Hace falta correrlo como administrador (clic derecho > "Ejecutar como
REM administrador"), porque instala en el almacen de certificados de la
REM maquina (asi sirve para todos los usuarios/navegadores de esta PC).

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Este script necesita permisos de administrador.
    echo Cerra esta ventana y volve a abrirla con clic derecho ^> "Ejecutar como administrador".
    pause
    exit /b 1
)

set CARPETA=%~dp0
if not exist "%CARPETA%ca_cert.pem" (
    echo No se encontro ca_cert.pem en esta carpeta.
    echo Copia este .bat junto con ca_cert.pem antes de correrlo.
    pause
    exit /b 1
)

certutil -addstore -f "Root" "%CARPETA%ca_cert.pem"
if %errorLevel% equ 0 (
    echo.
    echo Listo. Esta PC ya confia en el certificado del bridge de escaneo,
    echo para siempre, sin importar que IP use el escaner.
) else (
    echo.
    echo Hubo un problema instalando el certificado. Revisa el mensaje de arriba.
)
pause
