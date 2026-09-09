import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

# Deploy en Vercel (serverless, sin disco persistente): la base pasó de un
# archivo SQLite local a Postgres (Neon), y los archivos subidos (escaneos,
# comprobantes) de una carpeta local a una tabla `archivos` en la misma base
# — así no hace falta un segundo servicio de storage.
DATABASE_URL = os.environ["DATABASE_URL"]

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

SCHEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    username        TEXT PRIMARY KEY,
    password_hash   TEXT NOT NULL,
    rol             TEXT NOT NULL DEFAULT 'operativo',
    activo          INTEGER NOT NULL DEFAULT 1,
    creado_en       TEXT
);

CREATE TABLE IF NOT EXISTS proveedores (
    id              SERIAL PRIMARY KEY,
    codigo          TEXT,
    nombre          TEXT NOT NULL,
    nombre_fantasia TEXT,
    activo          INTEGER NOT NULL DEFAULT 1,
    actualizado_en  TEXT
);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores(nombre);

CREATE TABLE IF NOT EXISTS remitos (
    id                          SERIAL PRIMARY KEY,
    proveedor_id                INTEGER REFERENCES proveedores(id),
    cantidad_bultos_declarados  INTEGER,
    nro_remito                  TEXT,
    fecha_remito                TEXT,
    archivo_original            TEXT NOT NULL,
    tipo_archivo                TEXT NOT NULL,
    metodo_extraccion           TEXT,
    comprobante_final           TEXT,
    tilde_detectado             INTEGER,
    firma_detectada             INTEGER,
    confirmado_manualmente      INTEGER NOT NULL DEFAULT 0,
    observacion_confirmacion    TEXT,
    tipo_control                TEXT,
    estado                      TEXT NOT NULL DEFAULT 'pendiente',
    orden_compra_archivo        TEXT,
    ingresado_sistema_en        TEXT,
    usuario_ingreso_sistema     TEXT REFERENCES usuarios(username),
    creado_en                   TEXT,
    completado_en               TEXT,
    usuario_creador             TEXT REFERENCES usuarios(username),
    usuario_completo            TEXT REFERENCES usuarios(username)
);

CREATE TABLE IF NOT EXISTS remito_items (
    id                  SERIAL PRIMARY KEY,
    remito_id           INTEGER NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
    nro_orden           INTEGER NOT NULL,
    codigo_articulo     TEXT,
    descripcion         TEXT,
    cantidad_remito     REAL
);
CREATE INDEX IF NOT EXISTS idx_items_remito ON remito_items(remito_id);

CREATE TABLE IF NOT EXISTS remito_numeros (
    id          SERIAL PRIMARY KEY,
    remito_id   INTEGER NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
    numero      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remito_numeros ON remito_numeros(remito_id);

CREATE TABLE IF NOT EXISTS ordenes_compra (
    id                  SERIAL PRIMARY KEY,
    nro_oc              TEXT UNIQUE,
    proveedor_id        INTEGER REFERENCES proveedores(id),
    proveedor_nombre    TEXT,
    fecha_creacion      TEXT,
    fecha_entrega       TEXT,
    etapa               TEXT,
    cantidad_pedida     REAL,
    cantidad_recibida   REAL,
    cantidad_pendiente  REAL,
    importe_neto        REAL,
    actualizado_en      TEXT
);
CREATE INDEX IF NOT EXISTS idx_oc_proveedor ON ordenes_compra(proveedor_id);

-- Catálogo de artículos de Delmy (importado del sistema de gestión), usado
-- para verificar si lo que se lee de un remito/factura escaneado (código,
-- descripción) existe realmente y coincide con el catálogo. No se
-- relaciona 1 a 1 con remito_items — es una tabla de referencia aparte,
-- que se consulta al vuelo (búsqueda), sin guardar el resultado.
-- Un mismo código puede repetirse con distinto proveedor_id (multi-
-- proveedor real de Delmy) — por eso la clave es (codigo, proveedor_id), y
-- los combos (sin proveedor) usan codigo solo, con proveedor_id NULL.
CREATE TABLE IF NOT EXISTS articulos (
    id                          SERIAL PRIMARY KEY,
    codigo                      TEXT NOT NULL,
    descripcion                 TEXT,
    proveedor_id                INTEGER REFERENCES proveedores(id),
    proveedor_nombre_original   TEXT,
    cod_art_prov                TEXT,
    costo_real                  REAL,
    costo_plaza                 REAL,
    precio_venta                REAL,
    familia                     TEXT,
    categoria                   TEXT,
    es_combo                    INTEGER NOT NULL DEFAULT 0,
    activo                      INTEGER NOT NULL DEFAULT 1,
    actualizado_en              TEXT
);
CREATE INDEX IF NOT EXISTS idx_articulos_codigo ON articulos(codigo);
CREATE INDEX IF NOT EXISTS idx_articulos_proveedor ON articulos(proveedor_id);
-- Soportan el upsert masivo (ON CONFLICT) del importador del catálogo real.
CREATE UNIQUE INDEX IF NOT EXISTS uq_articulos_prov ON articulos (codigo, proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_articulos_combo ON articulos (codigo) WHERE proveedor_id IS NULL;

-- Cada vez que se importa el catálogo queda un registro de la carga
-- (cuándo, quién, cuántos artículos nuevos/actualizados/sin cambios), el
-- detalle campo por campo de qué cambió (articulos_cambios), y las
-- inconsistencias detectadas automáticamente para ir revisando
-- (articulos_inconsistencias) — proveedor no reconocido, combo con
-- proveedor, sin descripción, costo mayor al precio de venta, cambios de
-- costo muy bruscos entre una carga y la siguiente, etc.
CREATE TABLE IF NOT EXISTS articulos_cargas (
    id                          SERIAL PRIMARY KEY,
    archivo_original            TEXT,
    tipo_archivo                TEXT,
    cantidad_filas               INTEGER,
    cantidad_nuevos              INTEGER,
    cantidad_actualizados        INTEGER,
    cantidad_sin_cambios         INTEGER,
    cantidad_inconsistencias     INTEGER,
    creado_en                    TEXT,
    usuario_creador              TEXT REFERENCES usuarios(username)
);

CREATE TABLE IF NOT EXISTS articulos_cambios (
    id              SERIAL PRIMARY KEY,
    carga_id        INTEGER REFERENCES articulos_cargas(id) ON DELETE CASCADE,
    articulo_id     INTEGER,
    codigo          TEXT,
    proveedor_id    INTEGER,
    campo           TEXT,
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    creado_en       TEXT
);
CREATE INDEX IF NOT EXISTS idx_articulos_cambios_carga ON articulos_cambios(carga_id);
CREATE INDEX IF NOT EXISTS idx_articulos_cambios_codigo ON articulos_cambios(codigo);

CREATE TABLE IF NOT EXISTS articulos_inconsistencias (
    id          SERIAL PRIMARY KEY,
    carga_id    INTEGER REFERENCES articulos_cargas(id) ON DELETE CASCADE,
    codigo      TEXT,
    tipo        TEXT,
    detalle     TEXT,
    resuelta    INTEGER NOT NULL DEFAULT 0,
    creado_en   TEXT
);
CREATE INDEX IF NOT EXISTS idx_articulos_inc_resuelta ON articulos_inconsistencias(resuelta);

-- Ubicaciones físicas del depósito (estanterías). Código jerárquico:
-- PASILLO (01-10) - ESTANTERIA (10/20/30 derecha, 15/25/35 izquierda) -
-- ALTURA (10 primer piso, 20 segundo...) - UBICACION (10 primera posición
-- del piso, 20 la segunda...). Cada nivel es opcional: se puede cargar solo
-- el pasillo, o pasillo+estantería, sin necesidad de completar toda la
-- grilla — cada fila es una etiqueta imprimible en sí misma.
CREATE TABLE IF NOT EXISTS ubicaciones (
    id              SERIAL PRIMARY KEY,
    pasillo         TEXT NOT NULL,
    estanteria      TEXT,
    altura          TEXT,
    ubicacion       TEXT,
    codigo          TEXT NOT NULL UNIQUE,
    nivel           TEXT NOT NULL,
    lado            TEXT,
    descripcion     TEXT,
    activo          INTEGER NOT NULL DEFAULT 1,
    creado_en       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_codigo ON ubicaciones(codigo);

-- Cola de impresión: separada de la lista maestra a propósito — cargar una
-- ubicación una vez la deja disponible para siempre; la cola es solo "qué
-- imprimo ahora", se arma y se vacía sin afectar la lista maestra.
CREATE TABLE IF NOT EXISTS ubicaciones_cola_impresion (
    id              SERIAL PRIMARY KEY,
    ubicacion_id    INTEGER NOT NULL REFERENCES ubicaciones(id) ON DELETE CASCADE,
    agregado_en     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cola_ubicacion ON ubicaciones_cola_impresion(ubicacion_id);

-- Códigos de barra alternativos por artículo (un artículo puede tener
-- varios: EAN, código interno, código corto del proveedor) — usado para
-- identificar el artículo al escanear en el módulo de inventario.
CREATE TABLE IF NOT EXISTS articulos_codigos_barra (
    id              SERIAL PRIMARY KEY,
    codigo          TEXT NOT NULL,
    codigo_barra    TEXT NOT NULL,
    creado_en       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cb_barra ON articulos_codigos_barra(codigo_barra);
CREATE INDEX IF NOT EXISTS idx_cb_codigo ON articulos_codigos_barra(codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cb ON articulos_codigos_barra(codigo, codigo_barra);

-- Registro de inventario: qué artículo, en qué cantidad, se encontró en
-- qué ubicación física, y cuándo. Es un log (no se pisa) para tener
-- trazabilidad de cuándo se contó cada cosa.
CREATE TABLE IF NOT EXISTS inventario_ubicaciones (
    id              SERIAL PRIMARY KEY,
    ubicacion_id    INTEGER NOT NULL REFERENCES ubicaciones(id),
    codigo_articulo TEXT NOT NULL,
    cantidad        REAL NOT NULL,
    creado_en       TEXT,
    usuario         TEXT REFERENCES usuarios(username)
);
CREATE INDEX IF NOT EXISTS idx_inv_ubicacion ON inventario_ubicaciones(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_inv_articulo ON inventario_ubicaciones(codigo_articulo);

-- Espejo en vivo de lo que está pasando en la pantalla de escaneo de cada
-- usuario, ANTES de guardar — para poder verlo desde el celular mientras
-- la persona está lejos de la PC. Se pisa sola en cada cambio (no es un
-- historial, es "una foto" del momento actual por usuario).
CREATE TABLE IF NOT EXISTS inventario_estado_vivo (
    usuario                 TEXT PRIMARY KEY REFERENCES usuarios(username),
    ubicacion_codigo        TEXT,
    articulo_codigo         TEXT,
    articulo_descripcion    TEXT,
    cantidad                TEXT,
    posicion                TEXT,
    paso                    TEXT,
    actualizado_en          TEXT
);

-- Combos reales de Delmy y sus componentes (del archivo "exportacion_de_
-- combos_y_componentes.xlsx"). La mayoría son un solo componente a
-- multiplicador (ej. "REGLA X 20" = 20 unidades del mismo artículo
-- unitario) pero también hay combos mixtos con varios artículos distintos.
CREATE TABLE IF NOT EXISTS combos_componentes (
    id                      SERIAL PRIMARY KEY,
    combo_codigo            TEXT NOT NULL,
    combo_descripcion       TEXT,
    componente_codigo       TEXT NOT NULL,
    componente_descripcion  TEXT,
    cantidad                REAL,
    creado_en               TEXT
);
CREATE INDEX IF NOT EXISTS idx_combos_combo ON combos_componentes(combo_codigo);
CREATE INDEX IF NOT EXISTS idx_combos_componente ON combos_componentes(componente_codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_combos_componente ON combos_componentes(combo_codigo, componente_codigo);

-- Vercel corta en seco cualquier request a una función serverless que pese
-- más de 4.5 MB (límite duro de la plataforma, no configurable). Los
-- archivos de catálogo/códigos de barra superan eso fácil, así que se
-- suben en trozos desde el navegador y se van guardando acá hasta juntar
-- el archivo completo.
CREATE TABLE IF NOT EXISTS subidas_chunks (
    id              SERIAL PRIMARY KEY,
    subida_id       TEXT NOT NULL,
    indice          INTEGER NOT NULL,
    total           INTEGER NOT NULL,
    nombre_archivo  TEXT,
    datos           BYTEA NOT NULL,
    creado_en       TEXT
);
CREATE INDEX IF NOT EXISTS idx_subidas_chunks_id ON subidas_chunks(subida_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subidas_chunk ON subidas_chunks(subida_id, indice);

-- Propuestas de alta de artículo nuevo o corrección, generadas desde
-- Identificación e inventario o Revisión de remitos cuando un artículo no
-- se encuentra en el catálogo. No modifican nada del catálogo local — son
-- una cola para juntar y después exportar en el formato de Importación
-- Masiva, y cargarlas a mano en el sistema de gestión real.
CREATE TABLE IF NOT EXISTS propuestas_articulos (
    id                  SERIAL PRIMARY KEY,
    tipo                TEXT NOT NULL,
    codigo              TEXT,
    descripcion         TEXT,
    proveedor_nombre    TEXT,
    cod_art_prov        TEXT,
    familia             TEXT,
    categoria           TEXT,
    marca               TEXT,
    costo               REAL,
    precio_venta        REAL,
    observacion         TEXT,
    origen              TEXT,
    origen_referencia   TEXT,
    estado              TEXT NOT NULL DEFAULT 'pendiente',
    creado_en           TEXT,
    usuario             TEXT REFERENCES usuarios(username)
);
CREATE INDEX IF NOT EXISTS idx_propuestas_estado ON propuestas_articulos(estado);

-- Cuando en "Revisión de remitos" alguien confirma a mano cuál artículo
-- del catálogo corresponde a una línea leída (entre varios candidatos, o
-- una recomendación de baja confianza) queda anotado acá — no se toca la
-- tabla de remitos real, es solo un registro de la confirmación.
CREATE TABLE IF NOT EXISTS revision_confirmaciones (
    id                  SERIAL PRIMARY KEY,
    remito_id           INTEGER NOT NULL,
    nro_orden           INTEGER NOT NULL,
    codigo_confirmado   TEXT NOT NULL,
    usuario             TEXT REFERENCES usuarios(username),
    creado_en           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_confirmacion ON revision_confirmaciones(remito_id, nro_orden);

-- Carga de compras (fase previa a la recepción): cabecera de cada
-- documento de compra cargado (factura/OC del proveedor, escaneada o en
-- Excel) y el detalle de artículos reconocido en él. cantidad_comprada es
-- SIEMPRE lo que se leyó del documento — nunca un valor inventado. Los
-- campos reparto_* arrancan vacíos: se completan a mano (todavía no hay
-- forma de leer el reparto entre depósito/sucursales desde el documento).
CREATE TABLE IF NOT EXISTS compras_cargadas (
    id                  SERIAL PRIMARY KEY,
    proveedor_id        INTEGER REFERENCES proveedores(id),
    archivo_original    TEXT,
    tipo_archivo        TEXT,
    metodo_extraccion   TEXT,
    nro_documento       TEXT,
    fecha_documento     TEXT,
    creado_en           TEXT,
    usuario_creador     TEXT REFERENCES usuarios(username)
);

CREATE TABLE IF NOT EXISTS compra_items (
    id                  SERIAL PRIMARY KEY,
    compra_id           INTEGER NOT NULL REFERENCES compras_cargadas(id) ON DELETE CASCADE,
    nro_orden           INTEGER NOT NULL,
    codigo_articulo     TEXT,
    descripcion         TEXT,
    cantidad_comprada   REAL,
    reparto_deposito    REAL,
    reparto_delmy1      REAL,
    reparto_delmy3      REAL
);
CREATE INDEX IF NOT EXISTS idx_compra_items_compra ON compra_items(compra_id);

CREATE TABLE IF NOT EXISTS archivos (
    nombre      TEXT PRIMARY KEY,
    tipo_mime   TEXT NOT NULL,
    contenido   BYTEA NOT NULL,
    creado_en   TEXT
);

-- Escaneos que llegan solos por mail (el escáner de la oficina manda el PDF
-- por mail) y todavía no tienen proveedor/bultos asignados — eso lo carga
-- un empleado a mano desde la pantalla de "Escaneos sin asignar".
CREATE TABLE IF NOT EXISTS escaneos_entrantes (
    id              SERIAL PRIMARY KEY,
    archivo_nombre  TEXT NOT NULL REFERENCES archivos(nombre),
    remitente       TEXT,
    asunto          TEXT,
    message_id      TEXT UNIQUE,
    recibido_en     TEXT,
    estado          TEXT NOT NULL DEFAULT 'pendiente',
    remito_id       INTEGER REFERENCES remitos(id),
    asignado_en     TEXT
);
CREATE INDEX IF NOT EXISTS idx_escaneos_estado ON escaneos_entrantes(estado);
"""


def _ahora_txt() -> str:
    """Hora de Argentina como texto "YYYY-MM-DD HH:MM:SS", con el mismo
    formato que usaba SQLite (datetime('now','localtime')) — se calcula acá
    en vez de con una función de la base porque el servidor de Vercel corre
    en UTC, no en la hora local del depósito."""
    return datetime.now(_TZ_AR).strftime("%Y-%m-%d %H:%M:%S")


def get_conn() -> psycopg.Connection:
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return conn


_COLUMNAS_NUEVAS_REMITOS = {
    "orden_compra_archivo": "TEXT",
    "ingresado_sistema_en": "TEXT",
    "usuario_ingreso_sistema": "TEXT",
    "orden_compra_id": "INTEGER REFERENCES ordenes_compra(id)",
    "tipo_control": "TEXT",
    "observacion_confirmacion": "TEXT",
    # Proveedores que mandan el remito solo con cantidad de bultos, sin
    # detalle de artículos: se completa el control por bulto igual, pero
    # queda marcado que falta cargar los artículos más adelante (cuando se
    # abren los bultos y se puede identificar qué había en cada uno).
    "articulos_pendientes": "INTEGER NOT NULL DEFAULT 0",
    # Escaneo de respaldo cuando se lee el detalle de artículos aparte del
    # remito original (ej. remito por bulto + factura con artículos): se
    # guarda también ese archivo, no solo se usa para la lectura automática.
    "archivo_articulos": "TEXT",
    # Foto/PDF de la hoja de control por artículo ya controlada (sin
    # detección de firma, a diferencia del comprobante del bulto — acá
    # alcanza con la evidencia de que el control se hizo). Se sube recién al
    # terminar ese control, no alcanza con haber cargado la lista de ítems.
    "comprobante_articulos": "TEXT",
    "articulos_completados_en": "TEXT",
    "usuario_articulos_completados": "TEXT",
}

_COLUMNAS_NUEVAS_PROVEEDORES = {
    "nombre_fantasia": "TEXT",
}

_COLUMNAS_NUEVAS_ARTICULOS = {
    "proveedor_nombre_original": "TEXT",
    "cod_art_prov": "TEXT",
    "costo_real": "REAL",
    "costo_plaza": "REAL",
    "precio_venta": "REAL",
    "familia": "TEXT",
    "categoria": "TEXT",
    "es_combo": "INTEGER NOT NULL DEFAULT 0",
    "marca": "TEXT",
}

# Muchos proveedores mandan la cantidad/reparto como texto que no es un
# número limpio ("1/2 display", "1x25", "MITAD CADA UNA") — se intenta
# sacar el número cuando se puede, pero el texto original SIEMPRE se
# guarda acá al lado, para no perder el dato aunque no se pueda convertir.
_COLUMNAS_NUEVAS_COMPRA_ITEMS = {
    "cantidad_comprada_texto": "TEXT",
    "reparto_deposito_texto": "TEXT",
    "reparto_delmy1_texto": "TEXT",
    "reparto_delmy3_texto": "TEXT",
}


def _migrar_columnas(conn: psycopg.Connection, tabla: str, columnas_nuevas: dict):
    columnas_actuales = {
        r["column_name"]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s", (tabla,)
        ).fetchall()
    }
    for nombre, tipo in columnas_nuevas.items():
        if nombre not in columnas_actuales:
            conn.execute(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo}")


def _migrar(conn: psycopg.Connection):
    _migrar_columnas(conn, "remitos", _COLUMNAS_NUEVAS_REMITOS)
    _migrar_columnas(conn, "proveedores", _COLUMNAS_NUEVAS_PROVEEDORES)
    _migrar_columnas(conn, "articulos", _COLUMNAS_NUEVAS_ARTICULOS)
    _migrar_columnas(conn, "compra_items", _COLUMNAS_NUEVAS_COMPRA_ITEMS)


def init_db():
    with get_conn() as conn:
        conn.execute(SCHEMA)
        _migrar(conn)


# ---------------------------------------------------------------- archivos

def guardar_archivo(nombre: str, contenido: bytes, tipo_mime: str):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO archivos (nombre, tipo_mime, contenido, creado_en)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (nombre) DO UPDATE SET
                 tipo_mime = EXCLUDED.tipo_mime,
                 contenido = EXCLUDED.contenido""",
            (nombre, tipo_mime, contenido, _ahora_txt()),
        )


def leer_archivo(nombre: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT tipo_mime, contenido FROM archivos WHERE nombre = %s", (nombre,)
        ).fetchone()
        return dict(row) if row else None


def borrar_archivo(nombre: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM archivos WHERE nombre = %s", (nombre,))


# ------------------------------------------------------- escaneos_entrantes

def crear_escaneo_entrante(
    archivo_nombre: str, remitente: str | None, asunto: str | None, message_id: str
) -> int | None:
    """Devuelve el id creado, o None si ese message_id ya se había importado
    antes (evita duplicar un escaneo si el cron corre dos veces sobre el
    mismo mail antes de que se marque como leído)."""
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO escaneos_entrantes (archivo_nombre, remitente, asunto, message_id, recibido_en)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (message_id) DO NOTHING
               RETURNING id""",
            (archivo_nombre, remitente, asunto, message_id, _ahora_txt()),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def listar_escaneos_pendientes() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT escaneos_entrantes.*, archivos.tipo_mime
               FROM escaneos_entrantes
               JOIN archivos ON archivos.nombre = escaneos_entrantes.archivo_nombre
               WHERE estado = 'pendiente'
               ORDER BY recibido_en"""
        ).fetchall()
        return [dict(r) for r in rows]


def contar_escaneos_pendientes() -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS c FROM escaneos_entrantes WHERE estado = 'pendiente'"
        ).fetchone()["c"]


def get_escaneo_entrante(escaneo_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT escaneos_entrantes.*, archivos.tipo_mime
               FROM escaneos_entrantes
               JOIN archivos ON archivos.nombre = escaneos_entrantes.archivo_nombre
               WHERE escaneos_entrantes.id = %s""",
            (escaneo_id,),
        ).fetchone()
        return dict(row) if row else None


def marcar_escaneo_asignado(escaneo_id: int, remito_id: int):
    with get_conn() as conn:
        conn.execute(
            """UPDATE escaneos_entrantes SET estado = 'asignado', remito_id = %s, asignado_en = %s
               WHERE id = %s""",
            (remito_id, _ahora_txt(), escaneo_id),
        )


# ---------------------------------------------------------------- usuarios

def has_usuarios() -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM usuarios").fetchone()
        return row["c"] > 0


def crear_usuario(username: str, password_hash: str, rol: str = "operativo"):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO usuarios (username, password_hash, rol, activo, creado_en) VALUES (%s, %s, %s, 1, %s)",
            (username.strip().lower(), password_hash, rol, _ahora_txt()),
        )


def get_usuario(username: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM usuarios WHERE username = %s", (username.strip().lower(),)
        ).fetchone()
        return dict(row) if row else None


def listar_usuarios() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM usuarios ORDER BY username").fetchall()
        return [dict(r) for r in rows]


def set_usuario_activo(username: str, activo: bool):
    with get_conn() as conn:
        conn.execute(
            "UPDATE usuarios SET activo = %s WHERE username = %s",
            (1 if activo else 0, username.strip().lower()),
        )


def set_password(username: str, password_hash: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE usuarios SET password_hash = %s WHERE username = %s",
            (password_hash, username.strip().lower()),
        )


# -------------------------------------------------------------- proveedores

def upsert_proveedor(codigo: str | None, nombre: str, nombre_fantasia: str | None = None):
    # "nombre" es siempre la razón social — es lo que se muestra en la hoja
    # de control y en toda la app. "nombre_fantasia" solo se usa para que la
    # búsqueda también encuentre al proveedor por como lo conoce el
    # empleado, cuando ese nombre es distinto de la razón social.
    nombre = nombre.strip()
    nombre_fantasia = (nombre_fantasia or "").strip() or None
    with get_conn() as conn:
        if codigo:
            codigo = codigo.strip()
            existente = conn.execute(
                "SELECT id FROM proveedores WHERE codigo = %s", (codigo,)
            ).fetchone()
        else:
            existente = conn.execute(
                "SELECT id FROM proveedores WHERE codigo IS NULL AND nombre = %s", (nombre,)
            ).fetchone()

        if existente:
            conn.execute(
                "UPDATE proveedores SET nombre = %s, nombre_fantasia = %s, activo = 1, actualizado_en = %s WHERE id = %s",
                (nombre, nombre_fantasia, _ahora_txt(), existente["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO proveedores (codigo, nombre, nombre_fantasia, activo, actualizado_en)
                   VALUES (%s, %s, %s, 1, %s)""",
                (codigo, nombre, nombre_fantasia, _ahora_txt()),
            )


def buscar_proveedores(q: str = "", limite: int = 20) -> list[dict]:
    with get_conn() as conn:
        if q:
            rows = conn.execute(
                """SELECT * FROM proveedores WHERE activo = 1
                   AND (nombre ILIKE %s OR nombre_fantasia ILIKE %s)
                   ORDER BY nombre LIMIT %s""",
                (f"%{q}%", f"%{q}%", limite),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre LIMIT %s", (limite,)
            ).fetchall()
        return [dict(r) for r in rows]


def listar_proveedores() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM proveedores ORDER BY nombre").fetchall()
        return [dict(r) for r in rows]


def get_proveedor(proveedor_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM proveedores WHERE id = %s", (proveedor_id,)).fetchone()
        return dict(row) if row else None


def get_proveedor_por_nombre(nombre: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM proveedores WHERE nombre ILIKE %s LIMIT 1", (nombre,)).fetchone()
        return dict(row) if row else None


def _resolver_proveedor_id(conn: psycopg.Connection, nombre: str) -> int | None:
    row = conn.execute(
        "SELECT id FROM proveedores WHERE nombre ILIKE %s", (nombre,)
    ).fetchone()
    return row["id"] if row else None


# ------------------------------------------------------------ ordenes_compra

def upsert_orden_compra(datos: dict):
    with get_conn() as conn:
        proveedor_id = _resolver_proveedor_id(conn, datos["proveedor_nombre"])
        existente = conn.execute(
            "SELECT id FROM ordenes_compra WHERE nro_oc = %s", (datos["nro_oc"],)
        ).fetchone()
        campos = (
            proveedor_id,
            datos["proveedor_nombre"],
            datos.get("fecha_creacion"),
            datos.get("fecha_entrega"),
            datos.get("etapa"),
            datos.get("cantidad_pedida"),
            datos.get("cantidad_recibida"),
            datos.get("cantidad_pendiente"),
            datos.get("importe_neto"),
        )
        if existente:
            conn.execute(
                """UPDATE ordenes_compra SET
                     proveedor_id = %s, proveedor_nombre = %s, fecha_creacion = %s, fecha_entrega = %s,
                     etapa = %s, cantidad_pedida = %s, cantidad_recibida = %s, cantidad_pendiente = %s,
                     importe_neto = %s, actualizado_en = %s
                   WHERE id = %s""",
                campos + (_ahora_txt(), existente["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO ordenes_compra
                   (proveedor_id, proveedor_nombre, fecha_creacion, fecha_entrega, etapa,
                    cantidad_pedida, cantidad_recibida, cantidad_pendiente, importe_neto,
                    actualizado_en, nro_oc)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                campos + (_ahora_txt(), datos["nro_oc"]),
            )


def listar_ordenes_compra_por_proveedor(proveedor_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM ordenes_compra WHERE proveedor_id = %s ORDER BY fecha_creacion DESC",
            (proveedor_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def listar_ordenes_compra() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ordenes_compra ORDER BY actualizado_en DESC").fetchall()
        return [dict(r) for r in rows]


def get_orden_compra(orden_compra_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM ordenes_compra WHERE id = %s", (orden_compra_id,)
        ).fetchone()
        return dict(row) if row else None


def vincular_orden_compra(remito_id: int, orden_compra_id: int, usuario: str, automatico: bool):
    with get_conn() as conn:
        conn.execute(
            """UPDATE remitos SET
                 orden_compra_id = %s,
                 ingresado_sistema_en = %s,
                 usuario_ingreso_sistema = %s
               WHERE id = %s""",
            (orden_compra_id, _ahora_txt(), "automático (cruce OC)" if automatico else usuario, remito_id),
        )


def intentar_cruce_automatico(tolerancia_pct: float = 0.05) -> int:
    """Compara cada remito completado (y todavía sin ingreso al sistema) contra las
    órdenes de compra importadas del mismo proveedor, por cantidad total de artículos.
    Si encuentra una OC cuya cantidad pedida o recibida coincide dentro de la tolerancia
    Y esa OC ya figura con recepción total en el sistema (cantidad_pendiente = 0),
    vincula automáticamente. Devuelve cuántos remitos quedaron vinculados."""
    vinculados = 0
    with get_conn() as conn:
        remitos_pendientes = conn.execute(
            """SELECT id, proveedor_id FROM remitos
               WHERE estado = 'completado' AND ingresado_sistema_en IS NULL
                 AND proveedor_id IS NOT NULL"""
        ).fetchall()
        for remito in remitos_pendientes:
            total_cant = conn.execute(
                "SELECT SUM(cantidad_remito) AS s FROM remito_items WHERE remito_id = %s",
                (remito["id"],),
            ).fetchone()["s"]
            if not total_cant:
                continue

            candidatas = conn.execute(
                """SELECT id, cantidad_pedida, cantidad_recibida, cantidad_pendiente
                   FROM ordenes_compra WHERE proveedor_id = %s""",
                (remito["proveedor_id"],),
            ).fetchall()

            mejor = None
            mejor_diff = None
            for oc in candidatas:
                if oc["cantidad_pendiente"] not in (0, 0.0):
                    continue  # solo interesa si el sistema ya la marca con recepción total
                for cantidad_oc in (oc["cantidad_pedida"], oc["cantidad_recibida"]):
                    if cantidad_oc is None:
                        continue
                    diff = abs(cantidad_oc - total_cant)
                    tolerancia = max(1, tolerancia_pct * total_cant)
                    if diff <= tolerancia and (mejor_diff is None or diff < mejor_diff):
                        mejor, mejor_diff = oc, diff

            if mejor:
                conn.execute(
                    """UPDATE remitos SET orden_compra_id = %s,
                         ingresado_sistema_en = %s,
                         usuario_ingreso_sistema = 'automático (cruce OC)'
                       WHERE id = %s""",
                    (mejor["id"], _ahora_txt(), remito["id"]),
                )
                vinculados += 1
    return vinculados


# ------------------------------------------------------------------ articulos

# ------------------------------------------------------------------ articulos

def _num_o_none(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or s == "-":
        return None
    try:
        return round(float(s), 2)
    except (TypeError, ValueError):
        return None


def _valor_distinto(anterior, nuevo) -> bool:
    if anterior is None and nuevo is None:
        return False
    if isinstance(anterior, float) or isinstance(nuevo, float):
        try:
            return round(float(anterior or 0), 2) != round(float(nuevo or 0), 2)
        except (TypeError, ValueError):
            return anterior != nuevo
    return anterior != nuevo


def _insertar_lote(conn, tabla: str, columnas: list[str], filas: list[tuple], chunk: int = 500):
    """INSERT de varias filas por sentencia (pocas idas y vueltas a la
    base), usado para el historial de cambios e inconsistencias."""
    if not filas:
        return
    cols_sql = ", ".join(columnas)
    for i in range(0, len(filas), chunk):
        lote = filas[i:i + chunk]
        placeholders = ", ".join("(" + ", ".join(["%s"] * len(columnas)) + ")" for _ in lote)
        parametros = [v for fila in lote for v in fila]
        conn.execute(f"INSERT INTO {tabla} ({cols_sql}) VALUES {placeholders}", parametros)


def _upsert_articulos_lote(conn, filas: list[tuple], con_proveedor: bool, chunk: int = 500):
    """Alta/actualización masiva del catálogo. Usa INSERT ... ON CONFLICT
    en lotes de a `chunk` filas por sentencia — con 37.000+ artículos, hacer
    un SELECT+INSERT/UPDATE por fila sería demasiado lento (y arriesgaría el
    límite de tiempo de una función serverless de Vercel)."""
    if not filas:
        return
    columnas = (
        "codigo, descripcion, proveedor_id, proveedor_nombre_original, cod_art_prov, "
        "costo_real, costo_plaza, precio_venta, familia, categoria, marca, es_combo, activo, actualizado_en"
    )
    conflicto = (
        "(codigo, proveedor_id) WHERE proveedor_id IS NOT NULL"
        if con_proveedor else
        "(codigo) WHERE proveedor_id IS NULL"
    )
    for i in range(0, len(filas), chunk):
        lote = filas[i:i + chunk]
        placeholders = ", ".join("(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s)" for _ in lote)
        parametros = [v for fila in lote for v in fila]
        conn.execute(
            f"""INSERT INTO articulos ({columnas})
                VALUES {placeholders}
                ON CONFLICT {conflicto}
                DO UPDATE SET
                    descripcion = EXCLUDED.descripcion,
                    proveedor_nombre_original = EXCLUDED.proveedor_nombre_original,
                    cod_art_prov = EXCLUDED.cod_art_prov,
                    costo_real = EXCLUDED.costo_real,
                    costo_plaza = EXCLUDED.costo_plaza,
                    precio_venta = EXCLUDED.precio_venta,
                    familia = EXCLUDED.familia,
                    categoria = EXCLUDED.categoria,
                    marca = EXCLUDED.marca,
                    es_combo = EXCLUDED.es_combo,
                    activo = 1,
                    actualizado_en = EXCLUDED.actualizado_en""",
            parametros,
        )


def crear_carga_articulos(archivo_original: str, usuario_creador: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO articulos_cargas (archivo_original, tipo_archivo, creado_en, usuario_creador)
               VALUES (%s, 'catalogo_razon_social', %s, %s) RETURNING id""",
            (archivo_original, _ahora_txt(), usuario_creador),
        )
        return cur.fetchone()["id"]


def procesar_carga_articulos(carga_id: int, filas: list[dict]) -> dict:
    """filas: dicts con codigo, proveedor_nombre, cod_art_prov, descripcion,
    familia, categoria, costo_real, costo_plaza, precio_venta, es_combo.

    Hace todo en pocas consultas (pensado para +30.000 filas): trae de una
    vez los proveedores conocidos y el estado actual del catálogo, calcula
    en Python qué es nuevo/actualizado/sin cambios y qué inconsistencias
    hay, y recién ahí escribe todo en lotes. Nunca inventa un proveedor: si
    el nombre del archivo no matchea ningún proveedor ya cargado en la app,
    el artículo igual se guarda (para no perder el resto de los datos) pero
    queda marcado como inconsistencia para revisar el nombre."""
    ahora = _ahora_txt()
    with get_conn() as conn:
        proveedores = {
            r["nombre"].strip().upper(): r["id"]
            for r in conn.execute("SELECT id, nombre FROM proveedores WHERE activo = 1").fetchall()
        }
        existentes = {
            (r["codigo"], r["proveedor_id"]): r
            for r in conn.execute("SELECT * FROM articulos").fetchall()
        }

        nuevos = actualizados = sin_cambios = 0
        cambios: list[tuple] = []
        inconsistencias: list[tuple] = []
        filas_unitarios: list[tuple] = []
        filas_combos: list[tuple] = []

        def _marcar(codigo, tipo, detalle):
            inconsistencias.append((carga_id, codigo, tipo, detalle, ahora))

        for fila in filas:
            codigo = fila["codigo"]
            nombre_prov = (fila.get("proveedor_nombre") or "").strip()
            es_combo = bool(fila.get("es_combo"))

            proveedor_id = None
            if nombre_prov:
                proveedor_id = proveedores.get(nombre_prov.upper())
                if proveedor_id is None:
                    _marcar(codigo, "proveedor_no_encontrado",
                            f'El proveedor "{nombre_prov}" del archivo no está en el maestro de proveedores de la app — revisar el nombre o cargarlo.')
            if es_combo and nombre_prov:
                _marcar(codigo, "combo_con_proveedor",
                        f'El código {codigo} viene marcado como combo (sin proveedor) pero en esta fila tiene proveedor "{nombre_prov}" asignado.')

            valores = {
                "descripcion": fila.get("descripcion"),
                "familia": fila.get("familia"),
                "categoria": fila.get("categoria"),
                "cod_art_prov": fila.get("cod_art_prov"),
                "costo_real": fila.get("costo_real"),
                "costo_plaza": fila.get("costo_plaza"),
                "precio_venta": fila.get("precio_venta"),
                "marca": fila.get("marca"),
                "es_combo": 1 if es_combo else 0,
            }

            if not valores["descripcion"]:
                _marcar(codigo, "sin_descripcion", "El artículo no tiene descripción en el archivo.")
            if (valores["costo_real"] not in (None, 0) and valores["precio_venta"] not in (None, 0)
                    and valores["costo_real"] > valores["precio_venta"]):
                _marcar(codigo, "costo_mayor_a_precio_venta",
                        f'Costo real (${valores["costo_real"]:.2f}) mayor al precio de venta mínimo (${valores["precio_venta"]:.2f}).')

            clave = (codigo, proveedor_id)
            anterior = existentes.get(clave)
            if anterior is None:
                nuevos += 1
            else:
                hubo_cambio = False
                for campo, nuevo_valor in valores.items():
                    viejo_valor = anterior.get(campo)
                    if _valor_distinto(viejo_valor, nuevo_valor):
                        hubo_cambio = True
                        cambios.append((
                            carga_id, anterior["id"], codigo, proveedor_id, campo,
                            None if viejo_valor is None else str(viejo_valor),
                            None if nuevo_valor is None else str(nuevo_valor),
                            ahora,
                        ))
                        if campo == "costo_real" and viejo_valor and nuevo_valor and viejo_valor > 0:
                            variacion = abs(nuevo_valor - viejo_valor) / viejo_valor
                            if variacion >= 0.5:
                                _marcar(codigo, "cambio_costo_brusco",
                                        f"El costo real cambió de ${viejo_valor:.2f} a ${nuevo_valor:.2f} "
                                        f"({variacion * 100:.0f}% de variación) respecto a la carga anterior.")
                if hubo_cambio:
                    actualizados += 1
                else:
                    sin_cambios += 1

            fila_final = (
                codigo, valores["descripcion"], proveedor_id, nombre_prov or None,
                valores["cod_art_prov"], valores["costo_real"], valores["costo_plaza"],
                valores["precio_venta"], valores["familia"], valores["categoria"],
                valores["marca"], valores["es_combo"], ahora,
            )
            (filas_unitarios if proveedor_id is not None else filas_combos).append(fila_final)

        _upsert_articulos_lote(conn, filas_unitarios, con_proveedor=True)
        _upsert_articulos_lote(conn, filas_combos, con_proveedor=False)

        _insertar_lote(conn, "articulos_cambios",
                        ["carga_id", "articulo_id", "codigo", "proveedor_id", "campo", "valor_anterior", "valor_nuevo", "creado_en"],
                        cambios)
        _insertar_lote(conn, "articulos_inconsistencias",
                        ["carga_id", "codigo", "tipo", "detalle", "creado_en"],
                        inconsistencias)

        conn.execute(
            """UPDATE articulos_cargas SET
                 cantidad_filas = %s, cantidad_nuevos = %s, cantidad_actualizados = %s,
                 cantidad_sin_cambios = %s, cantidad_inconsistencias = %s
               WHERE id = %s""",
            (len(filas), nuevos, actualizados, sin_cambios, len(inconsistencias), carga_id),
        )

    return {
        "filas": len(filas), "nuevos": nuevos, "actualizados": actualizados,
        "sin_cambios": sin_cambios, "inconsistencias": len(inconsistencias),
    }


def contar_articulos() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM articulos").fetchone()["c"]


def buscar_articulo_exacto(codigo: str, proveedor_id: int | None) -> dict | None:
    """Busca por código exacto (sin distinguir mayúsculas/espacios extremos),
    SIEMPRE acotado al proveedor cuando se conoce — un código que coincide
    de casualidad con un artículo de OTRO proveedor no tiene nada que ver
    (ej. "20105" del remito de un proveedor coincidiendo con el código
    interno de un producto totalmente distinto de otro proveedor). Solo se
    busca en todo el catálogo sin filtrar cuando no hay proveedor conocido."""
    codigo = (codigo or "").strip()
    if not codigo:
        return None
    with get_conn() as conn:
        if proveedor_id is not None:
            row = conn.execute(
                "SELECT * FROM articulos WHERE activo = 1 AND proveedor_id = %s AND UPPER(TRIM(codigo)) = UPPER(%s)",
                (proveedor_id, codigo),
            ).fetchone()
            return dict(row) if row else None
        row = conn.execute(
            "SELECT * FROM articulos WHERE activo = 1 AND UPPER(TRIM(codigo)) = UPPER(%s) LIMIT 1",
            (codigo,),
        ).fetchone()
        return dict(row) if row else None


def listar_articulos_por_proveedor(proveedor_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM articulos WHERE activo = 1 AND proveedor_id = %s", (proveedor_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def listar_articulos(q: str = "", limite: int = 500) -> list[dict]:
    with get_conn() as conn:
        if q:
            rows = conn.execute(
                """SELECT a.*, p.nombre AS proveedor_nombre FROM articulos a
                   LEFT JOIN proveedores p ON p.id = a.proveedor_id
                   WHERE a.activo = 1 AND (a.codigo ILIKE %s OR a.descripcion ILIKE %s)
                   ORDER BY a.codigo LIMIT %s""",
                (f"%{q}%", f"%{q}%", limite),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT a.*, p.nombre AS proveedor_nombre FROM articulos a
                   LEFT JOIN proveedores p ON p.id = a.proveedor_id
                   ORDER BY a.actualizado_en DESC LIMIT %s""",
                (limite,),
            ).fetchall()
        return [dict(r) for r in rows]


def listar_articulos_cargas() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM articulos_cargas ORDER BY creado_en DESC").fetchall()
        return [dict(r) for r in rows]


def listar_inconsistencias(solo_abiertas: bool = True, limite: int = 1000) -> list[dict]:
    with get_conn() as conn:
        if solo_abiertas:
            rows = conn.execute(
                "SELECT * FROM articulos_inconsistencias WHERE resuelta = 0 ORDER BY creado_en DESC LIMIT %s",
                (limite,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM articulos_inconsistencias ORDER BY creado_en DESC LIMIT %s", (limite,)
            ).fetchall()
        return [dict(r) for r in rows]


def contar_inconsistencias_abiertas() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM articulos_inconsistencias WHERE resuelta = 0").fetchone()["c"]


def marcar_inconsistencia_resuelta(inconsistencia_id: int):
    with get_conn() as conn:
        conn.execute("UPDATE articulos_inconsistencias SET resuelta = 1 WHERE id = %s", (inconsistencia_id,))


# ---------------------------------------------------------- subidas_chunks

def guardar_chunk(subida_id: str, indice: int, total: int, nombre_archivo: str, datos: bytes):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO subidas_chunks (subida_id, indice, total, nombre_archivo, datos, creado_en)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (subida_id, indice) DO UPDATE SET datos = EXCLUDED.datos""",
            (subida_id, indice, total, nombre_archivo, datos, _ahora_txt()),
        )


def contar_chunks(subida_id: str) -> tuple[int, int]:
    """Devuelve (recibidos, total) — total viene de cualquiera de los
    chunks ya guardados (todos traen el mismo valor)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS recibidos, MAX(total) AS total FROM subidas_chunks WHERE subida_id = %s",
            (subida_id,),
        ).fetchone()
        return (row["recibidos"] or 0, row["total"] or 0)


def reconstruir_archivo(subida_id: str) -> tuple[str | None, bytes | None]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT indice, nombre_archivo, datos FROM subidas_chunks WHERE subida_id = %s ORDER BY indice",
            (subida_id,),
        ).fetchall()
        if not rows:
            return None, None
        nombre = rows[0]["nombre_archivo"]
        completo = b"".join(bytes(r["datos"]) for r in rows)
        return nombre, completo


def borrar_chunks(subida_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM subidas_chunks WHERE subida_id = %s", (subida_id,))


# ----------------------------------------------------------- propuestas

def crear_propuesta_articulo(
    tipo: str, codigo: str | None, descripcion: str | None, proveedor_nombre: str | None,
    cod_art_prov: str | None, familia: str | None, categoria: str | None, marca: str | None,
    costo: float | None, precio_venta: float | None, observacion: str | None,
    origen: str, origen_referencia: str | None, usuario: str,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO propuestas_articulos
               (tipo, codigo, descripcion, proveedor_nombre, cod_art_prov, familia, categoria,
                marca, costo, precio_venta, observacion, origen, origen_referencia, estado, creado_en, usuario)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pendiente', %s, %s) RETURNING id""",
            (tipo, codigo, descripcion, proveedor_nombre, cod_art_prov, familia, categoria,
             marca, costo, precio_venta, observacion, origen, origen_referencia, _ahora_txt(), usuario),
        )
        return cur.fetchone()["id"]


def listar_propuestas(solo_pendientes: bool = True) -> list[dict]:
    with get_conn() as conn:
        if solo_pendientes:
            rows = conn.execute(
                "SELECT * FROM propuestas_articulos WHERE estado = 'pendiente' ORDER BY creado_en DESC"
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM propuestas_articulos ORDER BY creado_en DESC").fetchall()
        return [dict(r) for r in rows]


def contar_propuestas_pendientes() -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS c FROM propuestas_articulos WHERE estado = 'pendiente'"
        ).fetchone()["c"]


def get_propuestas_por_ids(ids: list[int]) -> list[dict]:
    if not ids:
        return []
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM propuestas_articulos WHERE id = ANY(%s)", (ids,)).fetchall()
        return [dict(r) for r in rows]


def marcar_propuestas_exportadas(ids: list[int]):
    if not ids:
        return
    with get_conn() as conn:
        conn.execute(
            "UPDATE propuestas_articulos SET estado = 'exportada' WHERE id = ANY(%s)", (ids,)
        )


def eliminar_propuesta(propuesta_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM propuestas_articulos WHERE id = %s", (propuesta_id,))


def confirmar_match_revision(remito_id: int, nro_orden: int, codigo_confirmado: str, usuario: str):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO revision_confirmaciones (remito_id, nro_orden, codigo_confirmado, usuario, creado_en)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (remito_id, nro_orden) DO UPDATE SET
                   codigo_confirmado = EXCLUDED.codigo_confirmado,
                   usuario = EXCLUDED.usuario,
                   creado_en = EXCLUDED.creado_en""",
            (remito_id, nro_orden, codigo_confirmado, usuario, _ahora_txt()),
        )


def quitar_confirmacion_revision(remito_id: int, nro_orden: int):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM revision_confirmaciones WHERE remito_id = %s AND nro_orden = %s",
            (remito_id, nro_orden),
        )


def get_confirmaciones_remito(remito_id: int) -> dict[int, dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM revision_confirmaciones WHERE remito_id = %s", (remito_id,)
        ).fetchall()
        return {r["nro_orden"]: dict(r) for r in rows}


# ---------------------------------------------------------------- compras

def crear_compra_cargada(
    proveedor_id: int | None,
    archivo_original: str | None,
    tipo_archivo: str,
    metodo_extraccion: str | None,
    nro_documento: str | None,
    fecha_documento: str | None,
    usuario_creador: str,
    items: list[dict],
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO compras_cargadas
               (proveedor_id, archivo_original, tipo_archivo, metodo_extraccion,
                nro_documento, fecha_documento, creado_en, usuario_creador)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (proveedor_id, archivo_original, tipo_archivo, metodo_extraccion,
             nro_documento, fecha_documento, _ahora_txt(), usuario_creador),
        )
        compra_id = cur.fetchone()["id"]
        for i, it in enumerate(items, start=1):
            conn.execute(
                """INSERT INTO compra_items
                   (compra_id, nro_orden, codigo_articulo, descripcion, cantidad_comprada, cantidad_comprada_texto,
                    reparto_deposito, reparto_deposito_texto, reparto_delmy1, reparto_delmy1_texto,
                    reparto_delmy3, reparto_delmy3_texto)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (compra_id, i, it.get("codigo_articulo"), it.get("descripcion"),
                 it.get("cantidad_comprada"), it.get("cantidad_comprada_texto"),
                 it.get("reparto_deposito"), it.get("reparto_deposito_texto"),
                 it.get("reparto_delmy1"), it.get("reparto_delmy1_texto"),
                 it.get("reparto_delmy3"), it.get("reparto_delmy3_texto")),
            )
        return compra_id


def listar_compras_cargadas() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT c.*, p.nombre AS proveedor_nombre,
                      (SELECT COUNT(*) FROM compra_items ci WHERE ci.compra_id = c.id) AS cantidad_items
               FROM compras_cargadas c
               LEFT JOIN proveedores p ON p.id = c.proveedor_id
               ORDER BY c.creado_en DESC"""
        ).fetchall()
        return [dict(r) for r in rows]


def get_compra_cargada(compra_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT c.*, p.nombre AS proveedor_nombre FROM compras_cargadas c
               LEFT JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = %s""",
            (compra_id,),
        ).fetchone()
        return dict(row) if row else None


def get_compra_items(compra_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM compra_items WHERE compra_id = %s ORDER BY nro_orden", (compra_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def actualizar_reparto_compra_items(compra_id: int, repartos: dict[int, dict]):
    """repartos: {compra_item_id: {"deposito": x, "delmy1": y, "delmy3": z}}"""
    with get_conn() as conn:
        for item_id, valores in repartos.items():
            conn.execute(
                """UPDATE compra_items SET reparto_deposito = %s, reparto_delmy1 = %s, reparto_delmy3 = %s
                   WHERE id = %s AND compra_id = %s""",
                (valores.get("deposito"), valores.get("delmy1"), valores.get("delmy3"), item_id, compra_id),
            )


def actualizar_archivo_compra(compra_id: int, archivo_original: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE compras_cargadas SET archivo_original = %s WHERE id = %s", (archivo_original, compra_id)
        )


# ------------------------------------------------------------- ubicaciones

def _inferir_lado(estanteria: str | None) -> str | None:
    """Solo para mostrar en pantalla — NO se usa para calcular el código.
    Si el valor cargado sigue el patrón habitual (10/20/30 derecha,
    15/25/35 izquierda) lo etiqueta; si es un valor "raro" cargado a mano
    para una separación especial (12, 14, 17, 19...), no infiere nada."""
    if not estanteria or not estanteria.isdigit():
        return None
    n = int(estanteria)
    if n % 10 == 0:
        return "derecha"
    if n % 10 == 5:
        return "izquierda"
    return None


def crear_ubicacion(pasillo: str, estanteria: str | None, altura: str | None,
                     ubicacion: str | None, lado: str | None, descripcion: str | None) -> tuple[int | None, str | None]:
    """Crea una posición en la lista maestra. pasillo/estanteria/altura/
    ubicacion son el código TAL CUAL se cargó — no se multiplica ni se
    transforma nada, para poder cargar tanto el patrón habitual (10, 15,
    20, 25...) como separaciones especiales (12, 14, 17...) sin que la app
    le imponga un número. Devuelve (id, None) si salió bien, o (None,
    mensaje) si el código ya existía."""
    partes = [pasillo]
    nivel = "pasillo"
    if estanteria:
        partes.append(estanteria)
        nivel = "estanteria"
        if altura:
            partes.append(altura)
            nivel = "altura"
            if ubicacion:
                partes.append(ubicacion)
                nivel = "ubicacion"
    codigo = "-".join(partes)
    if not lado:
        lado = _inferir_lado(estanteria)

    with get_conn() as conn:
        existente = conn.execute("SELECT id FROM ubicaciones WHERE codigo = %s", (codigo,)).fetchone()
        if existente:
            return None, f"La ubicación {codigo} ya está cargada."
        cur = conn.execute(
            """INSERT INTO ubicaciones (pasillo, estanteria, altura, ubicacion, codigo, nivel, lado, descripcion, activo, creado_en)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1, %s) RETURNING id""",
            (pasillo, estanteria, altura, ubicacion, codigo, nivel, lado, descripcion, _ahora_txt()),
        )
        row = conn.execute("SELECT * FROM ubicaciones WHERE id = %s", (cur.fetchone()["id"],)).fetchone()
        return dict(row), None


def listar_ubicaciones(q: str = "") -> list[dict]:
    with get_conn() as conn:
        if q:
            rows = conn.execute(
                "SELECT * FROM ubicaciones WHERE activo = 1 AND codigo ILIKE %s ORDER BY codigo", (f"%{q}%",)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM ubicaciones WHERE activo = 1 ORDER BY codigo").fetchall()
        return [dict(r) for r in rows]


def eliminar_ubicacion(ubicacion_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM ubicaciones WHERE id = %s", (ubicacion_id,))


def eliminar_ubicaciones(ids: list[int]) -> tuple[int, list[str]]:
    """Borra las ubicaciones indicadas — salvo las que ya tengan inventario
    cargado adentro, esas NO se borran (para no perder ese historial sin
    querer). Devuelve (cuántas se borraron, códigos de las que se
    saltearon por tener inventario)."""
    if not ids:
        return 0, []
    with get_conn() as conn:
        bloqueadas = conn.execute(
            "SELECT DISTINCT ubicacion_id FROM inventario_ubicaciones WHERE ubicacion_id = ANY(%s)", (ids,)
        ).fetchall()
        ids_bloqueados = {r["ubicacion_id"] for r in bloqueadas}
        ids_a_borrar = [i for i in ids if i not in ids_bloqueados]

        codigos_bloqueados = []
        if ids_bloqueados:
            filas = conn.execute(
                "SELECT codigo FROM ubicaciones WHERE id = ANY(%s)", (list(ids_bloqueados),)
            ).fetchall()
            codigos_bloqueados = [f["codigo"] for f in filas]

        if ids_a_borrar:
            conn.execute("DELETE FROM ubicaciones WHERE id = ANY(%s)", (ids_a_borrar,))
        return len(ids_a_borrar), codigos_bloqueados


def eliminar_todas_ubicaciones() -> tuple[int, list[str]]:
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM ubicaciones").fetchall()]
    return eliminar_ubicaciones(ids)


def agregar_a_cola_impresion(ubicacion_ids: list[int]):
    with get_conn() as conn:
        for uid in ubicacion_ids:
            conn.execute(
                """INSERT INTO ubicaciones_cola_impresion (ubicacion_id, agregado_en) VALUES (%s, %s)
                   ON CONFLICT (ubicacion_id) DO NOTHING""",
                (uid, _ahora_txt()),
            )


def quitar_de_cola_impresion(ubicacion_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM ubicaciones_cola_impresion WHERE ubicacion_id = %s", (ubicacion_id,))


def vaciar_cola_impresion():
    with get_conn() as conn:
        conn.execute("DELETE FROM ubicaciones_cola_impresion")


def listar_cola_impresion() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT u.* FROM ubicaciones_cola_impresion c
               JOIN ubicaciones u ON u.id = c.ubicacion_id
               ORDER BY c.agregado_en"""
        ).fetchall()
        return [dict(r) for r in rows]


def get_ubicaciones_por_ids(ids: list[int]) -> list[dict]:
    if not ids:
        return []
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ubicaciones WHERE id = ANY(%s) ORDER BY codigo", (ids,)).fetchall()
        return [dict(r) for r in rows]


def get_ubicacion(ubicacion_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ubicaciones WHERE id = %s", (ubicacion_id,)).fetchone()
        return dict(row) if row else None


def get_ubicacion_por_codigo(codigo: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ubicaciones WHERE codigo = %s", (codigo,)).fetchone()
        return dict(row) if row else None


def obtener_o_crear_sububicacion(ubicacion_base_id: int, valor: str) -> tuple[dict | None, str | None]:
    """Para cuando en Identificación e inventario se escaneó/eligió una
    ubicación (ej. 01-30-10, nivel altura) pero el artículo va en una
    posición más fina adentro (ej. 01-30-10-20) que todavía no estaba
    cargada como etiqueta propia. Se arma el código hijo agregando `valor`
    al de la base, y si no existe se crea sola — no hace falta pasar antes
    por la pantalla de Ubicaciones para poder inventariar."""
    base = get_ubicacion(ubicacion_base_id)
    if not base:
        return None, "La ubicación base ya no existe."
    if base["nivel"] == "ubicacion":
        return base, None  # ya es el nivel más profundo posible

    codigo_nuevo = f"{base['codigo']}-{valor}"
    existente = get_ubicacion_por_codigo(codigo_nuevo)
    if existente:
        return existente, None

    if base["nivel"] == "pasillo":
        nueva, error = crear_ubicacion(base["pasillo"], valor, None, None, None, None)
    elif base["nivel"] == "estanteria":
        nueva, error = crear_ubicacion(base["pasillo"], base["estanteria"], valor, None, None, None)
    else:  # altura
        nueva, error = crear_ubicacion(base["pasillo"], base["estanteria"], base["altura"], valor, None, None)

    if error:
        # Puede haberse creado justo entre el chequeo y el insert.
        existente = get_ubicacion_por_codigo(codigo_nuevo)
        if existente:
            return existente, None
        return None, error
    return nueva, None


# ------------------------------------------------- identificación e inventario

def importar_codigos_barra(filas: list[dict]) -> int:
    """filas: dicts con codigo, codigo_barra. Se ignoran los que no traen
    código de barras real (vacío o "-"). Usa ON CONFLICT DO NOTHING para no
    duplicar si se reimporta el mismo archivo — pensado para +60.000 filas,
    por eso en lotes y no fila por fila."""
    limpias = []
    for f in filas:
        codigo = str(f.get("codigo") or "").strip()
        cb = str(f.get("codigo_barra") or "").strip()
        if codigo and cb and cb != "-":
            limpias.append((codigo, cb, _ahora_txt()))
    if not limpias:
        return 0
    with get_conn() as conn:
        chunk = 1000
        for i in range(0, len(limpias), chunk):
            lote = limpias[i:i + chunk]
            placeholders = ", ".join("(%s, %s, %s)" for _ in lote)
            parametros = [v for fila in lote for v in fila]
            conn.execute(
                f"""INSERT INTO articulos_codigos_barra (codigo, codigo_barra, creado_en)
                    VALUES {placeholders} ON CONFLICT (codigo, codigo_barra) DO NOTHING""",
                parametros,
            )
    return len(limpias)


def contar_codigos_barra() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM articulos_codigos_barra").fetchone()["c"]


def buscar_articulo_identificacion(termino: str) -> list[dict]:
    """Busca un artículo para identificarlo: primero por código de barras
    exacto, después por código interno exacto, y si no encuentra nada,
    por descripción (parcial). Devuelve, por cada código interno
    encontrado, TODAS sus filas (una por proveedor — así se ven los
    "proveedores alternativos" que pidió Nicotoli) más sus códigos de
    barra conocidos."""
    termino = (termino or "").strip()
    if not termino:
        return []

    with get_conn() as conn:
        codigos = set()

        fila_barra = conn.execute(
            "SELECT DISTINCT codigo FROM articulos_codigos_barra WHERE codigo_barra = %s", (termino,)
        ).fetchall()
        codigos.update(r["codigo"] for r in fila_barra)

        if not codigos:
            fila_exacta = conn.execute(
                "SELECT DISTINCT codigo FROM articulos WHERE UPPER(TRIM(codigo)) = UPPER(%s)", (termino,)
            ).fetchall()
            codigos.update(r["codigo"] for r in fila_exacta)

        if not codigos:
            filas_desc = conn.execute(
                "SELECT DISTINCT codigo FROM articulos WHERE activo = 1 AND descripcion ILIKE %s LIMIT 15",
                (f"%{termino}%",),
            ).fetchall()
            codigos.update(r["codigo"] for r in filas_desc)

        if not codigos:
            return []

        resultado = []
        for codigo in codigos:
            filas_proveedor = conn.execute(
                """SELECT a.*, p.nombre AS proveedor_nombre FROM articulos a
                   LEFT JOIN proveedores p ON p.id = a.proveedor_id
                   WHERE a.activo = 1 AND a.codigo = %s ORDER BY a.proveedor_id NULLS LAST""",
                (codigo,),
            ).fetchall()
            if not filas_proveedor:
                continue
            barras = conn.execute(
                "SELECT codigo_barra FROM articulos_codigos_barra WHERE codigo = %s", (codigo,)
            ).fetchall()
            base = dict(filas_proveedor[0])
            resultado.append({
                "codigo": codigo,
                "descripcion": base["descripcion"],
                "familia": base["familia"],
                "categoria": base["categoria"],
                "marca": base["marca"],
                "es_combo": base["es_combo"],
                "codigos_barra": [b["codigo_barra"] for b in barras],
                "proveedores": [dict(f) for f in filas_proveedor if f["proveedor_id"] is not None],
            })
        return resultado


def crear_registro_inventario(ubicacion_id: int, codigo_articulo: str, cantidad: float, usuario: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO inventario_ubicaciones (ubicacion_id, codigo_articulo, cantidad, creado_en, usuario)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (ubicacion_id, codigo_articulo, cantidad, _ahora_txt(), usuario),
        )
        return cur.fetchone()["id"]


def listar_inventario_ubicacion(ubicacion_id: int) -> list[dict]:
    """Trae lo inventariado en esta ubicación Y en cualquier sub-posición
    creada a partir de ella (ej. si la base es 01-30-10 y se guardó algo en
    01-30-10-20, tiene que aparecer igual acá — si no, parecería que se
    perdió)."""
    base = get_ubicacion(ubicacion_id)
    if not base:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT i.*, a.descripcion, u.codigo AS ubicacion_codigo FROM inventario_ubicaciones i
               LEFT JOIN articulos a ON a.codigo = i.codigo_articulo
               JOIN ubicaciones u ON u.id = i.ubicacion_id
               WHERE u.codigo = %s OR u.codigo LIKE %s
               ORDER BY i.creado_en DESC""",
            (base["codigo"], base["codigo"] + "-%"),
        ).fetchall()
        # dedup por artículo (LEFT JOIN puede repetir si el código tiene
        # varias filas de proveedor en articulos) — nos quedamos con una
        # descripción por fila de inventario.
        vistos = set()
        resultado = []
        for r in rows:
            if r["id"] in vistos:
                continue
            vistos.add(r["id"])
            resultado.append(dict(r))
        return resultado


def listar_inventario_para_exportar(desde: str, hasta: str) -> list[dict]:
    """Todo lo inventariado en el rango de fechas (por defecto, la sesión
    de hoy), con el código de la ubicación y la descripción del artículo
    ya resueltos — para armar la planilla final de "lo inventariado".
    creado_en es texto "YYYY-MM-DD HH:MM:SS", por eso se compara con
    LEFT(...,10) contra fechas "YYYY-MM-DD" — ordena bien como texto."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT i.id, i.creado_en, i.usuario, i.codigo_articulo, i.cantidad,
                      u.codigo AS ubicacion_codigo, a.descripcion
               FROM inventario_ubicaciones i
               LEFT JOIN ubicaciones u ON u.id = i.ubicacion_id
               LEFT JOIN articulos a ON a.codigo = i.codigo_articulo
               WHERE LEFT(i.creado_en, 10) BETWEEN %s AND %s
               ORDER BY u.codigo, i.creado_en""",
            (desde, hasta),
        ).fetchall()
        vistos = set()
        resultado = []
        for r in rows:
            if r["id"] in vistos:
                continue
            vistos.add(r["id"])
            resultado.append(dict(r))
        return resultado


# --------------------------------------------------------- estado en vivo

def actualizar_estado_vivo(usuario: str, ubicacion_codigo: str | None, articulo_codigo: str | None,
                            articulo_descripcion: str | None, cantidad: str | None, posicion: str | None,
                            paso: str):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO inventario_estado_vivo
               (usuario, ubicacion_codigo, articulo_codigo, articulo_descripcion, cantidad, posicion, paso, actualizado_en)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (usuario) DO UPDATE SET
                   ubicacion_codigo = EXCLUDED.ubicacion_codigo,
                   articulo_codigo = EXCLUDED.articulo_codigo,
                   articulo_descripcion = EXCLUDED.articulo_descripcion,
                   cantidad = EXCLUDED.cantidad,
                   posicion = EXCLUDED.posicion,
                   paso = EXCLUDED.paso,
                   actualizado_en = EXCLUDED.actualizado_en""",
            (usuario, ubicacion_codigo, articulo_codigo, articulo_descripcion, cantidad, posicion, paso, _ahora_txt()),
        )


def listar_estado_vivo() -> list[dict]:
    """Solo usuarios activos en los últimos 15 minutos — pasado eso, se
    asume que dejaron de escanear y no tiene sentido seguir mostrándolos
    como "en vivo"."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM inventario_estado_vivo
               WHERE actualizado_en >= %s
               ORDER BY actualizado_en DESC""",
            ((datetime.now(_TZ_AR) - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S"),),
        ).fetchall()
        return [dict(r) for r in rows]


def listar_inventario_reciente(limite: int = 30) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT i.id, i.creado_en, i.usuario, i.codigo_articulo, i.cantidad,
                      u.codigo AS ubicacion_codigo, a.descripcion
               FROM inventario_ubicaciones i
               LEFT JOIN ubicaciones u ON u.id = i.ubicacion_id
               LEFT JOIN articulos a ON a.codigo = i.codigo_articulo
               ORDER BY i.creado_en DESC LIMIT %s""",
            (limite,),
        ).fetchall()
        vistos = set()
        resultado = []
        for r in rows:
            if r["id"] in vistos:
                continue
            vistos.add(r["id"])
            resultado.append(dict(r))
        return resultado


def buscar_ubicaciones(q: str) -> list[dict]:
    # Algunos lectores de código de barras, si quedaron configurados con un
    # layout de teclado distinto al de Windows (EE.UU. vs Español
    # Latinoamérica), mandan comilla simple (') en vez de guion (-) — se
    # normaliza acá para que la búsqueda funcione igual aunque no se haya
    # corregido la configuración del lector todavía.
    q_normalizado = q.replace("'", "-")
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM ubicaciones WHERE activo = 1 AND codigo ILIKE %s ORDER BY codigo LIMIT 15",
            (f"%{q_normalizado}%",),
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------- combos

def importar_combos_componentes(filas: list[dict]) -> int:
    """filas: dicts con combo_codigo, combo_descripcion, componente_codigo,
    componente_descripcion, cantidad. Se ignoran las filas de tipo "Combo"
    (cabecera, sin componente real) — solo se guardan las de tipo
    "Artículo" (que sí traen el componente)."""
    limpias = []
    ahora = _ahora_txt()
    for f in filas:
        combo_codigo = str(f.get("combo_codigo") or "").strip()
        componente_codigo = str(f.get("componente_codigo") or "").strip()
        if not combo_codigo or not componente_codigo or componente_codigo == "-":
            continue
        cantidad = _num_o_none(f.get("cantidad"))
        limpias.append((
            combo_codigo,
            str(f.get("combo_descripcion") or "").strip() or None,
            componente_codigo,
            str(f.get("componente_descripcion") or "").strip() or None,
            cantidad,
            ahora,
        ))
    if not limpias:
        return 0
    with get_conn() as conn:
        chunk = 500
        for i in range(0, len(limpias), chunk):
            lote = limpias[i:i + chunk]
            placeholders = ", ".join("(%s, %s, %s, %s, %s, %s)" for _ in lote)
            parametros = [v for fila in lote for v in fila]
            conn.execute(
                f"""INSERT INTO combos_componentes
                    (combo_codigo, combo_descripcion, componente_codigo, componente_descripcion, cantidad, creado_en)
                    VALUES {placeholders}
                    ON CONFLICT (combo_codigo, componente_codigo) DO NOTHING""",
                parametros,
            )
    return len(limpias)


def contar_combos_componentes() -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(DISTINCT combo_codigo) AS c FROM combos_componentes"
        ).fetchone()["c"]


def get_combo_componentes(codigo: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM combos_componentes WHERE combo_codigo = %s", (codigo,)
        ).fetchall()
        return [dict(r) for r in rows]


# ------------------------------------------ búsqueda avanzada por proveedor

def buscar_por_cod_art_prov(codigo: str, proveedor_id: int) -> dict | None:
    """Busca por el código que usa ESE proveedor (no el interno de Delmy) —
    es lo que normalmente trae un remito o factura."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT a.*, p.nombre AS proveedor_nombre FROM articulos a
               LEFT JOIN proveedores p ON p.id = a.proveedor_id
               WHERE a.activo = 1 AND a.proveedor_id = %s AND UPPER(TRIM(a.cod_art_prov)) = UPPER(%s)""",
            (proveedor_id, codigo),
        ).fetchone()
        return dict(row) if row else None


def buscar_cod_art_prov_parcial(codigo: str, proveedor_id: int, limite: int = 8) -> list[dict]:
    """Cuando el código del remito viene incompleto, o completo pero con
    caracteres de más a la izquierda o a la derecha (típico de OCR o de
    formatos distintos entre proveedores) — compara por contención en
    ambos sentidos, siempre dentro de los artículos de ESE proveedor."""
    articulos = listar_articulos_por_proveedor(proveedor_id)
    codigo_up = codigo.strip().upper()
    candidatos = []
    for art in articulos:
        cap = (art.get("cod_art_prov") or "").strip().upper()
        if not cap or cap == codigo_up:
            continue
        if codigo_up in cap or cap in codigo_up:
            candidatos.append({
                "codigo": art["codigo"],
                "cod_art_prov": art.get("cod_art_prov"),
                "descripcion": art.get("descripcion"),
                "tipo_match": "codigo_parcial",
            })
    return candidatos[:limite]



# ----------------------------------------------------------------- remitos

def crear_remito(
    proveedor_id: int,
    cantidad_bultos_declarados: int | None,
    archivo_original: str,
    tipo_archivo: str,
    metodo_extraccion: str | None,
    usuario_creador: str,
    numeros_remito: list[str],
    items: list[dict],
    tipo_control: str | None = None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO remitos
               (proveedor_id, cantidad_bultos_declarados, archivo_original, tipo_archivo,
                metodo_extraccion, usuario_creador, estado, creado_en, tipo_control)
               VALUES (%s, %s, %s, %s, %s, %s, 'pendiente', %s, %s)
               RETURNING id""",
            (
                proveedor_id,
                cantidad_bultos_declarados,
                archivo_original,
                tipo_archivo,
                metodo_extraccion,
                usuario_creador,
                _ahora_txt(),
                tipo_control,
            ),
        )
        remito_id = cur.fetchone()["id"]
        _reemplazar_items(conn, remito_id, items)
        _reemplazar_numeros(conn, remito_id, numeros_remito)
        return remito_id


def _reemplazar_numeros(conn: psycopg.Connection, remito_id: int, numeros: list[str]):
    conn.execute("DELETE FROM remito_numeros WHERE remito_id = %s", (remito_id,))
    for numero in numeros:
        numero = (numero or "").strip()
        if numero:
            conn.execute(
                "INSERT INTO remito_numeros (remito_id, numero) VALUES (%s, %s)", (remito_id, numero)
            )


def listar_numeros(remito_id: int) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT numero FROM remito_numeros WHERE remito_id = %s ORDER BY id", (remito_id,)
        ).fetchall()
        return [r["numero"] for r in rows]


def _reemplazar_items(conn: psycopg.Connection, remito_id: int, items: list[dict]):
    conn.execute("DELETE FROM remito_items WHERE remito_id = %s", (remito_id,))
    for i, item in enumerate(items, start=1):
        conn.execute(
            """INSERT INTO remito_items
               (remito_id, nro_orden, codigo_articulo, descripcion, cantidad_remito)
               VALUES (%s, %s, %s, %s, %s)""",
            (
                remito_id,
                i,
                item.get("codigo_articulo"),
                item.get("descripcion"),
                item.get("cantidad_remito"),
            ),
        )


def actualizar_archivo_original(remito_id: int, archivo_original: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE remitos SET archivo_original = %s WHERE id = %s", (archivo_original, remito_id)
        )


def actualizar_archivo_articulos(remito_id: int, archivo_articulos: str):
    # Respaldo del segundo escaneo (factura/remito con detalle de artículos)
    # cuando el remito ya se recepcionó por bulto — sin esto, ese escaneo se
    # usaba solo para la lectura automática y se perdía.
    with get_conn() as conn:
        conn.execute(
            "UPDATE remitos SET archivo_articulos = %s WHERE id = %s", (archivo_articulos, remito_id)
        )


def actualizar_revision(remito_id: int, numeros_remito: list[str], items: list[dict]):
    with get_conn() as conn:
        _reemplazar_items(conn, remito_id, items)
        _reemplazar_numeros(conn, remito_id, numeros_remito)


def guardar_intento_confirmacion(
    remito_id: int,
    comprobante_final: str,
    firma_detectada: bool | None,
    tipo_control: str,
):
    """Guarda el escaneo subido y el resultado de la detección automática sin
    todavía marcar el remito como completado (se usa cuando la detección no
    fue concluyente y se necesita la confirmación manual de respaldo)."""
    with get_conn() as conn:
        conn.execute(
            """UPDATE remitos SET comprobante_final = %s, firma_detectada = %s, tipo_control = %s
               WHERE id = %s""",
            (
                comprobante_final,
                None if firma_detectada is None else int(firma_detectada),
                tipo_control,
                remito_id,
            ),
        )


def confirmar_remito(
    remito_id: int,
    comprobante_final: str,
    firma_detectada: bool | None,
    confirmado_manualmente: bool,
    usuario_completo: str,
    tipo_control: str | None = None,
    observacion_confirmacion: str | None = None,
    articulos_pendientes: bool = False,
):
    with get_conn() as conn:
        if tipo_control is None:
            tipo_control = conn.execute(
                "SELECT tipo_control FROM remitos WHERE id = %s", (remito_id,)
            ).fetchone()["tipo_control"]
        conn.execute(
            """UPDATE remitos SET
                 comprobante_final = %s,
                 firma_detectada = %s,
                 confirmado_manualmente = %s,
                 observacion_confirmacion = %s,
                 tipo_control = %s,
                 estado = 'completado',
                 completado_en = %s,
                 usuario_completo = %s,
                 articulos_pendientes = %s
               WHERE id = %s""",
            (
                comprobante_final,
                None if firma_detectada is None else int(firma_detectada),
                int(confirmado_manualmente),
                observacion_confirmacion,
                tipo_control,
                _ahora_txt(),
                usuario_completo,
                int(articulos_pendientes),
                remito_id,
            ),
        )


def marcar_articulos_completados(remito_id: int, comprobante_articulos: str, usuario: str):
    with get_conn() as conn:
        conn.execute(
            """UPDATE remitos SET
                 articulos_pendientes = 0,
                 comprobante_articulos = %s,
                 articulos_completados_en = %s,
                 usuario_articulos_completados = %s
               WHERE id = %s""",
            (comprobante_articulos, _ahora_txt(), usuario, remito_id),
        )


def get_remito(remito_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT remitos.*, proveedores.nombre AS proveedor_nombre,
                      ordenes_compra.nro_oc AS oc_nro_oc,
                      ordenes_compra.etapa AS oc_etapa,
                      ordenes_compra.cantidad_pedida AS oc_cantidad_pedida,
                      ordenes_compra.cantidad_recibida AS oc_cantidad_recibida,
                      (SELECT STRING_AGG(numero, ', ') FROM remito_numeros
                       WHERE remito_numeros.remito_id = remitos.id) AS numeros_remito_txt
               FROM remitos
               LEFT JOIN proveedores ON proveedores.id = remitos.proveedor_id
               LEFT JOIN ordenes_compra ON ordenes_compra.id = remitos.orden_compra_id
               WHERE remitos.id = %s""",
            (remito_id,),
        ).fetchone()
        return dict(row) if row else None


def total_cantidad_items(remito_id: int) -> float | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT SUM(cantidad_remito) AS s FROM remito_items WHERE remito_id = %s", (remito_id,)
        ).fetchone()["s"]


def get_items(remito_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM remito_items WHERE remito_id = %s ORDER BY nro_orden", (remito_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def listar_remitos(
    estado: str | None = None,
    q: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
) -> list[dict]:
    sql = """SELECT remitos.*, proveedores.nombre AS proveedor_nombre,
                    (SELECT COUNT(*) FROM remito_items WHERE remito_items.remito_id = remitos.id) AS cantidad_articulos,
                    (SELECT STRING_AGG(numero, ', ') FROM remito_numeros
                     WHERE remito_numeros.remito_id = remitos.id) AS numeros_remito_txt
             FROM remitos LEFT JOIN proveedores ON proveedores.id = remitos.proveedor_id
             WHERE 1=1"""
    params: list = []
    if estado:
        sql += " AND remitos.estado = %s"
        params.append(estado)
    if q:
        sql += """ AND (proveedores.nombre ILIKE %s OR remitos.id IN
                   (SELECT remito_id FROM remito_numeros WHERE numero ILIKE %s))"""
        params.extend([f"%{q}%", f"%{q}%"])
    if desde:
        sql += " AND remitos.creado_en::date >= %s::date"
        params.append(desde)
    if hasta:
        sql += " AND remitos.creado_en::date <= %s::date"
        params.append(hasta)
    sql += " ORDER BY remitos.creado_en DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def resumen(desde: str | None = None, hasta: str | None = None) -> dict:
    # Todas las métricas se calculan sobre los remitos creados (escaneados) dentro
    # del rango [desde, hasta]; sin rango, es el histórico completo.
    filtro = ""
    params_filtro: list = []
    if desde:
        filtro += " AND creado_en::date >= %s::date"
        params_filtro.append(desde)
    if hasta:
        filtro += " AND creado_en::date <= %s::date"
        params_filtro.append(hasta)

    with get_conn() as conn:
        pendientes = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'pendiente'{filtro}",
            params_filtro,
        ).fetchone()["c"]
        completados = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'completado'{filtro}",
            params_filtro,
        ).fetchone()["c"]
        completados_bulto = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'completado' AND tipo_control = 'bulto'{filtro}",
            params_filtro,
        ).fetchone()["c"]
        completados_articulo = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'completado' AND tipo_control = 'articulo'{filtro}",
            params_filtro,
        ).fetchone()["c"]
        articulos_pendientes = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'completado' AND articulos_pendientes = 1{filtro}",
            params_filtro,
        ).fetchone()["c"]
        ingresados = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE ingresado_sistema_en IS NOT NULL{filtro}",
            params_filtro,
        ).fetchone()["c"]
        pendientes_ingreso = conn.execute(
            f"SELECT COUNT(*) AS c FROM remitos WHERE estado = 'completado' "
            f"AND ingresado_sistema_en IS NULL{filtro}",
            params_filtro,
        ).fetchone()["c"]
        horas_promedio = conn.execute(
            f"SELECT AVG(EXTRACT(EPOCH FROM (ingresado_sistema_en::timestamp - creado_en::timestamp)) / 3600) AS h "
            f"FROM remitos WHERE ingresado_sistema_en IS NOT NULL{filtro}",
            params_filtro,
        ).fetchone()["h"]
        top_proveedores = [
            dict(r)
            for r in conn.execute(
                f"""SELECT proveedores.nombre AS nombre, COUNT(*) AS cantidad
                   FROM remitos JOIN proveedores ON proveedores.id = remitos.proveedor_id
                   WHERE 1=1{filtro}
                   GROUP BY remitos.proveedor_id, proveedores.nombre
                   ORDER BY cantidad DESC, nombre
                   LIMIT 5""",
                params_filtro,
            ).fetchall()
        ]
        if horas_promedio is None:
            tiempo_promedio_txt = "—"
        elif horas_promedio < 24:
            tiempo_promedio_txt = f"{horas_promedio:.1f} h"
        else:
            tiempo_promedio_txt = f"{horas_promedio / 24:.1f} d"

        return {
            "pendientes": pendientes,
            "completados": completados,
            "completados_bulto": completados_bulto,
            "completados_articulo": completados_articulo,
            "articulos_pendientes": articulos_pendientes,
            "ingresados_sistema": ingresados,
            "pendientes_ingreso": pendientes_ingreso,
            "tiempo_promedio_ingreso_txt": tiempo_promedio_txt,
            "top_proveedores": top_proveedores,
        }


def eliminar_remito(remito_id: int):
    remito = get_remito(remito_id)
    if not remito:
        return
    with get_conn() as conn:
        conn.execute("DELETE FROM remitos WHERE id = %s", (remito_id,))
    for nombre_archivo in (remito.get("archivo_original"), remito.get("comprobante_final")):
        if nombre_archivo:
            borrar_archivo(nombre_archivo)


def remitos_agrupados_por_dia(desde: str, hasta: str) -> dict[str, list[dict]]:
    """Para el calendario visual: remitos reales (los que escanea Javier en
    la recepción) agrupados por día y proveedor, para pintar un calendario
    mensual de quién entregó qué día."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT remitos.creado_en::date AS dia, proveedores.nombre AS proveedor,
                      remitos.id AS remito_id, remitos.estado AS estado
               FROM remitos LEFT JOIN proveedores ON proveedores.id = remitos.proveedor_id
               WHERE remitos.creado_en::date BETWEEN %s AND %s
               ORDER BY remitos.creado_en""",
            (desde, hasta),
        ).fetchall()
    agrupado: dict[str, list[dict]] = {}
    for r in rows:
        dia = r["dia"].isoformat()
        agrupado.setdefault(dia, []).append({
            "proveedor": r["proveedor"] or "(sin proveedor)",
            "remito_id": r["remito_id"],
            "estado": r["estado"],
        })
    return agrupado
