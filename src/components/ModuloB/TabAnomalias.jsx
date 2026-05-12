import React from 'react';
import { usePedidos } from '../../hooks/usePedidos';
import { formatFecha } from '../../utils/remitos';

const C = {
  panel:'#111420',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',
  red:'#f87171',blue:'#60a5fa',teal:'#2dd4bf',ora:'#fb923c',
  txt:'#e8eaf0',mut:'#6b7280',ambar:'#f0c040',azul:'#60a5fa',
};

function SeccionAnomalia({ titulo, items, tipo, render }) {
  const border = { err: C.red, warn: C.ambar, info: C.azul }[tipo];
  if (items.length === 0) return (
    <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: C.mut, marginBottom: 4, fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 11, color: C.green }}>✓ Sin anomalías en esta categoría</div>
    </div>
  );
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.b1}`, display: 'flex', alignItems: 'center', gap: 8, borderLeft: `3px solid ${border}` }}>
        <span style={{ color: border, fontSize: 14 }}>{tipo === 'err' ? '✕' : '⚠'}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.txt }}>{titulo}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: border, fontWeight: 700 }}>{items.length}</span>
      </div>
      <div>{items.map((item, i) => render(item, i))}</div>
    </div>
  );
}

export default function TabAnomalias({ remitos }) {
  const { anomalias } = usePedidos(remitos);
  const { recepcionesSinConfirmar, entregasSinReferencia, erroresSinResolver } = anomalias;

  const totalAnomalias = recepcionesSinConfirmar.length + entregasSinReferencia.length + erroresSinResolver.length;

  const row = (remito, cols) => (
    <div key={remito} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: `1px solid ${C.b2}` }}>
      {cols}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {totalAnomalias === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.mut }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>✓</div>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 18, color: C.green, marginBottom: 6 }}>Sin anomalías</div>
          <div style={{ fontSize: 13 }}>Operación normal — todos los remitos en orden</div>
        </div>
      )}

      {/* 1. Recepciones sin confirmar */}
      <SeccionAnomalia
        titulo="Recepciones sin confirmar en el día"
        items={recepcionesSinConfirmar}
        tipo="warn"
        render={(e, i) => row(e.remito + i, [
          <div key="r" style={{ width: 160, fontSize: 11, color: C.azul, fontFamily: 'DM Mono,monospace', flexShrink: 0 }}>{e.remito}</div>,
          <div key="d" style={{ flex: 1, fontSize: 11, color: C.txt }}>{e.origen} → {e.destino}</div>,
          <div key="f" style={{ fontSize: 10, color: C.mut, flexShrink: 0 }}>{formatFecha(e.fecha)}</div>,
          <span key="s" style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(240,192,64,.15)', color: C.ambar, fontWeight: 600, flexShrink: 0 }}>En tránsito</span>,
        ])}
      />

      {/* 2. Entregas sin referencia */}
      <SeccionAnomalia
        titulo="Entregas sin referencia a pedido conocido"
        items={entregasSinReferencia}
        tipo="warn"
        render={(e, i) => row(e.remito + i, [
          <div key="r" style={{ width: 160, fontSize: 11, color: C.azul, fontFamily: 'DM Mono,monospace', flexShrink: 0 }}>{e.remito}</div>,
          <div key="d" style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.txt }}>{e.origen} → {e.destino}</div>
            <div style={{ fontSize: 9, color: C.mut, marginTop: 2 }}>Cat: {e.categoria} · Obs: {e.obs || '—'}</div>
          </div>,
          <div key="f" style={{ fontSize: 10, color: C.mut, flexShrink: 0 }}>{formatFecha(e.fecha)}</div>,
          <span key="s" style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(248,113,113,.15)', color: C.red, flexShrink: 0 }}>Sin referencia</span>,
        ])}
      />

      {/* 3. Errores sin resolver */}
      <SeccionAnomalia
        titulo="Errores de remito sin resolver"
        items={erroresSinResolver}
        tipo="err"
        render={(e, i) => row(e.remito + i, [
          <div key="r" style={{ width: 160, fontSize: 11, color: C.azul, fontFamily: 'DM Mono,monospace', flexShrink: 0 }}>{e.remito}</div>,
          <div key="d" style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.txt }}>{e.categoria}</div>
            <div style={{ fontSize: 9, color: C.mut, marginTop: 2 }}>{e.origen} → {e.destino} · Obs: {e.obs || '—'}</div>
          </div>,
          <div key="f" style={{ fontSize: 10, color: C.mut, flexShrink: 0 }}>{formatFecha(e.fecha)}</div>,
          <span key="s" style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9,
            background: e.estado === 'En tránsito' ? 'rgba(248,113,113,.15)' : 'rgba(240,192,64,.15)',
            color: e.estado === 'En tránsito' ? C.red : C.ambar, fontWeight: 600, flexShrink: 0 }}>
            {e.estado}
          </span>,
        ])}
      />

      {/* Resumen */}
      {totalAnomalias > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: C.mut, letterSpacing: '.08em', marginBottom: 10 }}>RESUMEN DE ANOMALÍAS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {[
              { l: 'Recepciones pendientes', v: recepcionesSinConfirmar.length, c: C.ambar },
              { l: 'Entregas sin referencia', v: entregasSinReferencia.length, c: C.ambar },
              { l: 'Errores sin resolver', v: erroresSinResolver.length, c: C.red },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background: C.b2, borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.mut, marginBottom: 4 }}>{l}</div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 22, fontWeight: 700, color: v > 0 ? c : C.green }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
