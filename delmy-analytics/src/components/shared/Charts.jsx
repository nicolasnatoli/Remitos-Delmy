import { useRef, useEffect } from 'react'

// ─── Bar Chart ────────────────────────────────────────────────────────────────
export function BarChart({ data, valueKey, labelKey, color = '#f0c040', height = 180, T }) {
  if (!data || data.length === 0) return <Empty T={T} />
  const max = Math.max(...data.map(d => d[valueKey] || 0))
  const barW = Math.max(4, Math.min(32, (600 / data.length) - 4))

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(600, data.length * (barW + 4))} height={height + 30} style={{ display: 'block' }}>
        {data.map((d, i) => {
          const h = max > 0 ? ((d[valueKey] || 0) / max) * height : 0
          const x = i * (barW + 4) + 2
          const y = height - h
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill={color} opacity={0.85} rx={2} />
              {data.length <= 20 && (
                <text x={x + barW / 2} y={height + 18} textAnchor="middle"
                  fill={T.mut} fontSize={9} fontFamily="DM Mono">
                  {String(d[labelKey] || '').slice(-5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Line Chart ───────────────────────────────────────────────────────────────
export function LineChart({ data, valueKey, labelKey, color = '#f0c040', height = 180, T, width = 600 }) {
  if (!data || data.length < 2) return <Empty T={T} />
  const max = Math.max(...data.map(d => d[valueKey] || 0)) || 1
  const pad = { l: 50, r: 10, t: 10, b: 30 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b

  const pts = data.map((d, i) => ({
    x: pad.l + (i / (data.length - 1)) * w,
    y: pad.t + h - ((d[valueKey] || 0) / max) * h,
    label: d[labelKey],
    val: d[valueKey]
  }))

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  // Y axis labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: pad.t + h - t * h,
    val: max * t
  }))

  return (
    <svg width={width} height={height} style={{ display: 'block', width: '100%' }}>
      {/* Grid lines */}
      {yTicks.map((tick, i) => (
        <g key={i}>
          <line x1={pad.l} y1={tick.y} x2={pad.l + w} y2={tick.y}
            stroke={T.border} strokeWidth={1} />
          <text x={pad.l - 4} y={tick.y + 3} textAnchor="end"
            fill={T.mut} fontSize={9} fontFamily="DM Mono">
            {tick.val >= 1000 ? `${(tick.val/1000).toFixed(0)}K` : tick.val.toFixed(0)}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path
        d={`${d} L${pts[pts.length-1].x},${pad.t+h} L${pts[0].x},${pad.t+h} Z`}
        fill={color} opacity={0.08}
      />

      {/* Line */}
      <path d={d} fill="none" stroke={color} strokeWidth={2} />

      {/* Dots and labels */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} />
          {(data.length <= 12) && (
            <text x={p.x} y={pad.t + h + 20} textAnchor="middle"
              fill={T.mut} fontSize={9} fontFamily="DM Mono">
              {String(p.label || '').slice(-7)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
export function DonutChart({ data, valueKey, labelKey, colors, T, size = 180 }) {
  if (!data || data.length === 0) return <Empty T={T} />
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)
  if (total === 0) return <Empty T={T} />

  const cx = size / 2, cy = size / 2
  const R = size * 0.38, r = size * 0.22
  let angle = -Math.PI / 2

  const slices = data.map((d, i) => {
    const pct = (d[valueKey] || 0) / total
    const a = pct * 2 * Math.PI
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle)
    angle += a
    const x2 = cx + R * Math.cos(angle), y2 = cy + R * Math.sin(angle)
    const xi1 = cx + r * Math.cos(angle - a), yi1 = cy + r * Math.sin(angle - a)
    const xi2 = cx + r * Math.cos(angle), yi2 = cy + r * Math.sin(angle)
    const large = a > Math.PI ? 1 : 0
    return {
      path: `M${x1},${y1} A${R},${R},0,${large},1,${x2},${y2} L${xi2},${yi2} A${r},${r},0,${large},0,${xi1},${yi1} Z`,
      color: colors ? colors[i % colors.length] : '#f0c040',
      label: d[labelKey], pct: Math.round(pct * 100),
      val: d[valueKey]
    }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} opacity={0.9} />
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: T.txt }}>{s.label}</span>
            <span style={{ fontSize: 11, color: T.mut, marginLeft: 'auto', paddingLeft: 8 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Horizontal Bar Chart ─────────────────────────────────────────────────────
export function HBarChart({ data, valueKey, labelKey, color = '#f0c040', T, maxRows = 15 }) {
  const rows = data.slice(0, maxRows)
  const max = Math.max(...rows.map(d => d[valueKey] || 0)) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map((d, i) => {
        const pct = ((d[valueKey] || 0) / max) * 100
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 120, fontSize: 10, color: T.txt, textAlign: 'right',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0
            }}>
              {d[labelKey]}
            </div>
            <div style={{ flex: 1, background: T.border, borderRadius: 2, height: 14, position: 'relative' }}>
              <div style={{
                width: `${pct}%`, background: color, height: '100%',
                borderRadius: 2, opacity: 0.85
              }} />
            </div>
            <div style={{ width: 70, fontSize: 10, color: T.mut, textAlign: 'right', flexShrink: 0 }}>
              {Number(d[valueKey]).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Empty({ T }) {
  return <div style={{ padding: 20, color: T.mut, fontSize: 11, textAlign: 'center' }}>Sin datos</div>
}
