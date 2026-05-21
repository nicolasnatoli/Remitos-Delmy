// ─── ModuloInventario — Control de stock físico ──────────────────────────────
import React, { useState, useMemo, useCallback, useRef } from 'react';
import FiltroArticulos from './FiltroArticulos';
import * as XLSX from 'xlsx';

const C = {
  bg:'#0c0e14', p:'#111420', p2:'#161925', b1:'#1e2133', b2:'#242840',
  acc:'#f0c040', green:'#4ade80', red:'#f87171', blue:'#60a5fa',
  teal:'#2dd4bf', ora:'#fb923c', vio:'#c084fc', mut:'#6b7280', txt:'#e8eaf0',
};

const fn = v => Number(v||0).toLocaleString('es-AR');

const SUCURSALES = ['SCN-Central','S01-Solano','S03-Quilmes','SRC-Depósito'];
const LS_KEY = 'delmy_inventario_v1';

function lsGet(k,def){ try{const v=localStorage.getItem(k);return v?JSON.parse(v):def;}catch{return def;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} }

export default function ModuloInventario({ db: dbProp }) {
  const [dbLocal, setDbLocal] = React.useState({art:{},stk:{},vs:{},vq:{},vm:{},combos:{}});
  React.useEffect(()=>{
    try{
      const art=JSON.parse(localStorage.getItem('dm_art_v3')||'{}');
      const combos=JSON.parse(localStorage.getItem('dm_combos_v1')||'{}');
      setDbLocal({art,stk:{},vs:{},vq:{},vm:{},combos});
    }catch{}
  },[]);
  const db = dbProp || dbLocal;
  const [tab, setTab] = useState('interactivo');
  const [sucursal, setSucursal] = useState(SUCURSALES[0]);
  const [filtrados, setFiltrados] = useState([]);
  const [conteos, setConteos] = useState(()=>lsGet(LS_KEY,{}));
  const [busquedaRapida, setBusquedaRapida] = useState('');
  const [ultimoEscaneado, setUltimoEscaneado] = useState(null);
  const scanRef = useRef();
  const fotoRef = useRef();

  // Guardar conteos en localStorage
  const actualizarConteo = useCallback((cod, valor) => {
    setConteos(prev => {
      const nuevo = { ...prev, [cod]: { ...prev[cod], [sucursal]: valor } };
      lsSet(LS_KEY, nuevo);
      return nuevo;
    });
  }, [sucursal]);

  // Buscar artículo por código de barras o código interno
  const buscarArt = useCallback((q) => {
    if (!q || !db?.art) return null;
    const ql = q.trim().toLowerCase();
    // Exacto por cod interno
    if (db.art[q.trim()]) return [q.trim(), db.art[q.trim()]];
    // Exacto por codp
    const porCodp = Object.entries(db.art).find(([,a])=>
      (a.codp||'').toLowerCase() === ql
    );
    if (porCodp) return porCodp;
    // Código de barras / sinonimos
    const porSin = Object.entries(db.art).find(([,a])=>
      (a.sinonimo||'').toLowerCase().includes(ql)
    );
    if (porSin) return porSin;
    return null;
  }, [db?.art]);

  const handleScan = useCallback((e) => {
    if (e.key === 'Enter' && busquedaRapida) {
      const res = buscarArt(busquedaRapida);
      if (res) {
        setUltimoEscaneado(res[0]);
        setBusquedaRapida('');
      } else {
        alert(`Artículo no encontrado: ${busquedaRapida}`);
      }
    }
  }, [busquedaRapida, buscarArt]);

  // Resumen de diferencias
  const diferencias = useMemo(() => {
    return Object.entries(conteos)
      .filter(([cod, c]) => c[sucursal] !== undefined)
      .map(([cod, c]) => {
        const art = db?.art?.[cod];
        const stk = db?.stk?.[cod]||{};
        const stkMap = { 'SCN-Central':stk.DMCN, 'S01-Solano':stk.DM01, 'S03-Quilmes':stk.DM03, 'SRC-Depósito':stk.DMREC };
        const stkSistema = stkMap[sucursal]||0;
        const contado = c[sucursal];
        const dif = contado - stkSistema;
        return { cod, desc:art?.desc||cod, stkSistema, contado, dif };
      })
      .sort((a,b) => Math.abs(b.dif) - Math.abs(a.dif));
  }, [conteos, sucursal, db]);

  const conDif = diferencias.filter(d=>d.dif!==0);
  const sinDif = diferencias.filter(d=>d.dif===0);

  // Exportar resultado
  const exportarResultado = useCallback(() => {
    const rows = [['Código','Descripción','Sucursal','STK Sistema','Contado','Diferencia','Estado']];
    diferencias.forEach(d=>{
      rows.push([d.cod, d.desc, sucursal, d.stkSistema, d.contado, d.dif,
        d.dif===0?'OK':d.dif>0?'SOBRANTE':'FALTANTE']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:15},{wch:40},{wch:15},{wch:12},{wch:10},{wch:12},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.writeFile(wb, `inventario_${sucursal.replace(/\s/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }, [diferencias, sucursal]);

  // Generar planilla impresa
  const generarPlanilla = useCallback(() => {
    const rows = [['#','Código','Descripción','STK Sistema','Contado','Firma/Obs.']];
    filtrados.forEach(([cod,a],i) => {
      const stk = db?.stk?.[cod]||{};
      const stkMap = { 'SCN-Central':stk.DMCN, 'S01-Solano':stk.DM01, 'S03-Quilmes':stk.DM03 };
      rows.push([i+1, cod, a.desc||'', stkMap[sucursal]||0, '', '']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:4},{wch:15},{wch:45},{wch:12},{wch:10},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws, 'Planilla');
    XLSX.writeFile(wb, `planilla_inventario_${sucursal.replace(/\s/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }, [filtrados, sucursal, db]);

  // Procesar foto con IA
  const procesarFoto = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const b64 = await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(file);});
    try {
      const resp = await fetch('/api/ia/extract', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          tipo: 'inventario',
          imagen: b64,
          prompt: 'Extraé de esta planilla de inventario los valores de la columna "Contado" para cada artículo. Devolvé JSON: [{cod, contado}]. Solo los que tienen un número escrito.'
        })
      });
      const data = await resp.json();
      if (data.lineas?.length) {
        const nuevos = { ...conteos };
        data.lineas.forEach(({cod, contado}) => {
          if (cod && contado !== undefined) {
            nuevos[cod] = { ...(nuevos[cod]||{}), [sucursal]: Number(contado) };
          }
        });
        setConteos(nuevos);
        lsSet(LS_KEY, nuevos);
        alert(`✓ ${data.lineas.length} conteos cargados desde la foto.`);
      }
    } catch(err) { alert('Error al procesar la foto: '+err.message); }
    e.target.value='';
  }, [conteos, sucursal]);

  const artUltimoEsc = ultimoEscaneado ? db?.art?.[ultimoEscaneado] : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,fontFamily:'DM Mono,monospace',color:C.txt}}>

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:'10px 14px'}}>
        <div>
          <div style={{fontSize:12,color:C.acc,fontWeight:600,letterSpacing:'.06em'}}>CONTROL DE INVENTARIO</div>
          <div style={{fontSize:9,color:C.mut,marginTop:1}}>Recuento físico · {diferencias.length} artículos contados · {conDif.length} con diferencia</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {SUCURSALES.map(s=>(
            <button key={s} onClick={()=>setSucursal(s)}
              style={{padding:'4px 10px',background:sucursal===s?'rgba(240,192,64,.1)':'transparent',border:`1px solid ${sucursal===s?C.acc:C.b1}`,borderRadius:5,color:sucursal===s?C.acc:C.mut,fontSize:9,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${C.b1}`}}>
        {[['interactivo','◈ Interactivo'],['impreso','▤ Planilla impresa'],['resultados','⚡ Resultados'],['temporadas','◎ Temporadas']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:'10px 18px',background:'transparent',border:'none',borderBottom:`2px solid ${tab===id?C.acc:'transparent'}`,color:tab===id?C.acc:C.mut,fontSize:11,fontFamily:'DM Mono,monospace',cursor:'pointer',letterSpacing:'.04em'}}>
            {label}
          </button>
        ))}
      </div>

      {/* TAB: INTERACTIVO */}
      {tab==='interactivo'&&(
        <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:12}}>

          {/* Panel escaneo */}
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
              <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:10}}>ESCANEAR / BUSCAR</div>
              <div style={{background:C.p2,border:`2px dashed ${C.teal}44`,borderRadius:8,padding:16,textAlign:'center',marginBottom:10}}>
                <div style={{fontSize:24,opacity:.4,marginBottom:6}}>⊡</div>
                <div style={{fontSize:9,color:C.teal,marginBottom:4}}>Listo para escanear</div>
                <div style={{fontSize:8,color:C.mut}}>Enfocá el escáner o escribí el código</div>
              </div>
              <input
                ref={scanRef}
                value={busquedaRapida}
                onChange={e=>setBusquedaRapida(e.target.value)}
                onKeyDown={handleScan}
                placeholder="Código de barras o interno..."
                autoFocus
                style={{width:'100%',background:C.p2,border:`1px solid ${C.teal}44`,borderRadius:6,padding:'7px 10px',color:C.txt,fontFamily:'DM Mono,monospace',fontSize:12,outline:'none',marginBottom:8}}
              />
              {/* Artículo escaneado */}
              {ultimoEscaneado&&artUltimoEsc&&(
                <div style={{background:C.p2,border:`1px solid ${C.acc}44`,borderRadius:6,padding:10}}>
                  <div style={{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace',marginBottom:2}}>{ultimoEscaneado}</div>
                  <div style={{fontSize:10,color:C.txt,marginBottom:8,lineHeight:1.3}}>{artUltimoEsc.desc}</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:7,color:C.mut,marginBottom:2}}>CONTADO</div>
                      <input
                        type="number"
                        value={conteos[ultimoEscaneado]?.[sucursal]??''}
                        onChange={e=>actualizarConteo(ultimoEscaneado, Number(e.target.value))}
                        placeholder="Cant."
                        autoFocus
                        style={{width:'100%',background:'#0c0e14',border:`1px solid ${C.acc}66`,borderRadius:5,padding:'6px 8px',color:C.acc,fontFamily:'DM Mono,monospace',fontSize:14,textAlign:'right',outline:'none'}}
                      />
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:7,color:C.mut,marginBottom:2}}>STK SISTEMA</div>
                      <div style={{fontSize:14,color:C.mut,fontFamily:'Syne,sans-serif',fontWeight:700}}>
                        {fn((db?.stk?.[ultimoEscaneado]||{})['SCN-Central'===sucursal?'DMCN':'S01-Solano'===sucursal?'DM01':'DM03']||0)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progreso */}
            <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
              <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:10}}>PROGRESO SESIÓN</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                <div style={{background:C.p2,borderRadius:6,padding:8,textAlign:'center'}}>
                  <div style={{fontSize:7,color:C.mut,marginBottom:3}}>CONTADOS</div>
                  <div style={{fontSize:20,color:C.green,fontFamily:'Syne,sans-serif',fontWeight:700}}>{diferencias.length}</div>
                </div>
                <div style={{background:C.p2,borderRadius:6,padding:8,textAlign:'center'}}>
                  <div style={{fontSize:7,color:C.mut,marginBottom:3}}>CON DIFERENCIA</div>
                  <div style={{fontSize:20,color:conDif.length>0?C.red:C.green,fontFamily:'Syne,sans-serif',fontWeight:700}}>{conDif.length}</div>
                </div>
              </div>
              <button onClick={()=>setConteos({})||lsSet(LS_KEY,{})}
                style={{width:'100%',background:'transparent',border:`1px solid ${C.b1}`,borderRadius:5,color:C.mut,padding:'5px',fontSize:9,fontFamily:'DM Mono,monospace',cursor:'pointer',marginBottom:6}}>
                ⌦ Limpiar conteos {sucursal}
              </button>
              <button onClick={exportarResultado}
                style={{width:'100%',background:'rgba(240,192,64,.08)',border:`1px solid ${C.acc}44`,borderRadius:5,color:C.acc,padding:'5px',fontSize:9,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
                ↓ Exportar resultado
              </button>
            </div>
          </div>

          {/* Tabla de conteos */}
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {/* Filtros */}
            <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:12}}>
              <FiltroArticulos art={db?.art||{}} onChange={setFiltrados} placeholder="Filtrar artículos a contar..."/>
            </div>

            {/* Tabla */}
            <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'90px 1fr 55px 70px 55px',gap:0,padding:'6px 12px',borderBottom:`1px solid ${C.b1}`,background:C.p2}}>
                {['CÓDIGO','DESCRIPCIÓN','STK SIS.','CONTADO','DIF.'].map((h,i)=>(
                  <div key={h} style={{fontSize:7,color:C.mut,textAlign:i>1?'right':'left',letterSpacing:'.06em'}}>{h}</div>
                ))}
              </div>
              {/* Primero los que tienen diferencia */}
              {[...conDif, ...sinDif].slice(0,100).map(({cod,desc,stkSistema,contado,dif})=>{
                const hasDif = dif!==0;
                const bgRow = hasDif ? dif>0?'rgba(74,222,128,.04)':'rgba(248,113,113,.04)' : 'transparent';
                return(
                  <div key={cod} style={{display:'grid',gridTemplateColumns:'90px 1fr 55px 70px 55px',gap:0,padding:'6px 12px',borderBottom:`1px solid #0c0e14`,background:bgRow}}>
                    <div style={{fontFamily:'DM Mono,monospace',fontSize:9,color:C.blue}}>{cod}</div>
                    <div style={{fontSize:10,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{desc}</div>
                    <div style={{fontSize:9,color:C.mut,textAlign:'right'}}>{fn(stkSistema)}</div>
                    <div style={{textAlign:'right'}}>
                      <input
                        type="number"
                        value={contado??''}
                        onChange={e=>actualizarConteo(cod, Number(e.target.value))}
                        style={{width:60,background:'#0c0e14',border:`1px solid ${hasDif?C.acc:C.b1}`,borderRadius:4,padding:'2px 6px',color:hasDif?C.acc:C.mut,fontFamily:'DM Mono,monospace',fontSize:10,textAlign:'right',outline:'none'}}
                      />
                    </div>
                    <div style={{fontSize:10,color:dif===0?C.mut:dif>0?C.green:C.red,textAlign:'right',fontWeight:hasDif?700:400}}>
                      {dif===0?'✓':dif>0?'+'+fn(dif):fn(dif)}
                    </div>
                  </div>
                );
              })}
              {filtrados.length===0&&(
                <div style={{textAlign:'center',padding:20,color:C.mut,fontSize:10}}>Aplicá filtros para ver artículos a contar</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: PLANILLA IMPRESA */}
      {tab==='impreso'&&(
        <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:12}}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
              <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:10}}>CONFIGURAR PLANILLA</div>
              <div style={{fontSize:9,color:C.txt,marginBottom:6}}>Sucursal: <span style={{color:C.acc}}>{sucursal}</span></div>
              <div style={{fontSize:9,color:C.txt,marginBottom:10}}>{filtrados.length} artículos seleccionados</div>
              <div style={{fontSize:8,color:C.mut,lineHeight:1.6,marginBottom:12,background:C.p2,padding:8,borderRadius:5}}>
                1. Aplicá los filtros para seleccionar qué artículos incluir<br/>
                2. Generá la planilla Excel<br/>
                3. Imprimí y completá la columna "Contado"<br/>
                4. Fotografiá y cargá la foto para que la IA lea los valores
              </div>
              <button onClick={generarPlanilla}
                style={{width:'100%',background:'rgba(240,192,64,.08)',border:`1px solid ${C.acc}44`,borderRadius:5,color:C.acc,padding:'8px',fontSize:10,fontFamily:'DM Mono,monospace',cursor:'pointer',marginBottom:8}}>
                ↓ Generar planilla Excel
              </button>
              <div style={{fontSize:8,color:C.mut,textAlign:'center',marginBottom:8}}>— después de contar —</div>
              <button onClick={()=>fotoRef.current?.click()}
                style={{width:'100%',background:'rgba(45,212,191,.08)',border:`1px solid ${C.teal}44`,borderRadius:5,color:C.teal,padding:'8px',fontSize:10,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
                📷 Cargar foto de planilla completada
              </button>
              <input ref={fotoRef} type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={procesarFoto}/>
            </div>
          </div>

          {/* Preview planilla */}
          <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,overflow:'hidden'}}>
            <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.b1}`,background:C.p2,fontSize:8,color:C.mut,letterSpacing:'.06em'}}>
              PREVIEW — PLANILLA DE INVENTARIO · {sucursal}
            </div>
            <div style={{padding:12}}>
              <div style={{display:'grid',gridTemplateColumns:'30px 90px 1fr 80px 70px 100px',gap:0,marginBottom:6}}>
                {['#','CÓDIGO','DESCRIPCIÓN','STK SIS.','CONTADO','FIRMA/OBS.'].map((h,i)=>(
                  <div key={h} style={{fontSize:7,color:C.mut,borderBottom:`1px solid ${C.b1}`,paddingBottom:4,textAlign:i>2?'right':'left'}}>{h}</div>
                ))}
              </div>
              {filtrados.slice(0,15).map(([cod,a],i)=>{
                const stk = db?.stk?.[cod]||{};
                const stkMap = {'SCN-Central':stk.DMCN,'S01-Solano':stk.DM01,'S03-Quilmes':stk.DM03};
                return(
                  <div key={cod} style={{display:'grid',gridTemplateColumns:'30px 90px 1fr 80px 70px 100px',gap:0,padding:'5px 0',borderBottom:`1px solid ${C.p2}`}}>
                    <div style={{fontSize:8,color:C.mut}}>{i+1}</div>
                    <div style={{fontFamily:'DM Mono,monospace',fontSize:8,color:C.blue}}>{cod}</div>
                    <div style={{fontSize:9,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.desc}</div>
                    <div style={{fontSize:9,color:C.mut,textAlign:'right'}}>{fn(stkMap[sucursal]||0)}</div>
                    <div style={{borderBottom:`1px solid ${C.mut}44`,margin:'0 4px',marginTop:8}}></div>
                    <div style={{borderBottom:`1px solid ${C.mut}22`,margin:'0 4px',marginTop:8}}></div>
                  </div>
                );
              })}
              {filtrados.length>15&&<div style={{fontSize:9,color:C.mut,textAlign:'center',padding:8}}>... y {filtrados.length-15} artículos más</div>}
              {filtrados.length===0&&<div style={{fontSize:10,color:C.mut,textAlign:'center',padding:20}}>Aplicá filtros para previsualizar</div>}
            </div>
          </div>
        </div>
      )}

      {/* TAB: TEMPORADAS */}
      {tab==='temporadas'&&<TabTemporadas db={db} sucursal={sucursal}/>}

      {/* TAB: RESULTADOS */}
      {tab==='resultados'&&(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {/* KPIs */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {[
              {label:'CONTADOS',v:diferencias.length,c:C.txt},
              {label:'CON DIFERENCIA',v:conDif.length,c:conDif.length>0?C.red:C.green},
              {label:'FALTANTES',v:conDif.filter(d=>d.dif<0).length,c:C.red},
              {label:'SOBRANTES',v:conDif.filter(d=>d.dif>0).length,c:C.green},
            ].map(({label,v,c})=>(
              <div key={label} style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:'12px 14px'}}>
                <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:6}}>{label}</div>
                <div style={{fontSize:24,color:c,fontFamily:'Syne,sans-serif',fontWeight:700}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Tabla resultados */}
          <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,overflow:'hidden'}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 12px',borderBottom:`1px solid ${C.b1}`,background:C.p2}}>
              <div style={{fontSize:9,color:C.mut}}>Diferencias — {conDif.length} artículos</div>
              <button onClick={exportarResultado}
                style={{background:'rgba(240,192,64,.08)',border:`1px solid ${C.acc}44`,borderRadius:5,color:C.acc,padding:'3px 10px',fontSize:9,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
                ↓ Exportar Excel
              </button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'100px 1fr 80px 80px 80px 80px',padding:'6px 12px',borderBottom:`1px solid ${C.b1}`,background:C.p2}}>
              {['CÓDIGO','DESCRIPCIÓN','STK SIS.','CONTADO','DIF.','ESTADO'].map((h,i)=>(
                <div key={h} style={{fontSize:7,color:C.mut,textAlign:i>1?'right':'left',letterSpacing:'.06em'}}>{h}</div>
              ))}
            </div>
            {diferencias.length===0&&(
              <div style={{textAlign:'center',padding:24,color:C.mut,fontSize:11}}>Sin conteos registrados para {sucursal}</div>
            )}
            {diferencias.map(({cod,desc,stkSistema,contado,dif})=>(
              <div key={cod} style={{display:'grid',gridTemplateColumns:'100px 1fr 80px 80px 80px 80px',padding:'7px 12px',borderBottom:`1px solid #0c0e14`,background:dif!==0?(dif>0?'rgba(74,222,128,.04)':'rgba(248,113,113,.04)'):'transparent'}}>
                <div style={{fontFamily:'DM Mono,monospace',fontSize:9,color:C.blue}}>{cod}</div>
                <div style={{fontSize:10,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc}</div>
                <div style={{fontSize:9,textAlign:'right',color:C.mut}}>{fn(stkSistema)}</div>
                <div style={{fontSize:9,textAlign:'right',color:C.acc}}>{fn(contado)}</div>
                <div style={{fontSize:10,textAlign:'right',color:dif===0?C.mut:dif>0?C.green:C.red,fontWeight:dif!==0?700:400}}>
                  {dif===0?'—':dif>0?'+'+fn(dif):fn(dif)}
                </div>
                <div style={{textAlign:'right'}}>
                  <span style={{fontSize:8,padding:'1px 6px',borderRadius:8,background:dif===0?'rgba(107,114,128,.15)':dif>0?'rgba(74,222,128,.15)':'rgba(248,113,113,.15)',color:dif===0?C.mut:dif>0?C.green:C.red}}>
                    {dif===0?'OK':dif>0?'SOBRANTE':'FALTANTE'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
