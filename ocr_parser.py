import base64
import io
import json
import os
from pathlib import Path

import anthropic
import fitz  # PyMuPDF — solo para recortar la última página de un comprobante PDF
from PIL import Image, ImageOps

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"}

# Modelo Sonnet: buena relación costo/calidad para lectura de tablas de
# remitos/facturas. Se puede pisar con la variable de entorno si hace falta
# probar otro modelo sin tocar código.
_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    """Lee la clave de la variable de entorno ANTHROPIC_API_KEY. Si no está
    configurada, la construcción del cliente lanza una excepción — que queda
    contenida por el try/except de parse_remito/validar_comprobante, así la
    app sigue funcionando (todo a completar a mano) aunque falte la clave."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _tipo_archivo(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return "pdf" if ext == ".pdf" else "imagen"


_MEDIA_TYPES_IMAGEN = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
}


def _bloque_imagen(file_path: str, filename: str) -> dict:
    """Claude Vision solo acepta jpeg/png/webp/gif. Los formatos que no admite
    directamente (heic, bmp, tif — comunes en fotos de celular) se
    re-convierten a PNG con Pillow antes de mandarlos."""
    ext = Path(filename).suffix.lower()
    media_type = _MEDIA_TYPES_IMAGEN.get(ext)
    if media_type:
        data = Path(file_path).read_bytes()
    else:
        img = ImageOps.exif_transpose(Image.open(file_path)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        media_type = "image/png"
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.standard_b64encode(data).decode("utf-8"),
        },
    }


def _bloque_documento_pdf(file_path: str) -> dict:
    data = Path(file_path).read_bytes()
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(data).decode("utf-8"),
        },
    }


_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "codigo_articulo": {"type": ["string", "null"]},
        "descripcion": {"type": ["string", "null"]},
        "cantidad_remito": {"type": ["number", "null"]},
    },
    "required": ["codigo_articulo", "descripcion", "cantidad_remito"],
    "additionalProperties": False,
}

_REMITO_SCHEMA = {
    "type": "object",
    "properties": {
        "nro_remito": {"type": ["string", "null"]},
        "fecha_remito": {"type": ["string", "null"]},
        "items": {"type": "array", "items": _ITEM_SCHEMA},
    },
    "required": ["nro_remito", "fecha_remito", "items"],
    "additionalProperties": False,
}

# El problema que motivó este cambio: cada proveedor de Delmy usa un orden de
# columnas distinto (código/cantidad/descripción no siempre en ese orden, y a
# veces la cantidad tiene el mismo formato numérico que el precio), así que
# una heurística posicional fija terminaba leyendo mal. Claude entiende la
# tabla por sus encabezados en vez de por posición fija.
_SYSTEM_PROMPT = """Sos un asistente que extrae datos de remitos y facturas de \
proveedores argentinos para un depósito minorista de artículos de cotillón/fiesta.

Se te muestra un remito o factura (foto o PDF) de un proveedor. Extraé:

1. nro_remito: el número de remito (buscá etiquetas como "Remito N°", "Nro \
Remito", "Comprobante N°"). Si no aparece, null.
2. fecha_remito: la fecha del remito en formato DD/MM/AAAA. Si no aparece, null.
3. items: la lista completa de artículos de la tabla de mercadería. Por cada \
fila real de artículo:
   - codigo_articulo: el código del artículo (normalmente mayúsculas/números)
   - descripcion: la descripción del artículo
   - cantidad_remito: la cantidad de unidades del remito (NO el precio \
unitario ni el importe)

IMPORTANTE sobre las columnas: cada proveedor usa un orden distinto — código, \
cantidad y descripción pueden venir en cualquier orden, y puede haber columnas \
extra de precio unitario, bonificación, IVA, importe, despacho, etc. que hay \
que ignorar. Fijate SIEMPRE en los encabezados reales de la tabla (Código, \
Cant., Descripción, etc.) para saber qué columna es cuál — no asumas un orden \
fijo entre documentos. Nunca confundas la cantidad con un precio o un importe.

No incluyas como ítems: encabezados de tabla, totales, subtotales, IVA, datos \
del proveedor/cliente (domicilio, CUIT, teléfono, condición de venta), ni \
leyendas legales. Solo artículos de mercadería real.

Si el documento tiene varias páginas, extraé los ítems de todas."""


def parse_remito(file_path: str, filename: str) -> dict:
    """Extrae encabezado (nro_remito, fecha) e items del remito del proveedor,
    leyendo directamente la foto o el PDF con la API de Claude (Vision) en vez
    de OCR local. Nunca lanza excepción: ante cualquier falla (incluida la
    falta de ANTHROPIC_API_KEY) devuelve el resultado más vacío posible para
    que el empleado complete todo a mano en la revisión."""
    tipo = _tipo_archivo(filename)
    resultado = {
        "nro_remito": None,
        "fecha_remito": None,
        "tipo_archivo": tipo,
        "metodo_extraccion": "claude_vision",
        "items": [],
    }
    try:
        bloque = _bloque_documento_pdf(file_path) if tipo == "pdf" else _bloque_imagen(file_path, filename)
        respuesta = _get_client().messages.create(
            model=_MODEL,
            max_tokens=8000,
            system=_SYSTEM_PROMPT,
            output_config={"format": {"type": "json_schema", "schema": _REMITO_SCHEMA}},
            messages=[{
                "role": "user",
                "content": [bloque, {"type": "text", "text": "Extraé los datos de este remito."}],
            }],
        )
        if respuesta.stop_reason == "refusal":
            return resultado
        texto = next((b.text for b in respuesta.content if b.type == "text"), None)
        if not texto:
            return resultado
        datos = json.loads(texto)
        resultado["nro_remito"] = datos.get("nro_remito")
        resultado["fecha_remito"] = datos.get("fecha_remito")
        resultado["items"] = [
            it for it in (datos.get("items") or [])
            if it.get("codigo_articulo") or it.get("descripcion")
        ]
    except Exception:
        pass
    return resultado


_ITEM_SCHEMA_COMPRA = {
    "type": "object",
    "properties": {
        "codigo_articulo": {"type": ["string", "null"]},
        "descripcion": {"type": ["string", "null"]},
        "cantidad_comprada": {"type": ["number", "null"]},
    },
    "required": ["codigo_articulo", "descripcion", "cantidad_comprada"],
    "additionalProperties": False,
}

_COMPRA_SCHEMA = {
    "type": "object",
    "properties": {
        "nro_documento": {"type": ["string", "null"]},
        "fecha_documento": {"type": ["string", "null"]},
        "items": {"type": "array", "items": _ITEM_SCHEMA_COMPRA},
    },
    "required": ["nro_documento", "fecha_documento", "items"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT_COMPRA = """Sos un asistente que extrae datos de facturas y \
órdenes de compra de proveedores argentinos, para un depósito minorista de \
artículos de cotillón/fiesta.

Se te muestra una factura u orden de compra (foto o PDF) de un proveedor. \
Extraé:

1. nro_documento: el número de factura u orden de compra (etiquetas como \
"Factura N°", "Orden de compra N°", "Comprobante N°", "OC N°"). Si no \
aparece, null.
2. fecha_documento: la fecha del documento en formato DD/MM/AAAA. Si no \
aparece, null.
3. items: la lista completa de artículos de la tabla de mercadería \
comprada. Por cada fila real de artículo:
   - codigo_articulo: el código del artículo (normalmente mayúsculas/números)
   - descripcion: la descripción del artículo
   - cantidad_comprada: la cantidad de unidades compradas (NO el precio \
unitario ni el importe)

IMPORTANTE sobre las columnas: cada proveedor usa un orden distinto — código, \
cantidad y descripción pueden venir en cualquier orden, y puede haber columnas \
extra de precio unitario, bonificación, IVA, importe, etc. que hay que \
ignorar. Fijate SIEMPRE en los encabezados reales de la tabla para saber qué \
columna es cuál — no asumas un orden fijo entre documentos. Nunca confundas \
la cantidad con un precio o un importe.

No incluyas como ítems: encabezados de tabla, totales, subtotales, IVA, datos \
del proveedor/cliente, ni leyendas legales. Solo artículos de mercadería \
real. Si el documento tiene varias páginas, extraé los ítems de todas.

No inventes ningún dato: si un campo no se puede leer con certeza, devolvé \
null en ese campo en vez de adivinar."""


def parse_factura_compra(file_path: str, filename: str) -> dict:
    """Extrae encabezado (nro_documento, fecha) e items de una factura/orden
    de compra de proveedor, para la fase de "carga de compras" (previa a la
    recepción). Misma lógica que parse_remito (Claude Vision, sin OCR local),
    con un prompt propio para este tipo de documento. Nunca lanza excepción:
    ante cualquier falla devuelve el resultado más vacío posible."""
    tipo = _tipo_archivo(filename)
    resultado = {
        "nro_documento": None,
        "fecha_documento": None,
        "tipo_archivo": tipo,
        "metodo_extraccion": "claude_vision",
        "items": [],
    }
    try:
        bloque = _bloque_documento_pdf(file_path) if tipo == "pdf" else _bloque_imagen(file_path, filename)
        respuesta = _get_client().messages.create(
            model=_MODEL,
            max_tokens=8000,
            system=_SYSTEM_PROMPT_COMPRA,
            output_config={"format": {"type": "json_schema", "schema": _COMPRA_SCHEMA}},
            messages=[{
                "role": "user",
                "content": [bloque, {"type": "text", "text": "Extraé los datos de esta factura/orden de compra."}],
            }],
        )
        if respuesta.stop_reason == "refusal":
            return resultado
        texto = next((b.text for b in respuesta.content if b.type == "text"), None)
        if not texto:
            return resultado
        datos = json.loads(texto)
        resultado["nro_documento"] = datos.get("nro_documento")
        resultado["fecha_documento"] = datos.get("fecha_documento")
        resultado["items"] = [
            it for it in (datos.get("items") or [])
            if it.get("codigo_articulo") or it.get("descripcion")
        ]
    except Exception:
        pass
    return resultado


_SCHEMA_VALIDACION = {
    "type": "object",
    "properties": {"firma_detectada": {"type": ["boolean", "null"]}},
    "required": ["firma_detectada"],
    "additionalProperties": False,
}

_SYSTEM_VALIDACION = """Se te muestra la última página de una hoja de control de \
recepción de mercadería ya completada a mano. Al pie de la hoja hay un renglón \
para la firma y aclaración del transportista. Tu única tarea es indicar si hay \
una firma manuscrita trazada en ese renglón — no alcanza con que el renglón \
esté impreso y vacío. Si la imagen no es legible o no podés determinarlo con \
confianza, devolvé null."""


def validar_comprobante(file_path: str, filename: str) -> dict:
    """Analiza el escaneo de la hoja de control ya completada y firmada, usando
    Claude Vision para detectar si hay una firma manuscrita en el renglón del
    transportista (reemplaza la heurística anterior de densidad de tinta en
    una región fija, poco confiable con fotos torcidas). No es reconocimiento
    de identidad, solo detecta si hay una firma trazada; ante cualquier duda o
    falla devuelve None — de ahí sigue existiendo la confirmación manual de
    respaldo (con observación) en el flujo de /confirmar. El tipo de control
    (bulto/artículo) no se detecta acá: lo indica el empleado digitalmente al
    confirmar."""
    try:
        if _tipo_archivo(filename) == "pdf":
            doc = fitz.open(file_path)
            try:
                # La firma va al final de la hoja de control, después de la
                # tabla de ítems — con remitos largos eso puede caer en la
                # última página del escaneo, no en la primera.
                pix = doc[-1].get_pixmap(dpi=150)
                data = pix.tobytes("png")
            finally:
                doc.close()
            bloque = {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.standard_b64encode(data).decode("utf-8"),
                },
            }
        else:
            bloque = _bloque_imagen(file_path, filename)

        respuesta = _get_client().messages.create(
            model=_MODEL,
            max_tokens=200,
            system=_SYSTEM_VALIDACION,
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA_VALIDACION}},
            messages=[{
                "role": "user",
                "content": [bloque, {"type": "text", "text": "¿Hay una firma manuscrita en el renglón del transportista?"}],
            }],
        )
        if respuesta.stop_reason == "refusal":
            return {"firma_detectada": None}
        texto = next((b.text for b in respuesta.content if b.type == "text"), None)
        if not texto:
            return {"firma_detectada": None}
        return {"firma_detectada": json.loads(texto).get("firma_detectada")}
    except Exception:
        return {"firma_detectada": None}
