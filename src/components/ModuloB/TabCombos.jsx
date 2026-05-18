import React, { useState, useMemo } from 'react';

const C = {
  panel:'#111420',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',
  red:'#f87171',blue:'#60a5fa',teal:'#2dd4bf',ora:'#fb923c',
  txt:'#e8eaf0',mut:'#6b7280',vio:'#c084fc',
};

export default function TabCombos({ combos, onLoad, loaded, stats, fileRef }) {
  const [busq, setBusq] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [filtro, setFiltro] = useState('todos');

  const lista = useMemo(() => {
    return Object.entries(combos || {})
      .filter(([cod, c]) => {
        if (filtro === 'multi' && c.componentes?.length <= 1) return false;
        if (filtro === 'single' && c.componentes?.length !== 1) return false;
        if (busq) {
          const q = busq.toLowerCase();
          return cod.toLowerCase().includes(q) || c.desc?.toLowerCase().includes(q) ||
            c.componentes?.some(x => x.cod?.toLowerCase().includes(q) || x.desc?.toLowerCase().includes(q));
        }
        return true;
      })
      .sort((a,b) => (b[1].componentes?.length||0) - (a[1].componentes?.length||0));
  }, [combos, busq, filtro]);

  return (
    <div>
      {/* Header carga */}
      <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.txt, marginBottom: 3 }}>Base de combos y componentes</div>
          {loaded
            ? <div style={{ fontSize: 10, color: C.green }}>✓ {Object.keys(combos).length} combos cargados{stats ? ` — ${stats.archivo||'desde Compras'}` : ' — desde Compras'}</div>
            : <div style={{ fontSize: 10, color: C.mut }}>Sin datos — cargá desde Compras con el botón ↺ Combos, o subí el Excel de Stock+</div>
          }
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.json" style={{ display: 'none' }} onChange={e => { if(e.target.files[0]) onLoad(e.target.files[0]); e.target.value=''; }} />
        <button onClick={() => fileRef.current?.click()} style={{ padding: '7px 14px', background: 'rgba(240,192,64,.08)', border: `1px solid ${C.acc}`, color: C.acc, borderRadius: 5, cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono,monospace' }}>
          ↑ Cargar combos (.xlsx / .json)
        </button>
      </div>

      {!loaded ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.mut }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.2 }}>⊕</div>
          <div style={{ fontSize: 14, marginBottom: 8, color: C.txt }}>Sin base de combos</div>
          <div style={{ fontSize: 11, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            Cargá el archivo <span style={{ color: C.acc }}>exportacion_de_combos_y_componentes.xlsx</span> de Stock+, o hacé ↺ Combos en el módulo Compras.
            Los combos permiten descomponer artículos compuestos en sus componentes unitarios para cruzar con stock.
          </div>
        </div>
      ) : (
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <input value={busq} onChange={e => setBusq(e.target.value)}
              placeholder="Buscar combo o componente..."
              style={{ flex: 1, padding: '6px 10px', background: C.b2, color: C.txt, border: `1px solid ${C.b1}`, borderRadius: 4, fontFamily: 'DM Mono,monospace', fontSize: 11, outline: 'none' }} />
            {[['todos','Todos'],['multi','Multi-comp.'],['single','Un comp.']].map(([id,lbl]) => (
              <button key={id} onClick={() => setFiltro(id)} style={{
                padding: '5px 12px', borderRadius: 4, border: `1px solid ${filtro===id?C.acc:C.b1}`,
                background: filtro===id ? 'rgba(240,192,64,.08)' : 'transparent',
                color: filtro===id ? C.acc : C.mut, fontSize: 10, cursor: 'pointer', fontFamily: 'DM Mono,monospace',
              }}>{lbl}</button>
            ))}
            <span style={{ fontSize: 10, color: C.mut }}>{lista.length} combos</span>
          </div>

          {/* Lista */}
          <div style={{ background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8, overflow: 'hidden' }}>
            {lista.slice(0, 100).map(([cod, combo]) => {
              const isOpen = expandido === cod;
              const multi = combo.componentes?.length > 1;
              return (
                <div key={cod} style={{ borderBottom: `1px solid ${C.b2}` }}>
                  <div onClick={() => setExpandido(isOpen ? null : cod)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer',
                      background: isOpen ? 'rgba(240,192,64,.04)' : 'transparent',
                      borderLeft: `3px solid ${multi ? C.vio : C.blue}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.txt, fontWeight: multi ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{combo.desc}</div>
                      <div style={{ fontSize: 9, color: C.mut, marginTop: 1, fontFamily: 'DM Mono,monospace' }}>{cod}</div>
                    </div>
                    <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10,
                      background: multi ? 'rgba(192,132,252,.12)' : 'rgba(96,165,250,.12)',
                      color: multi ? C.vio : C.blue, flexShrink: 0 }}>
                      {combo.componentes?.length || 0} comp.
                    </span>
                    <span style={{ fontSize: 11, color: C.mut, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '8px 16px 10px 28px', background: C.b2, borderTop: `1px solid ${C.b1}` }}>
                      {combo.componentes?.map((comp, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0',
                          borderBottom: i < combo.componentes.length-1 ? `1px solid ${C.b1}` : 'none' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
                          <div style={{ flex: 1, fontSize: 10, color: C.txt }}>{comp.desc}</div>
                          <div style={{ fontSize: 9, color: C.mut, fontFamily: 'DM Mono,monospace' }}>{comp.cod}</div>
                          <div style={{ fontSize: 11, color: C.acc, fontWeight: 600, flexShrink: 0 }}>× {comp.cant}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {lista.length > 100 && (
              <div style={{ padding: '10px', textAlign: 'center', fontSize: 10, color: C.mut }}>
                Mostrando 100 de {lista.length} — refiná la búsqueda para ver más
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
