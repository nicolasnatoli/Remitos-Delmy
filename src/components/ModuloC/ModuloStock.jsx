import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';



export default function ModuloStock({ stockDb, stockMeta, setStock }) {
  const [tab, setTab]   = useState('maestro');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtProv, setFiltProv] = useState('');
  const fileRef = useRef();

  const articulos = Object.entries(stockDb).map(([cod,v]) => ({ cod, ...v }));
  const proveedores = [...new Set(articulos.map(a => a.proveedor).filter(Boolean))].sort();

  const filtrados = articulos.filter(a => {
    const q = busqueda.toLowerCase();
    const matchQ = !busqueda || a.cod?.toLowerCase().includes(q) || a.desc?.toLowerCase().includes(q);
    const matchP = !filtProv || a.proveedor === filtProv;
    return matchQ && matchP;
  });

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type:'array', cellDates:true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });

        // Buscar fila de headers (la que tiene "código" o "cod")
        let headerRow = 0;
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const str = rows[i].join(' ').toLowerCase();
          if (str.includes('código') || str.includes('codigo') || str.includes('cod.')) {
            headerRow = i; break;
          }
        }

        // Mapear columnas dinámicamente
        const headers = rows[headerRow].map(h => String(h).toLowerCase().trim());
        const findCol = (...names) => {
          for (const n of names) {
            const idx = headers.findIndex(h => h.includes(n));
            if (idx >= 0) return idx;
          }
          return -1;
        };

        const iCod   = findCol('código','codigo','cod');
        const iDesc  = findCol('descripción','descripcion','desc');
        const iProv  = findCol('proveedor','prov');
        const iFam   = findCol('familia','rubro','categ');
        const iPrecio= findCol('precio','price');
        const iVenta = findCol('venta total','venta','ventas');
        const iStock = findCol('stock','existencia','saldo');

        const db = {};
        for (let i = headerRow+1; i < rows.length; i++) {
          const row = rows[i];
          const cod = String(row[iCod] || '').trim();
          if (!cod || cod === '' || cod.toLowerCase() === 'código') continue;
          db[cod] = {
            cod,
            desc:      String(row[iDesc]  || '').trim(),
            proveedor: String(row[iProv]  || '').trim(),
            familia:   iFam   >= 0 ? String(row[iFam]   || '').trim() : '',
            precio:    iPrecio>= 0 ? Number(row[iPrecio] || 0) : 0,
            venta:     iVenta >= 0 ? Number(row[iVenta]  || 0) : 0,
            stock:     iStock >= 0 ? Number(row[iStock]  || 0) : 0,
          };
        }

        const meta = {
          archivo: file.name,
          fecha: new Date().toLocaleDateString('es-AR'),
          total: Object.keys(db).length,
          headerRow,
        };

        setPreview({ db, meta });
        setLoading(false);
      };
      reader.onerror = () => setLoading(false);
      reader.readAsArrayBuffer(file);
    } catch(err) {
      alert(`Error: ${err.message}`);
      setLoading(false);
    }
  };

  const handleConfirmar = () => {
    if (!preview) return;
    setStock(preview.db, preview.meta);
    setPreview(null);
    setTab('maestro');
  };

  const stats = {
    total:      articulos.length,
    conStock:   articulos.filter(a => (a.stock||0) > 0).length,
    sinStock:   articulos.filter(a => (a.stock||0) === 0).length,
    conVentas:  articulos.filter(a => (a.venta||0) > 0).length,
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 56px)' }}>
      {/* Sub-tabs */}
      <div style={{ background:'var(--panel)', borderBottom:'1px solid var(--border)', padding:'0 20px', display:'flex', gap:0 }}>
        {[
          { id:'maestro', label:'▤ Maestro de artículos' },
          { id:'cargar',  label:'↑ Cargar planilla'      },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background:'transparent',
            color: tab===t.id ? 'var(--accent)' : 'var(--text-3)',
            borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
            borderTop:'none', borderLeft:'none', borderRight:'none',
            padding:'12px 16px', fontSize:12, fontFamily:'var(--font-mono)',
          }}>{t.label}</button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          {stockMeta?.archivo && (
            <span style={{ fontSize:11, color:'var(--text-3)' }}>
              {stockMeta.archivo} · {stats.total} artículos
            </span>
          )}
        </div>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:20 }}>

        {/* TAB: Cargar planilla */}
        {tab === 'cargar' && (
          <div style={{ maxWidth:700 }}>
            <div className="card" style={{ padding:20 }}>
              <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700, marginBottom:6 }}>
                Carga de planilla de stock/ventas
              </div>
              <div style={{ fontSize:12, color:'var(--text-3)', marginBottom:20 }}>
                Formato aceptado: Excel (.xlsx/.xls) con columnas de código, descripción, proveedor, stock y ventas.
                El sistema detecta automáticamente las columnas.
              </div>

              <label
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}}
                style={{
                  display:'block', border:'2px dashed var(--border-2)', borderRadius:'var(--radius-lg)',
                  padding:'40px 20px', textAlign:'center', cursor:'pointer', marginBottom:16,
                }}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
                  onChange={e=>handleFile(e.target.files[0])} />
                {loading
                  ? <div className="pulse" style={{fontSize:14,color:'var(--accent)'}}>Procesando planilla...</div>
                  : <div>
                      <div style={{fontSize:32,marginBottom:8}}>📊</div>
                      <div style={{fontSize:13,color:'var(--text-2)'}}>Arrastrá el archivo o hacé click para seleccionar</div>
                      <div style={{fontSize:11,color:'var(--text-3)',marginTop:4}}>XLSX · XLS · CSV</div>
                    </div>
                }
              </label>

              {preview && (
                <div style={{ background:'rgba(74,222,128,0.06)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:'var(--radius)', padding:16 }}>
                  <div style={{ fontFamily:'var(--font-syne)', fontSize:14, fontWeight:700, color:'var(--verde)', marginBottom:10 }}>
                    ✓ Planilla procesada
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:10, color:'var(--text-3)', marginBottom:4 }}>ARTÍCULOS</div>
                      <div style={{ fontFamily:'var(--font-syne)', fontSize:24, fontWeight:700, color:'var(--verde)' }}>{Object.keys(preview.db).length}</div>
                    </div>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:10, color:'var(--text-3)', marginBottom:4 }}>CON STOCK</div>
                      <div style={{ fontFamily:'var(--font-syne)', fontSize:24, fontWeight:700, color:'var(--accent)' }}>
                        {Object.values(preview.db).filter(a=>(a.stock||0)>0).length}
                      </div>
                    </div>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:10, color:'var(--text-3)', marginBottom:4 }}>CON VENTAS</div>
                      <div style={{ fontFamily:'var(--font-syne)', fontSize:24, fontWeight:700, color:'var(--azul)' }}>
                        {Object.values(preview.db).filter(a=>(a.venta||0)>0).length}
                      </div>
                    </div>
                  </div>

                  {/* Preview primeras filas */}
                  <div style={{ overflowX:'auto', marginBottom:14 }}>
                    <table>
                      <thead>
                        <tr><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>PROVEEDOR</th><th style={{textAlign:'right'}}>STOCK</th><th style={{textAlign:'right'}}>VENTAS</th><th style={{textAlign:'right'}}>PRECIO</th></tr>
                      </thead>
                      <tbody>
                        {Object.values(preview.db).slice(0,5).map(a => (
                          <tr key={a.cod}>
                            <td style={{fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>{a.cod}</td>
                            <td style={{fontSize:11}}>{a.desc}</td>
                            <td style={{fontSize:11,color:'var(--text-3)'}}>{a.proveedor}</td>
                            <td style={{textAlign:'right'}}>{a.stock}</td>
                            <td style={{textAlign:'right',color:'var(--verde)'}}>{a.venta}</td>
                            <td style={{textAlign:'right',color:'var(--accent)'}}>
                              {a.precio?`$${Number(a.precio).toLocaleString('es-AR')}`:'—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:12 }}>...y {Math.max(0,Object.keys(preview.db).length-5)} más</div>

                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={()=>setPreview(null)} style={{ color:'var(--text-2)', background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'7px 14px', fontSize:12 }}>
                      Cancelar
                    </button>
                    <button onClick={handleConfirmar} style={{
                      background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)',
                      fontWeight:700, fontSize:13, padding:'8px 20px', borderRadius:'var(--radius)',
                    }}>
                      ✓ Confirmar y guardar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: Maestro */}
        {tab === 'maestro' && (
          <div>
            {articulos.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, color:'var(--text-3)' }}>
                <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
                <div style={{ fontSize:14, color:'var(--text-2)', marginBottom:8 }}>Sin artículos cargados</div>
                <div style={{ fontSize:12, marginBottom:20 }}>Cargá una planilla en la tab "↑ Cargar planilla"</div>
                <button onClick={()=>setTab('cargar')} style={{
                  background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)',
                  fontWeight:600, fontSize:13, padding:'9px 20px', borderRadius:'var(--radius)',
                }}>↑ Cargar planilla</button>
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                  {[
                    { l:'TOTAL', v:stats.total, c:'var(--text)' },
                    { l:'CON STOCK', v:stats.conStock, c:'var(--verde)' },
                    { l:'SIN STOCK', v:stats.sinStock, c:'var(--rojo)' },
                    { l:'CON VENTAS', v:stats.conVentas, c:'var(--azul)' },
                  ].map(kpi => (
                    <div key={kpi.l} className="card" style={{ padding:'12px 14px', textAlign:'center' }}>
                      <div style={{ fontSize:9, color:'var(--text-3)', letterSpacing:'0.08em', marginBottom:4 }}>{kpi.l}</div>
                      <div style={{ fontFamily:'var(--font-syne)', fontSize:24, fontWeight:700, color:kpi.c }}>{kpi.v}</div>
                    </div>
                  ))}
                </div>

                {/* Filtros */}
                <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
                  <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
                    placeholder="Buscar por código o descripción..."
                    style={{ flex:1, minWidth:200, padding:'6px 10px', fontSize:12 }} />
                  <select value={filtProv} onChange={e=>setFiltProv(e.target.value)}
                    style={{ padding:'6px 8px', fontSize:12 }}>
                    <option value="">— Todos los proveedores —</option>
                    {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {(busqueda||filtProv) && (
                    <button onClick={()=>{setBusqueda('');setFiltProv('');}} style={{
                      color:'var(--text-3)', background:'transparent', border:'1px solid var(--border)',
                      borderRadius:'var(--radius)', padding:'6px 12px', fontSize:11,
                    }}>✕ Limpiar</button>
                  )}
                </div>

                {/* Tabla */}
                <div className="card" style={{ overflowX:'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>PROVEEDOR</th><th>FAMILIA</th>
                        <th style={{textAlign:'right'}}>STOCK</th>
                        <th style={{textAlign:'right'}}>VENTAS</th>
                        <th style={{textAlign:'right'}}>PRECIO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtrados.slice(0,200).map(a => (
                        <tr key={a.cod}>
                          <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-2)'}}>{a.cod}</td>
                          <td style={{fontSize:12}}>{a.desc}</td>
                          <td style={{fontSize:11,color:'var(--text-3)'}}>{a.proveedor}</td>
                          <td style={{fontSize:11}}>{a.familia || '—'}</td>
                          <td style={{textAlign:'right',fontWeight:600,color:(a.stock||0)<=0?'var(--rojo)':'var(--verde)'}}>{a.stock??'—'}</td>
                          <td style={{textAlign:'right',color:'var(--azul)'}}>{a.venta??'—'}</td>
                          <td style={{textAlign:'right',color:'var(--accent)'}}>
                            {a.precio?`$${Number(a.precio).toLocaleString('es-AR',{minimumFractionDigits:0})}`:'—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtrados.length > 200 && (
                    <div style={{padding:'8px 12px',fontSize:11,color:'var(--text-3)',borderTop:'1px solid var(--border)'}}>
                      Mostrando 200 de {filtrados.length} · Refiná la búsqueda
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
