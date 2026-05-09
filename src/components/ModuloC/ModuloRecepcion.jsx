// ===== MÓDULO RECEPCIÓN V3 =====
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { SK, lsGet, lsSet, loadArt } from '../../utils/db';

const fn  = n => Number(n||0).toLocaleString('es-AR');
const now = () => new Date().toISOString();
const pad = n => String(n).padStart(2,'0');

// ─── Número RC único ──────────────────────────────────────────────────────────
function generarRC(proveedor){
  const d=new Date();
  const sigla=(proveedor||'SP').replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,3);
  return `RC${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}-${sigla}`;
}

// ─── Cruce códigos (mismo que Compras) ────────────────────────────────────────
function buildIdx(art){const idx={};for(const[cod,a]of Object.entries(art)){const cp=String(a.codp||'').trim();if(cp){if(!idx[cp])idx[cp]=[];idx[cp].push(cod);}const cpN=cp.replace(/^0+/,'');if(cpN&&cpN!==cp){if(!idx[cpN])idx[cpN]=[];idx[cpN].push(cod);}}return idx;}
function cruzar(codExt,art,idx){if(!codExt)return null;const cod=String(codExt).trim();const codN=cod.replace(/^0+/,'');if(idx[cod]?.length)return idx[cod][0];if(idx[codN]?.length)return idx[codN][0];for(const[cp,cods]of Object.entries(idx)){const cpN=cp.replace(/^0+/,'');if(cpN&&codN&&(cpN===codN||cpN.includes(codN)||codN.includes(cpN)))return cods[0];}if(art[cod])return cod;return null;}

function buscar(desc,codDoc,prov,art){
  if(!art||!Object.keys(art).length)return[];
  const words=(desc||'').toLowerCase().split(/\s+/).filter(w=>w.length>2).slice(0,4);
  const codN=String(codDoc||'').toLowerCase().replace(/^0+/,'');
  const res=[];
  for(const[cod,a]of Object.entries(art)){
    if(prov&&(a.prov||'').toLowerCase()!==prov.toLowerCase())continue;
    const hay=(a.desc||'').toLowerCase();
    const cpN=String(a.codp||'').toLowerCase().replace(/^0+/,'');
    let score=0;let type='other';
    if(codN&&cpN){if(cpN===codN||cpN.includes(codN)||codN.includes(cpN)){score+=20;type='prim';}}
    const wm=words.filter(w=>hay.includes(w)).length;
    if(wm>0){score+=wm*9;if(type==='other')type='sec';}
    if(score>0)res.push({cod,a,score,type});
  }
  res.sort((a,b)=>{const o={prim:0,sec:1,other:2};if(o[a.type]!==o[b.type])return o[a.type]-o[b.type];return b.score-a.score;});
  return res.slice(0,30);
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const C={bg:'#0c0e14',panel:'#111420',p2:'#0d0f1a',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',red:'#f87171',blue:'#60a5fa',vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',txt:'#e8eaf0',mut:'#6b7280'};
const IS={background:C.bg,color:C.txt,border:`1px solid ${C.b1}`,borderRadius:4,fontFamily:'DM Mono,monospace',fontSize:11,padding:'4px 8px',outline:'none',width:'100%'};
const Btn=(col,bg)=>({cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'5px 11px',border:`1px solid ${col||C.b1}`,background:bg||'transparent',color:col||C.txt,whiteSpace:'nowrap'});
const Alrt=({cls,children})=>{const s={ok:{background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',color:C.green},warn:{background:'rgba(240,192,64,.08)',border:'1px solid rgba(240,192,64,.2)',color:C.acc},err:{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',color:C.red},info:{background:'rgba(96,165,250,.08)',border:'1px solid rgba(96,165,250,.2)',color:C.blue}}[cls]||{};return<div style={{borderRadius:4,padding:'7px 11px',fontSize:10,marginBottom:7,...s}}>{children}</div>;};

function NumIn({value,onChange,color,disabled,width=70,placeholder='—'}){
  const [loc,setLoc]=useState(String(value??''));
  const ref=useRef();
  useEffect(()=>{if(document.activeElement!==ref.current)setLoc(String(value??''));},[value]);
  return(<input ref={ref} type="text" inputMode="numeric" value={loc} placeholder={placeholder} disabled={disabled}
    onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,'');setLoc(v);onChange(v===''?null:parseInt(v,10));}}
    onBlur={()=>setLoc(String(value??''))}
    onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}
    style={{width,padding:'3px 5px',fontSize:10,textAlign:'right',background:C.bg,color:(parseInt(loc)||0)>0?(color||C.acc):C.txt,border:`1px solid ${(parseInt(loc)||0)>0?(color||C.acc):C.b1}`,borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',opacity:disabled?.3:1}} />);
}


// ─── Estimación de bultos ─────────────────────────────────────────────────────
function estimarBultos(lineas){
  // Reglas de inferencia:
  // 1. Si el documento dice "bultos" en algún campo → usar ese valor
  // 2. Si hay un total de bultos del documento → distribuir proporcionalmente
  // 3. Mínimo 1 bulto por artículo distinto
  // 4. Si cantidad > 10 unidades de un artículo → estimar 1 bulto por fracción estándar
  return lineas.map(l=>{
    if(l.bultos!==null&&l.bultos!==undefined)return l; // ya tiene dato
    const cant=l.cantRemito||0;
    // Heurística: artículos de repostería suelen venir en cajas de 6,12,24
    let bultosEst=null;
    if(cant<=0)bultosEst=null;
    else if(cant<=6)bultosEst=1;
    else if(cant%24===0)bultosEst=cant/24;
    else if(cant%12===0)bultosEst=cant/12;
    else if(cant%6===0)bultosEst=cant/6;
    else bultosEst=1;
    return{...l,bultos:bultosEst,artsPorBulto:bultosEst&&bultosEst>0?Math.round(cant/bultosEst):null};
  });
}

// ════════════════════════════════════════════════════════════════════════════
export default function ModuloRecepcion(){
  const [etapa,   setEtapa]  = useState('documento');
  const [rec,     setRec]    = useState(()=>lsGet(SK.rec,null)||{
    meta:{proveedor:'',nRemito:'',nOC:'',fecha:new Date().toISOString().slice(0,10),transportista:'',patente:'',horaLlegada:'',obs:'',obsFinal:'',rc:'',totalBultos:null},
    lineas:[],fotoEvidencia:null,cerrada:false,
  });
  const [art,     setArt]    = useState({});
  const [artIdx,  setArtIdx] = useState({});
  const [OCS,     setOCS]    = useState([]);
  const [ocSel,   setOcSel]  = useState(null);
  const [iaStatus,setIaStatus]=useState('');
  const fileRef=useRef(); const fotoRef=useRef();

  useEffect(()=>{
    loadArt().then(artExpanded=>{
      // loadArt() now returns already-expanded objects
      setArt(artExpanded);
      setArtIdx(buildIdx(artExpanded));
    });
    // Cargar OCs disponibles
    const ocs=lsGet(SK.ocs,[]);
    const ocList=ocs.map(id=>{const d=lsGet('dm_oc_v3_'+id,null);return d?{id,meta:d.meta,lineas:d.lineas}:null;}).filter(Boolean);
    setOCS(ocList);
  },[]);

  const saveRec=useCallback((data)=>lsSet(SK.rec,data),[]);
  const updMeta=useCallback((field,val)=>{setRec(prev=>{const next={...prev,meta:{...prev.meta,[field]:val}};saveRec(next);return next;});},[saveRec]);

  // ─── Procesar documento ───────────────────────────────────────────────────
  const procesarDoc=useCallback(async(file)=>{
    const ext=file.name.toLowerCase().split('.').pop();
    const rc=generarRC(rec.meta.proveedor||'SP');
    updMeta('rc',rc);
    updMeta('horaLlegada',new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}));

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
      const lineas=[];
      for(let i=hRow+1;i<raw.length;i++){
        const r=raw[i];const codDoc=String(r[iCod]||'').trim();if(!codDoc||codDoc.length<2)continue;
        const codI=cruzar(codDoc,art,artIdx)||null;
        const a=codI?art[codI]:null;
        // Buscar en OC
        const ocLinea=ocSel?ocSel.lineas?.find(ol=>ol.cod===codI||ol.codp===codDoc):null;
        lineas.push({codDoc,codI,desc:a?.desc||String(r[iDesc]||'').trim(),cantRemito:parseFloat(String(r[iCant]||'0'))||0,precioUnit:iPrecio>=0?parseFloat(String(r[iPrecio]||'0'))||0:0,cantOC:ocLinea?.cantOC||null,bultos:null,artsPorBulto:null,cantFis:null,diff:null,ub:'',ok:null,obs:'',candidatos:[]});
      }
      setRec(prev=>{const next={...prev,lineas};saveRec(next);return next;});
      setEtapa('registro');
    } else {
      setIaStatus('Analizando con IA...');
      try{
        const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
        const reader=new FileReader();
        const b64=await new Promise(res=>{reader.onload=e=>res(e.target.result.split(',')[1]);reader.readAsDataURL(file);});
        const mtype=isPdf?'application/pdf':file.type||'image/jpeg';
        const prompt=`Analizá este documento (factura o remito de proveedor) y extraé:
1. Proveedor, número de documento, fecha, cantidad de bultos total si se menciona
2. Líneas: código del proveedor, descripción, cantidad, precio unitario si existe, bultos si se menciona

Respondé SOLO con JSON:
{"proveedor":"nombre","nDocumento":"número","fecha":"DD/MM/YYYY","totalBultos":número_o_null,
"lineas":[{"cod":"código","desc":"descripción","cant":número,"precioUnit":número_o_0,"bultos":número_o_null}]}`;
        const res=await fetch('/api/ia/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:b64,mediaType:mtype,prompt})});
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||'Error: '+res.status);}
        const result=await res.json();
        const parsed=JSON.parse((result.text||'').replace(/```json|```/g,'').trim());
        const lineas=(parsed.lineas||[]).map(l=>{
          const codI=cruzar(l.cod,art,artIdx)||null;
          const a=codI?art[codI]:null;
          const ocLinea=ocSel?ocSel.lineas?.find(ol=>ol.cod===codI||ol.codp===l.cod):null;
          return{codDoc:l.cod,codI,desc:a?.desc||l.desc||'',cantRemito:Number(l.cant)||0,precioUnit:Number(l.precioUnit)||0,cantOC:ocLinea?.cantOC||null,bultos:l.bultos||null,artsPorBulto:null,cantFis:null,diff:null,ub:'',ok:null,obs:'',candidatos:[]};
        });
        setRec(prev=>{const next={...prev,meta:{...prev.meta,proveedor:parsed.proveedor||prev.meta.proveedor,nRemito:parsed.nDocumento||prev.meta.nRemito,fecha:parsed.fecha?parsed.fecha.split('/').reverse().join('-'):prev.meta.fecha,totalBultos:parsed.totalBultos||null,rc},lineas};saveRec(next);return next;});
        setIaStatus('');setEtapa('registro');
      }catch(e){setIaStatus('Error: '+e.message);}
    }
  },[art,artIdx,ocSel,rec.meta.proveedor,saveRec,updMeta]);

  // ─── Control físico ───────────────────────────────────────────────────────
  const updLinea=useCallback((idx,field,val)=>{
    setRec(prev=>{
      const lineas=prev.lineas.map((l,i)=>{
        if(i!==idx)return l;
        const updated={...l,[field]:val};
        // Recalcular cantFis desde bultos si aplica
        if(field==='bultos'||field==='artsPorBulto'){
          const b=field==='bultos'?val:l.bultos;
          const a=field==='artsPorBulto'?val:l.artsPorBulto;
          if(b&&a)updated.cantFis=b*a;
        }
        if(field==='cantFis'){updated.diff=val!==null?val-(l.cantRemito||0):null;updated.ok=val!==null?val>=(l.cantRemito||0):null;}
        return updated;
      });
      const next={...prev,lineas};saveRec(next);return next;
    });
  },[saveRec]);

  const asignarCodigo=useCallback((idx,codI)=>{
    const a=art[codI];if(!a)return;
    setRec(prev=>{const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,codI,desc:a.desc});const next={...prev,lineas};saveRec(next);return next;});
  },[art,saveRec]);

  const conformeTodo=()=>{setRec(prev=>{const lineas=prev.lineas.map(l=>({...l,cantFis:l.cantRemito||0,diff:0,ok:true}));const next={...prev,lineas};saveRec(next);return next;});};

  // ─── Foto evidencia ───────────────────────────────────────────────────────
  const cargarFoto=async(file)=>{const reader=new FileReader();reader.onload=e=>{setRec(prev=>{const next={...prev,fotoEvidencia:e.target.result};saveRec(next);return next;});};reader.readAsDataURL(file);};

  // ─── Imprimir registro ────────────────────────────────────────────────────
  const imprimirRegistro=()=>{
    const w=window.open('','_blank');
    const totRem=rec.lineas.reduce((s,l)=>s+(l.cantRemito||0),0);
    const totFis=rec.lineas.reduce((s,l)=>s+(l.cantFis||0),0);
    w.document.write(`<!DOCTYPE html><html><head><title>RC ${rec.meta.rc}</title>
<style>body{font-family:Arial,sans-serif;font-size:10px;margin:20px}h1{font-size:15px}h2{font-size:11px;margin-top:6px}.info{display:flex;gap:20px;margin:8px 0;padding:7px;background:#f8f8f8;border-radius:3px;flex-wrap:wrap}.ii{min-width:140px}.il{font-size:8px;color:#888;text-transform:uppercase;margin-bottom:1px}.iv{font-weight:600;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#111;color:#fff;padding:4px 6px;font-size:8px;text-transform:uppercase;text-align:left}td{padding:4px 6px;border-bottom:1px solid #ddd;font-size:9px}.r{text-align:right}.red{color:#c00}.firma-row{display:flex;gap:40px;margin-top:40px}.fi{flex:1;text-align:center;border-top:1px solid #333;padding-top:5px;font-size:8px}</style></head>
<body><h1>DELMY PARTY SRL — REGISTRO DE RECEPCIÓN</h1>
<h2>IT-REC-001 | Rev.1 · RC: <b>${rec.meta.rc||'—'}</b></h2>
<div class="info">
${[['PROVEEDOR',rec.meta.proveedor||'—'],['Nº REMITO',rec.meta.nRemito||'—'],['OC ASOCIADA',rec.meta.nOC||'—'],['FECHA DOC.',rec.meta.fecha||'—'],['TRANSPORTISTA',`${rec.meta.transportista||'—'} ${rec.meta.patente?'('+rec.meta.patente+')':''}`],['HORA LLEGADA',rec.meta.horaLlegada||'—'],['TOTAL BULTOS',rec.meta.totalBultos||'—']].map(([l,v])=>`<div class="ii"><div class="il">${l}</div><div class="iv">${v}</div></div>`).join('')}
</div>
<table><thead><tr><th>#</th><th>CÓD.DOC</th><th>CÓD.BASE</th><th>DESCRIPCIÓN</th><th class="r">CANT.OC</th><th class="r">CANT.REMITO</th><th class="r">BULTOS</th><th class="r">ARTS/BULTO</th><th class="r">CANT.FÍSICA</th><th class="r">DIFERENCIA</th><th>UBICACIÓN</th></tr></thead>
<tbody>
${rec.lineas.map((l,i)=>`<tr><td>${i+1}</td><td style="font-family:Courier New,monospace">${l.codDoc||'—'}</td><td style="font-family:Courier New,monospace;color:#555">${l.codI||'—'}</td><td>${l.desc||'—'}</td><td class="r">${l.cantOC??'—'}</td><td class="r">${l.cantRemito??'—'}</td><td class="r">${l.bultos??'—'}</td><td class="r">${l.artsPorBulto??'—'}</td><td class="r ${l.cantFis<l.cantRemito?'red':''}">${l.cantFis??'—'}</td><td class="r ${l.diff<0?'red':''}">${l.diff!=null?(l.diff>0?'+':'')+l.diff:'—'}</td><td>${l.ub||'___ - ___ - ___ - ___'}</td></tr>`).join('')}
<tr style="font-weight:700;background:#f8f8f8"><td colspan="5"></td><td class="r">${totRem}</td><td colspan="2"></td><td class="r">${totFis}</td><td class="r">${totFis-totRem}</td><td></td></tr>
</tbody></table>
${rec.meta.obs?`<p style="margin-top:6px"><b>Obs llegada:</b> ${rec.meta.obs}</p>`:''}
${rec.meta.obsFinal?`<p><b>Obs cierre:</b> ${rec.meta.obsFinal}</p>`:''}
<p style="margin-top:6px;font-size:8px;color:#888">Generado: ${new Date().toLocaleString('es-AR')} · Delmy Party SRL · Industrial Partner</p>
<p style="font-size:7px;color:#888">Ubicación: PL01-F/T-A/B/C-1-9 (Pallet · Frente/Trasero · Columna · Altura)</p>
<div class="firma-row"><div class="fi">Recibido por<br><br><br>Nombre y Firma</div><div class="fi">Verificado por<br><br><br>Nombre y Firma</div><div class="fi">Transportista/Proveedor<br><br><br>Nombre y Firma</div><div class="fi">Autorizado por<br><br><br>Nombre y Firma</div></div>
</body></html>`);w.document.close();w.print();
  };

  // ─── Imprimir etiquetas de bultos ─────────────────────────────────────────
  const imprimirEtiquetas=()=>{
    const totalBultos=rec.meta.totalBultos||rec.lineas.reduce((s,l)=>s+(l.bultos||0),0)||1;
    const rc=rec.meta.rc||'—';
    const prov=(rec.meta.proveedor||'PROV').toUpperCase().slice(0,10);
    const w=window.open('','_blank');
    const etiquetas=Array.from({length:totalBultos},(_,i)=>i+1);
    w.document.write(`<!DOCTYPE html><html><head><title>Etiquetas ${rc}</title>
<style>
body{margin:0;padding:10px;font-family:Arial Black,sans-serif}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.etq{border:2px solid #000;padding:10px;text-align:center;page-break-inside:avoid}
.rc{font-size:9px;font-weight:900;letter-spacing:.08em}
.bulto{font-size:28px;font-weight:900;margin:4px 0}
.prov{font-size:8px;color:#444;letter-spacing:.05em}
.nro{font-size:10px;color:#555}
@media print{body{margin:0;padding:5px}}
</style></head><body>
<div class="grid">
${etiquetas.map(n=>`<div class="etq">
  <div class="prov">${prov}</div>
  <div class="rc">${rc}</div>
  <div class="bulto">BULTO ${n}</div>
  <div class="nro">de ${totalBultos}</div>
</div>`).join('')}
</div>
</body></html>`);w.document.close();w.print();
  };

  const resetRec=()=>{
    if(!window.confirm('¿Iniciar nueva recepción?'))return;
    const fresh={meta:{proveedor:'',nRemito:'',nOC:'',fecha:new Date().toISOString().slice(0,10),transportista:'',patente:'',horaLlegada:'',obs:'',obsFinal:'',rc:'',totalBultos:null},lineas:[],fotoEvidencia:null,cerrada:false};
    setRec(fresh);saveRec(fresh);setEtapa('documento');setIaStatus('');
  };

  const ETAPAS=[{id:'documento',n:1,l:'DOCUMENTO',s:'Remito/Factura'},{id:'registro',n:2,l:'REGISTRO',s:'Datos llegada'},{id:'control',n:3,l:'CONTROL',s:'Verificación física'},{id:'validacion',n:4,l:'VALIDACIÓN',s:'OC vs Físico'},{id:'cierre',n:5,l:'CIERRE',s:'Confirmar'}];
  const etIdx=ETAPAS.findIndex(e=>e.id===etapa);
  const stats={total:rec.lineas.length,conformes:rec.lineas.filter(l=>l.ok===true).length,faltantes:rec.lineas.filter(l=>l.ok===false).length,sinCtrl:rec.lineas.filter(l=>l.cantFis===null).length};

  return(
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:C.bg}}>
      {/* Header */}
      <div style={{background:C.p2,borderBottom:`1px solid ${C.b1}`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',padding:'7px 14px',borderBottom:`1px solid ${C.b1}`,gap:10,flexWrap:'wrap'}}>
          <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700,color:C.acc}}>RECEPCIÓN</span>
          {rec.meta.rc&&<span style={{fontSize:10,color:C.teal,fontFamily:'DM Mono,monospace',fontWeight:600}}>{rec.meta.rc}</span>}
          {rec.meta.proveedor&&<span style={{fontSize:11,color:C.txt}}>— {rec.meta.proveedor}</span>}
          <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
            <button onClick={imprimirEtiquetas} disabled={!rec.lineas.length} style={{...Btn(C.vio,'rgba(192,132,252,.08)'),opacity:rec.lineas.length?.1:undefined}}>🏷 Etiquetas</button>
            <button onClick={imprimirRegistro}  disabled={!rec.lineas.length} style={{...Btn(C.teal,'rgba(45,212,191,.08)'),opacity:rec.lineas.length?.1:undefined}}>🖨 Imprimir</button>
            <button onClick={resetRec} style={Btn(C.mut)}>+ Nueva recepción</button>
          </div>
        </div>
        {/* Steps */}
        <div style={{display:'flex',overflowX:'auto'}}>
          {ETAPAS.map((e,i)=>{const act=etapa===e.id,done=etIdx>i;const col=done?C.green:act?C.acc:C.mut;const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':C.b1;return(
            <div key={e.id} onClick={()=>setEtapa(e.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'8px 12px',cursor:'pointer',borderBottom:act?`2px solid ${C.acc}`:'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
              <div style={{width:17,height:17,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
              <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
              {i<4&&<div style={{color:C.b1,marginLeft:3}}>›</div>}
            </div>
          );})}
        </div>
      </div>

      {/* Contenido */}
      <div style={{flex:1,overflow:'auto',padding:14}}>

        {/* E1 — DOCUMENTO */}
        {etapa==='documento'&&(
          <div style={{maxWidth:820}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:10}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700}}>E1 — Carga del documento</span>
                <span style={{fontSize:10,color:C.mut}}>Siempre arranca con el remito o factura del proveedor</span>
              </div>
              <div style={{padding:14}}>
                {/* OC asociada */}
                {OCS.length>0&&(
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>ASOCIAR A ORDEN DE COMPRA</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {OCS.map(oc=>(
                        <div key={oc.id} onClick={()=>setOcSel(ocSel?.id===oc.id?null:oc)}
                          style={{padding:'6px 12px',border:`1px solid ${ocSel?.id===oc.id?C.acc:C.b1}`,borderRadius:4,cursor:'pointer',background:ocSel?.id===oc.id?'rgba(240,192,64,.08)':'transparent'}}>
                          <div style={{fontSize:10,color:C.acc,fontWeight:500}}>{oc.meta?.proveedor||'(sin prov)'}</div>
                          <div style={{fontSize:9,color:C.mut}}>{oc.meta?.fecha||''} · {oc.lineas?.length||0} arts · {oc.meta?.estado||''}</div>
                        </div>
                      ))}
                    </div>
                    {ocSel&&<div style={{marginTop:6,fontSize:9,color:C.green}}>✓ OC asociada: {ocSel.meta?.proveedor} · {ocSel.lineas?.length} artículos</div>}
                  </div>
                )}

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                  <div>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>SUBIR REMITO O FACTURA</div>
                    <div onClick={()=>fileRef.current.click()} style={{border:`2px dashed ${C.b1}`,borderRadius:4,padding:16,textAlign:'center',cursor:'pointer',marginBottom:8}}>
                      <div style={{fontSize:26,marginBottom:5}}>📄</div>
                      <div style={{fontSize:12,color:C.txt}}>Arrastrar o hacer click</div>
                      <div style={{fontSize:9,color:C.mut,marginTop:2}}>JPG · PNG · WEBP · PDF · Excel</div>
                    </div>
                    {iaStatus&&<div style={{fontSize:10,color:C.acc,textAlign:'center',marginBottom:8}}>{iaStatus}</div>}
                    <button onClick={()=>fileRef.current.click()} style={{...Btn(C.acc,'rgba(240,192,64,.1)'),width:'100%',fontWeight:600}}>✦ Subir documento</button>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])procesarDoc(e.target.files[0]);e.target.value='';}} />
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>CARGA MANUAL</div>
                    <div style={{display:'flex',flexDirection:'column',gap:7}}>
                      {[['PROVEEDOR','proveedor',''],['Nº REMITO / FACTURA','nRemito','0001-00012345'],['OC ASOCIADA','nOC','Número de OC']].map(([lbl,f,ph])=>(
                        <div key={f}>
                          <div style={{fontSize:8,color:C.mut,marginBottom:2,textTransform:'uppercase',letterSpacing:'.05em'}}>{lbl}</div>
                          <input value={rec.meta[f]||''} placeholder={ph} onChange={e=>updMeta(f,e.target.value)} style={IS} />
                        </div>
                      ))}
                      <button onClick={()=>{updMeta('rc',generarRC(rec.meta.proveedor));updMeta('horaLlegada',new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}));setEtapa('registro');}} style={{...Btn(C.mut),marginTop:4}}>Continuar sin documento →</button>
                    </div>
                  </div>
                </div>
                {rec.lineas.length>0&&<Alrt cls="ok">✓ {rec.lineas.length} líneas cargadas · {rec.lineas.filter(l=>l.codI).length} reconocidas en base · <span onClick={()=>setEtapa('registro')} style={{textDecoration:'underline',cursor:'pointer'}}>Ir a Registro →</span></Alrt>}
              </div>
            </div>
          </div>
        )}

        {/* E2 — REGISTRO */}
        {etapa==='registro'&&(
          <div style={{maxWidth:820}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:10}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`}}>
                <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700}}>E2 — Datos de llegada</span>
                {rec.meta.rc&&<span style={{fontSize:10,color:C.teal,marginLeft:12,fontFamily:'DM Mono,monospace'}}>RC: {rec.meta.rc}</span>}
              </div>
              <div style={{padding:14}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:9,marginBottom:12}}>
                  {[['PROVEEDOR','proveedor',''],['Nº REMITO','nRemito',''],['OC ASOCIADA','nOC',''],['FECHA DOC.','fecha','date'],['TRANSPORTISTA','transportista',''],['PATENTE','patente','AB 123 CD']].map(([lbl,f,ph])=>(
                    <div key={f}>
                      <div style={{fontSize:8,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.05em'}}>{lbl}</div>
                      <input type={ph==='date'?'date':'text'} value={rec.meta[f]||''} placeholder={ph} onChange={e=>updMeta(f,e.target.value)} style={IS} />
                    </div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:9,marginBottom:12}}>
                  <div>
                    <div style={{fontSize:8,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.05em'}}>HORA LLEGADA</div>
                    <div style={{display:'flex',gap:5}}>
                      <input value={rec.meta.horaLlegada||''} placeholder="HH:MM" onChange={e=>updMeta('horaLlegada',e.target.value)} style={{...IS,flex:1}} />
                      <button onClick={()=>updMeta('horaLlegada',new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}))} style={{...Btn(C.mut),padding:'4px 7px',fontSize:9}}>⏱</button>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.05em'}}>TOTAL BULTOS</div>
                    <NumIn value={rec.meta.totalBultos} onChange={v=>updMeta('totalBultos',v)} color={C.acc} width={'100%'} placeholder="Cant. bultos" />
                  </div>
                  <div style={{gridColumn:'span 2'}}>
                    <div style={{fontSize:8,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.05em'}}>OBSERVACIONES DE LLEGADA</div>
                    <input value={rec.meta.obs||''} placeholder="Estado embalaje, incidencias..." onChange={e=>updMeta('obs',e.target.value)} style={IS} />
                  </div>
                </div>

                {rec.lineas.length>0&&(
                  <div style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:10,marginBottom:10}}>
                    <div style={{fontSize:8,color:C.mut,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}>RESUMEN DEL DOCUMENTO</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                      {[{l:'ARTÍCULOS',v:rec.lineas.length,c:C.txt},{l:'TOTAL UNIDADES DOC.',v:fn(rec.lineas.reduce((s,l)=>s+(l.cantRemito||0),0)),c:C.acc},{l:'RECONOCIDOS EN BASE',v:rec.lineas.filter(l=>l.codI).length,c:C.green},{l:'SIN RECONOCER',v:rec.lineas.filter(l=>!l.codI).length,c:rec.lineas.filter(l=>!l.codI).length>0?C.red:C.mut}].map(k=>(
                        <div key={k.l}><div style={{fontSize:7,color:C.mut,letterSpacing:'.07em',marginBottom:2,textTransform:'uppercase'}}>{k.l}</div><div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div></div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button onClick={()=>setEtapa('documento')} style={Btn(C.mut)}>← Volver</button>
                  <button onClick={imprimirRegistro} style={Btn(C.teal,'rgba(45,212,191,.08)')}>🖨 Imprimir registro</button>
                  <button onClick={()=>setEtapa('control')} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Control físico →</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* E3 — CONTROL FÍSICO */}
        {etapa==='control'&&(
          <div>
            {rec.lineas.length===0?<Alrt cls="warn">Sin líneas. Cargá el documento primero.</Alrt>:(
              <>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:9,color:C.mut}}>Ingresá bultos · artículos/bulto · o cantidad física directamente</span>
                  <span style={{fontSize:9,padding:'2px 7px',borderRadius:3,background:'rgba(74,222,128,.12)',color:C.green,border:'1px solid rgba(74,222,128,.3)'}}>{stats.conformes} conformes</span>
                  <span style={{fontSize:9,padding:'2px 7px',borderRadius:3,background:'rgba(248,113,113,.12)',color:C.red,border:'1px solid rgba(248,113,113,.3)'}}>{stats.faltantes} faltantes</span>
                  <span style={{fontSize:9,color:C.mut}}>{stats.sinCtrl} sin controlar</span>
                  <button onClick={()=>setRec(prev=>{const lineas=estimarBultos(prev.lineas);const next={...prev,lineas};saveRec(next);return next;})} style={{...Btn(C.vio,'rgba(192,132,252,.08)'),marginLeft:4}}>≈ Estimar bultos</button>
                  <button onClick={conformeTodo} style={{...Btn(C.green,'rgba(74,222,128,.08)'),marginLeft:'auto'}}>✓ Todo conforme</button>
                </div>

                <div style={{overflowX:'auto',background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:10}}>
                  <table style={{borderCollapse:'collapse',width:'100%',minWidth:1000}}>
                    <thead>
                      <tr>
                        {[['#',C.mut],['CÓD.DOC',C.blue],['CÓD.BASE',C.teal],['DESCRIPCIÓN',C.mut],['CANT.OC',C.mut],['CANT.REMITO',C.acc],['BULTOS',C.vio],['ARTS/BULTO',C.vio],['CANT.FÍSICA',C.green],['DIFERENCIA',C.mut],['UBICACIÓN',C.mut],['OK',C.mut]].map(([h,c],i)=>(
                          <th key={i} style={{fontSize:8,color:c,padding:'4px 6px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.05em',textAlign:i>3?'right':'left'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rec.lineas.map((l,i)=>{
                        const rowBg=l.ok===false?'rgba(248,113,113,.04)':l.ok===true?'rgba(74,222,128,.02)':'transparent';
                        const td=(c,s)=><td style={{padding:'4px 6px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
                        const cands=buscar(l.desc,l.codDoc,rec.meta.proveedor,art).slice(0,5);
                        return(
                          <tr key={i} style={{background:rowBg}}>
                            {td(i+1,{fontSize:9,color:C.mut})}
                            {td(l.codDoc||'—',{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                            {td(
                              l.codI
                                ?<span style={{fontSize:9,color:C.teal,fontFamily:'DM Mono,monospace',cursor:'pointer'}} onClick={()=>{const c=window.prompt('Cambiar código base (dejar vacío para cancelar):',l.codI||'');if(c&&c.trim()&&art[c.trim()])asignarCodigo(i,c.trim());}}>{l.codI}</span>
                                :<div>
                                    <select onChange={e=>{if(e.target.value)asignarCodigo(i,e.target.value);}} defaultValue="" style={{fontSize:9,background:C.bg,color:C.red,border:`1px solid ${C.red}`,borderRadius:3,fontFamily:'DM Mono,monospace',maxWidth:130,marginBottom:2}}>
                                      <option value="">— Asignar código —</option>
                                      {cands.map(({cod,a})=><option key={cod} value={cod}>{cod} · {a.desc.slice(0,25)}</option>)}
                                    </select>
                                    {cands.length===0&&<div style={{fontSize:8,color:C.mut}}>Sin candidatos · DB sin datos del proveedor</div>}
                                  </div>
                            )}
                            {td(<span title={l.desc} style={{display:'block',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc||'—'}</span>)}
                            {td(l.cantOC??'—',{textAlign:'right',color:C.mut,fontSize:9})}
                            {td(l.cantRemito??'—',{textAlign:'right',fontWeight:500})}
                            <td style={{padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,textAlign:'right',verticalAlign:'middle'}}>
                              <NumIn value={l.bultos} onChange={v=>updLinea(i,'bultos',v)} color={C.vio} width={60} />
                            </td>
                            <td style={{padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,textAlign:'right',verticalAlign:'middle'}}>
                              <NumIn value={l.artsPorBulto} onChange={v=>updLinea(i,'artsPorBulto',v)} color={C.vio} width={60} />
                            </td>
                            <td style={{padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,textAlign:'right',verticalAlign:'middle'}}>
                              <NumIn value={l.cantFis} onChange={v=>updLinea(i,'cantFis',v)} color={C.green} />
                            </td>
                            {td(l.diff===null?'—':<span style={{color:l.diff===0?C.green:l.diff<0?C.red:C.blue,fontWeight:600}}>{l.diff>0?'+':''}{l.diff}</span>,{textAlign:'right'})}
                            <td style={{padding:'3px 4px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}>
                              <input value={l.ub||''} placeholder="PL01-F-A-1" onChange={e=>updLinea(i,'ub',e.target.value)} style={{width:90,padding:'3px 5px',fontSize:9,...IS}} />
                            </td>
                            {td(l.ok===true?'✓':l.ok===false?'✗':'—',{textAlign:'center',fontSize:12,color:l.ok===true?C.green:l.ok===false?C.red:C.mut,fontWeight:600})}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button onClick={()=>setEtapa('registro')} style={Btn(C.mut)}>← Volver</button>
                  <button onClick={()=>setEtapa('validacion')} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Validación →</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* E4 — VALIDACIÓN */}
        {etapa==='validacion'&&(
          <div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700,marginBottom:8}}>E4 — Validación cruzada: OC vs Remito vs Físico</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:7,marginBottom:10}}>
              {[{l:'ARTÍCULOS',v:stats.total,c:C.txt},{l:'CONFORMES',v:stats.conformes,c:C.green},{l:'FALTANTES',v:stats.faltantes,c:stats.faltantes>0?C.red:C.mut},{l:'SIN CONTROLAR',v:stats.sinCtrl,c:stats.sinCtrl>0?C.ora:C.mut}].map(k=>(
                <div key={k.l} style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px'}}>
                  <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
                  <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
                </div>
              ))}
            </div>
            {stats.faltantes>0&&<Alrt cls="err">✗ {stats.faltantes} artículos con faltante físico vs remito</Alrt>}
            {stats.sinCtrl>0&&<Alrt cls="warn">⚠ {stats.sinCtrl} artículos sin controlar — volvé a E3</Alrt>}
            {stats.faltantes===0&&stats.sinCtrl===0&&<Alrt cls="ok">✓ Recepción conforme — todos controlados sin diferencias</Alrt>}

            <div style={{overflowX:'auto',background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:10}}>
              <table style={{borderCollapse:'collapse',width:'100%',minWidth:900}}>
                <thead><tr>
                  {[['CÓDIGO BASE',C.teal],['DESCRIPCIÓN',C.mut],['CANT.OC',C.blue],['CANT.REMITO',C.acc],['BULTOS',C.vio],['CANT.FÍSICA',C.green],['REM-OC',C.mut],['FIS-REM',C.mut],['UBICACIÓN',C.mut],['ESTADO',C.mut]].map(([h,c],i)=>(
                    <th key={i} style={{fontSize:8,color:c,padding:'5px 6px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.05em',textAlign:i>1?'right':'left'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rec.lineas.map((l,i)=>{
                    const ocLinea=ocSel?ocSel.lineas?.find(ol=>ol.cod===l.codI||ol.codp===l.codDoc):null;
                    const cantOC=ocLinea?.cantOC??l.cantOC??null;
                    const difRO=cantOC!==null?(l.cantRemito||0)-cantOC:null;
                    const difFR=l.cantFis!==null?l.cantFis-(l.cantRemito||0):null;
                    const estado=l.cantFis===null?{t:'Sin controlar',c:C.mut}:l.cantFis>=(l.cantRemito||0)?{t:'✓ Conforme',c:C.green}:{t:'✗ Faltante',c:C.red};
                    const td=(c,s)=><td style={{padding:'5px 6px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
                    return(
                      <tr key={i} style={{background:l.ok===false?'rgba(248,113,113,.04)':l.ok===true?'rgba(74,222,128,.02)':'transparent'}}>
                        {td(l.codI||l.codDoc||'—',{fontSize:9,color:C.teal,fontFamily:'DM Mono,monospace'})}
                        {td(<span title={l.desc} style={{display:'block',maxWidth:170,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc||'—'}</span>)}
                        {td(cantOC??'—',{textAlign:'right',color:cantOC?C.blue:C.mut})}
                        {td(l.cantRemito??'—',{textAlign:'right',color:C.acc,fontWeight:500})}
                        {td(l.bultos??'—',{textAlign:'right',color:C.vio})}
                        {td(l.cantFis??'—',{textAlign:'right',color:l.cantFis!==null?C.green:C.mut,fontWeight:500})}
                        {td(difRO===null?'—':<span style={{color:difRO===0?C.green:Math.abs(difRO)<3?C.acc:C.red,fontWeight:600}}>{difRO>0?'+':''}{difRO}</span>,{textAlign:'right'})}
                        {td(difFR===null?'—':<span style={{color:difFR===0?C.green:difFR<0?C.red:C.blue,fontWeight:600}}>{difFR>0?'+':''}{difFR}</span>,{textAlign:'right'})}
                        {td(l.ub||'—',{fontSize:9,color:C.mut,fontFamily:'DM Mono,monospace'})}
                        {td(<span style={{fontSize:9,color:estado.c,fontWeight:500}}>{estado.t}</span>,{textAlign:'center'})}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEtapa('control')} style={Btn(C.mut)}>← Volver</button>
              <button onClick={()=>setEtapa('cierre')} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Cierre →</button>
            </div>
          </div>
        )}

        {/* E5 — CIERRE */}
        {etapa==='cierre'&&(
          <div style={{maxWidth:700}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`}}>
                <span style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700}}>E5 — Cierre de recepción</span>
              </div>
              <div style={{padding:14}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                  {[{l:'ARTÍCULOS',v:stats.total,c:C.txt},{l:'CONFORMES',v:stats.conformes,c:C.green},{l:'FALTANTES',v:stats.faltantes,c:stats.faltantes>0?C.red:C.mut},{l:'SIN UBICAR',v:rec.lineas.filter(l=>!l.ub).length,c:rec.lineas.filter(l=>!l.ub).length>0?C.ora:C.mut}].map(k=>(
                    <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px',textAlign:'center'}}>
                      <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
                      <div style={{fontFamily:'Syne,sans-serif',fontSize:19,fontWeight:700,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>
                {stats.faltantes>0&&<Alrt cls="err">✗ {stats.faltantes} artículos con faltante</Alrt>}
                {stats.sinCtrl>0&&<Alrt cls="warn">⚠ {stats.sinCtrl} sin controlar — recomendado volver a E3</Alrt>}

                {/* Foto evidencia */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>FOTO DEL REGISTRO FIRMADO (evidencia)</div>
                  {rec.fotoEvidencia
                    ?<div style={{position:'relative',display:'inline-block'}}>
                        <img src={rec.fotoEvidencia} alt="evidencia" style={{maxWidth:'100%',maxHeight:180,borderRadius:4,border:`1px solid ${C.b1}`}} />
                        <button onClick={()=>{setRec(prev=>{const n={...prev,fotoEvidencia:null};saveRec(n);return n;});}} style={{position:'absolute',top:4,right:4,background:'rgba(0,0,0,.7)',border:'none',color:C.txt,borderRadius:3,padding:'2px 6px',cursor:'pointer',fontSize:10}}>✕</button>
                      </div>
                    :<div onClick={()=>fotoRef.current.click()} style={{border:`2px dashed ${C.b1}`,borderRadius:4,padding:'18px',textAlign:'center',cursor:'pointer'}}>
                        <div style={{fontSize:22,marginBottom:5}}>📷</div>
                        <div style={{fontSize:11,color:C.txt}}>Subir foto del registro firmado</div>
                        <div style={{fontSize:9,color:C.mut,marginTop:2}}>JPG · PNG · WEBP</div>
                      </div>
                  }
                  <input ref={fotoRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{display:'none'}} onChange={e=>{if(e.target.files[0])cargarFoto(e.target.files[0]);e.target.value='';}} />
                </div>

                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>OBSERVACIONES FINALES</div>
                  <textarea rows={3} value={rec.meta.obsFinal||''} onChange={e=>updMeta('obsFinal',e.target.value)}
                    placeholder="Estado general, incidencias de cierre..."
                    style={{...IS,height:65,resize:'vertical',padding:'6px 8px'}} />
                </div>

                <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
                  <button onClick={()=>setEtapa('validacion')} style={Btn(C.mut)}>← Revisar</button>
                  <button onClick={imprimirEtiquetas} style={Btn(C.vio,'rgba(192,132,252,.08)')}>🏷 Etiquetas bultos</button>
                  <button onClick={imprimirRegistro}  style={Btn(C.teal,'rgba(45,212,191,.08)')}>🖨 Imprimir registro</button>
                  {rec.cerrada
                    ?<Alrt cls="ok" style={{margin:0,padding:'6px 14px'}}>✓ Cerrada {new Date(rec.fechaCierre).toLocaleString('es-AR')}</Alrt>
                    :<button onClick={()=>{const n={...rec,cerrada:true,fechaCierre:now()};setRec(n);saveRec(n);alert('✓ Recepción cerrada');}} style={{background:C.green,color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 20px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:700,cursor:'pointer'}}>✓ Cerrar recepción</button>
                  }
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
