import { useState, useCallback } from 'react'
import { useFetch, buildQS } from '../hooks/useFetch.js'
import { fmtPeso, fmt, fmtPesoFull } from '../components/shared/KpiCard.jsx'
import { LineChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Articulos({ filters, T }) {
  const [orderBy, setOrderBy] = useState('facturacion')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [limit, setLimit] = useState(100)

  const qs = buildQS(filters)
  const rankingUrl = `/api/articulos/ranking${qs}${qs ? '&' : '?'}orderBy=${orderBy}&limit=${limit}`
  const { data: ranking, loading } = useFetch(rankingUrl, [qs, orderBy, limit])

  const detailUrl = selected ? `/api/articulos/${encodeURIComponent(selected)}${qs}` : null
  const { data: detalle } = useFetch(detailUrl, [detailUrl])

  const filtered = ranking ? ranking.filter(a =>
    !search || a.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
    a.codigo?.toLowerCase().includes(search.toLowerCase())
  ) : []

  const exportCSV = () => {
    if (!filtered || filtered.length === 0) return
    const keys = Object.keys(filtered[0])
    const csv = [keys.join(','), ...filtered.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `articulos_ranking_${filters.desde}_${filters.hasta}.csv`
    a.click()
  }

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

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar código o descripción..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, fontSize: 12 }}
          />
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
          <button
            onClick={exportCSV}
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: T.panel, zIndex: 10 }}>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'center', fontWeight: 400, fontSize: 9, letterSpacing: 1, width: 36 }}>#</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>CÓD.</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>DESCRIPCIÓN</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>UNID.</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>FACTURACIÓN</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>MARGEN</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>P.PROM</th>
                  <th style={{ padding: '8px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>TICKETS</th>
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
                    <td style={{ padding: '5px 10px', color: T.txt, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.descripcion}
                    </td>
                    <td style={{ padding: '5px 10px', color: T.blue, textAlign: 'right' }}>{fmt(a.unidades)}</td>
                    <td style={{ padding: '5px 10px', color: T.acc, textAlign: 'right', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>{fmtPeso(a.facturacion)}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: margenColor(a.margen_pct), fontWeight: 500 }}>
                      {a.margen_pct != null ? `${a.margen_pct}%` : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{fmtPeso(a.precio_promedio)}</td>
                    <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{fmt(a.n_transacciones)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !loading && (
              <div style={{ padding: 20, color: T.mut, fontSize: 11, textAlign: 'center' }}>Sin resultados</div>
            )}
            {ranking && limit <= ranking.length && (
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
      {selected && detalle && (
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
