// ===== MÓDULO COMPRAS V6 =====
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { SK, lsGet, lsSet, lsGetRaw, loadArt, getListaCompra } from '../../utils/db';

const fn   = n => Number(n||0).toLocaleString('es-AR');
const fp   = n => n>0 ? '$'+Number(n).toLocaleString('es-AR',{maximumFractionDigits:0}) : '—';
const fpct = n => (n>=0?'+':'')+n.toFixed(1)+'%';
const now  = () => new Date().toISOString();
const nowLabel = () => new Date().toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

// ─── Expandir formatos compactos ──────────────────────────────────────────────
const expandStk =c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={DM01:+p[0]||0,DM03:+p[1]||0,DMCN:+p[2]||0};}return o;};
const expandVent=s=>{if(!s||typeof s!=='string')return{};const o={};s.replace(/^"|"$/g,'').split('|').forEach(p=>{const i=p.lastIndexOf(':');if(i>0)o[p.slice(0,i)]=+p.slice(i+1)||0;});return o;};
const expandPlan=c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={ac:+p[0]||0,d1:+p[1]||0,d3:+p[2]||0,dc:+p[3]||0};}return o;};

// ─── Estados OC ───────────────────────────────────────────────────────────────
const ESTADOS={
  generada:  {label:'Generada',   color:'#60a5fa',bg:'rgba(96,165,250,.12)'},
  validada:  {label:'Validada',   color:'#c084fc',bg:'rgba(192,132,252,.12)'},
  entregada: {label:'Entregada',  color:'#f0c040',bg:'rgba(240,192,64,.12)'},
  parcial:   {label:'Parcial',    color:'#fb923c',bg:'rgba(251,146,60,.12)'},
  recibida:  {label:'Recibida',   color:'#4ade80',bg:'rgba(74,222,128,.12)'},
};

// ─── Cruce de códigos ─────────────────────────────────────────────────────────
function buildIdx(art){
  const idx={};
  for(const[cod,a]of Object.entries(art)){
    const cp=String(a.codp||'').trim();
    if(cp){if(!idx[cp])idx[cp]=[];idx[cp].push(cod);}
    const cpN=cp.replace(/^0+/,'');
    if(cpN&&cpN!==cp){if(!idx[cpN])idx[cpN]=[];if(!idx[cpN].includes(cod))idx[cpN].push(cod);}
  }
  return idx;
}

function cruzar(codExt,art,idx){
  if(!codExt)return null;
  const cod=String(codExt).trim();
  const codN=cod.replace(/^0+/,'');
  if(idx[cod]?.length)return idx[cod][0];
  if(idx[codN]?.length)return idx[codN][0];
  // Match parcial: el codp contiene el código o viceversa
  for(const[cp,cods]of Object.entries(idx)){
    const cpN=cp.replace(/^0+/,'');
    if(cpN&&codN&&codN.length>=3&&(cpN===codN||cpN.includes(codN)||codN.includes(cpN)))return cods[0];
  }
  if(art[cod])return cod;
  return null;
}

// ─── Búsqueda por palabras ────────────────────────────────────────────────────
function buscar(desc,codDoc,prov,famF,catF,marcaF,q,art){
  if(!art||!Object.keys(art).length)return[];
  const words=(desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>2).slice(0,4);
  const codN=String(codDoc||'').toLowerCase().replace(/^0+/,'');
  const qLow=(q||'').toLowerCase().trim();
  const res=[];
  for(const[cod,a]of Object.entries(art)){
    const hay=(a.desc||'').toLowerCase();
    const cpN=String(a.codp||'').toLowerCase().replace(/^0+/,'');
    const cpF=String(a.codp||'').toLowerCase();
    if(famF&&(a.fam||'')!==famF)continue;
    if(catF&&(a.cat||'')!==catF)continue;
    if(marcaF&&(a.marca||'')!==marcaF)continue;
    let score=0;let type='other';
    // Match por código proveedor (parcial también)
    if(codN&&cpN){
      if(cpN===codN||cpF===codN){score+=25;type='prim';}
      else if(codN.length>=3&&(cpN.includes(codN)||codN.includes(cpN))){score+=18;type='prim';}
    }
    // Match por palabras de descripción
    const wm=words.filter(w=>hay.includes(w)).length;
    if(wm>0){score+=wm*9;if(type==='other')type='sec';}
    // Búsqueda manual
    if(qLow&&(hay.includes(qLow)||cod.toLowerCase().includes(qLow)||cpN.includes(qLow.replace(/^0+/,'')))){score+=16;if(type==='other')type='sec';}
    // Bonus mismo proveedor
    if(prov&&(a.prov||'').toLowerCase()===prov.toLowerCase())score+=5;
    if(score>0)res.push({cod,a,score,type});
  }
  res.sort((a,b)=>{const o={prim:0,sec:1,other:2};if(o[a.type]!==o[b.type])return o[a.type]-o[b.type];return b.score-a.score;});
  return res.slice(0,40);
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

function calcDiff(cr,pd){if(!cr||!pd)return null;return((pd-cr)/cr)*100;}
function priceLabel(diff){
  if(diff===null)return{cls:'mut',text:'S/PRECIO'};
  if(Math.abs(diff)<0.01)return{cls:'ok',text:'✓ IGUAL'};
  if(diff>0)return{cls:'err',text:'↑ '+fpct(diff)};
  return{cls:'ok',text:'↓ '+fpct(Math.abs(diff))};
}

// ─── Colores de stock ─────────────────────────────────────────────────────────
function stkColor(tot,vm,vq,vs){
  if(!vm&&!vq&&!vs)return{color:'#e8eaf0',extra:{}};
  if(vm>0&&tot>=vm)return{color:'#4ade80',extra:{}};
  if(vq>0&&tot>=vq)return{color:'#f0c040',extra:{}};
  if(vs>0&&tot>=vs)return{color:'#f87171',extra:{border:'1px solid #f87171',borderRadius:3,padding:'0 3px',background:'rgba(248,113,113,.1)'}};
  if(vs>0)return{color:'#fff',extra:{background:'#f87171',borderRadius:3,padding:'0 3px'}};
  return{color:'#e8eaf0',extra:{}};
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const C={bg:'#0c0e14',panel:'#111420',p2:'#0d0f1a',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',red:'#f87171',blue:'#60a5fa',vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',txt:'#e8eaf0',mut:'#6b7280'};
const IS={background:C.bg,color:C.txt,border:`1px solid ${C.b1}`,borderRadius:4,fontFamily:'DM Mono,monospace',fontSize:11,padding:'4px 8px',outline:'none',width:'100%'};
const Btn=(col,bg,extra={})=>({cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'5px 11px',border:`1px solid ${col||C.b1}`,background:bg||'transparent',color:col||C.txt,whiteSpace:'nowrap',...extra});
const bStyle=(cls)=>({display:'inline-flex',alignItems:'center',padding:'1px 7px',borderRadius:3,fontSize:9,fontWeight:500,whiteSpace:'nowrap',...{
  ok:  {background:'rgba(74,222,128,.12)',color:C.green,border:'1px solid rgba(74,222,128,.3)'},
  warn:{background:'rgba(240,192,64,.12)',color:C.acc,border:'1px solid rgba(240,192,64,.3)'},
  err: {background:'rgba(248,113,113,.12)',color:C.red,border:'1px solid rgba(248,113,113,.3)'},
  info:{background:'rgba(96,165,250,.12)',color:C.blue,border:'1px solid rgba(96,165,250,.3)'},
  vio: {background:'rgba(192,132,252,.12)',color:C.vio,border:'1px solid rgba(192,132,252,.3)'},
  mut: {background:'rgba(107,114,128,.12)',color:C.mut,border:'1px solid rgba(107,114,128,.3)'},
  teal:{background:'rgba(45,212,191,.12)',color:C.teal,border:'1px solid rgba(45,212,191,.3)'},
  ora: {background:'rgba(251,146,60,.12)',color:C.ora,border:'1px solid rgba(251,146,60,.3)'},
}[cls]||{}});
const Alrt=({cls,children,style})=>{const s={ok:{background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',color:C.green},warn:{background:'rgba(240,192,64,.08)',border:'1px solid rgba(240,192,64,.2)',color:C.acc},err:{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',color:C.red},info:{background:'rgba(96,165,250,.08)',border:'1px solid rgba(96,165,250,.2)',color:C.blue},ora:{background:'rgba(251,146,60,.08)',border:'1px solid rgba(251,146,60,.2)',color:C.ora}}[cls]||{};return<div style={{borderRadius:4,padding:'7px 11px',fontSize:10,marginBottom:7,...s,...(style||{})}}>{children}</div>;};

// ─── Input numérico sin flechas ───────────────────────────────────────────────
function NumIn({value,onChange,onEnterFix,color,disabled,width=72,placeholder='0'}){
  const [loc,setLoc]=useState(String(value||''));
  const ref=useRef();
  useEffect(()=>{if(document.activeElement!==ref.current)setLoc(String(value||''));},[value]);
  return(<input ref={ref} type="text" inputMode="numeric" value={loc} placeholder={placeholder} disabled={disabled}
    onChange={e=>{const v=e.target.value.replace(/[^0-9.]/g,'');setLoc(v);onChange(parseFloat(v)||0);}}
    onBlur={()=>setLoc(String(value||''))}
    onKeyDown={e=>{if(e.key==='Enter'){e.target.blur();if(onEnterFix)onEnterFix();}}}
    style={{width,padding:'3px 5px',fontSize:10,textAlign:'right',background:C.bg,color:(parseFloat(loc)||0)>0?(color||C.acc):C.txt,border:`1px solid ${(parseFloat(loc)||0)>0?(color||C.acc):C.b1}`,borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',opacity:disabled?.3:1}} />);
}

// ─── Cargar DB completa desde Redis + localStorage ────────────────────────────
async function loadDB(){
  const art=await loadArt(); // siempre expandido
  const stkC=lsGet(SK.stk,null); const stk=stkC?expandStk(stkC):{};
  const vs=expandVent(lsGetRaw(SK.vs)||'');
  const vq=expandVent(lsGetRaw(SK.vq)||'');
  const vm=expandVent(lsGetRaw(SK.vm)||'');
  const sh=lsGet(SK.share,null);
  const planC=sh?.planC||lsGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  const listaItems=sh?.listaItems||getListaCompra().items||{};
  const provStock=sh?.prov||null;
  return{art,stk,vs,vq,vm,plan,listaItems,provStock};
}

// ─── Enriquecer línea con todos los datos de la base ─────────────────────────
function enriquecerLinea(codDoc,cant,precioDoc,descDoc,db,idx){
  const codI=cruzar(codDoc,db.art,idx)||codDoc;
  const a=db.art[codI]||{desc:descDoc||'',codp:codDoc,prov:'',fam:'',cat:'',costoReal:0,pvMin:0,mostrador:0};
  const s=db.stk[codI]||{DM01:0,DM03:0,DMCN:0};
  const sh=lsGet(SK.share,null);
  const planC=sh?.planC||lsGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  const p=plan[codI]||{ac:0,d1:0,d3:0,dc:0};
  return{
    cod:codI, codp:codDoc,
    desc:a.desc||descDoc||'', prov:a.prov||'', fam:a.fam||'', cat:a.cat||'',
    costoReal:a.costoReal||0, pvMin:a.pvMin||0, mostrador:a.mostrador||0,
    cantOC:cant||0, dc:p.dc||0, d1:p.d1||0, d3:p.d3||0,
    precioDoc:precioDoc||0, cantRemito:cant||0,
    stkDMCN:s.DMCN, stkDM01:s.DM01, stkDM03:s.DM03,
    vs:db.vs[codI]||0, vq:db.vq[codI]||0, vm:db.vm[codI]||0,
    reconocido:!!(a.desc&&a.desc!==descDoc), // reconocido si tiene desc en la base
    aprobado:false, rechazado:false, esSobrante:false,
  };
}

// ════════════════════════════════════════════════════════════════════════════
export default function ModuloCompras(){
  const [db,     setDb]    = useState({art:{},stk:{},vs:{},vq:{},vm:{},plan:{},listaItems:{},provStock:null});
  const [dbReady,setDbReady]=useState(false);
  const [OCS,    setOCS]   = useState(()=>lsGet(SK.ocs,[]));
  const [OCact,  setOCact] = useState(null);
  const [OCdata, setOCdata]= useState({meta:{proveedor:'',fecha:'',documento:'',estado:'generada',historial:[]},lineas:[]});
  const [etC,    setEtC]   = useState('carga');
  const [modal,  setModal] = useState({open:false,idx:0,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',nuevoForm:{cod:'',desc:'',codp:'',prov:'',fam:'',cat:'',marca:'',costoReal:0,pvMin:0,mostrador:0}});

  const codpIdx=React.useMemo(()=>buildIdx(db.art),[db.art]);

  // Cargar DB al montar y cuando se necesite
  const reloadDB=useCallback(()=>{
    setDbReady(false);
    loadDB().then(fresh=>{
      setDb(fresh);setDbReady(true);
    });
  },[]);

  useEffect(()=>{
    loadDB().then(fresh=>{
      setDb(fresh);setDbReady(true);
      // Restaurar OC activa
      const ocs=lsGet(SK.ocs,[]);
      if(ocs.length){
        const id=ocs[ocs.length-1];
        const d=lsGet('dm_oc_v3_'+id,null);
        if(d&&d.lineas?.length){setOCact(id);setOCdata({meta:d.meta||{},lineas:d.lineas||[]});setEtC('validacion');}
      }
    });
  },[]);

  const saveOC=useCallback((id,data)=>{
    if(!id)return;
    setOCS(prev=>{const n=prev.includes(id)?prev:[...prev,id];lsSet(SK.ocs,n);return n;});
    lsSet('dm_oc_v3_'+id,{meta:data.meta,lineas:data.lineas});
  },[]);

  const transicion=useCallback((id,est,data)=>{
    const ts=now();const h=data.meta.historial||[];
    const prev=h.length?h[h.length-1]:null;
    const mins=prev?Math.round((new Date(ts)-new Date(prev.ts))/60000):0;
    const entrada={estado:est,ts,label:nowLabel(),usuario:'Operario',desdePrev:mins};
    const meta={...data.meta,estado:est,historial:[...h,entrada]};
    const updated={...data,meta};setOCdata(updated);saveOC(id,updated);return updated;
  },[saveOC]);

  // ─── Importar desde Stock+ ────────────────────────────────────────────────
  const importarDesdeStock=useCallback(()=>{
    const sh=lsGet(SK.share,null);
    const planC=sh?.planC||lsGet(SK.plan,null);
    const listaItems=sh?.listaItems||getListaCompra().items||{};
    const prov=sh?.prov||'';
    if(!planC&&!Object.keys(listaItems).length){
      alert('En Stock+: tildá artículos y presioná "→ Compras".');return;
    }
    const plan=planC?expandPlan(planC):{};
    // Combinar plan + lista
    const todos={};
    Object.entries(plan).forEach(([cod,p])=>{if(p.ac||p.d1||p.d3||p.dc)todos[cod]=p;});
    Object.entries(listaItems).forEach(([cod,it])=>{
      if(!todos[cod])todos[cod]={ac:it.ac||0,d1:it.d1||0,d3:it.d3||0,dc:it.dc||0};
    });
    if(!Object.keys(todos).length){alert('Sin artículos para importar.');return;}

    const lineas=Object.entries(todos).map(([cod,p])=>{
      // db.art ya está expandido gracias al fix en db.js
      const a=db.art[cod]||{desc:'',codp:'',prov:'',fam:'',cat:'',costoReal:0,pvMin:0,mostrador:0};
      const s=db.stk[cod]||{DM01:0,DM03:0,DMCN:0};
      return{
        cod, codp:a.codp||cod,
        desc:a.desc||'', prov:a.prov||prov, fam:a.fam||'', cat:a.cat||'',
        costoReal:a.costoReal||0, pvMin:a.pvMin||0, mostrador:a.mostrador||0,
        cantOC:p.ac||0, dc:p.dc||0, d1:p.d1||0, d3:p.d3||0,
        precioDoc:0, cantRemito:p.ac||0,
        stkDMCN:s.DMCN, stkDM01:s.DM01, stkDM03:s.DM03,
        vs:db.vs[cod]||0, vq:db.vq[cod]||0, vm:db.vm[cod]||0,
        reconocido:!!(a.desc),
        aprobado:false, rechazado:false, esSobrante:false,
        // Artículos de otro proveedor en la lista
        otroProveedor:listaItems[cod]?.esOtroProveedor||false,
        provOriginal:listaItems[cod]?.provOriginal||a.prov||'',
      };
    });
    const id='oc_'+Date.now();
    const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Stock+',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas};
    setOCdata(data);setOCact(id);saveOC(id,data);setEtC('validacion');
  },[db,saveOC]);

  // ─── Procesar documento (factura/remito) ──────────────────────────────────
  const procesarDoc=useCallback(async(file)=>{
    const ext=file.name.toLowerCase().split('.').pop();
    let docLineas=[];
    let docMeta={};

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
      for(let i=hRow+1;i<raw.length;i++){
        const r=raw[i];const cod=String(r[iCod]||'').trim();if(!cod||cod.length<2)continue;
        docLineas.push({cod,desc:String(r[iDesc]||'').trim(),cant:parseFloat(String(r[iCant]||'0').replace(',','.'))||0,precio:parseFloat(String(r[iPrecio>=0?iPrecio:3]||'0').replace(',','.'))||0});
      }
    } else {
      // IA
      try{
        const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
        const reader=new FileReader();
        const b64=await new Promise(res=>{reader.onload=e=>res(e.target.result.split(',')[1]);reader.readAsDataURL(file);});
        const mtype=isPdf?'application/pdf':file.type||'image/jpeg';
        const res=await fetch('/api/ia/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:b64,mediaType:mtype})});
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||'Error: '+res.status);}
        const result=await res.json();
        const parsed=JSON.parse((result.text||'').replace(/```json|```/g,'').trim());
        docMeta={proveedor:parsed.proveedor||'',nDocumento:parsed.nDocumento||'',fecha:parsed.fecha||''};
        docLineas=(parsed.lineas||[]).map(l=>({cod:l.cod,desc:l.desc||'',cant:Number(l.cant)||0,precio:Number(l.precioUnit)||0}));
      }catch(e){alert('Error IA: '+e.message);return;}
    }

    if(!docLineas.length){alert('Sin líneas en el documento');return;}
    aplicarDocumento(docLineas,docMeta);
  },[db,codpIdx,saveOC,OCact,OCdata]);// eslint-disable-line

  const aplicarDocumento=useCallback((docLineas,docMeta={})=>{
    // Si ya hay OC: cruzar precios y cantidades. NO reemplazar líneas.
    // Si no hay OC: crear desde documento.
    if(OCdata.lineas.length){
      setOCdata(prev=>{
        // Actualizar meta si vino info del doc
        const meta={...prev.meta};
        if(docMeta.proveedor&&!meta.proveedor)meta.proveedor=docMeta.proveedor;
        if(docMeta.nDocumento)meta.documento=docMeta.nDocumento;

        // Para cada línea del doc, buscar su correspondiente en la OC
        const lineasActualizadas=prev.lineas.map(l=>{
          const match=docLineas.find(dl=>{
            const ci=cruzar(dl.cod,db.art,codpIdx);
            return dl.cod===l.codp||dl.cod===l.cod||(ci&&ci===l.cod);
          });
          if(match){
            // Actualizar precio y cantidad del remito, mantener todo lo demás
            return{...l,
              precioDoc:match.precio||l.precioDoc||0,
              cantRemito:match.cant||l.cantRemito||l.cantOC,
            };
          }
          return l;
        });

        // Artículos en el doc que NO están en la OC → sobrantes
        const codsOC=new Set(prev.lineas.map(l=>l.cod));
        const codpOC=new Set(prev.lineas.map(l=>l.codp));
        const sobrantes=[];
        for(const dl of docLineas){
          const ci=cruzar(dl.cod,db.art,codpIdx)||dl.cod;
          if(!codsOC.has(ci)&&!codsOC.has(dl.cod)&&!codpOC.has(dl.cod)){
            sobrantes.push({...enriquecerLinea(dl.cod,dl.cant,dl.precio,dl.desc,db,codpIdx),esSobrante:true});
          }
        }

        const updated={...prev,meta,lineas:[...lineasActualizadas,...sobrantes]};
        saveOC(OCact,updated);
        return updated;
      });
    } else {
      const lineas=docLineas.map(dl=>enriquecerLinea(dl.cod,dl.cant,dl.precio,dl.desc,db,codpIdx));
      const prov=docMeta.proveedor||lineas.find(l=>l.prov)?.prov||'';
      const id='oc_'+Date.now();
      const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:docMeta.nDocumento||'',origen:'Documento',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas};
      setOCdata(data);setOCact(id);saveOC(id,data);
    }
    setEtC('validacion');
  },[OCdata.lineas,OCact,db,codpIdx,saveOC]);

  // ─── Modal ────────────────────────────────────────────────────────────────
  const asignarArt=useCallback((idx,cod)=>{
    const a=db.art[cod];if(!a)return;
    setOCdata(prev=>{
      const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,cod,codp:a.codp||l.codp,desc:a.desc,prov:a.prov||'',fam:a.fam||'',cat:a.cat||'',costoReal:a.costoReal||0,pvMin:a.pvMin||0,mostrador:a.mostrador||0,reconocido:true});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[db.art,OCact,saveOC]);

  const confirmarNuevo=useCallback(()=>{
    const f=modal.nuevoForm;const l=OCdata.lineas[modal.idx];
    if(!f.cod){alert('El código interno es obligatorio');return;}
    const nuevo={prov:f.prov||l?.prov||'',codp:f.codp||l?.codp||'',desc:f.desc||l?.desc||'',fam:f.fam||'',cat:f.cat||'',marca:f.marca||'',costoReal:f.costoReal||0,pvMin:f.pvMin||0,mostrador:f.mostrador||0};
    const nList=lsGet(SK.nuevos,[]);nList.push({cod:f.cod,...nuevo,fechaAlta:now()});lsSet(SK.nuevos,nList);
    setOCdata(prev=>{
      const lineas=prev.lineas.map((li,i)=>i!==modal.idx?li:{...li,cod:f.cod,codp:f.codp||li.codp,desc:nuevo.desc,costoReal:nuevo.costoReal,pvMin:nuevo.pvMin,mostrador:nuevo.mostrador,prov:nuevo.prov,fam:nuevo.fam,reconocido:true});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[modal,OCdata.lineas,OCact,saveOC]);

  const abrirModal=(idx)=>{
    const l=OCdata.lineas[idx];
    setModal({open:true,idx,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',
      nuevoForm:{cod:'',desc:l?.desc||'',codp:l?.codp||l?.cod||'',prov:l?.prov||db.provStock||OCdata.meta.proveedor||'',fam:'',cat:'',marca:'',costoReal:l?.precioDoc||0,pvMin:0,mostrador:0}});
  };

  const nuevaOC=()=>{
    const id='oc_'+Date.now();
    const data={meta:{proveedor:'',fecha:new Date().toISOString().slice(0,10),documento:'',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas:[]};
    setOCdata(data);setOCS(prev=>{const n=[...prev,id];lsSet(SK.ocs,n);return n;});
    setOCact(id);lsSet('dm_oc_v3_'+id,data);setEtC('carga');
  };
  const selectOC=(id)=>{
    setOCact(id);
    const d=lsGet('dm_oc_v3_'+id,null);
    if(d){setOCdata({meta:d.meta||{},lineas:d.lineas||[]});setEtC('validacion');}
  };
  const deleteOC=(id)=>{
    if(!window.confirm('¿Eliminar OC?'))return;
    setOCS(prev=>{const n=prev.filter(x=>x!==id);lsSet(SK.ocs,n);return n;});
    try{localStorage.removeItem('dm_oc_v3_'+id);}catch{}
    if(OCact===id){setOCact(null);setOCdata({meta:{},lineas:[]});setEtC('carga');}
  };

  const exportarNuevos=()=>{
    const nList=lsGet(SK.nuevos,[]);
    // También incluir artículos de otro proveedor de la OC
    const otrosProv=OCdata.lineas.filter(l=>l.otroProveedor);
    const rows=[['Código Interno','Cód.Prov Nuevo','Descripción','Familia','Categ.','Marca','Costo Real','PV Mín.','Mostrador','Proveedor a comprar','Fecha Alta']];
    nList.forEach(n=>rows.push([n.cod,n.codp,n.desc,n.fam,n.cat,n.marca||'',n.costoReal,n.pvMin,n.mostrador,n.prov,n.fechaAlta]));
    otrosProv.forEach(l=>{if(!nList.find(n=>n.cod===l.cod))rows.push([l.cod,l.codp,l.desc,l.fam,l.cat,'',l.costoReal,l.pvMin,l.mostrador,OCdata.meta.proveedor,'Nueva línea proveedor']);});
    if(rows.length===1){alert('Sin artículos nuevos para exportar');return;}
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'Nuevos');
    XLSX.writeFile(wb,`articulos_nuevos_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportarOC=()=>{
    if(!OCdata.lineas.length)return;
    const rows=[['Código','Cód.Prov','Descripción','Familia','Cant.OC','Precio Doc.','Costo Real','PV Mín.','Mostrador','Subtotal','Stk Cen','Stk Sol','Stk Var','V.Sem','V.Quin','V.Mes','→Central','→Solano','→Varela','→DP','Sobrante']];
    OCdata.lineas.forEach(l=>{const dp=Math.max(0,l.cantOC-(l.dc||0)-(l.d1||0)-(l.d3||0));rows.push([l.cod,l.codp,l.desc,l.fam,l.cantOC,l.precioDoc||0,l.costoReal||0,l.pvMin||0,l.mostrador||0,l.cantOC*(l.precioDoc||0),l.stkDMCN||0,l.stkDM01||0,l.stkDM03||0,l.vs||0,l.vq||0,l.vm||0,l.dc||0,l.d1||0,l.d3||0,dp,l.esSobrante?'SÍ':'']);});
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'OC');
    XLSX.writeFile(wb,`OC_${OCdata.meta.proveedor||'SinProv'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const estadoCfg=ESTADOS[OCdata.meta.estado]||null;
  const totVal=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);
  const nNuevos=lsGet(SK.nuevos,[]).length;
  const nOtroProv=OCdata.lineas.filter(l=>l.otroProveedor).length;
  const fileRef=useRef();

  return(
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:C.bg}}>
      {/* Header */}
      <div style={{background:C.p2,borderBottom:`1px solid ${C.b1}`,display:'flex',padding:'0 14px',flexShrink:0,alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700,color:C.acc}}>COMPRAS</span>
        {estadoCfg&&<span style={{...bStyle('info'),background:estadoCfg.bg,color:estadoCfg.color,border:`1px solid ${estadoCfg.color}44`}}>{estadoCfg.label}</span>}
        <span style={{fontSize:9,color:dbReady&&Object.keys(db.art).length>0?C.teal:C.red}}>
          {dbReady?`✓ ${fn(Object.keys(db.art).length)} arts en DB`:'Cargando DB...'}
        </span>
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          <button onClick={reloadDB}            style={Btn(C.mut)}>↺ DB</button>
          <button onClick={importarDesdeStock}   style={Btn(C.acc,'rgba(240,192,64,.08)')}>← Stock+</button>
          <button onClick={exportarOC}           style={Btn(C.teal,'rgba(45,212,191,.08)')}>↓ Excel OC</button>
          {(nNuevos>0||nOtroProv>0)&&<button onClick={exportarNuevos} style={Btn(C.ora,'rgba(251,146,60,.08)')}>↓ Nuevos ({nNuevos+nOtroProv})</button>}
        </div>
      </div>

      {/* Modal */}
      {modal.open&&<ModalArt modal={modal} setModal={setModal} linea={OCdata.lineas[modal.idx]} db={db} codpIdx={codpIdx} onAsignar={asignarArt} onNuevo={confirmarNuevo} OCprov={OCdata.meta.proveedor} />}

      <div style={{flex:1,overflow:'auto',padding:12}}>
        {/* Lista OC */}
        {OCS.length>0&&(
          <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 12px',borderBottom:`1px solid ${C.b1}`}}>
              <span style={{fontSize:9,color:C.mut,letterSpacing:'.1em',textTransform:'uppercase'}}>ÓRDENES DE COMPRA</span>
              <button onClick={nuevaOC} style={Btn(C.acc)}>+ Nueva OC</button>
            </div>
            <div style={{maxHeight:72,overflowY:'auto'}}>
              {OCS.map(id=>{
                const d=lsGet('dm_oc_v3_'+id,null);if(!d)return null;
                const cfg=ESTADOS[d.meta?.estado]||null;
                return(
                  <div key={id} onClick={()=>selectOC(id)} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 12px',cursor:'pointer',borderBottom:`1px solid ${C.b2}`,background:id===OCact?'rgba(240,192,64,.06)':'transparent'}}>
                    <span style={{color:C.acc,fontWeight:500}}>{d.meta?.proveedor||'(sin prov)'}</span>
                    <span style={{fontSize:9,color:C.mut}}>{d.meta?.fecha||''} · {d.lineas?.length||0} art. · {d.meta?.origen||''}</span>
                    {cfg&&<span style={{...bStyle('info'),background:cfg.bg,color:cfg.color,border:`1px solid ${cfg.color}44`}}>{cfg.label}</span>}
                    {id===OCact&&<span style={{...bStyle('warn'),marginLeft:'auto'}}>ACTIVA</span>}
                    <button onClick={e=>{e.stopPropagation();deleteOC(id);}} style={{background:'transparent',border:'none',color:C.mut,cursor:'pointer'}}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Steps */}
        <Steps etC={etC} setEtC={setEtC} />

        <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderTop:'none',borderRadius:'0 0 5px 5px',padding:14}}>
          {etC==='carga'&&(
            <EtCarga OCdata={OCdata} setOCdata={setOCdata}
              importarDesdeStock={importarDesdeStock}
              fileRef={fileRef} procesarDoc={procesarDoc}
              onNext={()=>setEtC('validacion')}
              saveOC={saveOC} OCact={OCact} />
          )}
          {etC==='validacion'&&(
            <EtValidacion OCdata={OCdata} setOCdata={setOCdata}
              db={db} dbReady={dbReady}
              fileRef={fileRef} procesarDoc={procesarDoc}
              saveOC={saveOC} OCact={OCact}
              abrirModal={abrirModal}
              onBack={()=>setEtC('carga')}
              onNext={()=>setEtC('distribucion')} />
          )}
          {etC==='distribucion'&&(
            <EtDistribucion OCdata={OCdata} setOCdata={setOCdata}
              saveOC={saveOC} OCact={OCact}
              onBack={()=>setEtC('validacion')}
              onNext={()=>setEtC('confirmar')} />
          )}
          {etC==='confirmar'&&(
            <EtConfirmar OCdata={OCdata}
              saveOC={saveOC} OCact={OCact}
              transicion={transicion}
              onBack={()=>setEtC('distribucion')} />
          )}
        </div>
      </div>

      {/* Footer historial */}
      <div style={{background:C.p2,borderTop:`1px solid ${C.b1}`,padding:'5px 14px',display:'flex',gap:10,alignItems:'center',flexShrink:0,fontSize:9}}>
        <span style={{color:C.mut}}>{OCdata.lineas.length} líneas · {OCS.length} OC(s)</span>
        {totVal>0&&<span style={{color:C.acc}}>Total doc: ${fn(totVal)}</span>}
        {(OCdata.meta.historial||[]).length>0&&(
          <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
            {(OCdata.meta.historial||[]).map((h,i)=>{
              const cfg=ESTADOS[h.estado]||{color:C.mut,label:h.estado};
              return(
                <span key={i} style={{display:'flex',alignItems:'center',gap:3,color:cfg.color}}>
                  {i>0&&<span style={{color:C.b1}}>→</span>}
                  {cfg.label} <span style={{color:C.mut}}>{h.label}</span>
                  {h.desdePrev>0&&<span style={{color:'#4b5563'}}>+{h.desdePrev}m</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarDoc(e.target.files[0]);e.target.value='';}} />
    </div>
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────────
function Steps({etC,setEtC}){
  const ETAPAS=[{id:'carga',n:1,l:'CARGA',s:'Origen OC'},{id:'validacion',n:2,l:'VALIDACIÓN',s:'Precios'},{id:'distribucion',n:3,l:'DISTRIBUCIÓN',s:'Por sucursal'},{id:'confirmar',n:4,l:'CONFIRMAR',s:'Cerrar OC'}];
  const etIdx=ETAPAS.findIndex(e=>e.id===etC);
  return(
    <div style={{display:'flex',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:'5px 5px 0 0',overflowX:'auto'}}>
      {ETAPAS.map((e,i)=>{const act=etC===e.id,done=etIdx>i;const col=done?C.green:act?C.acc:C.mut;const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':C.b1;return(
        <div key={e.id} onClick={()=>setEtC(e.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',cursor:'pointer',borderBottom:act?`2px solid ${C.acc}`:'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
          <div style={{width:18,height:18,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
          <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
          {i<3&&<div style={{color:C.b1,marginLeft:4}}>›</div>}
        </div>
      );})}
    </div>
  );
}

// ─── E1 CARGA ─────────────────────────────────────────────────────────────────
function EtCarga({OCdata,setOCdata,importarDesdeStock,fileRef,procesarDoc,onNext,saveOC,OCact}){
  const upd=(f,v)=>{const meta={...OCdata.meta,[f]:v};const d={...OCdata,meta};setOCdata(d);saveOC(OCact,d);};
  const hasOC=OCdata.lineas.length>0;
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:6}}>OPCIÓN 1 — DESDE STOCK+</div>
          <Alrt cls="info">Tildá artículos en Stock+ y presioná → Compras</Alrt>
          <button onClick={importarDesdeStock} style={{...Btn(C.acc,'rgba(240,192,64,.1)'),width:'100%',fontWeight:600}}>← Importar desde Stock+</button>
        </div>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:6}}>OPCIÓN 2 — PLANILLA EXCEL</div>
          <Alrt cls="info">Exportada desde Stock+ o del proveedor</Alrt>
          <button onClick={()=>fileRef.current.click()} style={{...Btn(),width:'100%'}}>📋 Cargar .xlsx</button>
        </div>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:6}}>OPCIÓN 3 — FACTURA / REMITO</div>
          <Alrt cls="info">PDF, imagen o Excel — lectura con IA</Alrt>
          <button onClick={()=>fileRef.current.click()} style={{...Btn(),width:'100%'}}>📄 Subir documento</button>
        </div>
      </div>
      {hasOC&&<Alrt cls="ok">✓ OC activa: {OCdata.lineas.length} artículos · {OCdata.meta.proveedor||'(sin prov)'} · {OCdata.meta.origen||'manual'} · <span style={{fontSize:9}}>Subir factura en Validación para cruzar precios sin reemplazar</span></Alrt>}
      <div style={{borderTop:`1px solid ${C.b1}`,paddingTop:12,marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:8,alignItems:'end'}}>
        {[['PROVEEDOR','proveedor','text'],['Nº DOCUMENTO','documento','text'],['FECHA DOC.','fecha','date'],['ENTREGA EST.','fechaEntrega','date']].map(([lbl,field,type])=>(
          <div key={field}>
            <div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
            <input type={type} value={OCdata.meta[field]||''} onChange={e=>upd(field,e.target.value)} style={IS} />
          </div>
        ))}
        <button onClick={onNext} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 14px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Continuar →</button>
      </div>
    </div>
  );
}

// ─── E2 VALIDACIÓN ────────────────────────────────────────────────────────────
function EtValidacion({OCdata,setOCdata,db,dbReady,fileRef,procesarDoc,saveOC,OCact,abrirModal,onBack,onNext}){
  if(!OCdata.lineas.length)return<div><Alrt cls="warn">Sin líneas. Volvé a Carga.</Alrt><button onClick={onBack} style={Btn()}>← Volver</button></div>;

  const rec=OCdata.lineas.filter(l=>l.reconocido).length;
  const noRec=OCdata.lineas.filter(l=>!l.reconocido).length;
  const sobrantes=OCdata.lineas.filter(l=>l.esSobrante).length;
  const conFac=OCdata.lineas.some(l=>l.precioDoc>0);
  const suben=conFac?OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc>l.costoReal).length:0;
  const bajan=conFac?OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc<l.costoReal).length:0;

  const updLinea=(i,field,val)=>{
    const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,[field]:typeof val==='number'?val:parseFloat(val)||0});
    const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);
  };
  const aprobar=(i,v)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,aprobado:v,rechazado:!v});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};

  return(
    <div>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:6,marginBottom:8}}>
        {[{l:'LÍNEAS',v:OCdata.lineas.length,c:C.txt},{l:'RECONOCIDAS',v:rec,c:C.green},{l:'SIN RECONOCER',v:noRec,c:noRec>0?C.red:C.mut},{l:'SOBRANTES',v:sobrantes,c:sobrantes>0?C.ora:C.mut},{l:'PRECIO ↑',v:suben,c:suben>0?C.red:C.mut},{l:'PRECIO ↓',v:bajan,c:bajan>0?C.green:C.mut}].map(k=>(
          <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'6px 9px'}}>
            <div style={{fontSize:7,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:2}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {!dbReady||Object.keys(db.art).length===0?<Alrt cls="err">⚠ Base vacía — cargá FormatoProveedores en Stock+ y hacé ↺ DB</Alrt>:null}
      {noRec>0&&<Alrt cls="warn">⚠ {noRec} artículo(s) sin reconocer — hacé click en "Resolver →" para buscar en la base</Alrt>}
      {sobrantes>0&&<Alrt cls="ora">⚡ {sobrantes} artículo(s) sobrantes — vinieron en el documento pero no estaban en la OC</Alrt>}
      {!conFac&&<Alrt cls="info">Sin factura cargada — mostrando Costo Real de la base. Subí la factura para comparar (no reemplaza la OC).</Alrt>}
      {suben>0&&<Alrt cls="err">↑ {suben} artículo(s) con precio de factura superior al Costo Real</Alrt>}
      {bajan>0&&<Alrt cls="ok">↓ {bajan} artículo(s) con precio de factura inferior al Costo Real</Alrt>}

      <div style={{display:'flex',gap:7,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:9,color:C.mut}}>Subir factura/remito para cruzar precios (no borra la OC):</span>
        <button onClick={()=>fileRef.current.click()} style={Btn(C.mut)}>📄 Subir factura</button>
        <button onClick={()=>{const d={...OCdata,lineas:OCdata.lineas.map(l=>({...l,precioDoc:0}))};setOCdata(d);saveOC(OCact,d);}} style={Btn(C.mut)}>Limpiar precios</button>
      </div>

      {/* Tabla completa */}
      <div style={{overflowX:'auto',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1200}}>
          <thead>
            <tr>
              {[
                ['',C.mut,24],['CÓD.DOC',C.blue,80],['CÓD.BASE',C.teal,80],['DESCRIPCIÓN',C.txt,140],['FAM.',C.mut,60],
                ['CEN',C.teal,52],['SOL',C.blue,52],['VAR',C.green,52],['STK',C.txt,52],
                ['V.SEM',C.mut,48],['V.QUIN',C.mut,48],['V.MES',C.mut,48],
                ['CANT.',C.txt,60],['PRECIO DOC.',C.acc,85],['COSTO REAL',C.mut,80],['MOSTRADOR',C.blue,75],['PV MÍN.',C.vio,75],['SUBTOTAL',C.acc,85],
                ['DIFF',C.mut,70],['ACCIÓN',C.mut,90]
              ].map(([h,c,w],i)=>(
                <th key={i} style={{fontSize:8,color:c,padding:'4px 5px',borderBottom:`1px solid ${C.b1}`,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.05em',textAlign:i>4?'right':'left',background:C.p2,width:w,minWidth:w}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const diff=calcDiff(l.costoReal,l.precioDoc);
              const pl=priceLabel(diff);
              const totStk=(l.stkDMCN||0)+(l.stkDM01||0)+(l.stkDM03||0);
              const sc=stkColor(totStk,l.vm||0,l.vq||0,l.vs||0);
              const subtotal=l.cantOC*(l.precioDoc||0);
              const rowBg=l.esSobrante?'rgba(251,146,60,.04)':!l.reconocido?'rgba(248,113,113,.04)':diff!==null&&diff>0&&!l.aprobado?'rgba(248,113,113,.02)':'transparent';
              let accion=null;
              if(!l.reconocido)accion=<button onClick={()=>abrirModal(i)} style={{...Btn(C.acc,'rgba(240,192,64,.12)'),fontSize:9,padding:'2px 7px'}}>Resolver →</button>;
              else if(diff!==null&&diff>0&&!l.aprobado)accion=<div style={{display:'flex',gap:2}}><button onClick={()=>aprobar(i,true)} style={{...Btn(C.green,'rgba(74,222,128,.1)'),fontSize:9,padding:'2px 4px'}}>✓</button><button onClick={()=>aprobar(i,false)} style={{...Btn(C.red,'rgba(248,113,113,.1)'),fontSize:9,padding:'2px 4px'}}>✗</button></div>;
              else if(l.aprobado)accion=<span style={bStyle('ok')}>OK</span>;
              else if(l.rechazado)accion=<span style={bStyle('err')}>✗</span>;
              else if(l.esSobrante)accion=<span style={bStyle('ora')}>⚡ Sobrante</span>;
              else accion=<span style={{fontSize:9,color:C.green}}>✓</span>;
              const td=(c,s)=><td style={{padding:'4px 5px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return(
                <tr key={i} style={{background:rowBg}}>
                  {/* Indicador sobrante */}
                  {td(l.esSobrante?<span title="Sobrante" style={{color:C.ora}}>⚡</span>:l.otroProveedor?<span title="Otro proveedor" style={{color:C.vio}}>★</span>:'',{textAlign:'center',width:24})}
                  {td(l.codp||l.cod,{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                  {td(l.reconocido?l.cod:'—?',{fontSize:9,color:l.reconocido?C.teal:C.red,fontFamily:'DM Mono,monospace'})}
                  {td(<span title={l.desc} style={{display:'block',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc||'—'}</span>)}
                  {td(l.fam||'—',{fontSize:9,color:C.mut})}
                  {td(l.stkDMCN||'—',{textAlign:'right',color:l.stkDMCN>0?C.teal:C.mut,fontSize:9})}
                  {td(l.stkDM01||'—',{textAlign:'right',color:l.stkDM01>0?C.blue:C.mut,fontSize:9})}
                  {td(l.stkDM03||'—',{textAlign:'right',color:l.stkDM03>0?C.green:C.mut,fontSize:9})}
                  {td(<span style={{color:sc.color,...sc.extra}}>{totStk||'—'}</span>,{textAlign:'right',fontSize:9})}
                  {td(l.vs||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {td(l.vq||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {td(l.vm||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {td(<NumIn value={l.cantOC} onChange={v=>updLinea(i,'cantOC',v)} color={C.txt} width={55} />,{textAlign:'right',padding:'3px 4px'})}
                  {td(<NumIn value={l.precioDoc} onChange={v=>updLinea(i,'precioDoc',v)} color={C.acc} width={82} />,{textAlign:'right',padding:'3px 4px'})}
                  {td(fp(l.costoReal),{textAlign:'right',color:C.mut})}
                  {td(fp(l.mostrador),{textAlign:'right',color:C.blue})}
                  {td(fp(l.pvMin),{textAlign:'right',color:C.vio})}
                  {td(subtotal>0?'$'+fn(subtotal):'—',{textAlign:'right',color:C.acc,fontWeight:500})}
                  {td(<span style={bStyle(pl.cls)}>{pl.text}</span>)}
                  {td(accion)}
                </tr>
              );
            })}
            {/* Fila de totales */}
            <tr style={{background:'rgba(240,192,64,.04)'}}>
              <td colSpan={12} style={{padding:'5px 5px',fontSize:9,color:C.mut,textAlign:'right',borderTop:`1px solid ${C.b1}`}}>TOTALES →</td>
              <td style={{padding:'5px 5px',textAlign:'right',borderTop:`1px solid ${C.b1}`,fontSize:10,fontWeight:600}}>{fn(OCdata.lineas.reduce((s,l)=>s+l.cantOC,0))}</td>
              <td colSpan={4} style={{padding:'5px 5px',borderTop:`1px solid ${C.b1}`}}></td>
              <td style={{padding:'5px 5px',textAlign:'right',borderTop:`1px solid ${C.b1}`,fontSize:10,color:C.acc,fontWeight:700}}>${fn(OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0))}</td>
              <td colSpan={2} style={{padding:'5px 5px',borderTop:`1px solid ${C.b1}`}}></td>
            </tr>
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

// ─── E3 DISTRIBUCIÓN ──────────────────────────────────────────────────────────
function EtDistribucion({OCdata,setOCdata,saveOC,OCact,onBack,onNext}){
  if(!OCdata.lineas.length)return<div><Alrt cls="warn">Sin líneas.</Alrt><button onClick={onBack} style={Btn()}>← Volver</button></div>;
  const upd=(i,field,val)=>{
    const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,[field]:parseInt(val)||0});
    const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);
  };
  const totCen=OCdata.lineas.reduce((s,l)=>s+(l.dc||0),0);
  const totSol=OCdata.lineas.reduce((s,l)=>s+(l.d1||0),0);
  const totVar=OCdata.lineas.reduce((s,l)=>s+(l.d3||0),0);
  const totOC =OCdata.lineas.reduce((s,l)=>s+l.cantOC,0);
  const totCosto=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||l.costoReal||0),0);

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:7,marginBottom:10}}>
        {[{l:'TOTAL OC',v:fn(totOC),c:C.txt},{l:'→ CENTRAL',v:fn(totCen),c:C.teal},{l:'→ SOLANO',v:fn(totSol),c:C.blue},{l:'→ VARELA',v:fn(totVar),c:C.green},{l:'TOTAL $',v:'$'+fn(totCosto),c:C.acc}].map(k=>(
          <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px',textAlign:'center'}}>
            <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:17,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{overflowX:'auto',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:10}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:900}}>
          <thead><tr>
            {['CÓD.','DESCRIPCIÓN','CANT.OC','PRECIO U.','SUBTOTAL','→CENTRAL','→SOLANO','→VARELA','→DP(AUTO)','DIFF'].map((h,i)=>(
              <th key={i} style={{fontSize:8,color:h==='→CENTRAL'?C.teal:h==='→SOLANO'?C.blue:h==='→VARELA'?C.green:h==='→DP(AUTO)'?C.vio:C.mut,padding:'5px 6px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.05em',textAlign:i>1?'right':'left'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const tot=(l.dc||0)+(l.d1||0)+(l.d3||0);
              const dp=Math.max(0,l.cantOC-tot);
              const diff=l.cantOC-tot;
              const precioU=l.precioDoc||l.costoReal||0;
              const td=(c,s)=><td style={{padding:'4px 6px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return<tr key={i} style={{background:l.esSobrante?'rgba(251,146,60,.04)':'transparent'}}>
                {td(l.cod,{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                {td(<span title={l.desc} style={{display:'block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}{l.esSobrante&&<span style={{color:C.ora,marginLeft:5}}>⚡</span>}</span>)}
                {td(l.cantOC,{textAlign:'right',fontWeight:500})}
                {td(fp(precioU),{textAlign:'right',color:C.mut})}
                {td(precioU>0?'$'+fn(l.cantOC*precioU):'—',{textAlign:'right',color:C.acc})}
                <td style={{textAlign:'right',padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumIn value={l.dc} onChange={v=>upd(i,'dc',v)} color={C.teal} width={58} onEnterFix={()=>{}} /></td>
                <td style={{textAlign:'right',padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumIn value={l.d1} onChange={v=>upd(i,'d1',v)} color={C.blue} width={58} onEnterFix={()=>{}} /></td>
                <td style={{textAlign:'right',padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}><NumIn value={l.d3} onChange={v=>upd(i,'d3',v)} color={C.green} width={58} onEnterFix={()=>{}} /></td>
                {td(dp>0?fn(dp):'—',{textAlign:'right',color:C.vio})}
                {td(<span style={{color:diff===0?C.green:diff>0?C.acc:C.red,fontWeight:600}}>{diff>0?'+':''}{diff}</span>,{textAlign:'right'})}
              </tr>;
            })}
            <tr style={{fontWeight:600}}>
              <td colSpan={5} style={{padding:'5px 6px',borderTop:`1px solid ${C.b1}`,fontSize:9,color:C.mut,textAlign:'right'}}>TOTAL</td>
              <td style={{padding:'5px 6px',textAlign:'right',borderTop:`1px solid ${C.b1}`,color:C.teal}}>{fn(totCen)}</td>
              <td style={{padding:'5px 6px',textAlign:'right',borderTop:`1px solid ${C.b1}`,color:C.blue}}>{fn(totSol)}</td>
              <td style={{padding:'5px 6px',textAlign:'right',borderTop:`1px solid ${C.b1}`,color:C.green}}>{fn(totVar)}</td>
              <td colSpan={2} style={{padding:'5px 6px',borderTop:`1px solid ${C.b1}`}}></td>
            </tr>
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

// ─── E4 CONFIRMAR ─────────────────────────────────────────────────────────────
function EtConfirmar({OCdata,saveOC,OCact,transicion,onBack}){
  const totUds=OCdata.lineas.reduce((s,l)=>s+l.cantOC,0);
  const totCosto=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);
  const noRec=OCdata.lineas.filter(l=>!l.reconocido).length;
  const yaVal=OCdata.meta.estado==='validada'||OCdata.meta.estado==='entregada'||OCdata.meta.estado==='recibida';
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
      <div style={{marginBottom:10,display:'flex',gap:12,alignItems:'center'}}>
        <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em'}}>FECHA ENTREGA EST.</div>
        <input type="date" value={OCdata.meta.fechaEntrega||''} onChange={e=>{const meta={...OCdata.meta,fechaEntrega:e.target.value};const d={...OCdata,meta};saveOC(OCact,d);}} style={{...IS,width:160}} />
      </div>
      {noRec>0&&<Alrt cls="err">⚠ {noRec} artículos no reconocidos — volvé a Validación</Alrt>}
      {/* Historial */}
      {(OCdata.meta.historial||[]).length>0&&(
        <div style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:10,marginBottom:10}}>
          <div style={{fontSize:9,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:6}}>HISTORIAL</div>
          {(OCdata.meta.historial||[]).map((h,i)=>{const cfg=ESTADOS[h.estado]||{color:C.mut,label:h.estado};return(
            <div key={i} style={{display:'flex',gap:10,alignItems:'center',marginBottom:4,fontSize:10}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:cfg.color,flexShrink:0,display:'inline-block'}}></span>
              <span style={{color:cfg.color,fontWeight:500,minWidth:80}}>{cfg.label}</span>
              <span style={{color:C.mut}}>{h.label}</span>
              {h.desdePrev>0&&<span style={{color:'#4b5563',fontSize:9}}>+{h.desdePrev} min</span>}
            </div>
          );})}
        </div>
      )}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
        <button onClick={onBack} style={Btn(C.mut)}>← Volver</button>
        {!yaVal&&<button onClick={()=>transicion(OCact,'validada',OCdata)} disabled={noRec>0}
          style={{background:noRec>0?C.b1:C.vio,color:noRec>0?C.mut:'#0c0e14',border:'none',borderRadius:4,padding:'7px 16px',fontSize:11,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:noRec>0?'not-allowed':'pointer'}}>
          ✓ OC Validada
        </button>}
        {yaVal&&<span style={{...bStyle('vio'),padding:'7px 14px'}}>✓ OC Validada</span>}
      </div>
    </div>
  );
}

// ─── MODAL ARTÍCULO NO RECONOCIDO ────────────────────────────────────────────
function ModalArt({modal,setModal,linea,db,codpIdx,onAsignar,onNuevo,OCprov}){
  if(!linea)return null;
  const prov=linea.prov||OCprov||'';
  const freq=getFreq(prov,db.art);
  const res=buscar(linea.desc,linea.codp||linea.cod,prov,modal.selFam,modal.selCat,modal.selMarca,modal.busqQ,db.art);
  const palabras=(linea.desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>2).slice(0,4).join(' · ');
  const f=modal.nuevoForm;
  const freq2=getFreq(f.prov||prov,db.art);
  const toggle=(field,val)=>setModal(m=>({...m,[field]:m[field]===val?'':val}));
  const nArt=Object.keys(db.art).length;

  return(
    <div style={{background:'rgba(0,0,0,.8)',padding:12,flexShrink:0}}>
      <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:6,overflow:'hidden',maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div style={{background:'rgba(240,192,64,.06)',borderBottom:'1px solid rgba(240,192,64,.2)',padding:'10px 14px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,flexShrink:0}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:C.acc}}>
              Código no reconocido: <span style={{color:C.blue}}>{linea.codp||linea.cod}</span>
              <span style={{fontSize:9,color:nArt>0?C.teal:C.red,marginLeft:10}}>{nArt>0?`${fn(nArt)} arts en DB`:'⚠ Sin DB — ↺ DB primero'}</span>
            </div>
            <div style={{fontSize:10,color:C.txt,marginTop:3}}>
              "{linea.desc}" · cant: <b>{linea.cantOC}</b>
              {linea.precioDoc>0&&<> · precio: <b>${fn(linea.precioDoc)}</b></>}
              {prov&&<> · proveedor: <b>{prov}</b></>}
            </div>
          </div>
          <button onClick={()=>setModal(m=>({...m,open:false}))} style={{background:'transparent',border:'none',color:C.mut,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:`1px solid ${C.b1}`,padding:'0 14px',flexShrink:0}}>
          {[{id:'buscar',label:'🔍 Buscar en base'},{id:'nuevo',label:'＋ Artículo nuevo'}].map(t=>(
            <span key={t.id} onClick={()=>setModal(m=>({...m,tab:t.id}))}
              style={{padding:'7px 14px',fontSize:10,color:modal.tab===t.id?C.acc:C.mut,cursor:'pointer',borderBottom:modal.tab===t.id?`2px solid ${C.acc}`:'2px solid transparent'}}>
              {t.label}
            </span>
          ))}
        </div>

        {modal.tab==='buscar'&&(
          <div style={{display:'flex',flexDirection:'column',overflow:'hidden',flex:1}}>
            <div style={{padding:'10px 14px',flexShrink:0}}>
              <div style={{marginBottom:7}}>
                <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>BÚSQUEDA MANUAL</div>
                <input placeholder="Código, descripción, marca..." value={modal.busqQ}
                  onChange={e=>setModal(m=>({...m,busqQ:e.target.value}))}
                  style={{...IS,fontSize:11}} autoFocus />
              </div>
              <div style={{fontSize:9,color:C.mut,marginBottom:7,display:'flex',gap:10,flexWrap:'wrap'}}>
                <span>Palabras buscadas: <span style={{color:C.blue}}>{palabras||'—'}</span></span>
                <span style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{width:8,height:8,background:C.acc,borderRadius:1,display:'inline-block'}}></span>código prov.
                  <span style={{width:8,height:8,background:C.blue,borderRadius:1,display:'inline-block',marginLeft:6}}></span>descripción
                </span>
                {prov&&<span style={{color:C.mut}}>Proveedor: <b style={{color:C.teal}}>{prov}</b></span>}
              </div>
              {freq.fams.length>0&&<div style={{marginBottom:5}}><div style={{fontSize:8,color:C.mut,marginBottom:2,textTransform:'uppercase',letterSpacing:'.06em'}}>FAMILIA</div><div>{freq.fams.map(f=><span key={f} onClick={()=>toggle('selFam',f)} style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,border:`1px solid ${modal.selFam===f?C.acc:C.b1}`,cursor:'pointer',margin:'1px 2px',background:modal.selFam===f?'rgba(240,192,64,.15)':'transparent',color:modal.selFam===f?C.acc:C.txt}}>{f}</span>)}</div></div>}
              {freq.cats.length>0&&<div style={{marginBottom:5}}><div style={{fontSize:8,color:C.mut,marginBottom:2,textTransform:'uppercase',letterSpacing:'.06em'}}>CATEGORÍA</div><div>{freq.cats.map(c=><span key={c} onClick={()=>toggle('selCat',c)} style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,border:`1px solid ${modal.selCat===c?C.acc:C.b1}`,cursor:'pointer',margin:'1px 2px',background:modal.selCat===c?'rgba(240,192,64,.15)':'transparent',color:modal.selCat===c?C.acc:C.txt}}>{c}</span>)}</div></div>}
              {freq.marcas.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:8,color:C.mut,marginBottom:2,textTransform:'uppercase',letterSpacing:'.06em'}}>MARCA</div><div>{freq.marcas.map(m=><span key={m} onClick={()=>toggle('selMarca',m)} style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:3,fontSize:9,border:`1px solid ${modal.selMarca===m?C.acc:C.b1}`,cursor:'pointer',margin:'1px 2px',background:modal.selMarca===m?'rgba(240,192,64,.15)':'transparent',color:modal.selMarca===m?C.acc:C.txt}}>{m}</span>)}</div></div>}
              <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em'}}>{res.length} ARTÍCULOS — click para asignar</div>
            </div>
            <div style={{flex:1,overflowY:'auto',borderTop:`1px solid ${C.b1}`}}>
              {nArt===0&&<div style={{padding:16,textAlign:'center',color:C.red,fontSize:11}}>⚠ Base vacía — hacé ↺ DB y recargá el FormatoProveedores en Stock+</div>}
              {nArt>0&&res.length===0&&<div style={{padding:16,textAlign:'center',color:C.mut,fontSize:11}}>Sin resultados · probá con otras palabras o filtros</div>}
              {res.map(({cod,a,type})=>(
                <div key={cod} onClick={()=>onAsignar(modal.idx,cod)}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',cursor:'pointer',borderBottom:`1px solid ${C.b2}`,borderLeft:`3px solid ${type==='prim'?C.acc:type==='sec'?C.blue:C.b1}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,color:C.txt,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.desc}</div>
                    <div style={{fontSize:9,color:C.mut,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                      <span style={{color:C.blue}}>{cod}</span>
                      <span>codp: <span style={{color:C.acc}}>{a.codp||'—'}</span></span>
                      <span style={{color:C.teal}}>{a.prov||'—'}</span>
                      <span>{a.fam||'—'}</span>
                      {a.costoReal>0&&<span style={{color:C.acc}}>CR: ${fn(a.costoReal)}</span>}
                      {a.pvMin>0&&<span style={{color:C.vio}}>PVMin: ${fn(a.pvMin)}</span>}
                    </div>
                  </div>
                  {type==='prim'&&<span style={{...bStyle('warn'),fontSize:8}}>cód.prov</span>}
                  {type==='sec'&&<span style={{...bStyle('info'),fontSize:8}}>desc.</span>}
                </div>
              ))}
            </div>
            <div style={{padding:'8px 14px',borderTop:`1px solid ${C.b1}`,display:'flex',gap:6,flexShrink:0}}>
              <button onClick={()=>setModal(m=>({...m,open:false}))} style={Btn(C.mut)}>Omitir</button>
              <button onClick={()=>setModal(m=>({...m,tab:'nuevo'}))} style={{...Btn(C.vio,'rgba(192,132,252,.08)')}}>＋ No existe — crear nuevo</button>
            </div>
          </div>
        )}

        {modal.tab==='nuevo'&&(
          <div style={{padding:14,overflow:'auto',flex:1}}>
            <Alrt cls="info">La base es de solo lectura. El artículo se agrega a la lista de importación al sistema. También se puede agregar como nueva línea de proveedor si ya existe el artículo con otro proveedor.</Alrt>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
              {[['CÓDIGO INTERNO *','cod'],['CÓD. PROVEEDOR','codp'],['PROVEEDOR A COMPRAR','prov']].map(([lbl,field])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:C.mut,letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <input value={f[field]||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:e.target.value}}))} style={IS} />
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
              <button onClick={()=>setModal(m=>({...m,tab:'buscar'}))} style={{...Btn(C.mut),marginLeft:'auto'}}>← Volver a buscar</button>
              <button onClick={onNuevo} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'6px 14px',fontSize:11,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>＋ Agregar a importación</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
