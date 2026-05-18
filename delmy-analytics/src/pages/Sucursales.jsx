import { useFetch, buildQS } from '../hooks/useFetch.js'
import { KpiCard, fmtPeso, fmt } from '../components/shared/KpiCard.jsx'
import { LineChart, BarChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

const COLORS = ['#f0c040', '#2dd4bf', '#60a5fa', '#c084fc', '#fb923c']

export default function Sucursales({ filters, T }) {
  const qs = buildQS({ ...filters, sucursal: 'todas' })
  const { data: porSuc } = useFetch(`/api/ventas/por-sucursal${qs}`, [qs])
  const { data: porMes } = useFetch(`/api/ventas/por-mes${qs}`, [qs])

  const sucursales = porSuc ? porSuc.map(s => s.sucursal) : []
  const totalGeneral = porSuc ? porSuc.reduce((a, s) => a + (s.total || 0), 0) : 0

  // Build por-mes per sucursal
  const mesList = porMes ? [...new Set(porMes.map(r => r.mes))].sort() : []
  const dataXSuc = sucursales.map((suc, i) => {
    const rows = porMes ? porMes.filter(r => r.sucursal === suc) : []
    return {
      sucursal: suc,
      color: COLORS[i % COLORS.length],
      data: mesList.map(mes => {
        const r = rows.find(x => x.mes === mes)
        return { mes, total: r ? r.total : 0, n_ventas: r ? r.n_ventas : 0 }
      })
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Sucursal cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {(porSuc || []).map((s, i) => {
          const pct = totalGeneral > 0 ? Math.round((s.total / totalGeneral) * 100) : 0
          const color = COLORS[i % COLORS.length]
          return (
            <div key={s.sucursal} style={{
              ...PANEL, borderTop: `3px solid ${color}`
            }}>
              <div style={{
                fontFamily: 'Syne, sans-serif', fontSize: 14, fontWeight: 700,
                color: T.txt, marginBottom: 12
              }}>{s.sucursal}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color }}>{fmtPeso(s.total)}</span>
                <span style={{ fontSize: 16, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: T.mut }}>{pct}%</span>
              </div>
              <div style={{ background: T.border, borderRadius: 2, height: 4, marginBottom: 12 }}>
                <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 2 }} />
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 9, color: T.mut, marginBottom: 2 }}>TICKETS</div>
                  <div style={{ fontSize: 14, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: T.txt }}>{fmt(s.n_ventas)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T.mut, marginBottom: 2 }}>TICKET PROM</div>
                  <div style={{ fontSize: 14, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: T.teal }}>{fmtPeso(s.ticket_promedio)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T.mut, marginBottom: 2 }}>PART. %</div>
                  <div style={{ fontSize: 14, fontFamily: 'Syne, sans-serif', fontWeight: 700, color }}>{pct}%</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Evolución mensual por sucursal */}
      {mesList.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Evolución mensual por sucursal</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {dataXSuc.map(({ sucursal, color, data }) => (
              <div key={sucursal}>
                <div style={{ fontSize: 11, color, marginBottom: 4, fontWeight: 500 }}>{sucursal}</div>
                <LineChart data={data} valueKey="total" labelKey="mes" color={color} T={T} height={100} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comparativo mensual tabla */}
      {mesList.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Tabla comparativa mensual</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ padding: '4px 10px', color: T.mut, textAlign: 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>MES</th>
                  {sucursales.map((s, i) => (
                    <th key={s} style={{ padding: '4px 10px', color: COLORS[i % COLORS.length], textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>{s}</th>
                  ))}
                  <th style={{ padding: '4px 10px', color: T.acc, textAlign: 'right', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {mesList.map(mes => {
                  const mesTotal = dataXSuc.reduce((a, s) => {
                    const r = s.data.find(d => d.mes === mes)
                    return a + (r ? r.total : 0)
                  }, 0)
                  return (
                    <tr key={mes} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '5px 10px', color: T.teal }}>{mes}</td>
                      {dataXSuc.map(({ sucursal, color, data }) => {
                        const r = data.find(d => d.mes === mes)
                        return (
                          <td key={sucursal} style={{ padding: '5px 10px', color, textAlign: 'right' }}>
                            {r && r.total > 0 ? fmtPeso(r.total) : '—'}
                          </td>
                        )
                      })}
                      <td style={{ padding: '5px 10px', color: T.acc, textAlign: 'right', fontWeight: 600, fontFamily: 'Syne, sans-serif' }}>
                        {fmtPeso(mesTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
