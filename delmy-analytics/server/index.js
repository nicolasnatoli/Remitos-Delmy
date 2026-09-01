const express = require('express')
const cors = require('cors')
const compression = require('compression')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const ExcelJS = require('exceljs')
const { Readable } = require('stream')
const { Pool } = require('pg')

const app = express()
const PORT = process.env.PORT || 3001

// ─── PostgreSQL Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

async function initDB() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS comprobantes (
        nro_comprobante TEXT PRIMARY KEY,
        id_transaccion  BIGINT,
        id_operacion    BIGINT,
        id_sucursal     INTEGER,
        sucursal        TEXT,
        fecha           DATE,
        fecha_carga     TEXT,
        tipo_comprob    TEXT,
        tipo_cliente    TEXT,
        razon_social    TEXT,
        cond_iva        TEXT,
        cond_venta      TEXT,
        lista_precios   TEXT,
        subtotal        NUMERIC,
        neto_gravado    NUMERIC,
        iva_105         NUMERIC,
        iva_21          NUMERIC,
        total           NUMERIC,
        moneda          TEXT,
        usuario         TEXT,
        upload_id       INTEGER
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ventas_lineas (
        id              BIGSERIAL PRIMARY KEY,
        nro_comprobante TEXT,
        id_operacion    BIGINT,
        id_fila         BIGINT,
        sucursal        TEXT,
        fecha           DATE,
        tipo_comprob    TEXT,
        id_articulo     INTEGER,
        codigo          TEXT,
        descripcion     TEXT,
        costo           NUMERIC,
        cantidad        NUMERIC,
        precio_unitario NUMERIC,
        descuento       NUMERIC,
        subtotal_neto   NUMERIC,
        alicuota_iva    NUMERIC,
        subtotal_det    NUMERIC,
        upload_id       INTEGER
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS uploads_log (
        id             SERIAL PRIMARY KEY,
        filename       TEXT,
        fecha_desde    DATE,
        fecha_hasta    DATE,
        sucursales     TEXT,
        n_encabezados  INTEGER DEFAULT 0,
        n_detalles     INTEGER DEFAULT 0,
        n_insertados   INTEGER DEFAULT 0,
        n_actualizados INTEGER DEFAULT 0,
        n_colisiones   INTEGER DEFAULT 0,
        colisiones_detalle TEXT,
        uploaded_at    TIMESTAMP DEFAULT NOW(),
        status         TEXT
      )
    `)
    await client.query(`ALTER TABLE uploads_log ADD COLUMN IF NOT EXISTS n_colisiones INTEGER DEFAULT 0`)
    await client.query(`ALTER TABLE uploads_log ADD COLUMN IF NOT EXISTS colisiones_detalle TEXT`)
    // Maestro código → proveedor/familia/categoría/marca. Se arma con merge:
    // el reporte "Stock Disponible" trae familia/categoría/marca, el reporte
    // de "Órdenes de Compra" trae proveedor (y también familia/categoría/marca,
    // sirve de refuerzo). Ningún reporte solo alcanza — se van completando
    // entre sí. Nunca se pisa un campo bueno con uno vacío del otro archivo.
    await client.query(`
      CREATE TABLE IF NOT EXISTS articulos_maestro (
        codigo       TEXT PRIMARY KEY,
        descripcion  TEXT,
        proveedor    TEXT,
        familia      TEXT,
        categoria    TEXT,
        marca        TEXT,
        fuente       TEXT,          -- 'stock_disponible' | 'oc' | 'stock_disponible+oc'
        actualizado  TIMESTAMP DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_am_proveedor ON articulos_maestro(proveedor)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_am_familia   ON articulos_maestro(familia)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_fecha     ON ventas_lineas(fecha)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_sucursal  ON ventas_lineas(sucursal)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_codigo    ON ventas_lineas(codigo)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_comp      ON ventas_lineas(nro_comprobante)`)
    // nro_comprobante YA NO puede ser la clave única — se repite entre tipos
    // de documento distintos (confirmado con datos reales: una Factura B y
    // un Remito comparten número dentro de la misma sucursal). Si sigue
    // siendo PRIMARY KEY, insertar un comprobante distinto con el mismo
    // número tira error antes de llegar a comparar id_operacion.
    await client.query(`ALTER TABLE comprobantes DROP CONSTRAINT IF EXISTS comprobantes_pkey`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comprobantes_nro ON comprobantes(nro_comprobante)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_idop      ON ventas_lineas(id_operacion)`)
    // ID operación es la clave REAL de un comprobante — nro_comprobante se
    // repite entre tipos de documento distintos (una Factura B y un Remito
    // pueden compartir número dentro de la misma sucursal). Único parcial
    // (no PRIMARY KEY) porque puede haber filas viejas con id_operacion nulo
    // y no queremos que la migración falle por eso.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_idop ON comprobantes(id_operacion) WHERE id_operacion IS NOT NULL`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_tipo      ON ventas_lineas(tipo_comprob)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comp_fecha   ON comprobantes(fecha)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comp_tipo    ON comprobantes(tipo_comprob)`)
    console.log('DB ready')
  } finally {
    client.release()
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
// Usa exceljs en modo streaming (fila por fila), no XLSX.read()+sheet_to_json.
// Motivo: SheetJS arma un string único con todo el XML de la hoja antes de
// parsearlo — con archivos de ventas grandes (Febrero/Marzo 2026 superan los
// 595 MB descomprimidos) ese string supera el límite duro de V8
// (~536.870.888 caracteres) y la hoja queda vacía en silencio, dando
// "No se encontró fila de encabezados" aunque el archivo esté perfecto.
// exceljs streaming nunca arma ese string — lee y descarta fila por fila.
async function parsePlanillaVentas(buffer) {
  const stream = Readable.from(buffer)
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  })

  let idx = null
  let headerRow = -1
  let rowNum = 0
  const encabezados = [], detalles = []

  const parseDate = (v) => {
    if (!v) return null
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const s = String(v).trim()
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return d.toISOString().slice(0, 10)
    }
    return s.substring(0, 10)
  }

  let hojaDeDatosEncontrada = false
  for await (const worksheetReader of workbookReader) {
    if (hojaDeDatosEncontrada) break // ya procesamos "Detalle de ventas realizadas", no seguir a "Filtros aplicados"
    rowNum = 0
    idx = null
    headerRow = -1
    for await (const row of worksheetReader) {
      rowNum++
      const values = row.values // array 1-indexed; values[0] es undefined

      if (headerRow === -1) {
        if (rowNum > 10) break // esta hoja no tiene el encabezado esperado en las primeras filas
        if (values.some(c => c === 'Referencia')) {
          headerRow = rowNum
          idx = {}
          values.forEach((h, i) => { if (h) idx[h] = i })
          hojaDeDatosEncontrada = true
        }
        continue
      }

      const get = (col) => { const v = idx[col] !== undefined ? values[idx[col]] : null; return (v === null || v === undefined || v === '-') ? null : v }
      const getNum = (col) => { const v = get(col); if (v === null) return 0; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }
      const getStr = (col) => { const v = get(col); return v === null ? null : String(v).trim() }

      const tipoRaw = get('Referencia')
      if (!tipoRaw) continue
      const tipo = String(tipoRaw).trim()

      if (tipo === 'Encabezado') {
        encabezados.push({
          nro_comprobante: getStr('Nro. comprobante'), id_transaccion: getNum('ID transacción'),
          id_operacion: getNum('ID operación'), id_sucursal: getNum('ID sucursal'),
          sucursal: getStr('Sucursal'), fecha: parseDate(get('Fecha de comprobante')),
          fecha_carga: getStr('Fecha de carga'), tipo_comprob: getStr('Tipo comprob.'),
          tipo_cliente: getStr('Tipo de cliente'), razon_social: getStr('Razón social'),
          cond_iva: getStr('Cond. IVA'), cond_venta: getStr('Condición de venta'),
          lista_precios: getStr('Lista de precios'), subtotal: getNum('Subtotal comprobante'),
          neto_gravado: getNum('Neto gravado comprobante'), iva_105: getNum('IVA 10.5'),
          iva_21: getNum('IVA 21'), total: getNum('Total comprobante'),
          moneda: getStr('Moneda'), usuario: getStr('Usuario'),
        })
      } else if (tipo === 'Detalle') {
        const codigo = getStr('Código')
        if (!codigo) continue
        detalles.push({
          nro_comprobante: getStr('Nro. comprobante'), id_operacion: getNum('ID operación'),
          id_fila: getNum('ID de fila'), sucursal: getStr('Sucursal'),
          fecha: parseDate(get('Fecha de comprobante')), tipo_comprob: getStr('Tipo comprob.'),
          id_articulo: getNum('ID artículo'), codigo, descripcion: getStr('Descripción'),
          costo: getNum('Costo'), cantidad: getNum('Cantidad'),
          precio_unitario: getNum('Precio unitario'), descuento: getNum('Descuento unitario'),
          subtotal_neto: getNum('Subtotal neto gravado'), alicuota_iva: getNum('Alicuota IVA'),
          subtotal_det: getNum('Subtotal detalles'),
        })
      }
    }
  }
  if (headerRow === -1) throw new Error('No se encontró fila de encabezados')
  return { encabezados, detalles }
}

// ─── Parser — maestro de artículos (Stock Disponible / Órdenes de Compra) ─────
// Reconoce el archivo por sus encabezados, no por el nombre — así no importa
// cómo lo hayan renombrado al descargarlo. Devuelve filas normalizadas
// {codigo, descripcion, proveedor, familia, categoria, marca} — cada campo
// puede venir null si ese reporte puntual no lo trae (el upsert después se
// encarga de no pisar un dato bueno con uno vacío del otro archivo).
function parseMaestroArticulos(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, dense: true, sheetRows: 0 })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  // Buscar la fila de encabezados en las primeras filas (puede no ser la 0)
  let headerRow = -1, headers = []
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const row = raw[i]
    if (!row) continue
    const normed = row.map(norm)
    if (normed.includes('codigo') || normed.includes('código')) { headerRow = i; headers = normed; break }
  }
  if (headerRow === -1) throw new Error('No se encontró columna "Código" en las primeras filas')

  const iCod = headers.findIndex(h => h === 'codigo' || h === 'código')
  const iDesc = headers.findIndex(h => h.includes('descripcion'))
  const iMarca = headers.findIndex(h => h === 'marca')
  const iFamilia = headers.findIndex(h => h.includes('familia'))
  const iCategoria = headers.findIndex(h => h.includes('categoria'))
  const iProveedor = headers.findIndex(h => h.includes('proveedor'))

  // Reporte de OC trae una línea por cada OC (mismo código puede repetirse
  // muchas veces) — nos quedamos con la última aparición, que suele ser la
  // más reciente. Reporte de Stock Disponible trae 1 fila por código.
  const esOC = iProveedor !== -1

  const filas = new Map()
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r]
    if (!row) continue
    const codigo = row[iCod] != null ? String(row[iCod]).trim() : ''
    if (!codigo) continue
    filas.set(codigo, {
      codigo,
      descripcion: iDesc !== -1 && row[iDesc] != null ? String(row[iDesc]).trim() : null,
      proveedor:   iProveedor !== -1 && row[iProveedor] != null ? String(row[iProveedor]).trim() : null,
      familia:     iFamilia !== -1 && row[iFamilia] != null ? String(row[iFamilia]).trim() : null,
      categoria:   iCategoria !== -1 && row[iCategoria] != null ? String(row[iCategoria]).trim() : null,
      marca:       iMarca !== -1 && row[iMarca] != null ? String(row[iMarca]).trim() : null,
    })
  }
  return { filas: [...filas.values()], fuente: esOC ? 'oc' : 'stock_disponible' }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors())
app.use(compression())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 }, fileFilter: (req, file, cb) => { cb(null, true) } })

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')))
}

// ─── Background processor ─────────────────────────────────────────────────────
async function processUpload(uploadId, encabezados, detalles) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let insertados = 0, actualizados = 0
    let colisiones = 0, sinIdOperacion = 0
    const colisionesDetalle = []

    // Traer lo que ya existe, indexado por id_operacion (la clave real).
    // Si un id_operacion ya guardado tiene nro_comprobante/fecha/tipo/sucursal
    // DISTINTOS a los que trae el archivo, es una anomalía real de datos (el
    // mismo ID de operación no debería cambiar de identidad) — se loguea para
    // investigar, ya no debería pasar salvo error de carga en el ERP mismo.
    const idOpsArchivo = [...new Set(encabezados.map(e => e.id_operacion).filter(v => v != null))]
    const existentesR = idOpsArchivo.length > 0 ? await client.query(
      `SELECT id_operacion, nro_comprobante, fecha::text as fecha, tipo_comprob, sucursal FROM comprobantes WHERE id_operacion = ANY($1)`,
      [idOpsArchivo]
    ) : { rows: [] }
    const existentesMap = new Map(existentesR.rows.map(r => [r.id_operacion, r]))

    const compChunk = 100
    for (let i = 0; i < encabezados.length; i += compChunk) {
      const chunk = encabezados.slice(i, i + compChunk)
      for (const enc of chunk) {
        if (enc.id_operacion == null) {
          // Caso raro — sin ID operación no hay clave confiable. Respaldo
          // manual por nro_comprobante+fecha+tipo+sucursal (no perfecto, pero
          // mejor que asumir que nro_comprobante solo alcanza).
          sinIdOperacion++
          const prevR = await client.query(
            `SELECT 1 FROM comprobantes WHERE nro_comprobante=$1 AND fecha=$2 AND tipo_comprob=$3 AND sucursal=$4`,
            [enc.nro_comprobante, enc.fecha, enc.tipo_comprob, enc.sucursal]
          )
          if (prevR.rows.length > 0) {
            await client.query(
              `UPDATE comprobantes SET subtotal=$1,neto_gravado=$2,iva_105=$3,iva_21=$4,total=$5,upload_id=$6
               WHERE nro_comprobante=$7 AND fecha=$8 AND tipo_comprob=$9 AND sucursal=$10`,
              [enc.subtotal,enc.neto_gravado,enc.iva_105,enc.iva_21,enc.total,uploadId,enc.nro_comprobante,enc.fecha,enc.tipo_comprob,enc.sucursal]
            )
            actualizados++
          } else {
            await client.query(
              `INSERT INTO comprobantes (nro_comprobante,id_transaccion,id_operacion,id_sucursal,sucursal,fecha,fecha_carga,tipo_comprob,tipo_cliente,razon_social,cond_iva,cond_venta,lista_precios,subtotal,neto_gravado,iva_105,iva_21,total,moneda,usuario,upload_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
              [enc.nro_comprobante,enc.id_transaccion,enc.id_operacion,enc.id_sucursal,enc.sucursal,enc.fecha,enc.fecha_carga,enc.tipo_comprob,enc.tipo_cliente,enc.razon_social,enc.cond_iva,enc.cond_venta,enc.lista_precios,enc.subtotal,enc.neto_gravado,enc.iva_105,enc.iva_21,enc.total,enc.moneda,enc.usuario,uploadId]
            )
            insertados++
          }
          continue
        }
        const prev = existentesMap.get(enc.id_operacion)
        if (prev && (prev.nro_comprobante !== enc.nro_comprobante || prev.fecha !== enc.fecha || prev.tipo_comprob !== enc.tipo_comprob || prev.sucursal !== enc.sucursal)) {
          colisiones++
          if (colisionesDetalle.length < 30) {
            colisionesDetalle.push(`id_operacion ${enc.id_operacion}: guardado(${prev.nro_comprobante}/${prev.fecha}/${prev.tipo_comprob}/${prev.sucursal}) vs archivo(${enc.nro_comprobante}/${enc.fecha}/${enc.tipo_comprob}/${enc.sucursal})`)
          }
        }
        const r = await client.query(
          `INSERT INTO comprobantes (nro_comprobante,id_transaccion,id_operacion,id_sucursal,sucursal,fecha,fecha_carga,tipo_comprob,tipo_cliente,razon_social,cond_iva,cond_venta,lista_precios,subtotal,neto_gravado,iva_105,iva_21,total,moneda,usuario,upload_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id_operacion) WHERE id_operacion IS NOT NULL DO UPDATE SET
             nro_comprobante=EXCLUDED.nro_comprobante,fecha=EXCLUDED.fecha,tipo_comprob=EXCLUDED.tipo_comprob,sucursal=EXCLUDED.sucursal,
             subtotal=EXCLUDED.subtotal,neto_gravado=EXCLUDED.neto_gravado,iva_105=EXCLUDED.iva_105,iva_21=EXCLUDED.iva_21,total=EXCLUDED.total,upload_id=EXCLUDED.upload_id
           RETURNING (xmax = 0) AS inserted`,
          [enc.nro_comprobante,enc.id_transaccion,enc.id_operacion,enc.id_sucursal,enc.sucursal,enc.fecha,enc.fecha_carga,enc.tipo_comprob,enc.tipo_cliente,enc.razon_social,enc.cond_iva,enc.cond_venta,enc.lista_precios,enc.subtotal,enc.neto_gravado,enc.iva_105,enc.iva_21,enc.total,enc.moneda,enc.usuario,uploadId]
        )
        if (r.rows[0].inserted) insertados++; else actualizados++
      }
    }

    // Borrar+reinsertar detalles — usando id_operacion como clave real. Antes
    // borraba por nro_comprobante, lo que podía eliminar las líneas de un
    // comprobante real y distinto que compartía número por casualidad.
    const idOpsDetalle = [...new Set(detalles.map(d => d.id_operacion).filter(v => v != null))]
    const nrosSinIdOp = [...new Set(detalles.filter(d => d.id_operacion == null).map(d => d.nro_comprobante))]
    if (idOpsDetalle.length > 0) {
      await client.query(`DELETE FROM ventas_lineas WHERE id_operacion = ANY($1)`, [idOpsDetalle])
    }
    if (nrosSinIdOp.length > 0) {
      // Respaldo para líneas sin id_operacion — mismo riesgo que antes, pero
      // acotado solo a este subconjunto raro en vez de a todo.
      await client.query(`DELETE FROM ventas_lineas WHERE id_operacion IS NULL AND nro_comprobante = ANY($1)`, [nrosSinIdOp])
    }

    // Batch insert detalles in chunks of 200
    const chunkSize = 200
    for (let i = 0; i < detalles.length; i += chunkSize) {
      const chunk = detalles.slice(i, i + chunkSize)
      const values = [], params = []
      let p = 1
      for (const l of chunk) {
        values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16})`)
        params.push(l.nro_comprobante,l.id_operacion,l.id_fila,l.sucursal,l.fecha,l.tipo_comprob,l.id_articulo,l.codigo,l.descripcion,l.costo,l.cantidad,l.precio_unitario,l.descuento,l.subtotal_neto,l.alicuota_iva,l.subtotal_det,uploadId)
        p += 17
      }
      await client.query(
        `INSERT INTO ventas_lineas (nro_comprobante,id_operacion,id_fila,sucursal,fecha,tipo_comprob,id_articulo,codigo,descripcion,costo,cantidad,precio_unitario,descuento,subtotal_neto,alicuota_iva,subtotal_det,upload_id) VALUES ${values.join(',')}`,
        params
      )
    }

    await client.query('COMMIT')
    await pool.query(
      `UPDATE uploads_log SET n_insertados=$1,n_actualizados=$2,n_colisiones=$3,colisiones_detalle=$4,status='ok' WHERE id=$5`,
      [insertados, actualizados, colisiones, colisionesDetalle.join('\n') + (sinIdOperacion > 0 ? `\n\n(${sinIdOperacion} comprobantes sin ID operación — usaron respaldo por nro_comprobante+fecha+tipo+sucursal)` : '') || null, uploadId]
    )
    console.log(`Upload ${uploadId} done: ${insertados} new, ${actualizados} updated${colisiones > 0 ? `, ⚠ ${colisiones} anomalías (mismo id_operacion, distinta identidad)` : ''}${sinIdOperacion > 0 ? `, ${sinIdOperacion} sin id_operacion (respaldo)` : ''}`)
    if (colisiones > 0) console.warn(`Upload ${uploadId} colisiones:`, colisionesDetalle)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    await pool.query(`UPDATE uploads_log SET status='error' WHERE id=$1`, [uploadId])
    console.error(`Upload ${uploadId} error:`, err.message)
  } finally {
    client.release()
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

    // Crear el registro de carga ANTES de parsear (con datos provisorios) y
    // responder ya mismo — el parseo con exceljs streaming puede tardar
    // 20-35s en archivos grandes, y si el navegador espera esa respuesta se
    // corta la conexión (eso causaba la pantalla en negro). Parseo + guardado
    // corren enteros en segundo plano, como ya hacía el guardado antes.
    const logRes = await pool.query(
      `INSERT INTO uploads_log (filename, status) VALUES ($1,'parseando') RETURNING id`,
      [req.file.originalname]
    )
    const uploadId = logRes.rows[0].id

    res.json({ ok: true, uploadId, procesando: true })

    setImmediate(async () => {
      try {
        const { encabezados, detalles } = await parsePlanillaVentas(req.file.buffer)
        if (encabezados.length === 0) {
          await pool.query(`UPDATE uploads_log SET status='error' WHERE id=$1`, [uploadId])
          console.error(`Upload ${uploadId} error: No se encontraron encabezados`)
          return
        }
        const fechas = encabezados.map(e => e.fecha).filter(Boolean).sort()
        const sucursales = [...new Set(encabezados.map(e => e.sucursal).filter(Boolean))]
        await pool.query(
          `UPDATE uploads_log SET fecha_desde=$1, fecha_hasta=$2, sucursales=$3, n_encabezados=$4, n_detalles=$5, status='procesando' WHERE id=$6`,
          [fechas[0] || null, fechas[fechas.length - 1] || null, sucursales.join(', '), encabezados.length, detalles.length, uploadId]
        )
        await processUpload(uploadId, encabezados, detalles)
      } catch (err) {
        console.error(`Upload ${uploadId} parse error:`, err)
        await pool.query(`UPDATE uploads_log SET status='error' WHERE id=$1`, [uploadId]).catch(() => {})
      }
    })

  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Upload status polling ────────────────────────────────────────────────────
app.get('/api/upload-status/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM uploads_log WHERE id=$1', [req.params.id])
    const row = r.rows[0]
    if (!row) return res.json({ status: 'not_found' })
    res.json({
      ...row,
      encabezados: row.n_encabezados, detalles: row.n_detalles,
      insertados: row.n_insertados, actualizados: row.n_actualizados,
      fechaDesde: row.fecha_desde, fechaHasta: row.fecha_hasta,
      sucursales: row.sucursales ? row.sucursales.split(', ').filter(Boolean) : [],
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Carga del maestro de artículos (Stock Disponible / Órdenes de Compra) ────
app.post('/api/upload-maestro', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })
    const { filas, fuente } = parseMaestroArticulos(req.file.buffer)
    if (filas.length === 0) return res.status(400).json({ error: 'No se encontraron filas con código' })

    let insertados = 0, actualizados = 0
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const f of filas) {
        const r = await client.query(`
          INSERT INTO articulos_maestro (codigo, descripcion, proveedor, familia, categoria, marca, fuente, actualizado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT (codigo) DO UPDATE SET
            descripcion = COALESCE(EXCLUDED.descripcion, articulos_maestro.descripcion),
            proveedor   = COALESCE(EXCLUDED.proveedor,   articulos_maestro.proveedor),
            familia     = COALESCE(EXCLUDED.familia,     articulos_maestro.familia),
            categoria   = COALESCE(EXCLUDED.categoria,   articulos_maestro.categoria),
            marca       = COALESCE(EXCLUDED.marca,       articulos_maestro.marca),
            fuente      = CASE WHEN articulos_maestro.fuente = $7 THEN $7
                               WHEN articulos_maestro.fuente IS NULL THEN $7
                               ELSE articulos_maestro.fuente || '+' || $7 END,
            actualizado = NOW()
          RETURNING (xmax = 0) AS inserted
        `, [f.codigo, f.descripcion, f.proveedor, f.familia, f.categoria, f.marca, fuente])
        if (r.rows[0].inserted) insertados++; else actualizados++
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    res.json({ ok: true, fuente, filas: filas.length, insertados, actualizados })
  } catch (err) {
    console.error('Upload maestro error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Cobertura del join código→maestro ─────────────────────────────────────────
// Antes de construir cualquier gráfico por Proveedor/Familia/Categoría/Marca,
// hay que saber qué tan completo está el cruce contra las ventas reales — no
// asumir que el maestro cubre todo. Devuelve el % de cobertura y, si se pide,
// el listado de códigos vendidos que no matchean contra ningún artículo del maestro.
app.get('/api/maestro/cobertura', async (req, res) => {
  try {
    const { where, params } = buildWhere('1=1', req.query)
    const { where: whereVl, params: paramsVl } = buildWhere('1=1', req.query, 'vl')
    const [total, cubiertos, camposVacios] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT codigo) as n FROM ventas_lineas WHERE ${where}`, params),
      pool.query(`
        SELECT COUNT(DISTINCT vl.codigo) as n
        FROM ventas_lineas vl
        JOIN articulos_maestro am ON am.codigo = vl.codigo
        WHERE ${whereVl}
      `, paramsVl),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE proveedor IS NULL) as sin_proveedor,
          COUNT(*) FILTER (WHERE familia   IS NULL) as sin_familia,
          COUNT(*) FILTER (WHERE categoria IS NULL) as sin_categoria,
          COUNT(*) FILTER (WHERE marca     IS NULL) as sin_marca,
          COUNT(*) as total_maestro
        FROM articulos_maestro
      `),
    ])
    const totalN = Number(total.rows[0].n), cubiertosN = Number(cubiertos.rows[0].n)
    res.json({
      codigos_vendidos: totalN,
      codigos_con_maestro: cubiertosN,
      cobertura_pct: totalN > 0 ? Math.round((cubiertosN / totalN) * 1000) / 10 : 0,
      sin_maestro: totalN - cubiertosN,
      completitud_maestro: camposVacios.rows[0],
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/maestro/sin-clasificar', async (req, res) => {
  try {
    const { where: whereVl, params } = buildWhere('1=1', req.query, 'vl')
    const r = await pool.query(`
      SELECT vl.codigo, MAX(vl.descripcion) as descripcion, SUM(vl.cantidad) as unidades,
        COUNT(DISTINCT vl.nro_comprobante) as n_ventas,
        MIN(vl.fecha)::text as primera_venta, MAX(vl.fecha)::text as ultima_venta,
        (CURRENT_DATE - MAX(vl.fecha)) as dias_desde_ultima_venta
      FROM ventas_lineas vl
      LEFT JOIN articulos_maestro am ON am.codigo = vl.codigo
      WHERE ${whereVl} AND am.codigo IS NULL
      GROUP BY vl.codigo
      ORDER BY ultima_venta DESC
      LIMIT 500
    `, params)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildWhere(base, q, col = '') {
  const parts = [base], params = []
  let n = params.length + 1
  const c = col ? col + '.' : ''
  if (q?.desde) { parts.push(`${c}fecha >= $${n++}`); params.push(q.desde) }
  if (q?.hasta) { parts.push(`${c}fecha <= $${n++}`); params.push(q.hasta) }
  if (q?.sucursal && q.sucursal !== 'todas') { parts.push(`${c}sucursal = $${n++}`); params.push(q.sucursal) }
  // Cascada de clasificación (Proveedor → Familia → Categoría → Marca) — todos
  // los niveles activos se combinan en UNA sola subquery contra el maestro, no
  // una por nivel, para no encadenar 4 EXISTS separados innecesariamente.
  const splitCsv = v => String(v).split(',').map(s => s.trim()).filter(Boolean)
  const condsMaestro = []
  if (q?.proveedores) { const v = splitCsv(q.proveedores); if (v.length) { condsMaestro.push(`am2.proveedor = ANY($${n++})`); params.push(v) } }
  if (q?.familias)    { const v = splitCsv(q.familias);    if (v.length) { condsMaestro.push(`am2.familia = ANY($${n++})`);   params.push(v) } }
  if (q?.categorias)  { const v = splitCsv(q.categorias);  if (v.length) { condsMaestro.push(`am2.categoria = ANY($${n++})`); params.push(v) } }
  if (q?.marcas)      { const v = splitCsv(q.marcas);      if (v.length) { condsMaestro.push(`am2.marca = ANY($${n++})`);     params.push(v) } }
  if (condsMaestro.length) {
    parts.push(`${c}nro_comprobante IN (
      SELECT DISTINCT vl2.nro_comprobante FROM ventas_lineas vl2
      JOIN articulos_maestro am2 ON am2.codigo = vl2.codigo
      WHERE ${condsMaestro.join(' AND ')}
    )`)
  }
  return { where: parts.join(' AND '), params }
}

// ─── Estadísticas por período — promedio/último + variación%, ventanas móviles ─
// No usa semestre/trimestre/mes/semana calendario (eso rompe con años parciales
// y meses de distinta duración) — usa ventanas móviles de N días terminando en
// la fecha más reciente con datos. "Último" = la ventana más reciente,
// "promedio" = promedio de las ventanas anteriores disponibles (hasta 8).
// Validado con datos sintéticos antes de usarlo en producción.
function calcularEstadisticasPeriodo(porFecha) {
  const fechas = Object.keys(porFecha).sort()
  if (fechas.length === 0) return null
  const maxFecha = fechas[fechas.length - 1]
  const minFecha = fechas[0]
  const maxDate = new Date(maxFecha + 'T00:00:00')
  const minDate = new Date(minFecha + 'T00:00:00')
  const diasConVenta = fechas.filter(f => porFecha[f] > 0).length

  const sumaRango = (desde, hasta) => {
    let total = 0
    for (const f of fechas) { if (f >= desde && f <= hasta) total += porFecha[f] }
    return total
  }
  const restarDias = (date, n) => { const d = new Date(date); d.setDate(d.getDate() - n); return d }
  const fmt = d => d.toISOString().slice(0, 10)

  const diasConVentaUltMes = fechas.filter(f => porFecha[f] > 0 && f >= fmt(restarDias(maxDate, 29)) && f <= maxFecha).length

  function stats(nDias, maxBuckets = 8) {
    const buckets = []
    let finBucket = new Date(maxDate)
    for (let b = 0; b < maxBuckets; b++) {
      const inicioBucket = restarDias(finBucket, nDias - 1)
      const total = sumaRango(fmt(inicioBucket), fmt(finBucket))
      buckets.unshift(total)
      finBucket = restarDias(inicioBucket, 1)
      if (finBucket < minDate) break
    }
    if (buckets.length === 0) return { promedio: null, ultimo: null, variacionPct: null }
    const ultimo = buckets[buckets.length - 1]
    const previos = buckets.slice(0, -1)
    const promedio = previos.length > 0 ? previos.reduce((a, b) => a + b, 0) / previos.length : null
    const variacionPct = promedio && promedio > 0 ? Math.round(((ultimo - promedio) / promedio) * 1000) / 10 : null
    return { promedio: promedio !== null ? Math.round(promedio) : null, ultimo: Math.round(ultimo), variacionPct }
  }

  return {
    dias_con_venta: diasConVenta, dias_con_venta_ult_mes: diasConVentaUltMes,
    semana: stats(7), mes: stats(30), trimestre: stats(90), semestre: stats(180),
  }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
app.get('/api/kpis', async (req, res) => {
  try {
    const { where: wc, params: pc } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const { where: wn, params: pn } = buildWhere(`tipo_comprob IN ('NC','NCB')`, req.query)
    const { where: wl, params: pl } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)

    const [t, nc, l, av] = await Promise.all([
      pool.query(`SELECT COUNT(*) as n_comp, SUM(total) as facturacion, SUM(neto_gravado) as neto, SUM(iva_21) as iva21, SUM(iva_105) as iva105, AVG(total) as ticket, COUNT(DISTINCT fecha) as dias FROM comprobantes WHERE ${wc}`, pc),
      pool.query(`SELECT COUNT(*) as n_nc, SUM(total) as total_nc FROM comprobantes WHERE ${wn}`, pn),
      pool.query(`SELECT COUNT(*) as n_lin, SUM(cantidad) as unidades, COUNT(DISTINCT codigo) as arts, SUM(costo*cantidad) as costo, SUM(subtotal_neto) as venta_neta FROM ventas_lineas WHERE ${wl}`, pl),
      pool.query(`
        SELECT
          AVG(arts_por_venta) as articulos_promedio_por_venta,
          AVG(unidades_por_venta) as unidades_promedio_por_venta,
          MAX(arts_por_venta) as max_articulos_por_venta
        FROM (
          SELECT
            nro_comprobante,
            COUNT(DISTINCT codigo) as arts_por_venta,
            SUM(cantidad) as unidades_por_venta
          FROM ventas_lineas
          WHERE ${wl}
          GROUP BY nro_comprobante
        ) x
      `, pl)
    ])

    const tv = t.rows[0], nv = nc.rows[0], lv = l.rows[0], avv = av.rows[0] || {}
    const facturacion = (+tv.facturacion || 0) - (+nv.total_nc || 0)
    const venta_neta = +lv.venta_neta || 0
    const costo = +lv.costo || 0
    const margen = venta_neta > 0 ? Math.round(((venta_neta - costo) / venta_neta) * 1000) / 10 : 0

    res.json({
      n_comprobantes: +tv.n_comp || 0, facturacion_bruta: +tv.facturacion || 0,
      facturacion_neta: facturacion, neto_gravado: +tv.neto || 0,
      iva_total: (+tv.iva21 || 0) + (+tv.iva105 || 0), ticket_promedio: +tv.ticket || 0,
      dias_con_venta: +tv.dias || 0, n_nc: +nv.n_nc || 0, total_nc: +nv.total_nc || 0,
      n_lineas: +lv.n_lin || 0, unidades_vendidas: +lv.unidades || 0,
      articulos_distintos: +lv.arts || 0, costo_total: costo, venta_neta, margen_bruto_pct: margen,
      lineas_por_comprobante: tv.n_comp > 0 ? Math.round((lv.n_lin / tv.n_comp) * 10) / 10 : 0,
      articulos_promedio_por_venta: +avv.articulos_promedio_por_venta || 0,
      unidades_promedio_por_venta: +avv.unidades_promedio_por_venta || 0,
      max_articulos_por_venta: +avv.max_articulos_por_venta || 0
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-dia', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const r = await pool.query(`SELECT fecha::text, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY fecha ORDER BY fecha`, params)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-sucursal', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { desde: req.query.desde, hasta: req.query.hasta, proveedores: req.query.proveedores })
    const r = await pool.query(`SELECT sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY sucursal ORDER BY total DESC`, params)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-mes', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { sucursal: req.query.sucursal, proveedores: req.query.proveedores })
    const r = await pool.query(`SELECT TO_CHAR(fecha,'YYYY-MM') as mes, sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY mes, sucursal ORDER BY mes, sucursal`, params)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Proveedores — filtro general de arranque ──────────────────────────────────
// ─── Opciones existentes de Familia/Categoría/Marca (para autocompletar al
// clasificar manualmente, y no generar variantes de escritura del mismo valor)
app.get('/api/maestro/opciones', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        array_agg(DISTINCT familia)  FILTER (WHERE familia  IS NOT NULL) as familias,
        array_agg(DISTINCT categoria) FILTER (WHERE categoria IS NOT NULL) as categorias,
        array_agg(DISTINCT marca)    FILTER (WHERE marca    IS NOT NULL) as marcas
      FROM articulos_maestro
    `)
    const row = r.rows[0]
    res.json({
      familias: (row.familias || []).sort(),
      categorias: (row.categorias || []).sort(),
      marcas: (row.marcas || []).sort(),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Clasificación manual — código a código, SIN proveedor a propósito ────────
// Para los códigos huérfanos (sin match en ningún reporte de OC/Stock
// Disponible) donde no se conoce o no importa el proveedor, pero sí se puede
// decidir a mano Familia/Categoría/Marca para que dejen de contar como
// "sin clasificar". Mismo upsert que la carga automática — nunca pisa un
// proveedor que ya exista (podría haber quedado de una carga previa parcial).
app.post('/api/maestro/clasificar-manual', async (req, res) => {
  try {
    const { codigo, descripcion, familia, categoria, marca } = req.body
    if (!codigo) return res.status(400).json({ error: 'Falta código' })
    await pool.query(`
      INSERT INTO articulos_maestro (codigo, descripcion, familia, categoria, marca, fuente, actualizado)
      VALUES ($1,$2,$3,$4,$5,'manual',NOW())
      ON CONFLICT (codigo) DO UPDATE SET
        descripcion = COALESCE(articulos_maestro.descripcion, EXCLUDED.descripcion),
        familia     = COALESCE(EXCLUDED.familia,   articulos_maestro.familia),
        categoria   = COALESCE(EXCLUDED.categoria, articulos_maestro.categoria),
        marca       = COALESCE(EXCLUDED.marca,     articulos_maestro.marca),
        fuente      = CASE WHEN articulos_maestro.fuente IS NULL THEN 'manual' ELSE articulos_maestro.fuente || '+manual' END,
        actualizado = NOW()
    `, [codigo, descripcion || null, familia || null, categoria || null, marca || null])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Diagnóstico — verificar colisiones reales de nro_comprobante ─────────────
// Solo lectura, no cambia nada. Busca en ventas_lineas (que retiene todas las
// líneas cargadas) casos donde el mismo nro_comprobante tenga más de un
// id_operacion distinto entre sus líneas — eso es prueba directa de que dos
// documentos reales distintos comparten número, no una sospecha.
// Todo el historial de colisiones detectadas (de todas las cargas, no solo la
// última) — sirve para armar la lista concreta de qué períodos/documentos
// conviene re-cargar para reparar lo que se pisó antes del fix.
app.get('/api/debug/todas-las-colisiones', async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, filename, fecha_desde, fecha_hasta, uploaded_at, n_colisiones, colisiones_detalle FROM uploads_log WHERE n_colisiones > 0 ORDER BY id`)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Comparar línea por línea los 2 documentos detrás de una colisión ─────────
// Para responder "¿tienen los mismos artículos y montos?" con datos reales,
// no con una suposición. Por default toma una muestra de 5 colisiones reales
// (las de más líneas, para que la comparación sea representativa); también
// se puede pedir un nro_comprobante puntual con ?nro=0028-00009494
// ─── Cargas atascadas en PROCESANDO — nunca terminaron ────────────────────────
// processUpload() corre en segundo plano (setImmediate) — si el servidor se
// reinicia mientras está procesando (ej. un redeploy), el proceso muere a
// mitad de camino: los datos que ya se habían insertado ANTES del corte
// quedan guardados (la transacción hace COMMIT por lotes), pero el registro
// de la carga se queda para siempre en 'procesando', sin avisar que quedó
// incompleta. Esto lista todas las que llevan más de 1 hora así — período
// que casi seguro necesita recargarse para completarse.
app.get('/api/debug/cargas-atascadas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, filename, fecha_desde, fecha_hasta, sucursales, n_encabezados, n_detalles,
        uploaded_at, EXTRACT(EPOCH FROM (NOW() - uploaded_at))/3600 as horas_atascada
      FROM uploads_log
      WHERE status = 'procesando' AND uploaded_at < NOW() - INTERVAL '1 hour'
      ORDER BY uploaded_at
    `)
    res.json({
      resumen: r.rows.length > 0
        ? `⚠ ${r.rows.length} carga(s) quedaron atascadas en "procesando" y nunca terminaron — probablemente por un redeploy del servidor a mitad de camino. Conviene recargar esos mismos archivos de nuevo (es seguro, no duplica nada).`
        : 'No hay cargas atascadas en este momento.',
      cargas_atascadas: r.rows.map(row => ({ ...row, horas_atascada: Math.round(row.horas_atascada) })),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Qué meses recargar — sin el límite de 30 muestras por carga ──────────────
// El log de cada carga guarda solo una muestra de hasta 30 colisiones, no
// alcanza para saber el panorama completo. Esto recorre TODAS las colisiones
// reales que sobreviven hoy en ventas_lineas y las agrupa por mes — tanto del
// lado del documento más viejo (el que probablemente perdió su encabezado en
// `comprobantes`) como del más nuevo, para priorizar qué recargar primero.
app.get('/api/debug/meses-afectados', async (req, res) => {
  try {
    const colision = await pool.query(`
      SELECT nro_comprobante, id_operacion, MIN(fecha)::text as fecha, MAX(tipo_comprob) as tipo
      FROM ventas_lineas
      WHERE id_operacion IS NOT NULL
        AND nro_comprobante IN (
          SELECT nro_comprobante FROM ventas_lineas
          WHERE id_operacion IS NOT NULL
          GROUP BY nro_comprobante
          HAVING COUNT(DISTINCT id_operacion) > 1
        )
      GROUP BY nro_comprobante, id_operacion
    `)

    const porMes = {}
    for (const row of colision.rows) {
      const mes = row.fecha.slice(0, 7)
      if (!porMes[mes]) porMes[mes] = { mes, documentos_afectados: 0, comprobantes: new Set() }
      porMes[mes].documentos_afectados++
      porMes[mes].comprobantes.add(row.nro_comprobante)
    }
    const resumenPorMes = Object.values(porMes)
      .map(m => ({ mes: m.mes, documentos_afectados: m.documentos_afectados, comprobantes_involucrados: m.comprobantes.size }))
      .sort((a, b) => a.mes.localeCompare(b.mes))

    res.json({
      resumen: `${colision.rows.length} documentos (de ${new Set(colision.rows.map(r=>r.nro_comprobante)).size} números de comprobante) están involucrados en alguna colisión — agrupados por mes para priorizar qué recargar.`,
      total_documentos_afectados: colision.rows.length,
      por_mes: resumenPorMes,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/debug/comparar-colisiones', async (req, res) => {
  try {
    let nros
    if (req.query.nro) {
      nros = [req.query.nro]
    } else {
      const colision = await pool.query(`
        SELECT nro_comprobante
        FROM ventas_lineas
        WHERE id_operacion IS NOT NULL
        GROUP BY nro_comprobante
        HAVING COUNT(DISTINCT id_operacion) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `)
      nros = colision.rows.map(r => r.nro_comprobante)
    }

    const resultados = []
    for (const nro of nros) {
      const idsR = await pool.query(
        `SELECT DISTINCT id_operacion, fecha::text as fecha, tipo_comprob FROM ventas_lineas WHERE nro_comprobante=$1 AND id_operacion IS NOT NULL ORDER BY id_operacion`,
        [nro]
      )
      if (idsR.rows.length < 2) continue
      const [docA, docB] = idsR.rows

      const [lineasAR, lineasBR] = await Promise.all([
        pool.query(`SELECT codigo, descripcion, cantidad, precio_unitario, subtotal_det FROM ventas_lineas WHERE id_operacion=$1 ORDER BY id_fila`, [docA.id_operacion]),
        pool.query(`SELECT codigo, descripcion, cantidad, precio_unitario, subtotal_det FROM ventas_lineas WHERE id_operacion=$1 ORDER BY id_fila`, [docB.id_operacion]),
      ])
      const lineasA = lineasAR.rows, lineasB = lineasBR.rows
      const totalA = lineasA.reduce((s, l) => s + Number(l.subtotal_det || 0), 0)
      const totalB = lineasB.reduce((s, l) => s + Number(l.subtotal_det || 0), 0)
      const codigosA = new Set(lineasA.map(l => l.codigo))
      const codigosB = new Set(lineasB.map(l => l.codigo))
      const enComun = [...codigosA].filter(c => codigosB.has(c)).length

      resultados.push({
        nro_comprobante: nro,
        documento_A: { id_operacion: docA.id_operacion, fecha: docA.fecha, tipo: docA.tipo_comprob, n_lineas: lineasA.length, total: Math.round(totalA) },
        documento_B: { id_operacion: docB.id_operacion, fecha: docB.fecha, tipo: docB.tipo_comprob, n_lineas: lineasB.length, total: Math.round(totalB) },
        articulos_en_comun: enComun,
        mismos_articulos_exacto: enComun === codigosA.size && enComun === codigosB.size && codigosA.size === codigosB.size,
        diferencia_de_monto: Math.round(Math.abs(totalA - totalB)),
        lineas_documento_A: lineasA,
        lineas_documento_B: lineasB,
      })
    }
    res.json({
      resumen: `Comparación de ${resultados.length} colisiones reales, línea por línea.`,
      resultados,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/debug/verificar-comprobantes', async (req, res) => {
  try {
    const colision = await pool.query(`
      SELECT nro_comprobante,
        COUNT(DISTINCT id_operacion) as distintos_id_operacion,
        array_agg(DISTINCT id_operacion) as ids_operacion_encontrados,
        array_agg(DISTINCT fecha::text) as fechas_encontradas,
        array_agg(DISTINCT tipo_comprob) as tipos_encontrados,
        array_agg(DISTINCT sucursal) as sucursales_encontradas,
        COUNT(*) as n_lineas_totales
      FROM ventas_lineas
      WHERE id_operacion IS NOT NULL
      GROUP BY nro_comprobante
      HAVING COUNT(DISTINCT id_operacion) > 1
      ORDER BY distintos_id_operacion DESC, n_lineas_totales DESC
      LIMIT 200
    `)
    const totalNros = await pool.query(`SELECT COUNT(DISTINCT nro_comprobante) as n FROM ventas_lineas`)
    const totalIdOp = await pool.query(`SELECT COUNT(DISTINCT id_operacion) as n FROM ventas_lineas WHERE id_operacion IS NOT NULL`)

    res.json({
      resumen: colision.rows.length > 0
        ? `⚠ CONFIRMADO: ${colision.rows.length} números de comprobante distintos tienen más de un ID de operación entre sus líneas actuales en la base — son documentos reales distintos compartiendo número.`
        : `No se encontraron colisiones en las líneas actualmente guardadas (puede ser que ya se hayan pisado sin dejar rastro en cargas previas — esto solo detecta lo que sobrevive hoy).`,
      nro_comprobante_distintos: Number(totalNros.rows[0].n),
      id_operacion_distintos: Number(totalIdOp.rows[0].n),
      diferencia: Number(totalIdOp.rows[0].n) - Number(totalNros.rows[0].n),
      casos_de_colision: colision.rows,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/proveedores', async (req, res) => {
  try {
    const r = await pool.query(`SELECT DISTINCT proveedor FROM articulos_maestro WHERE proveedor IS NOT NULL ORDER BY proveedor`)
    res.json(r.rows.map(x => x.proveedor))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Ranking en cascada — Familia / Categoría / Marca / Artículo ───────────────
// Un solo endpoint para los 4 niveles de abajo de la jerarquía. Cada nivel
// respeta lo que ya esté filtrado arriba (proveedores/familias/categorias/marcas
// en la querystring) — así clic en una barra de Familia filtra Categoría, clic
// en Categoría filtra Marca, etc., sin que el frontend tenga que saber SQL.
const NIVEL_COLUMNA = { familia: 'am.familia', categoria: 'am.categoria', marca: 'am.marca', articulo: 'vl.codigo' }
app.get('/api/ventas/ranking-nivel', async (req, res) => {
  try {
    const nivel = req.query.nivel
    const col = NIVEL_COLUMNA[nivel]
    if (!col) return res.status(400).json({ error: `nivel inválido: ${nivel}. Usar familia|categoria|marca|articulo` })
    const { where, params } = buildWhere('1=1', req.query, 'vl')

    const selectDesc = nivel === 'articulo' ? ', MAX(vl.descripcion) as descripcion' : ''
    const r = await pool.query(`
      SELECT
        COALESCE(${col}, 'Sin clasificar') as valor_nivel
        ${selectDesc},
        SUM(vl.cantidad) as unidades,
        COUNT(DISTINCT vl.nro_comprobante) as n_ventas,
        SUM(vl.subtotal_neto) as facturacion
      FROM ventas_lineas vl
      LEFT JOIN articulos_maestro am ON am.codigo = vl.codigo
      WHERE ${where}
      GROUP BY valor_nivel
      ORDER BY facturacion DESC
      LIMIT 300
    `, params)

    const rDiario = await pool.query(`
      SELECT COALESCE(${col}, 'Sin clasificar') as valor_nivel, vl.fecha::text as fecha, SUM(vl.subtotal_neto) as total
      FROM ventas_lineas vl
      LEFT JOIN articulos_maestro am ON am.codigo = vl.codigo
      WHERE ${where}
      GROUP BY valor_nivel, vl.fecha
    `, params)
    const diarioPorValor = {}
    for (const d of rDiario.rows) {
      if (!diarioPorValor[d.valor_nivel]) diarioPorValor[d.valor_nivel] = {}
      diarioPorValor[d.valor_nivel][d.fecha] = Number(d.total || 0)
    }

    const total = r.rows.reduce((s, row) => s + Number(row.facturacion || 0), 0)
    let acum = 0
    const out = r.rows.map(row => {
      const pct = total > 0 ? (Number(row.facturacion) / total) * 100 : 0
      acum += pct
      const est = calcularEstadisticasPeriodo(diarioPorValor[row.valor_nivel] || {})
      return {
        ...row,
        pct: Math.round(pct * 10) / 10,
        pct_acum: Math.round(acum * 10) / 10,
        valor_pedido: Number(row.n_ventas) > 0 ? Math.round(Number(row.facturacion) / Number(row.n_ventas)) : 0,
        ...est,
      }
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Grupos de proveedor por rubro, y recomendación de "compras recientes" ────
// Un "grupo de proveedor" (ej. "Proveedores de Librería") no existe como dato
// propio — se infiere: un proveedor pertenece al rubro de la Familia que más
// vendió de él. Sirve para el filtro de "grupo de proveedor" que pediste.
app.get('/api/proveedores/grupos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT proveedor, familia, COUNT(*) as n
      FROM articulos_maestro
      WHERE proveedor IS NOT NULL AND familia IS NOT NULL
      GROUP BY proveedor, familia
    `)
    const porProveedor = {}
    for (const row of r.rows) {
      if (!porProveedor[row.proveedor]) porProveedor[row.proveedor] = {}
      porProveedor[row.proveedor][row.familia] = (porProveedor[row.proveedor][row.familia] || 0) + Number(row.n)
    }
    const grupos = {}
    for (const [prov, familias] of Object.entries(porProveedor)) {
      const familiaPrincipal = Object.entries(familias).sort((a, b) => b[1] - a[1])[0][0]
      if (!grupos[familiaPrincipal]) grupos[familiaPrincipal] = []
      grupos[familiaPrincipal].push(prov)
    }
    res.json(grupos)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Proveedores con carga reciente en el maestro (últimos 90 días) — es un proxy
// de "compras recientes": no tenemos la fecha real de cada OC guardada (hoy el
// maestro solo guarda proveedor/familia/categoría/marca, no el historial
// transaccional completo de compras — ver aclaración de la vuelta anterior).
// Cuando se persista el detalle real de compras, esto se reemplaza por la
// fecha de última OC real en vez de la fecha de carga del archivo.
// ─── Dataset crudo para el dashboard de Estadísticas (formato RAW columnar) ───
// Trae TODAS las filas de venta (respetando fecha/sucursal si se pasan como
// query params, para no traer más de lo necesario) más los diccionarios de
// dimensión, en el mismo formato posicional que usa el motor de agregación
// portado del dashboard de referencia — la agregación (Pareto, promedios,
// % acumulado, comparativa interanual) se calcula toda en el navegador,
// igual que en el original. Esto es justo lo que se está probando: si esto
// escala bien con el volumen real de Delmy o hay que migrar a agregación
// en el servidor.
app.get('/api/ventas/raw-dataset', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { desde: req.query.desde, hasta: req.query.hasta })

    const [maestroR, sucR, fechasR, filasR] = await Promise.all([
      pool.query(`SELECT codigo, descripcion, proveedor, familia, categoria, marca FROM articulos_maestro`),
      pool.query(`SELECT DISTINCT sucursal FROM ventas_lineas WHERE ${where} ORDER BY sucursal`, params),
      pool.query(`SELECT DISTINCT fecha::text as fecha FROM ventas_lineas WHERE ${where} ORDER BY fecha`, params),
      pool.query(`SELECT codigo, fecha::text as fecha, cantidad, nro_comprobante, subtotal_neto, sucursal, descripcion FROM ventas_lineas WHERE ${where}`, params),
    ])

    const proveedores = [...new Set(maestroR.rows.map(r => r.proveedor).filter(Boolean))].sort()
    const familias = [...new Set(maestroR.rows.map(r => r.familia).filter(Boolean))].sort()
    const categorias = [...new Set(maestroR.rows.map(r => r.categoria).filter(Boolean))].sort()
    const marcas = [...new Set(maestroR.rows.map(r => r.marca).filter(Boolean))].sort()
    const provIdx = new Map(proveedores.map((p,i)=>[p,i]))
    const famIdx = new Map(familias.map((f,i)=>[f,i]))
    const catIdx = new Map(categorias.map((c,i)=>[c,i]))
    const marcaIdx = new Map(marcas.map((m,i)=>[m,i]))

    // Maestro código -> {proveedor,familia,categoria,marca} para resolver rápido por línea de venta
    const maestroByCodigo = new Map(maestroR.rows.map(r => [r.codigo, r]))

    // Un artículo = un código de venta distinto que aparece en las filas (no
    // todo articulos_maestro, para no listar códigos que nunca se vendieron)
    const articleCodes = [...new Set(filasR.rows.map(r => r.codigo))]
    const articleIdxMap = new Map(articleCodes.map((c,i)=>[c,i]))
    const articles = articleCodes
    const articleDesc = []
    const articleProveedor = [], articleFamilia = [], articleCategoria = [], articleMarca = []
    for (const cod of articleCodes) {
      const m = maestroByCodigo.get(cod)
      const lineaEjemplo = filasR.rows.find(r => r.codigo === cod)
      articleDesc.push((m && m.descripcion) || (lineaEjemplo && lineaEjemplo.descripcion) || cod)
      articleProveedor.push(m && m.proveedor ? provIdx.get(m.proveedor) : -1)
      articleFamilia.push(m && m.familia ? famIdx.get(m.familia) : -1)
      articleCategoria.push(m && m.categoria ? catIdx.get(m.categoria) : -1)
      articleMarca.push(m && m.marca ? marcaIdx.get(m.marca) : -1)
    }

    const sucursales = sucR.rows.map(r => r.sucursal)
    const sucIdxMap = new Map(sucursales.map((s,i)=>[s,i]))
    const dates = fechasR.rows.map(r => r.fecha)
    const dateIdxMap = new Map(dates.map((d,i)=>[d,i]))

    const rows = []
    for (const r of filasR.rows) {
      const artI = articleIdxMap.get(r.codigo)
      const dateI = dateIdxMap.get(r.fecha)
      const sucI = sucIdxMap.get(r.sucursal)
      if (artI === undefined || dateI === undefined || sucI === undefined) continue
      rows.push([artI, dateI, Number(r.cantidad || 0), r.nro_comprobante, Number(r.subtotal_neto || 0), sucI])
    }

    res.json({
      proveedores, familias, categorias, marcas,
      articles, articleDesc, articleProveedor, articleFamilia, articleCategoria, articleMarca,
      sucursales, dates, rows,
    })
  } catch (err) {
    console.error('raw-dataset error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/proveedores/recientes', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT proveedor FROM articulos_maestro
      WHERE proveedor IS NOT NULL AND actualizado >= NOW() - INTERVAL '90 days'
      ORDER BY proveedor
    `)
    res.json(r.rows.map(x => x.proveedor))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Ranking por proveedor — primer nivel de la jerarquía, con datos de Pareto ─
app.get('/api/ventas/por-proveedor', async (req, res) => {
  try {
    const { where, params } = buildWhere('1=1', req.query, 'vl')
    const r = await pool.query(`
      SELECT
        COALESCE(am.proveedor, 'Sin clasificar') as proveedor,
        SUM(vl.cantidad) as unidades,
        COUNT(DISTINCT vl.nro_comprobante) as n_ventas,
        SUM(vl.subtotal_neto) as facturacion,
        COUNT(DISTINCT vl.codigo) as n_articulos
      FROM ventas_lineas vl
      LEFT JOIN articulos_maestro am ON am.codigo = vl.codigo
      WHERE ${where}
      GROUP BY proveedor
      ORDER BY facturacion DESC
    `, params)

    // Diario por proveedor, para las ventanas móviles de promedio/último/variación
    const rDiario = await pool.query(`
      SELECT COALESCE(am.proveedor, 'Sin clasificar') as proveedor, vl.fecha::text as fecha, SUM(vl.subtotal_neto) as total
      FROM ventas_lineas vl
      LEFT JOIN articulos_maestro am ON am.codigo = vl.codigo
      WHERE ${where}
      GROUP BY proveedor, vl.fecha
    `, params)
    const diarioPorProveedor = {}
    for (const d of rDiario.rows) {
      if (!diarioPorProveedor[d.proveedor]) diarioPorProveedor[d.proveedor] = {}
      diarioPorProveedor[d.proveedor][d.fecha] = Number(d.total || 0)
    }

    const total = r.rows.reduce((s, row) => s + Number(row.facturacion || 0), 0)
    let acum = 0
    const out = r.rows.map(row => {
      const pct = total > 0 ? (Number(row.facturacion) / total) * 100 : 0
      acum += pct
      const est = calcularEstadisticasPeriodo(diarioPorProveedor[row.proveedor] || {})
      return {
        ...row,
        pct: Math.round(pct * 10) / 10,
        pct_acum: Math.round(acum * 10) / 10,
        valor_pedido: Number(row.n_ventas) > 0 ? Math.round(Number(row.facturacion) / Number(row.n_ventas)) : 0,
        ...est,
      }
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Comparativa interanual — por trimestre y por mes ──────────────────────────
// Año actual = año de la última fecha con datos (no necesariamente el año de
// hoy). El período en curso (trimestre/mes que contiene esa fecha de corte) se
// divide del lado del año anterior en "comparable" (mismo tramo de días que ya
// transcurrió este año) + "resto" — para no comparar un mes completo del año
// pasado contra un mes a medias de este año.
app.get('/api/ventas/comparativa-anual', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { sucursal: req.query.sucursal, proveedores: req.query.proveedores })
    const r = await pool.query(`SELECT fecha::text as fecha, SUM(total) as total FROM comprobantes WHERE ${where} GROUP BY fecha ORDER BY fecha`, params)
    if (r.rows.length === 0) return res.json({ anioActual: null, anioAnterior: null, mes: [], trimestre: [] })

    const porDia = {}
    for (const d of r.rows) porDia[d.fecha] = Number(d.total || 0)

    const maxFecha = r.rows[r.rows.length - 1].fecha
    const anioActual = Number(maxFecha.slice(0, 4))
    const anioAnterior = anioActual - 1
    const corteMes = Number(maxFecha.slice(5, 7))
    const corteDia = Number(maxFecha.slice(8, 10))
    const diasEnMes = (anio, mes) => new Date(anio, mes, 0).getDate()

    function sumaRango(anio, mesDesde, diaDesde, mesHasta, diaHasta) {
      let total = 0
      for (const [f, v] of Object.entries(porDia)) {
        const y = Number(f.slice(0, 4)), m = Number(f.slice(5, 7)), dd = Number(f.slice(8, 10))
        if (y !== anio) continue
        const enRango = (m > mesDesde || (m === mesDesde && dd >= diaDesde)) && (m < mesHasta || (m === mesHasta && dd <= diaHasta))
        if (enRango) total += v
      }
      return total
    }

    function armarPeriodo({ periodo, label, mesDesde, mesHasta, esActual }) {
      const actual = sumaRango(anioActual, mesDesde, 1, esActual ? corteMes : mesHasta, esActual ? corteDia : diasEnMes(anioActual, mesHasta))
      let anteriorComparable = null, anteriorResto = null, anteriorCompleto = null
      if (esActual) {
        anteriorComparable = sumaRango(anioAnterior, mesDesde, 1, corteMes, corteDia)
        anteriorResto = sumaRango(anioAnterior, corteMes, corteDia + 1, mesHasta, diasEnMes(anioAnterior, mesHasta))
      } else {
        anteriorCompleto = sumaRango(anioAnterior, mesDesde, 1, mesHasta, diasEnMes(anioAnterior, mesHasta))
      }
      const anteriorParaVariacion = esActual ? anteriorComparable : anteriorCompleto
      const variacionPct = anteriorParaVariacion && anteriorParaVariacion > 0
        ? Math.round(((actual - anteriorParaVariacion) / anteriorParaVariacion) * 1000) / 10
        : null
      return { periodo, label, actual, anteriorComparable, anteriorResto, anteriorCompleto, esParcial: esActual, variacionPct }
    }

    const mes = []
    const nombresMes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    for (let m = 1; m <= corteMes; m++) {
      mes.push(armarPeriodo({ periodo: m, label: nombresMes[m - 1], mesDesde: m, mesHasta: m, esActual: m === corteMes }))
    }

    const trimQ = [[1,3],[4,6],[7,9],[10,12]]
    const corteTrimIdx = Math.floor((corteMes - 1) / 3)
    const trimestre = []
    for (let qi = 0; qi <= corteTrimIdx; qi++) {
      const [mDesde, mHasta] = trimQ[qi]
      trimestre.push(armarPeriodo({ periodo: qi + 1, label: `T${qi + 1}`, mesDesde: mDesde, mesHasta: mHasta, esActual: qi === corteTrimIdx }))
    }

    res.json({ anioActual, anioAnterior, corte: maxFecha, mes, trimestre })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/articulos/ranking', async (req, res) => {
  try {
    const { orderBy = 'facturacion', limit = 100 } = req.query
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const orderMap = { facturacion: 'facturacion DESC', unidades: 'unidades DESC', transacciones: 'n_transacciones DESC', margen: 'margen_pct DESC' }
    const order = orderMap[orderBy] || 'facturacion DESC'
    const r = await pool.query(
      `SELECT codigo, descripcion, COUNT(*) as n_transacciones, SUM(cantidad) as unidades, AVG(precio_unitario) as precio_promedio, AVG(costo) as costo_promedio, SUM(subtotal_neto) as facturacion, SUM(costo*cantidad) as costo_total, ROUND((SUM(subtotal_neto)-SUM(costo*cantidad))/NULLIF(SUM(subtotal_neto),0)*100,1) as margen_pct, COUNT(DISTINCT sucursal) as n_sucursales FROM ventas_lineas WHERE ${where} GROUP BY codigo, descripcion ORDER BY ${order} LIMIT $${params.length + 1}`,
      [...params, parseInt(limit)]
    )
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})


// ─── Stock consumer: ventas resumen por artículo ─────────────────────────────
// Devuelve resumen de unidades vendidas por código para que Stock+ deje de cargar
// planillas manuales de ventas. Los promedios históricos se calculan SOLO sobre
// semanas/meses con venta, útil para artículos estacionales.
app.get('/api/stock/ventas-resumen', async (req, res) => {
  try {
    const { sucursal = 'todas' } = req.query
    const sucFiltro = sucursal && sucursal !== 'todas' ? 'AND sucursal = $1' : ''
    const params = sucFiltro ? [sucursal] : []

    const r = await pool.query(`
      WITH base AS (
        SELECT
          codigo,
          descripcion,
          fecha::date AS fecha,
          DATE_TRUNC('week', fecha)::date AS semana,
          TO_CHAR(fecha, 'YYYY-MM') AS mes,
          cantidad,
          subtotal_neto,
          costo * cantidad AS costo_total,
          nro_comprobante
        FROM ventas_lineas
        WHERE tipo_comprob IN ('FCB','FCA','RE')
          AND codigo IS NOT NULL
          ${sucFiltro}
      ),
      semanal AS (
        SELECT
          codigo,
          semana,
          SUM(cantidad) AS unidades_semana,
          SUM(subtotal_neto) AS facturacion_semana,
          COUNT(DISTINCT nro_comprobante) AS tickets_semana
        FROM base
        GROUP BY codigo, semana
      ),
      mensual AS (
        SELECT
          codigo,
          mes,
          SUM(cantidad) AS unidades_mes,
          SUM(subtotal_neto) AS facturacion_mes
        FROM base
        GROUP BY codigo, mes
      ),
      ultimos AS (
        SELECT
          codigo,
          MAX(descripcion) AS descripcion,
          SUM(CASE WHEN fecha >= CURRENT_DATE - INTERVAL '7 day'  THEN cantidad ELSE 0 END) AS vs,
          SUM(CASE WHEN fecha >= CURRENT_DATE - INTERVAL '15 day' THEN cantidad ELSE 0 END) AS vq,
          SUM(CASE WHEN fecha >= CURRENT_DATE - INTERVAL '30 day' THEN cantidad ELSE 0 END) AS vm,
          SUM(CASE WHEN fecha >= CURRENT_DATE - INTERVAL '90 day' THEN cantidad ELSE 0 END) AS v90,
          SUM(cantidad) AS unidades_total,
          SUM(subtotal_neto) AS facturacion_total,
          SUM(costo_total) AS costo_total,
          COUNT(DISTINCT nro_comprobante) AS tickets_total,
          MIN(fecha)::text AS primera_venta,
          MAX(fecha)::text AS ultima_venta
        FROM base
        GROUP BY codigo
      ),
      hist_sem AS (
        SELECT
          codigo,
          COUNT(*) AS semanas_con_venta,
          AVG(unidades_semana) AS prom_semana_con_venta,
          MAX(unidades_semana) AS max_semana,
          AVG(facturacion_semana) AS prom_fact_semana_con_venta,
          MAX(facturacion_semana) AS max_fact_semana
        FROM semanal
        WHERE unidades_semana > 0
        GROUP BY codigo
      ),
      hist_mes AS (
        SELECT
          codigo,
          COUNT(*) AS meses_con_venta,
          AVG(unidades_mes) AS prom_mes_con_venta,
          MAX(unidades_mes) AS max_mes,
          AVG(facturacion_mes) AS prom_fact_mes_con_venta,
          MAX(facturacion_mes) AS max_fact_mes
        FROM mensual
        WHERE unidades_mes > 0
        GROUP BY codigo
      )
      SELECT
        u.codigo,
        u.descripcion,
        COALESCE(u.vs,0) AS vs,
        COALESCE(u.vq,0) AS vq,
        COALESCE(u.vm,0) AS vm,
        COALESCE(u.v90,0) AS v90,
        COALESCE(hs.prom_semana_con_venta,0) AS vh,
        COALESCE(hs.max_semana,0) AS max_semana,
        COALESCE(hm.prom_mes_con_venta,0) AS prom_mes_activo,
        COALESCE(hm.max_mes,0) AS max_mes,
        COALESCE(hs.semanas_con_venta,0) AS semanas_con_venta,
        COALESCE(hm.meses_con_venta,0) AS meses_con_venta,
        COALESCE(u.unidades_total,0) AS unidades_total,
        COALESCE(u.facturacion_total,0) AS facturacion_total,
        COALESCE(u.costo_total,0) AS costo_total,
        COALESCE(u.tickets_total,0) AS tickets_total,
        u.primera_venta,
        u.ultima_venta
      FROM ultimos u
      LEFT JOIN hist_sem hs ON hs.codigo = u.codigo
      LEFT JOIN hist_mes hm ON hm.codigo = u.codigo
      ORDER BY u.codigo
    `, params)

    const out = {}
    for (const x of r.rows) {
      out[x.codigo] = {
        descripcion: x.descripcion,
        vs: Number(x.vs || 0),
        vq: Number(x.vq || 0),
        vm: Number(x.vm || 0),
        v90: Number(x.v90 || 0),
        // vh queda como promedio semanal histórico, pero solo de semanas con venta.
        vh: Number(x.vh || 0),
        maxSemana: Number(x.max_semana || 0),
        promMesActivo: Number(x.prom_mes_activo || 0),
        maxMes: Number(x.max_mes || 0),
        semanasConVenta: Number(x.semanas_con_venta || 0),
        mesesConVenta: Number(x.meses_con_venta || 0),
        unidadesTotal: Number(x.unidades_total || 0),
        facturacionTotal: Number(x.facturacion_total || 0),
        costoTotal: Number(x.costo_total || 0),
        ticketsTotal: Number(x.tickets_total || 0),
        primeraVenta: x.primera_venta,
        ultimaVenta: x.ultima_venta,
      }
    }
    res.json(out)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/articulos/:codigo', async (req, res) => {
  try {
    const base = `codigo=$1 AND tipo_comprob IN ('FCB','FCA','RE')`
    const { where, params } = buildWhere(base, req.query)
    const allParams = [req.params.codigo, ...params]
    const [resumen, porSucursal, porMes] = await Promise.all([
      pool.query(`SELECT codigo, descripcion, SUM(cantidad) as unidades_total, SUM(subtotal_neto) as facturacion_total, SUM(costo*cantidad) as costo_total, AVG(precio_unitario) as precio_promedio, AVG(costo) as costo_promedio, MIN(fecha::text) as primera_venta, MAX(fecha::text) as ultima_venta, COUNT(DISTINCT sucursal) as n_sucursales FROM ventas_lineas WHERE ${where} GROUP BY codigo, descripcion`, allParams),
      pool.query(`SELECT sucursal, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion FROM ventas_lineas WHERE ${where} GROUP BY sucursal ORDER BY unidades DESC`, allParams),
      pool.query(`SELECT TO_CHAR(fecha,'YYYY-MM') as mes, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion FROM ventas_lineas WHERE ${where} GROUP BY mes ORDER BY mes`, allParams)
    ])
    res.json({ resumen: resumen.rows[0] || null, porSucursal: porSucursal.rows, porMes: porMes.rows })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/finanzas/resumen', async (req, res) => {
  try {
    const { where: wl, params: pl } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const { where: wc, params: pc } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const [iva, tipos, margen, dist] = await Promise.all([
      pool.query(`SELECT alicuota_iva, SUM(subtotal_neto) as base, SUM(subtotal_neto*alicuota_iva/100) as iva FROM ventas_lineas WHERE ${wl} GROUP BY alicuota_iva`, pl),
      pool.query(`SELECT tipo_comprob, COUNT(*) as n, SUM(total) as total FROM comprobantes WHERE ${wc} GROUP BY tipo_comprob`, pc),
      pool.query(`SELECT TO_CHAR(fecha,'YYYY-MM') as mes, SUM(subtotal_neto) as venta_neta, SUM(costo*cantidad) as costo, ROUND((SUM(subtotal_neto)-SUM(costo*cantidad))/NULLIF(SUM(subtotal_neto),0)*100,1) as margen_pct FROM ventas_lineas WHERE ${wl} GROUP BY mes ORDER BY mes`, pl),
      pool.query(`SELECT alicuota_iva, COUNT(*) as n_lineas, SUM(cantidad) as unidades FROM ventas_lineas WHERE ${wl} GROUP BY alicuota_iva ORDER BY alicuota_iva`, pl)
    ])
    res.json({ ivaPorAlicuota: iva.rows, porTipoComp: tipos.rows, margenPorMes: margen.rows, distribucionIVA: dist.rows })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/uploads', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM uploads_log ORDER BY id DESC LIMIT 50')).rows) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/uploads/:id', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM ventas_lineas WHERE upload_id=$1', [req.params.id])
    await client.query('DELETE FROM comprobantes WHERE upload_id=$1', [req.params.id])
    await client.query('DELETE FROM uploads_log WHERE id=$1', [req.params.id])
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
  } finally { client.release() }
})

app.get('/api/sucursales', async (req, res) => {
  try { res.json((await pool.query('SELECT DISTINCT sucursal FROM comprobantes WHERE sucursal IS NOT NULL ORDER BY sucursal')).rows.map(r => r.sucursal)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/fechas-rango', async (req, res) => {
  try {
    const r = await pool.query('SELECT MIN(fecha::text) as desde, MAX(fecha::text) as hasta FROM comprobantes')
    res.json(r.rows[0] || { desde: null, hasta: null })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── API: Export ventas agrupadas (para sincronización con Sistema) ───────────
// Devuelve ventas_lineas agregadas por (fecha, codigo, sucursal) para un rango.
// Formato compatible con ventas_diarias del Sistema principal.
app.get('/api/export/ventas-grouped', async (req, res) => {
  try {
    const { desde, hasta } = req.query
    if (!desde || !hasta) return res.status(400).json({ error: '"desde" y "hasta" son requeridos (YYYY-MM-DD)' })
    const r = await pool.query(`
      SELECT
        TO_CHAR(fecha, 'YYYY-MM-DD')   AS fecha,
        codigo                          AS "artCod",
        MAX(descripcion)                AS "artDesc",
        sucursal,
        ROUND(SUM(cantidad)::numeric, 4)              AS "ventaUnit",
        0                                             AS "ventaCombo",
        ROUND(SUM(subtotal_neto)::numeric, 2)         AS "ventaTotal",
        ROUND(SUM(costo * cantidad)::numeric, 2)      AS "costoTotal"
      FROM ventas_lineas
      WHERE tipo_comprob IN ('FCB','FCA','RE')
        AND fecha >= $1::date AND fecha <= $2::date
        AND codigo IS NOT NULL AND codigo <> ''
      GROUP BY fecha, codigo, sucursal
      ORDER BY fecha, codigo, sucursal
    `, [desde, hasta])
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── API: Estado de datos (fechas disponibles) ────────────────────────────────
app.get('/api/export/status', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        MIN(fecha::text) AS desde,
        MAX(fecha::text) AS hasta,
        COUNT(DISTINCT fecha) AS dias,
        COUNT(DISTINCT nro_comprobante) AS comprobantes,
        COUNT(*) AS lineas,
        COUNT(DISTINCT sucursal) AS sucursales,
        jsonb_agg(DISTINCT sucursal ORDER BY sucursal) AS lista_sucursales
      FROM ventas_lineas
      WHERE tipo_comprob IN ('FCB','FCA','RE')
    `)
    res.json(r.rows[0] || {})
  } catch (err) { res.status(500).json({ error: err.message }) }
})

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')))
}

initDB().then(() => {
  app.listen(PORT, () => console.log(`Delmy Analytics running on port ${PORT}`))
}).catch(err => { console.error('DB init failed:', err); process.exit(1) })
