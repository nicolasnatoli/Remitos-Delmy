// ===== MÓDULO COMPRAS + RECEPCIÓN V2 =====
import React, { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fn   = n => Number(n||0).toLocaleString('es-AR');
const fp   = n => n>0 ? '$'+Number(n).toLocaleString('es-AR',{maximumFractionDigits:0}) : '—';
const fpct = n => (n>=0?'+':'')+n.toFixed(1)+'%';
const escH = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const tryGet=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}};
const trySet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SK={
  art:'dm_art_v3', stk:'dm_stk_v3',
  vs:'dm_vs_v3',vq:'dm_vq_v3',vm:'dm_vm_v3',vh:'dm_vh_v3',
  plan:'dm_plan_v3',share:'dm_share_v3',
  ocs:'dm_ocs_v3', rec:'dm_rec_v3', nuevosArt:'dm_nuevos_art',
};

// ─── Expandir formatos compactos ──────────────────────────────────────────────
const expandArt =c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split('|');o[k]={prov:p[0]||'',codp:p[1]||'',desc:p[2]||'',fam:p[3]||'',cat:p[4]||'',marca:p[5]||'',costoReal:+p[6]||0,pvMin:+p[7]||0,mostrador:+p[8]||0};}return o;};
const expandStk =c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={DM01:+p[0]||0,DM03:+p[1]||0,DMCN:+p[2]||0};}return o;};
const expandVent=s=>{if(!s||typeof s!=='string')return{};const o={};s.replace(/^"|"$/g,'').split('|').forEach(p=>{const i=p.lastIndexOf(':');if(i>0)o[p.slice(0,i)]=+p.slice(i+1)||0;});return o;};
const expandPlan=c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split(',');o[k]={ac:+p[0]||0,d1:+p[1]||0,d3:+p[2]||0,dc:+p[3]||0};}return o;};

function loadDB(){
  const artC=tryGet(SK.art,null);const art=artC?expandArt(artC):{};
  const stkC=tryGet(SK.stk,null);const stk=stkC?expandStk(stkC):{};
  const vs=expandVent(localStorage.getItem(SK.vs)||'');
  const vq=expandVent(localStorage.getItem(SK.vq)||'');
  const vm=expandVent(localStorage.getItem(SK.vm)||'');
  const vh=expandVent(localStorage.getItem(SK.vh)||'');
  const sh=tryGet(SK.share,null);const planC=sh?.planC||tryGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  return{art,stk,vs,vq,vm,vh,plan};
}

// ─── Cruce de códigos ─────────────────────────────────────────────────────────
function buildCodpIdx(art){
  const idx={};
  for(const[cod,a]of Object.entries(art)){
    const cp=String(a.codp||'').trim();
    if(cp){if(!idx[cp])idx[cp]=[];idx[cp].push(cod);}
  }
  return idx;
}

function cruzarCodigo(codExt,art,idx){
  const cod=String(codExt||'').trim();if(!cod)return null;
  if(idx[cod]?.length)return idx[cod][0];
  const sc=cod.replace(/^0+/,'');
  if(idx[sc]?.length)return idx[sc][0];
  for(const[cp,cods]of Object.entries(idx)){if(cp.includes(cod)||cod.includes(cp))return cods[0];}
  if(art[cod])return cod;
  return null;
}

// ─── Búsqueda por palabras ────────────────────────────────────────────────────
function buscarPorPalabras(desc,codDoc,prov,famF,catF,marcaF,q,art){
  const words=(desc||'').toLowerCase().split(/\s+/).filter(Boolean).slice(0,3);
  const codLow=String(codDoc||'').toLowerCase().replace(/^0+/,'');
  const qLow=(q||'').toLowerCase().trim();
  const results=[];
  for(const[cod,a]of Object.entries(art)){
    const hay=(a.desc||'').toLowerCase();
    const codpLow=String(a.codp||'').toLowerCase().replace(/^0+/,'');
    if(famF&&(a.fam||'')!==famF)continue;
    if(catF&&(a.cat||'')!==catF)continue;
    if(marcaF&&(a.marca||'')!==marcaF)continue;
    let score=0;let type='other';
    if(codLow&&(codpLow===codLow||codpLow.includes(codLow)||codLow.includes(codpLow))){score+=20;type='prim';}
    const wm=words.filter(w=>hay.includes(w)).length;
    if(wm>0){score+=wm*8;if(type==='other')type='sec';}
    if(qLow&&(hay.includes(qLow)||cod.toLowerCase().includes(qLow)||codpLow.includes(qLow))){score+=15;if(type==='other')type='sec';}
    const esProv=prov&&(a.prov||'').toLowerCase()===prov.toLowerCase();
    if(esProv)score+=6;
    if(score>0)results.push({cod,a,score,type,esProv});
  }
  results.sort((a,b)=>{const o={prim:0,sec:1,other:2};if(o[a.type]!==o[b.type])return o[a.type]-o[b.type];return b.score-a.score;});
  return results.slice(0,30);
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
function calcDiff(costoReal,precioDoc){if(!costoReal||!precioDoc)return null;return((precioDoc-costoReal)/costoReal)*100;}
function priceLabel(diff){
  if(diff===null)return{cls:'mut',text:'S/PRECIO'};
  if(Math.abs(diff)<0.01)return{cls:'ok',text:'✓ IGUAL'};
  if(diff>0)return{cls:'err',text:'↑ '+fpct(diff)};
  return{cls:'ok',text:'↓ '+fpct(Math.abs(diff))};
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const badge=(cls)=>({display:'inline-flex',alignItems:'center',padding:'1px 7px',borderRadius:3,fontSize:9,fontWeight:500,whiteSpace:'nowrap',...{
  ok:  {background:'rgba(74,222,128,.12)', color:'#4ade80',border:'1px solid rgba(74,222,128,.3)'},
  warn:{background:'rgba(240,192,64,.12)',color:'#f0c040',border:'1px solid rgba(240,192,64,.3)'},
  err: {background:'rgba(248,113,113,.12)',color:'#f87171',border:'1px solid rgba(248,113,113,.3)'},
  info:{background:'rgba(96,165,250,.12)',color:'#60a5fa',border:'1px solid rgba(96,165,250,.3)'},
  vio: {background:'rgba(192,132,252,.12)',color:'#c084fc',border:'1px solid rgba(192,132,252,.3)'},
  mut: {background:'rgba(107,114,128,.12)',color:'#6b7280',border:'1px solid rgba(107,114,128,.3)'},
  teal:{background:'rgba(45,212,191,.12)', color:'#2dd4bf',border:'1px solid rgba(45,212,191,.3)'},
}[cls]||{}});

const alert_=(cls,children)=>{
  const s={ok:{background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',color:'#4ade80'},warn:{background:'rgba(240,192,64,.08)',border:'1px solid rgba(240,192,64,.2)',color:'#f0c040'},err:{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',color:'#f87171'},info:{background:'rgba(96,165,250,.08)',border:'1px solid rgba(96,165,250,.2)',color:'#60a5fa'}}[cls]||{};
  return <div style={{borderRadius:4,padding:'7px 11px',fontSize:10,marginBottom:7,...s}}>{children}</div>;
};

const inputStyle={background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:4,fontFamily:'DM Mono,monospace',fontSize:11,padding:'4px 8px',outline:'none',width:'100%'};
const btnStyle=(col,bg)=>({cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'5px 11px',border:`1px solid ${col||'#1e2133'}`,background:bg||'transparent',color:col||'#e8eaf0',whiteSpace:'nowrap'});

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function ModuloCompras() {
  const [tabC, setTabC]   = useState('compras');
  const [db,   setDb]     = useState(loadDB);
  const [OCS,  setOCS]    = useState(()=>tryGet(SK.ocs,[]));
  const [OCact,setOCact]  = useState(()=>{const l=tryGet(SK.ocs,[]);return l.length?l[l.length-1]:null;});
  const [OCdata,setOCdata]= useState(()=>{
    const l=tryGet(SK.ocs,[]);if(!l.length)return{meta:{},lineas:[]};
    const d=tryGet('dm_oc_v3_'+l[l.length-1],null);return d?{meta:d.meta||{},lineas:d.lineas||[]}:{meta:{},lineas:[]};
  });
  const [RECdata,setRECdata]=useState(()=>{const d=tryGet(SK.rec,null);return d?{meta:d.meta||{},lineas:d.lineas||[]}:{meta:{},lineas:[]};});
  const [etC, setEtC]     = useState('carga');
  const [etR, setEtR]     = useState('carga');

  // Modal estado
  const [modal, setModal] = useState({open:false,idx:0,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',nuevoForm:{cod:'',desc:'',codp:'',prov:'',fam:'',cat:'',marca:'',costoReal:0,pvMin:0,mostrador:0}});

  const codpIdx = useMemo(()=>buildCodpIdx(db.art),[db.art]);

  const reloadDB = ()=>setDb(loadDB());

  // ─── Guardar OC ───────────────────────────────────────────────────────────
  const saveOC = useCallback((oc,data)=>{
    let id=oc;
    if(!id){id='oc_'+Date.now();}
    setOCS(prev=>{const next=prev.includes(id)?prev:[...prev,id];trySet(SK.ocs,next);return next;});
    setOCact(id);
    trySet('dm_oc_v3_'+id,{meta:data.meta,lineas:data.lineas});
    return id;
  },[]);

  const saveRec = useCallback((data)=>{trySet(SK.rec,{meta:data.meta,lineas:data.lineas});},[]);

  // ─── Importar desde Stock ─────────────────────────────────────────────────
  const importarDesdeStock = useCallback(()=>{
    const sh=tryGet(SK.share,null);const planC=sh?.planC||tryGet(SK.plan,null);
    if(!planC){alert('Sin planilla. En Stock+: completá "A Comprar" y presioná "→ Compras".');return;}
    const plan=expandPlan(planC);
    const lineas=[];
    for(const[cod,p]of Object.entries(plan)){
      if(!p.ac)continue;
      const a=db.art[cod]||{desc:'',codp:'',prov:'',fam:'',costoReal:0,pvMin:0,mostrador:0};
      const s=db.stk[cod]||{DM01:0,DM03:0,DMCN:0};
      lineas.push({cod,desc:a.desc,codp:a.codp,prov:a.prov,fam:a.fam,cantOC:p.ac,dc:p.dc||0,d1:p.d1||0,d3:p.d3||0,costoReal:a.costoReal||0,pvMin:a.pvMin||0,mostrador:a.mostrador||0,precioDoc:0,stkDMCN:s.DMCN,stkDM01:s.DM01,stkDM03:s.DM03,vs:db.vs[cod]||0,vq:db.vq[cod]||0,vm:db.vm[cod]||0,reconocido:true,aprobado:false,rechazado:false});
    }
    if(!lineas.length){alert('Sin artículos con cantidad.');return;}
    const prov=lineas.find(l=>l.prov)?.prov||'';
    const id='oc_'+Date.now();
    const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Stock+'},lineas};
    setOCdata(data);saveOC(id,data);setEtC('validacion');
  },[db,saveOC]);

  // ─── Importar planilla Excel ──────────────────────────────────────────────
  const importarPlanillaXLSX = useCallback(async(file)=>{
    if(!file)return;
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    const hdrs=raw[0].map(h=>String(h||'').toLowerCase().trim());
    const fi=name=>hdrs.findIndex(h=>h.includes(name));
    const iCod=Math.max(0,fi('código'));const iAC=fi('comprar');
    const iD1=fi('solano')>=0?fi('solano'):fi('dm01');
    const iD3=fi('varela')>=0?fi('varela'):fi('dm03');
    const iDC=fi('central')>=0?fi('central'):fi('dmcn');
    const lineas=[];
    for(let i=1;i<raw.length;i++){
      const r=raw[i];const cod=String(r[iCod>=0?iCod:0]||'').trim();
      if(!cod||cod.toLowerCase()==='totales')continue;
      const ac=parseFloat(String(r[iAC>=0?iAC:10]||'0'))||0;if(!ac)continue;
      const a=db.art[cod]||{desc:'',codp:'',prov:'',fam:'',costoReal:0,pvMin:0,mostrador:0};
      const s=db.stk[cod]||{DM01:0,DM03:0,DMCN:0};
      lineas.push({cod,desc:a.desc,codp:a.codp,prov:a.prov,fam:a.fam,cantOC:ac,dc:parseFloat(r[iDC>=0?iDC:13])||0,d1:parseFloat(r[iD1>=0?iD1:11])||0,d3:parseFloat(r[iD3>=0?iD3:12])||0,costoReal:a.costoReal||0,pvMin:a.pvMin||0,mostrador:a.mostrador||0,precioDoc:0,stkDMCN:s.DMCN,stkDM01:s.DM01,stkDM03:s.DM03,vs:db.vs[cod]||0,vq:db.vq[cod]||0,vm:db.vm[cod]||0,reconocido:true,aprobado:false,rechazado:false});
    }
    if(!lineas.length){alert('Sin artículos con cantidad en la planilla');return;}
    const prov=lineas.find(l=>l.prov)?.prov||'';
    const id='oc_'+Date.now();
    const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Planilla: '+file.name},lineas};
    setOCdata(data);saveOC(id,data);setEtC('validacion');
  },[db,saveOC]);

  // ─── Aplicar líneas de documento ─────────────────────────────────────────
  const aplicarLineasDocumento = useCallback((lineas,modo)=>{
    if(!lineas.length)return;
    if(modo==='oc'){
      if(OCdata.lineas.length){
        // Cruzar con OC existente: actualizar precioDoc
        setOCdata(prev=>{
          const updated={...prev,lineas:prev.lineas.map(l=>{
            const match=lineas.find(dl=>{
              const codI=cruzarCodigo(dl.cod,db.art,codpIdx);
              return dl.cod===l.codp||dl.cod===l.cod||(codI&&codI===l.cod);
            });
            if(match)return{...l,precioDoc:match.precio||0};
            return l;
          })};
          saveOC(OCact,updated);return updated;
        });
      } else {
        // Crear OC desde documento
        const nuevas=lineas.map(dl=>{
          const codI=cruzarCodigo(dl.cod,db.art,codpIdx);
          const art=codI?db.art[codI]:null;
          const stk=codI?db.stk[codI]||{DM01:0,DM03:0,DMCN:0}:{DM01:0,DM03:0,DMCN:0};
          return{cod:codI||dl.cod,codp:dl.cod,desc:art?.desc||dl.desc||'',prov:art?.prov||'',fam:art?.fam||'',cantOC:dl.cant||0,dc:0,d1:0,d3:0,costoReal:art?.costoReal||0,pvMin:art?.pvMin||0,mostrador:art?.mostrador||0,precioDoc:dl.precio||0,stkDMCN:stk.DMCN,stkDM01:stk.DM01,stkDM03:stk.DM03,vs:codI?db.vs[codI]||0:0,vq:codI?db.vq[codI]||0:0,vm:codI?db.vm[codI]||0:0,reconocido:!!codI,aprobado:false,rechazado:false};
        });
        const prov=nuevas.find(l=>l.prov)?.prov||'';
        const id='oc_'+Date.now();
        const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:'',origen:'Del documento'},lineas:nuevas};
        setOCdata(data);saveOC(id,data);
      }
      setEtC('validacion');
    } else {
      // Recepción
      if(RECdata.lineas.length){
        setRECdata(prev=>{
          const updated={...prev,lineas:prev.lineas.map(l=>{
            const match=lineas.find(dl=>{const codI=cruzarCodigo(dl.cod,db.art,codpIdx);return dl.cod===l.codp||dl.cod===l.cod||(codI&&codI===l.cod);});
            if(match)return{...l,cantRemito:match.cant||l.cantRemito};
            return l;
          })};
          saveRec(updated);return updated;
        });
      } else {
        const nuevas=lineas.map(dl=>{const codI=cruzarCodigo(dl.cod,db.art,codpIdx);const art=codI?db.art[codI]:null;return{cod:codI||dl.cod,codp:dl.cod,desc:art?.desc||dl.desc||'',cantOC:0,cantRemito:dl.cant||0,cantRec:null,diff:null,ub:'',ok:null};});
        const data={meta:{proveedor:'',documento:'',fecha:new Date().toISOString().slice(0,10)},lineas:nuevas};
        setRECdata(data);saveRec(data);
      }
      setEtR('control');
    }
  },[OCdata.lineas,RECdata.lineas,OCact,db,codpIdx,saveOC,saveRec]);

  // ─── Procesar Excel de factura/remito ─────────────────────────────────────
  const procesarExcel = useCallback(async(file,modo)=>{
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    let hRow=0;
    for(let i=0;i<Math.min(raw.length,15);i++){if(raw[i].some(c=>/c[oó]d|artículo|descrip/i.test(String(c||'')))){hRow=i;break;}}
    const hdrs=raw[hRow].map(h=>String(h||'').toLowerCase().trim());
    const iCod=Math.max(0,hdrs.findIndex(h=>/c[oó]d/.test(h)));
    const iDesc=Math.max(1,hdrs.findIndex(h=>h.includes('descrip')));
    const iCant=Math.max(2,hdrs.findIndex(h=>h.includes('cant')));
    const iPrecio=hdrs.findIndex(h=>/prec|cost/.test(h));
    const lineas=[];
    for(let i=hRow+1;i<raw.length;i++){
      const r=raw[i];const cod=String(r[iCod]||'').trim();if(!cod||cod.length<2)continue;
      lineas.push({cod,desc:String(r[iDesc]||'').trim(),cant:parseFloat(String(r[iCant]||'0').replace(',','.'))||0,precio:parseFloat(String(r[iPrecio>=0?iPrecio:3]||'0').replace(',','.'))||0});
    }
    aplicarLineasDocumento(lineas,modo);
  },[aplicarLineasDocumento]);

  // ─── Modal: asignar artículo ──────────────────────────────────────────────
  const asignarArticulo = useCallback((idx,cod)=>{
    const art=db.art[cod];if(!art)return;
    setOCdata(prev=>{
      const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,cod,codp:art.codp||l.codp,descBase:art.desc,prov:art.prov||'',fam:art.fam||'',costoReal:art.costoReal||0,pvMin:art.pvMin||0,mostrador:art.mostrador||0,reconocido:true});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[db.art,OCact,saveOC]);

  // ─── Modal: agregar artículo nuevo ────────────────────────────────────────
  const confirmarNuevoArticulo = useCallback(()=>{
    const f=modal.nuevoForm;const l=OCdata.lineas[modal.idx];
    if(!f.cod){alert('El código interno es obligatorio');return;}
    const nuevo={prov:f.prov||l?.prov||'',codp:f.codp||l?.codp||'',desc:f.desc||l?.desc||'',fam:f.fam||'',cat:f.cat||'',marca:f.marca||'',costoReal:f.costoReal||0,pvMin:f.pvMin||0,mostrador:f.mostrador||0};
    // Base de artículos es readonly — solo acumular en lista de nuevos para exportar
    const nuevos=tryGet(SK.nuevosArt,[]);
    nuevos.push({cod:f.cod,...nuevo,fechaAlta:new Date().toISOString()});
    trySet(SK.nuevosArt,nuevos);
    // Asignar a la línea de la OC
    setOCdata(prev=>{
      const lineas=prev.lineas.map((li,i)=>i!==modal.idx?li:{...li,cod:f.cod,descBase:nuevo.desc,costoReal:nuevo.costoReal,pvMin:nuevo.pvMin,mostrador:nuevo.mostrador,prov:nuevo.prov,fam:nuevo.fam,reconocido:true,codI:f.cod});
      const updated={...prev,lineas};saveOC(OCact,updated);return updated;
    });
    setModal(m=>({...m,open:false}));
  },[modal,OCdata.lineas,OCact,saveOC]);

  // ─── Exportar OC ──────────────────────────────────────────────────────────
  const exportarOC = useCallback(()=>{
    if(!OCdata.lineas.length)return;
    const rows=[['Código','Cód.Prov','Descripción','Familia','Cant.OC','Precio Doc.','Costo Real','PV Mín.','Mostrador','Total','→Central','→Solano','→Varela','→DP']];
    OCdata.lineas.forEach(l=>{const dp=Math.max(0,l.cantOC-(l.dc||0)-(l.d1||0)-(l.d3||0));rows.push([l.cod,l.codp,l.desc,l.fam,l.cantOC,l.precioDoc||0,l.costoReal||0,l.pvMin||0,l.mostrador||0,l.cantOC*(l.precioDoc||0),l.dc||0,l.d1||0,l.d3||0,dp]);});
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'OC');
    XLSX.writeFile(wb,`OC_${OCdata.meta.proveedor||'SinProv'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  },[OCdata]);

  // ─── Nueva OC ─────────────────────────────────────────────────────────────
  const nuevaOC = useCallback(()=>{
    const id='oc_'+Date.now();
    const data={meta:{proveedor:'',fecha:new Date().toISOString().slice(0,10),documento:''},lineas:[]};
    setOCdata(data);setOCS(prev=>{const n=[...prev,id];trySet(SK.ocs,n);return n;});
    setOCact(id);trySet('dm_oc_v3_'+id,data);setEtC('carga');
  },[]);

  const selectOC = useCallback((id)=>{
    setOCact(id);const d=tryGet('dm_oc_v3_'+id,null);
    if(d){setOCdata({meta:d.meta||{},lineas:d.lineas||[]});}setEtC('validacion');
  },[]);

  const deleteOC = useCallback((id)=>{
    if(!window.confirm('¿Eliminar OC?'))return;
    setOCS(prev=>{const n=prev.filter(x=>x!==id);trySet(SK.ocs,n);return n;});
    try{localStorage.removeItem('dm_oc_v3_'+id);}catch{}
    if(OCact===id){setOCact(null);setOCdata({meta:{},lineas:[]});}
  },[OCact]);

  // ─── Confirmar OC → pasa a Recepción ──────────────────────────────────────
  const confirmarOC = useCallback(()=>{
    const data={meta:{...OCdata.meta,confirmada:new Date().toISOString()},lineas:OCdata.lineas};
    saveOC(OCact,data);setOCdata(data);
    if(!RECdata.lineas.length){
      const recData={meta:{proveedor:OCdata.meta.proveedor,documento:'',fecha:new Date().toISOString().slice(0,10)},lineas:OCdata.lineas.map(l=>({cod:l.cod,desc:l.desc,codp:l.codp,cantOC:l.cantOC,cantRemito:l.cantOC,cantRec:null,diff:null,ub:'',ok:null}))};
      setRECdata(recData);saveRec(recData);
    }
    setTabC('recepcion');setEtR('carga');
  },[OCdata,OCact,RECdata.lineas,saveOC,saveRec]);

  // ─── Recepción: controlar cantidad ────────────────────────────────────────
  const updRec = useCallback((idx,val)=>{
    const v=parseFloat(val)||0;
    setRECdata(prev=>{
      const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,cantRec:v,diff:v-(l.cantRemito||0),ok:v>=(l.cantRemito||0)});
      const updated={...prev,lineas};saveRec(updated);return updated;
    });
  },[saveRec]);

  // ─── Imprimir recepción ────────────────────────────────────────────────────
  const imprimirRecepcion = useCallback(()=>{
    const w=window.open('','_blank');
    const tot=RECdata.lineas.reduce((s,l)=>s+(l.cantRec||0),0);
    w.document.write(`<html><head><title>Recepción</title><style>body{font-family:Arial,sans-serif;font-size:10px;margin:20px}h1{font-size:14px}table{width:100%;border-collapse:collapse}th{background:#111;color:white;padding:5px 7px;font-size:9px}td{padding:4px 7px;border-bottom:1px solid #ddd;font-size:10px}.r{text-align:right}.red{color:#c00}.firma{display:flex;gap:60px;margin-top:40px}.fi{text-align:center;border-top:1px solid #333;padding-top:5px;width:140px;font-size:9px}</style></head><body>
<h1>DELMY PARTY SRL — REGISTRO DE RECEPCIÓN</h1>
<p><b>Proveedor:</b> ${escH(RECdata.meta.proveedor||'—')} | <b>Remito:</b> ${escH(RECdata.meta.documento||'—')} | <b>Fecha:</b> ${escH(RECdata.meta.fecha||'—')}</p>
<table><thead><tr><th>#</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th class="r">OC</th><th class="r">REMITO</th><th class="r">RECIBIDA</th><th class="r">DIFF</th><th>UBICACIÓN</th></tr></thead><tbody>
${RECdata.lineas.map((l,i)=>`<tr><td>${i+1}</td><td>${escH(l.cod)}</td><td>${escH(l.desc)}</td><td class="r">${l.cantOC||'—'}</td><td class="r">${l.cantRemito||'—'}</td><td class="r" ${l.cantRec<l.cantRemito?'class="red"':''}>${l.cantRec??'—'}</td><td class="r" ${l.diff<0?'class="red"':''}>${l.diff!==null?(l.diff>0?'+':'')+l.diff:'—'}</td><td>${escH(l.ub||'')}</td></tr>`).join('')}
</tbody></table>
<p><b>Total recibido:</b> ${tot} uds</p>
${RECdata.meta.obs?`<p><b>Obs:</b> ${escH(RECdata.meta.obs)}</p>`:''}
<div class="firma"><div class="fi">Recibido por<br><br>Firma</div><div class="fi">Verificado por<br><br>Firma</div><div class="fi">Autorizado por<br><br>Firma</div></div>
</body></html>`);w.document.close();w.print();
  },[RECdata]);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:'#0c0e14'}}>

      {/* Tabs Compras / Recepción */}
      <div style={{background:'#0d0f1a',borderBottom:'1px solid #1e2133',display:'flex',padding:'0 16px',flexShrink:0}}>
        {[{id:'compras',label:'🛒 COMPRAS'},{id:'recepcion',label:'📥 RECEPCIÓN'}].map(t=>(
          <button key={t.id} onClick={()=>setTabC(t.id)} style={{background:'transparent',color:tabC===t.id?'#f0c040':'#6b7280',borderBottom:tabC===t.id?'2px solid #f0c040':'2px solid transparent',borderTop:'none',borderLeft:'none',borderRight:'none',padding:'11px 16px',fontSize:10,letterSpacing:'.07em',fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
            {t.label}
          </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:7}}>
          {tabC==='compras'&&<>
            <button onClick={reloadDB}          style={btnStyle('#6b7280')}>↺ Recargar DB</button>
            <button onClick={importarDesdeStock} style={btnStyle('#f0c040','rgba(240,192,64,.08)')}>← Stock+</button>
            <button onClick={exportarOC}        style={btnStyle('#2dd4bf','rgba(45,212,191,.08)')}>↓ Excel OC</button>
          </>}
          {tabC==='compras'&&<span style={{fontSize:9,color:'#6b7280'}}>{Object.keys(db.art).length} art. en DB</span>}
        </div>
      </div>

      {/* Modal artículos no reconocidos */}
      {modal.open && <ModalArticulo modal={modal} setModal={setModal} linea={OCdata.lineas[modal.idx]} db={db} codpIdx={codpIdx} onAsignar={asignarArticulo} onNuevo={confirmarNuevoArticulo} />}

      {/* Contenido */}
      <div style={{flex:1,overflow:'auto',padding:14}}>
        {tabC==='compras' ? (
          <ComprasContent
            OCS={OCS} OCact={OCact} OCdata={OCdata} setOCdata={setOCdata}
            etC={etC} setEtC={setEtC} db={db} codpIdx={codpIdx}
            nuevaOC={nuevaOC} selectOC={selectOC} deleteOC={deleteOC}
            importarDesdeStock={importarDesdeStock}
            importarPlanillaXLSX={importarPlanillaXLSX}
            procesarExcel={procesarExcel}
            aplicarLineasDocumento={aplicarLineasDocumento}
            saveOC={saveOC} OCact_={OCact}
            confirmarOC={confirmarOC}
            modal={modal} setModal={setModal}
          />
        ) : (
          <RecepcionContent
            OCdata={OCdata} RECdata={RECdata} setRECdata={setRECdata}
            etR={etR} setEtR={setEtR} updRec={updRec} saveRec={saveRec}
            procesarExcel={procesarExcel} aplicarLineasDocumento={aplicarLineasDocumento}
            imprimirRecepcion={imprimirRecepcion}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{background:'#0d0f1a',borderTop:'1px solid #1e2133',padding:'5px 14px',display:'flex',gap:10,alignItems:'center',flexShrink:0}}>
        {tabC==='compras'
          ? <><span style={{fontSize:9,color:'#6b7280'}}>{OCdata.lineas.length} líneas · {OCS.length} OC(s)</span><span style={{fontSize:10,color:'#f0c040'}}>{(()=>{const t=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);return t>0?'Total: $'+fn(t):''})()}</span></>
          : <><span style={{fontSize:9,color:'#6b7280'}}>{RECdata.lineas.length} líneas</span>{RECdata.lineas.filter(l=>l.ok===false).length>0&&<span style={{fontSize:10,color:'#f87171'}}>{RECdata.lineas.filter(l=>l.ok===false).length} faltantes</span>}</>
        }
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
  const palabras=(linea.desc||'').toLowerCase().split(/\s+/).slice(0,3).join(' · ');
  const f=modal.nuevoForm;
  const freq2=getFreq(f.prov||linea.prov,db.art);

  const toggle=(field,val)=>setModal(m=>({...m,[field]:m[field]===val?'':val}));

  return(
    <div style={{background:'rgba(0,0,0,.75)',padding:12,marginBottom:0,flexShrink:0}}>
      <div style={{background:'#111420',border:'1px solid #1e2133',borderRadius:6,overflow:'hidden'}}>
        {/* Header */}
        <div style={{background:'rgba(240,192,64,.06)',borderBottom:'1px solid rgba(240,192,64,.2)',padding:'10px 14px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:'#f0c040'}}>Código no reconocido: <span style={{color:'#60a5fa'}}>{linea.codp||linea.cod}</span></div>
            <div style={{fontSize:10,color:'#e8eaf0',marginTop:3}}>Factura: "{escH(linea.desc)}" · cant: <b>{linea.cantOC}</b> · precio: <b>${fn(linea.precioDoc)}</b></div>
          </div>
          <button onClick={()=>setModal(m=>({...m,open:false}))} style={{background:'transparent',border:'none',color:'#6b7280',fontSize:16,cursor:'pointer'}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #1e2133',padding:'0 14px'}}>
          {[{id:'buscar',label:'🔍 Buscar en base'},{id:'nuevo',label:'＋ Artículo nuevo'}].map(t=>(
            <span key={t.id} onClick={()=>setModal(m=>({...m,tab:t.id}))}
              style={{padding:'7px 14px',fontSize:10,color:modal.tab===t.id?'#f0c040':'#6b7280',cursor:'pointer',borderBottom:modal.tab===t.id?'2px solid #f0c040':'2px solid transparent'}}>
              {t.label}
            </span>
          ))}
        </div>

        {modal.tab==='buscar'&&(
          <>
            <div style={{padding:'10px 14px'}}>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:'#6b7280',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:3}}>BÚSQUEDA MANUAL</div>
                <input placeholder="Código, descripción, marca..." value={modal.busqQ} onChange={e=>setModal(m=>({...m,busqQ:e.target.value}))}
                  style={{...inputStyle,fontSize:11}} />
              </div>
              <div style={{fontSize:9,color:'#6b7280',marginBottom:8}}>
                3 palabras buscadas: <span style={{color:'#60a5fa'}}>{palabras}</span>
                <span style={{marginLeft:12,display:'inline-flex',gap:8,alignItems:'center'}}>
                  <span style={{display:'inline-block',width:8,height:8,background:'#f0c040',borderRadius:1,marginRight:3}}></span>código prov.
                  <span style={{display:'inline-block',width:8,height:8,background:'#60a5fa',borderRadius:1,marginRight:3}}></span>descripción
                </span>
              </div>
              {freq.fams.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:'#6b7280',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>FAMILIA</div><div>{freq.fams.map(f=><span key={f} onClick={()=>toggle('selFam',f)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selFam===f?'#f0c040':'#1e2133'}`,cursor:'pointer',margin:2,background:modal.selFam===f?'rgba(240,192,64,.15)':'transparent',color:modal.selFam===f?'#f0c040':'#e8eaf0'}}>{f}</span>)}</div></div>}
              {freq.cats.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:'#6b7280',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>CATEGORÍA</div><div>{freq.cats.map(c=><span key={c} onClick={()=>toggle('selCat',c)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selCat===c?'#f0c040':'#1e2133'}`,cursor:'pointer',margin:2,background:modal.selCat===c?'rgba(240,192,64,.15)':'transparent',color:modal.selCat===c?'#f0c040':'#e8eaf0'}}>{c}</span>)}</div></div>}
              {freq.marcas.length>0&&<div style={{marginBottom:8}}><div style={{fontSize:9,color:'#6b7280',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>MARCA</div><div>{freq.marcas.map(m=><span key={m} onClick={()=>toggle('selMarca',m)} style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:3,fontSize:10,border:`1px solid ${modal.selMarca===m?'#f0c040':'#1e2133'}`,cursor:'pointer',margin:2,background:modal.selMarca===m?'rgba(240,192,64,.15)':'transparent',color:modal.selMarca===m?'#f0c040':'#e8eaf0'}}>{m}</span>)}</div></div>}
              <div style={{fontSize:9,color:'#6b7280',marginBottom:4,letterSpacing:'.06em'}}>{resultados.length} ARTÍCULOS — click para asignar</div>
            </div>
            <div style={{maxHeight:200,overflowY:'auto',borderTop:'1px solid #1e2133'}}>
              {resultados.length===0
                ?<div style={{padding:18,textAlign:'center',color:'#6b7280',fontSize:11}}>Sin resultados · probá otros filtros o buscá manualmente</div>
                :resultados.map(({cod,a,type})=>(
                  <div key={cod} onClick={()=>onAsignar(modal.idx,cod)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',cursor:'pointer',borderBottom:'1px solid #181b27',borderLeft:`3px solid ${type==='prim'?'#f0c040':type==='sec'?'#60a5fa':'#1e2133'}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:'#e8eaf0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{escH(a.desc)}</div>
                      <div style={{fontSize:9,color:'#6b7280',marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{color:'#60a5fa'}}>{cod}</span>
                        <span>codp: <span style={{color:'#f0c040'}}>{a.codp||'—'}</span></span>
                        <span style={{color:'#2dd4bf'}}>{a.prov||'—'}</span>
                        <span>{a.fam||'—'}</span>
                        {a.costoReal>0&&<span style={{color:'#f0c040'}}>CR: ${fn(a.costoReal)}</span>}
                      </div>
                    </div>
                    {type==='prim'&&<span style={{...badge('warn'),fontSize:8}}>cód.prov</span>}
                    {type==='sec'&&<span style={{...badge('info'),fontSize:8}}>desc.</span>}
                  </div>
                ))
              }
            </div>
            <div style={{padding:'8px 14px',borderTop:'1px solid #1e2133',display:'flex',gap:6}}>
              <button onClick={()=>{ setModal(m=>({...m,open:false})); }} style={btnStyle('#6b7280')}>Omitir línea</button>
              <button onClick={()=>setModal(m=>({...m,tab:'nuevo'}))} style={{...btnStyle('#c084fc'),background:'rgba(192,132,252,.08)'}}>＋ No existe — crear nuevo</button>
            </div>
          </>
        )}

        {modal.tab==='nuevo'&&(
          <div style={{padding:14}}>
            {alert_('info','Datos de la factura precargados. Completá los faltantes y confirmá para agregar a la lista de importación al sistema.')}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
              {[['CÓDIGO INTERNO *','cod','text'],['CÓD. PROVEEDOR','codp','text'],['PROVEEDOR','prov','text']].map(([lbl,field,type])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:'#6b7280',letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <input type={type} value={f[field]||(field==='codp'?linea.codp||linea.cod:'')|(field==='prov'?linea.prov||'':'')} placeholder={field==='cod'?'Ej: 7798105...':''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:e.target.value}}))} style={inputStyle} />
                </div>
              ))}
            </div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:9,color:'#6b7280',letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>DESCRIPCIÓN *</div>
              <input value={f.desc||linea.desc||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,desc:e.target.value}}))} style={inputStyle} />
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
              {[['FAMILIA','fam',freq2.fams],['CATEGORÍA','cat',freq2.cats],['MARCA','marca',freq2.marcas]].map(([lbl,field,opts])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:'#6b7280',letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <select value={f[field]||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:e.target.value}}))}
                    style={{...inputStyle,padding:'4px 8px'}}>
                    <option value="">— Seleccionar —</option>
                    {opts.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
              {[['COSTO REAL','costoReal',linea.precioDoc||0],['PV MÍNIMO','pvMin',0],['01-MOSTRADOR','mostrador',0]].map(([lbl,field,def])=>(
                <div key={field}>
                  <div style={{fontSize:9,color:'#6b7280',letterSpacing:'.06em',marginBottom:3,textTransform:'uppercase'}}>{lbl}</div>
                  <input type="number" value={f[field]||def||''} placeholder="0" onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,[field]:parseFloat(e.target.value)||0}}))} style={{...inputStyle,textAlign:'right',WebkitAppearance:'none',MozAppearance:'textfield'}} />
                </div>
              ))}
            </div>
            <div style={{paddingTop:10,borderTop:'1px solid #1e2133',display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:9,color:'#6b7280'}}>Se agrega a lista de importación al sistema · la base es de solo lectura</span>
              <button onClick={()=>setModal(m=>({...m,tab:'buscar'}))} style={{...btnStyle('#6b7280'),marginLeft:'auto'}}>← Volver</button>
              <button onClick={onNuevo} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'6px 14px',fontSize:11,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>＋ Confirmar y agregar</button>
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
function ComprasContent({OCS,OCact,OCdata,setOCdata,etC,setEtC,db,codpIdx,nuevaOC,selectOC,deleteOC,importarDesdeStock,importarPlanillaXLSX,procesarExcel,aplicarLineasDocumento,saveOC,OCact_,confirmarOC,modal,setModal}){
  const fileRef  = React.useRef();
  const planRef  = React.useRef();
  const ETAPAS   = [{id:'carga',n:1,l:'CARGA',s:'Origen OC'},{id:'validacion',n:2,l:'VALIDACIÓN',s:'Precios'},{id:'distribucion',n:3,l:'DISTRIBUCIÓN',s:'Por sucursal'},{id:'confirmar',n:4,l:'CONFIRMAR',s:'Cerrar OC'}];
  const etIdx    = ETAPAS.findIndex(e=>e.id===etC);

  return(
    <div>
      {/* Lista OC */}
      {OCS.length>0&&(
        <div style={{background:'#111420',border:'1px solid #1e2133',borderRadius:5,overflow:'hidden',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 12px',borderBottom:'1px solid #1e2133'}}>
            <span style={{fontSize:9,color:'#6b7280',letterSpacing:'.1em',textTransform:'uppercase'}}>ÓRDENES DE COMPRA</span>
            <button onClick={nuevaOC} style={btnStyle('#f0c040')}>+ Nueva OC</button>
          </div>
          <div style={{maxHeight:80,overflowY:'auto'}}>
            {OCS.map(id=>{const d=tryGet('dm_oc_v3_'+id,null);if(!d)return null;return(
              <div key={id} onClick={()=>selectOC(id)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 12px',cursor:'pointer',borderBottom:'1px solid #181b27',background:id===OCact?'rgba(240,192,64,.06)':'transparent'}}>
                <span style={{color:'#f0c040',fontWeight:500,fontSize:12}}>{d.meta?.proveedor||'(sin prov)'}</span>
                <span style={{fontSize:9,color:'#6b7280'}}>{d.meta?.fecha||''} · {d.lineas?.length||0} art.</span>
                {id===OCact&&<span style={{...badge('warn'),marginLeft:'auto'}}>ACTIVA</span>}
                <button onClick={e=>{e.stopPropagation();deleteOC(id);}} style={{background:'transparent',border:'none',color:'#6b7280',cursor:'pointer',fontSize:12}}>✕</button>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Steps */}
      <div style={{display:'flex',background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:'5px 5px 0 0',overflowX:'auto',marginBottom:0}}>
        {ETAPAS.map((e,i)=>{const act=etC===e.id,done=etIdx>i;const col=done?'#4ade80':act?'#f0c040':'#6b7280';const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':'#1e2133';return(
          <div key={e.id} onClick={()=>setEtC(e.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',cursor:'pointer',borderBottom:act?'2px solid #f0c040':'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
            <div style={{width:18,height:18,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
            <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
            {i<3&&<div style={{color:'#1e2133',marginLeft:4}}>›</div>}
          </div>
        );})}
      </div>

      {/* Cuerpo etapa */}
      <div style={{background:'#111420',border:'1px solid #1e2133',borderTop:'none',borderRadius:'0 0 5px 5px',padding:14}}>
        {etC==='carga'&&<EtCarga OCdata={OCdata} setOCdata={setOCdata} db={db}
          importarDesdeStock={importarDesdeStock} fileRef={fileRef} planRef={planRef}
          procesarExcel={procesarExcel} importarPlanillaXLSX={importarPlanillaXLSX}
          onContinuar={()=>setEtC('validacion')} saveOC={saveOC} OCact={OCact_} />}
        {etC==='validacion'&&<EtValidacion OCdata={OCdata} setOCdata={setOCdata}
          db={db} modal={modal} setModal={setModal} fileRef={fileRef}
          procesarExcel={procesarExcel} saveOC={saveOC} OCact={OCact_}
          onBack={()=>setEtC('carga')} onNext={()=>setEtC('distribucion')} />}
        {etC==='distribucion'&&<EtDistribucion OCdata={OCdata} setOCdata={setOCdata}
          saveOC={saveOC} OCact={OCact_}
          onBack={()=>setEtC('validacion')} onNext={()=>setEtC('confirmar')} />}
        {etC==='confirmar'&&<EtConfirmar OCdata={OCdata} confirmarOC={confirmarOC}
          exportarOC={()=>{}} onBack={()=>setEtC('distribucion')} />}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarExcel(e.target.files[0],'oc');e.target.value='';}} />
      <input ref={planRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={e=>{if(e.target.files[0])importarPlanillaXLSX(e.target.files[0]);e.target.value='';}} />
    </div>
  );
}

function EtCarga({OCdata,setOCdata,db,importarDesdeStock,fileRef,planRef,procesarExcel,importarPlanillaXLSX,onContinuar,saveOC,OCact}){
  const hasPlan=Object.values(db.plan).some(p=>p.ac>0);
  const hasOC=OCdata.lineas.length>0;
  const upd=(field,val)=>{const meta={...OCdata.meta,[field]:val};const d={...OCdata,meta};setOCdata(d);saveOC(OCact,d);};
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:14}}>
        {[
          {title:'OPCIÓN 1 — DESDE STOCK+',alert:hasPlan?{cls:'ok',msg:'✓ Planilla disponible'}:{cls:'warn',msg:'⚠ Cargá Stock+ primero'},btn:<button onClick={importarDesdeStock} style={{...btnStyle('#f0c040'),background:'#f0c040',color:'#0c0e14',width:'100%',fontWeight:600}}>← Importar desde Stock+</button>},
          {title:'OPCIÓN 2 — PLANILLA EXCEL',alert:{cls:'info',msg:'Exportada desde Stock+'},btn:<button onClick={()=>planRef.current.click()} style={{...btnStyle(),width:'100%'}}>📋 Cargar .xlsx</button>},
          {title:'OPCIÓN 3 — FACTURA/REMITO',alert:{cls:'info',msg:'PDF, imagen o Excel del proveedor'},btn:<button onClick={()=>fileRef.current.click()} style={{...btnStyle(),width:'100%'}}>📄 Subir documento</button>},
        ].map((op,i)=>(
          <div key={i}>
            <div style={{fontSize:9,color:'#6b7280',marginBottom:7}}>{op.title}</div>
            {alert_(op.alert.cls,op.alert.msg)}
            {op.btn}
          </div>
        ))}
      </div>
      {hasOC&&alert_('ok',`✓ OC activa: ${OCdata.lineas.length} artículos · ${OCdata.meta.proveedor||'(sin prov)'} · ${OCdata.meta.origen||'manual'}`)}
      <div style={{borderTop:'1px solid #1e2133',paddingTop:12,marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:8,alignItems:'end'}}>
        {[['PROVEEDOR','proveedor','Proveedor'],['Nº DOCUMENTO','documento','FAC A 0001-...'],['FECHA','fecha','']].map(([lbl,field,ph])=>(
          <div key={field}>
            <div style={{fontSize:9,color:'#6b7280',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
            <input type={field==='fecha'?'date':'text'} value={OCdata.meta[field]||''} placeholder={ph} onChange={e=>upd(field,e.target.value)} style={inputStyle} />
          </div>
        ))}
        <button onClick={onContinuar} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 16px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Continuar →</button>
      </div>
    </div>
  );
}


function PrecioInput({ value, onChange }) {
  const [local, setLocal] = React.useState(value || '');
  React.useEffect(() => { setLocal(value || ''); }, [value]);
  const hasVal = parseFloat(local) > 0;
  return (
    <input
      type="number"
      value={local}
      placeholder="0"
      onChange={e => { setLocal(e.target.value); onChange(e.target.value); }}
      style={{
        width: 80, padding: '2px 5px', fontSize: 10, textAlign: 'right',
        background: '#0c0e14',
        color: hasVal ? '#f0c040' : '#e8eaf0',
        border: hasVal ? '1px solid rgba(240,192,64,.5)' : '1px solid #1e2133',
        borderRadius: 3, fontFamily: 'DM Mono,monospace', outline: 'none',
        WebkitAppearance: 'none', MozAppearance: 'textfield',
      }}
    />
  );
}

function EtValidacion({OCdata,setOCdata,db,modal,setModal,fileRef,procesarExcel,saveOC,OCact,onBack,onNext}){
  if(!OCdata.lineas.length)return <div>{alert_('warn','Sin líneas. Volvé a Carga e importá artículos.')}<button onClick={onBack} style={btnStyle()}>← Volver</button></div>;

  const rec=OCdata.lineas.filter(l=>l.reconocido).length;
  const noRec=OCdata.lineas.filter(l=>!l.reconocido).length;
  const suben=OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc>l.costoReal).length;
  const bajan=OCdata.lineas.filter(l=>l.reconocido&&l.precioDoc>0&&l.costoReal>0&&l.precioDoc<l.costoReal).length;

  const updPrecio=(i,val)=>{
    const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,precioDoc:parseFloat(val)||0});
    const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);
  };
  const aprobar=(i,v)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,aprobado:v,rechazado:!v});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};

  return(
    <div>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:7,marginBottom:10}}>
        {[{l:'LÍNEAS',v:OCdata.lineas.length,c:'#e8eaf0'},{l:'RECONOCIDAS',v:rec,c:'#4ade80'},{l:'NO RECONOCIDAS',v:noRec,c:noRec>0?'#f87171':'#6b7280'},{l:'PRECIO ↑',v:suben,c:suben>0?'#f87171':'#6b7280'},{l:'PRECIO ↓',v:bajan,c:bajan>0?'#4ade80':'#6b7280'}].map(k=>(
          <div key={k.l} style={{background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:17,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>
      {noRec>0&&alert_('warn',`⚠ ${noRec} artículo(s) sin reconocer — hacé click en "Resolver →" para buscar o crear`)}
      {suben>0&&alert_('err',`↑ ${suben} artículo(s) con precio superior al Costo Real`)}
      {bajan>0&&alert_('ok',`↓ ${bajan} artículo(s) con precio inferior al Costo Real`)}

      <div style={{display:'flex',gap:7,marginBottom:8,alignItems:'center'}}>
        <span style={{fontSize:9,color:'#6b7280'}}>Cruzar precios con factura:</span>
        <button onClick={()=>fileRef.current.click()} style={btnStyle('#6b7280')}>📄 Subir factura/remito</button>
        <button onClick={()=>{const d={...OCdata,lineas:OCdata.lineas.map(l=>({...l,precioDoc:0}))};setOCdata(d);saveOC(OCact,d);}} style={btnStyle('#6b7280')}>Sin factura</button>
      </div>

      <div style={{overflowX:'auto',background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr style={{background:'#0d0f1a'}}>
              {['CÓD.DOC','CÓD.BASE','DESC.FACTURA','DESC.BASE','CANT.','PRECIO DOC.','COSTO REAL','MOSTRADOR','PV MÍN.','DIFF','ACCIÓN'].map((h,i)=>(
                <th key={i} style={{fontSize:9,color:h==='PRECIO DOC.'?'#f0c040':h==='COSTO REAL'?'#6b7280':h==='MOSTRADOR'?'#60a5fa':h==='PV MÍN.'?'#c084fc':'#6b7280',padding:'5px 7px',borderBottom:'1px solid #1e2133',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.06em',textAlign:['CANT.','PRECIO DOC.','COSTO REAL','MOSTRADOR','PV MÍN.'].includes(h)?'right':'left'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const diff=calcDiff(l.costoReal,l.precioDoc);
              const pl=priceLabel(diff);
              const rowBg=!l.reconocido?'rgba(248,113,113,.04)':diff!==null&&diff>0&&!l.aprobado?'rgba(248,113,113,.025)':'transparent';
              let accion=null;
              if(!l.reconocido)accion=<button onClick={()=>setModal(m=>({...m,open:true,idx:i,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',nuevoForm:{cod:'',desc:l.desc||'',codp:l.codp||l.cod||'',prov:l.prov||'',fam:'',cat:'',marca:'',costoReal:l.precioDoc||0,pvMin:0,mostrador:0}}))} style={{...btnStyle('#f0c040'),background:'rgba(240,192,64,.12)',fontSize:10,padding:'2px 8px'}}>Resolver →</button>;
              else if(diff!==null&&diff>0&&!l.aprobado)accion=<div style={{display:'flex',gap:3}}><button onClick={()=>aprobar(i,true)} style={{...btnStyle('#4ade80'),background:'rgba(74,222,128,.1)',fontSize:9,padding:'2px 6px'}}>✓ OK</button><button onClick={()=>aprobar(i,false)} style={{...btnStyle('#f87171'),background:'rgba(248,113,113,.1)',fontSize:9,padding:'2px 6px'}}>✗</button></div>;
              else if(l.aprobado)accion=<span style={badge('ok')}>Aprobado</span>;
              else if(l.rechazado)accion=<span style={badge('err')}>Rechazado</span>;
              else accion=<span style={{fontSize:9,color:'#4ade80'}}>✓</span>;
              const td=(c,s)=><td style={{padding:'5px 7px',borderBottom:'1px solid #181b27',fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return(
                <tr key={i} style={{background:rowBg}}>
                  {td(l.codp||l.cod,{fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'})}
                  {td(l.reconocido?(l.cod||'—'):'— ?',{fontSize:9,color:l.reconocido?'#2dd4bf':'#f87171',fontFamily:'DM Mono,monospace'})}
                  {td(<span title={l.desc} style={{display:'block',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</span>)}
                  {td(<span title={l.descBase||l.desc} style={{display:'block',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6b7280',fontSize:9}}>{l.descBase||'—'}</span>)}
                  {td(l.cantOC,{textAlign:'right',fontWeight:500})}
                  <td style={{padding:'3px 5px',borderBottom:'1px solid #181b27',verticalAlign:'middle',textAlign:'right'}}>
                    <PrecioInput value={l.precioDoc} onChange={v=>updPrecio(i,v)} />
                  </td>
                  {td(fp(l.costoReal),{textAlign:'right',color:'#6b7280'})}
                  {td(fp(l.mostrador),{textAlign:'right',color:'#60a5fa'})}
                  {td(fp(l.pvMin),{textAlign:'right',color:'#c084fc'})}
                  {td(<span style={badge(pl.cls)}>{pl.text}</span>)}
                  {td(accion)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
        <button onClick={onBack} style={btnStyle('#6b7280')}>← Volver</button>
        <button onClick={onNext} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Distribución →</button>
      </div>
    </div>
  );
}

function EtDistribucion({OCdata,setOCdata,saveOC,OCact,onBack,onNext}){
  if(!OCdata.lineas.length)return<div>{alert_('warn','Sin líneas.')}<button onClick={onBack} style={btnStyle()}>← Volver</button></div>;
  const upd=(i,field,val)=>{const lineas=OCdata.lineas.map((l,li)=>li!==i?l:{...l,[field]:parseFloat(val)||0});const d={...OCdata,lineas};setOCdata(d);saveOC(OCact,d);};
  const totCen=OCdata.lineas.reduce((s,l)=>s+(l.dc||0),0);
  const totSol=OCdata.lineas.reduce((s,l)=>s+(l.d1||0),0);
  const totVar=OCdata.lineas.reduce((s,l)=>s+(l.d3||0),0);
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
        {[{l:'→ CENTRAL',v:totCen,c:'#2dd4bf'},{l:'→ SOLANO',v:totSol,c:'#60a5fa'},{l:'→ VARELA',v:totVar,c:'#4ade80'}].map(k=>(
          <div key={k.l} style={{background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:20,fontWeight:700,color:k.c}}>{fn(k.v)}</div>
          </div>
        ))}
      </div>
      <div style={{overflowX:'auto',background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:5,marginBottom:10}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead><tr>
            {['CÓDIGO','DESCRIPCIÓN','OC','→CENTRAL','→SOLANO','→VARELA','→DP','DIFF'].map((h,i)=>(
              <th key={i} style={{fontSize:9,color:h==='→CENTRAL'?'#2dd4bf':h==='→SOLANO'?'#60a5fa':h==='→VARELA'?'#4ade80':h==='→DP'?'#c084fc':'#6b7280',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textTransform:'uppercase',letterSpacing:'.06em',textAlign:i>1?'right':'left'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const tot=(l.dc||0)+(l.d1||0)+(l.d3||0);
              const dp=Math.max(0,l.cantOC-tot);
              const diff=l.cantOC-tot;
              const ic=(field,color)=><input type="number" min="0" value={l[field]||''} placeholder="—" onChange={e=>upd(i,field,e.target.value)} style={{width:55,padding:'2px 4px',fontSize:10,textAlign:'right',background:'#0c0e14',color:l[field]>0?color:'#e8eaf0',border:`1px solid ${l[field]>0?color:'#1e2133'}`,borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',WebkitAppearance:'none',MozAppearance:'textfield'}} />;
              const td=(c,s)=><td style={{padding:'4px 7px',borderBottom:'1px solid #181b27',fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return<tr key={i}>
                {td(l.cod,{fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'})}
                {td(<span title={l.desc} style={{display:'block',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</span>)}
                {td(l.cantOC,{textAlign:'right',fontWeight:500})}
                {td(ic('dc','#2dd4bf'),{textAlign:'right',padding:'3px 5px'})}
                {td(ic('d1','#60a5fa'),{textAlign:'right',padding:'3px 5px'})}
                {td(ic('d3','#4ade80'),{textAlign:'right',padding:'3px 5px'})}
                {td(dp,{textAlign:'right',color:'#c084fc'})}
                {td(<span style={{color:diff===0?'#4ade80':diff>0?'#f0c040':'#f87171',fontWeight:600}}>{diff>0?'+':''}{diff}</span>,{textAlign:'right'})}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onBack} style={btnStyle('#6b7280')}>← Volver</button>
        <button onClick={onNext} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Confirmar OC →</button>
      </div>
    </div>
  );
}

function EtConfirmar({OCdata,confirmarOC,onBack}){
  const totUds=OCdata.lineas.reduce((s,l)=>s+l.cantOC,0);
  const totCosto=OCdata.lineas.reduce((s,l)=>s+l.cantOC*(l.precioDoc||0),0);
  const sinPrecio=OCdata.lineas.filter(l=>!l.precioDoc).length;
  const sinDist=OCdata.lineas.filter(l=>!(l.dc||l.d1||l.d3)).length;
  const noResueltos=OCdata.lineas.filter(l=>!l.reconocido).length;
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
        {[{l:'ARTÍCULOS',v:OCdata.lineas.length,c:'#e8eaf0'},{l:'UNIDADES',v:fn(totUds),c:'#f0c040'},{l:'TOTAL',v:totCosto>0?'$'+fn(totCosto):'—',c:'#4ade80'},{l:'PROVEEDOR',v:OCdata.meta.proveedor||'—',c:'#e8eaf0'}].map(k=>(
          <div key={k.l} style={{background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:15,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>
      {noResueltos>0&&alert_('err',`⚠ ${noResueltos} artículos no reconocidos — volvé a Validación`)}
      {sinPrecio>0?alert_('warn',`⚠ ${sinPrecio} artículos sin precio documentado`):alert_('ok','✓ Todos los artículos con precio')}
      {sinDist>0?alert_('warn',`⚠ ${sinDist} artículos sin distribución asignada (van a DP automático)`):alert_('ok','✓ Distribución completa')}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
        <button onClick={onBack} style={btnStyle('#6b7280')}>← Volver</button>
        <button onClick={confirmarOC} disabled={noResueltos>0} style={{background:noResueltos>0?'#1e2133':'#f0c040',color:noResueltos>0?'#6b7280':'#0c0e14',border:'none',borderRadius:4,padding:'8px 20px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:noResueltos>0?'not-allowed':'pointer'}}>✓ Confirmar y pasar a Recepción</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RECEPCIÓN — 3 etapas
// ════════════════════════════════════════════════════════════════════════════
function RecepcionContent({OCdata,RECdata,setRECdata,etR,setEtR,updRec,saveRec,procesarExcel,aplicarLineasDocumento,imprimirRecepcion}){
  const fileRef=React.useRef();
  const ETAPAS=[{id:'carga',n:1,l:'CARGA',s:'Remito'},{id:'control',n:2,l:'CONTROL',s:'Cantidades'},{id:'cierre',n:3,l:'CIERRE',s:'Confirmar'}];
  const etIdx=ETAPAS.findIndex(e=>e.id===etR);

  return(
    <div>
      <div style={{display:'flex',background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:'5px 5px 0 0',overflowX:'auto'}}>
        {ETAPAS.map((e,i)=>{const act=etR===e.id,done=etIdx>i;const col=done?'#4ade80':act?'#f0c040':'#6b7280';const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':'#1e2133';return(
          <div key={e.id} onClick={()=>setEtR(e.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',cursor:'pointer',borderBottom:act?'2px solid #f0c040':'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
            <div style={{width:18,height:18,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
            <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
            {i<2&&<div style={{color:'#1e2133',marginLeft:4}}>›</div>}
          </div>
        );})}
      </div>
      <div style={{background:'#111420',border:'1px solid #1e2133',borderTop:'none',borderRadius:'0 0 5px 5px',padding:14}}>
        {etR==='carga'&&<RecEtCarga OCdata={OCdata} RECdata={RECdata} setRECdata={setRECdata} fileRef={fileRef} saveRec={saveRec} onNext={()=>setEtR('control')} aplicarLineasDocumento={aplicarLineasDocumento} />}
        {etR==='control'&&<RecEtControl RECdata={RECdata} updRec={updRec} setRECdata={setRECdata} saveRec={saveRec} onBack={()=>setEtR('carga')} onNext={()=>setEtR('cierre')} />}
        {etR==='cierre'&&<RecEtCierre RECdata={RECdata} setRECdata={setRECdata} saveRec={saveRec} imprimirRecepcion={imprimirRecepcion} onBack={()=>setEtR('control')} onFinalizar={()=>{setRECdata({meta:{},lineas:[]});tryGet&&localStorage.removeItem(SK.rec);setEtR('carga');}} />}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarExcel(e.target.files[0],'rec');e.target.value='';}} />
    </div>
  );
}

function RecEtCarga({OCdata,RECdata,setRECdata,fileRef,saveRec,onNext,aplicarLineasDocumento}){
  const hasOC=OCdata.lineas.length>0;
  const hasRec=RECdata.lineas.length>0;
  const upd=(field,val)=>{const d={...RECdata,meta:{...RECdata.meta,[field]:val}};setRECdata(d);saveRec(d);};
  const crearDesdeOC=()=>{const d={meta:{proveedor:OCdata.meta.proveedor,documento:'',fecha:new Date().toISOString().slice(0,10)},lineas:OCdata.lineas.map(l=>({cod:l.cod,desc:l.desc,codp:l.codp,cantOC:l.cantOC,cantRemito:l.cantOC,cantRec:null,diff:null,ub:'',ok:null}))};setRECdata(d);saveRec(d);};
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:9,color:'#6b7280',marginBottom:7}}>DESDE OC ACTIVA</div>
          {hasOC?alert_('ok',`✓ OC: ${OCdata.meta.proveedor||''} · ${OCdata.lineas.length} artículos`):alert_('warn','⚠ Sin OC activa')}
          <button onClick={crearDesdeOC} disabled={!hasOC} style={{...btnStyle(hasOC?'#f0c040':undefined),background:hasOC?'rgba(240,192,64,.1)':undefined,width:'100%',opacity:hasOC?1:.4}}>← Crear recepción desde OC</button>
        </div>
        <div>
          <div style={{fontSize:9,color:'#6b7280',marginBottom:7}}>REMITO PROVEEDOR</div>
          {alert_('info','Excel, PDF o imagen del remito del proveedor')}
          <button onClick={()=>fileRef.current.click()} style={{...btnStyle(),width:'100%'}}>📄 Subir remito</button>
        </div>
      </div>
      {hasRec&&alert_('ok',`✓ Recepción cargada: ${RECdata.lineas.length} artículos`)}
      <div style={{borderTop:'1px solid #1e2133',paddingTop:12,display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:8,alignItems:'end'}}>
        {[['PROVEEDOR','proveedor'],['Nº REMITO','documento'],['FECHA','fecha']].map(([lbl,field])=>(
          <div key={field}>
            <div style={{fontSize:9,color:'#6b7280',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
            <input type={field==='fecha'?'date':'text'} value={RECdata.meta[field]||''} onChange={e=>upd(field,e.target.value)} style={inputStyle} />
          </div>
        ))}
        <button onClick={onNext} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 14px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Control →</button>
      </div>
    </div>
  );
}

function RecEtControl({RECdata,updRec,setRECdata,saveRec,onBack,onNext}){
  if(!RECdata.lineas.length)return<div>{alert_('warn','Sin líneas. Cargá el remito primero.')}<button onClick={onBack} style={btnStyle()}>← Volver</button></div>;
  const conformes=RECdata.lineas.filter(l=>l.ok===true).length;
  const faltantes=RECdata.lineas.filter(l=>l.ok===false).length;
  const conforme_todo=()=>{const lineas=RECdata.lineas.map(l=>({...l,cantRec:l.cantRemito||l.cantOC,diff:0,ok:true}));const d={...RECdata,lineas};setRECdata(d);saveRec(d);};
  const td=(c,s)=><td style={{padding:'5px 7px',borderBottom:'1px solid #181b27',fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
  return(
    <div>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10}}>
        <span style={{...badge('ok')}}>{conformes} conformes</span>
        <span style={{...badge('err')}}>{faltantes} faltantes</span>
        <span style={{fontSize:9,color:'#6b7280'}}>{RECdata.lineas.filter(l=>l.cantRec===null).length} sin controlar</span>
        <button onClick={conforme_todo} style={{...btnStyle('#4ade80'),background:'rgba(74,222,128,.08)',marginLeft:'auto'}}>✓ Todo conforme</button>
      </div>
      <div style={{overflowX:'auto',background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:5,marginBottom:10}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead><tr>
            {['CÓDIGO','DESCRIPCIÓN','CANT.OC','CANT.REMITO','CANT.RECIBIDA','DIFF','UBICACIÓN','OK'].map((h,i)=>(
              <th key={i} style={{fontSize:9,color:h==='CANT.RECIBIDA'?'#f0c040':'#6b7280',padding:'5px 7px',background:'#0d0f1a',borderBottom:'1px solid #1e2133',textTransform:'uppercase',letterSpacing:'.06em',textAlign:i>1?'right':'left'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {RECdata.lineas.map((l,i)=>{
              const diff=l.cantRec!==null?l.cantRec-(l.cantRemito||0):null;
              return<tr key={i} style={{background:l.ok===false?'rgba(248,113,113,.04)':l.ok===true?'rgba(74,222,128,.02)':'transparent'}}>
                {td(l.cod,{fontSize:9,color:'#60a5fa',fontFamily:'DM Mono,monospace'})}
                {td(<span title={l.desc} style={{display:'block',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</span>)}
                {td(l.cantOC||'—',{textAlign:'right',color:'#6b7280'})}
                {td(l.cantRemito||'—',{textAlign:'right'})}
                {td(<input type="number" min="0" value={l.cantRec!==null?l.cantRec:''} placeholder="—" onChange={e=>updRec(i,e.target.value)} style={{width:70,padding:'2px 5px',fontSize:10,textAlign:'right',background:'#0c0e14',color:'#f0c040',border:'1px solid rgba(240,192,64,.4)',borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',WebkitAppearance:'none',MozAppearance:'textfield'}} />,{textAlign:'right',padding:'3px 5px'})}
                {td(diff===null?'—':<span style={{color:diff===0?'#4ade80':diff<0?'#f87171':'#60a5fa',fontWeight:600}}>{diff>0?'+':''}{diff}</span>,{textAlign:'right'})}
                {td(<input value={l.ub||''} placeholder="PL01-F-A-1" onChange={e=>{const lineas=RECdata.lineas.map((ll,li)=>li!==i?ll:{...ll,ub:e.target.value});const d={...RECdata,lineas};setRECdata(d);saveRec(d);}} style={{width:90,padding:'2px 5px',fontSize:9,background:'#0c0e14',color:'#e8eaf0',border:'1px solid #1e2133',borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none'}} />)}
                {td(l.ok===true?<span style={{color:'#4ade80'}}>✓</span>:l.ok===false?<span style={{color:'#f87171'}}>✗</span>:'—',{textAlign:'center'})}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onBack} style={btnStyle('#6b7280')}>← Volver</button>
        <button onClick={onNext} style={{background:'#f0c040',color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Ir al cierre →</button>
      </div>
    </div>
  );
}

function RecEtCierre({RECdata,setRECdata,saveRec,imprimirRecepcion,onBack,onFinalizar}){
  const conformes=RECdata.lineas.filter(l=>l.ok===true).length;
  const faltantes=RECdata.lineas.filter(l=>l.ok===false).length;
  const sinControl=RECdata.lineas.filter(l=>l.cantRec===null).length;
  const sinUb=RECdata.lineas.filter(l=>!l.ub).length;
  const updObs=v=>{const d={...RECdata,meta:{...RECdata.meta,obs:v}};setRECdata(d);saveRec(d);};
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
        {[{l:'ARTÍCULOS',v:RECdata.lineas.length,c:'#e8eaf0'},{l:'CONFORMES',v:conformes,c:'#4ade80'},{l:'FALTANTES',v:faltantes,c:faltantes>0?'#f87171':'#6b7280'},{l:'SIN UBICAR',v:sinUb,c:sinUb>0?'#f0c040':'#6b7280'}].map(k=>(
          <div key={k.l} style={{background:'#0d0f1a',border:'1px solid #1e2133',borderRadius:4,padding:'8px 10px'}}>
            <div style={{fontSize:8,color:'#6b7280',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>
      {sinControl>0&&alert_('warn',`⚠ ${sinControl} artículos sin controlar — volvé a E2`)}
      {faltantes>0?alert_('err',`✗ ${faltantes} artículos con faltante`):alert_('ok','✓ Sin faltantes')}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em'}}>OBSERVACIONES FINALES</div>
        <textarea rows={3} value={RECdata.meta.obs||''} onChange={e=>updObs(e.target.value)}
          placeholder="Estado general, incidencias..." style={{...inputStyle,height:60,resize:'vertical',padding:'6px 8px'}} />
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onBack} style={btnStyle('#6b7280')}>← Revisar</button>
        <button onClick={imprimirRecepcion} style={{...btnStyle('#2dd4bf'),background:'rgba(45,212,191,.08)'}}>🖨 Imprimir</button>
        <button onClick={()=>{const d={...RECdata,meta:{...RECdata.meta,cerrada:new Date().toISOString()}};setRECdata(d);saveRec(d);alert('✓ Recepción cerrada correctamente');onFinalizar();}} style={{background:'#4ade80',color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>✓ Cerrar recepción</button>
      </div>
    </div>
  );
}
