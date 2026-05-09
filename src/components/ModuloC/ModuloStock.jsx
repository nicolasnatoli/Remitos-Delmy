// ===== MÓDULO STOCK+ V5 =====
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { SK, lsGet, lsSet, lsSetRaw, lsGetRaw, saveArt, loadArt, getMeta, saveMeta, getListaCompra, saveListaCompra, clearListaCompra } from '../../utils/db';

const fn = n => Number(n||0).toLocaleString('es-AR');

// ─── Compactar/expandir ───────────────────────────────────────────────────────
const compactArt  = e => { const o={}; for(const[k,a]of Object.entries(e)) o[k]=`${a.prov}|${a.codp}|${a.desc}|${a.fam}|${a.cat||''}|${a.marca||''}|${a.costoReal||0}|${a.pvMin||0}|${a.mostrador||0}`; return o; };
const expandArt   = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split('|');o[k]={prov:p[0]||'',codp:p[1]||'',desc:p[2]||'',fam:p[3]||'',cat:p[4]||'',marca:p[5]||'',costoReal:+p[6]||0,pvMin:+p[7]||0,mostrador:+p[8]||0};} return o; };
const compactStk  = e => { const o={}; for(const[k,s]of Object.entries(e)) o[k]=`${s.DM01||0},${s.DM03||0},${s.DMCN||0}`; return o; };
const expandStk   = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={DM01:+p[0]||0,DM03:+p[1]||0,DMCN:+p[2]||0};} return o; };
const compactVent = o => Object.entries(o).filter(([,v])=>v>0).map(([k,v])=>`${k}:${v}`).join('|');
const expandVent  = s => { if(!s||typeof s!=='string')return{}; const o={}; s.replace(/^"|"$/g,'').split('|').forEach(p=>{const i=p.lastIndexOf(':');if(i>0)o[p.slice(0,i)]=+p.slice(i+1)||0;}); return o; };
const compactPlan = e => { const o={}; for(const[k,p]of Object.entries(e)) if(p.ac||p.d1||p.d3||p.dc) o[k]=`${p.ac||0},${p.d1||0},${p.d3||0},${p.dc||0}`; return o; };
const expandPlan  = c => { const o={}; for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={ac:+p[0]||0,d1:+p[1]||0,d3:+p[2]||0,dc:+p[3]||0};} return o; };

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
      return{cod,desc:a.desc,codp:a.codp,fam:a.fam,cat:a.cat||'',marca:a.marca||'',prov:a.prov,
        costoReal:a.costoReal||0,pvMin:a.pvMin||0,mostrador:a.mostrador||0,
        DM01:s.DM01,DM03:s.DM03,DMCN:s.DMCN,tot:s.DM01+s.DM03+s.DMCN,
        vs:mem.vs[cod]||0,vq:mem.vq[cod]||0,vm:mem.vm[cod]||0,vh:mem.vh[cod]||0,
        ac:p.ac,d1:p.d1,d3:p.d3,dc:p.dc};
    });
}

// ─── Input numérico — sin salto, blur/Enter confirma ─────────────────────────
function NumInput({value, onChange, onCommit, color, disabled, width=54, placeholder='—'}){
  const [local, setLocal] = useState(String(value||''));
  const ref = useRef();
  useEffect(()=>{ if(document.activeElement!==ref.current) setLocal(String(value||'')); },[value]);

  const commit = (v) => {
    const n = parseInt(v)||0;
    onChange(n);
    if(onCommit) onCommit(n);
  };

  return(
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => {
        const v = e.target.value.replace(/[^0-9]/g,'');
        setLocal(v);
        // Solo actualiza el valor local — NO mueve la fila
        onChange(v===''?0:parseInt(v,10));
      }}
      onBlur={e  => { commit(local); setLocal(String(parseInt(local)||0||'')); }}
      onKeyDown={e => {
        if(e.key==='Enter'){ commit(local); ref.current?.blur(); }
        if(e.key==='Tab')  { /* dejar pasar sin mover */ }
      }}
      style={{width,padding:'3px 5px',fontSize:10,textAlign:'right',
        background:'#0c0e14',
        color: (parseInt(local)||0)>0?(color||'#f0c040'):'#e8eaf0',
        border:`1px solid ${(parseInt(local)||0)>0?(color||'#f0c040'):'#1e2133'}`,
        borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',
        opacity:disabled?.3:1}}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function ModuloStock(){
  const [mem,       setMem]      = useState({art:{},stk:{},vs:{},vq:{},vm:{},vh:{},plan:{},meta:{}});
  const [loading,   setLoading]  = useState({});
  const [saveStatus,setSaveStatus]=useState('');
  const [provSel,   setProvSel]  = useState(null);
  const [provQ,     setProvQ]    = useState('');
  const [filterQ,   setFilterQ]  = useState('');
  const [filterFam, setFilterFam]= useState('');
  const [filterCat, setFilterCat]= useState('');
  const [soloLista, setSoloLista]= useState(false);
  const [sortCol,   setSortCol]  = useState('desc');
  const [sortDir,   setSortDir]  = useState(1);
  // Lista de compra activa — persiste en localStorage
  const [lista,     setLista]    = useState(getListaCompra);
  // proveedorPrincipal = el proveedor al que se le compra todo
  const [provPrincipal, setProvPrincipal] = useState(null);

  // Cargar todo al montar
  useEffect(()=>{
    const meta = getMeta();
    loadArt().then(artCompact=>{
      const art = artCompact && Object.keys(artCompact).length>0 ? expandArt(artCompact) : {};
      const stkC= lsGet(SK.stk,null); const stk=stkC?expandStk(stkC):{};
      const vs  = expandVent(lsGetRaw(SK.vs)||'');
      const vq  = expandVent(lsGetRaw(SK.vq)||'');
      const vm  = expandVent(lsGetRaw(SK.vm)||'');
      const vh  = expandVent(lsGetRaw(SK.vh)||'');
      const sh  = lsGet(SK.share,null);
      const planC = sh?.planC||lsGet(SK.plan,null);
      const plan  = planC?expandPlan(planC):{};
      setMem({art,stk,vs,vq,vm,vh,plan,meta});
    });
    // Restaurar proveedor principal
    const lc = getListaCompra();
    if(lc.prov) setProvPrincipal(lc.prov);
  },[]);

  // ─── Toggle item en lista ─────────────────────────────────────────────────
  const toggleItem = useCallback((cod, artData)=>{
    setLista(prev=>{
      const items = {...prev.items};
      if(items[cod]){ delete items[cod]; }
      else {
        const p=mem.plan[cod]||{ac:0,d1:0,d3:0,dc:0};
        items[cod]={cod, desc:artData.desc, codp:artData.codp,
          provOriginal:artData.prov, fam:artData.fam, cat:artData.cat,
          costoReal:artData.costoReal, pvMin:artData.pvMin, mostrador:artData.mostrador,
          ac:p.ac||0, d1:p.d1||0, d3:p.d3||0, dc:p.dc||0,
          esOtroProveedor: provSel!==provPrincipal && provPrincipal!==null,
        };
      }
      const next={...prev,items};
      saveListaCompra(next);
      return next;
    });
  },[mem.plan, provSel, provPrincipal]);

  // ─── Definir proveedor principal ─────────────────────────────────────────
  const definirProvPrincipal = useCallback((prov)=>{
    setProvPrincipal(prov);
    setLista(prev=>{ const next={...prev,prov}; saveListaCompra(next); return next; });
  },[]);

  // ─── Actualizar campo en lista ────────────────────────────────────────────
  const updItemLista = useCallback((cod, field, val)=>{
    setLista(prev=>{
      if(!prev.items[cod])return prev;
      const items={...prev.items,[cod]:{...prev.items[cod],[field]:val}};
      const next={...prev,items};
      saveListaCompra(next);
      return next;
    });
  },[]);

  // ─── Limpiar lista ────────────────────────────────────────────────────────
  const limpiarLista = useCallback(()=>{
    if(!window.confirm('¿Limpiar la lista de compra?'))return;
    clearListaCompra();
    setLista({prov:'',items:{},ts:null});
    setProvPrincipal(null);
  },[]);

  // ─── Enviar a Compras ─────────────────────────────────────────────────────
  const enviarACompras = useCallback(()=>{
    const items = Object.values(lista.items);
    if(!items.length){alert('La lista de compra está vacía');return;}
    const planCompras={};
    items.forEach(it=>{ planCompras[it.cod]={ac:it.ac||0,d1:it.d1||0,d3:it.d3||0,dc:it.dc||0}; });
    const compact=compactPlan(planCompras);
    lsSet(SK.plan,compact);
    lsSet(SK.share,{planC:compact,prov:provPrincipal||lista.prov,listaItems:lista.items,t:Date.now()});
    // Limpiar lista después de enviar
    clearListaCompra();
    setLista({prov:'',items:{},ts:null});
    setProvPrincipal(null);
    alert(`✓ ${items.length} artículos enviados a Compras`);
  },[lista, provPrincipal]);

  // ─── Exportar lista de nuevos artículos ──────────────────────────────────
  const exportarNuevos = useCallback(()=>{
    const otrosProv = Object.values(lista.items).filter(it=>it.esOtroProveedor);
    if(!otrosProv.length){alert('Sin artículos de otros proveedores para exportar');return;}
    const rows=[['Código','Descripción','Familia','Categoría','Proveedor a comprar','Cód.Proveedor nuevo','Costo Real','PV Mín.','Mostrador']];
    otrosProv.forEach(it=>rows.push([it.cod,it.desc,it.fam,it.cat,provPrincipal||lista.prov,'',it.costoReal,it.pvMin,it.mostrador]));
    const wb=XLSX.utils.book_new(); const ws=XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'Nuevas lineas');
    XLSX.writeFile(wb,`nuevas_lineas_proveedor_${new Date().toISOString().slice(0,10)}.xlsx`);
  },[lista.items, provPrincipal, lista.prov]);

  // ─── Cargar archivo ───────────────────────────────────────────────────────
  const loadFile = useCallback(async(tipo,file)=>{
    if(!file)return;
    setLoading(p=>({...p,[tipo]:true})); setSaveStatus('');
    try{
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:'array',cellDates:false});
      const meta=getMeta();
      if(tipo==='art'){
        setSaveStatus('Guardando en Redis...');
        const art=parseFormatoProveedores(wb);
        const compact=compactArt(art);
        const ok=await saveArt(compact);
        setSaveStatus(ok?`✓ ${Object.keys(art).length} artículos en Redis`:'⚠ Error Redis');
        meta.art={f:file.name,n:Object.keys(art).length,t:Date.now()};
        saveMeta(meta);
        setMem(prev=>({...prev,art,meta}));
      } else if(tipo==='stk'){
        const stk=parseStk(wb);
        lsSet(SK.stk,compactStk(stk));
        meta.stk={f:file.name,n:Object.keys(stk).length,t:Date.now()};
        saveMeta(meta);
        setMem(prev=>({...prev,stk,meta}));
      } else {
        const v=parseVentas(wb);
        lsSetRaw(SK[tipo],compactVent(v));
        meta[tipo]={f:file.name,n:Object.keys(v).length,t:Date.now()};
        saveMeta(meta);
        setMem(prev=>({...prev,[tipo]:v,meta}));
      }
    }catch(e){console.error('[Stock]',e);setSaveStatus('Error: '+e.message);}
    finally{setLoading(p=>({...p,[tipo]:false}));}
  },[]);

  const updPlan = useCallback((cod,field,val)=>{
    const v=Math.max(0,parseInt(val)||0);
    setMem(prev=>{
      const plan={...prev.plan,[cod]:{...(prev.plan[cod]||{ac:0,d1:0,d3:0,dc:0}),[field]:v}};
      if(field==='ac'&&!v)plan[cod]={ac:0,d1:0,d3:0,dc:0};
      const compact=compactPlan(plan);
      lsSet(SK.plan,compact);
      return{...prev,plan};
    });
    // Actualizar en lista si está seleccionado
    updItemLista(cod, field, v);
  },[updItemLista]);

  const doReset = useCallback(()=>{
    if(!window.confirm('¿Eliminar todos los datos?'))return;
    Object.values(SK).forEach(k=>{try{localStorage.removeItem(k);}catch{}});
    setMem({art:{},stk:{},vs:{},vq:{},vm:{},vh:{},plan:{},meta:{}});
    setLista({prov:'',items:{},ts:null}); setProvPrincipal(null);
    setProvSel(null); setProvQ('');
  },[]);

  const exportExcel = useCallback(()=>{
    if(!provSel)return;
    const arts=getArts(mem,provSel);
    const hdrs=['Código','Cód.Prov','Descripción','Familia','Categoría','Costo Real','PV Min','Mostrador','Stk Central','Stk Solano','Stk Varela','Stk Total','V.Semana','V.Quincena','V.Mes','A Comprar','→Central','→Solano','→Varela','→DP','En Lista'];
    const rows=[hdrs];
    arts.forEach(a=>{
      const p=mem.plan[a.cod]||{ac:0,d1:0,d3:0,dc:0};
      const dp=Math.max(0,p.ac-p.d1-p.d3-p.dc);
      rows.push([a.cod,a.codp,a.desc,a.fam,a.cat,a.costoReal,a.pvMin,a.mostrador,a.DMCN,a.DM01,a.DM03,a.tot,a.vs,a.vq,a.vm,p.ac,p.dc,p.d1,p.d3,dp,lista.items[a.cod]?'✓':'']);
    });
    const wb=XLSX.utils.book_new(); const ws=XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'Planilla');
    XLSX.writeFile(wb,`planilla_${provSel}_${new Date().toISOString().slice(0,10)}.xlsx`);
  },[mem,provSel,lista.items]);

  const sortBy=(col)=>{ if(sortCol===col)setSortDir(d=>d*-1); else{setSortCol(col);setSortDir(1);} };

  const proveedores    = useMemo(()=>getProveedores(mem.art),[mem.art]);
  const provsFiltrados = useMemo(()=>{const q=provQ.toLowerCase();return q?proveedores.filter(p=>p.nombre.toLowerCase().includes(q)):proveedores;},[proveedores,provQ]);
  const hasArt = Object.keys(mem.art).length>0;
  const hasV   = Object.keys(mem.vs).length>0||Object.keys(mem.vq).length>0||Object.keys(mem.vm).length>0;
  const hasVh  = Object.keys(mem.vh).length>0;
  const nLista = Object.keys(lista.items||{}).length;
  const nOtroProv = Object.values(lista.items||{}).filter(it=>it.esOtroProveedor).length;

  const UZONES=[
    {id:'art',icon:'📋',label:'ARTÍCULOS + PROVEEDORES',sub:'FormatoProveedores.xlsx → Redis'},
    {id:'stk',icon:'📦',label:'STOCK POR SUCURSAL',sub:'StockDisponible.xlsx'},
    {id:'vs', icon:'📊',label:'VENTAS SEMANA',sub:'7 días'},
    {id:'vq', icon:'📊',label:'VENTAS QUINCENA',sub:'15 días'},
    {id:'vm', icon:'📊',label:'VENTAS MES',sub:'30 días'},
    {id:'vh', icon:'📈',label:'PROM. HISTÓRICO',sub:'Semanal histórico'},
  ];

  return(
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:'#0c0e14'}}>

      {/* Badges */}
      <div style={{padding:'7px 14px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
        {UZONES.map(u=>{const loaded=mem.meta[u.id];return(
          <span key={u.id} style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,fontWeight:500,background:loaded?'rgba(74,222,128,.12)':'rgba(248,113,113,.12)',color:loaded?'#4ade80':'#f87171',border:`1px solid ${loaded?'rgba(74,222,128,.3)':'rgba(248,113,113,.3)'}`}}>
            {u.label.split(' ')[0]}: {loaded?fn(loaded.n):'—'}
          </span>
        );})}
        {saveStatus&&<span style={{fontSize:9,color:saveStatus.startsWith('✓')?'#4ade80':'#f0c040'}}>{saveStatus}</span>}
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={doReset}     style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 9px',border:'1px solid #6b7280',background:'transparent',color:'#6b7280'}}>✕ Reset</button>
          <button onClick={exportExcel} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 9px',border:'1px solid rgba(45,212,191,.3)',background:'rgba(45,212,191,.1)',color:'#2dd4bf'}}>↓ Excel</button>
        </div>
      </div>

      {/* Zonas de carga */}
      <div style={{padding:'8px 12px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',display:'flex',gap:7,flexWrap:'wrap',flexShrink:0}}>
        {UZONES.map(u=>(
          <UZone key={u.id} {...u} loaded={!!mem.meta[u.id]} info={mem.meta[u.id]} loading={!!loading[u.id]} onFile={f=>loadFile(u.id,f)} />
        ))}
      </div>

      {/* Lista de compra activa */}
      {nLista>0&&(
        <ListaCompraBar lista={lista} nLista={nLista} nOtroProv={nOtroProv}
          provPrincipal={provPrincipal} setProvPrincipal={definirProvPrincipal}
          proveedores={proveedores}
          onEnviar={enviarACompras} onLimpiar={limpiarLista} onExportarNuevos={exportarNuevos}
          soloLista={soloLista} setSoloLista={setSoloLista}
          updItem={updItemLista}
        />
      )}

      {/* Contenido */}
      <div style={{flex:1,overflow:'hidden',display:'flex'}}>
        {/* Panel proveedor */}
        <div style={{width:210,flexShrink:0,borderRight:'1px solid #1e2133',display:'flex',flexDirection:'column',background:'#0d0f1a'}}>
          <div style={{padding:'6px 10px',borderBottom:'1px solid #1e2133'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:4}}>PROVEEDOR</div>
            <input placeholder="Buscar..." value={provQ} onChange={e=>setProvQ(e.target.value)}
              style={{width:'100%',fontSize:11,padding:'4px 7px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,outline:'none',fontFamily:'DM Mono,monospace'}} />
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {!hasArt&&<div style={{padding:12,textAlign:'center',color:'#6b7280',fontSize:10}}>Cargá FormatoProveedores.xlsx</div>}
            {provsFiltrados.map(p=>(
              <div key={p.nombre} onClick={()=>{setProvSel(p.nombre);setFilterQ('');setFilterFam('');setFilterCat('');}}
                style={{padding:'7px 10px',cursor:'pointer',borderBottom:'1px solid #181b27',borderLeft:`2px solid ${p.nombre===provSel?'#f0c040':'transparent'}`,background:p.nombre===provSel?'rgba(240,192,64,.06)':'transparent',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontSize:10,color:'#e8eaf0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150}}>{p.nombre}</div>
                  <div style={{fontSize:8,color:'#6b7280',marginTop:1}}>{p.n} arts</div>
                </div>
                {/* Indicador de cuántos de este proveedor están en la lista */}
                {Object.values(lista.items||{}).filter(it=>it.provOriginal===p.nombre).length>0&&(
                  <span style={{fontSize:8,color:'#f0c040',fontWeight:600}}>{Object.values(lista.items||{}).filter(it=>it.provOriginal===p.nombre).length}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tabla artículos */}
        <div style={{flex:1,overflow:'auto',padding:10}}>
          {!provSel
            ?<div style={{textAlign:'center',padding:'50px 20px',color:'#6b7280'}}>
               <div style={{fontSize:24,marginBottom:8}}>←</div>
               <div style={{fontSize:12,color:'#e8eaf0'}}>Seleccioná un proveedor</div>
               {nLista===0&&<div style={{fontSize:10,marginTop:6}}>Al seleccionar el primer proveedor quedará como<br/>el proveedor principal de la lista de compra</div>}
             </div>
            :<TablaProveedor
                mem={mem} provSel={provSel} hasV={hasV} hasVh={hasVh}
                filterQ={filterQ} setFilterQ={setFilterQ}
                filterFam={filterFam} setFilterFam={setFilterFam}
                filterCat={filterCat} setFilterCat={setFilterCat}
                soloLista={soloLista} setSoloLista={setSoloLista}
                sortCol={sortCol} sortDir={sortDir} sortBy={sortBy}
                updPlan={updPlan} lista={lista} toggleItem={toggleItem}
                provPrincipal={provPrincipal} definirProvPrincipal={definirProvPrincipal}
              />
          }
        </div>
      </div>
    </div>
  );
}

// ─── Barra de lista de compra ─────────────────────────────────────────────────
function ListaCompraBar({lista,nLista,nOtroProv,provPrincipal,setProvPrincipal,proveedores,onEnviar,onLimpiar,onExportarNuevos,soloLista,setSoloLista,updItem}){
  const [expandida,setExpandida]=useState(false);
  return(
    <div style={{background:'rgba(240,192,64,.06)',borderBottom:'1px solid rgba(240,192,64,.3)',flexShrink:0}}>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'6px 12px',flexWrap:'wrap'}}>
        <span style={{fontSize:10,color:'#f0c040',fontWeight:600}}>📋 LISTA DE COMPRA</span>
        <span style={{fontSize:10,color:'#e8eaf0'}}>{nLista} artículos</span>
        {nOtroProv>0&&<span style={{fontSize:9,color:'#fb923c'}}>{nOtroProv} de otros proveedores</span>}
        {/* Proveedor principal */}
        {!provPrincipal
          ?<select onChange={e=>setProvPrincipal(e.target.value)} defaultValue=""
              style={{fontSize:10,padding:'2px 7px',background:'#0c0e14',color:'#f0c040',border:'1px solid rgba(240,192,64,.4)',borderRadius:3,fontFamily:'DM Mono,monospace'}}>
              <option value="">— Definir proveedor principal —</option>
              {proveedores.map(p=><option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
            </select>
          :<span style={{fontSize:9,color:'#4ade80'}}>✓ Comprando a: <b>{provPrincipal}</b></span>
        }
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={()=>setSoloLista(!soloLista)} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 8px',border:`1px solid ${soloLista?'rgba(240,192,64,.5)':'#1e2133'}`,background:soloLista?'rgba(240,192,64,.15)':'transparent',color:soloLista?'#f0c040':'#6b7280'}}>{soloLista?'✓ ':''} Solo lista</button>
          <button onClick={()=>setExpandida(!expandida)} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 8px',border:'1px solid #1e2133',background:'transparent',color:'#6b7280'}}>{expandida?'▲':'▼'} Ver</button>
          {nOtroProv>0&&<button onClick={onExportarNuevos} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 8px',border:'1px solid rgba(251,146,60,.3)',background:'rgba(251,146,60,.08)',color:'#fb923c'}}>↓ Nuevas líneas</button>}
          <button onClick={onLimpiar} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,borderRadius:4,padding:'3px 8px',border:'1px solid rgba(248,113,113,.3)',background:'rgba(248,113,113,.08)',color:'#f87171'}}>✕ Limpiar</button>
          <button onClick={onEnviar} style={{cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'4px 12px',border:'none',background:'#f0c040',color:'#0c0e14',fontWeight:600}}>→ Compras</button>
        </div>
      </div>
      {expandida&&(
        <div style={{maxHeight:180,overflowY:'auto',borderTop:'1px solid rgba(240,192,64,.2)'}}>
          <table style={{borderCollapse:'collapse',width:'100%'}}>
            <thead><tr>
              {['CÓDIGO','DESCRIPCIÓN','PROV.ORIGINAL','A COMPRAR','→CEN','→SOL','→VAR'].map((h,i)=>(
                <th key={i} style={{fontSize:8,color:'#6b7280',padding:'4px 7px',background:'rgba(0,0,0,.3)',textTransform:'uppercase',letterSpacing:'.06em',textAlign:i>2?'right':'left'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {Object.values(lista.items||{}).map(it=>(
                <tr key={it.cod} style={{borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                  <td style={{padding:'3px 7px',fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'}}>{it.cod}</td>
                  <td style={{padding:'3px 7px',fontSize:10,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.desc}</td>
                  <td style={{padding:'3px 7px',fontSize:9,color:it.esOtroProveedor?'#fb923c':'#6b7280'}}>{it.provOriginal}{it.esOtroProveedor&&' ⚡'}</td>
                  <td style={{padding:'3px 5px',textAlign:'right'}}><NumInput value={it.ac} onChange={v=>updItem(it.cod,'ac',v)} color='#f0c040' width={50} /></td>
                  <td style={{padding:'3px 5px',textAlign:'right'}}><NumInput value={it.dc} onChange={v=>updItem(it.cod,'dc',v)} color='#2dd4bf' width={50} /></td>
                  <td style={{padding:'3px 5px',textAlign:'right'}}><NumInput value={it.d1} onChange={v=>updItem(it.cod,'d1',v)} color='#60a5fa' width={50} /></td>
                  <td style={{padding:'3px 5px',textAlign:'right'}}><NumInput value={it.d3} onChange={v=>updItem(it.cod,'d3',v)} color='#4ade80' width={50} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UZone({id,icon,label,sub,loaded,info,loading,onFile}){
  const ref=useRef();
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

function TablaProveedor({mem,provSel,hasV,hasVh,filterQ,setFilterQ,filterFam,setFilterFam,filterCat,setFilterCat,soloLista,setSoloLista,sortCol,sortDir,sortBy,updPlan,lista,toggleItem,provPrincipal,definirProvPrincipal}){
  let arts=getArts(mem,provSel);
  const fams=[...new Set(arts.map(a=>a.fam).filter(Boolean))].sort();
  const cats=[...new Set(arts.filter(a=>!filterFam||a.fam===filterFam).map(a=>a.cat).filter(Boolean))].sort();
  if(filterFam)arts=arts.filter(a=>a.fam===filterFam);
  if(filterCat)arts=arts.filter(a=>a.cat===filterCat);
  if(filterQ){const tokens=filterQ.toLowerCase().split(/\s+/).filter(Boolean);arts=arts.filter(a=>tokens.every(t=>(a.desc+a.cod+a.codp).toLowerCase().includes(t)));}
  if(soloLista)arts=arts.filter(a=>lista.items[a.cod]);

  const sortFn=(a,b)=>{const va=a[sortCol]||0,vb=b[sortCol]||0;if(typeof va==='string')return sortDir*va.localeCompare(vb);return sortDir*(va-vb);};
  const enLista=arts.filter(a=>lista.items[a.cod]);
  const noLista=arts.filter(a=>!lista.items[a.cod]);
  enLista.sort(sortFn); noLista.sort(sortFn);
  const artsOrdenados=[...enLista,...noLista];

  const esPrincipal=provSel===provPrincipal;
  const esOtroProv =provPrincipal&&provSel!==provPrincipal;

  const totCen=arts.reduce((s,a)=>s+a.DMCN,0);
  const totSol=arts.reduce((s,a)=>s+a.DM01,0);
  const totVar=arts.reduce((s,a)=>s+a.DM03,0);

  const Th=({col,label,style})=>(
    <th onClick={()=>sortBy(col)} style={{fontSize:9,color:sortCol===col?'#f0c040':'#6b7280',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',...style}}>
      {label}{sortCol===col?(sortDir>0?' ↑':' ↓'):''}
    </th>
  );

  return(
    <div>
      {/* Banner proveedor seleccionado */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <div style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700,color:esPrincipal?'#f0c040':esOtroProv?'#fb923c':'#e8eaf0'}}>{provSel}</div>
        {!provPrincipal&&<button onClick={()=>definirProvPrincipal(provSel)} style={{cursor:'pointer',fontSize:9,padding:'2px 8px',borderRadius:3,border:'1px solid rgba(240,192,64,.4)',background:'rgba(240,192,64,.08)',color:'#f0c040',fontFamily:'DM Mono,monospace'}}>✓ Definir como principal</button>}
        {esOtroProv&&<span style={{fontSize:9,color:'#fb923c',border:'1px solid rgba(251,146,60,.3)',padding:'2px 7px',borderRadius:3}}>⚡ Artículos de este proveedor → lista para comprar a {provPrincipal}</span>}
        {esPrincipal&&<span style={{fontSize:9,color:'#4ade80'}}>★ Proveedor principal</span>}
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:5,marginBottom:7}}>
        {[{l:'ARTÍCULOS',v:fn(arts.length),c:'#e8eaf0'},{l:'CENTRAL',v:fn(totCen),c:'#2dd4bf'},{l:'SOLANO',v:fn(totSol),c:'#60a5fa'},{l:'VARELA',v:fn(totVar),c:'#4ade80'},{l:'EN LISTA',v:fn(enLista.length),c:'#f0c040'},{l:'OTROS PROV.',v:fn(Object.values(lista.items||{}).filter(it=>it.esOtroProveedor).length),c:'#fb923c'}].map(k=>(
          <div key={k.l} style={{background:'#111420',border:'1px solid #1e2133',borderRadius:4,padding:'6px 8px'}}>
            <div style={{fontSize:7,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:2}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:'flex',gap:5,alignItems:'center',marginBottom:6,flexWrap:'wrap'}}>
        <select value={filterFam} onChange={e=>{setFilterFam(e.target.value);setFilterCat('');}}
          style={{fontSize:10,padding:'3px 6px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace'}}>
          <option value="">— Familias —</option>
          {fams.map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
          style={{fontSize:10,padding:'3px 6px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace'}}>
          <option value="">— Categorías —</option>
          {cats.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <input value={filterQ} onChange={e=>setFilterQ(e.target.value)} placeholder="Buscar artículo o código..."
          style={{flex:1,minWidth:120,fontSize:11,padding:'3px 7px',background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,outline:'none',fontFamily:'DM Mono,monospace'}} />
        <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10,cursor:'pointer',color:'#e8eaf0',whiteSpace:'nowrap'}}>
          <input type="checkbox" checked={soloLista} onChange={e=>setSoloLista(e.target.checked)} style={{accentColor:'#f0c040'}} />
          Solo lista
        </label>
        {hasV&&<div style={{display:'flex',gap:3,fontSize:8,color:'#6b7280',alignItems:'center'}}>
          {[['#4ade80','#0c0e14','>MES'],['#f0c040','#0c0e14','>QUIN'],['#f87171','#fff','<SEM']].map(([bg,co,t])=>(
            <span key={t} style={{background:bg,color:co,padding:'1px 4px',borderRadius:2,fontWeight:600}}>{t}</span>
          ))}
        </div>}
      </div>

      {/* Tabla */}
      <div style={{overflowX:'auto',background:'#111420',border:'1px solid #1e2133',borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr>
              <th style={{fontSize:9,color:'#6b7280',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',width:26,textAlign:'center'}}>✓</th>
              <Th col="cod"  label="CÓDIGO"      style={{width:'9%'}} />
              <th style={{fontSize:9,color:'#6b7280',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',width:'7%',textTransform:'uppercase',letterSpacing:'.06em'}}>CÓD.P.</th>
              <Th col="desc" label="DESCRIPCIÓN" />
              <Th col="DMCN" label="CEN"         style={{textAlign:'right',color:'#2dd4bf',width:55}} />
              <Th col="DM01" label="SOL"         style={{textAlign:'right',color:'#60a5fa',width:55}} />
              <Th col="DM03" label="VAR"         style={{textAlign:'right',color:'#4ade80',width:55}} />
              <Th col="tot"  label="TOT"         style={{textAlign:'right',width:55}} />
              {hasVh&&<Th col="vh" label="HIST"  style={{textAlign:'right',fontSize:8,width:48,color:'#6b7280'}} />}
              {hasV&&<>
                <Th col="vs" label="SEM"         style={{textAlign:'right',width:48}} />
                <Th col="vq" label="QUIN"        style={{textAlign:'right',fontSize:8,width:48,color:'#6b7280'}} />
                <Th col="vm" label="MES"         style={{textAlign:'right',fontSize:8,width:48,color:'#6b7280'}} />
              </>}
              <th style={{fontSize:9,color:'#f0c040',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:62,textTransform:'uppercase'}}>A COMPRAR</th>
              <th style={{fontSize:8,color:'#2dd4bf',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:52,textTransform:'uppercase'}}>→CEN</th>
              <th style={{fontSize:8,color:'#60a5fa',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:52,textTransform:'uppercase'}}>→SOL</th>
              <th style={{fontSize:8,color:'#4ade80',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:52,textTransform:'uppercase'}}>→VAR</th>
              <th style={{fontSize:8,color:'#c084fc',padding:'5px 6px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textAlign:'right',width:45,textTransform:'uppercase'}}>→DP</th>
            </tr>
          </thead>
          <tbody>
            {artsOrdenados.length===0&&<tr><td colSpan={20} style={{textAlign:'center',padding:20,color:'#6b7280',fontSize:11}}>Sin artículos</td></tr>}
            {artsOrdenados.map((a,idx)=>{
              const enL=!!lista.items[a.cod];
              const esSep=idx===enLista.length&&idx>0&&noLista.length>0;
              return(
                <React.Fragment key={a.cod}>
                  {esSep&&<tr><td colSpan={20} style={{padding:'2px 6px',background:'rgba(30,33,51,.5)',borderBottom:'1px solid #1e2133',fontSize:8,color:'#4b5563',letterSpacing:'.08em',textTransform:'uppercase'}}>— Resto del catálogo —</td></tr>}
                  <ArtRow art={a} mem={mem} hasV={hasV} hasVh={hasVh} updPlan={updPlan}
                    enLista={enL} onToggle={()=>toggleItem(a.cod,a)} />
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:5,fontSize:9,color:'#6b7280'}}>{arts.length} artículos · {enLista.length} en lista</div>
    </div>
  );
}

function ArtRow({art,mem,hasV,hasVh,updPlan,enLista,onToggle}){
  const p=mem.plan[art.cod]||{ac:0,d1:0,d3:0,dc:0};
  const dp=Math.max(0,p.ac-p.d1-p.d3-p.dc);
  const over=(p.d1+p.d3+p.dc)>p.ac&&p.ac>0;
  const vm=mem.vm[art.cod]||0,vq=mem.vq[art.cod]||0,vs=mem.vs[art.cod]||0;
  const tot=art.DM01+art.DM03+art.DMCN;
  let totColor='#e8eaf0';let totExtra={};
  if(hasV&&(vm||vq||vs)){
    if(tot>=vm&&vm>0)totColor='#4ade80';
    else if(tot>=vq&&vq>0)totColor='#f0c040';
    else if(tot>=vs&&vs>0){totColor='#f87171';totExtra={border:'1px solid #f87171',borderRadius:3,padding:'0 3px',background:'rgba(248,113,113,.1)'};}
    else if(vs>0){totColor='#fff';totExtra={background:'#f87171',borderRadius:3,padding:'0 3px'};}
  }
  const rowBg=enLista?'rgba(240,192,64,.04)':'transparent';
  const td=(c,s)=><td style={{padding:'3px 6px',borderBottom:'1px solid #181b27',fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;

  return(
    <tr style={{background:rowBg}}>
      {/* Checkbox */}
      <td style={{padding:'3px 6px',borderBottom:'1px solid #181b27',textAlign:'center',verticalAlign:'middle'}}>
        <div onClick={onToggle} style={{width:14,height:14,border:`1px solid ${enLista?'#f0c040':'#4b5563'}`,borderRadius:2,background:enLista?'#f0c040':'transparent',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {enLista&&<span style={{color:'#0c0e14',fontSize:10,fontWeight:900,lineHeight:1}}>✓</span>}
        </div>
      </td>
      {td(art.cod,{fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'})}
      {td(art.codp,{fontSize:9,color:'#6b7280'})}
      {td(<span title={art.desc} style={{display:'block',maxWidth:175,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:10}}>{art.desc}</span>)}
      {td(art.DMCN||'—',{textAlign:'right',color:art.DMCN>0?'#2dd4bf':'#4b5563'})}
      {td(art.DM01||'—',{textAlign:'right',color:art.DM01>0?'#60a5fa':'#4b5563'})}
      {td(art.DM03||'—',{textAlign:'right',color:art.DM03>0?'#4ade80':'#4b5563'})}
      {td(<span style={{display:'inline-block',color:totColor,...totExtra}}>{tot||'—'}</span>,{textAlign:'right'})}
      {hasVh&&td(art.vh||'—',{textAlign:'right',color:'#6b7280'})}
      {hasV&&td(art.vs||'—',{textAlign:'right',color:art.vs>0?'#e8eaf0':'#4b5563'})}
      {hasV&&td(art.vq||'—',{textAlign:'right',color:'#6b7280'})}
      {hasV&&td(art.vm||'—',{textAlign:'right',color:'#6b7280'})}
      <td style={{textAlign:'right',padding:'2px 4px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.ac} onChange={v=>updPlan(art.cod,'ac',v)} color='#f0c040' />
      </td>
      <td style={{textAlign:'right',padding:'2px 4px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.dc} onChange={v=>updPlan(art.cod,'dc',v)} color='#2dd4bf' disabled={!p.ac&&!enLista} />
      </td>
      <td style={{textAlign:'right',padding:'2px 4px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.d1} onChange={v=>updPlan(art.cod,'d1',v)} color='#60a5fa' disabled={!p.ac&&!enLista} />
      </td>
      <td style={{textAlign:'right',padding:'2px 4px',borderBottom:'1px solid #181b27',verticalAlign:'middle'}}>
        <NumInput value={p.d3} onChange={v=>updPlan(art.cod,'d3',v)} color='#4ade80' disabled={!p.ac&&!enLista} />
      </td>
      {td(over?'⚠':dp||'—',{textAlign:'right',fontWeight:500,color:over?'#f87171':dp>0?'#c084fc':'#4b5563'})}
    </tr>
  );
}
