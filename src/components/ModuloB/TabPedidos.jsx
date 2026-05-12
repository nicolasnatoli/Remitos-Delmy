import React, { useState, useMemo } from 'react';
import { usePedidos, getComparacion, groupByFecha } from '../../hooks/usePedidos';
import { getEstadoConfig, formatFecha } from '../../utils/remitos';
import { expandirLineasConCombos } from '../../utils/db';

export default function TabPedidos({ remitos, combos }) {
  const { pedidosConEstado } = usePedidos(remitos);
  const [expandido, setExpandido] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [busqueda, setBusqueda] = useState('');

  const filtrados = useMemo(() => {
    let list = pedidosConEstado;
    if (filtroEstado !== 'todos') list = list.filter(p => p.estadoCalculado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      list = list.filter(p =>
        p.remito.toLowerCase().includes(q) ||
        p.origen.toLowerCase().includes(q) ||
        p.destino.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q)
      );
    }
    return list;
  }, [pedidosConEstado, filtroEstado, busqueda]);

  const grupos = useMemo(() => groupByFecha(filtrados), [filtrados]);

  const totalPedidos     = pedidosConEstado.length;
  const confirmados      = pedidosConEstado.filter(p => p.estado === 'Anulado').length;
  const sinConfirmar     = totalPedidos - confirmados;

  return (
    <div>
      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total', value: totalPedidos, color: 'var(--text)' },
          { label: 'Sin confirmar', value: sinConfirmar, color: 'var(--azul)' },
          { label: 'Confirmados', value: confirmados, color: 'var(--text-2)' },
          { label: 'Abiertos', value: pedidosConEstado.filter(p=>p.estadoCalculado==='abierto').length, color: 'var(--azul)' },
          { label: 'Parciales', value: pedidosConEstado.filter(p=>p.estadoCalculado==='parcial').length, color: 'var(--ambar)' },
          { label: 'Con faltantes', value: pedidosConEstado.filter(p=>p.estadoCalculado==='con_faltantes').length, color: 'var(--rojo)' },
          { label: 'Completos', value: pedidosConEstado.filter(p=>p.estadoCalculado==='completo').length, color: 'var(--verde)' },
        ].map(item => (
          <div key={item.label} className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 4 }}>{item.label.toUpperCase()}</div>
            <div style={{ fontFamily: 'var(--font-syne)', fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por remito, sucursal, categoría..."
          style={{ flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 12 }}
        />
        {['todos','sin_confirmar','abierto','parcial','con_faltantes','completo'].map(est => {
          const cfg = getEstadoConfig(est);
          return (
            <button key={est} onClick={() => setFiltroEstado(est)} style={{
              background: filtroEstado === est ? `rgba(var(--${cfg.color === 'gray' ? 'text' : cfg.color}),0.15)` : 'transparent',
              color: filtroEstado === est ? `var(--${cfg.color})` : 'var(--text-3)',
              border: `1px solid ${filtroEstado === est ? `var(--${cfg.color})` : 'var(--border)'}`,
              borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}>
              {est === 'todos' ? 'Todos' : cfg.label}
            </button>
          );
        })}
      </div>

      {/* Lista por secciones */}
      {[
        { key: 'hoy',        label: 'HOY' },
        { key: 'ayer',       label: 'AYER' },
        { key: 'anteriores', label: 'ANTERIORES' },
      ].map(({ key, label }) => {
        const lista = grupos[key];
        if (!lista || lista.length === 0) return null;
        return (
          <div key={key} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-3)',
              marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {label}
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span>{lista.length}</span>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              {lista.map((pedido, idx) => (
                <PedidoRow
                  key={pedido.remito}
                  pedido={pedido}
                  combos={combos}
                  isLast={idx === lista.length - 1}
                  isExpanded={expandido === pedido.remito}
                  onToggle={() => setExpandido(expandido === pedido.remito ? null : pedido.remito)}
                  showFecha={key === 'anteriores'}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filtrados.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)', fontSize: 13 }}>
          Sin pedidos que coincidan con los filtros
        </div>
      )}
    </div>
  );
}

function PedidoRow({ pedido, combos, isLast, isExpanded, onToggle, showFecha }) {
  // Expandir combos en las líneas para el detalle
  const lineasExpandidas = useMemo(() =>
    expandirLineasConCombos(pedido.lineas || [], combos || {}),
  [pedido.lineas, combos]);
  const cfg = getEstadoConfig(pedido.estadoCalculado);
  const totalPedido   = pedido.lineas.reduce((s,l) => s + Number(l.cant||0), 0);
  const totalEntregado = pedido.entregasAsociadas.reduce((s,e) =>
    s + e.lineas.reduce((ss,l) => ss + Number(l.cant||0), 0), 0);
  const comparacion = isExpanded ? getComparacion(pedido, pedido.entregasAsociadas) : null;

  const dotColor = {
    sin_confirmar: 'var(--azul)',
    abierto: 'var(--azul)',
    parcial: 'var(--ambar)',
    con_faltantes: 'var(--rojo)',
    completo: 'var(--verde)',
  }[pedido.estadoCalculado] || 'var(--text-3)';

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', cursor: 'pointer',
          borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--border)',
          background: isExpanded ? 'rgba(240,192,64,0.04)' : 'transparent',
          transition: 'background var(--transition)',
        }}
      >
        {/* Color dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />

        {/* Fecha (solo anteriores) */}
        {showFecha && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', width: 60, flexShrink: 0 }}>
            {formatFecha(pedido.fecha)}
          </div>
        )}

        {/* Remito */}
        <div style={{ fontSize: 12, color: 'var(--text-2)', width: 140, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
          {pedido.remito}
        </div>

        {/* Ruta */}
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--text-2)' }}>{pedido.origen}</span>
          <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>→</span>
          <span>{pedido.destino}</span>
        </div>

        {/* Categoría */}
        <div style={{ fontSize: 10, color: 'var(--text-3)', width: 180, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pedido.categoria}
        </div>

        {/* Stats */}
        <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right', flexShrink: 0 }}>
          <div>{pedido.lineas.length} arts · {totalPedido} uds</div>
          {pedido.entregasAsociadas.length > 0 && (
            <div style={{ color: 'var(--verde)' }}>▸ {totalEntregado} entregadas</div>
          )}
        </div>

        {/* Badge */}
        <span className={`badge ${cfg.badge}`} style={{ flexShrink: 0 }}>
          {cfg.label}
        </span>

        {/* Toggle */}
        <div style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>
          {isExpanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && comparacion && (
        <div style={{
          background: 'var(--panel-2)', borderBottom: isLast ? 'none' : '1px solid var(--border)',
          padding: '14px 20px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Comparación artículos con combos expandidos */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 8, display:'flex', justifyContent:'space-between' }}>
                <span>DETALLE DE ARTÍCULOS</span>
                {lineasExpandidas.some(l=>l.esCombo) && <span style={{color:'var(--violeta)',fontSize:9}}>⊕ combos expandidos</span>}
              </div>
              <table>
                <thead>
                  <tr>
                    <th>CÓDIGO</th>
                    <th>DESCRIPCIÓN</th>
                    <th style={{ textAlign: 'right' }}>PEDIDA</th>
                    <th style={{ textAlign: 'right' }}>ENTREGADA</th>
                    <th style={{ textAlign: 'right' }}>PENDIENTE</th>
                  </tr>
                </thead>
                <tbody>
                  {comparacion.map(item => (
                    <tr key={item.cod} style={{background: item.pendiente>0?'rgba(240,192,64,.04)':'transparent'}}>
                      <td style={{ fontSize: 11, color: 'var(--text-2)', fontFamily:'var(--font-mono)' }}>{item.cod}</td>
                      <td style={{ fontSize: 11 }}>
                        {item.desc}
                        {lineasExpandidas.find(l=>l.cod===item.cod&&l.esCombo) && (
                          <span style={{fontSize:9,color:'var(--violeta)',marginLeft:5}}>⊕ {lineasExpandidas.find(l=>l.cod===item.cod&&l.esCombo)?.descCombo?.slice(0,20)}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{item.pedida}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--verde)' }}>{item.entregada}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: item.pendiente > 0 ? 'var(--ambar)' : 'var(--verde)', fontWeight: item.pendiente > 0 ? 600 : 400 }}>
                        {item.pendiente > 0 ? item.pendiente : '✓'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Entregas asociadas */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 8 }}>
                REMITOS DE ENTREGA ({pedido.entregasAsociadas.length})
              </div>
              {pedido.entregasAsociadas.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Sin entregas asociadas</div>
              ) : (
                pedido.entregasAsociadas.map(e => (
                  <div key={e.remito} style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    padding: '8px 12px', marginBottom: 6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{e.remito}</span>
                      <span className={`badge ${e.estado === 'Recibido' ? 'badge-verde' : e.estado === 'En tránsito' ? 'badge-ambar' : 'badge-gray'}`}>
                        {e.estado}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                      {e.categoria} · {formatFecha(e.fecha)}
                    </div>
                    {e.obs && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Obs: {e.obs}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
