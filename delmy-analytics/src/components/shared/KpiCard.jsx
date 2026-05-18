export function KpiCard({ label, value, sub, color, T, size = 'md' }) {
  const sz = size === 'lg' ? 28 : size === 'sm' ? 16 : 22
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`,
      borderRadius: 6, padding: '14px 18px',
      borderTop: `2px solid ${color || T.border}`,
      minWidth: 140
    }}>
      <div style={{ fontSize: 9, color: T.mut, letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'Syne, sans-serif', fontSize: sz,
        fontWeight: 700, color: color || T.txt, lineHeight: 1.1
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: T.mut, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtPeso(n) {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${fmt(n, 0)}`
}

export function fmtPesoFull(n) {
  if (n === null || n === undefined) return '—'
  return `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
