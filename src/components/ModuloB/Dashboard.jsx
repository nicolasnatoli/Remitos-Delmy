import React, { useMemo, useState } from 'react';
import { usePedidos } from '../../hooks/usePedidos';
import { hoy } from '../../utils/remitos';

const C = {
  bg:'#0c0e14',panel:'#111420',b1:'#1e2133',b2:'#181b27',
  acc:'#f0c040',green:'#4ade80',red:'#f87171',blue:'#60a5fa',
  vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',txt:'#e8eaf0',mut:'#6b7280',
  ambar:'#f0c040',azul:'#60a5fa',rojo:'#f87171',verde:'#4ade80',
};

function KPICard({ label, value, sub, color, accent }) {
  return (
    <div style={{
      background: accent ? `rgba(${accent},.06)` : C.panel,
      border: `1px solid ${accent ? `rgba(${accent},.25)` : C.b1}`,
      borderRadius: 8, padding: '14px 16px',
      borderTop: `3px solid ${color || C.mut}`,
    }}>
      <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 28, fontWeight: 700, color: color || C.txt, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.mut, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Alerta({ tipo, titulo, sub }) {
  const s = {
    err:  { bg:'rgba(248,113,113,.08)', border:'rgba(248,113,113,.25)', icon:'✕', c:C.red },
    warn: { bg:'rgba(240,192,64,.08)',  border:'rgba(240,192,64,.25)',  icon:'⚠', c:C.acc },
    ok:   { bg:'rgba(74,222,128,.08)',  border:'rgba(74,222,128,.25)',  icon:'✓', c:C.green },
  }[tipo] || {};
  return (
    <div style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:6, padding:'8px 12px', display:'flex', alignItems:'flex-start', gap:8 }}>
      <span style={{ color:s.c, fontSize:14, flexShrink:0, marginTop:1 }}>{s.icon}</span>
      <div>
        <div style={{ color:s.c, fontSize:11, fontWeight:600 }}>{titulo}</div>
        {sub && <div style={{ color:C.mut, fontSize:10, marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard({ remitos }) {
  const { pedidosConEstado, kpis, anomalias, pendientesConsolidados } = usePedidos(remitos);
  const hoyStr = hoy();
  const [expandSuc, setExpandSuc] = useState(null);

  // Pedidos por sucursal
  const porSucursal = useMemo(() => {
    const m = {};
    for (const p of pedidosConEstado) {
      const suc = p.origen || 'Sin sucursal';
      if (!m[suc]) m[suc] = { suc, total: 0, abiertos: 0, parciales: 0, completos: 0, conFaltantes: 0 };
      m[suc].total++;
      if (p.estadoCalculado === 'abierto') m[suc].abiertos++;
      else if (p.estadoCalculado === 'parcial') m[suc].parciales++;
      else if (p.estadoCalculado === 'completo') m[suc].completos++;
      else if (p.estadoCalculado === 'con_faltantes') m[suc].conFaltantes++;
    }
    return Object.values(m).sort((a, b) => (b.abiertos + b.parciales) - (a.abiertos + a.parciales));
  }, [pedidosConEstado]);

  // Últimos 7 días de actividad
  const actividadSemanal = useMemo(() => {
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : d.toLocaleDateString('es-AR', { weekday: 'short' });
      const pedidos = pedidosConEstado.filter(p => p.fecha === iso).length;
      dias.push({ iso, label, pedidos });
    }
    return dias;
  }, [pedidosConEstado]);

  const maxPedidos = Math.max(...actividadSemanal.map(d => d.pedidos), 1);

  const { recepcionesSinConfirmar, entregasSinReferencia, erroresSinResolver } = anomalias;
  const totalAnomalias = recepcionesSinConfirmar.length + entregasSinReferencia.length + erroresSinResolver.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        <KPICard label="Pedidos total"    value={kpis.total}        color={C.txt}   sub={`${kpis.hoy} hoy`} />
        <KPICard label="Sin confirmar"    value={kpis.sinConfirmar} color={C.azul}  sub="no anulados aún" />
        <KPICard label="Abiertos"         value={kpis.abiertos}     color={C.azul}  sub="sin entrega" />
        <KPICard label="Parciales"        value={kpis.parciales}    color={C.ambar} sub="entrega incompleta" />
        <KPICard label="Con faltantes"    value={kpis.conFaltantes} color={C.rojo}  sub="cerrados con CR" />
        <KPICard label="Completos"        value={kpis.completos}    color={C.verde} sub="entrega total" />
      </div>

      {/* Alertas */}
      {totalAnomalias > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Alertas activas</div>
          {recepcionesSinConfirmar.length > 0 && (
            <Alerta tipo="warn"
              titulo={`${recepcionesSinConfirmar.length} recepción(es) sin confirmar del día — deben cerrarse antes del corte`}
              sub={recepcionesSinConfirmar.slice(0,3).map(e => e.remito).join(' · ')} />
          )}
          {entregasSinReferencia.length > 0 && (
            <Alerta tipo="warn"
              titulo={`${entregasSinReferencia.length} entrega(s) sin referencia a pedido conocido`}
              sub="Sin tag en observaciones y sin match por artículo/sucursal" />
          )}
          {erroresSinResolver.length > 0 && (
            <Alerta tipo="err"
              titulo={`${erroresSinResolver.length} error(es) de remito sin resolver`}
              sub="Faltantes o sobrantes aún en tránsito" />
          )}
        </div>
      )}
      {totalAnomalias === 0 && kpis.total > 0 && (
        <Alerta tipo="ok" titulo="Sin anomalías activas — operación normal" />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* Estado general + gráfico semanal */}
        <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Estado de pedidos</div>
          {[
            { k:'sin_confirmar', l:'Sin confirmar', v:kpis.sinConfirmar, c:C.azul },
            { k:'abierto',       l:'Abiertos',      v:kpis.abiertos,     c:C.azul },
            { k:'parcial',       l:'Parciales',      v:kpis.parciales,    c:C.ambar },
            { k:'con_faltantes', l:'Con faltantes',  v:kpis.conFaltantes, c:C.rojo },
            { k:'completo',      l:'Completos',      v:kpis.completos,    c:C.verde },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 90, fontSize: 11, color: C.txt, flexShrink: 0 }}>{l}</div>
              <div style={{ flex: 1, height: 5, background: C.b1, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${kpis.total ? (v/kpis.total)*100 : 0}%`, height: '100%', background: c, borderRadius: 3 }} />
              </div>
              <div style={{ width: 28, textAlign: 'right', fontSize: 14, fontFamily: 'Syne,sans-serif', fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.b1}`, marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', marginBottom: 8 }}>ACTIVIDAD ÚLTIMOS 7 DÍAS</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48 }}>
              {actividadSemanal.map(d => (
                <div key={d.iso} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ width: '100%', background: d.iso === hoyStr ? C.acc : C.azul, borderRadius: '3px 3px 0 0',
                    height: `${Math.round((d.pedidos / maxPedidos) * 40)}px`, minHeight: d.pedidos > 0 ? 4 : 0, opacity: d.iso === hoyStr ? 1 : 0.5 }} />
                  <div style={{ fontSize: 8, color: C.mut }}>{d.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Por sucursal */}
        <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Pedidos por sucursal
          </div>
          {porSucursal.length === 0 && <div style={{ color: C.mut, fontSize: 12 }}>Sin datos</div>}
          {porSucursal.map(s => (
            <div key={s.suc} onClick={() => setExpandSuc(expandSuc === s.suc ? null : s.suc)}
              style={{ marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.txt, flex: 1 }}>{s.suc}</span>
                {s.abiertos > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(96,165,250,.15)', color: C.azul }}>{s.abiertos} abiertos</span>}
                {s.parciales > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(240,192,64,.15)', color: C.ambar }}>{s.parciales} parciales</span>}
                {s.conFaltantes > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(248,113,113,.15)', color: C.rojo }}>{s.conFaltantes} CR</span>}
                <span style={{ fontSize: 10, color: C.mut }}>{s.total}</span>
              </div>
              <div style={{ height: 4, background: C.b1, borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                {s.abiertos > 0 && <div style={{ flex: s.abiertos, background: C.azul }} />}
                {s.parciales > 0 && <div style={{ flex: s.parciales, background: C.ambar }} />}
                {s.conFaltantes > 0 && <div style={{ flex: s.conFaltantes, background: C.rojo }} />}
                {s.completos > 0 && <div style={{ flex: s.completos, background: C.verde }} />}
              </div>
              {expandSuc === s.suc && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: C.b2, borderRadius: 4, fontSize: 10, color: C.mut }}>
                  Completos: {s.completos} · Abiertos: {s.abiertos} · Parciales: {s.parciales} · CR: {s.conFaltantes}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pendientes consolidados */}
      {pendientesConsolidados.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Top artículos pendientes de entrega ({pendientesConsolidados.length} distintos)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
            {pendientesConsolidados.slice(0, 12).map(item => (
              <div key={item.cod} style={{ background: C.b2, border: `1px solid ${C.b1}`, borderRadius: 6, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
                  <div style={{ fontSize: 9, color: C.mut, marginTop: 2 }}>{item.cod} · {item.pedidos.length} pedido{item.pedidos.length > 1 ? 's' : ''}</div>
                </div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 700, color: C.ambar, marginLeft: 8, flexShrink: 0 }}>{item.cant}</div>
              </div>
            ))}
          </div>
          {pendientesConsolidados.length > 12 && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.mut, textAlign: 'center' }}>
              +{pendientesConsolidados.length - 12} artículos más — ver tab Pendientes
            </div>
          )}
        </div>
      )}

    </div>
  );
}
