import { useState } from 'react'
import { useFetch, buildQS } from '../hooks/useFetch.js'
import { fmt as fmtBase, fmtPeso as fmtPesoBase } from '../components/shared/KpiCard.jsx'
import { ParetoChart, LineChart, BarChart } from '../components/shared/Charts.jsx'

// ─── Sistema de diseño — valores literales del dashboard de referencia ────────
// Tokens propios de esta página, no tocan el T global (dark) que usa el resto
// de la app. Cuando se confirme que esto es lo que se quiere, se extiende a
// App.jsx/todas las páginas — hasta entonces conviven dos estilos.
const D = {
  bg: '#F2F4F7', panel: '#FFFFFF', ink: '#182129', inkSoft: '#5B6572', line: '#E4E8ED',
  navy: '#131B24', navy2: '#1E2A38',
  orange: '#E8622C', orangeSoft: '#FBE4D8',
  steel: '#2E6F95', steelSoft: '#DCEAF1',
  green: '#3A8047', amber: '#D9A441', red: '#C0392B',
  purple: '#6B4F9E', purpleSoft: '#EAE3F5',
  radius: 10,
  shadow: '0 1px 2px rgba(19,27,36,.06), 0 1px 12px rgba(19,27,36,.04)',
  fontDisplay: "'Barlow Condensed', sans-serif",
  fontBody: "'Inter', sans-serif",
}

// Shim para pasarle a los charts compartidos (Charts.jsx espera T.mut / T.border)
const chartT = { mut: D.inkSoft, border: D.line, bg: D.panel, txt: D.ink }

const fmt = fmtBase
const fmtPeso = fmtPesoBase

function Panel({ children, style }) {
  return (
    <div style={{ background: D.panel, borderRadius: D.radius, boxShadow: D.shadow, padding: '20px 22px', ...style }}>
      {children}
    </div>
  )
}

function PanelTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <div style={{ fontFamily: D.fontDisplay, fontSize: 18, fontWeight: 700, color: D.ink, letterSpacing: 0.2 }}>{children}</div>
      {right}
    </div>
  )
}

function KpiCardLocal({ label, value, foot, stripe }) {
  return (
    <div style={{ background: D.panel, borderRadius: D.radius, boxShadow: D.shadow, padding: '16px 16px 14px', borderTop: `3px solid ${stripe || D.orange}` }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: D.inkSoft, fontWeight: 600, fontFamily: D.fontBody }}>{label}</div>
      <div style={{ fontFamily: D.fontDisplay, fontSize: 26, fontWeight: 800, lineHeight: 1, color: D.ink, marginTop: 6 }}>{value}</div>
      {foot && <div style={{ fontSize: 11.5, color: D.inkSoft, marginTop: 5, fontFamily: D.fontBody }}>{foot}</div>}
    </div>
  )
}

function ToggleGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: '#EEF1F4', borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            border: 'none', padding: '6px 13px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
            fontFamily: D.fontBody, cursor: 'pointer',
            background: value === v ? D.navy : 'transparent',
            color: value === v ? '#fff' : D.inkSoft,
          }}
        >{label}</button>
      ))}
    </div>
  )
}

function PresetBtn({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${D.line}`, background: active ? D.navy : '#F8F9FB', color: active ? '#fff' : D.ink,
      padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: D.fontBody, cursor: 'pointer',
    }}>{children}</button>
  )
}

function PctBar({ pct }) {
  return (
    <span style={{ display: 'inline-block', height: 6, background: D.orangeSoft, borderRadius: 3, width: 70, position: 'relative', verticalAlign: 'middle' }}>
      <i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: D.orange, borderRadius: 3, width: `${Math.min(100, pct)}%` }} />
    </span>
  )
}

const th = { textAlign: 'left', padding: '8px 10px', borderBottom: `2px solid ${D.line}`, color: D.inkSoft, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: D.fontBody }
const td = { padding: '7px 10px', borderBottom: '1px solid #F0F2F5', fontSize: 12.8, fontFamily: D.fontBody, fontVariantNumeric: 'tabular-nums' }

function ComparativaAnualChart({ data, anioActual, anioAnterior }) {
  if (!data || data.length === 0) return <div style={{ padding: 20, color: D.inkSoft, fontSize: 11 }}>Sin datos</div>
  const max = Math.max(...data.map(d => {
    const anteriorTotal = d.anteriorCompleto ?? ((d.anteriorComparable || 0) + (d.anteriorResto || 0))
    return Math.max(d.actual || 0, anteriorTotal || 0)
  })) || 1
  const barW = 26, gap = 8, groupW = barW * 2 + gap + 22
  const pad = { l: 10, r: 10, t: 14, b: 50 }
  const chartH = 200
  const w = data.length * groupW

  return (
    <div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 11, color: D.inkSoft }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: D.orange, borderRadius: 2, marginRight: 5 }} />{anioActual}</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: D.steel, borderRadius: 2, marginRight: 5 }} />{anioAnterior} (comparable)</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: D.steelSoft, border: `1px dashed ${D.steel}`, borderRadius: 2, marginRight: 5 }} />{anioAnterior} (resto del período — contexto)</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={w + pad.l + pad.r} height={chartH + pad.t + pad.b}>
          <defs>
            <pattern id="stripeAnterior" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill={D.steelSoft} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={D.steel} strokeWidth="1.5" />
            </pattern>
          </defs>
          {data.map((d, i) => {
            const x0 = pad.l + i * groupW
            const anteriorTotal = d.anteriorCompleto ?? ((d.anteriorComparable || 0) + (d.anteriorResto || 0))
            const hActual = ((d.actual || 0) / max) * chartH
            const hComp = d.esParcial ? ((d.anteriorComparable || 0) / max) * chartH : ((anteriorTotal || 0) / max) * chartH
            const hResto = d.esParcial ? ((d.anteriorResto || 0) / max) * chartH : 0
            const yActual = pad.t + chartH - hActual
            const yCompTop = pad.t + chartH - hComp
            const yRestoTop = pad.t + chartH - hComp - hResto
            return (
              <g key={i}>
                <rect x={x0} y={yActual} width={barW} height={hActual} fill={D.orange} rx={2} />
                {d.esParcial && <rect x={x0 + barW + gap} y={yRestoTop} width={barW} height={hResto} fill="url(#stripeAnterior)" />}
                <rect x={x0 + barW + gap} y={yCompTop} width={barW} height={hComp} fill={D.steel} rx={2} />
                <text x={x0 + barW + gap / 2} y={pad.t + chartH + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={D.ink} fontFamily={D.fontBody}>{d.label}</text>
                {d.variacionPct !== null && (
                  <text x={x0 + barW + gap / 2} y={pad.t + chartH + 32} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily={D.fontBody} fill={d.variacionPct >= 0 ? D.green : D.red}>
                    {d.variacionPct >= 0 ? '▲' : '▼'}{Math.abs(d.variacionPct)}%{d.esParcial ? ' (parc.)' : ''}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ─── Nivel de cascada — reutilizable para Familia / Categoría / Marca / Artículo ─
// Clic en una barra o fila fija ese valor como filtro (reemplaza, no acumula —
// cambiar de familia no tiene sentido si se mantenía una categoría de la
// familia anterior seleccionada) y limpia los niveles de abajo en la cascada.
function NivelCascada({ nivel, label, filtroKey, filters, setFilters, nivelesAbajo, qs, colorBarra }) {
  const { data } = useFetch(`/api/ventas/ranking-nivel?nivel=${nivel}${qs}`, [qs])
  const seleccion = filters[filtroKey] || []

  const seleccionar = (valor) => {
    setFilters(f => {
      const next = { ...f, [filtroKey]: [valor] }
      for (const abajo of nivelesAbajo) next[abajo] = []
      return next
    })
  }
  const limpiar = () => {
    setFilters(f => {
      const next = { ...f, [filtroKey]: [] }
      for (const abajo of nivelesAbajo) next[abajo] = []
      return next
    })
  }

  if (!data || data.length === 0) return null

  return (
    <section style={{ marginTop: 34 }}>
      <Panel>
        <PanelTitle right={seleccion.length > 0 && (
          <button onClick={limpiar} style={{ fontSize: 11, color: D.orange, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            ✕ Quitar filtro de {label.toLowerCase()}
          </button>
        )}>
          Ventas por {label}
        </PanelTitle>
        <div style={{ fontSize: 12, color: D.inkSoft, marginBottom: 14 }}>
          Clic en una barra o fila para filtrar {nivelesAbajo.length > 0 ? 'el siguiente nivel' : 'el detalle'}.
        </div>
        <ParetoChart
          data={data}
          valueKey="facturacion"
          labelKey={nivel === 'articulo' ? 'descripcion' : 'valor_nivel'}
          T={chartT}
          color={colorBarra}
          lineColor={D.steel}
          onBarClick={(d) => seleccionar(d.valor_nivel)}
        />
        <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8 }}>
            <thead style={{ position: 'sticky', top: 0, background: D.panel }}>
              <tr>
                {[label, nivel === 'articulo' ? 'Código' : null, 'Unidades', 'N° Pedidos', 'Ventas $', '%', '% Acum.'].filter(Boolean).map(h => (
                  <th key={h} style={{ ...th, textAlign: h === label || h === 'Código' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map(row => (
                <tr
                  key={row.valor_nivel}
                  onClick={() => seleccionar(row.valor_nivel)}
                  onMouseEnter={e => e.currentTarget.style.background = D.steelSoft}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{ cursor: 'pointer', background: seleccion.includes(row.valor_nivel) ? D.orangeSoft : 'transparent' }}
                >
                  <td style={{ ...td, color: D.ink, fontWeight: 600 }}>{nivel === 'articulo' ? row.descripcion : row.valor_nivel}</td>
                  {nivel === 'articulo' && <td style={{ ...td, color: D.inkSoft, fontFamily: 'monospace' }}>{row.valor_nivel}</td>}
                  <td style={{ ...td, textAlign: 'right', color: D.ink }}>{fmt(row.unidades)}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.ink }}>{fmt(row.n_ventas)}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.orange, fontWeight: 700 }}>{fmtPeso(row.facturacion)}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.inkSoft }}>{row.pct}%</td>
                  <td style={{ ...td, textAlign: 'right' }}><PctBar pct={row.pct_acum} /> <span style={{ color: D.inkSoft, marginLeft: 6 }}>{row.pct_acum}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  )
}

// ─── Breadcrumb de la cascada activa ───────────────────────────────────────────
function BreadcrumbCascada({ filters, setFilters }) {
  const niveles = [
    ['proveedores', 'Proveedor'], ['familias', 'Familia'], ['categorias', 'Categoría'], ['marcas', 'Marca'],
  ]
  const activos = niveles.filter(([key]) => filters[key] && filters[key].length > 0)
  if (activos.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
      <span style={{ fontSize: 11, color: D.inkSoft, fontWeight: 600 }}>Filtrando por:</span>
      {activos.map(([key, label]) => (
        <span key={key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, background: D.purpleSoft, color: D.purple,
          borderRadius: 20, padding: '4px 10px 4px 12px', fontSize: 11.5, fontWeight: 600,
        }}>
          {label}: {filters[key].join(', ')}
          <button
            onClick={() => {
              const idx = niveles.findIndex(([k]) => k === key)
              setFilters(f => {
                const next = { ...f }
                for (let i = idx; i < niveles.length; i++) next[niveles[i][0]] = []
                return next
              })
            }}
            style={{ background: 'transparent', border: 'none', color: D.purple, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
          >✕</button>
        </span>
      ))}
      <button
        onClick={() => setFilters(f => ({ ...f, proveedores: [], familias: [], categorias: [], marcas: [] }))}
        style={{ fontSize: 11, color: D.red, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
      >Limpiar todo</button>
    </div>
  )
}

export default function Ventas({ filters, setFilters, T }) {
  const [vista, setVista] = useState('dia')
  const [vistaComparativa, setVistaComparativa] = useState('trimestre')
  const [metricaProveedor, setMetricaProveedor] = useState('facturacion')
  const [proveedorHover, setProveedorHover] = useState(null)
  const qs = buildQS(filters)

  const { data: porDia } = useFetch(`/api/ventas/por-dia${qs}`, [qs])
  const { data: porMes } = useFetch(`/api/ventas/por-mes${qs}`, [qs])
  const { data: porSuc } = useFetch(`/api/ventas/por-sucursal${qs}`, [qs])
  const { data: kpis } = useFetch(`/api/kpis${qs}`, [qs])
  const { data: porProveedor } = useFetch(`/api/ventas/por-proveedor${qs}`, [qs])
  const { data: comparativa } = useFetch(`/api/ventas/comparativa-anual${qs}`, [qs])

  const exportCSV = (data, filename) => {
    if (!data || data.length === 0) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = filename
    a.click()
  }

  const mesTotals = porMes ? Object.values(
    porMes.reduce((acc, r) => {
      if (!acc[r.mes]) acc[r.mes] = { mes: r.mes, total: 0, n_ventas: 0 }
      acc[r.mes].total += r.total || 0
      acc[r.mes].n_ventas += r.n_ventas || 0
      return acc
    }, {})
  ).sort((a, b) => a.mes.localeCompare(b.mes)) : []

  const seleccionado = proveedorHover && porProveedor ? porProveedor.find(p => p.proveedor === proveedorHover) : null

  return (
    <div style={{ background: D.bg, margin: '-16px -20px', padding: '0 0 40px', minHeight: '100%', fontFamily: D.fontBody }}>

      {/* ─── Header tipo "topbar" del sistema de referencia ─── */}
      <div style={{
        background: `linear-gradient(135deg, ${D.navy} 0%, ${D.navy2} 100%)`,
        color: '#fff', padding: '26px 24px 34px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          content: '""', position: 'absolute', right: -60, top: -60, width: 280, height: 280, borderRadius: '50%',
          background: `radial-gradient(circle, rgba(232,98,44,.28), transparent 70%)`, pointerEvents: 'none',
        }} />
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: D.orange, fontWeight: 700, fontFamily: D.fontBody, position: 'relative' }}>
          PANEL DE INDICADORES · VENTAS
        </div>
        <h1 style={{ fontFamily: D.fontDisplay, fontSize: 34, fontWeight: 800, margin: '4px 0 0', position: 'relative' }}>
          Ventas — Delmy Party SRL
        </h1>
      </div>

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 24px 0' }}>

        <BreadcrumbCascada filters={filters} setFilters={setFilters} />

        {/* ─── Filtros de fecha rápidos ─── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <PresetBtn onClick={() => {}}>Filtrar fechas</PresetBtn>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => exportCSV(
              vista === 'dia' ? porDia : vista === 'mes' ? mesTotals : porSuc,
              `ventas_${vista}_${filters.desde}_${filters.hasta}.csv`
            )}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: D.fontBody,
              background: D.steelSoft, border: `1px solid ${D.steel}`, color: D.steel, cursor: 'pointer',
            }}
          >↓ Exportar CSV</button>
        </div>

        {/* ─── KPIs ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))', gap: 14, marginBottom: 34 }}>
          <KpiCardLocal label="Facturación" value={fmtPeso(kpis?.facturacion_bruta)} stripe={D.orange} foot="bruta del período" />
          <KpiCardLocal label="Comprobantes" value={fmt(kpis?.n_comprobantes)} stripe={D.steel} foot={`Ticket prom: ${fmtPeso(kpis?.ticket_promedio)}`} />
          <KpiCardLocal label="Días con venta" value={kpis?.dias_con_venta ?? '—'} stripe={D.green} foot="en el período" />
          <KpiCardLocal label="Facturación/día" value={fmtPeso(kpis?.dias_con_venta > 0 ? (kpis?.facturacion_bruta / kpis?.dias_con_venta) : 0)} stripe={D.amber} foot="promedio" />
        </div>

        {/* ─── Tendencia general ─── */}
        <section style={{ marginTop: 34 }}>
          <Panel>
            <PanelTitle right={<ToggleGroup options={[['dia','Por día'],['mes','Por mes'],['sucursal','Por sucursal']]} value={vista} onChange={setVista} />}>
              Tendencia general de ventas
            </PanelTitle>

            {vista === 'dia' && porDia && (
              <LineChart data={porDia} valueKey="total" labelKey="fecha" color={D.orange} T={chartT} height={220} />
            )}
            {vista === 'mes' && mesTotals.length > 0 && (
              <BarChart data={mesTotals} valueKey="total" labelKey="mes" color={D.orange} T={chartT} height={220} />
            )}
            {vista === 'sucursal' && porSuc && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {porSuc.map((s, i) => {
                  const total = porSuc.reduce((a, x) => a + (x.total || 0), 0)
                  const pct = total > 0 ? Math.round((s.total / total) * 100) : 0
                  const color = [D.orange, D.steel, D.purple][i % 3]
                  return (
                    <div key={s.sucursal} style={{ background: '#FAFBFC', borderRadius: D.radius, padding: '14px 16px', border: `1px solid ${D.line}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontFamily: D.fontDisplay, fontSize: 16, fontWeight: 700, color: D.ink }}>{s.sucursal}</span>
                        <span style={{ fontFamily: D.fontDisplay, fontSize: 20, fontWeight: 800, color }}>{fmtPeso(s.total)}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: D.inkSoft }}>{fmt(s.n_ventas)} tickets · Ticket prom: {fmtPeso(s.ticket_promedio)} · {pct}% del total</div>
                      <div style={{ marginTop: 8, background: D.line, borderRadius: 3, height: 6 }}>
                        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </section>

        {/* ─── Comparativa interanual ─── */}
        {comparativa && comparativa.anioActual && (
          <section style={{ marginTop: 34 }}>
            <Panel>
              <PanelTitle right={<ToggleGroup options={[['trimestre','Por trimestre'],['mes','Por mes']]} value={vistaComparativa} onChange={setVistaComparativa} />}>
                Comparativa interanual
              </PanelTitle>
              <div style={{ fontSize: 12, color: D.inkSoft, marginBottom: 14 }}>
                {comparativa.anioActual} vs. {comparativa.anioAnterior} — el período en curso divide el año anterior en
                "mismo tramo que hoy" (comparable) + "resto del período" (rayado, de contexto), para comparar
                manzanas con manzanas. Corte de datos: {comparativa.corte}.
              </div>
              <ComparativaAnualChart
                data={vistaComparativa === 'trimestre' ? comparativa.trimestre : comparativa.mes}
                anioActual={comparativa.anioActual}
                anioAnterior={comparativa.anioAnterior}
              />
            </Panel>
          </section>
        )}

        {/* ─── Ventas por Proveedor — con resumen al costado, nunca arriba tapando el gráfico ─── */}
        <section style={{ marginTop: 34 }}>
          <Panel>
            <PanelTitle right={<ToggleGroup options={[['facturacion','Ventas $'],['unidades','Unidades'],['n_ventas','N° Pedidos']]} value={metricaProveedor} onChange={setMetricaProveedor} />}>
              Ventas por Proveedor
            </PanelTitle>
            <div style={{ fontSize: 12, color: D.inkSoft, marginBottom: 14 }}>
              Curva de Pareto (80/20) — clic en una barra para filtrar el panel por ese proveedor.
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                {porProveedor && (
                  <ParetoChart
                    data={porProveedor}
                    valueKey={metricaProveedor}
                    labelKey="proveedor"
                    T={chartT}
                    color={D.orange}
                    lineColor={D.steel}
                    onBarClick={(d) => { setFilters(f => ({ ...f, proveedores: [d.proveedor] })); setProveedorHover(d.proveedor) }}
                  />
                )}
              </div>
              {seleccionado && (
                <div style={{ flex: '0 0 320px', maxWidth: 320, background: D.orangeSoft, borderRadius: D.radius, padding: 16 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: D.orange, fontWeight: 700, marginBottom: 8 }}>Proveedor seleccionado</div>
                  <div style={{ fontFamily: D.fontDisplay, fontSize: 20, fontWeight: 800, color: D.ink, marginBottom: 10 }}>{seleccionado.proveedor}</div>
                  <div style={{ fontSize: 12, color: D.inkSoft, lineHeight: 1.9 }}>
                    Facturación: <b style={{ color: D.ink }}>{fmtPeso(seleccionado.facturacion)}</b><br/>
                    Unidades: <b style={{ color: D.ink }}>{fmt(seleccionado.unidades)}</b><br/>
                    Pedidos: <b style={{ color: D.ink }}>{fmt(seleccionado.n_ventas)}</b><br/>
                    Artículos: <b style={{ color: D.ink }}>{fmt(seleccionado.n_articulos)}</b><br/>
                    % del total: <b style={{ color: D.ink }}>{seleccionado.pct}%</b>
                  </div>
                  <button
                    onClick={() => { setFilters(f => ({ ...f, proveedores: [] })); setProveedorHover(null) }}
                    style={{ marginTop: 12, fontSize: 11, color: D.orange, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >✕ Quitar filtro</button>
                </div>
              )}
            </div>

            {porProveedor && porProveedor.length > 0 && (
              <div style={{ maxHeight: 340, overflowY: 'auto', marginTop: 18 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8 }}>
                  <thead style={{ position: 'sticky', top: 0, background: D.panel }}>
                    <tr>
                      {['Proveedor','Unidades','N° Pedidos','Ventas $','%','% Acum.','Artículos'].map(h => (
                        <th key={h} style={{ ...th, textAlign: h === 'Proveedor' ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {porProveedor.map(p => (
                      <tr
                        key={p.proveedor}
                        onClick={() => { setFilters(f => ({ ...f, proveedores: [p.proveedor] })); setProveedorHover(p.proveedor) }}
                        onMouseEnter={e => e.currentTarget.style.background = D.steelSoft}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ ...td, color: D.ink, fontWeight: 600 }}>{p.proveedor}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.ink }}>{fmt(p.unidades)}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.ink }}>{fmt(p.n_ventas)}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.orange, fontWeight: 700 }}>{fmtPeso(p.facturacion)}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.inkSoft }}>{p.pct}%</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <PctBar pct={p.pct_acum} /> <span style={{ color: D.inkSoft, marginLeft: 6 }}>{p.pct_acum}%</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: D.inkSoft }}>{fmt(p.n_articulos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              onClick={() => exportCSV(porProveedor, `ventas_por_proveedor_${filters.desde}_${filters.hasta}.csv`)}
              style={{ marginTop: 14, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: D.fontBody, background: D.steelSoft, border: `1px solid ${D.steel}`, color: D.steel, cursor: 'pointer' }}
            >↓ Exportar CSV</button>
          </Panel>
        </section>

        {/* ─── Cascada Familia → Categoría → Marca → Artículo ─── */}
        <NivelCascada nivel="familia"   label="Familia"   filtroKey="familias"   nivelesAbajo={['categorias','marcas']} filters={filters} setFilters={setFilters} qs={qs} colorBarra={D.steel} />
        <NivelCascada nivel="categoria" label="Categoría" filtroKey="categorias" nivelesAbajo={['marcas']}              filters={filters} setFilters={setFilters} qs={qs} colorBarra={D.purple} />
        <NivelCascada nivel="marca"     label="Marca"     filtroKey="marcas"     nivelesAbajo={[]}                      filters={filters} setFilters={setFilters} qs={qs} colorBarra={D.amber} />
        <NivelCascada nivel="articulo"  label="Artículo"  filtroKey="__articulo_no_filtra__" nivelesAbajo={[]}          filters={filters} setFilters={setFilters} qs={qs} colorBarra={D.orange} />

        {/* ─── Detalle diario ─── */}
        {vista === 'dia' && porDia && porDia.length > 0 && (
          <section style={{ marginTop: 34 }}>
            <Panel>
              <PanelTitle>Detalle diario</PanelTitle>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8 }}>
                  <thead style={{ position: 'sticky', top: 0, background: D.panel }}>
                    <tr>
                      {['Fecha','N° Ventas','Facturación','Ticket Promedio'].map(h => (
                        <th key={h} style={{ ...th, textAlign: h === 'Fecha' ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...porDia].reverse().map(d => (
                      <tr key={d.fecha} onMouseEnter={e => e.currentTarget.style.background = '#FAFBFC'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ ...td, color: D.steel, fontWeight: 600 }}>{d.fecha}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.inkSoft }}>{fmt(d.n_ventas)}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.orange, fontWeight: 700 }}>{fmtPeso(d.total)}</td>
                        <td style={{ ...td, textAlign: 'right', color: D.ink }}>{fmtPeso(d.ticket_promedio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        )}
      </div>
    </div>
  )
}
