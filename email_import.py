import email
import imaplib
import os
from email.header import decode_header
from pathlib import Path

import database as db

# Casilla dedicada exclusivamente a recibir los escaneos del escáner de
# oficina — por eso se puede revisar TODO lo no leído sin filtrar por
# remitente/asunto, y marcar como leído sin riesgo de tocar otra
# correspondencia.
IMAP_HOST = os.environ.get("SCAN_IMAP_HOST", "imap.gmail.com")
IMAP_PORT = int(os.environ.get("SCAN_IMAP_PORT", "993"))
IMAP_USER = os.environ.get("SCAN_EMAIL_USER")
IMAP_PASSWORD = os.environ.get("SCAN_EMAIL_PASSWORD")

_EXTENSIONES_VALIDAS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _decodificar(valor: str | None) -> str:
    if not valor:
        return ""
    partes = decode_header(valor)
    return "".join(
        (t.decode(enc or "utf-8", errors="replace") if isinstance(t, bytes) else t)
        for t, enc in partes
    )


def importar_escaneos_nuevos() -> int:
    """Revisa la casilla dedicada por IMAP, baja los adjuntos PDF/imagen de
    los mails no leídos, los guarda como escaneos sin asignar, y recién
    después marca esos mails como leídos. Devuelve cuántos escaneos nuevos
    importó. Si no hay credenciales configuradas, no hace nada (0)."""
    if not IMAP_USER or not IMAP_PASSWORD:
        return 0

    importados = 0
    conexion = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    try:
        conexion.login(IMAP_USER, IMAP_PASSWORD)
        conexion.select("INBOX")
        _, datos = conexion.search(None, "UNSEEN")
        ids_mensajes = datos[0].split()

        for msg_id in ids_mensajes:
            _, msg_datos = conexion.fetch(msg_id, "(RFC822)")
            if not msg_datos or not msg_datos[0]:
                continue
            mensaje = email.message_from_bytes(msg_datos[0][1])
            message_id_base = mensaje.get("Message-ID") or f"sin-id-{msg_id.decode()}"
            remitente = _decodificar(mensaje.get("From"))
            asunto = _decodificar(mensaje.get("Subject"))

            indice_adjunto = 0
            for parte in mensaje.walk():
                nombre_archivo = parte.get_filename()
                if not nombre_archivo:
                    continue
                nombre_archivo = _decodificar(nombre_archivo)
                ext = Path(nombre_archivo).suffix.lower()
                if ext not in _EXTENSIONES_VALIDAS:
                    continue

                contenido = parte.get_payload(decode=True)
                if not contenido:
                    continue

                # Clave única por adjunto (no por mail): un mismo mail puede
                # traer varios archivos, y cada uno necesita su propia fila.
                indice_adjunto += 1
                clave_unica = f"{message_id_base}#{indice_adjunto}"
                sufijo = clave_unica.strip("<>").replace("@", "_").replace("#", "_")
                nombre_guardado = f"escaneo_{sufijo}_{nombre_archivo}"

                tipo_mime = parte.get_content_type() or "application/octet-stream"
                db.guardar_archivo(nombre_guardado, contenido, tipo_mime)
                creado = db.crear_escaneo_entrante(nombre_guardado, remitente, asunto, clave_unica)
                if creado:
                    importados += 1

            # Se marca como leído recién después de procesar todos sus
            # adjuntos, para no perderlo si algo falla a mitad de camino.
            conexion.store(msg_id, "+FLAGS", "\\Seen")
    finally:
        try:
            conexion.close()
        except Exception:
            pass
        conexion.logout()

    return importados
