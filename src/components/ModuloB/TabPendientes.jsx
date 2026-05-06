import React, { useState, useMemo } from 'react';
import { usePedidos, getComparacion } from '../../hooks/usePedidos';
import { storage, KEYS } from '../../utils/storage';
import { hoy, formatFecha } from '../../utils/remitos';

export default function TabPendientes({ remitos }) {
  const { pedidosConEstado } = usePedidos(remitos);
  const [viewMode, setViewMode] = useState('articulo'); // articulo | pedido
  const [expandido, setExpandido] = useState(null);
  const hoyStr = hoy();

  // Calcular pendientes del día y acumulado
  const { pendientesHoy, pendientesPedidosHoy, acumulado } = useMemo(() => {
    const pedidosPendientes = pedidosConEstado.filter(p =>
      ['abierto', 'parcial'].includes(p.estadoCalculado)
    );

    const hoyItems = pedidosPendientes.filter(p => p.fecha === hoyStr);
    const anterItems = pedidosPendientes.filter(p => p.fecha < hoyStr);

    // Vista por artículo (hoy)
    const artMap = {};
    for (const p of hoyItems) {
      const comp = getComparacion(p, p.entregasAsociadas);
      for (const item of comp) {
        if (item.pendiente <= 0) continue;
        if (!artMap[item.cod]) artMap[item.cod] = { cod: item.cod, desc: item.desc, cant: 0, npedidos: 0 };
        artMap[item.cod].cant += item.pendiente;
        artMap[item.cod].npedidos++;
      }
    }
    const pendientesHoy = Object.values(artMap).sort((a,b) => b.cant - a.cant);

    // Vista por pedido (hoy)
    const pendientesPedidosHoy = hoyItems.map(p => ({
      ...p,
      articulosPendientes: getComparacion(p, p.entregasAsociadas).filter(i => i.pendiente > 0),
    }));

    // Acumulado (días anteriores)
    const storedAcum = storage.get(KEYS.ACUMULADO, []);
    const acumMap = {};

    // Agregar del storage
    for (const item of storedAcum) {
      const key = `${item.cod}__${item.nPedido}`;
      acumMap[key] = item;
    }

    // Agregar pendientes de días anteriores (no del storage aún)
    for (const p of anterItems) {
      const comp = getComparacion(p, p.entregasAsociadas);
      for (const item of comp) {
        if (item.pendiente <= 0) continue;
        const key = `${item.cod}__${p.remito}`;
        if (!acumMap[key]) {
          acumMap[key] = {
            cod: item.cod, desc: item.desc, cant: item.pendiente,
            nPedido: p.remito, sucursal: p.origen, fecha: p.fecha,
          };
        }
      }
    }

    const diasAtraso = (fechaStr) => {
      const d1 = new Date(fechaStr);
      const d2 = new Date(hoyStr);
      return Math.floor((d2 - d1) / 86400000);
    };

    const acumulado = Object.values(acumMap)
      .map(i => ({ ...i, diasAtraso: diasAtraso(i.fecha || hoyStr) }))
      .sort((a,b) => b.diasAtraso - a.diasAtraso);

    return { pendientesHoy, pendientesPedidosHoy, acumulado };
  }, [pedidosConEstado, hoyStr]);

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', width: 'fit-content' }}>
        {[
          { id: 'articulo', label: '▤ Por artículo' },
          { id: 'pedido',   label: '◈ Por pedido' },
        ].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} style={{
            background: viewMode === v.id ? 'rgba(240,192,64,0.12)' : 'transparent',
            color: viewMode === v.id ? 'var(--accent)' : 'var(--text-3)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            padding: '7px 16px',
            borderRight: v.id === 'articulo' ? '1px solid var(--border)' : 'none',
          }}>{v.label}</button>
        ))}
      </div>

      {/* SECCIÓN HOY */}
      <div style={{ marginBottom: 8, fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 10 }}>
        PENDIENTES HOY
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        {viewMode === 'articulo' ? `${pendientesHoy.length} artículos` : `${pendientesPedidosHoy.length} pedidos`}
      </div>

      {viewMode === 'articulo' ? (
        <div className="card" style={{ marginBottom: 24 }}>
          {pendientesHoy.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--verde)', fontSize: 13 }}>✓ Sin artículos pendientes hoy</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>CÓDIGO</th>
                  <th>DESCRIPCIÓN</th>
                  <th style={{ textAlign: 'right' }}>TOTAL PENDIENTE</th>
                  <th style={{ textAlign: 'right' }}>PEDIDOS</th>
                </tr>
              </thead>
              <tbody>
                {pendientesHoy.map(item => (
                  <tr key={item.cod}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-2)' }}>{item.cod}</td>
                    <td style={{ fontSize: 12 }}>{item.desc}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-syne)', fontSize: 18, fontWeight: 700, color: 'var(--ambar)' }}>{item.cant}</td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>{item.npedidos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {pendientesPedidosHoy.length === 0 ? (
            <div className="card" style={{ padding: 20, color: 'var(--verde)', fontSize: 13 }}>✓ Sin pedidos pendientes hoy</div>
          ) : (
            pendientesPedidosHoy.map(p => (
              <PedidoCard
                key={p.remito}
                pedido={p}
                isExpanded={expandido === p.remito}
                onToggle={() => setExpandido(expandido === p.remito ? null : p.remito)}
              />
            ))
          )}
        </div>
      )}

      {/* SEPARADOR ACUMULADO */}
      {acumulado.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontSize: 10, color: 'var(--rojo)', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 10 }}>
            ACUMULADO DE DÍAS ANTERIORES
            <div style={{ flex: 1, height: 1, background: 'rgba(248,113,113,0.3)' }} />
            {acumulado.length} ítems
          </div>
          <div className="card" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>CÓDIGO</th>
                  <th>DESCRIPCIÓN</th>
                  <th style={{ textAlign: 'right' }}>CANT.</th>
                  <th>Nº PEDIDO</th>
                  <th>SUCURSAL</th>
                  <th>FECHA</th>
                  <th style={{ textAlign: 'right' }}>ATRASO</th>
                </tr>
              </thead>
              <tbody>
                {acumulado.map((item, i) => (
                  <tr key={`${item.cod}_${item.nPedido}_${i}`}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{item.cod}</td>
                    <td style={{ fontSize: 11.5 }}>{item.desc}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--rojo)' }}>{item.cant}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{item.nPedido}</td>
                    <td style={{ fontSize: 11 }}>{item.sucursal}</td>
                    <td style={{ fontSize: 11 }}>{formatFecha(item.fecha)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`badge ${item.diasAtraso > 3 ? 'badge-rojo' : item.diasAtraso > 1 ? 'badge-ambar' : 'badge-gray'}`}>
                        {item.diasAtraso}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PedidoCard({ pedido, isExpanded, onToggle }) {
  const totalPend = pedido.articulosPendientes.reduce((s,i) => s + i.pendiente, 0);
  return (
    <div className="card" style={{ marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{pedido.remito}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {pedido.origen} → {pedido.destino} · {pedido.categoria}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-syne)', fontSize: 20, fontWeight: 700, color: 'var(--ambar)' }}>{totalPend}</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{pedido.articulosPendientes.length} arts</div>
        </div>
        <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{isExpanded ? '▲' : '▼'}</div>
      </div>
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--panel-2)' }}>
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
              {pedido.articulosPendientes.map(item => (
                <tr key={item.cod}>
                  <td style={{ fontSize: 11, color: 'var(--text-2)' }}>{item.cod}</td>
                  <td style={{ fontSize: 11 }}>{item.desc}</td>
                  <td style={{ textAlign: 'right' }}>{item.pedida}</td>
                  <td style={{ textAlign: 'right', color: 'var(--verde)' }}>{item.entregada}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ambar)' }}>{item.pendiente}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
