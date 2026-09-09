"""
Programa local para Windows que conecta el botón "Escanear ahora" de la app
web de Depósito Delmy con el escáner físico conectado a esta PC.

La app web corre en la nube (Vercel) y no puede hablar directamente con el
escáner — por eso este programa queda corriendo en la PC, escucha en
localhost, y cuando el navegador le pide "/escanear":
  1. Dispara el escaneo por alimentador (ADF) usando la API moderna de
     Windows (Windows.Devices.Scanners) — la misma tecnología que usa la
     app nativa "Escáner de Windows", sin abrir ningún diálogo.
  2. Sube el resultado a "Escaneos sin asignar" en la app, vía el mismo
     endpoint que usa el resto del sistema.

(Se probó primero controlando el escáner por WIA directamente, pero el
driver de este modelo tiraba errores genéricos sin más detalle ante
cualquier combinación de propiedades; la API moderna resultó mucho más
confiable.)

Requiere Python 3.12 (el paquete winsdk todavía no tiene versión compatible
con Python 3.14) en un entorno virtual aparte del resto del proyecto:
    py -3.12 -m venv .venv_bridge
    .venv_bridge\\Scripts\\pip install -r requirements-scanner-bridge.txt

Uso: .venv_bridge\\Scripts\\python scanner_bridge.py
(dejar la ventana abierta mientras se usa el botón "Escanear ahora")

Configuración: completar scanner_bridge_config.txt en esta misma carpeta
(ver scanner_bridge_config.txt.example).
"""
import asyncio
import json
import mimetypes
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import fitz  # PyMuPDF — solo para juntar varias hojas en un PDF cuando hace falta
    import winsdk.windows.devices.enumeration as enumeration
    import winsdk.windows.devices.scanners as scanners
    import winsdk.windows.storage as storage
except ImportError:
    print("Falta instalar alguna dependencia. Corré (con Python 3.12):")
    print("  pip install -r requirements-scanner-bridge.txt")
    sys.exit(1)

CONFIG_PATH = Path(__file__).with_name("scanner_bridge_config.txt")
CERT_PATH = Path(__file__).with_name("bridge_cert.pem")
KEY_PATH = Path(__file__).with_name("bridge_key.pem")


def _leer_config() -> dict:
    if not CONFIG_PATH.exists():
        print(f"Falta el archivo de configuración: {CONFIG_PATH}")
        print("Creá uno (podés copiar scanner_bridge_config.txt.example) con:")
        print("APP_URL=<URL de la app, ej. https://deposito-delmy.vercel.app>")
        print("TOKEN=<el mismo valor que SCANNER_API_TOKEN en el servidor>")
        print("PUERTO=5055")
        sys.exit(1)
    config = {"PUERTO": "5055"}
    for linea in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        config[clave.strip()] = valor.strip()
    faltantes = [k for k in ("APP_URL", "TOKEN") if not config.get(k)]
    if faltantes:
        print("Faltan estos datos en scanner_bridge_config.txt:", ", ".join(faltantes))
        sys.exit(1)
    return config


async def _obtener_id_dispositivo() -> str:
    selector = scanners.ImageScanner.get_device_selector()
    dispositivos = await enumeration.DeviceInformation.find_all_async(selector, [])
    if dispositivos.size == 0:
        raise RuntimeError("No se detectó ningún escáner conectado.")
    return dispositivos[0].id


async def _escanear_async(permitir_varias_hojas: bool) -> tuple[bytes, str]:
    id_dispositivo = await _obtener_id_dispositivo()

    # Este driver puntual solo entrega UNA hoja por llamada a
    # scan_files_to_folder_async, sin importar qué se le pida (se confirmó
    # con can_scan_ahead=False: no soporta "seguir escaneando" en una sola
    # llamada) — por eso, para varias hojas, hay que llamarlo en bucle una
    # vez por hoja. Además, reusar la misma conexión (ImageScanner) entre
    # llamadas terminó dejando el servicio de escaneo de Windows en un
    # estado roto ("El servidor RPC no está disponible") — por eso acá se
    # reconecta de cero en cada hoja.
    maximo_intentos = 40 if permitir_varias_hojas else 1
    maximo_vacios_seguidos = 3  # reintentos si devuelve 0 archivos, por si el sensor todavía no detectó la hoja
    paginas_jpg: list[bytes] = []
    vacios_seguidos = 0

    for numero_intento in range(1, maximo_intentos + 1):
        print(f"  [bucle] pidiendo hoja (intento {numero_intento})...")
        escaner = await scanners.ImageScanner.from_id_async(id_dispositivo)
        if not escaner.is_scan_source_supported(scanners.ImageScannerScanSource.FEEDER):
            raise RuntimeError("Este escáner no tiene alimentador (ADF) disponible.")
        escaner.feeder_configuration.format = scanners.ImageScannerFormat.JPEG
        # Versiones anteriores de este programa le pusieron max_number_of_pages=1
        # al driver para evitar perder hojas — esa configuración puede haber
        # quedado guardada a nivel del driver/Windows entre sesiones. Se
        # fuerza a 0 (sin límite) para pisar cualquier valor viejo pegado.
        try:
            escaner.feeder_configuration.max_number_of_pages = 0
        except Exception as e:
            print(f"  [bucle] no se pudo poner max_number_of_pages=0: {e!r}")

        with tempfile.TemporaryDirectory() as carpeta_tmp:
            carpeta = await storage.StorageFolder.get_folder_from_path_async(carpeta_tmp)
            try:
                resultado = await escaner.scan_files_to_folder_async(
                    scanners.ImageScannerScanSource.FEEDER, carpeta
                )
            except Exception as e:
                print(f"  [bucle] excepción: {e!r}")
                if paginas_jpg:
                    break  # ya se escaneó algo — el alimentador se quedó sin hojas, no es un error real
                raise
            archivos = resultado.scanned_files
            print(f"  [bucle] {archivos.size} archivo(s) devuelto(s)")
            if archivos.size == 0:
                if not paginas_jpg:
                    break  # ni la primera hoja se pudo leer, no hay nada para reintentar
                vacios_seguidos += 1
                if not permitir_varias_hojas or vacios_seguidos >= maximo_vacios_seguidos:
                    break
                print(f"  [bucle] vacío — reintento {vacios_seguidos}/{maximo_vacios_seguidos - 1} "
                      "por si el sensor todavía no detectó la próxima hoja...")
                await asyncio.sleep(3)
                continue
            vacios_seguidos = 0
            for i in range(archivos.size):
                paginas_jpg.append(Path(archivos[i].path).read_bytes())
        if permitir_varias_hojas and numero_intento < maximo_intentos:
            await asyncio.sleep(1.5)  # le da un instante al escáner para detectar la próxima hoja

    if not paginas_jpg:
        raise RuntimeError("El escaneo no devolvió ningún archivo (¿había hoja en el alimentador?).")

    if len(paginas_jpg) == 1:
        return paginas_jpg[0], ".jpg"

    # Varias hojas son páginas de un mismo documento (ej. una factura
    # larga) — se juntan todas en un solo PDF, así la lectura automática
    # ve el documento completo de una.
    pdf = fitz.open()
    for datos_jpg in paginas_jpg:
        imagen = fitz.open("jpg", datos_jpg)
        pdf.insert_pdf(fitz.open("pdf", imagen.convert_to_pdf()))
        imagen.close()
    datos_pdf = pdf.tobytes()
    pdf.close()
    return datos_pdf, ".pdf"


def escanear_y_obtener_bytes(permitir_varias_hojas: bool = False) -> tuple[bytes, str]:
    return asyncio.run(_escanear_async(permitir_varias_hojas))


def _subir_a_la_app(app_url: str, token: str, contenido: bytes, extension: str) -> dict:
    boundary = "----DepositoDelmyBridge"
    nombre_archivo = f"escaneo_{int(time.time())}{extension}"
    tipo_mime = mimetypes.guess_type(nombre_archivo)[0] or "application/octet-stream"

    partes = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="archivo"; filename="{nombre_archivo}"\r\n'.encode(),
        f"Content-Type: {tipo_mime}\r\n\r\n".encode(),
        contenido,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    cuerpo = b"".join(partes)

    url = app_url.rstrip("/") + "/api/escaneos/subir"
    req = urllib.request.Request(url, data=cuerpo, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", f"Bearer {token}")

    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def _hacer_handler(config: dict):
    class Handler(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Expose-Headers", "X-Nombre-Archivo")
            # Chrome exige esto para dejar pasar pedidos desde una página
            # "pública" (la app en Vercel) hacia una IP de red privada como
            # esta (Private Network Access) — sin este header bloquea el
            # fetch aunque el certificado ya sea de confianza.
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def _json(self, status: int, data: dict):
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path == "/estado":
                self._json(200, {"ok": True})
            else:
                self._json(404, {"ok": False, "error": "No encontrado."})

        def do_POST(self):
            # El bridge ahora escucha en la red local (no solo en esta PC),
            # para que otras computadoras de la oficina puedan usar este
            # mismo escáner — por eso hace falta el token acá también, no
            # solo al subir el resultado a la app.
            if self.headers.get("Authorization") != f"Bearer {config['TOKEN']}":
                self._json(401, {"ok": False, "error": "No autorizado."})
                return
            ruta = urllib.parse.urlsplit(self.path)
            parametros = urllib.parse.parse_qs(ruta.query)
            varias = parametros.get("varias_hojas", ["0"])[0] == "1"
            if ruta.path == "/escanear":
                self._escanear_y_subir(varias)
            elif ruta.path == "/escanear-raw":
                self._escanear_directo(varias)
            else:
                self._json(404, {"ok": False, "error": "No encontrado."})

        def _escanear_y_subir(self, varias: bool):
            # Usado por la pantalla "Escaneos sin asignar": escanea y sube
            # directo a la app como escaneo pendiente de asignar.
            print("Escaneando (API moderna de Windows)...")
            try:
                contenido, extension = escanear_y_obtener_bytes(varias)
            except Exception as e:
                print("  Error al escanear:", e)
                self._json(500, {"ok": False, "error": f"No se pudo escanear: {e}"})
                return
            print(f"  Escaneo OK ({len(contenido)} bytes, {extension}). Subiendo a la app...")
            try:
                resultado = _subir_a_la_app(config["APP_URL"], config["TOKEN"], contenido, extension)
            except Exception as e:
                print("  Error al subir:", e)
                self._json(502, {"ok": False, "error": f"Se escaneó pero no se pudo subir: {e}"})
                return
            print("  Listo:", resultado)
            self._json(200, resultado)

        def _escanear_directo(self, varias: bool):
            # Usado por "Nuevo remito"/"Confirmar recepción"/"Revisar
            # remito": escanea y devuelve el archivo tal cual al navegador,
            # sin subirlo ni pasar por "Escaneos sin asignar" — el que lo
            # pidió ya está completando el formulario. "varias" permite
            # juntar varias hojas en un PDF (para facturas de más de una
            # página); si no, corta con error si entra más de una hoja.
            print(f"Escaneando (directo, sin subir, varias_hojas={varias})...")
            try:
                contenido, extension = escanear_y_obtener_bytes(varias)
            except Exception as e:
                print("  Error al escanear:", e)
                self._json(500, {"ok": False, "error": f"No se pudo escanear: {e}"})
                return
            print(f"  Escaneo OK ({len(contenido)} bytes, {extension}).")
            tipo_mime = mimetypes.guess_type("x" + extension)[0] or "application/octet-stream"
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", tipo_mime)
            self.send_header("X-Nombre-Archivo", f"escaneo_{int(time.time())}{extension}")
            self.end_headers()
            self.wfile.write(contenido)

        def log_message(self, format, *args):
            pass  # se loguea a mano arriba para no ensuciar la consola

    return Handler


def main():
    if not CERT_PATH.exists() or not KEY_PATH.exists():
        print(f"Faltan {CERT_PATH.name} / {KEY_PATH.name} en esta carpeta.")
        print("Generarlos con gestionar_certificados.py (ver ese archivo para instrucciones),")
        print("o copiarlos desde otra PC que ya los tenga generados.")
        sys.exit(1)

    config = _leer_config()
    puerto = int(config.get("PUERTO", "5055"))
    # 0.0.0.0 (no 127.0.0.1): así otras PCs de la misma red pueden usar
    # este escáner, no solo el navegador corriendo en esta máquina. Va por
    # HTTPS (con certificado autofirmado) porque la app en Vercel es HTTPS
    # y los navegadores bloquean que una página HTTPS le pida cosas a una
    # IP de red por HTTP puro ("contenido mixto") — con localhost hacen una
    # excepción, pero no con una IP de LAN como esta.
    servidor = ThreadingHTTPServer(("0.0.0.0", puerto), _hacer_handler(config))
    contexto_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    contexto_ssl.load_cert_chain(certfile=str(CERT_PATH), keyfile=str(KEY_PATH))
    servidor.socket = contexto_ssl.wrap_socket(servidor.socket, server_side=True)

    print(f"Bridge de escaneo (API moderna) escuchando en HTTPS puerto {puerto} (accesible desde la red local)")
    print(f"Subiendo a: {config['APP_URL']}")
    print("Si esta PC ya corrió confiar_ca_windows.bat una vez, ningún navegador de la")
    print("oficina va a mostrar avisos de seguridad. Si no, hay que correrlo como")
    print("administrador (ver confiar_ca_windows.bat) — es un paso único, para siempre.")
    print("Dejá esta ventana abierta mientras uses el botón 'Escanear ahora'.")
    print("Ctrl+C para detener.\n")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
