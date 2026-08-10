import React, { useState, useMemo } from 'react';
import { usePedidos } from '../../hooks/usePedidos';
import { esContraPedido, esSinPedidoPrevio, formatFecha } from '../../utils/remitos';

const VIA_CONFIG = {
  compra_directa: { label: 'Compra directa', color: 'var(--teal)', desc: 'Del proveedor directo a sucursal, sin pedido interno' },
  contra_pedido:  { label: 'Contra pedido',   color: 'var(--azul)', desc: 'Responde a un pedido interno anulado' },
  sin_pedido:     { label: 'Sin pedido previo', color: 'var(--violeta)', desc: 'Urgencia, teléfono, o cliente en sucursal' },
};

export default function TabEntregas({ remitos }) {
  const { entregas, comprasDirectas, pedidosConEstado } = usePedidos(remitos);
  const [via, setVia] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState(null);

  // Mapa entrega.remito -> pedido que la reclama (para mostrar el link cuando existe)
  const pedidoDeEntrega = useMemo(() => {
    const m = {};
    for (const p of pedidosConEstado) {
      for (const e of p.entregasAsociadas) m[e.remito] = p;
    }
    return m;
  }, [pedidosConEstado]);

  const todas = useMemo(() => {
    const marcadas = [
      ...comprasDirectas.map(e => ({ ...e, via: 'compra_directa' })),
      ...entregas.map(e => ({ ...e, via: esContraPedido(e.categoria) ? 'contra_pedido' : esSinPedidoPrevio(e.categoria) ? 'sin_pedido' : 'otra' })),
    ];
    return marcadas.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [entregas, comprasDirectas]);

  const filtradas = useMemo(() => {
    let list = todas;
    if (via !== 'todas') list = list.filter(e => e.via === via);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      list = list.filter(e =>
        e.remito.toLowerCase().includes(q) ||
        e.origen.toLowerCase().includes(q) ||
        e.destino.toLowerCase().includes(q) ||
        e.lineas.some(l => (l.desc||'').toLowerCase().includes(q) || (l.cod||'').toLowerCase().includes(q))
      );
    }
    return list;
  }, [todas, via, busqueda]);

  const conteos = useMemo(() => ({
    compra_directa: todas.filter(e => e.via === 'compra_directa').length,
    contra_pedido:  todas.filter(e => e.via === 'contra_pedido').length,
    sin_pedido:     todas.filter(e => e.via === 'sin_pedido').length,
  }), [todas]);

  return (
    <div>
      {/* Resumen por vía */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 20 }}>
        {Object.entries(VIA_CONFIG).map(([key, cfg]) => (
          <div key={key} className="card" style={{ padding: '12px 14px', cursor: 'pointer', border: via === key ? `1px solid ${cfg.color}` : undefined }}
               onClick={() => setVia(via === key ? 'todas' : key)}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 4 }}>{cfg.label.toUpperCase()}</div>
            <div style={{ fontFamily: 'var(--font-syne)', fontSize: 22, fontWeight: 700, color: cfg.color }}>{conteos[key]}</div>
            <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4 }}>{cfg.desc}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por remito, sucursal, artículo..."
          style={{ flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 12 }}
        />
        <button onClick={() => setVia('todas')} style={{
          background: via === 'todas' ? 'rgba(240,192,64,0.15)' : 'transparent',
          color: via === 'todas' ? 'var(--accent)' : 'var(--text-3)',
          border: `1px solid ${via === 'todas' ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
        }}>Todas</button>
      </div>

      {/* Lista */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {filtradas.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)', fontSize: 13 }}>
            Sin entregas que coincidan con los filtros
          </div>
        )}
        {filtradas.map((e, idx) => {
          const cfg = VIA_CONFIG[e.via] || { label: e.categoria, color: 'var(--text-3)' };
          const pedidoLink = pedidoDeEntrega[e.remito];
          const isExpanded = expandido === e.remito;
          const totalUds = e.lineas.reduce((s, l) => s + Number(l.cant || 0), 0);
          return (
            <div key={e.remito}>
              <div
                onClick={() => setExpandido(isExpanded ? null : e.remito)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
                  borderBottom: idx === filtradas.length - 1 && !isExpanded ? 'none' : '1px solid var(--border)',
                  background: isExpanded ? 'rgba(240,192,64,0.04)' : 'transparent',
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: 'var(--text-3)', width: 60, flexShrink: 0 }}>{formatFecha(e.fecha)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', width: 140, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{e.remito}</div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--text-2)' }}>{e.origen}</span>
                  <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>→</span>
                  <span>{e.destino}</span>
                </div>
                <span style={{ fontSize: 9, color: cfg.color, flexShrink: 0, width: 110 }}>{cfg.label}</span>
                {pedidoLink && (
                  <span style={{ fontSize: 9, color: 'var(--text-3)', flexShrink: 0 }}>
                    ↳ pedido {pedidoLink.remito}
                  </span>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right', flexShrink: 0, width: 90 }}>
                  {e.lineas.length} arts · {totalUds} uds
                </div>
                <span className={`badge ${
                  e.estado === 'Recibido' ? 'badge-verde' :
                  e.estado === 'Recibido con diferencia' ? 'badge-ambar' :
                  e.estado === 'En tránsito' ? 'badge-ambar' : 'badge-gray'
                }`} style={{ flexShrink: 0 }}>{e.estado}</span>
                <div style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</div>
              </div>
              {isExpanded && (
                <div style={{ background: 'var(--panel-2)', borderBottom: idx === filtradas.length - 1 ? 'none' : '1px solid var(--border)', padding: '14px 20px' }}>
                  {e.obs && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Obs: {e.obs}</div>}
                  <table>
                    <thead>
                      <tr><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th style={{ textAlign: 'right' }}>CANTIDAD</th></tr>
                    </thead>
                    <tbody>
                      {e.lineas.map((l, li) => (
                        <tr key={li}>
                          <td style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{l.cod}</td>
                          <td style={{ fontSize: 11 }}>{l.desc}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{l.cant}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
