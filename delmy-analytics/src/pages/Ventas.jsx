import { useState } from 'react'
import { useFetch, buildQS } from '../hooks/useFetch.js'
import { KpiCard, fmtPeso, fmt } from '../components/shared/KpiCard.jsx'
import { LineChart, BarChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Ventas({ filters, T }) {
  const [vista, setVista] = useState('dia') // dia | mes | sucursal
  const qs = buildQS(filters)

  const { data: porDia } = useFetch(`/api/ventas/por-dia${qs}`, [qs])
  const { data: porMes } = useFetch(`/api/ventas/por-mes${qs}`, [qs])
  const { data: porSuc } = useFetch(`/api/ventas/por-sucursal${qs}`, [qs])
  const { data: kpis } = useFetch(`/api/kpis${qs}`, [qs])

  const exportCSV = (data, filename) => {
    if (!data || data.length === 0) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = filename
    a.click()
  }

  // Aggregate porMes by mes (all sucursales)
  const mesTotals = porMes ? Object.values(
    porMes.reduce((acc, r) => {
      if (!acc[r.mes]) acc[r.mes] = { mes: r.mes, total: 0, n_ventas: 0 }
      acc[r.mes].total += r.total || 0
      acc[r.mes].n_ventas += r.n_ventas || 0
      return acc
    }, {})
  ).sort((a, b) => a.mes.localeCompare(b.mes)) : []

  // Sucursales por mes (stacked data)
  const sucursalesKey = porMes ? [...new Set(porMes.map(r => r.sucursal))] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard T={T} label="Facturación" color={T.acc} value={fmtPeso(kpis?.facturacion_bruta)} size="lg" />
        <KpiCard T={T} label="Comprobantes" color={T.blue} value={fmt(kpis?.n_comprobantes)} sub={`Ticket prom: ${fmtPeso(kpis?.ticket_promedio)}`} />
        <KpiCard T={T} label="Días con venta" color={T.teal} value={kpis?.dias_con_venta ?? '—'} sub="en el período" />
        <KpiCard T={T} label="Facturación/día" color={T.violet}
          value={fmtPeso(kpis?.dias_con_venta > 0 ? (kpis?.facturacion_bruta / kpis?.dias_con_venta) : 0)}
          sub="promedio" />
      </div>

      {/* Vista selector */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[['dia','Por día'],['mes','Por mes'],['sucursal','Por sucursal']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            style={{
              padding: '6px 14px', borderRadius: 4, fontSize: 11, letterSpacing: 1,
              background: vista === v ? T.acc : T.panel2,
              color: vista === v ? T.bg : T.mut,
              border: `1px solid ${vista === v ? T.acc : T.border2}`
            }}
          >{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => exportCSV(
            vista === 'dia' ? porDia : vista === 'mes' ? mesTotals : porSuc,
            `ventas_${vista}_${filters.desde}_${filters.hasta}.csv`
          )}
          style={{
            padding: '6px 14px', borderRadius: 4, fontSize: 11,
            background: T.panel2, border: `1px solid ${T.border2}`, color: T.teal
          }}
        >↓ Exportar CSV</button>
      </div>

      {/* Chart */}
      {vista === 'dia' && porDia && (
        <div style={PANEL}>
          <div style={TITLE}>Ventas diarias — Facturación</div>
          <LineChart data={porDia} valueKey="total" labelKey="fecha" color={T.acc} T={T} height={200} />
        </div>
      )}

      {vista === 'mes' && mesTotals.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Ventas mensuales — Facturación total</div>
          <BarChart data={mesTotals} valueKey="total" labelKey="mes" color={T.acc} T={T} height={200} />
        </div>
      )}

      {vista === 'sucursal' && porSuc && (
        <div style={PANEL}>
          <div style={TITLE}>Ventas por sucursal</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {porSuc.map(s => {
              const total = porSuc.reduce((a, x) => a + (x.total || 0), 0)
              const pct = total > 0 ? Math.round((s.total / total) * 100) : 0
              return (
                <div key={s.sucursal} style={{
                  background: T.panel2, borderRadius: 6, padding: '12px 16px',
                  border: `1px solid ${T.border2}`
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 14, fontWeight: 700, color: T.txt }}>{s.sucursal}</span>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 800, color: T.acc }}>{fmtPeso(s.total)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 20 }}>
                    <span style={{ fontSize: 11, color: T.mut }}>{fmt(s.n_ventas)} tickets · Ticket prom: {fmtPeso(s.ticket_promedio)} · {pct}% del total</span>
                  </div>
                  <div style={{ marginTop: 8, background: T.border, borderRadius: 2, height: 4 }}>
                    <div style={{ width: `${pct}%`, background: T.acc, height: '100%', borderRadius: 2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabla de datos */}
      {vista === 'dia' && porDia && porDia.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Detalle diario</div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: T.panel }}>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Fecha','N° Ventas','Facturación','Ticket Promedio'].map(h => (
                    <th key={h} style={{ padding: '4px 10px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...porDia].reverse().map(d => (
                  <tr key={d.fecha} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '5px 10px', color: T.teal }}>{d.fecha}</td>
                    <td style={{ padding: '5px 10px', color: T.mut, textAlign: 'right' }}>{fmt(d.n_ventas)}</td>
                    <td style={{ padding: '5px 10px', color: T.acc, textAlign: 'right' }}>{fmtPeso(d.total)}</td>
                    <td style={{ padding: '5px 10px', color: T.txt, textAlign: 'right' }}>{fmtPeso(d.ticket_promedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
