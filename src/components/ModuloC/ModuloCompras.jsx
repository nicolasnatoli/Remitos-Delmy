// ===== MÓDULO COMPRAS V4 =====
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { SK, lsGet, lsSet, lsGetRaw, loadArt } from '../../utils/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fn   = n => Number(n||0).toLocaleString('es-AR');
const fp   = n => n>0 ? '$'+Number(n).toLocaleString('es-AR',{maximumFractionDigits:0}) : '—';
const fpct = n => (n>=0?'+':'')+n.toFixed(1)+'%';
const now  = () => new Date().toISOString();
const nowLabel = () => new Date().toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

// ─── Expandir compactos ───────────────────────────────────────────────────────
const expandStk =c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={DM01:+p[0]||0,DM03:+p[1]||0,DMCN:+p[2]||0};}return o;};
const expandVent=s=>{if(!s||typeof s!=='string')return{};const o={};s.replace(/^"|"$/g,'').split('|').forEach(p=>{const i=p.lastIndexOf(':');if(i>0)o[p.slice(0,i)]=+p.slice(i+1)||0;});return o;};
const expandPlan=c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={ac:+p[0]||0,d1:+p[1]||0,d3:+p[2]||0,dc:+p[3]||0};}return o;};

// ─── Estados OC ───────────────────────────────────────────────────────────────
const ESTADOS_OC = {
  generada:   { label:'Generada',    color:'#60a5fa', bg:'rgba(96,165,250,.12)'  },
  validada:   { label:'Validada',    color:'#c084fc', bg:'rgba(192,132,252,.12)' },
  entregada:  { label:'Entregada',   color:'#f0c040', bg:'rgba(240,192,64,.12)'  },
  parcial:    { label:'Parcial',     color:'#fb923c', bg:'rgba(251,146,60,.12)'  },
  sobrantes:  { label:'Con sobrantes',color:'#2dd4bf',bg:'rgba(45,212,191,.12)' },
  recibida:   { label:'Recibida',    color:'#4ade80', bg:'rgba(74,222,128,.12)'  },
  cancelada:  { label:'Cancelada',   color:'#f87171', bg:'rgba(248,113,113,.12)' },
};

// ─── Cruce de códigos ─────────────────────────────────────────────────────────
function buildCodpIdx(art){
  const idx={};
  for(const[cod,a]of Object.entries(art)){
    const cp=String(a.codp||'').trim().replace(/^0+/,'');
    if(cp){if(!idx[cp])idx[cp]=[];idx[cp].push(cod);}
    // también indexar el cod completo
    const cpFull=String(a.codp||'').trim();
    if(cpFull&&cpFull!==cp){if(!idx[cpFull])idx[cpFull]=[];idx[cpFull].push(cod);}
  }
  return idx;
}

function cruzarCodigo(codExt, art, idx){
  if(!codExt)return null;
  const cod=String(codExt).trim();
  const codN=cod.replace(/^0+/,'');
  // Exacto
  if(idx[cod]?.length)return idx[cod][0];
  if(idx[codN]?.length)return idx[codN][0];
  // Parcial — el código del proveedor contiene o está contenido
  for(const[cp,cods]of Object.entries(idx)){
    const cpN=cp.replace(/^0+/,'');
    if(cpN&&codN&&(cpN===codN||cpN.includes(codN)||codN.includes(cpN)))return cods[0];
  }
  if(art[cod])return cod;
  return null;
}

// ─── Búsqueda por palabras ────────────────────────────────────────────────────
function buscarPorPalabras(desc, codDoc, prov, famF, catF, marcaF, q, art){
  if(!art||Object.keys(art).length===0)return[];
  const words=(desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>2).slice(0,4);
  const codLow=String(codDoc||'').toLowerCase().replace(/^0+/,'');
  const qLow=(q||'').toLowerCase().trim();
  const results=[];

  for(const[cod,a]of Object.entries(art)){
    const hay=(a.desc||'').toLowerCase();
    const codpFull=String(a.codp||'').toLowerCase();
    const codpN=codpFull.replace(/^0+/,'');
    if(famF&&(a.fam||'')!==famF)continue;
    if(catF&&(a.cat||'')!==catF)continue;
    if(marcaF&&(a.marca||'')!==marcaF)continue;

    let score=0; let type='other';

    // Código proveedor match
    if(codLow&&codpN){
      if(codpN===codLow||codpFull===codLow){score+=25;type='prim';}
      else if(codpN.includes(codLow)||codLow.includes(codpN)){score+=18;type='prim';}
    }
    // Palabras descripción
    const wm=words.filter(w=>hay.includes(w)).length;
    if(wm>0){score+=wm*9;if(type==='other')type='sec';}
    // Búsqueda manual
    if(qLow){
      if(hay.includes(qLow)||cod.toLowerCase().includes(qLow)||codpN.includes(qLow.replace(/^0+/,''))){
        score+=16;if(type==='other')type='sec';
      }
    }
    // Bonus mismo proveedor
    if(prov&&(a.prov||'').toLowerCase()===prov.toLowerCase())score+=5;

    if(score>0)results.push({cod,a,score,type});
  }
  results.sort((a,b)=>{const o={prim:0,sec:1,other:2};if(o[a.type]!==o[b.type])return o[a.type]-o[b.type];return b.score-a.score;});
  return results.slice(0,40);
}

function getFreq(prov,art){
  const fams={},cats={},marcas={};
  Object.values(art).filter(a=>!prov||(a.prov||'').toLowerCase()===prov.toLowerCase()).forEach(a=>{
    if(a.fam)fams[a.fam]=(fams[a.fam]||0)+1;
    if(a.cat)cats[a.cat]=(cats[a.cat]||0)+1;
    if(a.marca)marcas[a.marca]=(marcas[a.marca]||0)+1;
  });
  const top=(obj,n)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k);
  return{fams:top(fams,8),cats:top(cats,8),marcas:top(marcas,6)};
}

// ─── Precios ──────────────────────────────────────────────────────────────────
function calcDiff(cr,pd){if(!cr||!pd)return null;return((pd-cr)/cr)*100;}
function priceLabel(diff){
  if(diff===null)return{cls:'mut',text:'S/PRECIO'};
  if(Math.abs(diff)<0.01)return{cls:'ok',text:'✓ IGUAL'};
  if(diff>0)return{cls:'err',text:'↑ '+fpct(diff)};
  return{cls:'ok',text:'↓ '+fpct(Math.abs(diff))};
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const C={bg:'#0c0e14',panel:'#111420',p2:'#0d0f1a',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',red:'#f87171',blue:'#60a5fa',vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',txt:'#e8eaf0',mut:'#6b7280'};
const IS={background:C.bg,color:C.txt,border:`1px solid ${C.b1}`,borderRadius:4,fontFamily:'DM Mono,monospace',fontSize:11,padding:'4px 8px',outline:'none',width:'100%'};
const Btn=(col,bg,extra={})=>({cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'5px 11px',border:`1px solid ${col||C.b1}`,background:bg||'transparent',color:col||C.txt,whiteSpace:'nowrap',...extra});
const badge=(cls)=>({display:'inline-flex',alignItems:'center',padding:'1px 7px',borderRadius:3,fontSize:9,fontWeight:500,whiteSpace:'nowrap',...{ok:{background:'rgba(74,222,128,.12)',color:C.green,border:'1px solid rgba(74,222,128,.3)'},warn:{background:'rgba(240,192,64,.12)',color:C.acc,border:'1px solid rgba(240,192,64,.3)'},err:{background:'rgba(248,113,113,.12)',color:C.red,border:'1px solid rgba(248,113,113,.3)'},info:{background:'rgba(96,165,250,.12)',color:C.blue,border:'1px solid rgba(96,165,250,.3)'},vio:{background:'rgba(192,132,252,.12)',color:C.vio,border:'1px solid rgba(192,132,252,.3)'},mut:{background:'rgba(107,114,128,.12)',color:C.mut,border:'1px solid rgba(107,114,128,.3)'},teal:{background:'rgba(45,212,191,.12)',color:C.teal,border:'1px solid rgba(45,212,191,.3)'}}[cls]||{}});
const Alert=({cls,children,style})=>{const s={ok:{background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',color:C.green},warn:{background:'rgba(240,192,64,.08)',border:'1px solid rgba(240,192,64,.2)',color:C.acc},err:{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',color:C.red},info:{background:'rgba(96,165,250,.08)',border:'1px solid rgba(96,165,250,.2)',color:C.blue}}[cls]||{};return<div style={{borderRadius:4,padding:'7px 11px',fontSize:10,marginBottom:7,...s,...(style||{})}}>{children}</div>;};

function NumInput({value,onChange,color,disabled,width=80,placeholder='0'}){
  const [local,setLocal]=useState(value||'');
  const ref=useRef();
  useEffect(()=>{if(document.activeElement!==ref.current)setLocal(value||'');},[value]);
  return(<input ref={ref} type="text" inputMode="numeric" value={local} placeholder={placeholder} disabled={disabled}
    onChange={e=>{const v=e.target.value.replace(/[^0-9.]/g,'');setLocal(v);onChange(parseFloat(v)||0);}}
    onBlur={()=>setLocal(value||'')}
    style={{width,padding:'3px 5px',fontSize:10,textAlign:'right',background:C.bg,color:value>0?(color||C.acc):C.txt,border:`1px solid ${value>0?(color||C.acc):C.b1}`,borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',opacity:disabled?.3:1}} />);
}

// ─── Cargar DB fresca ─────────────────────────────────────────────────────────
async function loadFreshDB(){
  const art = await loadArt(); // Redis
  const stkC=lsGet(SK.stk,null);  const stk=stkC?expandStk(stkC):{};
  const vs=expandVent(lsGetRaw(SK.vs)||'');
  const vq=expandVent(lsGetRaw(SK.vq)||'');
  const vm=expandVent(lsGetRaw(SK.vm)||'');
  const sh=lsGet(SK.share,null);
  const planC=sh?.planC||lsGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  const pins=lsGet(SK.pins,{})||{};
  const provStock=sh?.prov||null;
  return{art,stk,vs,vq,vm,plan,pins,provStock};
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function ModuloCompras(){
  const [db,     setDb]    = useState({art:{},stk:{},vs:{},vq:{},vm:{},plan:{},pins:{},provStock:null});
  const [dbReady,setDbReady]=useState(false);
  const [OCS,    setOCS]   = useState(()=>lsGet(SK.ocs,[]));
  const [OCact,  setOCact] = useState(null);
  const [OCdata, setOCdata]= useState({meta:{},lineas:[]});
  const [etC,    setEtC]   = useState('carga');
  const [modal,  setModal] = useState({open:false,idx:0,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',nuevoForm:{cod:'',desc:'',codp:'',prov:'',fam:'',cat:'',marca:'',costoReal:0,pvMin:0,mostrador:0}});

  // Cargar DB al montar (Redis para art)
  useEffect(()=>{
    loadFreshDB().then(fresh=>{
      setDb(fresh);setDbReady(true);
      // Cargar última OC activa
      const ocs=lsGet(SK.ocs,[]);
      if(ocs.length){
        const id=ocs[ocs.length-1];
        const d=lsGet('dm_oc_v3_'+id,null);
        if(d){setOCact(id);setOCdata({meta:d.meta||{},lineas:d.lineas||[]});setEtC('validacion');}
      }
    });
  },[]);

  const reloadDB=useCallback(()=>{loadFreshDB().then(fresh=>{setDb(fresh);setDbReady(true);});}, []);
  const codpIdx=useMemo(()=>buildCodpIdx(db.art),[db.art]);

  // ─── Guardar OC ───────────────────────────────────────────────────────────
  const saveOC=useCallback((id,data)=>{
    if(!id)return;
    setOCS(prev=>{const next=prev.includes(id)?prev:[...prev,id];lsSet(SK.ocs,next);return next;});
    lsSet('dm_oc_v3_'+id,{meta:data.meta,lineas:data.lineas});
  },[]);

  // ─── Transición de estado ─────────────────────────────────────────────────
  const transicionEstado=useCallback((id,nuevoEstado,data,extra={})=>{
    const ts=now();
    const historial=data.meta.historial||[];
    const anterior=historial.length?historial[historial.length-1]:null;
    const mins=anterior?Math.round((new Date(ts)-new Date(anterior.ts))/60000):0;
    const nuevaEntrada={estado:nuevoEstado,ts,label:nowLabel(),usuario:'Operario',...extra,desdePrev:mins};
    const meta={...data.meta,estado:nuevoEstado,historial:[...historial,nuevaEntrada]};
    const updated={...data,meta};
    setOCdata(updated);saveOC(id,updated);
    return updated;
  },[saveOC]);

  // ─── Enriquecer línea con datos de la base ────────────────────────────────
  const enriquecerLinea=useCallback((codDoc,cant=0,precioDoc=0,descDoc='')=>{
    const codI=cruzarCodigo(codDoc,db.art,codpIdx)||codDoc;
    const a=db.art[codI]||{desc:descDoc,codp:codDoc,prov:'',fam:'',cat:'',costoReal:0,pvMin:0,mostrador:0};
    const s=db.stk[codI]||{DM01:0,DM03:0,DMCN:0};
    return{
      cod:codI, codp:codDoc,
      desc:a.desc||descDoc, prov:a.prov||'', fam:a.fam||'', cat:a.cat||'',
      costoReal:a.costoReal||0, pvMin:a.pvMin||0, mostrador:a.mostrador||0,
      cantOC:cant, dc:0, d1:0, d3:0,
      precioDoc, cantRemito:cant,
      stkDMCN:s.DMCN, stkDM01:s.DM01, stkDM03:s.DM03,
      vs:db.vs[codI]||0, vq:db.vq[codI]||0, vm:db.vm[codI]||0,
      reconocido:!!(db.art[codI]||codI!==codDoc),
      aprobado:false, rechazado:false, fijado:false,
    };
  },[db,codpIdx]);

  // ─── Importar desde Stock+ ────────────────────────────────────────────────
  const importarDesdeStock=useCallback(()=>{
    const sh=lsGet(SK.share,null);
    const planC=sh?.planC||lsGet(SK.plan,null);
    if(!planC){alert('En Stock+: fijá artículos o completá "A Comprar" y presioná "→ Compras".');return;}
    const plan=expandPlan(planC);
    const pins=sh?.pins||lsGet(SK.pins,{})||{};
    const prov=sh?.prov||'';
    const lineas=[];
    for(const[cod,p]of Object.entries(plan)){
      if(!p.ac&&!pins[cod])continue;
      lineas.push(enriquecerLinea(cod,p.ac||0,0,''));
      const l=lineas[lineas.length-1];
      l.dc=p.dc||0; l.d1=p.d1||0; l.d3=p.d3||0; l.fijado=!!pins[cod];
    }
    if(!lineas.length){alert('Sin artículos fijados ni con cantidad.');return;}
    const id='oc_'+Date.now();
    const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Stock+',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas};
    setOCdata(data);setOCact(id);saveOC(id,data);setEtC('validacion');
  },[enriquecerLinea,saveOC]);

  // ─── Procesar documento ───────────────────────────────────────────────────
  const procesarDocumento=useCallback(async(file)=>{
    const ext=file.name.toLowerCase().split('.').pop();
    if(ext==='xlsx'||ext==='xls'){
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      let hRow=0;
      for(let i=0;i<Math.min(raw.length,15);i++){if(raw[i].some(c=>/c[oó]d|descrip/i.test(String(c||'')))){hRow=i;break;}}
      const hdrs=raw[hRow].map(h=>String(h||'').toLowerCase().trim());
      const iCod=Math.max(0,hdrs.findIndex(h=>/c[oó]d/.test(h)));
      const iDesc=Math.max(1,hdrs.findIndex(h=>h.includes('descrip')));
      const iCant=Math.max(2,hdrs.findIndex(h=>h.includes('cant')));
      const iPrecio=hdrs.findIndex(h=>/prec|cost/.test(h));
      const docLineas=[];
      for(let i=hRow+1;i<raw.length;i++){
        const r=raw[i];const cod=String(r[iCod]||'').trim();if(!cod||cod.length<2)continue;
        docLineas.push({cod,desc:String(r[iDesc]||'').trim(),cant:parseFloat(String(r[iCant]||'0').replace(',','.'))||0,precio:parseFloat(String(r[iPrecio>=0?iPrecio:3]||'0').replace(',','.'))||0});
      }
      aplicarLineasDoc(docLineas);
    } else {
      // IA via servidor
      try{
        const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
        const reader=new FileReader();
        const b64=await new Promise(res=>{reader.onload=e=>res(e.target.result.split(',')[1]);reader.readAsDataURL(file);});
        const mtype=isPdf?'application/pdf':file.type||'image/jpeg';
        const res=await fetch('/api/ia/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:b64,mediaType:mtype})});
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||'Error: '+res.status);}
        const result=await res.json();
        const parsed=JSON.parse((result.text||'').replace(/```json|```/g,'').trim());
        if(parsed.proveedor&&!OCdata.meta.proveedor){
          setOCdata(prev=>({...prev,meta:{...prev.meta,proveedor:parsed.proveedor,documento:parsed.nDocumento||prev.meta.documento}}));
        }
        aplicarLineasDoc((parsed.lineas||[]).map(l=>({cod:l.cod,desc:l.desc||'',cant:Number(l.cant)||0,precio:Number(l.precioUnit)||0})));
      }catch(e){alert('Error IA: '+e.message);}
    }
  },[OCdata.meta.proveedor]); // eslint-disable-line

  const aplicarLineasDoc=useCallback((docLineas)=>{
    if(!docLineas.length)return;
    if(OCdata.lineas.length){
      // Cruzar precios con OC existente
      setOCdata(prev=>{
        const lineas=prev.lineas.map(l=>{
          const match=docLineas.find(dl=>{
            const ci=cruzarCodigo(dl.cod,db.art,codpIdx);
            return dl.cod===l.codp||dl.cod===l.cod||(ci&&ci===l.cod);
          });
          if(match)return{...l,precioDoc:match.precio||0,cantRemito:match.cant||l.cantRemito};
          return l;
        });
        const updated={...prev,lineas};saveOC(OCact,updated);return updated;
      });
    } else {
      // Nueva OC desde documento
      const lineas=docLineas.map(dl=>enriquecerLinea(dl.cod,dl.cant,dl.precio,dl.desc));
      const prov=lineas.find(l=>l.prov)?.prov||'';
      const id='oc_'+Date.now();
      const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Documento',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas};
      setOCdata(data);setOCact(id);saveOC(id,data);
    }
    setEtC('validacion');
  },[OCdata.lineas,OCact,db.art,codpIdx,enriquecerLinea,saveOC]);

  // ─── Modal: asignar artículo ──────────────────────────────────────────────
  const asignarArticulo=useCallback((idx,cod)=>{
    const art=db.art[cod];if(!art)return;
    setOCdata(prev=>{
      const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,cod,codp:art.codp||l.codp,desc:art.desc,prov:art.prov||'',fam:art.fam||'',cat:art.cat||'',costoReal:art.costoReal||0,pvMin:art.pvMin||0,mostrador:art.mostrador||0,reconocido:true});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[db.art,OCact,saveOC]);

  const confirmarNuevoArticulo=useCallback(()=>{
    const f=modal.nuevoForm;const l=OCdata.lineas[modal.idx];
    if(!f.cod){alert('El código interno es obligatorio');return;}
    const nuevo={prov:f.prov||l?.prov||'',codp:f.codp||l?.codp||'',desc:f.desc||l?.desc||'',fam:f.fam||'',cat:f.cat||'',marca:f.marca||'',costoReal:f.costoReal||0,pvMin:f.pvMin||0,mostrador:f.mostrador||0};
    const nuevos=lsGet(SK.nuevos,[]);nuevos.push({cod:f.cod,...nuevo,fechaAlta:now()});lsSet(SK.nuevos,nuevos);
    setOCdata(prev=>{
      const lineas=prev.lineas.map((li,i)=>i!==modal.idx?li:{...li,cod:f.cod,codp:f.codp||li.codp,desc:nuevo.desc,costoReal:nuevo.costoReal,pvMin:nuevo.pvMin,mostrador:nuevo.mostrador,prov:nuevo.prov,fam:nuevo.fam,reconocido:true});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[modal,OCdata.lineas,OCact,saveOC]);

  const abrirModal=(idx)=>{
    const l=OCdata.lineas[idx];
    setModal({open:true,idx,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',
      nuevoForm:{cod:'',desc:l?.desc||'',codp:l?.codp||l?.cod||'',prov:l?.prov||db.provStock||'',fam:'',cat:'',marca:'',costoReal:l?.precioDoc||0,pvMin:0,mostrador:0}});
  };

  const nuevaOC=useCallback(()=>{
    const id='oc_'+Date.now();
    const data={meta:{proveedor:'',fecha:new Date().toISOString().slice(0,10),documento:'',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas:[]};
    setOCdata(data);setOCS(prev=>{const n=[...prev,id];lsSet(SK.ocs,n);return n;});
    setOCact(id);lsSet('dm_oc_v3_'+id,data);setEtC('carga');
  },[]);

  const selectOC=useCallback((id)=>{
    setOCact(id);const d=lsGet('dm_oc_v3_'+id,null);
    if(d){setOCdata({meta:d.meta||{},lineas:d.lineas||[]});}setEtC('validacion');
  },[]);

  const deleteOC=useCallback((id)=>{
    if(!window.confirm('¿Eliminar esta OC?'))return;
    setOCS(prev=>{const n=prev.filter(x=>x!==id);lsSet(SK.ocs,n);return n;});
    try{localStorage.removeItem('dm_oc_v3_'+id);}catch{}
    if(OCact===id){setOCact(null);setOCdata({meta:{},lineas:[]});setEtC('carga');}
  },[OCact]);

  const exportarOC=useCallback(()=>{
    if(!OCdata.lineas.length)return;
    const rows=[['Código','Cód.Prov','Descripción','Familia','Cant.OC','Precio Doc.','Costo Real','PV Mín.','Mostrador','Subtotal','→Central','→Solano','→Varela','→DP']];
    OCdata.lineas.forEach(l=>{const dp=Math.max(0,l.cantOC-(l.dc||0)-(l.d1||0)-(l.d3||0));rows.push([l.cod,l.codp,l.desc,l.fam,l.cantOC,l.precioDoc||0,l.costoReal||0,l.pvMin||0,l.mostrador||0,l.cantOC*(l.precioDoc||0),l.dc||0,l.d1||0,l.d3||0,dp]);});
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'OC');
    XLSX.writeFile(wb,`OC_${OCdata.meta.proveedor||'SinProv'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  },[OCdata]);

  const totLineas=OCdata.lineas.length;
  const totVal=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);
  const estadoActual=OCdata.meta.estado;
  const estadoCfg=ESTADOS_OC[estadoActual]||null;

  return(
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:C.bg}}>
      {/* Header */}
      <div style={{background:C.p2,borderBottom:`1px solid ${C.b1}`,display:'flex',padding:'0 16px',flexShrink:0,alignItems:'center',gap:8}}>
        <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700,color:C.acc}}>COMPRAS</span>
        {estadoCfg&&<span style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,fontWeight:500,background:estadoCfg.bg,color:estadoCfg.color,border:`1px solid ${estadoCfg.color}33`}}>{estadoCfg.label}</span>}
        {!dbReady&&<span style={{fontSize:9,color:C.mut}}>Cargando base...</span>}
        {dbReady&&<span style={{fontSize:9,color:C.mut}}>{Object.keys(db.art).length} art. en DB</span>}
        <div style={{marginLeft:'auto',display:'flex',gap:7}}>
          <button onClick={reloadDB}           style={Btn(C.mut)}>↺ Recargar DB</button>
          <button onClick={importarDesdeStock}  style={Btn(C.acc,'rgba(240,192,64,.08)')}>← Stock+</button>
          <button onClick={exportarOC}          style={Btn(C.teal,'rgba(45,212,191,.08)')}>↓ Excel OC</button>
        </div>
      </div>

      {/* Modal */}
      {modal.open&&<ModalArticulo modal={modal} setModal={setModal} linea={OCdata.lineas[modal.idx]} db={db} codpIdx={codpIdx} onAsignar={asignarArticulo} onNuevo={confirmarNuevoArticulo} />}

      {/* Contenido */}
      <div style={{flex:1,overflow:'auto',padding:14}}>
        <ComprasContent
          OCS={OCS} OCact={OCact} OCdata={OCdata} setOCdata={setOCdata}
          etC={etC} setEtC={setEtC} db={db} dbReady={dbReady}
          nuevaOC={nuevaOC} selectOC={selectOC} deleteOC={deleteOC}
          importarDesdeStock={importarDesdeStock}
          procesarDocumento={procesarDocumento}
          saveOC={saveOC} transicionEstado={transicionEstado} OCact_={OCact}
          abrirModal={abrirModal}
        />
      </div>

      {/* Footer */}
      <div style={{background:C.p2,borderTop:`1px solid ${C.b1}`,padding:'5px 14px',display:'flex',gap:10,alignItems:'center',flexShrink:0}}>
        <span style={{fontSize:9,color:C.mut}}>{totLineas} líneas · {OCS.length} OC(s)</span>
        {totVal>0&&<span style={{fontSize:10,color:C.acc}}>Total doc: ${fn(totVal)}</span>}
        {/* Historial de estados */}
        {(OCdata.meta.historial||[]).length>0&&(
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            {(OCdata.meta.historial||[]).map((h,i)=>{
              const cfg=ESTADOS_OC[h.estado]||{color:C.mut,label:h.estado};
              return(<span key={i} style={{fontSize:9,color:cfg.color,display:'flex',alignItems:'center',gap:3}}>
                {i>0&&<span style={{color:C.b1}}>→</span>}
                <span>{cfg.label}</span>
                <span style={{color:C.mut}}>{h.label}</span>
                {h.desdePrev>0&&<span style={{color:'#4b5563'}}>+{h.desdePrev}min</span>}
              </span>);
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL ARTÍCULO NO RECONOCIDO
// ════════════════════════════════════════════════════════════════════════════
function ModalArticulo({modal,setModal,linea,db,codpIdx,onAsignar,onNuevo}){
  if(!linea)return null;
  const freq=getFreq(linea.prov,db.art);
  const resultados=buscarPorPalabras(linea.desc,linea.codp||linea.cod,linea.prov,modal.selFam,modal.selCat,modal.selMarca,modal.busqQ,db.art);
  const palabras=(linea.desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>2).slice(0,4).join(' · ');
  const f=modal.nuevoForm;
  const freq2=getFreq(f.prov||linea.prov,db.art);
  const toggle=(field,val)=>setModal(m=>({...m,[field]:m[field]===val?'':val}));
  const artCount=Object.keys(db.art).length;

  return(
    <div style={{background:'rgba(0,0,0,.75)',padding:12,flexShrink:0}}>
      <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:6,overflow:'hidden'}}>
        <div style={{background:'rgba(240,192,64,.06)',borderBottom:'1px solid rgba(240,192,64,.2)',padding:'10px 14px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:C.acc}}>Código no reconocido: <span style={{color:C.blue}}>{linea.codp||linea.cod}</span>
              <span style={{fontSize:9,color:C.mut,marginLeft:10}}>{artCount>0?`buscando en ${fn(artCount)} artículos`:'⚠ Base vacía — recargá DB'}</span>
            </div>
            <div style={{fontSize:10,color:C.txt,marginTop:3}}>"{linea.desc}" · cant: <b>{linea.cantOC}</b>{linea.precioDoc>0?` · $${fn(linea.precioDoc)}`:''}</div>
          </div>
          <button onClick={()=>setModal(m=>({...m,open:false}))} style={{background:'transparent',border:'none',color:C.mut,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>

        <div style={{display:'flex',borderBottom:`1px solid ${C.b1}`,padding:'0 14px'}}>
          {[{id:'buscar',label:'🔍 Buscar en base'},{id:'nuevo',label:'＋ Artículo nuevo'}].map(t=>(
            <span key={t.id} onClick={()=>setModal(m=>({...m,tab:t.id}))}
              style={{padding:'7px 14px',fontSize:10,color:modal.tab===t.id?C.acc:C.mut,cursor:'pointer',borderBottom:modal.tab===t.id?`2px solid ${C.acc}`:'2px solid transparent'}}>
              {t.label}
            </span>
          ))}
        </div>

        {modal.tab==='buscar'&&(
          <>
            <div style={{padding:'10px 14px'}}>
              {artCount===0&&<Alert cls="err">Base de artículos vacía. Hacé click en "↺ Recargar DB" antes de buscar.</Alert>}
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>BÚSQUEDA MANUAL</div>
                <input placeholder="Código, descripción, marca..." value={modal.busqQ} onChange={e=>setModal(m=>({...m,busqQ:e.target.value}))} style={{...IS,fontSize:11}} />
              </div>
              <div style={{fontSize:9,color:C.mut,marginBottom:8,display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
                <span>Palabras buscadas: <span style={{color:C.blue}}>{palabras||'—'}</span></span>
                <span style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{width:8,height:8,background:C.acc,borderRadius:1,display:'inline-block'}}></span>código prov.
                  <span style={{width:8,height:8,background:C.blue,borderRadius:1,display:'inline-block',marginLeft:6}}></span>descripción
                </span>
              </div>
              {freq.fams.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>FAMILIA</div><div>{freq.fams.map(f=><span key={f} onClick={()=>toggle('selFam',f)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selFam===f?C.acc:C.b1}`,cursor:'pointer',margin:2,background:modal.selFam===f?'rgba(240,192,64,.15)':'transparent',color:modal.selFam===f?C.acc:C.txt}}>{f}</span>)}</div></div>}
              {freq.cats.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>CATEGORÍA</div><div>{freq.cats.map(c=><span key={c} onClick={()=>toggle('selCat',c)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selCat===c?C.acc:C.b1}`,cursor:'pointer',margin:2,background:modal.selCat===c?'rgba(240,192,64,.15)':'transparent',color:modal.selCat===c?C.acc:C.txt}}>{c}</span>)}</div></div>}
              {freq.marcas.length>0&&<div style={{marginBottom:8}}><div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>MARCA</div><div>{freq.marcas.map(m=><span key={m} onClick={()=>toggle('selMarca',m)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selMarca===m?C.acc:C.b1}`,cursor:'pointer',margin:2,background:modal.selMarca===m?'rgba(240,192,64,.15)':'transparent',color:modal.selMarca===m?C.acc:C.txt}}>{m}</span>)}</div></div>}
              <div style={{fontSize:9,color:C.mut,marginBottom:4,letterSpacing:'.06em'}}>{resultados.length} ARTÍCULOS — click para asignar</div>
            </div>
            <div style={{maxHeight:220,overflowY:'auto',borderTop:`1px solid ${C.b1}`}}>
              {resultados.length===0
                ?<div style={{padding:18,textAlign:'center',color:C.mut,fontSize:11}}>{artCount===0?'Base vacía — recargar DB primero':'Sin resultados · probá otros filtros o buscá manualmente'}</div>
                :resultados.map(({cod,a,type})=>(
                  <div key={cod} onClick={()=>onAsignar(modal.idx,cod)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',cursor:'pointer',borderBottom:`1px solid ${C.b2}`,borderLeft:`3px solid ${type==='prim'?C.acc:type==='sec'?C.blue:C.b1}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.desc}</div>
                      <div style={{fontSize:9,color:C.mut,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{color:C.blue}}>{cod}</span>
                        <span>codp: <span style={{color:C.acc}}>{a.codp||'—'}</span></span>
                        <span style={{color:C.teal}}>{a.prov||'—'}</span>
                        <span>{a.fam||'—'}</span>
                        {a.costoReal>0&&<span style={{color:C.acc}}>CR: {fp(a.costoReal)}</span>}
                        {a.pvMin>0&&<span style={{color:C.vio}}>PVMin: {fp(a.pvMin)}</span>}
                      </div>
                    </div>
                    {type==='prim'&&<span style={{...badge('warn'),fontSize:8}}>cód.prov</span>}
                    {type==='sec'&&<span style={{...badge('info'),fontSize:8}}>desc.</span>}
                  </div>
                ))
              }
            </div>
            <div style={{padding:'8px 14px',borderTop:`1px solid ${C.b1}`,display:'flex',gap:6}}>
              <button onClick={()=>setModal(m=>({...m,open:false}))} style={Btn(C.mut)}>Omitir línea</button>
              <button onClick={()=>setModal(m=>({...m,tab:'nuevo'}))} style={{...Btn(C.vio,'rgba(192,132,252,.08)')}}>＋ No existe — crear nuevo</button>
            </div>
          </>
        )}

        {modal.tab==='nuevo'&&(
          <div style={{padding:14}}>
            <Alert cls="info">Base de artículos es de solo lectura. El artículo se agrega a la lista de importación al sistema.</Alert>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
              {[['CÓDIGO INTERNO *','cod'],['CÓD. PROVEEDOR','codp'],['PROVEEDOR','prov']].map(([lbl,field])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <input type="text" value={f[field]||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:e.target.value}}))} style={IS} />
                </div>
              ))}
            </div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>DESCRIPCIÓN *</div>
              <input value={f.desc||linea.desc||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,desc:e.target.value}}))} style={IS} />
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
              {[['FAMILIA','fam',freq2.fams],['CATEGORÍA','cat',freq2.cats],['MARCA','marca',freq2.marcas]].map(([lbl,field,opts])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <select value={f[field]||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:e.target.value}}))} style={{...IS,padding:'4px 8px'}}>
                    <option value="">— Seleccionar —</option>
                    {opts.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
              {[['COSTO REAL','costoReal',linea.precioDoc||0],['PV MÍNIMO','pvMin',0],['01-MOSTRADOR','mostrador',0]].map(([lbl,field,def])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <input type="text" inputMode="numeric" value={f[field]||def||''} placeholder="0" onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:parseFloat(e.target.value)||0}}))} style={{...IS,textAlign:'right'}} />
                </div>
              ))}
            </div>
            <div style={{paddingTop:10,borderTop:`1px solid ${C.b1}`,display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={()=>setModal(m=>({...m,tab:'buscar'}))} style={{...Btn(C.mut),marginLeft:'auto'}}>← Volver</button>
              <button onClick={onNuevo} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'6px 14px',fontSize:11,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>＋ Confirmar y agregar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMPRAS — 4 etapas
// ════════════════════════════════════════════════════════════════════════════
function ComprasContent({OCS,OCact,OCdata,setOCdata,etC,setEtC,db,dbReady,nuevaOC,selectOC,deleteOC,importarDesdeStock,procesarDocumento,saveOC,transicionEstado,OCact_,abrirModal}){
  const fileRef=useRef(); const planRef=useRef();
  const ETAPAS=[{id:'carga',n:1,l:'CARGA',s:'Origen OC'},{id:'validacion',n:2,l:'VALIDACIÓN',s:'Precios'},{id:'distribucion',n:3,l:'DISTRIBUCIÓN',s:'Por sucursal'},{id:'confirmar',n:4,l:'CONFIRMAR',s:'Cerrar OC'}];
  const etIdx=ETAPAS.findIndex(e=>e.id===etC);

  return(
    <div>
      {/* Lista OC */}
      {OCS.length>0&&(
        <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 12px',borderBottom:`1px solid ${C.b1}`}}>
            <span style={{fontSize:9,color:C.mut,letterSpacing:'.1em',textTransform:'uppercase'}}>ÓRDENES DE COMPRA</span>
            <button onClick={nuevaOC} style={Btn(C.acc)}>+ Nueva OC</button>
          </div>
          <div style={{maxHeight:80,overflowY:'auto'}}>
            {OCS.map(id=>{const d=lsGet('dm_oc_v3_'+id,null);if(!d)return null;const cfg=ESTADOS_OC[d.meta?.estado]||null;return(
              <div key={id} onClick={()=>selectOC(id)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 12px',cursor:'pointer',borderBottom:`1px solid ${C.b2}`,background:id===OCact?'rgba(240,192,64,.06)':'transparent'}}>
                <span style={{color:C.acc,fontWeight:500,fontSize:12}}>{d.meta?.proveedor||'(sin prov)'}</span>
                <span style={{fontSize:9,color:C.mut}}>{d.meta?.fecha||''} · {d.lineas?.length||0} art.</span>
                {cfg&&<span style={{display:'inline-flex',alignItems:'center',padding:'1px 6px',borderRadius:3,fontSize:8,fontWeight:500,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>}
                {id===OCact&&<span style={{...badge('warn'),marginLeft:'auto'}}>ACTIVA</span>}
                <button onClick={e=>{e.stopPropagation();deleteOC(id);}} style={{background:'transparent',border:'none',color:C.mut,cursor:'pointer',fontSize:12}}>✕</button>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Steps */}
      <div style={{display:'flex',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:'5px 5px 0 0',overflowX:'auto'}}>
        {ETAPAS.map((e,i)=>{const act=etC===e.id,done=etIdx>i;const col=done?C.green:act?C.acc:C.mut;const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':C.b1;return(
          <div key={e.id} onClick={()=>setEtC(e.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',cursor:'pointer',borderBottom:act?`2px solid ${C.acc}`:'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
            <div style={{width:18,height:18,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
            <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
            {i<3&&<div style={{color:C.b1,marginLeft:4}}>›</div>}
          </div>
        );})}
      </div>

      <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderTop:'none',borderRadius:'0 0 5px 5px',padding:14}}>
        {etC==='carga'&&<EtCarga OCdata={OCdata} setOCdata={setOCdata} db={db} importarDesdeStock={importarDesdeStock} fileRef={fileRef} planRef={planRef} procesarDocumento={procesarDocumento} onContinuar={()=>setEtC('validacion')} saveOC={saveOC} OCact={OCact_} />}
        {etC==='validacion'&&<EtValidacion OCdata={OCdata} setOCdata={setOCdata} db={db} dbReady={dbReady} fileRef={fileRef} procesarDocumento={procesarDocumento} saveOC={saveOC} OCact={OCact_} abrirModal={abrirModal} onBack={()=>setEtC('carga')} onNext={()=>setEtC('distribucion')} />}
        {etC==='distribucion'&&<EtDistribucion OCdata={OCdata} setOCdata={setOCdata} saveOC={saveOC} OCact={OCact_} onBack={()=>setEtC('validacion')} onNext={()=>setEtC('confirmar')} />}
        {etC==='confirmar'&&<EtConfirmar OCdata={OCdata} saveOC={saveOC} OCact={OCact_} transicionEstado={transicionEstado} onBack={()=>setEtC('distribucion')} />}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarDocumento(e.target.files[0]);e.target.value='';}} />
      <input ref={planRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarDocumento(e.target.files[0]);e.target.value='';}} />
    </div>
  );
}

function EtCarga({OCdata,setOCdata,db,importarDesdeStock,fileRef,planRef,procesarDocumento,onContinuar,saveOC,OCact}){
  const hasPlan=Object.values(db.plan||{}).some(p=>p.ac>0)||Object.keys(db.pins||{}).length>0;
  const hasOC=OCdata.lineas.length>0;
  const upd=(field,val)=>{const meta={...OCdata.meta,[field]:val};const d={...OCdata,meta};setOCdata(d);saveOC(OCact,d);};
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:14}}>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:7}}>OPCIÓN 1 — DESDE STOCK+</div>
          {hasPlan?<Alert cls="ok">✓ Planilla con artículos disponible</Alert>:<Alert cls="warn">⚠ En Stock+: fijá artículos o completá "A Comprar"</Alert>}
          <button onClick={importarDesdeStock} style={{...Btn(C.acc,'rgba(240,192,64,.1)'),width:'100%',fontWeight:600}}>← Importar desde Stock+</button>
        </div>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:7}}>OPCIÓN 2 — PLANILLA EXCEL</div>
          <Alert cls="info">Exportada desde Stock+ o del proveedor</Alert>
          <button onClick={()=>planRef.current.click()} style={{...Btn(),width:'100%'}}>📋 Cargar .xlsx</button>
        </div>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:7}}>OPCIÓN 3 — FACTURA / REMITO</div>
          <Alert cls="info">PDF, imagen o Excel con IA</Alert>
          <button onClick={()=>fileRef.current.click()} style={{...Btn(),width:'100%'}}>📄 Subir documento</button>
        </div>
      </div>
      {hasOC&&<Alert cls="ok">✓ OC activa: {OCdata.lineas.length} artículos · {OCdata.meta.proveedor||'(sin prov)'} · {OCdata.meta.origen||'manual'}</Alert>}
      <div style={{borderTop:`1px solid ${C.b1}`,paddingTop:12,marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:8,alignItems:'end'}}>
        {[['PROVEEDOR','proveedor',''],['Nº DOCUMENTO','documento',''],['FECHA','fecha',''],['FECHA ENTREGA EST.','fechaEntrega','']].map(([lbl,field,ph])=>(
          <div key={field}>
            <div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
            <input type={field.includes('echa')||field.includes('fecha')?'date':'text'} value={OCdata.meta[field]||''} placeholder={ph} onChange={e=>upd(field,e.target.value)} style={IS} />
          </div>
        ))}
        <button onClick={onContinuar} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 14px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Continuar →</button>
      </div>
    </div>
  );
}

function EtValidacion({OCdata,setOCdata,db,dbReady,fileRef,procesarDocumento,saveOC,OCact,abrirModal,onBack,onNext}){
  if(!OCdata.lineas.length)return<div><Alert cls="warn">Sin líneas. Volvé a Carga.</Alert><button onClick={onBack} style={Btn()}>← Volver</button></div>;
  const rec=OCdata.lineas.filter(l=>l.reconocido).length;
  const noRec=OCdata.lineas.filter(l=>!l.reconocido).length;
  const conFactura=OCdata.lineas.some(l=>l.precioDoc>0);
  const suben=conFactura?OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc>l.costoReal).length:0;
  const bajan=conFactura?OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc<l.costoReal).length:0;

  const updPrecio=(i,val)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,precioDoc:parseFloat(val)||0});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};
  const aprobar=(i,v)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,aprobado:v,rechazado:!v});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:7,marginBottom:10}}>
        {[{l:'LÍNEAS',v:OCdata.lineas.length,c:C.txt},{l:'RECONOCIDAS',v:rec,c:C.green},{l:'NO RECONOCIDAS',v:noRec,c:noRec>0?C.red:C.mut},{l:'PRECIO ↑',v:suben,c:suben>0?C.red:C.mut},{l:'PRECIO ↓',v:bajan,c:bajan>0?C.green:C.mut}].map(k=>(
          <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:17,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>
      {!dbReady&&<Alert cls="warn">⚠ Base de artículos cargando desde Redis...</Alert>}
      {dbReady&&Object.keys(db.art).length===0&&<Alert cls="err">⚠ Base vacía — volvé a Stock+ y cargá el FormatoProveedores.xlsx</Alert>}
      {noRec>0&&<Alert cls="warn">⚠ {noRec} artículo(s) sin reconocer — hacé click en "Resolver →"</Alert>}
      {!conFactura&&<Alert cls="info">Sin factura cargada — los precios muestran el Costo Real de la base. Subí la factura para comparar.</Alert>}
      {suben>0&&<Alert cls="err">↑ {suben} artículo(s) con precio superior al Costo Real</Alert>}
      {bajan>0&&<Alert cls="ok">↓ {bajan} artículo(s) con precio inferior al Costo Real</Alert>}

      <div style={{display:'flex',gap:7,marginBottom:8,alignItems:'center'}}>
        <span style={{fontSize:9,color:C.mut}}>Cruzar con factura:</span>
        <button onClick={()=>fileRef.current.click()} style={Btn(C.mut)}>📄 Subir factura/remito</button>
        <button onClick={()=>{const d={...OCdata,lineas:OCdata.lineas.map(l=>({...l,precioDoc:0}))};setOCdata(d);saveOC(OCact,d);}} style={Btn(C.mut)}>Sin factura</button>
      </div>

      <div style={{overflowX:'auto',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr>
              {['CÓD.DOC','CÓD.BASE','DESC.FACTURA','DESC.BASE','CANT.','PRECIO DOC.','COSTO REAL','MOSTRADOR','PV MÍN.','DIFF','ACCIÓN'].map((h,i)=>(
                <th key={i} style={{fontSize:9,color:h==='PRECIO DOC.'?C.acc:h==='COSTO REAL'?C.mut:h==='MOSTRADOR'?C.blue:h==='PV MÍN.'?C.vio:C.mut,padding:'5px 7px',borderBottom:`1px solid ${C.b1}`,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.06em',textAlign:['CANT.','PRECIO DOC.','COSTO REAL','MOSTRADOR','PV MÍN.'].includes(h)?'right':'left'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const diff=calcDiff(l.costoReal,l.precioDoc);
              const pl=priceLabel(diff);
              const rowBg=!l.reconocido?'rgba(248,113,113,.04)':diff!==null&&diff>0&&!l.aprobado?'rgba(248,113,113,.025)':'transparent';
              let accion=null;
              if(!l.reconocido)accion=<button onClick={()=>abrirModal(i)} style={{...Btn(C.acc,'rgba(240,192,64,.12)'),fontSize:10,padding:'2px 8px'}}>Resolver →</button>;
              else if(diff!==null&&diff>0&&!l.aprobado)accion=<div style={{display:'flex',gap:3}}><button onClick={()=>aprobar(i,true)} style={{...Btn(C.green,'rgba(74,222,128,.1)'),fontSize:9,padding:'2px 6px'}}>✓</button><button onClick={()=>aprobar(i,false)} style={{...Btn(C.red,'rgba(248,113,113,.1)'),fontSize:9,padding:'2px 6px'}}>✗</button></div>;
              else if(l.aprobado)accion=<span style={badge('ok')}>Aprobado</span>;
              else if(l.rechazado)accion=<span style={badge('err')}>Rechazado</span>;
              else accion=<span style={{fontSize:9,color:C.green}}>✓</span>;
              const td=(c,s)=><td style={{padding:'5px 7px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return(
                <tr key={i} style={{background:rowBg}}>
                  {td(l.codp||l.cod,{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                  {td(l.reconocido?(l.cod||'—'):'— ?',{fontSize:9,color:l.reconocido?C.teal:C.red,fontFamily:'DM Mono,monospace'})}
                  {td(<span title={l.desc} style={{display:'block',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</span>)}
                  {td(<span title={l.desc} style={{display:'block',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.mut,fontSize:9}}>{l.desc||'—'}</span>)}
                  {td(l.cantOC,{textAlign:'right',fontWeight:500})}
                  <td style={{padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle',textAlign:'right'}}>
                    <NumInput value={l.precioDoc} onChange={v=>updPrecio(i,v)} color={C.acc} width={85} />
                  </td>
                  {td(fp(l.costoReal),{textAlign:'right',color:C.mut})}
                  {td(fp(l.mostrador),{textAlign:'right',color:C.blue})}
                  {td(fp(l.pvMin),{textAlign:'right',color:C.vio})}
                  {td(<span style={badge(pl.cls)}>{pl.text}</span>)}
                  {td(accion)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
        <button onClick={onBack} style={Btn(C.mut)}>← Volver</button>
        <button onClick={onNext} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Distribución →</button>
      </div>
    </div>
  );
}

function EtDistribucion({OCdata,setOCdata,saveOC,OCact,onBack,onNext}){
  if(!OCdata.lineas.length)return<div><Alert cls="warn">Sin líneas.</Alert><button onClick={onBack} style={Btn()}>← Volver</button></div>;
  const upd=(i,field,val)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,[field]:parseInt(val)||0});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};
  const totCen=OCdata.lineas.reduce((s,l)=>s+(l.dc||0),0);
  const totSol=OCdata.lineas.reduce((s,l)=>s+(l.d1||0),0);
  const totVar=OCdata.lineas.reduce((s,l)=>s+(l.d3||0),0);
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
        {[{l:'→ CENTRAL',v:totCen,c:C.teal},{l:'→ SOLANO',v:totSol,c:C.blue},{l:'→ VARELA',v:totVar,c:C.green}].map(k=>(
          <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px',textAlign:'center'}}>
            <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:20,fontWeight:700,color:k.c}}>{fn(k.v)}</div>
          </div>
        ))}
      </div>
      <div style={{overflowX:'auto',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:10}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead><tr>
            {['CÓDIGO','DESCRIPCIÓN','OC','→CENTRAL','→SOLANO','→VARELA','→DP','DIFF'].map((h,i)=>(
              <th key={i} style={{fontSize:9,color:h==='→CENTRAL'?C.teal:h==='→SOLANO'?C.blue:h==='→VARELA'?C.green:h==='→DP'?C.vio:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.06em',textAlign:i>1?'right':'left'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const tot=(l.dc||0)+(l.d1||0)+(l.d3||0);
              const dp=Math.max(0,l.cantOC-tot);
              const diff=l.cantOC-tot;
              const td=(c,s)=><td style={{padding:'4px 7px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return<tr key={i}>
                {td(l.cod,{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                {td(<span title={l.desc} style={{display:'block',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</span>)}
                {td(l.cantOC,{textAlign:'right',fontWeight:500})}
                <td style={{textAlign:'right',padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumInput value={l.dc} onChange={v=>upd(i,'dc',v)} color={C.teal} width={55} /></td>
                <td style={{textAlign:'right',padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumInput value={l.d1} onChange={v=>upd(i,'d1',v)} color={C.blue} width={55} /></td>
                <td style={{textAlign:'right',padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumInput value={l.d3} onChange={v=>upd(i,'d3',v)} color={C.green} width={55} /></td>
                {td(dp,{textAlign:'right',color:C.vio})}
                {td(<span style={{color:diff===0?C.green:diff>0?C.acc:C.red,fontWeight:600}}>{diff>0?'+':''}{diff}</span>,{textAlign:'right'})}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onBack} style={Btn(C.mut)}>← Volver</button>
        <button onClick={onNext} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Confirmar OC →</button>
      </div>
    </div>
  );
}

function EtConfirmar({OCdata,saveOC,OCact,transicionEstado,onBack}){
  const totUds=OCdata.lineas.reduce((s,l)=>s+l.cantOC,0);
  const totCosto=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);
  const sinPrecio=OCdata.lineas.filter(l=>!l.precioDoc).length;
  const sinDist=OCdata.lineas.filter(l=>!(l.dc||l.d1||l.d3)).length;
  const noResueltos=OCdata.lineas.filter(l=>!l.reconocido).length;
  const yaValidada=OCdata.meta.estado==='validada'||OCdata.meta.estado==='entregada'||OCdata.meta.estado==='recibida';

  const exportarOC=()=>{
    const rows=[['Código','Cód.Prov','Descripción','Familia','Cant.OC','Precio Doc.','Costo Real','PV Mín.','Mostrador','Subtotal','→Central','→Solano','→Varela','→DP']];
    OCdata.lineas.forEach(l=>{const dp=Math.max(0,l.cantOC-(l.dc||0)-(l.d1||0)-(l.d3||0));rows.push([l.cod,l.codp,l.desc,l.fam,l.cantOC,l.precioDoc||0,l.costoReal||0,l.pvMin||0,l.mostrador||0,l.cantOC*(l.precioDoc||0),l.dc||0,l.d1||0,l.d3||0,dp]);});
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'OC');
    XLSX.writeFile(wb,`OC_${OCdata.meta.proveedor||'SinProv'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
        {[{l:'ARTÍCULOS',v:OCdata.lineas.length,c:C.txt},{l:'UNIDADES',v:fn(totUds),c:C.acc},{l:'TOTAL',v:totCosto>0?'$'+fn(totCosto):'—',c:C.green},{l:'PROVEEDOR',v:OCdata.meta.proveedor||'—',c:C.txt}].map(k=>(
          <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:15,fontWeight:700,color:k.c,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Fecha entrega estimada */}
      <div style={{marginBottom:12,display:'flex',gap:12,alignItems:'center'}}>
        <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em'}}>FECHA TENTATIVA DE ENTREGA</div>
        <input type="date" value={OCdata.meta.fechaEntrega||''} onChange={e=>{const meta={...OCdata.meta,fechaEntrega:e.target.value};const d={...OCdata,meta};saveOC(OCact,d);}} style={{...IS,width:160}} />
      </div>

      {noResueltos>0&&<Alert cls="err">⚠ {noResueltos} artículos no reconocidos — volvé a Validación</Alert>}
      {sinPrecio>0?<Alert cls="warn">⚠ {sinPrecio} artículos sin precio documentado</Alert>:<Alert cls="ok">✓ Todos los artículos con precio</Alert>}
      {sinDist>0?<Alert cls="warn">⚠ {sinDist} artículos sin distribución (van a DP automático)</Alert>:<Alert cls="ok">✓ Distribución completa</Alert>}

      {/* Historial */}
      {(OCdata.meta.historial||[]).length>0&&(
        <div style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:10,marginBottom:12}}>
          <div style={{fontSize:9,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:6}}>HISTORIAL DE ESTADOS</div>
          {(OCdata.meta.historial||[]).map((h,i)=>{
            const cfg=ESTADOS_OC[h.estado]||{color:C.mut,label:h.estado};
            return(<div key={i} style={{display:'flex',gap:10,alignItems:'center',marginBottom:4,fontSize:10}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:cfg.color,flexShrink:0,display:'inline-block'}}></span>
              <span style={{color:cfg.color,fontWeight:500,width:100}}>{cfg.label}</span>
              <span style={{color:C.mut}}>{h.label}</span>
              {h.desdePrev>0&&<span style={{color:'#4b5563',fontSize:9}}>+{h.desdePrev} min desde anterior</span>}
            </div>);
          })}
        </div>
      )}

      <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
        <button onClick={onBack} style={Btn(C.mut)}>← Volver</button>
        <button onClick={exportarOC} style={{...Btn(C.teal,'rgba(45,212,191,.08)')}}>↓ Excel OC</button>
        {!yaValidada&&<button onClick={()=>transicionEstado(OCact,'validada',OCdata)} disabled={noResueltos>0}
          style={{background:noResueltos>0?C.b1:C.vio,color:noResueltos>0?C.mut:'#0c0e14',border:'none',borderRadius:4,padding:'7px 16px',fontSize:11,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:noResueltos>0?'not-allowed':'pointer'}}>
          ✓ OC Validada
        </button>}
        {yaValidada&&<span style={{...badge('vio'),padding:'7px 14px'}}>✓ OC Validada · en espera de entrega</span>}
      </div>
    </div>
  );
}
