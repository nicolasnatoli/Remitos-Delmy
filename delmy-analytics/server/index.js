const express = require('express')
const cors = require('cors')
const compression = require('compression')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')

const app = express()
const PORT = process.env.PORT || 3001

// ─── Database Setup (sql.js — pure JS, no native compilation) ────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/analytics.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

let db
let SQL

async function initDB() {
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`PRAGMA foreign_keys = ON`)

  db.run(`
    CREATE TABLE IF NOT EXISTS comprobantes (
      nro_comprobante TEXT PRIMARY KEY,
      id_transaccion  INTEGER,
      id_operacion    INTEGER,
      id_sucursal     INTEGER,
      sucursal        TEXT,
      fecha           TEXT,
      fecha_carga     TEXT,
      tipo_comprob    TEXT,
      tipo_cliente    TEXT,
      razon_social    TEXT,
      cond_iva        TEXT,
      cond_venta      TEXT,
      lista_precios   TEXT,
      subtotal        REAL,
      neto_gravado    REAL,
      iva_105         REAL,
      iva_21          REAL,
      total           REAL,
      moneda          TEXT,
      usuario         TEXT,
      upload_id       INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS ventas_lineas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nro_comprobante TEXT,
      id_operacion    INTEGER,
      id_fila         INTEGER,
      sucursal        TEXT,
      fecha           TEXT,
      tipo_comprob    TEXT,
      id_articulo     INTEGER,
      codigo          TEXT,
      descripcion     TEXT,
      costo           REAL,
      cantidad        REAL,
      precio_unitario REAL,
      descuento       REAL,
      subtotal_neto   REAL,
      alicuota_iva    REAL,
      subtotal_det    REAL,
      upload_id       INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS uploads_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      filename      TEXT,
      fecha_desde   TEXT,
      fecha_hasta   TEXT,
      sucursales    TEXT,
      n_encabezados INTEGER,
      n_detalles    INTEGER,
      n_insertados  INTEGER,
      n_actualizados INTEGER,
      uploaded_at   TEXT DEFAULT (datetime('now','localtime')),
      status        TEXT
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_vl_fecha ON ventas_lineas(fecha)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_vl_sucursal ON ventas_lineas(sucursal)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_vl_codigo ON ventas_lineas(codigo)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_vl_comp ON ventas_lineas(nro_comprobante)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_comp_fecha ON comprobantes(fecha)`)

  saveDB()
  console.log(`DB ready: ${DB_PATH}`)
}

function saveDB() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

// Helper: run query and return rows as array of objects
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    return rows
  } catch (e) {
    console.error('Query error:', sql, e.message)
    throw e
  }
}

function queryOne(sql, params = []) {
  const rows = query(sql, params)
  return rows[0] || null
}

function run(sql, params = []) {
  db.run(sql, params)
}

// ─── Parser de planillas ──────────────────────────────────────────────────────
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
    const parseDate = (v) => { if (!v) return null; const s = String(v).trim(); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; return s.substring(0, 10) }

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

// ─── API: Upload ──────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

    const { encabezados, detalles } = parsePlanillaVentas(req.file.buffer)
    if (encabezados.length === 0) return res.status(400).json({ error: 'No se encontraron encabezados' })

    const fechas = encabezados.map(e => e.fecha).filter(Boolean).sort()
    const sucursales = [...new Set(encabezados.map(e => e.sucursal).filter(Boolean))]
    const fechaDesde = fechas[0] || null
    const fechaHasta = fechas[fechas.length - 1] || null

    run(`INSERT INTO uploads_log (filename, fecha_desde, fecha_hasta, sucursales, n_encabezados, n_detalles, n_insertados, n_actualizados, status) VALUES (?,?,?,?,?,?,0,0,'procesando')`,
      [req.file.originalname, fechaDesde, fechaHasta, sucursales.join(', '), encabezados.length, detalles.length])

    const uploadId = queryOne('SELECT last_insert_rowid() as id').id

    let insertados = 0, actualizados = 0

    const existingSet = new Set(
      query(`SELECT nro_comprobante FROM comprobantes WHERE nro_comprobante IN (${encabezados.map(() => '?').join(',')})`,
        encabezados.map(e => e.nro_comprobante)).map(r => r.nro_comprobante)
    )

    for (const enc of encabezados) {
      if (existingSet.has(enc.nro_comprobante)) {
        actualizados++
        run(`UPDATE comprobantes SET subtotal=?,neto_gravado=?,iva_105=?,iva_21=?,total=?,upload_id=? WHERE nro_comprobante=?`,
          [enc.subtotal, enc.neto_gravado, enc.iva_105, enc.iva_21, enc.total, uploadId, enc.nro_comprobante])
      } else {
        insertados++
        run(`INSERT INTO comprobantes (nro_comprobante,id_transaccion,id_operacion,id_sucursal,sucursal,fecha,fecha_carga,tipo_comprob,tipo_cliente,razon_social,cond_iva,cond_venta,lista_precios,subtotal,neto_gravado,iva_105,iva_21,total,moneda,usuario,upload_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [enc.nro_comprobante,enc.id_transaccion,enc.id_operacion,enc.id_sucursal,enc.sucursal,enc.fecha,enc.fecha_carga,enc.tipo_comprob,enc.tipo_cliente,enc.razon_social,enc.cond_iva,enc.cond_venta,enc.lista_precios,enc.subtotal,enc.neto_gravado,enc.iva_105,enc.iva_21,enc.total,enc.moneda,enc.usuario,uploadId])
      }
    }

    // Group detalles by comprobante
    const byComp = {}
    for (const d of detalles) {
      if (!byComp[d.nro_comprobante]) byComp[d.nro_comprobante] = []
      byComp[d.nro_comprobante].push(d)
    }
    for (const [nro, lineas] of Object.entries(byComp)) {
      run(`DELETE FROM ventas_lineas WHERE nro_comprobante=?`, [nro])
      for (const l of lineas) {
        run(`INSERT INTO ventas_lineas (nro_comprobante,id_operacion,id_fila,sucursal,fecha,tipo_comprob,id_articulo,codigo,descripcion,costo,cantidad,precio_unitario,descuento,subtotal_neto,alicuota_iva,subtotal_det,upload_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [l.nro_comprobante,l.id_operacion,l.id_fila,l.sucursal,l.fecha,l.tipo_comprob,l.id_articulo,l.codigo,l.descripcion,l.costo,l.cantidad,l.precio_unitario,l.descuento,l.subtotal_neto,l.alicuota_iva,l.subtotal_det,uploadId])
      }
    }

    run(`UPDATE uploads_log SET n_insertados=?,n_actualizados=?,status='ok' WHERE id=?`, [insertados, actualizados, uploadId])
    saveDB()

    res.json({ ok: true, uploadId, encabezados: encabezados.length, detalles: detalles.length, insertados, actualizados, fechaDesde, fechaHasta, sucursales })
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Helper para filtros WHERE ────────────────────────────────────────────────
function buildWhere(base, filters, tablePrefix = '') {
  const parts = [base]
  const params = []
  const p = filters || {}
  const col = tablePrefix ? tablePrefix + '.' : ''
  if (p.desde) { parts.push(`${col}fecha >= ?`); params.push(p.desde) }
  if (p.hasta) { parts.push(`${col}fecha <= ?`); params.push(p.hasta) }
  if (p.sucursal && p.sucursal !== 'todas') { parts.push(`${col}sucursal = ?`); params.push(p.sucursal) }
  return { where: parts.join(' AND '), params }
}

// ─── API: KPIs ────────────────────────────────────────────────────────────────
app.get('/api/kpis', (req, res) => {
  try {
    const f = req.query
    const { where: wc, params: pc } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, f)
    const { where: wn, params: pn } = buildWhere(`tipo_comprob IN ('NC','NCB')`, f)
    const { where: wl, params: pl } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, f)

    const t = queryOne(`SELECT COUNT(*) as n_comp, SUM(total) as facturacion, SUM(neto_gravado) as neto, SUM(iva_21) as iva21, SUM(iva_105) as iva105, AVG(total) as ticket, COUNT(DISTINCT fecha) as dias FROM comprobantes WHERE ${wc}`, pc)
    const nc = queryOne(`SELECT COUNT(*) as n_nc, SUM(total) as total_nc FROM comprobantes WHERE ${wn}`, pn)
    const l = queryOne(`SELECT COUNT(*) as n_lin, SUM(cantidad) as unidades, COUNT(DISTINCT codigo) as arts, SUM(costo*cantidad) as costo, SUM(subtotal_neto) as venta_neta FROM ventas_lineas WHERE ${wl}`, pl)

    const facturacion = (t?.facturacion || 0) - (nc?.total_nc || 0)
    const venta_neta = l?.venta_neta || 0
    const costo = l?.costo || 0
    const margen = venta_neta > 0 ? Math.round(((venta_neta - costo) / venta_neta) * 1000) / 10 : 0

    res.json({
      n_comprobantes: t?.n_comp || 0, facturacion_bruta: t?.facturacion || 0,
      facturacion_neta: facturacion, neto_gravado: t?.neto || 0,
      iva_total: (t?.iva21 || 0) + (t?.iva105 || 0), ticket_promedio: t?.ticket || 0,
      dias_con_venta: t?.dias || 0, n_nc: nc?.n_nc || 0, total_nc: nc?.total_nc || 0,
      n_lineas: l?.n_lin || 0, unidades_vendidas: l?.unidades || 0,
      articulos_distintos: l?.arts || 0, costo_total: costo, venta_neta,
      margen_bruto_pct: margen,
      lineas_por_comprobante: t?.n_comp > 0 ? Math.round((l?.n_lin / t?.n_comp) * 10) / 10 : 0
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-dia', (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    res.json(query(`SELECT fecha, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY fecha ORDER BY fecha`, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-sucursal', (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { desde: req.query.desde, hasta: req.query.hasta })
    res.json(query(`SELECT sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY sucursal ORDER BY total DESC`, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/ventas/por-mes', (req, res) => {
  try {
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, { sucursal: req.query.sucursal })
    res.json(query(`SELECT substr(fecha,1,7) as mes, sucursal, COUNT(*) as n_ventas, SUM(total) as total, AVG(total) as ticket_promedio FROM comprobantes WHERE ${where} GROUP BY mes, sucursal ORDER BY mes, sucursal`, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/articulos/ranking', (req, res) => {
  try {
    const { orderBy = 'facturacion', limit = 100 } = req.query
    const { where, params } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const orderMap = { facturacion: 'facturacion DESC', unidades: 'unidades DESC', transacciones: 'n_transacciones DESC', margen: 'margen_pct DESC' }
    const order = orderMap[orderBy] || 'facturacion DESC'
    res.json(query(`SELECT codigo, descripcion, COUNT(*) as n_transacciones, SUM(cantidad) as unidades, AVG(precio_unitario) as precio_promedio, AVG(costo) as costo_promedio, SUM(subtotal_neto) as facturacion, SUM(costo*cantidad) as costo_total, ROUND((SUM(subtotal_neto)-SUM(costo*cantidad))/MAX(SUM(subtotal_neto),0.001)*100,1) as margen_pct, COUNT(DISTINCT sucursal) as n_sucursales FROM ventas_lineas WHERE ${where} GROUP BY codigo ORDER BY ${order} LIMIT ?`, [...params, parseInt(limit)]))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/articulos/:codigo', (req, res) => {
  try {
    const { where, params } = buildWhere(`codigo=? AND tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const allParams = [req.params.codigo, ...params]
    const resumen = queryOne(`SELECT codigo, descripcion, SUM(cantidad) as unidades_total, SUM(subtotal_neto) as facturacion_total, SUM(costo*cantidad) as costo_total, AVG(precio_unitario) as precio_promedio, AVG(costo) as costo_promedio, MIN(fecha) as primera_venta, MAX(fecha) as ultima_venta, COUNT(DISTINCT sucursal) as n_sucursales FROM ventas_lineas WHERE ${where}`, allParams)
    const porSucursal = query(`SELECT sucursal, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion FROM ventas_lineas WHERE ${where} GROUP BY sucursal ORDER BY unidades DESC`, allParams)
    const porMes = query(`SELECT substr(fecha,1,7) as mes, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion FROM ventas_lineas WHERE ${where} GROUP BY mes ORDER BY mes`, allParams)
    res.json({ resumen, porSucursal, porMes })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/finanzas/resumen', (req, res) => {
  try {
    const { where: wl, params: pl } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const { where: wc, params: pc } = buildWhere(`tipo_comprob IN ('FCB','FCA','RE')`, req.query)
    const ivaPorAlicuota = query(`SELECT alicuota_iva, SUM(subtotal_neto) as base, SUM(subtotal_neto*alicuota_iva/100) as iva FROM ventas_lineas WHERE ${wl} GROUP BY alicuota_iva`, pl)
    const porTipoComp = query(`SELECT tipo_comprob, COUNT(*) as n, SUM(total) as total FROM comprobantes WHERE ${wc} GROUP BY tipo_comprob`, pc)
    const margenPorMes = query(`SELECT substr(fecha,1,7) as mes, SUM(subtotal_neto) as venta_neta, SUM(costo*cantidad) as costo, ROUND((SUM(subtotal_neto)-SUM(costo*cantidad))/MAX(SUM(subtotal_neto),0.001)*100,1) as margen_pct FROM ventas_lineas WHERE ${wl} GROUP BY mes ORDER BY mes`, pl)
    const distribucionIVA = query(`SELECT alicuota_iva, COUNT(*) as n_lineas, SUM(cantidad) as unidades FROM ventas_lineas WHERE ${wl} GROUP BY alicuota_iva ORDER BY alicuota_iva`, pl)
    res.json({ ivaPorAlicuota, porTipoComp, margenPorMes, distribucionIVA })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/uploads', (req, res) => {
  try { res.json(query('SELECT * FROM uploads_log ORDER BY id DESC LIMIT 50')) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/uploads/:id', (req, res) => {
  try {
    run('DELETE FROM ventas_lineas WHERE upload_id=?', [req.params.id])
    run('DELETE FROM comprobantes WHERE upload_id=?', [req.params.id])
    run('DELETE FROM uploads_log WHERE id=?', [req.params.id])
    saveDB()
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/sucursales', (req, res) => {
  try { res.json(query('SELECT DISTINCT sucursal FROM comprobantes WHERE sucursal IS NOT NULL ORDER BY sucursal').map(r => r.sucursal)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/fechas-rango', (req, res) => {
  try { res.json(queryOne('SELECT MIN(fecha) as desde, MAX(fecha) as hasta FROM comprobantes') || { desde: null, hasta: null }) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')))
}

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Delmy Analytics server running on port ${PORT}`)
    console.log(`DB: ${DB_PATH}`)
  })
}).catch(err => {
  console.error('Failed to init DB:', err)
  process.exit(1)
})
