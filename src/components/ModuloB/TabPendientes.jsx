import React, { useState, useMemo } from 'react';
import { usePedidos, getComparacion } from '../../hooks/usePedidos';
import { formatFecha } from '../../utils/remitos';

const C = {
  panel:'#111420',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',
  red:'#f87171',blue:'#60a5fa',vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',
  txt:'#e8eaf0',mut:'#6b7280',ambar:'#f0c040',
};

export default function TabPendientes({ remitos }) {
  const { pedidosConEstado, pendientesConsolidados } = usePedidos(remitos);
  const [vista, setVista] = useState('articulo');
  const [expandido, setExpandido] = useState(null);

  const pendientesHoy = useMemo(() =>
    pendientesConsolidados.filter(p => p.pedidos.some(x => x.esHoy)),
  [pendientesConsolidados]);

  const pendientesAnt = useMemo(() =>
    pendientesConsolidados.filter(p => p.pedidos.some(x => !x.esHoy)),
  [pendientesConsolidados]);

  const pedidosPendientes = useMemo(() =>
    pedidosConEstado.filter(p => p.estadoCalculado === 'abierto' || p.estadoCalculado === 'parcial'),
  [pedidosConEstado]);

  if (pendientesConsolidados.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: C.mut }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>✓</div>
        <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 18, color: C.green, marginBottom: 6 }}>Sin pendientes</div>
        <div style={{ fontSize: 13 }}>Todos los pedidos fueron entregados completamente</div>
      </div>
    );
  }

  return (
    <div>
      {/* Toggle vista */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.b2, padding: 4, borderRadius: 6, width: 'fit-content' }}>
        {[['articulo', 'Por artículo'], ['pedido', 'Por pedido']].map(([id, label]) => (
          <button key={id} onClick={() => setVista(id)} style={{
            padding: '5px 16px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
            background: vista === id ? C.acc : 'transparent',
            color: vista === id ? '#0c0e14' : C.mut, fontWeight: vista === id ? 600 : 400,
            fontFamily: 'DM Mono,monospace',
          }}>{label}</button>
        ))}
      </div>

      {vista === 'articulo' ? (
        <div>
          {/* HOY */}
          {pendientesHoy.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: C.acc, letterSpacing: '.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                PENDIENTES HOY
                <div style={{ flex: 1, height: 1, background: C.b1 }} />
                <span style={{ color: C.mut }}>{pendientesHoy.length} artículos</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8 }}>
                {pendientesHoy.map(item => (
                  <div key={item.cod} style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.txt, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
                        <div style={{ fontSize: 9, color: C.mut, marginTop: 2 }}>{item.cod}</div>
                      </div>
                      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 24, fontWeight: 700, color: C.ambar, marginLeft: 8 }}>{item.cant}</div>
                    </div>
                    <div style={{ fontSize: 9, color: C.mut }}>
                      {item.pedidos.filter(p=>p.esHoy).map(p =>
                        <span key={p.remito} style={{ marginRight: 8 }}>{p.sucursal} · {p.pendiente}u</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ANTERIORES */}
          {pendientesAnt.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                ACUMULADO DE DÍAS ANTERIORES
                <div style={{ flex: 1, height: 1, background: C.b1 }} />
                <span style={{ color: C.red }}>{pendientesAnt.length} artículos</span>
              </div>
              <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {[['CÓDIGO',C.mut,80],['DESCRIPCIÓN',C.mut,'auto'],['PEND.',C.ambar,60],['PEDIDOS',C.mut,60],['SUCURSAL',C.mut,120],['FECHA',C.mut,80],['ATRASO',C.red,60]].map(([h,c,w])=>(
                        <th key={h} style={{ fontSize: 8, color: c, padding: '6px 8px', background: C.b2, borderBottom: `1px solid ${C.b1}`, textAlign: 'left', fontWeight: 400, letterSpacing: '.06em', width: w }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendientesAnt.map(item => {
                      const p = item.pedidos[0];
                      const dias = p ? Math.floor((Date.now() - new Date(p.fecha).getTime()) / 86400000) : 0;
                      return (
                        <tr key={item.cod} style={{ borderBottom: `1px solid ${C.b2}` }}>
                          <td style={{ padding: '6px 8px', fontSize: 9, color: C.blue, fontFamily: 'DM Mono,monospace' }}>{item.cod}</td>
                          <td style={{ padding: '6px 8px', fontSize: 10, color: C.txt, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</td>
                          <td style={{ padding: '6px 8px', fontSize: 12, color: C.ambar, fontWeight: 700, textAlign: 'right' }}>{item.cant}</td>
                          <td style={{ padding: '6px 8px', fontSize: 10, color: C.mut, textAlign: 'right' }}>{item.pedidos.length}</td>
                          <td style={{ padding: '6px 8px', fontSize: 10, color: C.txt }}>{p?.sucursal || '—'}</td>
                          <td style={{ padding: '6px 8px', fontSize: 10, color: C.mut }}>{p ? formatFecha(p.fecha) : '—'}</td>
                          <td style={{ padding: '6px 8px', fontSize: 10, color: dias > 3 ? C.red : C.ambar, fontWeight: 600, textAlign: 'right' }}>
                            {dias}d
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Vista por pedido */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pedidosPendientes.map(pedido => {
            const comp = getComparacion(pedido, pedido.entregasAsociadas);
            const pendientes = comp.filter(x => x.pendiente > 0);
            const isOpen = expandido === pedido.remito;
            return (
              <div key={pedido.remito} style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, overflow: 'hidden' }}>
                <div onClick={() => setExpandido(isOpen ? null : pedido.remito)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderLeft: `3px solid ${pedido.estadoCalculado === 'parcial' ? C.ambar : C.azul}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.txt, fontFamily: 'DM Mono,monospace' }}>{pedido.remito}</div>
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>{pedido.origen} → {pedido.destino} · {formatFecha(pedido.fecha)}</div>
                  </div>
                  <div style={{ fontSize: 10, color: C.ambar }}>{pendientes.length} art. pend.</div>
                  <div style={{ fontSize: 16, color: C.mut }}>{isOpen ? '▲' : '▼'}</div>
                </div>
                {isOpen && (
                  <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.b1}`, background: C.b2 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['CÓDIGO','DESCRIPCIÓN','PEDIDA','ENTREGADA','PENDIENTE'].map(h => (
                            <th key={h} style={{ fontSize: 8, color: C.mut, padding: '4px 6px', textAlign: h==='CÓDIGO'||h==='DESCRIPCIÓN'?'left':'right', fontWeight: 400, letterSpacing: '.06em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pendientes.map(item => (
                          <tr key={item.cod} style={{ borderTop: `1px solid ${C.b1}` }}>
                            <td style={{ padding: '4px 6px', fontSize: 9, color: C.blue, fontFamily: 'DM Mono,monospace' }}>{item.cod}</td>
                            <td style={{ padding: '4px 6px', fontSize: 10, color: C.txt }}>{item.desc}</td>
                            <td style={{ padding: '4px 6px', fontSize: 10, textAlign: 'right' }}>{item.pedida}</td>
                            <td style={{ padding: '4px 6px', fontSize: 10, textAlign: 'right', color: C.green }}>{item.entregada}</td>
                            <td style={{ padding: '4px 6px', fontSize: 11, textAlign: 'right', color: C.ambar, fontWeight: 700 }}>{item.pendiente}</td>
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
      )}
    </div>
  );
}
