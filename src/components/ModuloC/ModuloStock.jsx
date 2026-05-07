// ===== MÓDULO STOCK+ V3 =====
import React, { useState, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';

const fn = n => Number(n||0).toLocaleString('es-AR');

const SK = {
  art:'dm_art_v3', stk:'dm_stk_v3',
  vs:'dm_vs_v3', vq:'dm_vq_v3', vm:'dm_vm_v3', vh:'dm_vh_v3',
  plan:'dm_plan_v3', share:'dm_share_v3', meta:'dm_meta_v3',
  pins:'dm_pins_v3',
};

// ─── Compactar/expandir ───────────────────────────────────────────────────────
const compactArt  = e => { const o={}; for(const[k,a]of Object.entries(e)) o[k]=`${a.prov}|${a.codp}|${a.desc}|${a.fam}|${a.cat||''}|${a.marca||''}|${a.costoReal||0}|${a.pvMin||0}|${a.mostrador||0}`; return o; };
const expandArt   = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split('|');o[k]={prov:p[0]||'',codp:p[1]||'',desc:p[2]||'',fam:p[3]||'',cat:p[4]||'',marca:p[5]||'',costoReal:+p[6]||0,pvMin:+p[7]||0,mostrador:+p[8]||0};} return o; };
const compactStk  = e => { const o={}; for(const[k,s]of Object.entries(e)) o[k]=`${s.DM01||0},${s.DM03||0},${s.DMCN||0}`; return o; };
const expandStk   = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={DM01:+p[0]||0,DM03:+p[1]||0,DMCN:+p[2]||0};} return o; };
const compactVent = o => Object.entries(o).filter(([,v])=>v>0).map(([k,v])=>`${k}:${v}`).join('|');
const expandVent  = s => { if(!s||typeof s!=='string')return{}; const o={}; s.replace(/^"|"$/g,'').split('|').forEach(p=>{const i=p.lastIndexOf(':');if(i>0)o[p.slice(0,i)]=+p.slice(i+1)||0;}); return o; };
const compactPlan = e => { const o={}; for(const[k,p]of Object.entries(e)) if(p.ac||p.d1||p.d3||p.dc) o[k]=`${p.ac||0},${p.d1||0},${p.d3||0},${p.dc||0}`; return o; };
const expandPlan  = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={ac:+p[0]||0,d1:+p[1]||0,d3:+p[2]||0,dc:+p[3]||0};} return o; };

function tryGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}}
function trySet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function trySetRaw(k,v){try{localStorage.setItem(k,v);}catch{}}

function loadMEM(){
  const artC=tryGet(SK.art,null); const art=artC?expandArt(artC):{};
  const stkC=tryGet(SK.stk,null); const stk=stkC?expandStk(stkC):{};
  const vs=expandVent(localStorage.getItem(SK.vs)||'');
  const vq=expandVent(localStorage.getItem(SK.vq)||'');
  const vm=expandVent(localStorage.getItem(SK.vm)||'');
  const vh=expandVent(localStorage.getItem(SK.vh)||'');
  const sh=tryGet(SK.share,null); const planC=sh?.planC||tryGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  const meta=tryGet(SK.meta,{});
  return {art,stk,vs,vq,vm,vh,plan,meta};
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseFormatoProveedores(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  let hRow=2;
  for(let i=0;i<Math.min(raw.length,8);i++){if(raw[i].some(c=>String(c).toLowerCase().includes('digo'))){hRow=i;break;}}
  const hdrs=raw[hRow].map(h=>String(h||'').trim());
  const fi=name=>hdrs.findIndex(h=>h.toLowerCase().includes(name.toLowerCase()));
  const num=v=>{const n=parseFloat(String(v||'0').replace(/[$\s]/g,'').replace(',','.'));return isNaN(n)?0:n;};
  const iCod=Math.max(0,fi('código')>=0?fi('código'):fi('codigo'));
  const iProv=Math.max(1,fi('proveedor'));
  const iCodP=fi('cod.prov')>=0?fi('cod.prov'):fi('codp')>=0?fi('codp'):2;
  const iDesc=Math.max(3,fi('descripción')>=0?fi('descripción'):fi('descripcion'));
  const iFam=Math.max(6,fi('familia'));
  const iMarca=fi('marca'); const iCat=fi('categ');
  const iMostrador=fi('01 - mostrador')>=0?fi('01 - mostrador'):fi('mostrador');
  const iCostoReal=fi('costo real');
  const iPVMin=fi('precio de venta mín')>=0?fi('precio de venta mín'):fi('venta minimo')>=0?fi('venta minimo'):fi('precio de venta min');
  const artMap={};
  for(let i=hRow+1;i<raw.length;i++){
    const r=raw[i]; const cod=String(r[iCod]||'').trim(); if(!cod)continue;
    if(!artMap[cod])artMap[cod]=[];
    artMap[cod].push({prov:String(r[iProv]||'').trim(),codp:String(r[iCodP]||'').trim(),desc:String(r[iDesc]||'').trim(),fam:String(r[iFam]||'').trim(),marca:iMarca>=0?String(r[iMarca]||'').trim():'',cat:iCat>=0?String(r[iCat]||'').trim():'',mostrador:iMostrador>=0?num(r[iMostrador]):0,costoReal:iCostoReal>=0?num(r[iCostoReal]):0,pvMin:iPVMin>=0?num(r[iPVMin]):0});
  }
  const art={};
  for(const[cod,entries]of Object.entries(artMap)){
    entries.sort((a,b)=>{const sa=a.prov&&a.prov!=='SIN PROVEEDOR'?2:a.prov?1:0;const sb=b.prov&&b.prov!=='SIN PROVEEDOR'?2:b.prov?1:0;return sb-sa;});
    art[cod]=entries[0];
  }
  return art;
}

function parseStk(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  const cl=v=>{let s=String(v===null||v===undefined?'':v).trim();return s.startsWith("'")?s.slice(1).trim():s;};
  const num=v=>{const n=parseFloat(cl(v).replace(',','.'));return isNaN(n)?0:n;};
  let hRow=2;
  for(let i=0;i<Math.min(raw.length,8);i++){if(raw[i].map(v=>cl(v).toLowerCase()).some(s=>s==='código'||s==='codigo')){hRow=i;break;}}
  const hdrs=raw[hRow].map(v=>cl(v));
  const iCod=hdrs.findIndex(h=>h.toLowerCase()==='código'||h.toLowerCase()==='codigo');
  const iDM01=hdrs.findIndex(h=>h.includes('01-'));
  const iDM03=hdrs.findIndex(h=>h.includes('02-'));
  const iDMCN=hdrs.findIndex(h=>h.includes('05-'));
  const stk={};
  if(iDM01>=0&&iDM03>=0&&iDMCN>=0){
    for(let i=hRow+1;i<raw.length;i++){
      const r=raw[i]; const cod=cl(r[iCod>=0?iCod:0]); if(!cod||cod.toLowerCase()==='código')continue;
      stk[cod]={DM01:num(r[iDM03]),DM03:num(r[iDMCN]),DMCN:num(r[iDM01])};
    }
  }
  return stk;
}

function parseVentas(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  let hRow=2;
  for(let i=0;i<Math.min(raw.length,8);i++){if(raw[i].some(c=>String(c).toLowerCase().includes('digo'))){hRow=i;break;}}
  const hdrs=raw[hRow].map(h=>String(h||'').toLowerCase().trim());
  const iCod=Math.max(hdrs.findIndex(h=>h.includes('digo')),1);
  const iVent=Math.max(hdrs.findIndex(h=>h.includes('venta total')),7);
  const ventas={};
  for(let i=hRow+1;i<raw.length;i++){const r=raw[i];const cod=String(r[iCod]||'').trim();if(!cod)continue;ventas[cod]=parseFloat(String(r[iVent]||'0').replace(',','.'))||0;}
  return ventas;
}

function getProveedores(art){
  const pm={};
  for(const[,a]of Object.entries(art)){const prov=a.prov&&a.prov.trim()?a.prov.trim():'SIN PROVEEDOR';if(!pm[prov])pm[prov]={n:0,fams:new Set()};pm[prov].n++;if(a.fam)pm[prov].fams.add(a.fam);}
  return Object.entries(pm).sort((a,b)=>a[0].localeCompare(b[0])).map(([nombre,d])=>({nombre,n:d.n,fams:[...d.fams]}));
}

function getArts(mem,prov){
  return Object.entries(mem.art)
    .filter(([,a])=>(a.prov&&a.prov.trim()?a.prov.trim():'SIN PROVEEDOR')===prov)
    .map(([cod,a])=>{
      const s=mem.stk[cod]||{DM01:0,DM03:0,DMCN:0};
      const p=mem.plan[cod]||{ac:0,d1:0,d3:0,dc:0};
      return{cod,desc:a.desc,codp:a.codp,fam:a.fam,cat:a.cat||'',marca:a.marca||'',
        costoReal:a.costoReal||0,pvMin:a.pvMin||0,mostrador:a.mostrador||0,
        DM01:s.DM01,DM03:s.DM03,DMCN:s.DMCN,tot:s.DM01+s.DM03+s.DMCN,
        vs:mem.vs[cod]||0,vq:mem.vq[cod]||0,vm:mem.vm[cod]||0,vh:mem.vh[cod]||0,
        ac:p.ac,d1:p.d1,d3:p.d3,dc:p.dc};
    });
}

// ─── Input numérico sin flechas, sin saltar campo ────────────────────────────
function NumInput({value, onChange, color, disabled, width=54, placeholder='—'}){
  const [local, setLocal] = useState(value||'');
  const ref = useRef();
  // sync cuando cambia externamente
  React.useEffect(()=>{ if(document.activeElement!==ref.current) setLocal(value||''); },[value]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e=>{
        const v=e.target.value.replace(/[^0-9]/g,'');
        setLocal(v);
        onChange(v===''?0:parseInt(v,10));
      }}
      onBlur={()=>setLocal(value||'')}
      style={{
        width, padding:'3px 5px', fontSize:10, textAlign:'right',
        background:'#0c0e14',
        color: value>0 ? (color||'#f0c040') : '#e8eaf0',
        border:`1px solid ${value>0?(color||'#f0c040'):'#1e2133'}`,
        borderRadius:3, fontFamily:'DM Mono,monospace', outline:'none',
        opacity: disabled?0.3:1,
      }}
    />
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ModuloStock() {
  const [mem,       setMem]      = useState(loadMEM);
  const [provSel,   setProvSel]  = useState(null);
  const [showProv,  setShowProv] = useState(true);
  const [provQ,     setProvQ]    = useState('');
  const [filterQ,   setFilterQ]  = useState('');
  const [filterFam, setFilterFam]= useState('');
  const [filterCat, setFilterCat]= useState('');
  const [soloComp,  setSoloComp] = useState(false);
  const [sortCol,   setSortCol]  = useState('desc');
  const [sortDir,   setSortDir]  = useState(1);
  const [loading,   setLoading]  = useState({});
  const [pins,      setPins]     = useState(()=>tryGet(SK.pins,{}));

  const togglePin = useCallback((cod)=>{
    setPins(prev=>{
      const next={...prev,[cod]:!prev[cod]};
      if(!next[cod])delete next[cod];
      trySet(SK.pins,next);
      return next;
    });
  },[]);

  const loadFile = useCallback(async(tipo,file)=>{
    if(!file)return;
    setLoading(p=>({...p,[tipo]:true}));
    try{
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:'array',cellDates:false});
      setMem(prev=>{
        const next={...prev};
        if(tipo==='art'){next.art=parseFormatoProveedores(wb);trySet(SK.art,compactArt(next.art));next.meta={...next.meta,art:{f:file.name,n:Object.keys(next.art).length,t:Date.now()}};}
        else if(tipo==='stk'){next.stk=parseStk(wb);trySet(SK.stk,compactStk(next.stk));next.meta={...next.meta,stk:{f:file.name,n:Object.keys(next.stk).length,t:Date.now()}};}
        else{const v=parseVentas(wb);next[tipo]=v;trySetRaw(SK[tipo],compactVent(v));next.meta={...next.meta,[tipo]:{f:file.name,n:Object.keys(v).length,t:Date.now()}};}
        trySet(SK.meta,next.meta);
        trySet(SK.share,{planC:compactPlan(next.plan),t:Date.now()});
        return next;
      });
    }catch(e){console.error('[Stock] loadFile:',e);}
    finally{setLoading(p=>({...p,[tipo]:false}));}
  },[]);

  const updPlan = useCallback((cod,field,val)=>{
    const v=Math.max(0,parseInt(val)||0);
    setMem(prev=>{
      const plan={...prev.plan,[cod]:{...(prev.plan[cod]||{ac:0,d1:0,d3:0,dc:0}),[field]:v}};
      if(field==='ac'&&!v)plan[cod]={ac:0,d1:0,d3:0,dc:0};
      const compact=compactPlan(plan);
      trySet(SK.plan,compact); trySet(SK.share,{planC:compact,t:Date.now()});
      return{...prev,plan};
    });
  },[]);

  const doReset = useCallback(()=>{
    if(!window.confirm('¿Eliminar todos los datos?'))return;
    Object.values(SK).forEach(k=>{try{localStorage.removeItem(k);}catch{}});
    setMem({art:{},stk:{},vs:{},vq:{},vm:{},vh:{},plan:{},meta:{}});
    setPins({});
    setProvSel(null);setShowProv(true);
  },[]);

  const exportExcel = useCallback(()=>{
    if(!provSel)return;
    const arts=getArts(mem,provSel);
    const hasV=Object.keys(mem.vs).length>0; const hasVh=Object.keys(mem.vh).length>0;
    const hdrs=['Código','Cód.Prov','Descripción','Familia','Categoría','Costo Real','PV Min','Mostrador','Stk Central','Stk Solano','Stk Varela','Stk Total'];
    if(hasVh)hdrs.push('Prom.Hist.Sem');
    if(hasV)hdrs.push('V.Semana','V.Quincena','V.Mes');
    hdrs.push('A Comprar','→Central','→Solano','→Varela','→DP(auto)','Fijado');
    const rows=[hdrs];
    arts.forEach(a=>{
      const p=mem.plan[a.cod]||{ac:0,d1:0,d3:0,dc:0};
      const dp=Math.max(0,p.ac-p.d1-p.d3-p.dc);
      const r=[a.cod,a.codp,a.desc,a.fam,a.cat,a.costoReal,a.pvMin,a.mostrador,a.DMCN,a.DM01,a.DM03,a.DM01+a.DM03+a.DMCN];
      if(hasVh)r.push(a.vh);
      if(hasV)r.push(a.vs,a.vq,a.vm);
      r.push(p.ac||0,p.dc||0,p.d1||0,p.d3||0,dp,pins[a.cod]?'✓':'');
      rows.push(r);
    });
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'Planilla');
    XLSX.writeFile(wb,`planilla_${provSel}_${new Date().toISOString().slice(0,10)}.xlsx`);
  },[mem,provSel,pins]);

  const enviarACompras = useCallback(()=>{
    // Enviar artículos fijados o con cantidad a comprar
    const planActual={...mem.plan};
    // Asegurar que artículos fijados sin cantidad tengan entry
    Object.keys(pins).forEach(cod=>{
      if(!planActual[cod])planActual[cod]={ac:0,d1:0,d3:0,dc:0};
    });
    const n=Object.entries(planActual).filter(([cod,p])=>p.ac>0||pins[cod]).length;
    if(!n){alert('Fijá o completá cantidad en al menos 1 artículo');return;}
    const compact=compactPlan(planActual);
    trySet(SK.plan,compact);
    trySet(SK.share,{planC:compact,pins:{...pins},prov:provSel,t:Date.now()});
    alert(`✓ ${n} artículos enviados a Compras`);
  },[mem.plan,pins,provSel]);

  const sortBy=(col)=>{ if(sortCol===col)setSortDir(d=>d*-1); else{setSortCol(col);setSortDir(1);} };

  const proveedores    = useMemo(()=>getProveedores(mem.art),[mem.art]);
  const provsFiltrados = useMemo(()=>{const q=provQ.toLowerCase();return q?proveedores.filter(p=>p.nombre.toLowerCase().includes(q)):proveedores;},[proveedores,provQ]);
  const hasArt = Object.keys(mem.art).length>0;
  const hasV   = Object.keys(mem.vs).length>0||Object.keys(mem.vq).length>0||Object.keys(mem.vm).length>0;
  const hasVh  = Object.keys(mem.vh).length>0;

  const UZONES=[
    {id:'art',icon:'📋',label:'ARTÍCULOS + PROVEEDORES',sub:'FormatoProveedores.xlsx'},
    {id:'stk',icon:'📦',label:'STOCK POR SUCURSAL',sub:'StockDisponible.xlsx'},
    {id:'vs', icon:'📊',label:'VENTAS SEMANA',sub:'7 días'},
    {id:'vq', icon:'📊',label:'VENTAS QUINCENA',sub:'15 días'},
    {id:'vm', icon:'📊',label:'VENTAS MES',sub:'30 días'},
    {id:'vh', icon:'📈',label:'PROM. HISTÓRICO',sub:'Semanal histórico'},
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:'#0c0e14'}}>
      {/* Badges */}
      <div style={{padding:'7px 14px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
        {UZONES.map(u=>{
          const loaded=mem.meta[u.id];
          return(
            <span key={u.id} style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,fontWeight:500,background:loaded?'rgba(74,222,128,.12)':'rgba(248,113,113,.12)',color:loaded?'#4ade80':'#f87171',border:`1px solid ${loaded?'rgba(74,222,128,.3)':'rgba(248,113,113,.3)'}`}}>
              {u.label.split(' ')[0]}: {loaded?fn(loaded.n):'—'}
            </span>
          );
        })}
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={doReset} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 9px',border:'1px solid #6b7280',background:'transparent',color:'#6b7280'}}>✕ Reset</button>
          <button onClick={exportExcel} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 9px',border:'1px solid rgba(45,212,191,.3)',background:'rgba(45,212,191,.1)',color:'#2dd4bf'}}>↓ Excel</button>
          <button onClick={enviarACompras} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 9px',border:'1px solid rgba(192,132,252,.3)',background:'rgba(192,132,252,.1)',color:'#c084fc'}}>→ Compras</button>
        </div>
      </div>

      {/* Zonas de carga */}
      <div style={{padding:'8px 12px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',display:'flex',gap:7,flexWrap:'wrap',flexShrink:0}}>
        {UZONES.map(u=>(
          <UZone key={u.id} {...u} loaded={!!mem.meta[u.id]} info={mem.meta[u.id]} loading={!!loading[u.id]} onFile={f=>loadFile(u.id,f)} />
        ))}
      </div>

      {/* Contenido */}
      <div style={{flex:1,overflow:'auto',padding:14}}>
        {!hasArt ? <EmptyStock /> :
         (!provSel||showProv) ? (
           <ProvSelector provs={provsFiltrados} total={proveedores.length} q={provQ} setQ={setProvQ} sel={provSel}
             onSel={p=>{setProvSel(p);setProvQ(p);setShowProv(false);setFilterQ('');setFilterFam('');setFilterCat('');}} />
         ) : (
           <TablaProveedor mem={mem} provSel={provSel} hasV={hasV} hasVh={hasVh}
             filterQ={filterQ} setFilterQ={setFilterQ}
             filterFam={filterFam} setFilterFam={setFilterFam}
             filterCat={filterCat} setFilterCat={setFilterCat}
             soloComp={soloComp} setSoloComp={setSoloComp}
             sortCol={sortCol} sortDir={sortDir} sortBy={sortBy}
             updPlan={updPlan} pins={pins} togglePin={togglePin}
             onBack={()=>{setShowProv(true);setProvSel(null);}} />
         )
        }
      </div>
    </div>
  );
}

function UZone({id,icon,label,sub,loaded,info,loading,onFile}){
  const ref=React.useRef();
  return(
    <div onClick={()=>ref.current.click()} style={{border:`2px dashed ${loaded?'rgba(74,222,128,.4)':'#1e2133'}`,background:loaded?'rgba(74,222,128,.04)':'transparent',borderRadius:4,padding:'7px 11px',display:'flex',alignItems:'center',gap:7,cursor:'pointer',minWidth:130,flex:'1 1 130px',transition:'all .15s'}}>
      <input ref={ref} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={e=>{onFile(e.target.files[0]);e.target.value='';}} />
      <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
      <div>
        <div style={{fontSize:9,fontWeight:500,letterSpacing:'.04em',color:loaded?'#4ade80':'#e8eaf0'}}>{loading?'⏳ Procesando...':(loaded?'✓ ':'')+label+(loaded&&info?` · ${fn(info.n)}`:'')}</div>
        <div style={{fontSize:8,color:'#6b7280',marginTop:1}}>{sub}</div>
      </div>
    </div>
  );
}

function EmptyStock(){
  return(
    <div style={{textAlign:'center',padding:'50px 20px',color:'#6b7280'}}>
      <div style={{fontSize:36,marginBottom:12}}>📋</div>
      <div style={{fontSize:13,color:'#e8eaf0',marginBottom:6}}>Cargá las planillas para comenzar</div>
      <div style={{fontSize:11,lineHeight:1.9}}>1. FormatoProveedores.xlsx<br/>2. StockDisponible.xlsx<br/>3. Planillas de ventas (opcional)</div>
    </div>
  );
}

function ProvSelector({provs,total,q,setQ,sel,onSel}){
  return(
    <div style={{background:'#111420',border:'1px solid #1e2133',borderRadius:5,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 12px',borderBottom:'1px solid #1e2133'}}>
        <span style={{fontSize:9,color:'#6b7280',letterSpacing:'.1em',textTransform:'uppercase'}}>SELECCIONAR PROVEEDOR</span>
        <span style={{fontSize:9,color:'#6b7280'}}>{provs.length} de {total}</span>
      </div>
      <div style={{padding:'8px 10px'}}>
        <input placeholder="Buscar proveedor..." value={q} onChange={e=>setQ(e.target.value)}
          style={{width:'100%',fontSize:12,padding:'6px 10px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,outline:'none',fontFamily:'DM Mono,monospace'}} />
      </div>
      <div style={{maxHeight:340,overflowY:'auto'}}>
        {provs.map(p=>(
          <div key={p.nombre} onClick={()=>onSel(p.nombre)}
            style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #181b27',borderLeft:`2px solid ${p.nombre===sel?'#f0c040':'transparent'}`,background:p.nombre===sel?'rgba(240,192,64,.06)':'transparent'}}>
            <div style={{fontSize:11,color:'#e8eaf0'}}>{p.nombre}</div>
            <div style={{fontSize:9,color:'#6b7280',marginTop:2}}>{p.n} artículos · {p.fams.slice(0,3).join(', ')}</div>
          </div>
        ))}
        {provs.length===0&&<div style={{padding:20,textAlign:'center',color:'#6b7280',fontSize:11}}>Sin resultados</div>}
      </div>
    </div>
  );
}

function TablaProveedor({mem,provSel,hasV,hasVh,filterQ,setFilterQ,filterFam,setFilterFam,filterCat,setFilterCat,soloComp,setSoloComp,sortCol,sortDir,sortBy,updPlan,pins,togglePin,onBack}){
  let arts=getArts(mem,provSel);
  const fams=[...new Set(arts.map(a=>a.fam).filter(Boolean))].sort();
  const cats=[...new Set(arts.filter(a=>!filterFam||a.fam===filterFam).map(a=>a.cat).filter(Boolean))].sort();

  if(filterFam)arts=arts.filter(a=>a.fam===filterFam);
  if(filterCat)arts=arts.filter(a=>a.cat===filterCat);
  if(filterQ){const tokens=filterQ.toLowerCase().split(/\s+/).filter(Boolean);arts=arts.filter(a=>tokens.every(t=>(a.desc+a.cod+a.codp).toLowerCase().includes(t)));}
  if(soloComp)arts=arts.filter(a=>a.ac>0||pins[a.cod]);

  // Separar fijados y no fijados
  const fijados=arts.filter(a=>pins[a.cod]||(a.ac>0||a.d1>0||a.d3>0||a.dc>0));
  const normales=arts.filter(a=>!pins[a.cod]&&!(a.ac>0||a.d1>0||a.d3>0||a.dc>0));

  const sortFn=(a,b)=>{
    const va=a[sortCol]||0,vb=b[sortCol]||0;
    if(typeof va==='string')return sortDir*va.localeCompare(vb);
    return sortDir*(va-vb);
  };
  fijados.sort(sortFn);
  normales.sort(sortFn);
  const artsOrdenados=[...fijados,...normales];

  const totCen=arts.reduce((s,a)=>s+a.DMCN,0);
  const totSol=arts.reduce((s,a)=>s+a.DM01,0);
  const totVar=arts.reduce((s,a)=>s+a.DM03,0);
  const totComp=arts.reduce((s,a)=>s+a.ac,0);
  const totDP=arts.reduce((s,a)=>s+Math.max(0,a.ac-a.d1-a.d3-a.dc),0);

  const Th=({col,label,style})=>(
    <th onClick={()=>sortBy(col)} style={{fontSize:9,color:sortCol===col?'#f0c040':'#6b7280',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',...style}}>
      {label}{sortCol===col?(sortDir>0?' ↑':' ↓'):''}
    </th>
  );

  return(
    <div>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:7,marginBottom:10}}>
        {[
          {l:'ARTÍCULOS', v:fn(arts.length),   c:'#e8eaf0'},
          {l:'CENTRAL',   v:fn(totCen),         c:'#2dd4bf'},
          {l:'SOLANO',    v:fn(totSol),          c:'#60a5fa'},
          {l:'VARELA',    v:fn(totVar),          c:'#4ade80'},
          {l:'A COMPRAR', v:fn(totComp),         c:'#f0c040'},
          {l:'→ DP AUTO', v:fn(totDP),           c:'#c084fc'},
        ].map(k=>(
          <div key={k.l} style={{background:'#111420',border:'1px solid #1e2133',borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:17,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:'flex',gap:7,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={onBack} style={{fontSize:10,padding:'4px 10px',color:'#6b7280',cursor:'pointer',background:'transparent',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace'}}>← Proveedores</button>
        <select value={filterFam} onChange={e=>{setFilterFam(e.target.value);setFilterCat('');}}
          style={{fontSize:10,padding:'4px 8px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace'}}>
          <option value="">— Todas las familias —</option>
          {fams.map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
          style={{fontSize:10,padding:'4px 8px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace'}}>
          <option value="">— Todas las categorías —</option>
          {cats.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <input value={filterQ} onChange={e=>setFilterQ(e.target.value)} placeholder="Buscar artículo o código..."
          style={{flex:1,minWidth:140,fontSize:11,padding:'4px 8px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,outline:'none',fontFamily:'DM Mono,monospace'}} />
        <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10,cursor:'pointer',color:'#e8eaf0'}}>
          <input type="checkbox" checked={soloComp} onChange={e=>setSoloComp(e.target.checked)} style={{accentColor:'#f0c040'}} />
          Solo fijados/compra
        </label>
        {hasV&&(
          <div style={{display:'flex',gap:4,fontSize:8,color:'#6b7280',alignItems:'center'}}>
            STOCK:
            {[['#4ade80','#0c0e14','>MES'],['#f0c040','#0c0e14','>QUIN'],['#f87171','#fff','<SEM']].map(([bg,co,t])=>(
              <span key={t} style={{background:bg,color:co,padding:'1px 5px',borderRadius:2,fontWeight:600}}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Tabla */}
      <div style={{overflowX:'auto',background:'#111420',border:'1px solid #1e2133',borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr>
              <th style={{fontSize:9,color:'#6b7280',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',width:28,textAlign:'center'}}>📌</th>
              <Th col="cod"  label="CÓDIGO"      style={{width:'10%'}} />
              <th style={{fontSize:9,color:'#6b7280',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',width:'8%',textTransform:'uppercase',letterSpacing:'.06em'}}>CÓD.PROV</th>
              <Th col="desc" label="DESCRIPCIÓN" />
              <Th col="DMCN" label="CENTRAL"     style={{textAlign:'right',color:'#2dd4bf',width:65}} />
              <Th col="DM01" label="SOLANO"      style={{textAlign:'right',color:'#60a5fa',width:65}} />
              <Th col="DM03" label="VARELA"      style={{textAlign:'right',color:'#4ade80',width:65}} />
              <Th col="tot"  label="TOTAL"       style={{textAlign:'right',width:65}} />
              {hasVh&&<Th col="vh" label="HIST"  style={{textAlign:'right',fontSize:8,width:55,color:'#6b7280'}} />}
              {hasV&&<>
                <Th col="vs" label="V.SEM"       style={{textAlign:'right',width:55}} />
                <Th col="vq" label="V.QUIN"      style={{textAlign:'right',fontSize:8,width:55,color:'#6b7280'}} />
                <Th col="vm" label="V.MES"       style={{textAlign:'right',fontSize:8,width:55,color:'#6b7280'}} />
              </>}
              <th style={{fontSize:9,color:'#f0c040',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:68,textTransform:'uppercase'}}>A COMPRAR</th>
              <th style={{fontSize:8,color:'#2dd4bf',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:58,textTransform:'uppercase'}}>→CENTRAL</th>
              <th style={{fontSize:8,color:'#60a5fa',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:58,textTransform:'uppercase'}}>→SOLANO</th>
              <th style={{fontSize:8,color:'#4ade80',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:58,textTransform:'uppercase'}}>→VARELA</th>
              <th style={{fontSize:8,color:'#c084fc',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:50,textTransform:'uppercase'}}>→DP</th>
            </tr>
          </thead>
          <tbody>
            {artsOrdenados.length===0&&<tr><td colSpan={20} style={{textAlign:'center',padding:24,color:'#6b7280',fontSize:11}}>Sin artículos</td></tr>}
            {artsOrdenados.map((a,idx)=>{
              const esFijado=!!pins[a.cod];
              const tieneDatos=a.ac>0||a.d1>0||a.d3>0||a.dc>0;
              const esSeparador=idx===fijados.length&&idx>0&&normales.length>0;
              return(
                <React.Fragment key={a.cod}>
                  {esSeparador&&(
                    <tr>
                      <td colSpan={20} style={{padding:'3px 7px',background:'rgba(30,33,51,.5)',borderBottom:'1px solid #1e2133',fontSize:8,color:'#4b5563',letterSpacing:'.08em',textTransform:'uppercase'}}>
                        — Resto del catálogo —
                      </td>
                    </tr>
                  )}
                  <ArtRow art={a} mem={mem} hasV={hasV} hasVh={hasVh} updPlan={updPlan}
                    pinned={esFijado} onPin={()=>togglePin(a.cod)} hasDatos={tieneDatos} />
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:7,fontSize:9,color:'#6b7280'}}>
        {arts.length} artículos · {fijados.length} fijados/con compra
      </div>
    </div>
  );
}

function ArtRow({art,mem,hasV,hasVh,updPlan,pinned,onPin,hasDatos}){
  const p=mem.plan[art.cod]||{ac:0,d1:0,d3:0,dc:0};
  const dp=Math.max(0,p.ac-p.d1-p.d3-p.dc);
  const over=(p.d1+p.d3+p.dc)>p.ac&&p.ac>0;
  const vm=mem.vm[art.cod]||0,vq=mem.vq[art.cod]||0,vs=mem.vs[art.cod]||0;
  const tot=art.DM01+art.DM03+art.DMCN;
  let totColor='#e8eaf0';let totExtra={};
  if(hasV&&(vm||vq||vs)){
    if(tot>=vm&&vm>0)totColor='#4ade80';
    else if(tot>=vq&&vq>0)totColor='#f0c040';
    else if(tot>=vs&&vs>0){totColor='#f87171';totExtra={border:'1px solid #f87171',borderRadius:3,padding:'0 4px',background:'rgba(248,113,113,.1)'};}
    else if(vs>0){totColor='#fff';totExtra={background:'#f87171',borderRadius:3,padding:'0 4px'};}
  }
  const rowBg=pinned?'rgba(240,192,64,.04)':hasDatos?'rgba(96,165,250,.02)':'transparent';
  const td=(c,s)=><td style={{padding:'4px 7px',borderBottom:'1px solid #181b27',fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;

  return(
    <tr style={{background:rowBg}}>
      {/* Pin */}
      <td style={{padding:'4px 7px',borderBottom:'1px solid #181b27',textAlign:'center'}}>
        <button onClick={onPin} style={{background:'transparent',border:'none',cursor:'pointer',fontSize:12,color:pinned?'#f0c040':'#4b5563',padding:0}}>
          {pinned?'📌':'·'}
        </button>
      </td>
      {td(art.cod,{fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'})}
      {td(art.codp,{fontSize:9,color:'#6b7280'})}
      {td(<span title={art.desc} style={{display:'block',maxWidth:190,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:10}}>{art.desc}</span>)}
      {td(art.DMCN||'—',{textAlign:'right',color:art.DMCN>0?'#2dd4bf':'#4b5563'})}
      {td(art.DM01||'—',{textAlign:'right',color:art.DM01>0?'#60a5fa':'#4b5563'})}
      {td(art.DM03||'—',{textAlign:'right',color:art.DM03>0?'#4ade80':'#4b5563'})}
      {td(<span style={{display:'inline-block',color:totColor,...totExtra}}>{tot||'—'}</span>,{textAlign:'right'})}
      {hasVh&&td(art.vh||'—',{textAlign:'right',color:'#6b7280'})}
      {hasV&&td(art.vs||'—',{textAlign:'right',fontWeight:art.vs>0?500:400,color:art.vs>0?'#e8eaf0':'#4b5563'})}
      {hasV&&td(art.vq||'—',{textAlign:'right',color:'#6b7280'})}
      {hasV&&td(art.vm||'—',{textAlign:'right',color:'#6b7280'})}
      <td style={{textAlign:'right',padding:'3px 5px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.ac} onChange={v=>updPlan(art.cod,'ac',v)} color='#f0c040' />
      </td>
      <td style={{textAlign:'right',padding:'3px 5px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.dc} onChange={v=>updPlan(art.cod,'dc',v)} color='#2dd4bf' disabled={!p.ac&&!pinned} />
      </td>
      <td style={{textAlign:'right',padding:'3px 5px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.d1} onChange={v=>updPlan(art.cod,'d1',v)} color='#60a5fa' disabled={!p.ac&&!pinned} />
      </td>
      <td style={{textAlign:'right',padding:'3px 5px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.d3} onChange={v=>updPlan(art.cod,'d3',v)} color='#4ade80' disabled={!p.ac&&!pinned} />
      </td>
      {td(over?'⚠':dp||'—',{textAlign:'right',fontWeight:500,color:over?'#f87171':dp>0?'#c084fc':'#4b5563'})}
    </tr>
  );
}
