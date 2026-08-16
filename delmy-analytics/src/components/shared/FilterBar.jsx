import { useState, useRef, useEffect } from 'react'

export function FilterBar({ filters, setFilters, sucursales, proveedores = [], rangoFechas, T }) {
  const presets = [
    { label: 'Hoy',     days: 0 },
    { label: '7d',      days: 7 },
    { label: '30d',     days: 30 },
    { label: '3m',      months: 3 },
    { label: '6m',      months: 6 },
    { label: 'Todo',    all: true },
  ]

  const applyPreset = (p) => {
    const hoy = new Date()
    const hasta = hoy.toISOString().slice(0, 10)
    let desde
    if (p.all) {
      desde = rangoFechas.desde || '2024-01-01'
    } else if (p.days === 0) {
      desde = hasta
    } else if (p.days) {
      const d = new Date(hoy); d.setDate(d.getDate() - p.days)
      desde = d.toISOString().slice(0, 10)
    } else if (p.months) {
      const d = new Date(hoy); d.setMonth(d.getMonth() - p.months); d.setDate(1)
      desde = d.toISOString().slice(0, 10)
    }
    setFilters(f => ({ ...f, desde, hasta }))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Presets */}
      <div style={{ display: 'flex', gap: 3 }}>
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            style={{
              padding: '4px 8px', borderRadius: 3, fontSize: 10,
              background: T.panel2, border: `1px solid ${T.border2}`,
              color: T.mut, letterSpacing: 0.5
            }}
          >{p.label}</button>
        ))}
      </div>

      <input
        type="date"
        value={filters.desde}
        onChange={e => setFilters(f => ({ ...f, desde: e.target.value }))}
        style={{ width: 130, fontSize: 11 }}
      />
      <span style={{ color: T.mut, fontSize: 10 }}>→</span>
      <input
        type="date"
        value={filters.hasta}
        onChange={e => setFilters(f => ({ ...f, hasta: e.target.value }))}
        style={{ width: 130, fontSize: 11 }}
      />

      <select
        value={filters.sucursal}
        onChange={e => setFilters(f => ({ ...f, sucursal: e.target.value }))}
        style={{ width: 140, fontSize: 11 }}
      >
        <option value="todas">Todas las sucursales</option>
        {sucursales.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <ProveedorFilter filters={filters} setFilters={setFilters} proveedores={proveedores} T={T} />
    </div>
  )
}

// Filtro general de arranque — mismo rol que "Clasificación" en el dashboard
// de referencia. Multi-select con buscador porque puede haber decenas de
// proveedores (medimos 70 reales en tu catálogo).
function ProveedorFilter({ filters, setFilters, proveedores, T }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const ref = useRef(null)
  const seleccionados = filters.proveedores || []

  useEffect(() => {
    function onClickFuera(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', onClickFuera)
    return () => document.removeEventListener('mousedown', onClickFuera)
  }, [])

  const toggle = (p) => {
    setFilters(f => {
      const actual = f.proveedores || []
      return { ...f, proveedores: actual.includes(p) ? actual.filter(x => x !== p) : [...actual, p] }
    })
  }
  const limpiar = () => setFilters(f => ({ ...f, proveedores: [] }))

  const filtrados = proveedores.filter(p => p.toLowerCase().includes(busqueda.toLowerCase()))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setAbierto(v => !v)}
        style={{
          width: 170, fontSize: 11, textAlign: 'left', padding: '5px 8px',
          background: T.panel2, border: `1px solid ${seleccionados.length ? T.violet : T.border2}`,
          borderRadius: 4, color: seleccionados.length ? T.violet : T.mut,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {seleccionados.length === 0 ? 'Todos los proveedores' : `${seleccionados.length} proveedor(es)`}
      </button>
      {abierto && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, width: 260, maxHeight: 320, overflowY: 'auto',
          background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 6, zIndex: 200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${T.border}` }}>
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar proveedor..." autoFocus
              style={{ width: '100%', fontSize: 11, padding: '4px 6px' }}
            />
          </div>
          {seleccionados.length > 0 && (
            <div onClick={limpiar} style={{ padding: '6px 10px', fontSize: 10, color: T.red, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
              ✕ Limpiar selección
            </div>
          )}
          {filtrados.map(p => (
            <div
              key={p} onClick={() => toggle(p)}
              style={{
                padding: '6px 10px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                background: seleccionados.includes(p) ? 'rgba(192,132,252,0.1)' : 'transparent',
                color: seleccionados.includes(p) ? T.violet : T.txt,
              }}
            >
              <span style={{ width: 12, height: 12, border: `1px solid ${T.border2}`, borderRadius: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0 }}>
                {seleccionados.includes(p) && '✓'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
            </div>
          ))}
          {filtrados.length === 0 && <div style={{ padding: 10, fontSize: 11, color: T.mut }}>Sin resultados</div>}
        </div>
      )}
    </div>
  )
}
