import { useFetch, buildQS } from '../hooks/useFetch.js'
import { KpiCard, fmtPeso, fmt, fmtPesoFull } from '../components/shared/KpiCard.jsx'
import { LineChart, BarChart, DonutChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Dashboard({ filters, T }) {
  const qs = buildQS(filters)
  const { data: kpis, loading: lk } = useFetch(`/api/kpis${qs}`, [qs])
  const { data: porDia, loading: ld } = useFetch(`/api/ventas/por-dia${qs}`, [qs])
  const { data: porSuc } = useFetch(`/api/ventas/por-sucursal${qs}`, [qs])
  const { data: topArts } = useFetch(`/api/articulos/ranking${buildQS({...filters})}${qs ? '&' : '?'}limit=10`, [qs])

  if (lk && !kpis) return <Skeleton T={T} />

  const noData = !kpis || kpis.n_comprobantes === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {noData && (
        <div style={{
          ...PANEL, borderColor: T.amber, background: T.panel2,
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          <span style={{ fontSize: 18 }}>↑</span>
          <div>
            <div style={{ fontSize: 13, color: T.acc, fontWeight: 500 }}>Sin datos cargados</div>
            <div style={{ fontSize: 11, color: T.mut, marginTop: 2 }}>
              Ir a la pestaña <strong style={{color:T.txt}}>CARGAS</strong> para subir las planillas de ventas mensuales.
            </div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard T={T} label="Facturación Total" color={T.acc}
          value={fmtPeso(kpis?.facturacion_bruta)}
          sub={`Neta s/NC: ${fmtPeso(kpis?.facturacion_neta)}`} size="lg" />
        <KpiCard T={T} label="Ticket Promedio" color={T.teal}
          value={fmtPeso(kpis?.ticket_promedio)}
          sub={`${fmt(kpis?.n_comprobantes)} comprobantes`} />
        <KpiCard T={T} label="Margen Bruto" color={T.green}
          value={`${kpis?.margen_bruto_pct ?? '—'}%`}
          sub={`Costo: ${fmtPeso(kpis?.costo_total)}`} />
        <KpiCard T={T} label="Unidades Vendidas" color={T.blue}
          value={fmt(kpis?.unidades_vendidas)}
          sub={`${fmt(kpis?.articulos_distintos)} artículos distintos`} />
        <KpiCard T={T} label="Arts. / Ticket" color={T.violet}
          value={kpis?.lineas_por_comprobante ?? '—'}
          sub={`${fmt(kpis?.dias_con_venta)} días con venta`} />
        <KpiCard T={T} label="IVA Total" color={T.orange}
          value={fmtPeso(kpis?.iva_total)}
          sub={`NC: ${fmt(kpis?.n_nc)} · ${fmtPeso(kpis?.total_nc)}`} />
      </div>

      {/* Charts row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
        <div style={PANEL}>
          <div style={TITLE}>Evolución de ventas diarias</div>
          <LineChart
            data={porDia || []} valueKey="total" labelKey="fecha"
            color={T.acc} T={T} height={160}
          />
        </div>

        {porSuc && (
          <div style={{ ...PANEL, minWidth: 220 }}>
            <div style={TITLE}>Por sucursal</div>
            <DonutChart
              data={porSuc} valueKey="total" labelKey="sucursal"
              colors={[T.acc, T.teal, T.blue, T.violet, T.orange]}
              T={T} size={140}
            />
          </div>
        )}
      </div>

      {/* Top artículos */}
      {topArts && topArts.length > 0 && (
        <div style={PANEL}>
          <div style={TITLE}>Top 10 artículos por facturación</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {['#','Código','Descripción','Unidades','Facturación','Margen%','Precio prom.'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', color: T.mut, textAlign: h === '#' ? 'center' : 'left', fontWeight: 400, fontSize: 9, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topArts.map((a, i) => (
                <tr key={a.codigo} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '5px 8px', color: T.mut, textAlign: 'center' }}>{i+1}</td>
                  <td style={{ padding: '5px 8px', color: T.teal, fontFamily: 'DM Mono' }}>{a.codigo}</td>
                  <td style={{ padding: '5px 8px', color: T.txt, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</td>
                  <td style={{ padding: '5px 8px', color: T.blue, textAlign: 'right' }}>{fmt(a.unidades)}</td>
                  <td style={{ padding: '5px 8px', color: T.acc, textAlign: 'right' }}>{fmtPeso(a.facturacion)}</td>
                  <td style={{ padding: '5px 8px', color: a.margen_pct > 40 ? T.green : a.margen_pct > 20 ? T.amber : T.red, textAlign: 'right' }}>
                    {a.margen_pct}%
                  </td>
                  <td style={{ padding: '5px 8px', color: T.mut, textAlign: 'right' }}>{fmtPeso(a.precio_promedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Skeleton({ T }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{
            background: T.panel, border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '14px 18px', minWidth: 140, height: 80
          }} />
        ))}
      </div>
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, height: 220 }} />
    </div>
  )
}
