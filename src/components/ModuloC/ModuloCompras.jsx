import React, { useState, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import * as XLSX from 'xlsx';
import { PROVEEDORES } from '../../utils/claudeVision';
import { getApiKey } from '../../utils/storage';

// ─── Colores de estado OC ────────────────────────────────────────────────────
const ESTADO_OC = {
  borrador:    { label: 'Borrador',    badge: 'badge-gray'    },
  confirmada:  { label: 'Confirmada',  badge: 'badge-azul'    },
  en_transito: { label: 'En tránsito', badge: 'badge-ambar'   },
  recibida:    { label: 'Recibida',    badge: 'badge-verde'   },
  cancelada:   { label: 'Cancelada',   badge: 'badge-rojo'    },
};

const SUCURSALES = ['01-CENTRAL','02-DELMY 1','03-DELMY 2','04-DELMY 3 - Solano','05-DEPOSITO'];
const FAMILIAS   = ['COTILLÓN','REPOSTERÍA','LIBRERÍA','JUGUETERÍA','ENVASADO','DESCARTABLES','GOLOSINAS','VARIOS'];

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ModuloCompras({ compras, add, update, stockDb, stockMeta }) {
  const [tab, setTab]     = useState('dashboard');
  const [selOC, setSelOC] = useState(null);

  const TABS = [
    { id: 'dashboard',    label: '◈ Dashboard' },
    { id: 'nueva',        label: '+ Nueva OC'  },
    { id: 'stock',        label: '▤ Stock'      },
    { id: 'distribucion', label: '⊞ Distribución' },
  ];

  const openOC = (oc) => { setSelOC(oc); setTab('distribucion'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Sub-tabs */}
      <div style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', gap: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'transparent',
            color: tab === t.id ? 'var(--accent)' : 'var(--text-3)',
            borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            borderTop: 'none', borderLeft: 'none', borderRight: 'none',
            padding: '12px 16px', fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>{t.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {compras.filter(c => !['recibida','cancelada'].includes(c.estado)).length} OC activas
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'dashboard'    && <DashboardCompras compras={compras} onOpen={openOC} onUpdate={update} />}
        {tab === 'nueva'        && <NuevaOC onCrear={(oc) => { add(oc); setSelOC(oc); setTab('distribucion'); }} stockDb={stockDb} />}
        {tab === 'stock'        && <VistaStock stockDb={stockDb} stockMeta={stockMeta} />}
        {tab === 'distribucion' && <DistribucionOC oc={selOC} compras={compras} onUpdate={update} />}
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function DashboardCompras({ compras, onOpen, onUpdate }) {
  const activas   = compras.filter(c => !['recibida','cancelada'].includes(c.estado));
  const recibidas = compras.filter(c => c.estado === 'recibida');

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { l: 'BORRADORES',     v: compras.filter(c=>c.estado==='borrador').length,    c: 'var(--text-2)' },
          { l: 'CONFIRMADAS',    v: compras.filter(c=>c.estado==='confirmada').length,  c: 'var(--azul)'   },
          { l: 'EN TRÁNSITO',    v: compras.filter(c=>c.estado==='en_transito').length, c: 'var(--ambar)'  },
          { l: 'RECIBIDAS',      v: recibidas.length,                                   c: 'var(--verde)'  },
        ].map(kpi => (
          <div key={kpi.l} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 6 }}>{kpi.l}</div>
            <div style={{ fontFamily: 'var(--font-syne)', fontSize: 28, fontWeight: 700, color: kpi.c }}>{kpi.v}</div>
          </div>
        ))}
      </div>

      {/* Lista OC activas */}
      {activas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
          Sin órdenes de compra activas · Creá una nueva con "+ Nueva OC"
        </div>
      ) : (
        <div className="card">
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
            ÓRDENES ACTIVAS
          </div>
          {activas.map((oc, i) => {
            const est = ESTADO_OC[oc.estado] || ESTADO_OC.borrador;
            const total = oc.lineas?.reduce((s,l) => s + (l.cant||0)*(l.precio||0), 0) || 0;
            return (
              <div key={oc.id} onClick={() => onOpen(oc)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                borderBottom: i < activas.length-1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{oc.proveedor}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {oc.noc} · {oc.fecha} · {oc.lineas?.length || 0} artículos
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12 }}>
                  {total > 0 && <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-syne)', fontWeight: 700 }}>
                    ${total.toLocaleString('es-AR', {minimumFractionDigits:2})}
                  </div>}
                </div>
                <span className={`badge ${est.badge}`}>{est.label}</span>
                {oc.estado === 'borrador' && (
                  <button onClick={e => { e.stopPropagation(); onUpdate(oc.id, { estado:'confirmada' }); }} style={{
                    background: 'rgba(240,192,64,0.12)', color: 'var(--accent)',
                    border: '1px solid rgba(240,192,64,0.2)', borderRadius: 'var(--radius)',
                    padding: '4px 10px', fontSize: 11,
                  }}>Confirmar</button>
                )}
                {oc.estado === 'confirmada' && (
                  <button onClick={e => { e.stopPropagation(); onUpdate(oc.id, { estado:'en_transito' }); }} style={{
                    background: 'rgba(96,165,250,0.1)', color: 'var(--azul)',
                    border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--radius)',
                    padding: '4px 10px', fontSize: 11,
                  }}>Enviar</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Historial recibidas */}
      {recibidas.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
            RECIBIDAS RECIENTES
          </div>
          {recibidas.slice(0,5).map((oc,i) => (
            <div key={oc.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
              borderBottom: i < Math.min(recibidas.length,5)-1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ flex: 1, fontSize: 12 }}>{oc.proveedor}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{oc.fecha}</div>
              <span className="badge badge-verde">Recibida</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Nueva OC ────────────────────────────────────────────────────────────────
function NuevaOC({ onCrear, stockDb }) {
  const [form, setForm] = useState({
    proveedor: '', fecha: new Date().toISOString().split('T')[0],
    noc: '', familia: '', obs: '',
  });
  const [lineas, setLineas]   = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [file, setFile]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Artículos disponibles del stock
  const articulos = useMemo(() => {
    return Object.entries(stockDb).map(([cod, v]) => ({ cod, ...v }));
  }, [stockDb]);

  const articulosFiltrados = useMemo(() => {
    if (!busqueda) return articulos.slice(0, 30);
    const q = busqueda.toLowerCase();
    return articulos.filter(a =>
      a.cod?.toLowerCase().includes(q) ||
      a.desc?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [articulos, busqueda]);

  const addLinea = (art) => {
    if (lineas.find(l => l.cod === art.cod)) return;
    setLineas(prev => [...prev, {
      cod: art.cod, desc: art.desc || '',
      cant: 0, precio: art.precio || 0,
      familia: art.familia || form.familia,
    }]);
  };

  const updLinea = (cod, field, val) => {
    setLineas(prev => prev.map(l => l.cod === cod ? { ...l, [field]: field === 'cant' || field === 'precio' ? Number(val) : val } : l));
  };

  const removeLinea = (cod) => setLineas(prev => prev.filter(l => l.cod !== cod));

  // IA extracción desde remito/factura
  const handleExtractIA = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setError('Configurá la API Key primero'); return; }
    if (!file) { setError('Subí un archivo primero'); return; }
    setLoading(true); setError('');
    try {
      const { extractFromDocumentSmart } = await import('../../utils/claudeVision');
      const data = await extractFromDocumentSmart(file, apiKey);
      if (data.proveedor) setForm(f => ({ ...f, proveedor: data.proveedor }));
      if (data.documento) setForm(f => ({ ...f, noc: data.documento }));
      if (data.fechaDoc)  setForm(f => ({ ...f, fecha: data.fechaDoc }));
      if (data.lineas?.length) {
        setLineas(data.lineas.map(l => ({
          cod: l.cod, desc: l.desc, cant: Number(l.cant)||0, precio: 0, familia: '',
        })));
      }
    } catch(err) {
      setError(`Error IA: ${err.message}`);
    } finally { setLoading(false); }
  };

  const handleCrear = () => {
    if (!form.proveedor) { setError('Seleccioná proveedor'); return; }
    const oc = {
      id: uuid(),
      ...form,
      estado: 'borrador',
      createdAt: new Date().toISOString(),
      lineas,
      distribucion: {},
    };
    onCrear(oc);
  };

  const total = lineas.reduce((s,l) => s + (l.cant||0)*(l.precio||0), 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
      {/* Izquierda: form + líneas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--rojo)', padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12 }}>{error}</div>
        )}

        {/* Cabecera OC */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontFamily: 'var(--font-syne)', fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Datos de la OC</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>PROVEEDOR *</label>
              <select value={form.proveedor} onChange={e => setForm(f=>({...f,proveedor:e.target.value}))} style={{ width: '100%', padding: '6px 8px', fontSize: 12 }}>
                <option value="">— Seleccionar —</option>
                {PROVEEDORES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>Nº OC / REFERENCIA</label>
              <input value={form.noc} onChange={e => setForm(f=>({...f,noc:e.target.value}))} style={{ width: '100%' }} placeholder="OC-2026-001" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>FECHA</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f=>({...f,fecha:e.target.value}))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>FAMILIA</label>
              <select value={form.familia} onChange={e => setForm(f=>({...f,familia:e.target.value}))} style={{ width: '100%', padding: '6px 8px', fontSize: 12 }}>
                <option value="">— General —</option>
                {FAMILIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>OBSERVACIONES</label>
              <input value={form.obs} onChange={e => setForm(f=>({...f,obs:e.target.value}))} style={{ width: '100%' }} placeholder="Notas opcionales..." />
            </div>
          </div>
        </div>

        {/* Líneas de artículos */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-syne)', fontSize: 14, fontWeight: 700 }}>
              Artículos ({lineas.length})
            </div>
            <button onClick={() => setLineas(p => [...p, { cod:'', desc:'', cant:0, precio:0, familia:'' }])} style={{
              background: 'rgba(240,192,64,0.1)', color: 'var(--accent)',
              border: '1px solid rgba(240,192,64,0.2)', borderRadius: 'var(--radius)', fontSize: 11, padding: '4px 10px',
            }}>+ Línea manual</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>CÓDIGO</th><th>DESCRIPCIÓN</th><th style={{width:70}}>CANT.</th>
                  <th style={{width:100}}>PRECIO</th><th style={{width:30}}></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.cod || i}>
                    <td><input value={l.cod} onChange={e=>updLinea(l.cod,'cod',e.target.value)} style={{width:'100%',padding:'3px 6px',fontSize:11}} /></td>
                    <td><input value={l.desc} onChange={e=>updLinea(l.cod,'desc',e.target.value)} style={{width:'100%',padding:'3px 6px',fontSize:11}} /></td>
                    <td><input type="number" value={l.cant} onChange={e=>updLinea(l.cod,'cant',e.target.value)} style={{width:'100%',padding:'3px 6px',fontSize:11}} /></td>
                    <td><input type="number" value={l.precio} onChange={e=>updLinea(l.cod,'precio',e.target.value)} style={{width:'100%',padding:'3px 6px',fontSize:11}} /></td>
                    <td><button onClick={()=>removeLinea(l.cod)} style={{color:'var(--rojo)',background:'transparent',padding:'2px 4px',fontSize:13}}>×</button></td>
                  </tr>
                ))}
                {lineas.length === 0 && (
                  <tr><td colSpan={5} style={{textAlign:'center',color:'var(--text-3)',padding:20,fontSize:12}}>
                    Buscá artículos a la derecha o usá IA para extraer del remito
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <div style={{ textAlign:'right', marginTop:10, fontSize:13, color:'var(--accent)', fontFamily:'var(--font-syne)', fontWeight:700 }}>
              Total: ${total.toLocaleString('es-AR',{minimumFractionDigits:2})}
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={handleCrear} style={{
            background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)',
            fontWeight:600, fontSize:13, padding:'9px 22px', borderRadius:'var(--radius)',
          }}>Crear OC →</button>
        </div>
      </div>

      {/* Derecha: búsqueda de artículos + IA */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {/* Extracción IA */}
        <div className="card" style={{ padding:14 }}>
          <div style={{ fontSize:11, color:'var(--text-3)', letterSpacing:'0.07em', marginBottom:8 }}>EXTRAER CON IA</div>
          <label style={{
            display:'block', border:'2px dashed var(--border)', borderRadius:'var(--radius)',
            padding:'12px', textAlign:'center', cursor:'pointer', fontSize:12, color:'var(--text-2)',
            marginBottom:8,
          }}>
            {file ? <span style={{color:'var(--accent)'}}>{file.name}</span> : '📄 Subí factura / remito'}
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}}
              onChange={e=>setFile(e.target.files[0])} />
          </label>
          <button onClick={handleExtractIA} disabled={!file||loading} style={{
            width:'100%', background: file&&!loading?'var(--accent)':'var(--border)',
            color: file&&!loading?'#0c0e14':'var(--text-3)',
            fontFamily:'var(--font-mono)', fontWeight:500, fontSize:12, padding:'7px',
            borderRadius:'var(--radius)', cursor: file&&!loading?'pointer':'not-allowed',
          }}>
            {loading ? '⏳ Extrayendo...' : '✦ Extraer artículos'}
          </button>
        </div>

        {/* Buscador de artículos del stock */}
        <div className="card" style={{ padding:14, flex:1, display:'flex', flexDirection:'column' }}>
          <div style={{ fontSize:11, color:'var(--text-3)', letterSpacing:'0.07em', marginBottom:8 }}>
            ARTÍCULOS DEL STOCK ({articulos.length})
          </div>
          <input
            value={busqueda} onChange={e=>setBusqueda(e.target.value)}
            placeholder="Buscar por código o descripción..."
            style={{ marginBottom:8, fontSize:12, padding:'6px 8px', width:'100%' }}
          />
          <div style={{ flex:1, overflowY:'auto', maxHeight:320 }}>
            {articulosFiltrados.map(art => (
              <div key={art.cod} onClick={() => addLinea(art)} style={{
                padding:'6px 8px', cursor:'pointer', borderRadius:4,
                background: lineas.find(l=>l.cod===art.cod) ? 'rgba(74,222,128,0.08)' : 'transparent',
                borderBottom:'1px solid var(--border)',
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:11.5, color:'var(--text)' }}>{art.desc || art.cod}</div>
                    <div style={{ fontSize:10, color:'var(--text-3)' }}>{art.cod}</div>
                  </div>
                  {lineas.find(l=>l.cod===art.cod)
                    ? <span style={{fontSize:10,color:'var(--verde)'}}>✓</span>
                    : <span style={{fontSize:10,color:'var(--text-3)'}}>+</span>
                  }
                </div>
              </div>
            ))}
            {articulosFiltrados.length === 0 && (
              <div style={{fontSize:12,color:'var(--text-3)',textAlign:'center',padding:16}}>
                {articulos.length === 0
                  ? 'Cargá una planilla en "▤ Stock" primero'
                  : 'Sin resultados'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vista Stock ──────────────────────────────────────────────────────────────
function VistaStock({ stockDb, stockMeta }) {
  const [busqueda, setBusqueda] = useState('');

  const articulos = Object.entries(stockDb).map(([cod,v]) => ({ cod, ...v }));
  const filtrados = busqueda
    ? articulos.filter(a => a.cod?.toLowerCase().includes(busqueda.toLowerCase()) || a.desc?.toLowerCase().includes(busqueda.toLowerCase()))
    : articulos;

  if (articulos.length === 0) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'var(--text-3)' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
        <div style={{ fontSize:14, marginBottom:8, color:'var(--text-2)' }}>Sin datos de stock</div>
        <div style={{ fontSize:12 }}>Cargá una planilla de ventas en Módulo A (Recepción) o desde Maestros</div>
      </div>
    );
  }

  return (
    <div>
      {stockMeta?.archivo && (
        <div style={{ marginBottom:14, fontSize:11, color:'var(--text-3)' }}>
          Planilla: <span style={{color:'var(--text-2)'}}>{stockMeta.archivo}</span>
          {stockMeta.fecha && <span> · {stockMeta.fecha}</span>}
          <span> · {articulos.length} artículos</span>
        </div>
      )}
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
        placeholder="Buscar..." style={{ marginBottom:12, padding:'6px 10px', fontSize:12, width:280 }} />
      <div className="card" style={{ overflowX:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>PROVEEDOR</th><th>FAMILIA</th>
              <th style={{textAlign:'right'}}>STOCK</th><th style={{textAlign:'right'}}>VENTA</th><th style={{textAlign:'right'}}>PRECIO</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0,100).map(a => (
              <tr key={a.cod}>
                <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-2)'}}>{a.cod}</td>
                <td style={{fontSize:12}}>{a.desc}</td>
                <td style={{fontSize:11,color:'var(--text-3)'}}>{a.proveedor}</td>
                <td style={{fontSize:11}}>{a.familia}</td>
                <td style={{textAlign:'right',fontSize:12}}>{a.stock ?? '—'}</td>
                <td style={{textAlign:'right',fontSize:12,color:'var(--verde)'}}>{a.venta ?? '—'}</td>
                <td style={{textAlign:'right',fontSize:12,color:'var(--accent)'}}>
                  {a.precio ? `$${Number(a.precio).toLocaleString('es-AR')}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 100 && (
          <div style={{padding:'8px 12px',fontSize:11,color:'var(--text-3)',borderTop:'1px solid var(--border)'}}>
            Mostrando 100 de {filtrados.length} · Refiná la búsqueda para ver más
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Distribución OC ─────────────────────────────────────────────────────────
function DistribucionOC({ oc, compras, onUpdate }) {
  // Hook must be at top level unconditionally
  const ocActual = compras.find(c => c && oc && c.id === oc.id) || oc;
  const [dist, setDist] = useState(() => ocActual?.distribucion || {});

  if (!oc) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'var(--text-3)' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⊞</div>
        <div style={{ fontSize:14, color:'var(--text-2)' }}>Seleccioná una OC del Dashboard</div>
        <div style={{ fontSize:12, marginTop:6 }}>o creá una nueva con "+ Nueva OC"</div>
      </div>
    );
  }

  const total = (suc) => {
    return ocActual.lineas?.reduce((s,l) => s + (dist[l.cod]?.[suc] || 0), 0) || 0;
  };

  const totalLinea = (l) => SUCURSALES.reduce((s,suc) => s + (dist[l.cod]?.[suc] || 0), 0);

  const setVal = (cod, suc, val) => {
    setDist(prev => ({ ...prev, [cod]: { ...(prev[cod]||{}), [suc]: Number(val)||0 } }));
  };

  const handleGuardar = () => {
    onUpdate(oc.id, { distribucion: dist });
    alert('Distribución guardada');
  };

  const handleExportarXLS = () => {
    const rows = [['CÓDIGO','DESCRIPCIÓN','CANT. TOTAL',...SUCURSALES,'DIFERENCIA']];
    for (const l of (ocActual.lineas||[])) {
      const tot = totalLinea(l);
      const dif = (l.cant||0) - tot;
      rows.push([l.cod, l.desc, l.cant, ...SUCURSALES.map(s=>dist[l.cod]?.[s]||0), dif]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Distribución');
    XLSX.writeFile(wb, `distribucion_${ocActual.proveedor}_${ocActual.fecha}.xlsx`);
  };

  return (
    <div>
      {/* Header OC */}
      <div className="card" style={{ padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700 }}>{ocActual.proveedor}</div>
          <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>
            {ocActual.noc} · {ocActual.fecha} · {ocActual.lineas?.length||0} artículos
          </div>
        </div>
        <span className={`badge ${ESTADO_OC[ocActual.estado]?.badge || 'badge-gray'}`}>
          {ESTADO_OC[ocActual.estado]?.label}
        </span>
        <button onClick={handleGuardar} style={{ background:'rgba(240,192,64,0.12)', color:'var(--accent)', border:'1px solid rgba(240,192,64,0.2)', borderRadius:'var(--radius)', fontSize:12, padding:'6px 14px' }}>
          Guardar
        </button>
        <button onClick={handleExportarXLS} style={{ background:'rgba(74,222,128,0.1)', color:'var(--verde)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:'var(--radius)', fontSize:12, padding:'6px 14px' }}>
          ↓ Excel
        </button>
      </div>

      {/* Totales por sucursal */}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${SUCURSALES.length},1fr)`, gap:8, marginBottom:14 }}>
        {SUCURSALES.map(suc => (
          <div key={suc} className="card" style={{ padding:'8px 10px', textAlign:'center' }}>
            <div style={{ fontSize:9, color:'var(--text-3)', marginBottom:4, letterSpacing:'0.05em' }}>{suc.replace(/\d+-/,'')}</div>
            <div style={{ fontFamily:'var(--font-syne)', fontSize:18, fontWeight:700, color:'var(--accent)' }}>{total(suc)}</div>
          </div>
        ))}
      </div>

      {/* Tabla distribución */}
      <div className="card" style={{ overflowX:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>CÓDIGO</th>
              <th>DESCRIPCIÓN</th>
              <th style={{textAlign:'right'}}>OC</th>
              {SUCURSALES.map(s => <th key={s} style={{textAlign:'center',minWidth:70}}>{s.replace(/\d+-/,'')}</th>)}
              <th style={{textAlign:'right'}}>DIST.</th>
              <th style={{textAlign:'right'}}>DIFF</th>
            </tr>
          </thead>
          <tbody>
            {(ocActual.lineas||[]).map(l => {
              const tot = totalLinea(l);
              const dif = (l.cant||0) - tot;
              return (
                <tr key={l.cod}>
                  <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-2)'}}>{l.cod}</td>
                  <td style={{fontSize:11}}>{l.desc}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>{l.cant}</td>
                  {SUCURSALES.map(suc => (
                    <td key={suc} style={{padding:'4px 6px'}}>
                      <input
                        type="number" value={dist[l.cod]?.[suc]||0}
                        onChange={e=>setVal(l.cod,suc,e.target.value)}
                        style={{width:'100%',padding:'3px 5px',fontSize:11,textAlign:'center'}}
                      />
                    </td>
                  ))}
                  <td style={{textAlign:'right',fontWeight:600,color:'var(--verde)'}}>{tot}</td>
                  <td style={{textAlign:'right',fontWeight:600,color:dif===0?'var(--verde)':dif>0?'var(--ambar)':'var(--rojo)'}}>
                    {dif > 0 ? `+${dif}` : dif}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { useMemo };
