const express = require('express')
const cors = require('cors')
const compression = require('compression')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const Database = require('better-sqlite3')

const app = express()
const PORT = process.env.PORT || 3001

// ─── Database Setup ──────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/analytics.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
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
  );

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
    upload_id       INTEGER,
    FOREIGN KEY (nro_comprobante) REFERENCES comprobantes(nro_comprobante)
  );

  CREATE TABLE IF NOT EXISTS uploads_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filename     TEXT,
    fecha_desde  TEXT,
    fecha_hasta  TEXT,
    sucursales   TEXT,
    n_encabezados INTEGER,
    n_detalles   INTEGER,
    n_insertados INTEGER,
    n_actualizados INTEGER,
    uploaded_at  TEXT DEFAULT (datetime('now','localtime')),
    status       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_vl_fecha     ON ventas_lineas(fecha);
  CREATE INDEX IF NOT EXISTS idx_vl_sucursal  ON ventas_lineas(sucursal);
  CREATE INDEX IF NOT EXISTS idx_vl_codigo    ON ventas_lineas(codigo);
  CREATE INDEX IF NOT EXISTS idx_vl_comprobante ON ventas_lineas(nro_comprobante);
  CREATE INDEX IF NOT EXISTS idx_comp_fecha   ON comprobantes(fecha);
  CREATE INDEX IF NOT EXISTS idx_comp_tipo    ON comprobantes(tipo_comprob);
`)

// ─── Parser de planillas ──────────────────────────────────────────────────────
function parsePlanillaVentas(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Find header row (contains "Referencia")
  let headerRow = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (raw[i] && raw[i].some(c => c === 'Referencia')) {
      headerRow = i
      break
    }
  }
  if (headerRow === -1) throw new Error('No se encontró fila de encabezados (columna "Referencia")')

  const headers = raw[headerRow]
  const idx = {}
  headers.forEach((h, i) => { if (h) idx[h] = i })

  const required = ['Referencia', 'Sucursal', 'Fecha de comprobante', 'Nro. comprobante']
  for (const r of required) {
    if (idx[r] === undefined) throw new Error(`Columna requerida no encontrada: ${r}`)
  }

  const encabezados = []
  const detalles = []

  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r]
    if (!row || !row[idx['Referencia']]) continue
    const tipo = String(row[idx['Referencia']]).trim()

    const get = (col) => {
      const v = idx[col] !== undefined ? row[idx[col]] : null
      return (v === null || v === undefined || v === '-') ? null : v
    }
    const getNum = (col) => {
      const v = get(col)
      if (v === null) return 0
      const n = parseFloat(String(v).replace(',', '.'))
      return isNaN(n) ? 0 : n
    }
    const getStr = (col) => {
      const v = get(col)
      return v === null ? null : String(v).trim()
    }

    // Normalize date dd/mm/yyyy -> yyyy-mm-dd
    const parseDate = (v) => {
      if (!v) return null
      const s = String(v).trim()
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m) return `${m[3]}-${m[2]}-${m[1]}`
      return s.substring(0, 10)
    }

    if (tipo === 'Encabezado') {
      encabezados.push({
        nro_comprobante: getStr('Nro. comprobante'),
        id_transaccion:  getNum('ID transacción'),
        id_operacion:    getNum('ID operación'),
        id_sucursal:     getNum('ID sucursal'),
        sucursal:        getStr('Sucursal'),
        fecha:           parseDate(get('Fecha de comprobante')),
        fecha_carga:     getStr('Fecha de carga'),
        tipo_comprob:    getStr('Tipo comprob.'),
        tipo_cliente:    getStr('Tipo de cliente'),
        razon_social:    getStr('Razón social'),
        cond_iva:        getStr('Cond. IVA'),
        cond_venta:      getStr('Condición de venta'),
        lista_precios:   getStr('Lista de precios'),
        subtotal:        getNum('Subtotal comprobante'),
        neto_gravado:    getNum('Neto gravado comprobante'),
        iva_105:         getNum('IVA 10.5'),
        iva_21:          getNum('IVA 21'),
        total:           getNum('Total comprobante'),
        moneda:          getStr('Moneda'),
        usuario:         getStr('Usuario'),
      })
    } else if (tipo === 'Detalle') {
      const codigo = getStr('Código')
      if (!codigo) continue
      detalles.push({
        nro_comprobante: getStr('Nro. comprobante'),
        id_operacion:    getNum('ID operación'),
        id_fila:         getNum('ID de fila'),
        sucursal:        getStr('Sucursal'),
        fecha:           parseDate(get('Fecha de comprobante')),
        tipo_comprob:    getStr('Tipo comprob.'),
        id_articulo:     getNum('ID artículo'),
        codigo:          codigo,
        descripcion:     getStr('Descripción'),
        costo:           getNum('Costo'),
        cantidad:        getNum('Cantidad'),
        precio_unitario: getNum('Precio unitario'),
        descuento:       getNum('Descuento unitario'),
        subtotal_neto:   getNum('Subtotal neto gravado'),
        alicuota_iva:    getNum('Alicuota IVA'),
        subtotal_det:    getNum('Subtotal detalles'),
      })
    }
  }

  return { encabezados, detalles }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors())
app.use(compression())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

// Serve built frontend
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')))
}

// ─── API: Upload planilla ─────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

    const { encabezados, detalles } = parsePlanillaVentas(req.file.buffer)

    if (encabezados.length === 0) return res.status(400).json({ error: 'No se encontraron encabezados en la planilla' })

    // Get date range and sucursales from data
    const fechas = encabezados.map(e => e.fecha).filter(Boolean).sort()
    const sucursales = [...new Set(encabezados.map(e => e.sucursal).filter(Boolean))]
    const fechaDesde = fechas[0] || null
    const fechaHasta = fechas[fechas.length - 1] || null

    // Register upload
    const uploadInfo = db.prepare(`
      INSERT INTO uploads_log (filename, fecha_desde, fecha_hasta, sucursales, n_encabezados, n_detalles, n_insertados, n_actualizados, status)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'procesando')
    `).run(req.file.originalname, fechaDesde, fechaHasta, sucursales.join(', '), encabezados.length, detalles.length)

    const uploadId = uploadInfo.lastInsertRowid

    // Upsert comprobantes
    const upsertComp = db.prepare(`
      INSERT INTO comprobantes (nro_comprobante, id_transaccion, id_operacion, id_sucursal, sucursal, fecha, fecha_carga,
        tipo_comprob, tipo_cliente, razon_social, cond_iva, cond_venta, lista_precios,
        subtotal, neto_gravado, iva_105, iva_21, total, moneda, usuario, upload_id)
      VALUES (@nro_comprobante, @id_transaccion, @id_operacion, @id_sucursal, @sucursal, @fecha, @fecha_carga,
        @tipo_comprob, @tipo_cliente, @razon_social, @cond_iva, @cond_venta, @lista_precios,
        @subtotal, @neto_gravado, @iva_105, @iva_21, @total, @moneda, @usuario, @upload_id)
      ON CONFLICT(nro_comprobante) DO UPDATE SET
        subtotal=excluded.subtotal, neto_gravado=excluded.neto_gravado,
        iva_105=excluded.iva_105, iva_21=excluded.iva_21, total=excluded.total,
        upload_id=excluded.upload_id
    `)

    // For detalles: delete existing and reinsert (idempotent by comprobante)
    const deleteLineas = db.prepare('DELETE FROM ventas_lineas WHERE nro_comprobante = ?')
    const insertLinea = db.prepare(`
      INSERT INTO ventas_lineas (nro_comprobante, id_operacion, id_fila, sucursal, fecha, tipo_comprob,
        id_articulo, codigo, descripcion, costo, cantidad, precio_unitario, descuento,
        subtotal_neto, alicuota_iva, subtotal_det, upload_id)
      VALUES (@nro_comprobante, @id_operacion, @id_fila, @sucursal, @fecha, @tipo_comprob,
        @id_articulo, @codigo, @descripcion, @costo, @cantidad, @precio_unitario, @descuento,
        @subtotal_neto, @alicuota_iva, @subtotal_det, @upload_id)
    `)

    let insertados = 0, actualizados = 0

    const processAll = db.transaction(() => {
      // Check which comprobantes already exist
      const existentes = new Set(
        db.prepare('SELECT nro_comprobante FROM comprobantes WHERE nro_comprobante IN (' +
          encabezados.map(() => '?').join(',') + ')')
          .all(...encabezados.map(e => e.nro_comprobante))
          .map(r => r.nro_comprobante)
      )

      for (const enc of encabezados) {
        if (existentes.has(enc.nro_comprobante)) actualizados++
        else insertados++
        upsertComp.run({ ...enc, upload_id: uploadId })
      }

      // Group detalles by comprobante for batch delete+insert
      const byComp = {}
      for (const d of detalles) {
        if (!byComp[d.nro_comprobante]) byComp[d.nro_comprobante] = []
        byComp[d.nro_comprobante].push(d)
      }
      for (const [nro, lineas] of Object.entries(byComp)) {
        deleteLineas.run(nro)
        for (const l of lineas) insertLinea.run({ ...l, upload_id: uploadId })
      }
    })

    processAll()

    db.prepare('UPDATE uploads_log SET n_insertados=?, n_actualizados=?, status=? WHERE id=?')
      .run(insertados, actualizados, 'ok', uploadId)

    res.json({
      ok: true, uploadId,
      encabezados: encabezados.length, detalles: detalles.length,
      insertados, actualizados, fechaDesde, fechaHasta, sucursales
    })

  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── API: KPIs generales ──────────────────────────────────────────────────────
app.get('/api/kpis', (req, res) => {
  try {
    const { desde, hasta, sucursal } = req.query

    let whereComp = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const params = []
    if (desde) { whereComp += ' AND fecha >= ?'; params.push(desde) }
    if (hasta) { whereComp += ' AND fecha <= ?'; params.push(hasta) }
    if (sucursal && sucursal !== 'todas') { whereComp += ' AND sucursal = ?'; params.push(sucursal) }

    const totales = db.prepare(`
      SELECT 
        COUNT(*) as n_comprobantes,
        SUM(total) as facturacion_bruta,
        SUM(neto_gravado) as neto_gravado,
        SUM(iva_21) as iva_21,
        SUM(iva_105) as iva_105,
        AVG(total) as ticket_promedio,
        COUNT(DISTINCT fecha) as dias_con_venta
      FROM comprobantes ${whereComp}
    `).get(...params)

    // NC and NCB (notas de credito) - subtract
    let whereNC = "WHERE tipo_comprob IN ('NC','NCB')"
    const paramsNC = []
    if (desde) { whereNC += ' AND fecha >= ?'; paramsNC.push(desde) }
    if (hasta) { whereNC += ' AND fecha <= ?'; paramsNC.push(hasta) }
    if (sucursal && sucursal !== 'todas') { whereNC += ' AND sucursal = ?'; paramsNC.push(sucursal) }

    const nc = db.prepare(`
      SELECT COUNT(*) as n_nc, SUM(total) as total_nc
      FROM comprobantes ${whereNC}
    `).get(...paramsNC)

    // Lineas stats
    let whereL = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const paramsL = []
    if (desde) { whereL += ' AND fecha >= ?'; paramsL.push(desde) }
    if (hasta) { whereL += ' AND fecha <= ?'; paramsL.push(hasta) }
    if (sucursal && sucursal !== 'todas') { whereL += ' AND sucursal = ?'; paramsL.push(sucursal) }

    const lineas = db.prepare(`
      SELECT
        COUNT(*) as n_lineas,
        SUM(cantidad) as unidades_vendidas,
        COUNT(DISTINCT codigo) as articulos_distintos,
        SUM(costo * cantidad) as costo_total,
        SUM(subtotal_neto) as venta_neta
      FROM ventas_lineas ${whereL}
    `).get(...paramsL)

    const facturacion = (totales.facturacion_bruta || 0) - (nc.total_nc || 0)
    const costoTotal = lineas.costo_total || 0
    const ventaNeta = lineas.venta_neta || 0
    const margen = ventaNeta > 0 ? ((ventaNeta - costoTotal) / ventaNeta) * 100 : 0

    res.json({
      n_comprobantes: totales.n_comprobantes || 0,
      facturacion_bruta: totales.facturacion_bruta || 0,
      facturacion_neta: facturacion,
      neto_gravado: totales.neto_gravado || 0,
      iva_total: (totales.iva_21 || 0) + (totales.iva_105 || 0),
      ticket_promedio: totales.ticket_promedio || 0,
      dias_con_venta: totales.dias_con_venta || 0,
      n_nc: nc.n_nc || 0,
      total_nc: nc.total_nc || 0,
      n_lineas: lineas.n_lineas || 0,
      unidades_vendidas: lineas.unidades_vendidas || 0,
      articulos_distintos: lineas.articulos_distintos || 0,
      costo_total: costoTotal,
      venta_neta: ventaNeta,
      margen_bruto_pct: Math.round(margen * 10) / 10,
      lineas_por_comprobante: totales.n_comprobantes > 0
        ? Math.round((lineas.n_lineas / totales.n_comprobantes) * 10) / 10 : 0
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Ventas por día ──────────────────────────────────────────────────────
app.get('/api/ventas/por-dia', (req, res) => {
  try {
    const { desde, hasta, sucursal } = req.query
    let where = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const params = []
    if (desde) { where += ' AND fecha >= ?'; params.push(desde) }
    if (hasta) { where += ' AND fecha <= ?'; params.push(hasta) }
    if (sucursal && sucursal !== 'todas') { where += ' AND sucursal = ?'; params.push(sucursal) }

    const rows = db.prepare(`
      SELECT fecha,
        COUNT(*) as n_ventas,
        SUM(total) as total,
        AVG(total) as ticket_promedio
      FROM comprobantes ${where}
      GROUP BY fecha ORDER BY fecha
    `).all(...params)

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Ventas por sucursal ─────────────────────────────────────────────────
app.get('/api/ventas/por-sucursal', (req, res) => {
  try {
    const { desde, hasta } = req.query
    let where = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const params = []
    if (desde) { where += ' AND fecha >= ?'; params.push(desde) }
    if (hasta) { where += ' AND fecha <= ?'; params.push(hasta) }

    const rows = db.prepare(`
      SELECT sucursal,
        COUNT(*) as n_ventas,
        SUM(total) as total,
        AVG(total) as ticket_promedio
      FROM comprobantes ${where}
      GROUP BY sucursal ORDER BY total DESC
    `).all(...params)

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Ranking artículos ───────────────────────────────────────────────────
app.get('/api/articulos/ranking', (req, res) => {
  try {
    const { desde, hasta, sucursal, limit = 100, orderBy = 'facturacion' } = req.query
    let where = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const params = []
    if (desde) { where += ' AND fecha >= ?'; params.push(desde) }
    if (hasta) { where += ' AND fecha <= ?'; params.push(hasta) }
    if (sucursal && sucursal !== 'todas') { where += ' AND sucursal = ?'; params.push(sucursal) }

    const orderMap = {
      facturacion: 'facturacion DESC',
      unidades: 'unidades DESC',
      transacciones: 'n_transacciones DESC',
      margen: 'margen_pct DESC'
    }
    const order = orderMap[orderBy] || 'facturacion DESC'

    const rows = db.prepare(`
      SELECT 
        codigo,
        descripcion,
        COUNT(*) as n_transacciones,
        SUM(cantidad) as unidades,
        AVG(precio_unitario) as precio_promedio,
        AVG(costo) as costo_promedio,
        SUM(subtotal_neto) as facturacion,
        SUM(costo * cantidad) as costo_total,
        ROUND((SUM(subtotal_neto) - SUM(costo * cantidad)) / NULLIF(SUM(subtotal_neto),0) * 100, 1) as margen_pct,
        COUNT(DISTINCT sucursal) as n_sucursales,
        COUNT(DISTINCT fecha) as dias_con_venta
      FROM ventas_lineas ${where}
      GROUP BY codigo
      ORDER BY ${order}
      LIMIT ?
    `).all(...params, parseInt(limit))

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Artículo detalle ────────────────────────────────────────────────────
app.get('/api/articulos/:codigo', (req, res) => {
  try {
    const { desde, hasta } = req.query
    const { codigo } = req.params
    let where = "WHERE codigo = ? AND tipo_comprob IN ('FCB','FCA','RE')"
    const params = [codigo]
    if (desde) { where += ' AND fecha >= ?'; params.push(desde) }
    if (hasta) { where += ' AND fecha <= ?'; params.push(hasta) }

    const resumen = db.prepare(`
      SELECT codigo, descripcion,
        SUM(cantidad) as unidades_total,
        SUM(subtotal_neto) as facturacion_total,
        SUM(costo * cantidad) as costo_total,
        AVG(precio_unitario) as precio_promedio,
        AVG(costo) as costo_promedio,
        MIN(fecha) as primera_venta,
        MAX(fecha) as ultima_venta,
        COUNT(DISTINCT sucursal) as n_sucursales
      FROM ventas_lineas ${where}
    `).get(...params)

    const porSucursal = db.prepare(`
      SELECT sucursal, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion
      FROM ventas_lineas ${where}
      GROUP BY sucursal ORDER BY unidades DESC
    `).all(...params)

    const porMes = db.prepare(`
      SELECT substr(fecha,1,7) as mes, SUM(cantidad) as unidades, SUM(subtotal_neto) as facturacion
      FROM ventas_lineas ${where}
      GROUP BY mes ORDER BY mes
    `).all(...params)

    res.json({ resumen, porSucursal, porMes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Ventas por mes ──────────────────────────────────────────────────────
app.get('/api/ventas/por-mes', (req, res) => {
  try {
    const { sucursal } = req.query
    let where = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const params = []
    if (sucursal && sucursal !== 'todas') { where += ' AND sucursal = ?'; params.push(sucursal) }

    const rows = db.prepare(`
      SELECT 
        substr(fecha,1,7) as mes,
        sucursal,
        COUNT(*) as n_ventas,
        SUM(total) as total,
        AVG(total) as ticket_promedio
      FROM comprobantes ${where}
      GROUP BY mes, sucursal ORDER BY mes, sucursal
    `).all(...params)

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Métricas financieras ────────────────────────────────────────────────
app.get('/api/finanzas/resumen', (req, res) => {
  try {
    const { desde, hasta, sucursal } = req.query
    let whereL = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    let whereC = "WHERE tipo_comprob IN ('FCB','FCA','RE')"
    const pL = [], pC = []
    if (desde) { whereL += ' AND fecha >= ?'; whereC += ' AND fecha >= ?'; pL.push(desde); pC.push(desde) }
    if (hasta) { whereL += ' AND fecha <= ?'; whereC += ' AND fecha <= ?'; pL.push(hasta); pC.push(hasta) }
    if (sucursal && sucursal !== 'todas') {
      whereL += ' AND sucursal = ?'; whereC += ' AND sucursal = ?'
      pL.push(sucursal); pC.push(sucursal)
    }

    const ivaPorAlicuota = db.prepare(`
      SELECT alicuota_iva, SUM(subtotal_neto) as base, SUM(subtotal_neto * alicuota_iva / 100) as iva
      FROM ventas_lineas ${whereL}
      GROUP BY alicuota_iva
    `).all(...pL)

    const porTipoComp = db.prepare(`
      SELECT tipo_comprob, COUNT(*) as n, SUM(total) as total
      FROM comprobantes ${whereC}
      GROUP BY tipo_comprob
    `).all(...pC)

    const margenPorMes = db.prepare(`
      SELECT substr(fecha,1,7) as mes,
        SUM(subtotal_neto) as venta_neta,
        SUM(costo * cantidad) as costo,
        ROUND((SUM(subtotal_neto) - SUM(costo * cantidad)) / NULLIF(SUM(subtotal_neto),0) * 100, 1) as margen_pct
      FROM ventas_lineas ${whereL}
      GROUP BY mes ORDER BY mes
    `).all(...pL)

    const distribucionIVA = db.prepare(`
      SELECT alicuota_iva, COUNT(*) as n_lineas, SUM(cantidad) as unidades
      FROM ventas_lineas ${whereL}
      GROUP BY alicuota_iva ORDER BY alicuota_iva
    `).all(...pL)

    res.json({ ivaPorAlicuota, porTipoComp, margenPorMes, distribucionIVA })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Uploads log ─────────────────────────────────────────────────────────
app.get('/api/uploads', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM uploads_log ORDER BY id DESC LIMIT 50').all()
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/uploads/:id', (req, res) => {
  try {
    const { id } = req.params
    const upload = db.prepare('SELECT * FROM uploads_log WHERE id = ?').get(id)
    if (!upload) return res.status(404).json({ error: 'Upload no encontrado' })

    db.transaction(() => {
      db.prepare('DELETE FROM ventas_lineas WHERE upload_id = ?').run(id)
      db.prepare('DELETE FROM comprobantes WHERE upload_id = ?').run(id)
      db.prepare('DELETE FROM uploads_log WHERE id = ?').run(id)
    })()

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Sucursales disponibles ──────────────────────────────────────────────
app.get('/api/sucursales', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT sucursal FROM comprobantes WHERE sucursal IS NOT NULL ORDER BY sucursal').all()
    res.json(rows.map(r => r.sucursal))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Rango de fechas disponible ─────────────────────────────────────────
app.get('/api/fechas-rango', (req, res) => {
  try {
    const row = db.prepare('SELECT MIN(fecha) as desde, MAX(fecha) as hasta FROM comprobantes').get()
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── API: Artículos sin movimiento ────────────────────────────────────────────
app.get('/api/articulos/sin-movimiento', (req, res) => {
  try {
    const { dias = 90 } = req.query
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - parseInt(dias))
    const cutoffStr = cutoff.toISOString().substring(0, 10)

    const rows = db.prepare(`
      SELECT codigo, descripcion, MAX(fecha) as ultima_venta,
        julianday('now') - julianday(MAX(fecha)) as dias_sin_venta,
        SUM(unidades) as unidades_total
      FROM (
        SELECT codigo, descripcion, fecha, SUM(cantidad) as unidades
        FROM ventas_lineas
        WHERE tipo_comprob IN ('FCB','FCA','RE')
        GROUP BY codigo, fecha
      ) GROUP BY codigo
      HAVING MAX(fecha) < ?
      ORDER BY dias_sin_venta DESC
      LIMIT 500
    `).all(cutoffStr)

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Fallback to React app in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Delmy Analytics server running on port ${PORT}`)
  console.log(`DB: ${DB_PATH}`)
})
