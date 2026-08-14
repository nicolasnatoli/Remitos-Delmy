import { useState, useCallback } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { fmt } from '../components/shared/KpiCard.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Cargas({ T }) {
  const [uploading, setUploading] = useState(false)
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

      {/* Upload history */}
      {uploads && uploads.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Historial de cargas</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Archivo','Desde','Hasta','Sucursales','Encab.','Detalles','Insert.','Actualiz.','Cargado','Estado',''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', color: 'var(--mut)', textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
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
