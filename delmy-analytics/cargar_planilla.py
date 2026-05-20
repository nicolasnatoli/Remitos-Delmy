"""
cargar_planilla.py
==================
Carga planillas de ventas DIRECTAMENTE a PostgreSQL de Railway.
Sin límite de tamaño, sin timeout HTTP (Optimizado para archivos grandes).

Uso:
  python cargar_planilla.py "ruta/al/archivo.xlsx"
  python cargar_planilla.py --todos "C:/ruta/carpeta/ventas/"

Requiere:
  pip install psycopg2-binary openpyxl
"""

import sys
import os
import re
import argparse
from datetime import datetime, date

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("ERROR: Instalá psycopg2 con: pip install psycopg2-binary")
    sys.exit(1)

try:
    import openpyxl
except ImportError:
    print("ERROR: Instalá openpyxl con: pip install openpyxl")
    sys.exit(1)

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
DATABASE_URL = "postgresql://postgres:OKJgfYNlWjgrSzStAAkpVCIFHgNrywBe@hopper.proxy.rlwy.net:19148/railway"
# ─────────────────────────────────────────────────────────────────────────────

def parse_date(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})', s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s[:10] if len(s) >= 10 else None

def parse_num(v):
    if v is None or v == '-':
        return 0
    try:
        return float(str(v).replace(',', '.'))
    except:
        return 0

def parse_str(v):
    if v is None or v == '-':
        return None
    return str(v).strip() or None

def parse_planilla(filepath):
    print(f"\nLeyendo: {os.path.basename(filepath)}")
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active

    headers = None
    idx = {}
    encabezados = []
    detalles = []
    row_count = 0

    for row in ws.iter_rows(values_only=True):
        row_count += 1
        if headers is None:
            if row and 'Referencia' in row:
                headers = row
                idx = {str(h): i for i, h in enumerate(headers) if h}
                print(f"  Headers encontrados en fila {row_count}")
            continue

        if not row or row[idx.get('Referencia', -1)] is None:
            continue

        tipo = str(row[idx['Referencia']]).strip()

        def get(col):
            i = idx.get(col)
            if i is None or i >= len(row):
                return None
            v = row[i]
            return None if (v is None or v == '-') else v

        if tipo == 'Encabezado':
            encabezados.append((
                parse_str(get('Nro. comprobante')),
                parse_num(get('ID transacción')),
                parse_num(get('ID operación')),
                parse_num(get('ID sucursal')),
                parse_str(get('Sucursal')),
                parse_date(get('Fecha de comprobante')),
                parse_str(get('Fecha de carga')),
                parse_str(get('Tipo comprob.')),
                parse_str(get('Tipo de cliente')),
                parse_str(get('Razón social')),
                parse_str(get('Cond. IVA')),
                parse_str(get('Condición de venta')),
                parse_str(get('Lista de precios')),
                parse_num(get('Subtotal comprobante')),
                parse_num(get('Neto gravado comprobante')),
                parse_num(get('IVA 10.5')),
                parse_num(get('IVA 21')),
                parse_num(get('Total comprobante')),
                parse_str(get('Moneda')),
                parse_str(get('Usuario')),
            ))
        elif tipo == 'Detalle':
            codigo = parse_str(get('Código'))
            if not codigo:
                continue
            detalles.append((
                parse_str(get('Nro. comprobante')),
                parse_num(get('ID operación')),
                parse_num(get('ID de fila')),
                parse_str(get('Sucursal')),
                parse_date(get('Fecha de comprobante')),
                parse_str(get('Tipo comprob.')),
                parse_num(get('ID artículo')),
                codigo,
                parse_str(get('Descripción')),
                parse_num(get('Costo')),
                parse_num(get('Cantidad')),
                parse_num(get('Precio unitario')),
                parse_num(get('Descuento unitario')),
                parse_num(get('Subtotal neto gravado')),
                parse_num(get('Alicuota IVA')),
                parse_num(get('Subtotal detalles')),
            ))

        if row_count % 10000 == 0:
            print(f"  Procesadas {row_count} filas... ({len(encabezados)} enc, {len(detalles)} det)")

    wb.close()
    print(f"  Total: {len(encabezados)} encabezados, {len(detalles)} detalles")
    return encabezados, detalles

def cargar_en_db(filepath, encabezados, detalles):
    filename = os.path.basename(filepath)
    fechas = [e[5] for e in encabezados if e[5]]
    fechas.sort()
    fecha_desde = fechas[0] if fechas else None
    fecha_hasta = fechas[-1] if fechas else None
    sucursales = list(set(e[4] for e in encabezados if e[4]))

    print(f"\nConectando a PostgreSQL...")
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    cur = conn.cursor()

    # Register upload
    cur.execute("""
        INSERT INTO uploads_log (filename, fecha_desde, fecha_hasta, sucursales, n_encabezados, n_detalles, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'procesando') RETURNING id
    """, (filename, fecha_desde, fecha_hasta, ', '.join(sucursales), len(encabezados), len(detalles)))
    upload_id = cur.fetchone()[0]
    conn.commit()

    print(f"Upload ID: {upload_id}")
    print(f"Período: {fecha_desde} → {fecha_hasta}")
    print(f"Sucursales: {', '.join(sucursales)}")

    # Upsert comprobantes en tandas optimizadas
    print(f"\nInsertando {len(encabezados)} comprobantes...")
    insertados = 0
    actualizados = 0
    chunk = 200  # Reducido para evitar timeouts

    for i in range(0, len(encabezados), chunk):
        batch = [e + (upload_id,) for e in encabezados[i:i+chunk]]
        for enc in batch:
            cur.execute("""
                INSERT INTO comprobantes
                (nro_comprobante,id_transaccion,id_operacion,id_sucursal,sucursal,fecha,fecha_carga,
                 tipo_comprob,tipo_cliente,razon_social,cond_iva,cond_venta,lista_precios,
                 subtotal,neto_gravado,iva_105,iva_21,total,moneda,usuario,upload_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (nro_comprobante) DO UPDATE SET
                  subtotal=EXCLUDED.subtotal, neto_gravado=EXCLUDED.neto_gravado,
                  iva_105=EXCLUDED.iva_105, iva_21=EXCLUDED.iva_21,
                  total=EXCLUDED.total, upload_id=EXCLUDED.upload_id
                RETURNING (xmax = 0) AS inserted
            """, enc)
            if cur.fetchone()[0]:
                insertados += 1
            else:
                actualizados += 1
        conn.commit()
        if (i // chunk) % 5 == 0 or i + chunk >= len(encabezados):
            print(f"  Comprobantes: {min(i+chunk, len(encabezados))}/{len(encabezados)}")

    # Delete existing detalles en bloques CHICOS
    print(f"\nLimpiando líneas anteriores...")
    nros = list(set(d[0] for d in detalles))
    delete_chunk = 200  # Bajado drásticamente para evitar colapsar la BD
    for i in range(0, len(nros), delete_chunk):
        batch_nros = nros[i:i+delete_chunk]
        cur.execute("DELETE FROM ventas_lineas WHERE nro_comprobante = ANY(%s)", (batch_nros,))
        conn.commit()

    # Insert detalles optimizados
    print(f"\nInsertando {len(detalles)} líneas de detalle...")
    for i in range(0, len(detalles), chunk):
        batch = [d + (upload_id,) for d in detalles[i:i+chunk]]
        execute_values(cur, """
            INSERT INTO ventas_lineas
            (nro_comprobante,id_operacion,id_fila,sucursal,fecha,tipo_comprob,
             id_articulo,codigo,descripcion,costo,cantidad,precio_unitario,
             descuento,subtotal_neto,alicuota_iva,subtotal_det,upload_id)
            VALUES %s
        """, batch)
        conn.commit()
        if (i // chunk) % 10 == 0 or i + chunk >= len(detalles):
            print(f"  Detalles: {min(i+chunk, len(detalles))}/{len(detalles)}")

    # Update log
    cur.execute("""
        UPDATE uploads_log SET n_insertados=%s, n_actualizados=%s, status='ok' WHERE id=%s
    """, (insertados, actualizados, upload_id))
    conn.commit()
    cur.close()
    conn.close()

    print(f"\n✓ LISTO — {insertados} nuevos, {actualizados} actualizados")
    return insertados, actualizados

def main():
    parser = argparse.ArgumentParser(description='Cargador de planillas Delmy → PostgreSQL')
    parser.add_argument('archivo', nargs='?', help='Archivo .xlsx a cargar')
    parser.add_argument('--todos', metavar='CARPETA', help='Cargar todos los .xlsx de una carpeta')
    args = parser.parse_args()

    if args.todos:
        carpeta = args.todos
        archivos = sorted([
            os.path.join(carpeta, f) for f in os.listdir(carpeta)
            if f.lower().endswith('.xlsx') and 'DetalleDeVentas' in f
        ])
        print(f"Encontrados {len(archivos)} archivos en {carpeta}")
        for arch in archivos:
            try:
                enc, det = parse_planilla(arch)
                cargar_en_db(arch, enc, det)
            except Exception as e:
                print(f"ERROR en {arch}: {e}")
    elif args.archivo:
        enc, det = parse_planilla(args.archivo)
        cargar_en_db(args.archivo, enc, det)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()