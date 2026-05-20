import React, { useState } from 'react';
import ModuloCompras   from './components/ModuloC/ModuloCompras';
import ModuloRecepcion from './components/ModuloC/ModuloRecepcion';
import ModuloStock     from './components/ModuloC/ModuloStock';
import ModuloB         from './components/ModuloB/ModuloB';
import ModuloInventario from './components/ModuloC/ModuloInventario';

const NAV = [
  { id: 'compras',        icon: '\ud83d\uded2', label: 'Compras',       desc: 'OC y distribuci\u00f3n'    },
  { id: 'recepcion_prov', icon: '\ud83d\udce6', label: 'Recepci\u00f3n',     desc: 'Control de ingresos'  },
  { id: 'stock',          icon: '\ud83d\udccb', label: 'Stock+',        desc: 'Maestro de art\u00edculos'  },
  { id: 'movimientos',    icon: '\ud83d\udd04', label: 'Movimientos',   desc: 'Remitos internos'     },
  { id: 'inventario',     icon: '\ud83d\udccb', label: 'Inventario',    desc: 'Control de stock'     },
];

export default function App() {
  const [modulo,      setModulo]      = useState('compras');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'var(--bg)' }}>
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
          <button onClick={() => setSidebarOpen(p => !p)} style={{ marginLeft:'auto', background:'transparent', color:'var(--text-3)', border:'none', fontSize:14, padding:2, flexShrink:0, cursor:'pointer' }}>
            {sidebarOpen ? '\u25c0' : '\u25b6'}
          </button>
        </div>
        <nav style={{ flex:1, padding:'8px 0' }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setModulo(n.id)} style={{
              width:'100%', display:'flex', alignItems:'center', gap:10,
              padding:'10px 14px',
              background: modulo === n.id ? 'rgba(240,192,64,0.1)' : 'transparent',
              borderLeft: modulo === n.id ? '2px solid var(--accent)' : '2px solid transparent',
              borderRight:'none', borderTop:'none', borderBottom:'none',
              color: modulo === n.id ? 'var(--accent)' : 'var(--text-3)',
              textAlign:'left', cursor:'pointer', transition:'all 150ms ease',
            }}>
              <span style={{ fontSize:16, flexShrink:0 }}>{n.icon}</span>
              {sidebarOpen && (
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight: modulo === n.id ? 600 : 400, color: modulo === n.id ? 'var(--accent)' : 'var(--text)' }}>{n.label}</div>
                  <div style={{ fontSize:10, color:'var(--text-3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{n.desc}</div>
                </div>
              )}
            </button>
          ))}
        </nav>
        <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:10, color:'var(--text-3)' }}>
          {sidebarOpen && <RedisStatus />}
        </div>
      </aside>

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <header style={{
          background:'var(--panel)', borderBottom:'1px solid var(--border)',
          padding:'0 20px', height:56, display:'flex', alignItems:'center', gap:12,
          position:'sticky', top:0, zIndex:100,
        }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700 }}>
              {NAV.find(n => n.id === modulo)?.label}
            </div>
            <div style={{ fontSize:10, color:'var(--text-3)' }}>
              {NAV.find(n => n.id === modulo)?.desc}
            </div>
          </div>
          <div style={{ fontSize:10, color:'var(--text-3)' }}>
            {new Date().toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' })}
          </div>
          <RedisStatus />
        </header>
        <main style={{ flex:1, overflow:'auto' }}>
          {modulo === 'compras'        && <ModuloCompras />}
          {modulo === 'recepcion_prov' && <ModuloRecepcion />}
          {modulo === 'stock'          && <ModuloStock />}
          {modulo === 'inventario'     && <ModuloInventario />}
          {modulo === 'movimientos'    && <ModuloB />}
        </main>
      </div>
    </div>
  );
}

function RedisStatus() {
  const [status, setStatus] = React.useState('checking');
  React.useEffect(() => {
    fetch('/api/health').then(r=>r.json()).then(d=>setStatus(d.redis==='ok'?'ok':'warn')).catch(()=>setStatus('err'));
  }, []);
  const cfg = {
    checking:{color:'#6b7280',label:'Redis...'},
    ok:      {color:'#4ade80',label:'Redis OK'},
    warn:    {color:'#f0c040',label:'Redis sin datos'},
    err:     {color:'#f87171',label:'Redis error'},
  }[status];
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:10 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:cfg.color, display:'inline-block' }}></span>
      <span style={{ color:cfg.color }}>{cfg.label}</span>
    </div>
  );
}
