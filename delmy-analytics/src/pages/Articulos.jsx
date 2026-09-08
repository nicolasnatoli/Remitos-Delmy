import { useState, useCallback, useEffect } from 'react'
import { useFetch, buildQS } from '../hooks/useFetch.js'
import { fmtPeso, fmt, fmtPesoFull } from '../components/shared/KpiCard.jsx'
import { LineChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

function exportCSV(data, filename) {
  if (!data || data.length === 0) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
}

// ─── Celda de Temporada — editable inline, mismo patrón que la clasificación
// manual de Cargas.jsx: escribís o elegís de lo que ya existe, guarda al salir
// del campo. No calcula nada especial todavía — es solo la etiqueta, a
// propósito (el cálculo de estadísticas DENTRO de temporada depende del
// calendario de fechas por temporada, que se define en otra ronda).
function CeldaTemporada({ codigo, valorActual, opciones, T, onGuardado }) {
  const [valor, setValor] = useState(valorActual || '')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { setValor(valorActual || '') }, [valorActual])

  const guardar = async () => {
    if (valor === (valorActual || '')) return
    setGuardando(true)
    try {
      await fetch('/api/maestro/clasificar-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, temporada: valor || null }),
      })
      onGuardado?.()
    } catch {} finally { setGuardando(false) }
  }

  return (
    <>
      <input
        list="temporadas-datalist"
        value={valor}
        onChange={e => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
        onClick={e => e.stopPropagation()}
        placeholder="—"
        style={{
          width: 110, fontSize: 10, padding: '3px 6px', background: T.panel2,
          border: `1px solid ${guardando ? T.acc : T.border2}`, borderRadius: 3, color: T.txt,
        }}
      />
      <datalist id="temporadas-datalist">
        {(opciones || []).map(t => <option key={t} value={t} />)}
      </datalist>
    </>
  )
}

// ─── Estadísticas de período — semana/quincena/mes/trimestre con
// promedio/mediana/moda/último real, para el panel de detalle a la derecha.
function EstadisticasPeriodo({ estadisticas, T }) {
  if (!estadisticas) return null
  const periodos = [['semana','Semana'], ['quincena','Quincena'], ['mes','Mes'], ['trimestre','Trimestre']]
  return (
    <div style={PANEL}>
      <div style={TITLE}>Estadísticas por período</div>
      <div style={{ fontSize: 9.5, color: T.mut, marginBottom: 10, lineHeight: 1.4 }}>
        Promedio/mediana/moda son sobre períodos históricos (sin contar el actual) — "Real" es el período más reciente, en curso o recién cerrado.
      </div>
      {periodos.map(([key, label]) => {
        const p = estadisticas[key]
        if (!p) return null
        return (
          <div key={key} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10, color: T.txt, fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
              <div style={{ color: T.mut }}>Real (último): <b style={{ color: T.acc }}>{fmtPeso(p.ultimo)}</b></div>
              <div style={{ color: T.mut }}>Promedio: <b style={{ color: T.txt }}>{p.promedio != null ? fmtPeso(p.promedio) : '—'}</b></div>
              <div style={{ color: T.mut }}>Mediana: <b style={{ color: T.txt }}>{p.mediana != null ? fmtPeso(p.mediana) : '—'}</b></div>
              <div style={{ color: T.mut }}>Moda: <b style={{ color: T.txt }}>{p.moda != null ? fmtPeso(p.moda) : 'sin repetidos'}</b></div>
            </div>
            {p.variacionPct != null && (
              <div style={{ fontSize: 10, marginTop: 3, color: p.variacionPct >= 0 ? T.green : T.red }}>
                {p.variacionPct >= 0 ? '▲' : '▼'} {Math.abs(p.variacionPct)}% vs. promedio histórico
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Articulos({ filters, T }) {
  const [vista, setVista] = useState('articulos') // 'articulos' | 'combos'
  const [orderBy, setOrderBy] = useState('facturacion')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [limit, setLimit] = useState(100)
  const [refrescar, setRefrescar] = useState(0)

  const qs = buildQS(filters)
  const { data: opciones } = useFetch('/api/maestro/opciones', [])

  const rankingUrl = vista === 'articulos'
    ? `/api/articulos/ranking${qs}${qs ? '&' : '?'}orderBy=${orderBy}&limit=${limit}&conEstadisticas=1&_r=${refrescar}`
    : `/api/articulos/combos-ranking${qs}`
  const { data: ranking, loading } = useFetch(rankingUrl, [qs, orderBy, limit, vista, refrescar])

  const detailUrl = (vista === 'articulos' && selected) ? `/api/articulos/${encodeURIComponent(selected)}${qs}` : null
  const { data: detalle } = useFetch(detailUrl, [detailUrl])

  const filtered = ranking ? ranking.filter(a =>
    !search || a.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
    a.codigo?.toLowerCase().includes(search.toLowerCase())
  ) : []

  const ORDERS = [
    ['facturacion', '$ Facturación'],
    ['unidades', '# Unidades'],
    ['transacciones', '⊞ Transacciones'],
    ['margen', '% Margen'],
  ]

  const margenColor = (pct) => {
    if (!pct && pct !== 0) return T.mut
    if (pct >= 50) return T.green
    if (pct >= 30) return T.teal
    if (pct >= 15) return T.amber
    return T.red
  }

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 120px)' }}>

      {/* Left: Ranking */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>

        {/* Vista toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[['articulos', '◈ Artículos'], ['combos', '▣ Combos']].map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => { setVista(v); setSelected(null) }}
              style={{
                padding: '6px 14px', borderRadius: 4, fontSize: 11, letterSpacing: 0.5, fontWeight: 600,
                background: vista === v ? T.violet : T.panel2,
                color: vista === v ? '#1a0a24' : T.mut,
                border: `1px solid ${vista === v ? T.violet : T.border2}`,
              }}
            >{lbl}</button>
          ))}
          {vista === 'combos' && (
            <span style={{ fontSize: 10, color: T.mut, alignSelf: 'center', marginLeft: 8 }}>
              Códigos que son combos (tienen componentes cargados) — no artículos unitarios sueltos.
            </span>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar código o descripción..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, fontSize: 12 }}
          />
          {vista === 'articulos' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {ORDERS.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setOrderBy(v)}
                  style={{
                    padding: '5px 10px', borderRadius: 4, fontSize: 10, letterSpacing: 0.5,
                    background: orderBy === v ? T.acc : T.panel2,
                    color: orderBy === v ? T.bg : T.mut,
                    border: `1px solid ${orderBy === v ? T.acc : T.border2}`
                  }}
                >{label}</button>
              ))}
            </div>
          )}
          <button
            onClick={() => exportCSV(filtered, `${vista}_${filters.desde}_${filters.hasta}.csv`)}
            style={{
              padding: '5px 12px', borderRadius: 4, fontSize: 10,
              background: T.panel2, border: `1px solid ${T.border2}`, color: T.teal
            }}
          >↓ CSV</button>
        </div>

        {/* Table */}
        <div style={{ ...PANEL, flex: 1, overflow: 'hidden', padding: 0 }}>
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {loading && <div style={{ padding: 20, color: T.mut, fontSize: 11 }}>Cargando...</div>}

            {vista === 'articulos' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: T.panel, zIndex: 10 }}>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'center', fontWeight: 400, fontSize: 9, letterSpacing: 1, width: 36 }}>#</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>CÓD.</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>DESCRIPCIÓN</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>TEMPORADA</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>UNID.</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>FACTURACIÓN</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>MARGEN</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>ÚLT. SEMANA</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>PROM. SEMANA</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => (
                    <tr
                      key={a.codigo}
                      onClick={() => setSelected(a.codigo === selected ? null : a.codigo)}
                      style={{
                        borderBottom: `1px solid ${T.border}`,
                        cursor: 'pointer',
                        background: a.codigo === selected ? T.panel2 : 'transparent',
                        transition: 'background 0.1s'
                      }}
                    >
                      <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'center' }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px', color: T.teal, fontFamily: 'DM Mono', fontSize: 10, whiteSpace: 'nowrap' }}>{a.codigo}</td>
                      <td style={{ padding: '5px 10px', color: T.txt, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.descripcion}
                      </td>
                      <td style={{ padding: '5px 10px' }}>
                        <CeldaTemporada codigo={a.codigo} valorActual={a.temporada} opciones={opciones?.temporadas} T={T} onGuardado={() => setRefrescar(r => r + 1)} />
                      </td>
                      <td style={{ padding: '5px 10px', color: T.blue, textAlign: 'right' }}>{fmt(a.unidades)}</td>
                      <td style={{ padding: '5px 10px', color: T.acc, textAlign: 'right', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>{fmtPeso(a.facturacion)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: margenColor(a.margen_pct), fontWeight: 500 }}>
                        {a.margen_pct != null ? `${a.margen_pct}%` : '—'}
                      </td>
                      <td style={{ padding: '5px 10px', color: T.txt, textAlign: 'right' }}>{a.semana?.ultimo != null ? fmtPeso(a.semana.ultimo) : '—'}</td>
                      <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{a.semana?.promedio != null ? fmtPeso(a.semana.promedio) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: T.panel, zIndex: 10 }}>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'center', fontWeight: 400, fontSize: 9, letterSpacing: 1, width: 36 }}>#</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>CÓD. COMBO</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>DESCRIPCIÓN</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>N° COMPONENTES</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>UNID. VENDIDAS</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>FACTURACIÓN</th>
                    <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>TRANSACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.codigo} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'center' }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px', color: T.violet, fontFamily: 'DM Mono', fontSize: 10, whiteSpace: 'nowrap' }}>{c.codigo}</td>
                      <td style={{ padding: '5px 10px', color: T.txt, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</td>
                      <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{c.n_componentes}</td>
                      <td style={{ padding: '5px 10px', color: T.blue, textAlign: 'right' }}>{fmt(c.unidades)}</td>
                      <td style={{ padding: '5px 10px', color: T.acc, textAlign: 'right', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>{fmtPeso(c.facturacion)}</td>
                      <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{fmt(c.n_transacciones)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {filtered.length === 0 && !loading && (
              <div style={{ padding: 20, color: T.mut, fontSize: 11, textAlign: 'center' }}>Sin resultados</div>
            )}
            {vista === 'articulos' && ranking && limit <= ranking.length && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  onClick={() => setLimit(l => l + 200)}
                  style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, background: T.panel2, border: `1px solid ${T.border2}`, color: T.mut }}
                >Cargar más...</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Detalle artículo */}
      {vista === 'articulos' && selected && detalle && (
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <div style={{ ...PANEL, borderColor: T.acc }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: T.mut, letterSpacing: 2, marginBottom: 2 }}>ARTÍCULO</div>
                <div style={{ fontSize: 11, color: T.teal, fontFamily: 'DM Mono' }}>{selected}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ color: T.mut, fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: T.txt, marginBottom: 12, lineHeight: 1.4 }}>
              {detalle.resumen?.descripcion}
            </div>
            {detalle.resumen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['Facturación total', fmtPeso(detalle.resumen.facturacion_total), T.acc],
                  ['Unidades totales', fmt(detalle.resumen.unidades_total), T.blue],
                  ['Precio promedio', fmtPeso(detalle.resumen.precio_promedio), T.teal],
                  ['Costo promedio', fmtPeso(detalle.resumen.costo_promedio), T.mut],
                  ['Primera venta', detalle.resumen.primera_venta, T.mut],
                  ['Última venta', detalle.resumen.ultima_venta, T.mut],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: T.mut }}>{label}</span>
                    <span style={{ fontSize: 11, color, fontWeight: 500 }}>{val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <EstadisticasPeriodo estadisticas={detalle.estadisticas} T={T} />

          {detalle.porSucursal && detalle.porSucursal.length > 0 && (
            <div style={PANEL}>
              <div style={TITLE}>Por sucursal</div>
              {detalle.porSucursal.map(s => {
                const total = detalle.porSucursal.reduce((a, x) => a + x.unidades, 0)
                const pct = total > 0 ? Math.round(s.unidades / total * 100) : 0
                return (
                  <div key={s.sucursal} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                      <span style={{ color: T.txt }}>{s.sucursal}</span>
                      <span style={{ color: T.acc }}>{fmt(s.unidades)} u · {fmtPeso(s.facturacion)}</span>
                    </div>
                    <div style={{ background: T.border, borderRadius: 2, height: 3 }}>
                      <div style={{ width: `${pct}%`, background: T.acc, height: '100%', borderRadius: 2 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {detalle.porMes && detalle.porMes.length > 1 && (
            <div style={PANEL}>
              <div style={TITLE}>Evolución mensual</div>
              <LineChart
                data={detalle.porMes} valueKey="unidades" labelKey="mes"
                color={T.teal} T={T} height={100} width={280}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
