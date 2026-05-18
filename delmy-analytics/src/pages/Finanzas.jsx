import { useFetch, buildQS } from '../hooks/useFetch.js'
import { KpiCard, fmtPeso, fmt, fmtPesoFull } from '../components/shared/KpiCard.jsx'
import { LineChart, DonutChart } from '../components/shared/Charts.jsx'

const PANEL = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 18px' }
const TITLE = { fontSize: 10, color: 'var(--mut)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }

export default function Finanzas({ filters, T }) {
  const qs = buildQS(filters)
  const { data: kpis } = useFetch(`/api/kpis${qs}`, [qs])
  const { data: fin } = useFetch(`/api/finanzas/resumen${qs}`, [qs])

  const exportCSV = (data, filename) => {
    if (!data || data.length === 0) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = filename; a.click()
  }

  const ivaColors = ['#6b7280', '#60a5fa', '#c084fc']
  const tipoColors = ['#f0c040', '#4ade80', '#f87171', '#2dd4bf', '#fb923c']

  // Totals for waterfall
  const ventaNeta = kpis?.venta_neta || 0
  const costo = kpis?.costo_total || 0
  const margen = ventaNeta - costo
  const iva = kpis?.iva_total || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPIs financieros */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard T={T} label="Venta Neta" color={T.acc}
          value={fmtPeso(ventaNeta)} sub="s/ IVA" size="lg" />
        <KpiCard T={T} label="Costo Total" color={T.red}
          value={fmtPeso(costo)} sub="mercadería" />
        <KpiCard T={T} label="Margen Bruto $" color={T.green}
          value={fmtPeso(margen)} sub={`${kpis?.margen_bruto_pct ?? '—'}%`} />
        <KpiCard T={T} label="IVA 21%" color={T.violet}
          value={fmtPeso(kpis?.iva_total)} sub="total IVA recaudado" />
        <KpiCard T={T} label="Notas de Crédito" color={T.orange}
          value={fmtPeso(kpis?.total_nc)} sub={`${kpis?.n_nc ?? 0} NC`} />
      </div>

      {/* Waterfall de rentabilidad */}
      <div style={PANEL}>
        <div style={TITLE}>Estructura de resultado</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Facturación Bruta (con IVA)',  val: kpis?.facturacion_bruta, color: T.acc, bar: 100 },
            { label: '(-) IVA Total',                val: -iva, color: T.violet, bar: ventaNeta > 0 ? (iva / kpis?.facturacion_bruta) * 100 : 0 },
            { label: 'Venta Neta',                   val: ventaNeta, color: T.blue, bar: ventaNeta > 0 ? (ventaNeta / kpis?.facturacion_bruta) * 100 : 0 },
            { label: '(-) Costo de Mercadería',      val: -costo, color: T.red, bar: ventaNeta > 0 ? (costo / kpis?.facturacion_bruta) * 100 : 0 },
            { label: 'Margen Bruto',                 val: margen, color: T.green, bar: ventaNeta > 0 ? (margen / kpis?.facturacion_bruta) * 100 : 0 },
          ].map(({ label, val, color, bar }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 240, fontSize: 11, color: T.txt }}>{label}</div>
              <div style={{ flex: 1, background: T.border, borderRadius: 2, height: 16, position: 'relative' }}>
                <div style={{ width: `${Math.abs(bar)}%`, background: color, height: '100%', borderRadius: 2, opacity: 0.8 }} />
              </div>
              <div style={{
                width: 110, textAlign: 'right', fontSize: 12,
                fontFamily: 'Syne, sans-serif', fontWeight: 700,
                color: val >= 0 ? color : T.red
              }}>
                {val < 0 ? `(${fmtPeso(Math.abs(val))})` : fmtPeso(val)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row: IVA breakdown + tipos comprobante */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* IVA por alícuota */}
        {fin?.ivaPorAlicuota && (
          <div style={PANEL}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={TITLE} className="title">IVA por alícuota</div>
              <button
                onClick={() => exportCSV(fin.ivaPorAlicuota, `iva_alicuotas_${filters.desde}.csv`)}
                style={{ fontSize: 10, color: T.teal, background: 'none', border: 'none' }}
              >↓ CSV</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Alícuota', 'Base imponible', 'IVA'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fin.ivaPorAlicuota.map(r => (
                  <tr key={r.alicuota_iva} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '5px 8px', color: T.blue, textAlign: 'right' }}>
                      {r.alicuota_iva === 0 ? 'Exento/0%' : `${r.alicuota_iva}%`}
                    </td>
                    <td style={{ padding: '5px 8px', color: T.txt, textAlign: 'right' }}>{fmtPeso(r.base)}</td>
                    <td style={{ padding: '5px 8px', color: T.violet, textAlign: 'right', fontWeight: 600 }}>{fmtPeso(r.iva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tipos de comprobante */}
        {fin?.porTipoComp && (
          <div style={PANEL}>
            <div style={TITLE}>Por tipo de comprobante</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Tipo', 'Cantidad', 'Total'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', color: T.mut, textAlign: 'right', fontWeight: 400, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fin.porTipoComp.map((r, i) => (
                  <tr key={r.tipo_comprob} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '5px 8px', color: tipoColors[i % tipoColors.length] }}>{r.tipo_comprob}</td>
                    <td style={{ padding: '5px 8px', color: T.txt, textAlign: 'right' }}>{fmt(r.n)}</td>
                    <td style={{
                      padding: '5px 8px', textAlign: 'right', fontWeight: 600,
                      color: ['NC','NCB'].includes(r.tipo_comprob) ? T.red : T.acc
                    }}>
                      {['NC','NCB'].includes(r.tipo_comprob) ? `(${fmtPeso(r.total)})` : fmtPeso(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Margen por mes */}
      {fin?.margenPorMes && fin.margenPorMes.length > 1 && (
        <div style={PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={TITLE}>Margen bruto mensual (%)</div>
            <button
              onClick={() => exportCSV(fin.margenPorMes, `margen_mensual_${filters.desde}.csv`)}
              style={{ fontSize: 10, color: T.teal, background: 'none', border: 'none' }}
            >↓ CSV</button>
          </div>
          <LineChart
            data={fin.margenPorMes} valueKey="margen_pct" labelKey="mes"
            color={T.green} T={T} height={140}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {fin.margenPorMes.map(m => (
              <div key={m.mes} style={{
                background: T.panel2, borderRadius: 4, padding: '6px 10px',
                border: `1px solid ${T.border2}`, fontSize: 10
              }}>
                <span style={{ color: T.mut }}>{m.mes} </span>
                <span style={{ color: m.margen_pct >= 30 ? T.green : m.margen_pct >= 15 ? T.amber : T.red, fontWeight: 600 }}>
                  {m.margen_pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
