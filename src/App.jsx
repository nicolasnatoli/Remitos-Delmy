import React, { useState } from 'react';
import { getApiKey, setApiKey } from './utils/storage';
import { useCompras, useStock } from './utils/hooks';

import ModuloA  from './components/ModuloA/ModuloA';
import ModuloB  from './components/ModuloB/ModuloB';
import ModuloCompras   from './components/ModuloC/ModuloCompras';
import ModuloRecepcion from './components/ModuloC/ModuloRecepcion';
import ModuloStock     from './components/ModuloC/ModuloStock';
import SyncStatus      from './components/shared/SyncStatus';

const NAV = [
  { id: 'compras',        icon: '🛒', label: 'Compras',       desc: 'OC y distribución'     },
  { id: 'recepcion_prov', icon: '📦', label: 'Recepción',     desc: 'Control de ingresos'    },
  { id: 'stock',          icon: '📋', label: 'Stock+',        desc: 'Maestro de artículos'   },
  { id: 'recepcion',      icon: '📄', label: 'Rec. Facturas', desc: 'Facturas · IA'          },
  { id: 'movimientos',    icon: '🔄', label: 'Movimientos',   desc: 'Remitos internos'       },
];

export default function App() {
  const [modulo, setModulo]       = useState('movimientos');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
  const [keySaved, setKeySaved]   = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { compras, add: addCompra, update: updateCompra } = useCompras();
  const { stockDb, stockMeta, setStock } = useStock();

  const handleSaveKey = () => {
    setApiKey(apiKeyInput.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const pendientesRecepcion = compras.filter(c => ['confirmada','en_transito'].includes(c.estado)).length;

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'var(--bg)' }}>

      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 200 : 56,
        background: 'var(--panel)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 200ms ease', flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
      }}>
        <div style={{ padding:'16px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, minHeight:60 }}>
          <div style={{ width:28, height:28, background:'var(--accent)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'var(--font-syne)', fontWeight:800, fontSize:14, color:'#0c0e14' }}>D</div>
          {sidebarOpen && (
            <div>
              <div style={{ fontFamily:'var(--font-syne)', fontWeight:800, fontSize:13, color:'var(--accent)', letterSpacing:'0.02em' }}>DELMY</div>
              <div style={{ fontSize:9, color:'var(--text-3)', letterSpacing:'0.08em' }}>PARTY SRL</div>
            </div>
          )}
          <button onClick={()=>setSidebarOpen(p=>!p)} style={{ marginLeft:'auto', background:'transparent', color:'var(--text-3)', border:'none', fontSize:14, padding:2, flexShrink:0, cursor:'pointer' }}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav style={{ flex:1, padding:'8px 0' }}>
          {NAV.map(n => {
            const badge = n.id === 'recepcion_prov' ? pendientesRecepcion : 0;
            return (
              <button key={n.id} onClick={()=>setModulo(n.id)} style={{
                width:'100%', display:'flex', alignItems:'center', gap:10,
                padding:'10px 14px',
                background: modulo===n.id ? 'rgba(240,192,64,0.1)' : 'transparent',
                borderLeft: modulo===n.id ? '2px solid var(--accent)' : '2px solid transparent',
                borderRight:'none', borderTop:'none', borderBottom:'none',
                color: modulo===n.id ? 'var(--accent)' : 'var(--text-3)',
                textAlign:'left', cursor:'pointer', transition:'all 150ms ease',
              }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{n.icon}</span>
                {sidebarOpen && (
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight:modulo===n.id?600:400, color:modulo===n.id?'var(--accent)':'var(--text)' }}>{n.label}</div>
                    <div style={{ fontSize:10, color:'var(--text-3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{n.desc}</div>
                  </div>
                )}
                {badge > 0 && sidebarOpen && (
                  <span style={{ background:'var(--ambar)', color:'#0c0e14', fontSize:10, fontWeight:700, borderRadius:10, padding:'1px 6px', flexShrink:0 }}>{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)' }}>
          <button onClick={()=>setShowApiKey(p=>!p)} style={{
            width:'100%', display:'flex', alignItems:'center', gap:8,
            background:'transparent', border:'none',
            color: getApiKey()?'var(--verde)':'var(--rojo)',
            padding:0, cursor:'pointer', fontSize:11,
          }}>
            <span>{getApiKey()?'🔑':'⚠'}</span>
            {sidebarOpen && <span>{getApiKey()?'API key OK':'Sin API key'}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <header style={{
          background:'var(--panel)', borderBottom:'1px solid var(--border)',
          padding:'0 20px', height:56, display:'flex', alignItems:'center', gap:12,
          position:'sticky', top:0, zIndex:100,
        }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700 }}>
              {NAV.find(n=>n.id===modulo)?.label}
            </div>
            <div style={{ fontSize:10, color:'var(--text-3)' }}>
              {NAV.find(n=>n.id===modulo)?.desc}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:10, color:'var(--text-3)' }}>
              {new Date().toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'})}
            </div>
            <SyncStatus />
          </div>
        </header>

        {showApiKey && (
          <div style={{ background:'var(--panel)', borderBottom:'1px solid var(--border)', padding:'10px 20px', display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:11, color:'var(--text-3)', whiteSpace:'nowrap' }}>Anthropic API Key:</span>
            <input type="password" value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)}
              placeholder="sk-ant-..." style={{ flex:1, padding:'5px 10px', fontSize:12 }} />
            <button onClick={handleSaveKey} style={{
              background: keySaved?'rgba(74,222,128,0.15)':'rgba(240,192,64,0.15)',
              color: keySaved?'var(--verde)':'var(--accent)',
              border:'1px solid currentColor', borderRadius:'var(--radius)', padding:'5px 14px', fontSize:12,
            }}>{keySaved?'✓ Guardado':'Guardar'}</button>
            <button onClick={()=>setShowApiKey(false)} style={{ background:'transparent', color:'var(--text-3)', fontSize:18, padding:'0 4px', border:'none', cursor:'pointer' }}>×</button>
          </div>
        )}

        <main style={{ flex:1, overflow:'auto' }}>
          {modulo==='compras'        && <ModuloCompras   compras={compras} add={addCompra} update={updateCompra} stockDb={stockDb} stockMeta={stockMeta} />}
          {modulo==='recepcion_prov' && <ModuloRecepcion compras={compras} update={updateCompra} />}
          {modulo==='stock'          && <ModuloStock     stockDb={stockDb} stockMeta={stockMeta} setStock={setStock} />}
          {modulo==='recepcion'      && <ModuloA />}
          {modulo==='movimientos'    && <ModuloB />}
        </main>
      </div>
    </div>
  );
}
