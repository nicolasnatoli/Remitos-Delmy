// ─── ModuloStock — Buscador y consulta de artículos ──────────────────────────
import React, { useState, useMemo, useCallback } from 'react';
import FiltroArticulos from './FiltroArticulos';

const C = {
  bg:'#0c0e14', p:'#111420', p2:'#161925', b1:'#1e2133', b2:'#242840',
  acc:'#f0c040', green:'#4ade80', red:'#f87171', blue:'#60a5fa',
  teal:'#2dd4bf', ora:'#fb923c', vio:'#c084fc', mut:'#6b7280', txt:'#e8eaf0',
};

// ModuloStock loads DB from localStorage/Redis on mount
// db prop is optional — if not provided, loads from SK.art
const fp = v => v ? '$'+Number(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
const fn = v => v ? Number(v).toLocaleString('es-AR') : '0';

function cobertura(stk, vm) {
  if (!vm || !stk) return null;
  const semanas = Math.round((stk / vm) * 4.3);
  return semanas;
}

function CobBadge({ semanas }) {
  if (semanas === null) return null;
  const color = semanas < 2 ? C.red : semanas < 4 ? C.ora : semanas < 8 ? C.acc : C.green;
  return <span style={{fontSize:8,padding:'1px 6px',borderRadius:10,background:color+'22',color,fontFamily:'DM Mono,monospace'}}>~{semanas}sem</span>;
}

function FichaArticulo({ cod, art, combos, db }) {
  if (!cod || !art) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:300,color:C.mut,gap:8}}>
      <span style={{fontSize:28,opacity:.3}}>◎</span>
      <span style={{fontSize:11}}>Seleccioná un artículo</span>
    </div>
  );

  const stk = db?.stk?.[cod]||{};
  const vs = db?.vs?.[cod]||0;
  const vq = db?.vq?.[cod]||0;
  const vm = db?.vm?.[cod]||0;
  const totStk = (stk.DMCN||0)+(stk.DM01||0)+(stk.DM03||0);
  const cob = cobertura(totStk, vm);

  // Combos donde aparece este artículo como componente
  const combosDeEste = useMemo(() => {
    if (!combos) return [];
    return Object.entries(combos).filter(([,c])=>
      c?.componentes?.some(comp=>comp.cod===cod)
    ).map(([codCombo, c])=>{
      const comp = c.componentes.find(x=>x.cod===cod);
      return { codCombo, desc: c.desc, cant: comp?.cant||1 };
    }).sort((a,b)=>a.cant-b.cant);
  }, [combos, cod]);

  // Artículos del mismo grupo (misma familia + descripción similar)
  const similares = useMemo(() => {
    if (!db?.art) return [];
    const words = (art.desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>4).slice(0,3);
    return Object.entries(db.art)
      .filter(([k,a])=>k!==cod && a.fam===art.fam && words.some(w=>(a.desc||'').toLowerCase().includes(w)) && a.prov!==art.prov)
      .slice(0,5);
  }, [db?.art, cod, art]);

  const pctMargen = art.costoReal && art.pvMin
    ? Math.round(((art.pvMin - art.costoReal) / art.costoReal) * 100)
    : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {/* Header */}
      <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:C.txt,fontWeight:600,lineHeight:1.3,marginBottom:4}}>{art.desc||'—'}</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'}}>cod: {cod}</span>
              {art.codp&&<span style={{fontSize:9,color:C.teal,fontFamily:'DM Mono,monospace'}}>codp: {art.codp}</span>}
              {art.fam&&<span style={{fontSize:9,padding:'1px 7px',borderRadius:10,background:'rgba(45,212,191,.12)',color:C.teal}}>{art.fam}</span>}
              {art.cat&&<span style={{fontSize:9,padding:'1px 7px',borderRadius:10,background:'rgba(96,165,250,.12)',color:C.blue}}>{art.cat}</span>}
              {art.marca&&<span style={{fontSize:9,padding:'1px 7px',borderRadius:10,background:'rgba(192,132,252,.12)',color:C.vio}}>{art.marca}</span>}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
            {art.prov&&<span style={{fontSize:9,color:C.ora,padding:'2px 8px',borderRadius:10,background:'rgba(251,146,60,.1)'}}>{art.prov}</span>}
            <CobBadge semanas={cob}/>
          </div>
        </div>

        {/* Precios */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
          {[
            {label:'COSTO PLAZA', val:fp(art.costoReal), color:C.mut},
            {label:'PV MÍNIMO',   val:fp(art.pvMin),     color:C.acc, sub:pctMargen?`+${pctMargen}%`:null},
            {label:'MOSTRADOR',   val:fp(art.mostrador),  color:C.green},
            {label:'IVA',         val:art.iva?`${art.iva}%`:'—', color:C.mut},
          ].map(({label,val,color,sub})=>(
            <div key={label} style={{background:C.p2,borderRadius:6,padding:'8px 10px'}}>
              <div style={{fontSize:7,color:C.mut,letterSpacing:'.06em',marginBottom:3}}>{label}</div>
              <div style={{fontSize:13,color,fontFamily:'Syne,sans-serif',fontWeight:700}}>{val}</div>
              {sub&&<div style={{fontSize:8,color:C.mut,marginTop:1}}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* Stock por sucursal */}
        <div style={{display:'flex',gap:8}}>
          {[
            {name:'CENTRAL',  val:stk.DMCN||0, color:C.blue},
            {name:'SOLANO',   val:stk.DM01||0,  color:C.blue},
            {name:'QUILMES',  val:stk.DM03||0,  color:C.blue},
            {name:'TOTAL',    val:totStk,        color:C.teal, bold:true},
            {name:'V.SEM',    val:vs,            color:C.mut},
            {name:'V.QUIN',   val:vq,            color:C.mut},
            {name:'V.MES',    val:vm,            color:C.mut},
          ].map(({name,val,color,bold})=>(
            <div key={name} style={{flex:1,background:C.p2,borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
              <div style={{fontSize:7,color:C.mut,marginBottom:3}}>{name}</div>
              <div style={{fontSize:bold?16:13,color,fontFamily:'Syne,sans-serif',fontWeight:700}}>{fn(val)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {/* Combos */}
        <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
          <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:10}}>COMBOS QUE USAN ESTE ARTÍCULO ({combosDeEste.length})</div>
          {combosDeEste.length===0
            ? <div style={{fontSize:10,color:C.mut,textAlign:'center',padding:'12px 0'}}>Sin combos registrados</div>
            : combosDeEste.map(({codCombo,desc,cant})=>{
              // Verificar si el código del combo sigue la convención codxCant
              const esperado = `${cod}x${cant}`;
              const codMal = codCombo.toLowerCase()!==esperado.toLowerCase();
              return(
                <div key={codCombo} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',background:C.p2,borderRadius:5,marginBottom:4}}>
                  <span style={{fontFamily:'DM Mono,monospace',fontSize:9,color:codMal?C.red:C.vio,minWidth:100}}>{codCombo}</span>
                  <span style={{flex:1,fontSize:9,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc}</span>
                  <span style={{fontSize:9,color:C.acc,minWidth:30,textAlign:'right'}}>×{cant}</span>
                  {codMal&&<span style={{fontSize:8,padding:'1px 5px',borderRadius:8,background:'rgba(248,113,113,.15)',color:C.red}}>{esperado}</span>}
                </div>
              );
            })
          }
        </div>

        {/* Otros proveedores */}
        <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:14}}>
          <div style={{fontSize:8,color:C.mut,letterSpacing:'.08em',marginBottom:10}}>ARTÍCULOS SIMILARES (OTROS PROVEEDORES)</div>
          {similares.length===0
            ? <div style={{fontSize:10,color:C.mut,textAlign:'center',padding:'12px 0'}}>Sin similares detectados</div>
            : similares.map(([k,a])=>{
              const pctDif = art.costoReal && a.costoReal
                ? Math.round(((a.costoReal - art.costoReal)/art.costoReal)*100)
                : null;
              return(
                <div key={k} style={{display:'flex',alignItems:'flex-start',gap:6,padding:'6px 8px',background:C.p2,borderRadius:5,marginBottom:4}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:9,color:C.ora,marginBottom:2}}>{a.prov||'—'}</div>
                    <div style={{fontSize:10,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.desc}</div>
                    <div style={{fontSize:8,color:C.mut,fontFamily:'DM Mono,monospace'}}>{k} · {a.codp}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:11,color:C.mut,fontWeight:600}}>{fp(a.costoReal)}</div>
                    {pctDif!==null&&<div style={{fontSize:8,color:pctDif>0?C.red:C.green}}>{pctDif>0?'+':''}{pctDif}%</div>}
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>
    </div>
  );
}

export default function ModuloStock({ db: dbProp }) {
  const [dbLocal, setDbLocal] = React.useState({art:{},stk:{},vs:{},vq:{},vm:{},combos:{}});
  React.useEffect(()=>{
    import('../../utils/db').then(({default:_,loadDB})=>{
      if(typeof loadDB==='function') loadDB().then(d=>{ if(d) setDbLocal(d); });
    }).catch(()=>{
      try{
        const art=JSON.parse(localStorage.getItem('dm_art_v3')||'{}');
        const combos=JSON.parse(localStorage.getItem('dm_combos_v1')||'{}');
        setDbLocal({art,stk:{},vs:{},vq:{},vm:{},combos});
      }catch{}
    });
  },[]);
  const db = dbProp || dbLocal;
  const [filtrados, setFiltrados] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [pagina, setPagina] = useState(0);
  const POR_PAG = 50;

  const paginados = useMemo(() => filtrados.slice(pagina*POR_PAG, (pagina+1)*POR_PAG), [filtrados, pagina]);

  const handleFiltro = useCallback((lista) => {
    setFiltrados(lista);
    setPagina(0);
    setSeleccionado(null);
  }, []);

  const artSel = seleccionado ? db?.art?.[seleccionado] : null;

  if (!db?.art || Object.keys(db.art).length === 0) {
    return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:300,color:C.mut,gap:8}}>
        <span style={{fontSize:28,opacity:.3}}>⊡</span>
        <span style={{fontSize:12}}>Base de artículos no cargada</span>
        <span style={{fontSize:10}}>Hacé ↺ DB en el módulo Compras primero</span>
      </div>
    );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,fontFamily:'DM Mono,monospace',color:C.txt}}>
      {/* Barra de filtros */}
      <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,padding:12}}>
        <FiltroArticulos
          art={db.art}
          onChange={handleFiltro}
          placeholder="Buscar por código, codp, descripción..."
        />
      </div>

      {/* Contenido principal */}
      {seleccionado ? (
        <div>
          <button onClick={()=>setSeleccionado(null)}
            style={{background:'transparent',border:`1px solid ${C.b1}`,borderRadius:5,color:C.mut,padding:'4px 10px',fontSize:10,cursor:'pointer',marginBottom:10,fontFamily:'DM Mono,monospace'}}>
            ← Volver a lista
          </button>
          <FichaArticulo cod={seleccionado} art={artSel} combos={db?.combos} db={db}/>
        </div>
      ) : (
        <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:8,overflow:'hidden'}}>
          {/* Encabezados */}
          <div style={{display:'grid',gridTemplateColumns:'100px 1fr 90px 60px 60px 60px 60px 60px 70px',gap:0,padding:'6px 12px',borderBottom:`1px solid ${C.b1}`,background:C.p2}}>
            {['CÓDIGO','DESCRIPCIÓN','PROVEEDOR','FAM.','STK','V.SEM','V.MES','COSTO','PV MÍN.'].map((h,i)=>(
              <div key={h} style={{fontSize:7,color:C.mut,letterSpacing:'.06em',textAlign:i>3?'right':'left'}}>{h}</div>
            ))}
          </div>

          {/* Filas */}
          {paginados.length===0 && (
            <div style={{textAlign:'center',padding:24,color:C.mut,fontSize:11}}>
              Sin artículos — ajustá los filtros
            </div>
          )}
          {paginados.map(([cod, a])=>{
            const stk = db?.stk?.[cod]||{};
            const totStk = (stk.DMCN||0)+(stk.DM01||0)+(stk.DM03||0);
            const vm = db?.vm?.[cod]||0;
            const cob = cobertura(totStk, vm);
            const stkColor = totStk === 0 ? C.red : cob && cob<2 ? C.ora : C.txt;
            return(
              <div key={cod} onClick={()=>setSeleccionado(cod)}
                style={{display:'grid',gridTemplateColumns:'100px 1fr 90px 60px 60px 60px 60px 60px 70px',gap:0,padding:'7px 12px',borderBottom:`1px solid #0c0e14`,cursor:'pointer',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background=C.p2}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{fontFamily:'DM Mono,monospace',fontSize:9,color:C.blue}}>{cod}</div>
                <div style={{fontSize:10,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{a.desc}</div>
                <div style={{fontSize:8,color:C.ora,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.prov||'—'}</div>
                <div style={{fontSize:8,color:C.teal,textAlign:'right'}}>{a.fam||'—'}</div>
                <div style={{fontSize:9,color:stkColor,textAlign:'right',fontWeight:totStk===0?700:400}}>{fn(totStk)}</div>
                <div style={{fontSize:9,color:C.mut,textAlign:'right'}}>{fn(db?.vs?.[cod]||0)}</div>
                <div style={{fontSize:9,color:C.mut,textAlign:'right'}}>{fn(vm)}</div>
                <div style={{fontSize:9,color:C.mut,textAlign:'right'}}>{fp(a.costoReal)}</div>
                <div style={{fontSize:9,color:C.acc,textAlign:'right'}}>{fp(a.pvMin)}</div>
              </div>
            );
          })}

          {/* Paginación */}
          {filtrados.length > POR_PAG && (
            <div style={{display:'flex',gap:6,padding:'8px 12px',borderTop:`1px solid ${C.b1}`,alignItems:'center'}}>
              <button onClick={()=>setPagina(p=>Math.max(0,p-1))} disabled={pagina===0}
                style={{padding:'3px 10px',background:'transparent',border:`1px solid ${C.b1}`,borderRadius:4,color:pagina===0?C.mut:C.txt,cursor:pagina===0?'default':'pointer',fontSize:10,fontFamily:'DM Mono,monospace'}}>←</button>
              <span style={{fontSize:9,color:C.mut}}>
                {pagina*POR_PAG+1}–{Math.min((pagina+1)*POR_PAG,filtrados.length)} de {filtrados.length.toLocaleString('es-AR')}
              </span>
              <button onClick={()=>setPagina(p=>p+1)} disabled={(pagina+1)*POR_PAG>=filtrados.length}
                style={{padding:'3px 10px',background:'transparent',border:`1px solid ${C.b1}`,borderRadius:4,color:(pagina+1)*POR_PAG>=filtrados.length?C.mut:C.txt,cursor:(pagina+1)*POR_PAG>=filtrados.length?'default':'pointer',fontSize:10,fontFamily:'DM Mono,monospace'}}>→</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
