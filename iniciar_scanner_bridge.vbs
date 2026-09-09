' Arranca scanner_bridge.py en segundo plano (sin ventana de consola) al
' iniciar sesión en Windows. Se ejecuta solo — para dejarlo funcionando
' automáticamente, este archivo se copia a la carpeta de Inicio de Windows
' (shell:startup).
Set objShell = CreateObject("WScript.Shell")
carpeta = "C:\Users\stest\OneDrive\Escritorio\OneDrive\Delmy\App.Deposito"
python = carpeta & "\.venv_bridge\Scripts\pythonw.exe"
script = carpeta & "\scanner_bridge.py"
objShell.CurrentDirectory = carpeta
objShell.Run """" & python & """ """ & script & """", 0, False
