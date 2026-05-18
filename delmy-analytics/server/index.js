const express = require('express')
const cors = require('cors')
const compression = require('compression')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
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
        uploaded_at    TIMESTAMP DEFAULT NOW(),
        status         TEXT
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_fecha     ON ventas_lineas(fecha)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_sucursal  ON ventas_lineas(sucursal)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_codigo    ON ventas_lineas(codigo)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_comp      ON ventas_lineas(nro_comprobante)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vl_tipo      ON ventas_lineas(tipo_comprob)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comp_fecha   ON comprobantes(fecha)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comp_tipo    ON comprobantes(tipo_comprob)`)
    console.log('DB ready')
  } finally {
    client.release()
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
function parsePlanillaVentas(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let headerRow = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (raw[i] && raw[i].some(c => c === 'Referencia')) { headerRow = i; break }
  }
  if (headerRow === -1) throw new Error('No se encontró fila de encabezados')

  const headers = raw[headerRow]
  const idx = {}
  headers.forEach((h, i) => { if (h) idx[h] = i })

  const encabezados = [], detalles = []

  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r]
    if (!row || !row[idx['Referencia']]) continue
    const tipo = String(row[idx['Referencia']]).trim()

    const get = (col) => { const v = idx[col] !== undefined ? row[idx[col]] : null; return (v === null || v === undefined || v === '-') ? null : v }
    const getNum = (col) => { const v = get(col); if (v === null) return 0; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }
    const getStr = (col) => { const v = get(col); return v === null ? null : String(v).trim() }
    const parseDate = (v) => {
      if (!v) return null
      const s = String(v).trim()
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m) return `${m[3]}-${m[2]}-${m[1]}`
      return s.substring(0, 10)
    }

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
  return { encabezados, detalles }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors())
app.use(compression())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')))
}

// ─── Upload ───────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const client = await pool.connect()
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

    const { encabezados, detalles } = parsePlanillaVentas(req.file.buffer)
    if (encabezados.length === 0) return res.status(400).json({ error: 'No se encontraron encabezados' })

    const fechas = encabezados.map(e => e.fecha).filter(Boolean).sort()
    const sucursales = [...new Set(encabezados.map(e => e.sucursal).filter(Boolean))]
    const fechaDesde = fechas[0] || null
    const fechaHasta = fechas[fechas.length - 1] || null

    const logRes = await client.query(
      `INSERT INTO uploads_log (filename, fecha_desde, fecha_hasta, sucursales, n_encabezados, n_detalles, status) VALUES ($1,$2,$3,$4,$5,$6,'procesando') RETURNING id`,
      [req.file.originalname, fechaDesde, fechaHasta, sucursales.join(', '), encabezados.length, detalles.length]
    )
    const uploadId = logRes.rows[0].id

    await client.query('BEGIN')

    let insertados = 0, actualizados = 0

    // Upsert comprobantes in batches
    for (const enc of encabezados) {
      const r = await client.query(
        `INSERT INTO comprobantes (nro_comprobante,id_transaccion,id_operacion,id_sucursal,sucursal,fecha,fecha_carga,tipo_comprob,tipo_cliente,razon_social,cond_iva,cond_venta,lista_precios,subtotal,neto_gravado,iva_105,iva_21,total,moneda,usuario,upload_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (nro_comprobante) DO UPDATE SET subtotal=EXCLUDED.subtotal,neto_gravado=EXCLUDED.neto_gravado,iva_105=EXCLUDED.iva_105,iva_21=EXCLUDED.iva_21,total=EXCLUDED.total,upload_id=EXCLUDED.upload_id
         RETURNING (xmax = 0) AS inserted`,
        [enc.nro_comprobante,enc.id_transaccion,enc.id_operacion,enc.id_sucursal,enc.sucursal,enc.fecha,enc.fecha_carga,enc.tipo_comprob,enc.tipo_cliente,enc.razon_social,enc.cond_iva,enc.cond_venta,enc.lista_precios,enc.subtotal,enc.neto_gravado,enc.iva_105,enc.iva_21,enc.total,enc.moneda,enc.usuario,uploadId]
      )
      if (r.rows[0].inserted) insertados++; else actualizados++
    }

    // Delete+reinsert detalles by comprobante
    const compNros = [...new Set(detalles.map(d => d.nro_comprobante))]
    if (compNros.length > 0) {
      await client.query(`DELETE FROM ventas_lineas WHERE nro_comprobante = ANY($1)`, [compNros])
    }

    // Batch insert detalles (chunks of 500)
    const chunkSize = 500
    for (let i = 0; i < detalles.length; i += chunkSize) {
      const chunk = detalles.slice(i, i + chunkSize)
      const values = []
      const params = []
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
    await client.query(`UPDATE uploads_log SET n_insertados=$1,n_actualizados=$2,status='ok' WHERE id=$3`, [insertados, actualizados, uploadId])

    res.json({ ok: true, uploadId, encabezados: encabezados.length, detalles: detalles.length, insertados, actualizados, fechaDesde, fechaHasta, sucursales })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Upload error:', err)
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildWhere(base, q, col = '') {
  const parts = [base], params = []
  let n = params.length + 1
  const c = col ? col + '.' : ''
  if (q?.desde) { parts.push(`${c}fecha >= $${n++}`); params.push(q.desde) }
  if (q?.hasta) { parts.push(`${c}fecha <= $${n++}`); params.push(q.hasta) }
  if (q?.sucursal && q.sucursal !== 'todas') { parts.push(`${c}sucursal = $${n++}`); params.push(q.sucursal) }
  return { where: parts.join(' AND '), params }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
app.get('/api/kpis', async (req, res) => {
  try {
    const { where: wc, params: pc } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const { where: wn, params: pn } = buildWhere(`tipo_comprob IN ('NC','NCB')`, req.query)
    const { where: wl, params: pl } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)

    const [t, nc, l] = await Promise.all([
      pool.query(`SELECT COUNT(*) as n_comp, SUM(total) as facturacion, SUM(neto_gravado) as neto, SUM(iva_21) as iva21, SUM(iva_105) as iva105, AVG(total) as ticket, COUNT(DISTINCT fecha) as dias FROM comprobantes WHERE ${wc}`, pc),
      pool.query(`SELECT COUNT(*) as n_nc, SUM(total) as total_nc FROM comprobantes WHERE ${wn}`, pn),
      pool.query(`SELECT COUNT(*) as n_lin, SUM(cantidad) as unidades, COUNT(DISTINCT codigo) as arts, SUM(costo*cantidad) as costo, SUM(subtotal_neto) as venta_neta FROM ventas_lineas WHERE ${wl}`, pl)
    ])

    const tv = t.rows[0], nv = nc.rows[0], lv = l.rows[0]
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
      lineas_por_comprobante: tv.n_comp > 0 ? Math.round((lv.n_lin / tv.n_comp) * 10) / 10 : 0
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
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { desde: req.query.desde, hasta: req.query.hasta })
    const r = await pool.query(`SELECT sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY sucursal ORDER BY total DESC`, params)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-mes', async (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { sucursal: req.query.sucursal })
    const r = await pool.query(`SELECT TO_CHAR(fecha,'YYYY-MM') as mes, sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY mes, sucursal ORDER BY mes, sucursal`, params)
    res.json(r.rows)
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

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')))
}

initDB().then(() => {
  app.listen(PORT, () => console.log(`Delmy Analytics running on port ${PORT}`))
}).catch(err => { console.error('DB init failed:', err); process.exit(1) })
