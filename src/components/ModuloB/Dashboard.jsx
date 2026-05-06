import React, { useMemo } from 'react';
import { usePedidos } from '../../hooks/usePedidos';
import { getEstadoConfig, hoy, formatFecha, esEntrega, esError } from '../../utils/remitos';

export default function Dashboard({ remitos }) {
  const { pedidosConEstado, entregas, todos } = usePedidos(remitos);
  const hoyStr = hoy();

  const stats = useMemo(() => {
    const hoyPedidos = pedidosConEstado.filter(p => p.fecha === hoyStr);
    const conteo = { sin_confirmar: 0, abierto: 0, parcial: 0, con_faltantes: 0, completo: 0 };
    for (const p of pedidosConEstado) conteo[p.estadoCalculado] = (conteo[p.estadoCalculado] || 0) + 1;

    // Artículos pendientes del día
    const pendientesHoy = [];
    for (const p of hoyPedidos) {
      if (!['abierto','parcial'].includes(p.estadoCalculado)) continue;
      for (const l of p.lineas) {
        const entregada = p.entregasAsociadas.reduce((s, e) =>
          s + e.lineas.filter(el => el.cod === l.cod).reduce((ss, el) => ss + Number(el.cant), 0), 0);
        const pend = Math.max(0, Number(l.cant) - entregada);
        if (pend > 0) {
          const existing = pendientesHoy.find(x => x.cod === l.cod);
          if (existing) { existing.cant += pend; existing.npedidos++; }
          else pendientesHoy.push({ cod: l.cod, desc: l.desc, cant: pend, npedidos: 1 });
        }
      }
    }

    // Anomalías
    const hoyEntregas = entregas.filter(e => e.fecha === hoyStr);
    const sinConfirmarHoy = hoyEntregas.filter(e => e.estado === 'En tránsito').length;
    const errores = Object.values(remitos).filter(r => esError(r.categoria) && r.estado === 'En tránsito').length;

    return { hoyPedidos, conteo, pendientesHoy, sinConfirmarHoy, errores, totalPedidos: pedidosConEstado.length };
  }, [pedidosConEstado, entregas, remitos, hoyStr]);

  const KPI = ({ label, value, color, sub }) => (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-syne)', fontSize: 32, fontWeight: 700, color: color || 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KPI label="PEDIDOS HOY" value={stats.hoyPedidos.length} sub={`de ${stats.totalPedidos} total`} />
        <KPI label="ABIERTOS"   value={stats.conteo.abierto || 0}        color="var(--azul)"   />
        <KPI label="PARCIALES"  value={stats.conteo.parcial || 0}        color="var(--ambar)"  />
        <KPI label="CON FALTANTES" value={stats.conteo.con_faltantes || 0} color="var(--rojo)" />
        <KPI label="COMPLETOS"  value={stats.conteo.completo || 0}       color="var(--verde)"  />
      </div>

      {/* Alertas */}
      {(stats.sinConfirmarHoy > 0 || stats.errores > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em' }}>ALERTAS ACTIVAS</div>
          {stats.sinConfirmarHoy > 0 && (
            <div style={{
              background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)',
              borderRadius: 'var(--radius)', padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ color: 'var(--naranja)', fontSize: 16 }}>⚠</span>
              <div>
                <div style={{ color: 'var(--naranja)', fontSize: 13, fontWeight: 500 }}>
                  {stats.sinConfirmarHoy} recepciones sin confirmar hoy
                </div>
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  Remitos de entrega en tránsito · Deben cerrarse antes del fin del día
                </div>
              </div>
            </div>
          )}
          {stats.errores > 0 && (
            <div style={{
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 'var(--radius)', padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ color: 'var(--rojo)', fontSize: 16 }}>✕</span>
              <div>
                <div style={{ color: 'var(--rojo)', fontSize: 13, fontWeight: 500 }}>
                  {stats.errores} errores de remito sin resolver
                </div>
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  Faltantes o sobrantes en tránsito
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resumen por estado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Estado de pedidos */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 14 }}>
            ESTADO GENERAL DE PEDIDOS
          </div>
          {[
            ['sin_confirmar', 'Sin confirmar'],
            ['abierto',       'Abiertos'],
            ['parcial',       'Entrega parcial'],
            ['con_faltantes', 'Con faltantes (CR)'],
            ['completo',      'Completos'],
          ].map(([estado, label]) => {
            const cfg = getEstadoConfig(estado);
            const val = stats.conteo[estado] || 0;
            const total = stats.totalPedidos || 1;
            return (
              <div key={estado} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 80, fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>{label}</div>
                <div style={{
                  flex: 1, height: 6, background: 'var(--border)',
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(val/total)*100}%`, height: '100%',
                    background: `var(--${cfg.color})`, borderRadius: 3,
                    transition: 'width 400ms ease',
                  }} />
                </div>
                <div style={{ width: 28, textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-syne)', fontWeight: 700 }}>
                  {val}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pendientes del día */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 14 }}>
            ARTÍCULOS PENDIENTES HOY ({stats.pendientesHoy.length})
          </div>
          {stats.pendientesHoy.length === 0 ? (
            <div style={{ color: 'var(--verde)', fontSize: 13 }}>✓ Sin pendientes hoy</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
              {stats.pendientesHoy.slice(0, 10).map(item => (
                <div key={item.cod} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{item.desc}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{item.cod} · {item.npedidos} pedido{item.npedidos>1?'s':''}</div>
                  </div>
                  <div style={{ fontSize: 16, fontFamily: 'var(--font-syne)', fontWeight: 700, color: 'var(--ambar)', flexShrink: 0, marginLeft: 10 }}>
                    {item.cant}
                  </div>
                </div>
              ))}
              {stats.pendientesHoy.length > 10 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', paddingTop: 4 }}>
                  +{stats.pendientesHoy.length - 10} más
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
