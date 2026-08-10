import React, { useState, useMemo } from 'react';
import { usePedidos, groupByRuta, clasificarLineasEntrega } from '../../hooks/usePedidos';
import { esContraPedido, esSinPedidoPrevio, formatFecha } from '../../utils/remitos';

const VIA_CONFIG = {
  compra_directa: { label: 'Compra directa', color: 'var(--teal)', desc: 'Del proveedor directo a sucursal, sin pedido interno' },
  contra_pedido:  { label: 'Contra pedido',   color: 'var(--azul)', desc: 'Responde a un pedido interno anulado' },
  sin_pedido:     { label: 'Sin pedido previo', color: 'var(--violeta)', desc: 'Urgencia, teléfono, o cliente en sucursal' },
};

export default function TabEntregas({ remitos }) {
  const { entregas, comprasDirectas, pedidoDeEntrega } = usePedidos(remitos);
  const [via, setVia] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState(null);

  const todas = useMemo(() => {
    const marcadas = [
      ...comprasDirectas.map(e => ({ ...e, via: 'compra_directa' })),
      ...entregas.map(e => ({ ...e, via: esContraPedido(e.categoria) ? 'contra_pedido' : esSinPedidoPrevio(e.categoria) ? 'sin_pedido' : 'otra' })),
    ];
    return marcadas;
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

  // Agrupado por ruta — mismo criterio que Pedidos, para poder mirar
  // Central→Delmy1 separado de Central→Delmy3.
  const rutas = useMemo(() => {
    const g = groupByRuta(filtradas);
    for (const r of g) r.items.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return g;
  }, [filtradas]);

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

      {/* Lista por ruta */}
      {rutas.map(({ ruta, items }) => {
        const totalUds = items.reduce((s, e) => s + e.lineas.reduce((ss,l)=>ss+Number(l.cant||0),0), 0);
        return (
          <div key={ruta} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 11, letterSpacing: '0.05em', color: 'var(--text-2)', fontFamily: 'var(--font-mono)',
              marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {ruta}
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{items.length} remitos · {totalUds} uds</span>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              {items.map((e, idx) => (
                <EntregaRow
                  key={e.remito}
                  entrega={e}
                  pedidoLink={pedidoDeEntrega[e.remito]}
                  isLast={idx === items.length - 1}
                  isExpanded={expandido === e.remito}
                  onToggle={() => setExpandido(expandido === e.remito ? null : e.remito)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filtradas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)', fontSize: 13 }}>
          Sin entregas que coincidan con los filtros
        </div>
      )}
    </div>
  );
}

function EntregaRow({ entrega: e, pedidoLink, isLast, isExpanded, onToggle }) {
  const cfg = VIA_CONFIG[e.via] || { label: e.categoria, color: 'var(--text-3)' };
  const totalUds = e.lineas.reduce((s, l) => s + Number(l.cant || 0), 0);
  // Separa las líneas de ESTA entrega en "responde a pedido" vs "no
  // solicitadas" — antes venían todas mezcladas en la misma tabla.
  const clasificadas = isExpanded ? clasificarLineasEntrega(e, pedidoLink) : null;

  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
          borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--border)',
          background: isExpanded ? 'rgba(240,192,64,0.04)' : 'transparent',
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
        <div style={{ fontSize: 11, color: 'var(--text-3)', width: 60, flexShrink: 0 }}>{formatFecha(e.fecha)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', width: 140, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{e.remito}</div>
        <span style={{ fontSize: 9, color: cfg.color, flexShrink: 0, width: 110 }}>{cfg.label}</span>
        {pedidoLink && (
          <span style={{ fontSize: 9, color: 'var(--text-3)', flexShrink: 0 }}>↳ pedido {pedidoLink.remito}</span>
        )}
        {e.sucursalConsistente === false && (
          <span style={{ fontSize: 9, color: 'var(--rojo)', flexShrink: 0 }}>⚠ sucursal</span>
        )}
        <div style={{ flex: 1 }} />
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
      {isExpanded && clasificadas && (
        <div style={{ background: 'var(--panel-2)', borderBottom: isLast ? 'none' : '1px solid var(--border)', padding: '14px 20px' }}>
          {e.obs && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>Obs: {e.obs}</div>}

          {clasificadas.respondeAPedido.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'var(--verde)', letterSpacing: '0.07em', marginBottom: 6 }}>
                RESPONDE AL PEDIDO {pedidoLink?.remito} ({clasificadas.respondeAPedido.length})
              </div>
              <table style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th>CÓDIGO</th><th>DESCRIPCIÓN</th>
                    <th style={{textAlign:'right'}}>ESTA ENTREGA</th>
                    <th style={{textAlign:'right'}}>PEDIDO EN TOTAL</th>
                    <th style={{textAlign:'right'}}>PENDIENTE DEL PEDIDO</th>
                  </tr>
                </thead>
                <tbody>
                  {clasificadas.respondeAPedido.map((l, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{l.cod}</td>
                      <td style={{ fontSize: 11 }}>{l.desc}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--verde)' }}>{l.cant}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>{l.pedidaTotal}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: l.pendienteTotal > 0 ? 'var(--ambar)' : 'var(--verde)' }}>
                        {l.pendienteTotal > 0 ? l.pendienteTotal : '✓'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {clasificadas.noSolicitadas.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'var(--rojo)', letterSpacing: '0.07em', marginBottom: 6 }}>
                {pedidoLink ? 'NO SOLICITADAS POR ESE PEDIDO' : 'SIN PEDIDO — TODA LA ENTREGA'} ({clasificadas.noSolicitadas.length})
              </div>
              <table>
                <thead><tr><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th style={{textAlign:'right'}}>CANTIDAD</th></tr></thead>
                <tbody>
                  {clasificadas.noSolicitadas.map((l, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{l.cod}</td>
                      <td style={{ fontSize: 11 }}>{l.desc}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{l.cant}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
