import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import Ventas from './pages/Ventas.jsx'
import Articulos from './pages/Articulos.jsx'
import Sucursales from './pages/Sucursales.jsx'
import Finanzas from './pages/Finanzas.jsx'
import Cargas from './pages/Cargas.jsx'
import { FilterBar } from './components/shared/FilterBar.jsx'

const T = {
  bg:'#0c0e14', panel:'#111420', panel2:'#161925',
  border:'#1e2133', border2:'#242840',
  acc:'#f0c040', green:'#4ade80', red:'#f87171',
  blue:'#60a5fa', teal:'#2dd4bf', orange:'#fb923c',
  violet:'#c084fc', mut:'#6b7280', txt:'#e8eaf0'
}

const TABS = [
  { id: 'dashboard',  label: '▦ DASHBOARD',   icon: '▦' },
  { id: 'ventas',     label: '↗ VENTAS',       icon: '↗' },
  { id: 'articulos',  label: '◈ ARTÍCULOS',    icon: '◈' },
  { id: 'sucursales', label: '⊞ SUCURSALES',   icon: '⊞' },
  { id: 'finanzas',   label: '$ FINANZAS',     icon: '$' },
  { id: 'cargas',     label: '↑ CARGAS',       icon: '↑' },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [filters, setFilters] = useState({ desde: '', hasta: '', sucursal: 'todas' })
  const [sucursales, setSucursales] = useState([])
  const [rangoFechas, setRangoFechas] = useState({ desde: '', hasta: '' })

  useEffect(() => {
    fetch('/api/sucursales').then(r => r.json()).then(setSucursales).catch(() => {})
    fetch('/api/fechas-rango').then(r => r.json()).then(d => {
      setRangoFechas(d)
      if (!filters.desde && d.desde) {
        // Default to last 3 months
        const hasta = d.hasta || new Date().toISOString().slice(0,10)
        const desde3m = new Date(hasta)
        desde3m.setMonth(desde3m.getMonth() - 2)
        desde3m.setDate(1)
        setFilters(f => ({ ...f, desde: desde3m.toISOString().slice(0,10), hasta }))
      }
    }).catch(() => {})
  }, [])

  const pageProps = { filters, T }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background: T.bg }}>
      {/* Header */}
      <div style={{
        background: T.panel, borderBottom: `1px solid ${T.border}`,
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 20,
        position: 'sticky', top: 0, zIndex: 100
      }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 800, color: T.acc, letterSpacing: 2 }}>
            DELMY
          </div>
          <div style={{ fontSize: 9, color: T.mut, letterSpacing: 3 }}>ANALYTICS · IP</div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: 2, flex: 1 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 14px',
                borderRadius: 4,
                fontSize: 11,
                letterSpacing: 1,
                fontWeight: 500,
                background: tab === t.id ? T.acc : 'transparent',
                color: tab === t.id ? T.bg : T.mut,
                border: tab === t.id ? 'none' : `1px solid transparent`,
                transition: 'all 0.15s'
              }}
            >{t.label}</button>
          ))}
        </div>

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          sucursales={sucursales}
          rangoFechas={rangoFechas}
          T={T}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {tab === 'dashboard'  && <Dashboard  {...pageProps} />}
        {tab === 'ventas'     && <Ventas      {...pageProps} />}
        {tab === 'articulos'  && <Articulos   {...pageProps} />}
        {tab === 'sucursales' && <Sucursales  {...pageProps} />}
        {tab === 'finanzas'   && <Finanzas    {...pageProps} />}
        {tab === 'cargas'     && <Cargas       {...pageProps} />}
      </div>
    </div>
  )
}
