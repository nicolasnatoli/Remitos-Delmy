import { useState, useCallback, Fragment } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { fmt } from '../components/shared/KpiCard.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Cargas({ T }) {
  const [uploading, setUploading] = useState(false)
  const [colisionAbierta, setColisionAbierta] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)

  const [uploadingMaestro, setUploadingMaestro] = useState(false)
  const [resultMaestro, setResultMaestro] = useState(null)
  const [errorMaestro, setErrorMaestro] = useState(null)
  const [draggingMaestro, setDraggingMaestro] = useState(false)

  const { data: uploads, reload } = useFetch('/api/uploads')
  const { data: cobertura, reload: reloadCobertura } = useFetch('/api/maestro/cobertura')

  const processFileMaestro = useCallback(async (file) => {
    if (!file) return
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setErrorMaestro('Solo se aceptan archivos .xlsx o .xls')
      return
    }
    setUploadingMaestro(true)
    setErrorMaestro(null)
    setResultMaestro(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const resp = await fetch('/api/upload-maestro', { method: 'POST', body: form })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Error desconocido')
      setResultMaestro(data)
      reloadCobertura()
    } catch (e) {
      setErrorMaestro(e.message)
    } finally {
      setUploadingMaestro(false)
    }
  }, [reloadCobertura])

  const processFile = useCallback(async (file) => {
    if (!file) return
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError('Solo se aceptan archivos .xlsx, .xls o .csv')
      return
    }

    setUploading(true)
    setError(null)
    setResult(null)

    const form = new FormData()
    form.append('file', file)

    try {
      const resp = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Error desconocido')

      // If processing in background, poll for status
      if (data.procesando) {
        setResult({ ...data, status: 'procesando' })
        reload()
        const poll = setInterval(async () => {
          try {
            const sr = await fetch(`/api/upload-status/${data.uploadId}`)
            const s = await sr.json()
            if (s.status === 'ok' || s.status === 'error') {
              clearInterval(poll)
              setResult(s)
              setUploading(false)
              reload()
            }
          } catch {}
        }, 3000)
      } else {
        setResult(data)
        setUploading(false)
        reload()
      }
    } catch (e) {
      setError(e.message)
      setUploading(false)
    }
  }, [reload])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const deleteUpload = async (id) => {
    if (!confirm('¿Eliminar esta carga y todos sus datos?')) return
    await fetch(`/api/uploads/${id}`, { method: 'DELETE' })
    reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>

      {/* Info */}
      <div style={{ ...PANEL, borderColor: 'var(--teal)', background: 'var(--panel2)' }}>
        <div style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 500, marginBottom: 6 }}>
          ↑ Carga de planillas de ventas
        </div>
        <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.6 }}>
          Subí planillas mensuales o diarias en formato <strong style={{color:'var(--txt)'}}>DELMY PARTY SRL_DetalleDeVentasRealizadas_*.xlsx o .csv</strong>.<br/>
          El sistema detecta automáticamente duplicados por número de comprobante — podés cargar la misma planilla múltiples veces sin generar duplicados.<br/>
          Las notas de crédito (NCB/NC) se descuentan correctamente en todos los indicadores.
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        style={{
          border: `2px dashed ${dragging ? 'var(--acc)' : 'var(--border2)'}`,
          borderRadius: 8, padding: '40px 20px', textAlign: 'center',
          background: dragging ? 'rgba(240,192,64,0.05)' : 'transparent',
          cursor: 'pointer', transition: 'all 0.2s'
        }}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input
          id="file-input" type="file" accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={e => processFile(e.target.files[0])}
          multiple
        />
        {uploading ? (
          <div>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
            <div style={{ color: 'var(--acc)', fontSize: 13 }}>
              {result?.status === 'procesando'
                ? `Insertando datos... ${result?.encabezados || 0} comprobantes · ${result?.detalles || 0} líneas`
                : 'Leyendo planilla...'}
            </div>
            {result?.status === 'procesando' && (
              <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 6 }}>
                Las planillas grandes tardan 2-5 min. No cierres la pestaña.
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--mut)' }}>↑</div>
            <div style={{ fontSize: 14, color: 'var(--txt)', marginBottom: 4 }}>
              Arrastrá la planilla acá o hacé click para seleccionar
            </div>
            <div style={{ fontSize: 11, color: 'var(--mut)' }}>
              Formato: *.xlsx o *.csv (CSV es más rápido para archivos grandes)
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div style={{ ...PANEL, borderColor: 'var(--green)' }}>
          <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500, marginBottom: 10 }}>
            ✓ Planilla procesada correctamente
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              ['Encabezados',   result.encabezados],
              ['Líneas detalle', result.detalles],
              ['Insertados',    result.insertados],
              ['Actualizados',  result.actualizados],
              ['Desde',         result.fechaDesde],
              ['Hasta',         result.fechaHasta],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: 'var(--mut)', letterSpacing: 1 }}>{k.toUpperCase()}</div>
                <div style={{ fontSize: 14, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--txt)' }}>{v}</div>
              </div>
            ))}
          </div>
          {result.sucursales && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--mut)' }}>
              Sucursales: {result.sucursales.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...PANEL, borderColor: 'var(--red)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)' }}>✗ Error: {error}</div>
        </div>
      )}

      {/* ─── Maestro de artículos (Proveedor/Familia/Categoría/Marca) ─── */}
      <div style={{ ...PANEL, borderColor: 'var(--violet)', background: 'var(--panel2)', marginTop: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--violet)', fontWeight: 500, marginBottom: 6 }}>
          ↑ Carga del maestro de artículos
        </div>
        <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.6 }}>
          Subí acá el reporte <strong style={{color:'var(--txt)'}}>Stock Disponible</strong> (trae Familia/Categoría/Marca) y el
          reporte de <strong style={{color:'var(--txt)'}}>Órdenes de Compra</strong> (trae Proveedor) — se detecta solo cuál es cuál
          por las columnas. Sin esto, el dashboard de ventas no puede agrupar por Proveedor/Familia/Categoría/Marca.
          Se puede cargar en cualquier orden y las veces que haga falta — nunca se pisa un dato bueno con uno vacío del otro archivo.
        </div>
      </div>

      <div
        onDrop={(e) => { e.preventDefault(); setDraggingMaestro(false); const f = e.dataTransfer.files[0]; if (f) processFileMaestro(f) }}
        onDragOver={e => { e.preventDefault(); setDraggingMaestro(true) }}
        onDragLeave={() => setDraggingMaestro(false)}
        style={{
          border: `2px dashed ${draggingMaestro ? 'var(--violet)' : 'var(--border2)'}`,
          borderRadius: 8, padding: '24px 20px', textAlign: 'center',
          background: draggingMaestro ? 'rgba(192,132,252,0.05)' : 'transparent',
          cursor: 'pointer', transition: 'all 0.2s'
        }}
        onClick={() => document.getElementById('file-input-maestro').click()}
      >
        <input
          id="file-input-maestro" type="file" accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => processFileMaestro(e.target.files[0])}
        />
        {uploadingMaestro ? (
          <div style={{ color: 'var(--violet)', fontSize: 13 }}>⟳ Procesando maestro...</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--mut)' }}>Arrastrá Stock Disponible u Órdenes de Compra acá, o hacé click</div>
        )}
      </div>

      {resultMaestro && (
        <div style={{ ...PANEL, borderColor: 'var(--green)' }}>
          <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>
            ✓ Detectado como: <strong>{resultMaestro.fuente === 'oc' ? 'Órdenes de Compra' : 'Stock Disponible'}</strong>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[['Filas', resultMaestro.filas], ['Insertados', resultMaestro.insertados], ['Actualizados', resultMaestro.actualizados]].map(([k,v]) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: 'var(--mut)', letterSpacing: 1 }}>{k.toUpperCase()}</div>
                <div style={{ fontSize: 14, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--txt)' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {errorMaestro && (
        <div style={{ ...PANEL, borderColor: 'var(--red)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)' }}>✗ Error: {errorMaestro}</div>
        </div>
      )}

      {/* Cobertura del join — validar antes de confiar en cualquier gráfico por clasificación */}
      {cobertura && (
        <div style={PANEL}>
          <div style={TITLE}>Cobertura del maestro sobre las ventas cargadas</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--mut)', letterSpacing: 1 }}>CÓDIGOS VENDIDOS CON MAESTRO</div>
              <div style={{ fontSize: 22, fontFamily: 'Syne, sans-serif', fontWeight: 800, color: cobertura.cobertura_pct >= 90 ? 'var(--green)' : cobertura.cobertura_pct >= 70 ? 'var(--amber)' : 'var(--red)' }}>
                {cobertura.cobertura_pct}%
              </div>
              <div style={{ fontSize: 10, color: 'var(--mut)' }}>{fmt(cobertura.codigos_con_maestro)} de {fmt(cobertura.codigos_vendidos)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--mut)', letterSpacing: 1 }}>SIN MAESTRO</div>
              <div style={{ fontSize: 22, fontFamily: 'Syne, sans-serif', fontWeight: 800, color: 'var(--red)' }}>{fmt(cobertura.sin_maestro)}</div>
            </div>
            {cobertura.completitud_maestro && (
              <div style={{ fontSize: 10, color: 'var(--mut)' }}>
                Del maestro cargado ({fmt(cobertura.completitud_maestro.total_maestro)} artículos):
                sin proveedor {fmt(cobertura.completitud_maestro.sin_proveedor)} ·
                sin familia {fmt(cobertura.completitud_maestro.sin_familia)} ·
                sin categoría {fmt(cobertura.completitud_maestro.sin_categoria)} ·
                sin marca {fmt(cobertura.completitud_maestro.sin_marca)}
              </div>
            )}
          </div>
          {cobertura.cobertura_pct < 90 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--amber)' }}>
              ⚠ Con esta cobertura, cualquier gráfico por Proveedor/Familia/Categoría/Marca va a dejar afuera
              {' '}{fmt(cobertura.sin_maestro)} códigos vendidos sin clasificar. Cargá más históricos de OC/Stock
              Disponible para mejorar esto antes de sacar conclusiones de los rankings.
            </div>
          )}
        </div>
      )}

      {/* Lista de artículos sin clasificar — con fecha de última venta para */}
      {/* distinguir descontinuados (venta vieja) de activos que faltan clasificar */}
      {cobertura && cobertura.sin_maestro > 0 && (
        <SinClasificarTable />
      )}

      {/* Upload history */}
      {uploads && uploads.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Historial de cargas</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Archivo','Desde','Hasta','Sucursales','Encab.','Detalles','Insert.','Actualiz.','Colisiones','Cargado','Estado',''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', color: 'var(--mut)', textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploads.map(u => (
                <Fragment key={u.id}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--txt)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.filename}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--teal)' }}>{u.fecha_desde}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--teal)' }}>{u.fecha_hasta}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--mut)', fontSize: 10 }}>{u.sucursales}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--txt)', textAlign: 'right' }}>{fmt(u.n_encabezados)}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--txt)', textAlign: 'right' }}>{fmt(u.n_detalles)}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--green)', textAlign: 'right' }}>{fmt(u.n_insertados)}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--amber)', textAlign: 'right' }}>{fmt(u.n_actualizados)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                    {u.n_colisiones > 0 ? (
                      <span style={{ color: 'var(--red)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline dotted' }}
                        onClick={() => setColisionAbierta(colisionAbierta === u.id ? null : u.id)}
                        title="Click para ver el detalle">⚠ {fmt(u.n_colisiones)}</span>
                    ) : <span style={{ color: 'var(--mut)' }}>0</span>}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--mut)', fontSize: 10 }}>{u.uploaded_at?.slice(0,16)}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{
                      fontSize: 9, padding: '2px 6px', borderRadius: 3,
                      background: u.status === 'ok' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                      color: u.status === 'ok' ? 'var(--green)' : 'var(--red)',
                      letterSpacing: 1
                    }}>{u.status?.toUpperCase()}</span>
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <button
                      onClick={() => deleteUpload(u.id)}
                      style={{ color: 'var(--red)', fontSize: 12, opacity: 0.6 }}
                      title="Eliminar esta carga"
                    >✕</button>
                  </td>
                </tr>
                {colisionAbierta === u.id && u.colisiones_detalle && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={11} style={{ padding: '8px 12px', background: 'rgba(248,113,113,.06)' }}>
                      <div style={{ fontSize: 10, color: 'var(--red)', marginBottom: 4, fontWeight: 600 }}>
                        Comprobantes cuyo número ya existía con fecha/tipo/sucursal DISTINTOS a los del archivo (muestra hasta 30):
                      </div>
                      <pre style={{ fontSize: 9.5, color: 'var(--mut)', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{u.colisiones_detalle}</pre>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploads && uploads.length === 0 && (
        <div style={{ ...PANEL, textAlign: 'center' }}>
          <div style={{ color: 'var(--mut)', fontSize: 12 }}>No hay cargas registradas todavía.</div>
        </div>
      )}
    </div>
  )
}

function SinClasificarTable() {
  const [orden, setOrden] = useState('ultima_venta')
  const [editando, setEditando] = useState(null)
  const { data: lista, reload } = useFetch('/api/maestro/sin-clasificar')
  const { data: opciones } = useFetch('/api/maestro/opciones')

  if (!lista) return null
  const ordenada = [...lista].sort((a, b) => {
    if (orden === 'ultima_venta') return new Date(b.ultima_venta) - new Date(a.ultima_venta)
    if (orden === 'mas_vieja') return new Date(a.ultima_venta) - new Date(b.ultima_venta)
    return Number(b.unidades) - Number(a.unidades)
  })
  const posiblesDescontinuados = lista.filter(r => Number(r.dias_desde_ultima_venta) > 365).length

  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={TITLE}>Artículos sin clasificar ({lista.length}{lista.length === 500 ? '+' : ''})</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['ultima_venta','Venta más reciente'],['mas_vieja','Venta más vieja'],['unidades','Más vendidos']].map(([v,l]) => (
            <button key={v} onClick={() => setOrden(v)} style={{
              fontSize: 10, padding: '4px 9px', borderRadius: 12,
              background: orden === v ? 'var(--accent)' : 'transparent',
              color: orden === v ? 'var(--bg)' : 'var(--mut)',
              border: `1px solid ${orden === v ? 'var(--accent)' : 'var(--border)'}`,
            }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--mut)', marginBottom: 8 }}>
        Clasificación manual: Familia/Categoría/Marca sin Proveedor — a propósito, para los que no importa o no se sabe quién los proveyó.
      </div>
      {posiblesDescontinuados > 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 10 }}>
          ⚠ {posiblesDescontinuados} de estos códigos no se venden hace más de un año — buenos candidatos a
          "descontinuado" antes de invertir tiempo en clasificarlos.
        </div>
      )}
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Código','Descripción','Unidades','Última venta','Días sin vender',''].map(h => (
                <th key={h} style={{ padding: '4px 8px', color: 'var(--mut)', textAlign: h==='Código'||h==='Descripción' ? 'left' : 'right', fontWeight: 400, fontSize: 9 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenada.map(r => {
              const dias = Number(r.dias_desde_ultima_venta)
              const abierto = editando === r.codigo
              return (
                <Fragment key={r.codigo}>
                  <tr style={{ borderBottom: abierto ? 'none' : '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: 'var(--txt)' }}>{r.codigo}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--txt)' }}>{r.descripcion}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt)' }}>{fmt(r.unidades)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: dias > 365 ? 'var(--amber)' : 'var(--mut)' }}>{r.ultima_venta}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: dias > 365 ? 'var(--amber)' : 'var(--mut)', fontWeight: dias > 365 ? 600 : 400 }}>{dias}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      <button onClick={() => setEditando(abierto ? null : r.codigo)} style={{
                        fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                        background: abierto ? 'var(--accent)' : 'transparent', color: abierto ? 'var(--bg)' : 'var(--accent)',
                        border: '1px solid var(--accent)',
                      }}>{abierto ? 'Cerrar' : 'Clasificar'}</button>
                    </td>
                  </tr>
                  {abierto && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={6} style={{ padding: '10px 8px', background: 'var(--panel2)' }}>
                        <ClasificarForm
                          codigo={r.codigo} descripcion={r.descripcion} opciones={opciones}
                          onGuardado={() => { setEditando(null); reload() }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClasificarForm({ codigo, descripcion, opciones, onGuardado }) {
  const [familia, setFamilia] = useState('')
  const [categoria, setCategoria] = useState('')
  const [marca, setMarca] = useState('')
  const [guardando, setGuardando] = useState(false)

  const inputStyle = { padding: '5px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--txt)', width: 180 }

  const guardar = async () => {
    if (!familia && !categoria && !marca) return
    setGuardando(true)
    try {
      await fetch('/api/maestro/clasificar-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, descripcion, familia: familia || null, categoria: categoria || null, marca: marca || null }),
      })
      onGuardado()
    } finally { setGuardando(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 3 }}>FAMILIA</div>
        <input list="dl-familias" value={familia} onChange={e => setFamilia(e.target.value)} style={inputStyle} />
        <datalist id="dl-familias">{opciones?.familias.map(f => <option key={f} value={f} />)}</datalist>
      </div>
      <div>
        <div style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 3 }}>CATEGORÍA</div>
        <input list="dl-categorias" value={categoria} onChange={e => setCategoria(e.target.value)} style={inputStyle} />
        <datalist id="dl-categorias">{opciones?.categorias.map(c => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <div style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 3 }}>MARCA</div>
        <input list="dl-marcas" value={marca} onChange={e => setMarca(e.target.value)} style={inputStyle} />
        <datalist id="dl-marcas">{opciones?.marcas.map(m => <option key={m} value={m} />)}</datalist>
      </div>
      <button onClick={guardar} disabled={guardando} style={{
        padding: '6px 14px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
        background: 'var(--green)', color: '#0c0e14', border: 'none', opacity: guardando ? 0.6 : 1,
      }}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      <div style={{ fontSize: 9.5, color: 'var(--mut)' }}>Empezá a tipear — te sugiere valores ya existentes, o escribí uno nuevo.</div>
    </div>
  )
}
