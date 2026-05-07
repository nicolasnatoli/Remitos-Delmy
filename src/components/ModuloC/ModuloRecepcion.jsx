// ===== MÓDULO RECEPCIÓN V2 =====
// Flujo: Documento → Registro → Control físico → Validación OC vs Remito vs Físico → Cierre
import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';

const fn = n => Number(n||0).toLocaleString('es-AR');
const tryGet=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}};
const trySet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

const SK={
  art:'dm_art_v3', stk:'dm_stk_v3',
  ocs:'dm_ocs_v3', rec:'dm_rec_v3',
};

const expandArt=c=>{const o={};for(const[k,s]of Object.entries(c||{})){const p=s.split('|');o[k]={prov:p[0]||'',codp:p[1]||'',desc:p[2]||'',fam:p[3]||'',cat:p[4]||'',costoReal:+p[6]||0};}return o;};

function buildCodpIdx(art){const idx={};for(const[cod,a]of Object.entries(art)){const cp=String(a.codp||'').trim();if(cp){if(!idx[cp])idx[cp]=[];idx[cp].push(cod);}}return idx;}
function cruzarCodigo(codExt,art,idx){const cod=String(codExt||'').trim();if(!cod)return null;if(idx[cod]?.length)return idx[cod][0];const sc=cod.replace(/^0+/,'');if(idx[sc]?.length)return idx[sc][0];for(const[cp,cods]of Object.entries(idx)){if(cp.includes(cod)||cod.includes(cp))return cods[0];}if(art[cod])return cod;return null;}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const C={bg:'#0c0e14',panel:'#111420',p2:'#0d0f1a',b1:'#1e2133',b2:'#181b27',acc:'#f0c040',green:'#4ade80',red:'#f87171',blue:'#60a5fa',vio:'#c084fc',teal:'#2dd4bf',ora:'#fb923c',txt:'#e8eaf0',mut:'#6b7280'};
const IS={background:C.bg,color:C.txt,border:`1px solid ${C.b1}`,borderRadius:4,fontFamily:'DM Mono,monospace',fontSize:11,padding:'4px 8px',outline:'none',width:'100%'};
const Btn=(col,bg)=>({cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,borderRadius:4,padding:'5px 11px',border:`1px solid ${col||C.b1}`,background:bg||'transparent',color:col||C.txt,whiteSpace:'nowrap'});
const Alert=({cls,children})=>{const s={ok:{background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',color:C.green},warn:{background:'rgba(240,192,64,.08)',border:'1px solid rgba(240,192,64,.2)',color:C.acc},err:{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',color:C.red},info:{background:'rgba(96,165,250,.08)',border:'1px solid rgba(96,165,250,.2)',color:C.blue}}[cls]||{};return <div style={{borderRadius:4,padding:'7px 11px',fontSize:10,marginBottom:7,...s}}>{children}</div>;};

function NumInput({value,onChange,color,disabled,width=70,placeholder='—'}){
  const [local,setLocal]=useState(value||'');
  const ref=useRef();
  React.useEffect(()=>{if(document.activeElement!==ref.current)setLocal(value||'');},[value]);
  return(<input ref={ref} type="text" inputMode="numeric" value={local} placeholder={placeholder} disabled={disabled}
    onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,'');setLocal(v);onChange(v===''?null:parseInt(v,10));}}
    onBlur={()=>setLocal(value===null||value===undefined?'':value||'')}
    style={{width,padding:'3px 5px',fontSize:10,textAlign:'right',background:C.bg,color:value>0?(color||C.acc):C.txt,border:`1px solid ${value>0?(color||C.acc):C.b1}`,borderRadius:3,fontFamily:'DM Mono,monospace',outline:'none',opacity:disabled?.3:1}} />);
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function ModuloRecepcion(){
  const [etapa, setEtapa] = useState('documento'); // documento | registro | control | validacion | cierre
  const [recData, setRecData] = useState(()=>{
    const saved=tryGet(SK.rec,null);
    return saved||{meta:{proveedor:'',nRemito:'',nOC:'',fecha:new Date().toISOString().slice(0,10),transportista:'',patente:'',horaLlegada:'',obs:''},lineas:[],fotoEvidencia:null,cerrada:false};
  });
  const [ocData,  setOcData]  = useState(null); // OC activa para cruzar
  const [iaStatus,setIaStatus]= useState('');
  const fileRef  = useRef();
  const fotoRef  = useRef();

  const art    = React.useMemo(()=>{const c=tryGet(SK.art,null);return c?expandArt(c):{};}, []);
  const codpIdx= React.useMemo(()=>buildCodpIdx(art),[art]);

  // Cargar OC activa para cruce
  React.useEffect(()=>{
    const ocs=tryGet(SK.ocs,[]);
    if(!ocs.length)return;
    const last=tryGet('dm_oc_v3_'+ocs[ocs.length-1],null);
    if(last)setOcData(last);
  },[]);

  const saveRec=useCallback((data)=>{ trySet(SK.rec,data); },[]);

  const updMeta=(field,val)=>{
    setRecData(prev=>{const next={...prev,meta:{...prev.meta,[field]:val}};saveRec(next);return next;});
  };

  // ─── Procesar documento (remito/factura) ──────────────────────────────────
  const procesarDocumento=useCallback(async(file)=>{
    const ext=file.name.toLowerCase().split('.').pop();
    if(ext==='xlsx'||ext==='xls'){
      await procesarExcelDoc(file);
    } else {
      await procesarConIA(file);
    }
  },[art,codpIdx]); // eslint-disable-line

  const procesarExcelDoc=async(file)=>{
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
    const iPrecio=hdrs.findIndex(h=>/prec|unit|subtot/.test(h));
    const lineas=[];
    for(let i=hRow+1;i<raw.length;i++){
      const r=raw[i];const codDoc=String(r[iCod]||'').trim();if(!codDoc||codDoc.length<2)continue;
      const codI=cruzarCodigo(codDoc,art,codpIdx)||codDoc;
      const a=art[codI]||{desc:'',codp:codDoc};
      lineas.push({codDoc,codI:codI!==codDoc?codI:null,desc:a.desc||String(r[iDesc]||'').trim(),cantRemito:parseFloat(String(r[iCant]||'0').replace(',','.'))||0,precioUnit:iPrecio>=0?parseFloat(String(r[iPrecio]||'0').replace(',','.'))||0:0,cantRec:null,ub:'',ok:null,obs:''});
    }
    if(!lineas.length){alert('Sin líneas en el documento');return;}
    setRecData(prev=>{const next={...prev,lineas};saveRec(next);return next;});
    setEtapa('registro');
  };

  const procesarConIA=async(file)=>{
    setIaStatus('Analizando documento con IA...');
    try{
      const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
      const reader=new FileReader();
      const b64=await new Promise(res=>{reader.onload=e=>res(e.target.result.split(',')[1]);reader.readAsDataURL(file);});
      const mtype=isPdf?'application/pdf':file.type||'image/jpeg';
      // Llamada via servidor (evita CORS)
      const res=await fetch('/api/ia/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:b64,mediaType:mtype})});
      if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||'Error servidor: '+res.status);}
      const result=await res.json();
      const txt=result.text||'';
      const parsed=JSON.parse(txt.replace(/```json|```/g,'').trim());

      // Cruzar códigos con la base
      const lineas=(parsed.lineas||[]).map(l=>{
        const codI=cruzarCodigo(l.cod,art,codpIdx);
        const a=codI?art[codI]:null;
        return{codDoc:l.cod,codI:codI||null,desc:a?.desc||l.desc||'',cantRemito:Number(l.cant)||0,precioUnit:Number(l.precioUnit)||0,cantRec:null,ub:'',ok:null,obs:''};
      });

      setRecData(prev=>{
        const next={...prev,
          meta:{...prev.meta,proveedor:parsed.proveedor||prev.meta.proveedor,nRemito:parsed.nDocumento||prev.meta.nRemito,fecha:parsed.fecha?parsed.fecha.split('/').reverse().join('-'):prev.meta.fecha},
          lineas};
        saveRec(next);return next;
      });
      setIaStatus('');
      setEtapa('registro');
    }catch(e){setIaStatus('Error: '+e.message);}
  };

  // ─── Foto evidencia ───────────────────────────────────────────────────────
  const cargarFoto=useCallback(async(file)=>{
    if(!file)return;
    const reader=new FileReader();
    reader.onload=e=>{
      setRecData(prev=>{const next={...prev,fotoEvidencia:e.target.result};saveRec(next);return next;});
    };
    reader.readAsDataURL(file);
  },[saveRec]);

  // ─── Control físico ───────────────────────────────────────────────────────
  const updRec=useCallback((idx,val)=>{
    setRecData(prev=>{
      const lineas=prev.lineas.map((l,i)=>{
        if(i!==idx)return l;
        const cantRec=val===null?null:parseInt(val)||0;
        const diff=cantRec!==null?cantRec-(l.cantRemito||0):null;
        return{...l,cantRec,diff,ok:cantRec!==null?cantRec>=(l.cantRemito||0):null};
      });
      const next={...prev,lineas};saveRec(next);return next;
    });
  },[saveRec]);

  const updUb=useCallback((idx,val)=>{
    setRecData(prev=>{const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,ub:val});const next={...prev,lineas};saveRec(next);return next;});
  },[saveRec]);

  const conformeTodo=useCallback(()=>{
    setRecData(prev=>{
      const lineas=prev.lineas.map(l=>({...l,cantRec:l.cantRemito||0,diff:0,ok:true}));
      const next={...prev,lineas};saveRec(next);return next;
    });
  },[saveRec]);

  // ─── Imprimir registro ────────────────────────────────────────────────────
  const imprimirRegistro=useCallback(()=>{
    const w=window.open('','_blank');
    const tot=recData.lineas.reduce((s,l)=>s+(l.cantRec??l.cantRemito??0),0);
    w.document.write(`<!DOCTYPE html><html><head><title>Recepción ${recData.meta.proveedor}</title>
<style>
body{font-family:Arial,sans-serif;font-size:10px;margin:20px;color:#111}
h1{font-size:16px;font-weight:900;letter-spacing:.05em}
h2{font-size:12px;font-weight:700;margin-top:10px}
.info{display:flex;gap:30px;margin:10px 0;padding:8px;background:#f8f8f8;border-radius:3px}
.info-item{flex:1}.info-label{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
.info-val{font-weight:600;font-size:11px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#111;color:white;padding:5px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;text-align:left}
td{padding:5px 7px;border-bottom:1px solid #ddd;font-size:10px}
.r{text-align:right}.red{color:#c00;font-weight:700}.green{color:#060;font-weight:600}
.diff-cell{text-align:right;font-weight:700}
.firma-row{display:flex;gap:50px;margin-top:50px}
.firma-box{flex:1;text-align:center;border-top:1px solid #333;padding-top:6px;font-size:9px}
.ref{font-size:8px;color:#888;margin-top:4px}
.no-print{display:none}
@media print{.no-print{display:none}}
</style></head><body>
<h1>DELMY PARTY SRL</h1>
<h2>REGISTRO DE RECEPCIÓN DE MERCADERÍA · IT-REC-001</h2>
<div class="info">
  <div class="info-item"><div class="info-label">PROVEEDOR</div><div class="info-val">${recData.meta.proveedor||'—'}</div></div>
  <div class="info-item"><div class="info-label">Nº REMITO / FACTURA</div><div class="info-val">${recData.meta.nRemito||'—'}</div></div>
  <div class="info-item"><div class="info-label">OC ASOCIADA</div><div class="info-val">${recData.meta.nOC||'—'}</div></div>
  <div class="info-item"><div class="info-label">FECHA DOC.</div><div class="info-val">${recData.meta.fecha||'—'}</div></div>
  <div class="info-item"><div class="info-label">TRANSPORTISTA</div><div class="info-val">${recData.meta.transportista||'—'} ${recData.meta.patente?'('+recData.meta.patente+')':''}</div></div>
  <div class="info-item"><div class="info-label">HORA LLEGADA</div><div class="info-val">${recData.meta.horaLlegada||'—'}</div></div>
</div>
<table>
  <thead><tr><th>#</th><th>CÓD.DOC</th><th>CÓD.BASE</th><th>DESCRIPCIÓN</th><th class="r">CANT. REMITO</th><th class="r">CANT. RECIBIDA</th><th class="r">DIFERENCIA</th><th>UBICACIÓN</th><th>OBS.</th></tr></thead>
  <tbody>
  ${recData.lineas.map((l,i)=>`<tr>
    <td>${i+1}</td>
    <td style="font-family:Courier New,monospace">${l.codDoc||l.codI||'—'}</td>
    <td style="font-family:Courier New,monospace;color:#555">${l.codI||'—'}</td>
    <td>${l.desc||'—'}</td>
    <td class="r">${l.cantRemito??'—'}</td>
    <td class="r ${l.cantRec<l.cantRemito?'red':''}">${l.cantRec??'—'}</td>
    <td class="diff-cell ${l.diff<0?'red':l.diff>0?'green':''}">${l.diff!=null?(l.diff>0?'+':'')+l.diff:'—'}</td>
    <td style="font-family:Courier New,monospace">${l.ub||'___ - ___ - ___ - ___'}</td>
    <td>${l.obs||''}</td>
  </tr>`).join('')}
  <tr style="font-weight:700;background:#f8f8f8">
    <td colspan="4">TOTAL</td>
    <td class="r">${recData.lineas.reduce((s,l)=>s+(l.cantRemito||0),0)}</td>
    <td class="r">${tot}</td>
    <td class="r">${recData.lineas.reduce((s,l)=>s+(l.diff||0),0)}</td>
    <td colspan="2"></td>
  </tr>
  </tbody>
</table>
${recData.meta.obs?`<p style="margin-top:8px"><b>Observaciones:</b> ${recData.meta.obs}</p>`:''}
<p style="margin-top:8px;font-size:9px;color:#888">Generado: ${new Date().toLocaleString('es-AR')} · Sistema Operativo Delmy Party SRL · Industrial Partner</p>
<p style="font-size:8px;color:#888">Formato de ubicación: PL01 - F/T - A/B/C - 1-9 (Pallet · Frente/Trasero · Columna · Altura)</p>
<div class="firma-row">
  <div class="firma-box">Recibido por<br><br><br>Nombre y Firma</div>
  <div class="firma-box">Verificado por<br><br><br>Nombre y Firma</div>
  <div class="firma-box">Transportista / Proveedor<br><br><br>Nombre y Firma</div>
  <div class="firma-box">Autorizado por<br><br><br>Nombre y Firma</div>
</div>
</body></html>`);
    w.document.close();w.print();
  },[recData]);

  // ─── Cerrar recepción ─────────────────────────────────────────────────────
  const cerrarRecepcion=useCallback(()=>{
    const next={...recData,cerrada:true,fechaCierre:new Date().toISOString()};
    setRecData(next);saveRec(next);
    alert('✓ Recepción cerrada correctamente');
  },[recData,saveRec]);

  const resetRecepcion=useCallback(()=>{
    if(!window.confirm('¿Iniciar una nueva recepción? Se perderán los datos actuales no guardados.'))return;
    const fresh={meta:{proveedor:'',nRemito:'',nOC:'',fecha:new Date().toISOString().slice(0,10),transportista:'',patente:'',horaLlegada:'',obs:''},lineas:[],fotoEvidencia:null,cerrada:false};
    setRecData(fresh);saveRec(fresh);setEtapa('documento');setIaStatus('');
  },[saveRec]);

  const ETAPAS=[
    {id:'documento', n:1, l:'DOCUMENTO', s:'Remito / Factura'},
    {id:'registro',  n:2, l:'REGISTRO',  s:'Datos de llegada'},
    {id:'control',   n:3, l:'CONTROL',   s:'Verificación física'},
    {id:'validacion',n:4, l:'VALIDACIÓN',s:'OC vs Remito vs Físico'},
    {id:'cierre',    n:5, l:'CIERRE',    s:'Confirmar'},
  ];
  const etIdx=ETAPAS.findIndex(e=>e.id===etapa);

  const stats={
    total:    recData.lineas.length,
    conformes:recData.lineas.filter(l=>l.ok===true).length,
    faltantes:recData.lineas.filter(l=>l.ok===false).length,
    sinControl:recData.lineas.filter(l=>l.cantRec===null).length,
  };

  return(
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:C.bg}}>

      {/* Header con step bar */}
      <div style={{background:C.p2,borderBottom:`1px solid ${C.b1}`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',padding:'8px 14px',borderBottom:`1px solid ${C.b1}`,gap:10}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:13,fontWeight:700,color:C.acc}}>RECEPCIÓN</div>
          {recData.meta.proveedor&&<span style={{fontSize:12,color:C.txt}}>— {recData.meta.proveedor}</span>}
          {recData.meta.nRemito&&<span style={{fontSize:11,color:C.mut}}>· {recData.meta.nRemito}</span>}
          <div style={{marginLeft:'auto',display:'flex',gap:7}}>
            <button onClick={imprimirRegistro} disabled={!recData.lineas.length} style={{...Btn(C.teal,'rgba(45,212,191,.08)'),opacity:recData.lineas.length?1:.4}}>🖨 Imprimir registro</button>
            <button onClick={resetRecepcion} style={Btn(C.mut)}>+ Nueva recepción</button>
          </div>
        </div>
        <div style={{display:'flex',overflowX:'auto'}}>
          {ETAPAS.map((e,i)=>{
            const act=etapa===e.id,done=etIdx>i;
            const col=done?C.green:act?C.acc:C.mut;
            const bg=done?'rgba(74,222,128,.2)':act?'rgba(240,192,64,.2)':C.b1;
            return(
              <div key={e.id} onClick={()=>{if(done||act||i<=etIdx+1)setEtapa(e.id);}} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',cursor:'pointer',borderBottom:act?`2px solid ${C.acc}`:'2px solid transparent',background:act?'rgba(240,192,64,.04)':'transparent',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:500,background:bg,color:col,border:`1px solid ${col}`}}>{done?'✓':e.n}</div>
                <div><div style={{fontSize:10,fontWeight:500,color:col}}>{e.l}</div><div style={{fontSize:8,color:'#4b5563'}}>{e.s}</div></div>
                {i<4&&<div style={{color:C.b1,marginLeft:4}}>›</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Contenido */}
      <div style={{flex:1,overflow:'auto',padding:14}}>

        {/* E1 — DOCUMENTO */}
        {etapa==='documento'&&(
          <div style={{maxWidth:800}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:12}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700}}>E1 — Carga del documento</div>
                <span style={{fontSize:11,color:C.mut}}>Siempre arranca con el remito o factura del proveedor</span>
              </div>
              <div style={{padding:16}}>
                <Alert cls="info">El documento identifica al proveedor y lo que debería llegar. Subí la factura o remito para autocompletar los datos.</Alert>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  <div>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>CON IA — IMAGEN O PDF</div>
                    <div style={{border:`2px dashed ${C.b1}`,borderRadius:4,padding:14,textAlign:'center',cursor:'pointer',marginBottom:8}} onClick={()=>fileRef.current.click()}>
                      <div style={{fontSize:28,marginBottom:6}}>📄</div>
                      <div style={{fontSize:12,color:C.txt}}>Arrastrar o hacer click</div>
                      <div style={{fontSize:10,color:C.mut,marginTop:3}}>JPG · PNG · WEBP · PDF · Excel</div>
                    </div>
                    {iaStatus&&<div style={{fontSize:10,color:C.acc,textAlign:'center'}}>{iaStatus}</div>}
                    <button onClick={()=>fileRef.current.click()} style={{...Btn(C.acc,'rgba(240,192,64,.1)'),width:'100%',fontWeight:600}}>
                      ✦ Subir remito / factura
                    </button>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.jpg,.jpeg,.png,.webp,.pdf" style={{display:'none'}}
                      onChange={e=>{if(e.target.files[0])procesarDocumento(e.target.files[0]);e.target.value='';}} />
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>CARGA MANUAL</div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {[['PROVEEDOR','proveedor','Nombre del proveedor'],['Nº REMITO / FACTURA','nRemito','0001-00012345'],['OC ASOCIADA','nOC','Número de OC si aplica']].map(([lbl,field,ph])=>(
                        <div key={field}>
                          <div style={{fontSize:9,color:C.mut,marginBottom:2,textTransform:'uppercase',letterSpacing:'.05em'}}>{lbl}</div>
                          <input value={recData.meta[field]||''} placeholder={ph} onChange={e=>updMeta(field,e.target.value)} style={IS} />
                        </div>
                      ))}
                    </div>
                    <button onClick={()=>setEtapa('registro')} style={{...Btn(C.mut),width:'100%',marginTop:10}}>
                      Continuar sin documento →
                    </button>
                  </div>
                </div>

                {recData.lineas.length>0&&(
                  <Alert cls="ok">✓ {recData.lineas.length} líneas cargadas · {recData.lineas.filter(l=>l.codI).length} reconocidas en base · <button onClick={()=>setEtapa('registro')} style={{background:'transparent',border:'none',color:C.green,cursor:'pointer',fontSize:10,textDecoration:'underline'}}>Continuar →</button></Alert>
                )}
              </div>
            </div>
          </div>
        )}

        {/* E2 — REGISTRO */}
        {etapa==='registro'&&(
          <div style={{maxWidth:800}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden',marginBottom:12}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`}}>
                <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700}}>E2 — Datos de llegada</div>
              </div>
              <div style={{padding:16}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
                  {[['PROVEEDOR','proveedor',''],['Nº REMITO','nRemito',''],['OC ASOCIADA','nOC',''],['FECHA DOC.','fecha',''],['TRANSPORTISTA','transportista','Empresa o nombre'],['PATENTE','patente','AB 123 CD']].map(([lbl,field,ph])=>(
                    <div key={field}>
                      <div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
                      <input type={field==='fecha'?'date':'text'} value={recData.meta[field]||''} placeholder={ph} onChange={e=>updMeta(field,e.target.value)} style={IS} />
                    </div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:10,marginBottom:14}}>
                  <div>
                    <div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>HORA DE LLEGADA</div>
                    <div style={{display:'flex',gap:6}}>
                      <input value={recData.meta.horaLlegada||''} placeholder="HH:MM" onChange={e=>updMeta('horaLlegada',e.target.value)} style={IS} />
                      <button onClick={()=>updMeta('horaLlegada',new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}))} style={Btn(C.mut)}>⏱ Ahora</button>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.mut,marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>OBSERVACIONES DE LLEGADA</div>
                    <input value={recData.meta.obs||''} placeholder="Estado del embalaje, incidencias..." onChange={e=>updMeta('obs',e.target.value)} style={IS} />
                  </div>
                </div>

                {/* Resumen líneas */}
                {recData.lineas.length>0&&(
                  <div style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:10,marginBottom:10}}>
                    <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}>RESUMEN DEL DOCUMENTO</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                      {[{l:'ARTÍCULOS',v:recData.lineas.length,c:C.txt},{l:'TOTAL REMITO',v:fn(recData.lineas.reduce((s,l)=>s+(l.cantRemito||0),0)),c:C.acc},{l:'RECONOCIDOS',v:recData.lineas.filter(l=>l.codI).length,c:C.green},{l:'NO RECONOCIDOS',v:recData.lineas.filter(l=>!l.codI).length,c:recData.lineas.filter(l=>!l.codI).length>0?C.red:C.mut}].map(k=>(
                        <div key={k.l}><div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',marginBottom:2,textTransform:'uppercase'}}>{k.l}</div><div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div></div>
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
            {recData.lineas.length===0
              ?<Alert cls="warn">Sin líneas. Volvé a cargar el documento.</Alert>
              :(
                <>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10}}>
                    <span style={{fontSize:9,color:C.mut}}>Ingresá la cantidad física recibida para cada artículo:</span>
                    <span style={{background:'rgba(74,222,128,.12)',color:C.green,border:'1px solid rgba(74,222,128,.3)',padding:'2px 8px',borderRadius:3,fontSize:9}}>{stats.conformes} conformes</span>
                    <span style={{background:'rgba(248,113,113,.12)',color:C.red,border:'1px solid rgba(248,113,113,.3)',padding:'2px 8px',borderRadius:3,fontSize:9}}>{stats.faltantes} faltantes</span>
                    <span style={{fontSize:9,color:C.mut}}>{stats.sinControl} sin controlar</span>
                    <button onClick={conformeTodo} style={{...Btn(C.green,'rgba(74,222,128,.08)'),marginLeft:'auto'}}>✓ Todo conforme</button>
                  </div>

                  <div style={{overflowX:'auto',background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:10}}>
                    <table style={{borderCollapse:'collapse',width:'100%'}}>
                      <thead>
                        <tr>
                          {['#','CÓD.DOC','CÓD.BASE','DESCRIPCIÓN','CANT. REMITO','CANT. RECIBIDA','DIFERENCIA','UBICACIÓN','OK'].map((h,i)=>(
                            <th key={i} style={{fontSize:9,color:h==='CANT. RECIBIDA'?C.acc:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.06em',textAlign:i>3?'right':'left'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {recData.lineas.map((l,i)=>{
                          const rowBg=l.ok===false?'rgba(248,113,113,.04)':l.ok===true?'rgba(74,222,128,.02)':'transparent';
                          const td=(c,s)=><td style={{padding:'5px 7px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
                          return(
                            <tr key={i} style={{background:rowBg}}>
                              {td(i+1,{color:C.mut,fontSize:9})}
                              {td(l.codDoc||'—',{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                              {td(l.codI||<span style={{color:C.red}}>?</span>,{fontSize:9,color:l.codI?C.teal:C.red,fontFamily:'DM Mono,monospace'})}
                              {td(<span title={l.desc} style={{display:'block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc||'—'}</span>)}
                              {td(l.cantRemito??'—',{textAlign:'right',fontWeight:500})}
                              <td style={{padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle',textAlign:'right'}}>
                                <NumInput value={l.cantRec} onChange={v=>updRec(i,v)} color={C.acc} />
                              </td>
                              {td(l.diff===null?'—':<span style={{color:l.diff===0?C.green:l.diff<0?C.red:C.blue,fontWeight:600}}>{l.diff>0?'+':''}{l.diff}</span>,{textAlign:'right'})}
                              <td style={{padding:'3px 5px',borderBottom:`1px solid ${C.b2}`,verticalAlign:'middle'}}>
                                <input value={l.ub||''} placeholder="PL01-F-A-1" onChange={e=>updUb(i,e.target.value)} style={{width:90,padding:'3px 5px',fontSize:9,...IS}} />
                              </td>
                              {td(l.ok===true?'✓':l.ok===false?'✗':'—',{textAlign:'center',fontSize:13,color:l.ok===true?C.green:l.ok===false?C.red:C.mut,fontWeight:600})}
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
              )
            }
          </div>
        )}

        {/* E4 — VALIDACIÓN OC vs Remito vs Físico */}
        {etapa==='validacion'&&(
          <div>
            <div style={{marginBottom:10}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700,marginBottom:8}}>E4 — Validación cruzada</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                {[{l:'ARTÍCULOS',v:stats.total,c:C.txt},{l:'CONFORMES',v:stats.conformes,c:C.green},{l:'FALTANTES',v:stats.faltantes,c:stats.faltantes>0?C.red:C.mut},{l:'SIN CONTROLAR',v:stats.sinControl,c:stats.sinControl>0?C.ora:C.mut}].map(k=>(
                  <div key={k.l} style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px'}}>
                    <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
                    <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
                  </div>
                ))}
              </div>

              {stats.faltantes>0&&<Alert cls="err">✗ {stats.faltantes} artículos con faltante físico vs remito — documentar antes de firmar</Alert>}
              {stats.sinControl>0&&<Alert cls="warn">⚠ {stats.sinControl} artículos sin controlar — completá el control físico antes de cerrar</Alert>}
              {stats.faltantes===0&&stats.sinControl===0&&<Alert cls="ok">✓ Recepción conforme — todos los artículos controlados sin diferencias</Alert>}
            </div>

            {/* Tabla cruzada OC vs Remito vs Físico */}
            <div style={{overflowX:'auto',background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,marginBottom:12}}>
              <table style={{borderCollapse:'collapse',width:'100%'}}>
                <thead>
                  <tr>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.06em'}}>CÓDIGO</th>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.06em'}}>DESCRIPCIÓN</th>
                    <th style={{fontSize:9,color:C.blue,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'right',textTransform:'uppercase',letterSpacing:'.06em'}}>OC</th>
                    <th style={{fontSize:9,color:C.acc,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'right',textTransform:'uppercase',letterSpacing:'.06em'}}>REMITO</th>
                    <th style={{fontSize:9,color:C.green,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'right',textTransform:'uppercase',letterSpacing:'.06em'}}>FÍSICO</th>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'right',textTransform:'uppercase',letterSpacing:'.06em'}}>REM-OC</th>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'right',textTransform:'uppercase',letterSpacing:'.06em'}}>FIS-REM</th>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textTransform:'uppercase',letterSpacing:'.06em'}}>UBICACIÓN</th>
                    <th style={{fontSize:9,color:C.mut,padding:'5px 7px',background:C.p2,borderBottom:`1px solid ${C.b1}`,textAlign:'center',textTransform:'uppercase',letterSpacing:'.06em'}}>ESTADO</th>
                  </tr>
                </thead>
                <tbody>
                  {recData.lineas.map((l,i)=>{
                    const ocLinea=ocData?.lineas?.find(ol=>ol.cod===l.codI||ol.codp===l.codDoc);
                    const cantOC=ocLinea?.cantOC||null;
                    const difRemOC=cantOC!==null?((l.cantRemito||0)-cantOC):null;
                    const difFisRem=l.cantRec!==null?(l.cantRec-(l.cantRemito||0)):null;
                    const estado=l.cantRec===null?{t:'Sin controlar',c:C.mut}:l.cantRec>=(l.cantRemito||0)?{t:'✓ Conforme',c:C.green}:{t:'✗ Faltante',c:C.red};
                    const td=(c,s)=><td style={{padding:'5px 7px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
                    return(
                      <tr key={i} style={{background:l.ok===false?'rgba(248,113,113,.04)':l.ok===true?'rgba(74,222,128,.02)':'transparent'}}>
                        {td(l.codI||l.codDoc||'—',{fontSize:9,color:C.teal,fontFamily:'DM Mono,monospace'})}
                        {td(<span title={l.desc} style={{display:'block',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc||'—'}</span>)}
                        {td(cantOC??'—',{textAlign:'right',color:cantOC?C.blue:C.mut})}
                        {td(l.cantRemito??'—',{textAlign:'right',color:C.acc,fontWeight:500})}
                        {td(l.cantRec??'—',{textAlign:'right',color:l.cantRec!==null?C.green:C.mut,fontWeight:500})}
                        {td(difRemOC===null?'—':<span style={{color:difRemOC===0?C.green:Math.abs(difRemOC)<3?C.acc:C.red,fontWeight:600}}>{difRemOC>0?'+':''}{difRemOC}</span>,{textAlign:'right'})}
                        {td(difFisRem===null?'—':<span style={{color:difFisRem===0?C.green:difFisRem<0?C.red:C.blue,fontWeight:600}}>{difFisRem>0?'+':''}{difFisRem}</span>,{textAlign:'right'})}
                        {td(l.ub||'—',{fontSize:9,color:C.mut,fontFamily:'DM Mono,monospace'})}
                        {td(<span style={{fontSize:9,color:estado.c,fontWeight:500}}>{estado.t}</span>,{textAlign:'center'})}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEtapa('control')} style={Btn(C.mut)}>← Volver a control</button>
              <button onClick={()=>setEtapa('cierre')} style={{background:C.acc,color:'#0c0e14',border:'none',borderRadius:4,padding:'7px 18px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:600,cursor:'pointer'}}>Cierre →</button>
            </div>
          </div>
        )}

        {/* E5 — CIERRE */}
        {etapa==='cierre'&&(
          <div style={{maxWidth:700}}>
            <div style={{background:C.panel,border:`1px solid ${C.b1}`,borderRadius:5,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.b1}`}}>
                <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:700}}>E5 — Cierre de recepción</div>
              </div>
              <div style={{padding:16}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
                  {[{l:'ARTÍCULOS',v:stats.total,c:C.txt},{l:'CONFORMES',v:stats.conformes,c:C.green},{l:'FALTANTES',v:stats.faltantes,c:stats.faltantes>0?C.red:C.mut},{l:'SIN UBICAR',v:recData.lineas.filter(l=>!l.ub).length,c:recData.lineas.filter(l=>!l.ub).length>0?C.ora:C.mut}].map(k=>(
                    <div key={k.l} style={{background:C.p2,border:`1px solid ${C.b1}`,borderRadius:4,padding:'8px 10px',textAlign:'center'}}>
                      <div style={{fontSize:8,color:C.mut,letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>{k.l}</div>
                      <div style={{fontFamily:'Syne,sans-serif',fontSize:20,fontWeight:700,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>

                {stats.faltantes>0&&<Alert cls="err">✗ {stats.faltantes} artículos con faltante — se registra como diferencia de recepción</Alert>}
                {stats.sinControl>0&&<Alert cls="warn">⚠ {stats.sinControl} artículos sin controlar — recomendado volver a E3</Alert>}

                {/* Foto de evidencia */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>FOTO DEL REGISTRO FIRMADO (evidencia)</div>
                  {recData.fotoEvidencia
                    ?<div style={{position:'relative',display:'inline-block'}}>
                        <img src={recData.fotoEvidencia} alt="evidencia" style={{maxWidth:'100%',maxHeight:200,borderRadius:4,border:`1px solid ${C.b1}`}} />
                        <button onClick={()=>{setRecData(prev=>{const n={...prev,fotoEvidencia:null};saveRec(n);return n;});}} style={{position:'absolute',top:4,right:4,background:'rgba(0,0,0,.7)',border:'none',color:C.txt,borderRadius:3,padding:'2px 6px',cursor:'pointer',fontSize:10}}>✕</button>
                      </div>
                    :<div onClick={()=>fotoRef.current.click()} style={{border:`2px dashed ${C.b1}`,borderRadius:4,padding:'20px',textAlign:'center',cursor:'pointer'}}>
                        <div style={{fontSize:24,marginBottom:6}}>📷</div>
                        <div style={{fontSize:11,color:C.txt}}>Subir foto del registro firmado</div>
                        <div style={{fontSize:9,color:C.mut,marginTop:2}}>JPG · PNG · WEBP</div>
                      </div>
                  }
                  <input ref={fotoRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{display:'none'}} onChange={e=>{if(e.target.files[0])cargarFoto(e.target.files[0]);e.target.value='';}} />
                </div>

                {/* Observaciones finales */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>OBSERVACIONES FINALES</div>
                  <textarea rows={3} value={recData.meta.obsFinal||''} onChange={e=>updMeta('obsFinal',e.target.value)} placeholder="Estado general de la mercadería, incidencias, notas de cierre..."
                    style={{...IS,height:70,resize:'vertical',padding:'6px 8px'}} />
                </div>

                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button onClick={()=>setEtapa('validacion')} style={Btn(C.mut)}>← Revisar</button>
                  <button onClick={imprimirRegistro} style={Btn(C.teal,'rgba(45,212,191,.08)')}>🖨 Imprimir registro</button>
                  {recData.cerrada
                    ?<Alert cls="ok">✓ Recepción cerrada el {new Date(recData.fechaCierre).toLocaleString('es-AR')}</Alert>
                    :<button onClick={cerrarRecepcion} style={{background:C.green,color:'#0c0e14',border:'none',borderRadius:4,padding:'8px 20px',fontSize:12,fontFamily:'DM Mono,monospace',fontWeight:700,cursor:'pointer'}}>✓ Cerrar recepción</button>
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
