import React, { useMemo } from 'react';
import { usePedidos } from '../../hooks/usePedidos';
import { esEntrega, esError, hoy, formatFecha, ultimosCinco } from '../../utils/remitos';

export default function TabAnomalias({ remitos }) {
  const { pedidosConEstado, entregas, todos } = usePedidos(remitos);
  const hoyStr = hoy();

  const { sinConfirmar, sinRef, errores } = useMemo(() => {
    // 1. Recepciones sin confirmar en el día
    const sinConfirmar = entregas.filter(e => e.fecha === hoyStr && e.estado === 'En tránsito');

    // 2. Entregas sin referencia a pedido
    const pedidoTags = new Set(pedidosConEstado.map(p => ultimosCinco(p.remito)));
    const sinRef = entregas.filter(e => {
      if (!esEntrega(e.categoria)) return false;
      const hasTag = e.obs && [...pedidoTags].some(t => e.obs.includes(t));
      if (hasTag) return false;
      // Fallback: match por artículo/sucursal
      const pMatch = pedidosConEstado.find(p =>
        p.origen === e.destino &&
        e.fecha >= p.fecha &&
        e.lineas.some(el => p.lineas.some(pl => pl.cod === el.cod))
      );
      return !pMatch;
    });

    // 3. Errores de remito
    const errores = todos.filter(r => {
      if (!esError(r.categoria)) return false;
      const sinResolver = r.estado === 'En tránsito';
      const hasTag = r.obs && [...pedidoTags].some(t => r.obs.includes(t));
      return sinResolver || !hasTag;
    });

    return { sinConfirmar, sinRef, errores };
  }, [pedidosConEstado, entregas, todos, hoyStr]);

  const total = sinConfirmar.length + sinRef.length + errores.length;

  return (
    <div>
      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <AnomaliaKPI label="Recepciones sin confirmar" value={sinConfirmar.length} color="var(--naranja)" />
        <AnomaliaKPI label="Entregas sin referencia" value={sinRef.length} color="var(--ambar)" />
        <AnomaliaKPI label="Errores sin resolver" value={errores.length} color="var(--rojo)" />
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <div style={{ color: 'var(--verde)', fontFamily: 'var(--font-syne)', fontSize: 18 }}>Sin anomalías detectadas</div>
          <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>Todos los remitos están en orden</div>
        </div>
      ) : (
        <>
          {/* 1. Recepciones sin confirmar */}
          {sinConfirmar.length > 0 && (
            <AnomaliaSection
              titulo="Recepciones sin confirmar hoy"
              descripcion="Remitos de entrega en estado 'En tránsito' del día. Deben cerrarse antes del cierre."
              color="var(--naranja)"
              items={sinConfirmar}
              renderItem={r => (
                <div key={r.remito} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.remito}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {r.origen} → {r.destino} · {r.hora}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
                    <div>{r.lineas.length} artículos</div>
                    <div>{r.lineas.reduce((s,l) => s + Number(l.cant||0), 0)} uds</div>
                  </div>
                  <span className="badge badge-naranja">En tránsito</span>
                </div>
              )}
            />
          )}

          {/* 2. Sin referencia */}
          {sinRef.length > 0 && (
            <AnomaliaSection
              titulo="Entregas sin referencia a pedido"
              descripcion="Remitos de entrega cuyas observaciones no referencian ningún pedido conocido y no pudieron matchearse por artículo/sucursal."
              color="var(--ambar)"
              items={sinRef}
              renderItem={r => (
                <div key={r.remito} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.remito}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {r.origen} → {r.destino} · {formatFecha(r.fecha)}
                    </div>
                    {r.obs && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        Obs: {r.obs}
                      </div>
                    )}
                  </div>
                  <span className={`badge ${r.estado === 'Recibido' ? 'badge-verde' : r.estado === 'En tránsito' ? 'badge-ambar' : 'badge-gray'}`}>
                    {r.estado}
                  </span>
                </div>
              )}
            />
          )}

          {/* 3. Errores */}
          {errores.length > 0 && (
            <AnomaliaSection
              titulo="Errores de remito sin resolver"
              descripcion="Remitos de error (faltantes/sobrantes) que permanecen en tránsito o sin referencia a pedido."
              color="var(--rojo)"
              items={errores}
              renderItem={r => (
                <div key={r.remito} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.remito}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {r.categoria} · {r.origen} → {r.destino} · {formatFecha(r.fecha)}
                    </div>
                    {r.obs && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Obs: {r.obs}</div>}
                  </div>
                  <span className={`badge ${r.estado === 'En tránsito' ? 'badge-rojo' : 'badge-gray'}`}>
                    {r.estado}
                  </span>
                </div>
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

function AnomaliaKPI({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 8 }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: 'var(--font-syne)', fontSize: 36, fontWeight: 700, color: value > 0 ? color : 'var(--verde)' }}>
        {value}
      </div>
    </div>
  );
}

function AnomaliaSection({ titulo, descripcion, color, items, renderItem }) {
  return (
    <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: `rgba(${colorToRgb(color)},0.06)`,
      }}>
        <div style={{ width: 3, height: 24, background: color, borderRadius: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color }}>{titulo}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{descripcion}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-syne)', fontSize: 20, fontWeight: 700, color }}>
          {items.length}
        </div>
      </div>
      <div>
        {items.map((item, i) => (
          <div key={i} style={{
            padding: '10px 16px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

function colorToRgb(cssVar) {
  const map = {
    'var(--naranja)': '251,146,60',
    'var(--ambar)':   '240,192,64',
    'var(--rojo)':    '248,113,113',
    'var(--verde)':   '74,222,128',
  };
  return map[cssVar] || '255,255,255';
}
