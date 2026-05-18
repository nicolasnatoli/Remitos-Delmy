export function FilterBar({ filters, setFilters, sucursales, rangoFechas, T }) {
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
    </div>
  )
}
