// ===== MÓDULO COMPRAS V6 =====
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { SK, lsGet, lsSet, lsGetRaw, loadArt, getListaCompra, detectarFactorCombo } from '../../utils/db';

async function apiFetch(path){const r=await fetch(path,{headers:{'Content-Type':'application/json'}});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}

const fn   = n => Number(n||0).toLocaleString('es-AR');
const fp   = n => n>0 ? '$'+Number(n).toLocaleString('es-AR',{maximumFractionDigits:0}) : '—';
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



// Match de proveedor — tolerante a variaciones (S.A / SRL / S.R.L. / etc)
function provMatch(provDoc, provBase) {
  if (!provDoc || !provBase) return false;
  const clean = s => s.toLowerCase().replace(/[.\s]/g,'').replace(/srl|sa|sas|sl/g,'');
  const a = clean(provDoc); const b = clean(provBase);
  if (a === b) return true;
  // Al menos 2 palabras significativas en común
  const wordsA = provDoc.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['srl','s.a','s.r.l'].includes(w));
  const wordsB = provBase.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['srl','s.a','s.r.l'].includes(w));
  const common = wordsA.filter(w => wordsB.some(wb=>wb.startsWith(w)||w.startsWith(wb)));
  return common.length >= 1; // al menos 1 palabra clave en común
}
// ─── Cruce de códigos — 3 niveles con filtro proveedor ───────────────────────
// Nivel 1 EXACTO:   codDoc === codp exacto → sin intervención
// Nivel 2 PARCIAL:  codDoc contenido en codp o cod interno → confirmar + exportar
// Nivel 3 NO MATCH: va al modal con recomendados
// SIEMPRE filtrar por proveedor de la OC. Nunca matchear fuera.
function cruzar(codDoc, descDoc, prov, art, ocLineas) {
  if (!codDoc || !art || typeof art !== 'object') return {cod:null, nivel:null};
  const cod = String(codDoc).trim();
  if (!cod) return {cod:null, nivel:null};

  // Prioridad 0: buscar en líneas de la OC activa (el contexto más directo)
  if (ocLineas && ocLineas.length > 0) {
    // Exacto en codp de la OC
    for (const l of ocLineas) {
      if (String(l.codp||'').trim() === cod) return {cod:l.cod, nivel:'exacto'};
    }
    // Parcial: codDoc contenido en codp de la OC
    for (const l of ocLineas) {
      const cp = String(l.codp||'').trim();
      if (cp && cp.includes(cod)) return {cod:l.cod, nivel:'parcial_codp'};
    }
    // Parcial: codDoc contenido en código interno de la OC
    for (const l of ocLineas) {
      if (String(l.cod||'').includes(cod)) return {cod:l.cod, nivel:'parcial_cod'};
    }
  }

  // Sin proveedor no se puede filtrar — no matchear
  if (!prov) return {cod:null, nivel:null};
  const artsProv = Object.entries(art).filter(([,a]) =>
    a && provMatch(prov, a.prov||'')
  );

  // Nivel 1: codp exacto (misma base, mismo proveedor)
  for (const [k, a] of artsProv) {
    if (String(a.codp||'').trim() === cod) return {cod:k, nivel:'exacto'};
  }
  // Nivel 2a: codDoc contenido en codp
  for (const [k, a] of artsProv) {
    const cp = String(a.codp||'').trim();
    if (cp && cp.includes(cod)) return {cod:k, nivel:'parcial_codp'};
  }
  // Nivel 2b: codDoc contenido en código interno
  for (const [k] of artsProv) {
    if (k.includes(cod)) return {cod:k, nivel:'parcial_cod'};
  }

  // Nivel 2c: sufijo — codDoc aparece al FINAL del codp (ej: '0302' en '694035120302')
  // Requiere validación — puede ser coincidencia parcial
  if (cod.length >= 4) {
    for (const [k, a] of artsProv) {
      const cp = String(a.codp||'').trim();
      if (cp.length > cod.length && cp.endsWith(cod)) return {cod:k, nivel:'parcial_sufijo'};
    }
    for (const [k] of artsProv) {
      if (k.length > cod.length && k.endsWith(cod)) return {cod:k, nivel:'parcial_sufijo'};
    }
  }

  // Nivel 2d: prefijo — codDoc aparece al INICIO del codp (ej: '6940' en '694035120302')
  if (cod.length >= 4) {
    for (const [k, a] of artsProv) {
      const cp = String(a.codp||'').trim();
      if (cp.length > cod.length && cp.startsWith(cod)) return {cod:k, nivel:'parcial_prefijo'};
    }
    for (const [k] of artsProv) {
      if (k.length > cod.length && k.startsWith(cod)) return {cod:k, nivel:'parcial_prefijo'};
    }
  }

  // Nivel 3: descripción (2+ palabras coincidentes)
  if (descDoc) {
    const words = descDoc.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2).slice(0,5);
    if (words.length >= 2) {
      let best = null; let bestScore = 0;
      for (const [k, a] of artsProv) {
        const hay = (a.desc||'').toLowerCase().split(/\s+/);
        const score = words.filter(w => hay.some(hw=>hw.startsWith(w)||w.startsWith(hw)||hw.includes(w))).length;
        if (score >= 2 && score > bestScore) { bestScore=score; best=k; }
      }
      if (best) return {cod:best, nivel:'descripcion'};
    }
  }
  return {cod:null, nivel:null};
}

// ─── Búsqueda para modal — primero mismo proveedor, luego otros ──────────────
function buscar(descDoc, codDoc, prov, famF, catF, marcaF, q, art) {
  if (!art || typeof art !== 'object' || !Object.keys(art).length) return [];
  const cod = String(codDoc||'').trim();
  const words = (descDoc||'').toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2).slice(0,5);
  const qLow = (q||'').toLowerCase().trim();
  const mismoProveedor = []; const otrosProveedor = [];

  for (const [k, a] of Object.entries(art)) {
    if (!a) continue;
    const esMismo = prov ? provMatch(prov, a.prov||'') : false;
    if (famF && (a.fam||'') !== famF) continue;
    if (catF  && (a.cat||'') !== catF)  continue;
    if (marcaF && (a.marca||'') !== marcaF) continue;

    const hay = (a.desc||'').toLowerCase();
    const hayWords = hay.replace(/[^\w\s]/g,' ').split(/\s+/);
    const cp = String(a.codp||'').trim();
    let score = 0; let type = 'desc';

    // Código
    if (cod) {
      if (cp === cod) { score += 30; type = 'exacto'; }
      else if (cp.includes(cod)) { score += 22; type = 'parcial_codp'; }
      else if (k.includes(cod)) { score += 18; type = 'parcial_cod'; }
    }
    // Palabras descripción — match flexible
    const wm = words.filter(w => hayWords.some(hw => hw.startsWith(w)||w.startsWith(hw)||hw.includes(w))).length;
    if (wm >= 2) score += wm * 8;
    // Búsqueda manual
    if (qLow && (hay.includes(qLow) || k.includes(qLow) || cp.toLowerCase().includes(qLow))) score += 15;

    if (score > 0) {
      const entry = {cod: k, a, score, type, esMismo};
      if (esMismo) mismoProveedor.push(entry);
      else otrosProveedor.push(entry);
    }
  }

  const sortFn = (a, b) => {
    const o = {exacto:0, parcial_codp:1, parcial_cod:2, desc:3};
    if ((o[a.type]||3) !== (o[b.type]||3)) return (o[a.type]||3)-(o[b.type]||3);
    return b.score - a.score;
  };
  mismoProveedor.sort(sortFn);
  otrosProveedor.sort(sortFn);

  // Primero mismo proveedor, luego otros — máximo 40 total
  return [...mismoProveedor.slice(0,30), ...otrosProveedor.slice(0,10)].slice(0,40);
}


function calcDiff(cr,pd){if(!cr||!pd)return null;return((pd-cr)/cr)*100;}

// ─── Estado completo de línea OC vs FC ───────────────────────────────────────
function estadoLinea(l) {
  // enFC: verdadero SOLO si la factura fue cargada Y este artículo apareció en ella
  const conFac = l.precioDoc > 0 || l.cantFC > 0;
  const enFC = conFac;
  const esSobrante = l.esSobrante;
  const matchTipo = l.matchTipo || 'none';

  if (esSobrante) {
    return l.reconocido ? 'SOBRANTE_CONOCIDO' : 'SOBRANTE_NUEVO';
  }
  if (!enFC) return 'NO_ENTREGADO';
  if (matchTipo === 'parcial_codp' || matchTipo === 'parcial_cod') return 'PARCIAL_CODP';
  if (matchTipo === 'parcial_sufijo') return 'PARCIAL_SUFIJO';
  if (matchTipo === 'parcial_prefijo') return 'PARCIAL_PREFIJO';
  if (matchTipo === 'descripcion') return 'PARCIAL_DESC';
  if (!l.reconocido) return 'SIN_RECONOCER';

  // ── Cantidades: siempre comparar en unidades BASE ──────────────────────────
  const factor       = l.factor || 1;
  const cantFCenBase = (l.cantFC || 0) * factor;     // FC viene en unidades combo
  const cantOCenBase = l.cantOC || 0;                // OC ya está en unidades base

  if (cantFCenBase > cantOCenBase) return 'CANT_MAYOR_FC';
  if (cantFCenBase < cantOCenBase) return 'CANT_MENOR_FC';

  // ── Precio: normalizar a unidades BASE antes de comparar ──────────────────
  // precioDoc es precio por UNIDAD DE COMBO; costoReal es por UNIDAD BASE
  const precioFCenBase = (l.precioDoc || 0) / factor;
  const precioCR       = l.costoReal || 0;
  if (precioFCenBase > 0 && precioCR > 0) {
    const diff = Math.abs(precioFCenBase - precioCR) / precioCR;
    if (diff > 0.02) {
      return precioFCenBase > precioCR ? 'EXACTO_PRECIO_SUBE' : 'EXACTO_PRECIO_BAJA';
    }
  }
  return 'EXACTO_COMPLETO';
}

const ESTADO_CONFIG = {
  EXACTO_COMPLETO:    { color:'#4ade80', bg:'rgba(74,222,128,.08)',  label:'✓ Exacto',         badge:'ok'  },
  EXACTO_PRECIO_SUBE: { color:'#f87171', bg:'rgba(248,113,113,.06)', label:'↑ Precio sube',    badge:'err' },
  EXACTO_PRECIO_BAJA: { color:'#4ade80', bg:'rgba(74,222,128,.04)',  label:'↓ Precio baja',    badge:'ok'  },
  CANT_MAYOR_FC:      { color:'#2dd4bf', bg:'rgba(45,212,191,.06)',  label:'⚡ Cant. extra',    badge:'teal'},
  CANT_MENOR_FC:      { color:'#f87171', bg:'rgba(248,113,113,.06)', label:'⚠ Cant. menor',    badge:'err' },
  PARCIAL_CODP:       { color:'#f0c040', bg:'rgba(240,192,64,.06)',  label:'⚡ Cód parcial',   badge:'warn'},
  PARCIAL_DESC:       { color:'#f0c040', bg:'rgba(240,192,64,.06)',  label:'⚡ Por desc.',      badge:'warn'},
  PARCIAL_SUFIJO:    { color:'#f0c040', bg:'rgba(240,192,64,.06)',  label:'⚡ Sufijo cód.',    badge:'warn'},
  PARCIAL_PREFIJO:   { color:'#f0c040', bg:'rgba(240,192,64,.06)',  label:'⚡ Prefijo cód.',   badge:'warn'},
  NO_ENTREGADO:       { color:'#f87171', bg:'rgba(248,113,113,.08)', label:'✗ No entregado',   badge:'err' },
  SOBRANTE_CONOCIDO:  { color:'#fb923c', bg:'rgba(251,146,60,.06)',  label:'⚡ Sobrante',       badge:'ora' },
  SOBRANTE_NUEVO:     { color:'#fb923c', bg:'rgba(251,146,60,.08)',  label:'⚡ Nuevo',          badge:'ora' },
  SIN_RECONOCER:      { color:'#f87171', bg:'rgba(248,113,113,.08)', label:'? Sin reconocer',  badge:'err' },
};

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
async function loadFromRedisIfEmpty(sk, expandFn, lsGetFn) {
  // Intentar localStorage primero, si vacío buscar en Redis
  const local = lsGetFn();
  if (local && Object.keys(local).length > 10) return local;
  try {
    const { value, exists } = await apiFetch(`/api/store/${sk}`);
    if (exists && value) {
      // Cache en localStorage para esta sesión
      try {
        if (typeof value === 'string') localStorage.setItem(sk, value);
        else localStorage.setItem(sk, JSON.stringify(value));
      } catch {}
      return expandFn(value);
    }
  } catch {}
  return {};
}

async function loadDB(){
  const art=await loadArt(); // siempre expandido — lee de Redis

  // stk/ventas: localStorage primero, Redis como fallback
  const stkC=lsGet(SK.stk,null);
  const stk=stkC?expandStk(stkC):await loadFromRedisIfEmpty(SK.stk, expandStk, ()=>null).then(v=>Object.keys(v).length?v:{});

  const vsRaw=lsGetRaw(SK.vs)||'';
  const vs=vsRaw?expandVent(vsRaw):await loadFromRedisIfEmpty(SK.vs, v=>expandVent(typeof v==='string'?v:JSON.stringify(v)), ()=>null).then(v=>v||{});

  const vqRaw=lsGetRaw(SK.vq)||'';
  const vq=vqRaw?expandVent(vqRaw):await loadFromRedisIfEmpty(SK.vq, v=>expandVent(typeof v==='string'?v:JSON.stringify(v)), ()=>null).then(v=>v||{});

  const vmRaw=lsGetRaw(SK.vm)||'';
  const vm=vmRaw?expandVent(vmRaw):await loadFromRedisIfEmpty(SK.vm, v=>expandVent(typeof v==='string'?v:JSON.stringify(v)), ()=>null).then(v=>v||{});

  console.log('[DB] arts:',Object.keys(art).length,'stk:',Object.keys(stk).length,'vs:',Object.keys(vs).length,'vm:',Object.keys(vm).length);
  // Cargar combos
  let combos = {}; // used via db.combos in enriquecerLinea // eslint-disable-line
  try {
    const combosLocal = localStorage.getItem(SK.combos);
    if (combosLocal) combos = JSON.parse(combosLocal);
    else {
      const { value, exists } = await apiFetch('/api/store/'+SK.combos);
      if (exists && value) { combos = value; try{localStorage.setItem(SK.combos,JSON.stringify(value));}catch{} }
    }
  } catch {}
  const sh=lsGet(SK.share,null);
  const planC=sh?.planC||lsGet(SK.plan,null);
  const plan=planC?expandPlan(planC):{};
  const listaItems=sh?.listaItems||getListaCompra().items||{};
  const provStock=sh?.prov||null;
  return{art,stk,vs,vq,vm,combos,plan,listaItems,provStock};
}


function getFreq(prov,art){
  const fams={},cats={},marcas={};
  Object.values(art).filter(a=>!prov||provMatch(prov, a.prov||'')).forEach(a=>{
    if(a.fam)fams[a.fam]=(fams[a.fam]||0)+1;
    if(a.cat)cats[a.cat]=(cats[a.cat]||0)+1;
    if(a.marca)marcas[a.marca]=(marcas[a.marca]||0)+1;
  });
  const top=(obj,n)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k);
  return{fams:top(fams,8),cats:top(cats,8),marcas:top(marcas,6)};
}

// ─── Enriquecer línea con todos los datos de la base ─────────────────────────

// ════ Clasificador de no reconocidos — 3 casos distintos ══════════════════
// Caso 1: typo/formato — el artículo existe pero el código no matcheó
// Caso 2: combo_nuevo — existe el artículo base pero en otra presentación
// Caso 3: nuevo — artículo genuinamente nuevo
function clasificarNoReconocido(codDoc, descDoc, precioUnit, prov, db) {
  const art = db?.art || {};
  const combos = db?.combos || {};
  const normalize = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const codN = normalize(codDoc);

  // ── Caso 1: normalizar código y buscar de nuevo ──────────────────────────
  const artsProv = Object.entries(art).filter(([,a]) => provMatch(prov, a.prov||''));
  for (const [k, a] of artsProv) {
    const codpN = normalize(a.codp||'');
    const codkN = normalize(k);
    if (codpN === codN || codkN === codN) {
      return { tipo: 'typo', codI: k, art: a, confianza: 0.95 };
    }
  }

  // ── Caso 2: combo nuevo — buscar artículo base + factor de descripción ───
  const factorInfo = detectarFactorCombo(descDoc);
  if (factorInfo && factorInfo.factor > 1) {
    // Extraer código base: quitar sufijo numérico o /N o :N
    const codBase = codDoc.replace(/[/:\d-]+$/, '').trim();
    const codBaseN = normalize(codBase);

    // Buscar en base: código exacto o codp exacto del artículo base
    let artBase = null, codBaseI = null;
    for (const [k, a] of artsProv) {
      const cpN = normalize(a.codp||'');
      const kkN = normalize(k);
      if (cpN === codBaseN || kkN === codBaseN ||
          cpN === codN.replace(/\d+$/,'') || kkN === codBaseN) {
        artBase = a; codBaseI = k; break;
      }
    }
    // También buscar en combos existentes del mismo base
    const combosBase = Object.entries(combos).filter(([cod]) =>
      normalize(cod).startsWith(codBaseN) || codBaseN.startsWith(normalize(cod).replace(/\d+$/,''))
    );

    if (artBase || combosBase.length > 0) {
      const baseRef = artBase || combosBase[0]?.[1];
      const costoSugerido = (baseRef?.costoReal || 0) * factorInfo.factor;
      const descNorm = descDoc
        .replace(/\s+x\s*(\d+)\s*u?n?/gi, ' x$1u')
        .replace(/(\d+)\s*(bolsas?|packs?|cajas?)\s*x\s*(\d+)/gi, '$1 paq x $3u')
        .toUpperCase().trim();
      return {
        tipo: 'combo_nuevo',
        codBase: codBaseI || codBase,
        artBase: artBase || null,
        combosBase,
        factor: factorInfo.factor,
        factorTipo: factorInfo.tipo,
        factorDetalle: factorInfo.detalle || String(factorInfo.factor),
        costoSugerido: costoSugerido > 0 ? costoSugerido : precioUnit,
        costoCoincide: costoSugerido > 0 && Math.abs(costoSugerido - precioUnit) / precioUnit < 0.02,
        codSugerido: codBase + '/' + factorInfo.factor,
        descSugerida: descNorm,
        confianza: artBase ? 0.9 : 0.7,
      };
    }
  }

  // ── Caso 3: genuinamente nuevo ───────────────────────────────────────────
  const descNorm = String(descDoc||'').toUpperCase().trim()
    .replace(/X\s*(\d+)\s*U/g,'X$1U').replace(/\s+/g,' ');
  return {
    tipo: 'nuevo',
    descSugerida: descNorm,
    codSugerido: '',
    confianza: 0,
  };
}

function enriquecerLinea(codDoc,cant,precioDoc,descDoc,prov,db,ocLineas){
  if(!db||!db.art)return{cod:codDoc,codp:codDoc,desc:descDoc||'',prov:prov||'',fam:'',cat:'',costoReal:0,pvMin:0,mostrador:0,cantOC:cant||0,dc:0,d1:0,d3:0,precioDoc:precioDoc||0,cantRemito:cant||0,cantFC:0,stkDMCN:0,stkDM01:0,stkDM03:0,vs:0,vq:0,vm:0,reconocido:false,aprobado:false,rechazado:false,esSobrante:false};
  // Detectar si es un combo — prioridad: tabla de combos, luego descripción
  const comboTabla = db.combos?.[codDoc];
  const factor = comboTabla?.componentes?.[0]?.cant || detectarFactorCombo(descDoc)?.factor || 1;
  const cantReal = cant * factor;
  const esComboDetectado = factor > 1;
  const matchResult=cruzar(codDoc,descDoc||"",prov||"",db.art,ocLineas||[]);
  const codI=matchResult.cod||codDoc;
  const nivel=matchResult.nivel; // 'exacto'|'parcial_codp'|'parcial_cod'|'descripcion'|null
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
    reconocido:!!(nivel),
    matchTipo:nivel||'none',
    esCombo:esComboDetectado,
    comboTipo:comboTabla?'conocido':esComboDetectado?'inferido':'no',
    factor,
    cantReal, // unidades base reales
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
  const [modal,  setModal] = useState({open:false,idx:0,tab:'buscar',busqQ:'',selFam:'',selCat:'',selMarca:'',clasificacion:null,nuevoForm:{cod:'',desc:'',codp:'',prov:'',fam:'',cat:'',marca:'',costoReal:0,pvMin:0,mostrador:0}});

  // codpIdx removed — cruzar() no longer uses index

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
      // Solo cargar lista de OCs — el usuario elige cuál activar
      const ocs=lsGet(SK.ocs,[]);
      if(ocs.length) setOCS(ocs);
      // No auto-activar ninguna OC
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
    // Si db.art está vacío, recargar fresh antes de armar las líneas
    if(Object.keys(db.art).length===0){
      alert('La base de artículos no está cargada. Hacé click en ↺ DB primero.');
      reloadDB();return;
    }
    // DIAGNÓSTICO: mostrar si las claves coinciden
    const dbKeys=Object.keys(db.art).slice(0,3);
    const listKeys=Object.keys(todos).slice(0,3);
    console.log('[DIAGNÓSTICO] Primeras claves DB:', dbKeys);
    console.log('[DIAGNÓSTICO] Primeras claves lista:', listKeys);
    console.log('[DIAGNÓSTICO] Ejemplo art DB[0]:', db.art[dbKeys[0]]);
    const primerMatch=listKeys.find(k=>db.art[k]);
    console.log('[DIAGNÓSTICO] Primer match lista→DB:', primerMatch||'NINGUNO');

    // DEBUG: log first art entry to verify format
    const firstCod=Object.keys(db.art)[0];
    if(firstCod)console.log('[Compras] Primer art en DB:',firstCod,'->', db.art[firstCod]);
    console.log('[Compras] Codes en todos:', Object.keys(todos).slice(0,5));
    console.log('[Compras] Total arts DB:', Object.keys(db.art).length);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[db,saveOC]);

  // ─── Procesar documento (factura/remito) ──────────────────────────────────
  const procesarDoc=useCallback(async(file)=>{
    const ext=file.name.toLowerCase().split('.').pop();
    let docLineas=[];
    let docMeta={};
    setProcesando(true);
    try{
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
        // IA — imagen o PDF
        const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
        const reader=new FileReader();
        const b64=await new Promise((res,rej)=>{reader.onload=e=>res(e.target.result.split(',')[1]);reader.onerror=()=>rej(new Error('No se pudo leer el archivo'));reader.readAsDataURL(file);});
        const mtype=isPdf?'application/pdf':file.type||'image/jpeg';
        const res=await fetch('/api/ia/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:b64,mediaType:mtype})});
        if(!res.ok){
          const errBody=await res.json().catch(()=>({}));
          throw new Error(errBody.error||`Error servidor: ${res.status} ${res.statusText}`);
        }
        const result=await res.json();
        if(!result.text)throw new Error('La IA no devolvió texto. Verificá ANTHROPIC_API_KEY en Railway.');
        let parsed;
        try{
          parsed=JSON.parse(result.text.replace(/```json|```/g,'').trim());
        }catch(pe){
          throw new Error('Respuesta IA no es JSON válido. Primeros 300 chars: '+result.text.slice(0,300));
        }
        if(!parsed.lineas||!Array.isArray(parsed.lineas))
          throw new Error('Falta campo "lineas" en respuesta IA. Keys recibidas: '+Object.keys(parsed).join(', '));
        docMeta={proveedor:parsed.proveedor||'',nDocumento:parsed.nDocumento||'',fecha:parsed.fecha||''};
        docLineas=parsed.lineas.map(l=>({cod:String(l.cod||''),desc:l.desc||'',cant:Number(l.cant)||0,precio:Number(l.precioUnit)||0}));
      }
      if(!docLineas.length){alert('⚠ El documento no tiene líneas reconocibles');return;}
      aplicarDocumento(docLineas,docMeta);
    }catch(e){
      console.error('[procesarDoc]',e);
      alert('❌ Error al procesar el archivo:\n\n'+e.message);
    }finally{
      setProcesando(false);
    }
  },[db,saveOC,OCact,OCdata,aplicarDocumento]);// eslint-disable-line

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
            const ci=cruzar(dl.cod,dl.desc||"",meta.proveedor||docMeta.proveedor||"",db.art,prev.lineas).cod;
            return dl.cod===l.codp||dl.cod===l.cod||(ci&&ci===l.cod);
          });
          if(match){
            // Recalcular matchTipo con el código de la factura vs la OC
            const {nivel:nivelFC}=cruzar(match.cod,match.desc||"",meta.proveedor||docMeta.proveedor||"",db.art,prev.lineas);
            // Si el codDoc de la FC es exactamente igual al codp → exacto
            // Si está contenido en el codp → parcial_codp
            const codDocFC=String(match.cod||'').trim();
            const codpOC=String(l.codp||'').trim();
            let matchTipoFC='none';
            if(codDocFC===codpOC) matchTipoFC='exacto';
            else if(codpOC.includes(codDocFC)) matchTipoFC='parcial_codp';
            else if(l.cod.includes(codDocFC)) matchTipoFC='parcial_cod';
            else matchTipoFC=nivelFC||'descripcion';
            return{...l,
              codDocFC:match.cod,  // código original de la FC
              cantFC:match.cant||0, // cantidad según FC — campo dedicado
              precioDoc:match.precio||l.precioDoc||0,
              cantRemito:match.cant||l.cantRemito||l.cantOC,
              matchTipo:matchTipoFC,
              aprobado:matchTipoFC==='exacto'?l.aprobado:false,
            };
          }
          return l;
        });

        // Artículos en el doc que NO están en la OC → sobrantes
        const codsOC=new Set(prev.lineas.map(l=>l.cod));
        const codpOC=new Set(prev.lineas.map(l=>l.codp));
        const sobrantes=[];
        for(const dl of docLineas){
          const ci=cruzar(dl.cod,dl.desc||"",meta.proveedor||docMeta.proveedor||"",db.art,prev.lineas).cod;
          const ciKey=ci||dl.cod;
          // Verificar si alguna línea de la OC ya matchea con este código de FC
          const yaEnOC=codsOC.has(ciKey)||codsOC.has(dl.cod)||codpOC.has(dl.cod)||
            // También verificar si el código de FC está contenido en algún codp de la OC
            prev.lineas.some(l=>String(l.codp||'').includes(String(dl.cod||'').trim())||
              String(l.cod||'').includes(String(dl.cod||'').trim()));
          if(!yaEnOC){
            sobrantes.push({...enriquecerLinea(dl.cod,dl.cant,dl.precio,dl.desc,meta.proveedor||docMeta.proveedor||"",db,prev.lineas),esSobrante:true,codDocFC:dl.cod,cantFC:dl.cant||0});
          }
        }

        const updated={...prev,meta,lineas:[...lineasActualizadas,...sobrantes]};
        saveOC(OCact,updated);
        return updated;
      });
    } else {
      const provDoc=docMeta.proveedor||OCdata.meta.proveedor||"";
      const lineas=docLineas.map(dl=>enriquecerLinea(dl.cod,dl.cant,dl.precio,dl.desc,provDoc,db,[]));
      const prov=docMeta.proveedor||lineas.find(l=>l.prov)?.prov||'';
      const id='oc_'+Date.now();
      const data={meta:{proveedor:prov,fecha:new Date().toISOString().slice(0,10),documento:docMeta.nDocumento||'',origen:'Documento',estado:'generada',historial:[{estado:'generada',ts:now(),label:nowLabel(),usuario:'Operario',desdePrev:0}]},lineas};
      setOCdata(data);setOCact(id);saveOC(id,data);
    }
    setEtC('validacion');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[OCdata.lineas,OCact,db,saveOC]);

  // ─── Modal ────────────────────────────────────────────────────────────────
  const asignarArt=useCallback((idx,cod,matchType,esMismo)=>{
    const a=db.art[cod];if(!a)return;
    // Si es de otro proveedor → marcar para nueva línea de proveedor
    const otroProveedor=!esMismo;
    // El matchTipo en el modal siempre va a importación masiva (no fue exacto por código)
    const nuevoMatchTipo=matchType||'descripcion';
    setOCdata(prev=>{
      const lineas=prev.lineas.map((l,i)=>i!==idx?l:{...l,cod,codp:a.codp||l.codp,desc:a.desc,
        prov:a.prov||'',fam:a.fam||'',cat:a.cat||'',costoReal:a.costoReal||0,pvMin:a.pvMin||0,
        mostrador:a.mostrador||0,reconocido:true,matchTipo:nuevoMatchTipo,
        otroProveedor,aprobado:false});
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
    // Usar proveedor de la OC como contexto principal
    const provContexto=OCdata.meta.proveedor||l?.prov||db.provStock||'';
    // Clasificar automáticamente antes de abrir el modal
    const clasificacion = clasificarNoReconocido(l?.codp||l?.cod||'', l?.desc||'', l?.precioDoc||0, OCdata.meta.proveedor||'', db);
    const tabInicial = clasificacion.tipo === 'combo_nuevo' ? 'combo'
                     : clasificacion.tipo === 'typo' ? 'buscar' : 'nuevo';
    const nuevoBase = clasificacion.tipo === 'combo_nuevo' ? {
      cod: clasificacion.codSugerido,
      desc: clasificacion.descSugerida,
      codp: clasificacion.codSugerido,
      prov: provContexto,
      fam: clasificacion.artBase?.fam || '',
      cat: clasificacion.artBase?.cat || '',
      marca: '',
      costoReal: clasificacion.costoSugerido || l?.precioDoc || 0,
      pvMin: 0, mostrador: 0,
      esCombo: true,
      codBase: clasificacion.codBase,
      factor: clasificacion.factor,
    } : {cod:'',desc:l?.desc||'',codp:l?.codp||l?.cod||'',prov:provContexto,fam:'',cat:'',marca:'',costoReal:l?.precioDoc||0,pvMin:0,mostrador:0};
    setModal({open:true,idx,tab:tabInicial,busqQ:'',selFam:'',selCat:'',selMarca:'',clasificacion,
      nuevoForm:nuevoBase});
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
    // Incluir: artículos con match parcial aprobados + artículos de otro proveedor asignados
    const parciales=OCdata.lineas.filter(l=>l.aprobado&&(l.matchTipo==='parcial_codp'||l.matchTipo==='parcial_cod'||l.matchTipo==='descripcion'));
    const otrosProv=OCdata.lineas.filter(l=>l.otroProveedor);
    const noEntregados=OCdata.lineas.filter(l=>estadoLinea(l)==='NO_ENTREGADO');
    const rows=[['Código Interno','Cód.Prov FC','Cód.Prov Base','Descripción','Familia','Categ.','Costo Real','PV Mín.','Mostrador','Proveedor','Motivo']];
    nList.forEach(n=>rows.push([n.cod,n.codp,n.desc,n.fam,n.cat,n.marca||'',n.costoReal,n.pvMin,n.mostrador,n.prov,n.fechaAlta]));
    parciales.forEach(l=>{rows.push([l.cod,l.codDocFC||l.codp,l.codp,l.desc,l.fam,l.cat||'',l.costoReal,l.pvMin,l.mostrador,l.prov,`Corregir código (${l.matchTipo}): FC=${l.codDocFC||l.codp} Base codp=${l.codp}`]);});
    otrosProv.forEach(l=>{if(!rows.find(r=>r[0]===l.cod))rows.push([l.cod,l.codDocFC||l.codp,l.codp,l.desc,l.fam,l.cat||'',l.costoReal,l.pvMin,l.mostrador,OCdata.meta.proveedor,'Nueva línea proveedor']);});
    noEntregados.forEach(l=>{rows.push([l.cod,l.codDocFC||l.codp,l.codp,l.desc,l.fam,l.cat||'',l.costoReal,l.pvMin,l.mostrador,l.prov,'NO ENTREGADO — pendiente de entrega']);});
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
  const nParciales=OCdata.lineas.filter(l=>l.matchTipo==='parcial_codp'||l.matchTipo==='parcial_cod'||l.matchTipo==='descripcion').length;

  const [procesando, setProcesando] = useState(false);
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
          {(nNuevos>0||nOtroProv>0||nParciales>0)&&<button onClick={exportarNuevos} style={Btn(C.ora,'rgba(251,146,60,.08)')}>↓ Masivo ({nNuevos+nOtroProv+nParciales})</button>}
        </div>
      </div>

      {/* Modal */}
      {modal.open&&<ModalArt modal={modal} setModal={setModal} linea={OCdata.lineas[modal.idx]} db={db} onAsignar={asignarArt} onNuevo={confirmarNuevo} OCprov={OCdata.meta.proveedor} />}

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
              procesando={procesando}
              onNext={()=>setEtC('validacion')}
              saveOC={saveOC} OCact={OCact} />
          )}
          {etC==='validacion'&&(
            <EtValidacion OCdata={OCdata} setOCdata={setOCdata}
              db={db} dbReady={dbReady}
              fileRef={fileRef} procesarDoc={procesarDoc}
              procesando={procesando}
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
function EtCarga({OCdata,setOCdata,importarDesdeStock,fileRef,procesarDoc,procesando,onNext,saveOC,OCact}){
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
          <button disabled={procesando} onClick={()=>fileRef.current.click()} style={{...Btn(),width:'100%',opacity:procesando?.5:1}}>{procesando?'⏳ Procesando...':'📋 Cargar .xlsx'}</button>
        </div>
        <div>
          <div style={{fontSize:9,color:C.mut,marginBottom:6}}>OPCIÓN 3 — FACTURA / REMITO</div>
          <Alrt cls="info">PDF, imagen o Excel — lectura con IA</Alrt>
          <button disabled={procesando} onClick={()=>fileRef.current.click()} style={{...Btn(),width:'100%',opacity:procesando?.5:1}}>{procesando?'⏳ Procesando IA...':'📄 Subir documento'}</button>
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
function EtValidacion({OCdata,setOCdata,db,dbReady,fileRef,procesarDoc,procesando,saveOC,OCact,abrirModal,onBack,onNext}){
  if(!OCdata.lineas.length)return<div><Alrt cls="warn">Sin líneas. Volvé a Carga.</Alrt><button onClick={onBack} style={Btn()}>← Volver</button></div>;

  const rec=OCdata.lineas.filter(l=>l.reconocido&&l.matchTipo==='exacto').length;
  const sugeridos=OCdata.lineas.filter(l=>l.reconocido&&l.matchTipo==='sugerido'&&!l.aprobado).length;
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
      {[{l:'LÍNEAS',v:OCdata.lineas.length,c:C.txt},{l:'EXACTAS',v:rec,c:C.green},{l:'PARCIALES',v:sugeridos,c:sugeridos>0?C.ora:C.mut},{l:'NO ENTREGADOS',v:OCdata.lineas.filter(l=>!l.esSobrante&&!(l.precioDoc>0||l.cantRemito>0)).length,c:OCdata.lineas.filter(l=>!l.esSobrante&&!(l.precioDoc>0||l.cantRemito>0)).length>0?C.red:C.mut},{l:'SOBRANTES',v:sobrantes,c:sobrantes>0?C.ora:C.mut},{l:'SIN RECONOCER',v:noRec,c:noRec>0?C.red:C.mut}].map(k=>(
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
        <button
          disabled={procesando}
          onClick={()=>fileRef.current.click()}
          style={{...Btn(procesando?C.mut:C.acc,'rgba(240,192,64,.1)'),opacity:procesando?.5:1,cursor:procesando?'not-allowed':'pointer'}}
        >
          {procesando?'⏳ Procesando IA...':'📄 Subir factura'}
        </button>
        {!procesando&&<button onClick={()=>{const d={...OCdata,lineas:OCdata.lineas.map(l=>({...l,precioDoc:0}))};setOCdata(d);saveOC(OCact,d);}} style={Btn(C.mut)}>Limpiar precios</button>}
        {procesando&&<span style={{fontSize:9,color:C.acc,fontStyle:'italic'}}>La IA está leyendo el documento, esperá unos segundos…</span>}
      </div>

      {/* Banner proveedor sticky — siempre visible al scrollear */}
      <div style={{position:'sticky',top:0,zIndex:10,background:C.p2,borderBottom:`1px solid ${C.b1}`,borderTop:`1px solid ${C.b1}`,padding:'5px 10px',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
        <span style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.07em'}}>Proveedor</span>
        <span style={{fontSize:12,fontWeight:700,color:C.acc,fontFamily:'DM Mono,monospace'}}>{OCdata.meta.proveedor||'(sin proveedor)'}</span>
        {OCdata.meta.documento&&<><span style={{fontSize:9,color:C.mut}}>·</span><span style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.07em'}}>Doc</span><span style={{fontSize:11,color:C.txt,fontFamily:'DM Mono,monospace'}}>{OCdata.meta.documento}</span></>}
        {OCdata.meta.fecha&&<><span style={{fontSize:9,color:C.mut}}>·</span><span style={{fontSize:9,color:C.mut,textTransform:'uppercase',letterSpacing:'.07em'}}>Fecha</span><span style={{fontSize:11,color:C.txt}}>{OCdata.meta.fecha}</span></>}
        <span style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {OCdata.meta.estado&&<span style={{fontSize:9,padding:'2px 8px',borderRadius:3,background:(ESTADOS[OCdata.meta.estado]||{}).bg||'rgba(107,114,128,.1)',color:(ESTADOS[OCdata.meta.estado]||{}).color||C.mut,fontWeight:600}}>{(ESTADOS[OCdata.meta.estado]||{}).label||OCdata.meta.estado}</span>}
          <span style={{fontSize:9,color:C.mut}}>{OCdata.lineas.length} líneas</span>
        </span>
      </div>

      {/* Tabla completa */}
      <div style={{overflowX:'auto',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:5}}>
        <table style={{borderCollapse:'collapse',width:'100%',minWidth:1200}}>
          <thead>
            <tr>
              {[
                ['ESTADO',C.mut,90],['CÓD.PROV BASE',C.teal,90],['CÓD.BASE',C.blue,85],['DESCRIPCIÓN',C.txt,200],['FAM.',C.mut,55],
                ['CEN',C.teal,48],['SOL',C.blue,48],['VAR',C.green,48],['STK',C.txt,48],
                ['V.SEM',C.mut,44],['V.QUIN',C.mut,44],['V.MES',C.mut,44],
                ['CANT.OC',C.txt,55],['CANT.FC',C.acc,55],['FACTOR',C.vio,52],['CANT REAL',C.teal,62],['PRECIO FC',C.acc,80],['COSTO REAL',C.mut,75],['MOSTRADOR',C.blue,70],['PV MÍN.',C.vio,70],['SUBTOTAL',C.acc,80],
                ['ACCIÓN',C.mut,90]
              ].map(([h,c,w],i)=>(
                <th key={i} style={{fontSize:8,color:c,padding:'4px 5px',borderBottom:`1px solid ${C.b1}`,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.05em',textAlign:i>5?'right':'left',background:C.p2,width:w,minWidth:w}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OCdata.lineas.map((l,i)=>{
              const diff=calcDiff(l.costoReal,l.precioDoc);
              const totStk=(l.stkDMCN||0)+(l.stkDM01||0)+(l.stkDM03||0);
              const sc=stkColor(totStk,l.vm||0,l.vq||0,l.vs||0);
              const factor = l.factor || 1;
              const cantFCenBase = (l.cantFC||0) * factor;    // en unidades base
              const precioFCenBase = (l.precioDoc||0) / factor; // precio/unidad base
              // Subtotal = cant_FC_base × precio_FC_base = cantFC × precioDoc (simplificado)
              const subtotal = l.cantFC > 0
                ? (l.cantFC||0) * (l.precioDoc||0)
                : l.esSobrante ? (l.cantOC||0) * (l.precioDoc||0) : 0;
              const est=estadoLinea(l);
              const esParcial=est==='PARCIAL_CODP'||est==='PARCIAL_DESC';
              const estCfg=ESTADO_CONFIG[est]||ESTADO_CONFIG.SIN_RECONOCER;
              const rowBg=estCfg.bg;
              const codpFC=l.codDocFC||l.codp||l.cod||'—';
              const codpBase=l.reconocido&&db.art[l.cod]?(db.art[l.cod].codp||l.codp||'—'):l.codp||'—';
              let accion=null;
              if(l.esSobrante&&!l.reconocido){
                accion=<button onClick={()=>abrirModal(i)} style={{...Btn(C.acc,'rgba(240,192,64,.12)'),fontSize:9,padding:'2px 7px'}}>Resolver →</button>;
              } else if(l.esSobrante){
                accion=<span style={bStyle('ora')}>⚡ Sobrante</span>;
              } else if(!l.reconocido){
                accion=<button onClick={()=>abrirModal(i)} style={{...Btn(C.acc,'rgba(240,192,64,.12)'),fontSize:9,padding:'2px 7px'}}>Resolver →</button>;
              } else if(esParcial&&!l.aprobado&&!l.rechazado){
                // Parcial — necesita confirmación y va a importación masiva
                accion=<div style={{display:'flex',gap:2,flexDirection:'column',alignItems:'flex-end'}}>
                  <span style={{fontSize:7,color:C.ora,marginBottom:1}}>⚡ {l.matchTipo==='descripcion'?'DESC':l.matchTipo==='parcial_codp'?'CODP':'COD'}</span>
                  <div style={{display:'flex',gap:2}}>
                    <button onClick={()=>aprobar(i,true)} style={{...Btn(C.green,'rgba(74,222,128,.1)'),fontSize:9,padding:'2px 5px'}} title="Confirmar y agregar a importación masiva">✓</button>
                    <button onClick={()=>abrirModal(i)} style={{...Btn(C.acc,'rgba(240,192,64,.1)'),fontSize:9,padding:'2px 5px'}} title="Cambiar asignación">↺</button>
                  </div>
                </div>;
              } else if(esParcial&&l.aprobado){
                accion=<span style={bStyle('warn')}>✓ Aprobado ·exportar</span>;
              } else if(diff!==null&&diff>0&&!l.aprobado){
                accion=<div style={{display:'flex',gap:2}}><button onClick={()=>aprobar(i,true)} style={{...Btn(C.green,'rgba(74,222,128,.1)'),fontSize:9,padding:'2px 4px'}}>✓</button><button onClick={()=>aprobar(i,false)} style={{...Btn(C.red,'rgba(248,113,113,.1)'),fontSize:9,padding:'2px 4px'}}>✗</button></div>;
              } else if(l.aprobado){
                accion=<span style={bStyle('ok')}>✓ OK</span>;
              } else if(l.rechazado){
                accion=<span style={bStyle('err')}>✗</span>;
              } else {
                accion=<span style={{fontSize:9,color:C.green}}>✓ Exacto</span>;
              }
              const td=(c,s)=><td style={{padding:'4px 5px',borderBottom:`1px solid ${C.b2}`,fontSize:10,verticalAlign:'middle',...s}}>{c}</td>;
              return(
                <tr key={i} style={{background:rowBg}}>
                  {td(<div style={{display:'flex',flexDirection:'column',gap:1}}><span style={{fontSize:8,fontWeight:600,color:estCfg.color,whiteSpace:'nowrap'}}>{estCfg.label}</span>{l.esCombo&&<span style={{fontSize:7,color:l.comboTipo==='inferido'?C.ora:C.vio}}>⊕ {l.comboTipo==='conocido'?'combo':'combo?'}</span>}</div>,{width:90})}
                  {td(l.reconocido?codpBase:'—?',{fontSize:9,color:l.reconocido?C.teal:C.red,fontFamily:'DM Mono,monospace',title:`Cód.Prov Base: ${codpBase}`})}
                  {td(l.reconocido?l.cod:'—?',{fontSize:9,color:C.blue,fontFamily:'DM Mono,monospace'})}
                  {td(<div style={{display:'flex',flexDirection:'column',gap:1,maxWidth:200}}>
                    <span style={{fontWeight:700,fontSize:10,color:C.txt,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={l.desc}>{l.desc||'—'}</span>
                    {l.descFC&&l.descFC!==l.desc&&<span style={{fontSize:9,color:C.mut,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={`FC: ${l.descFC}`}>FC: {l.descFC}</span>}
                    {(l.codDocFC||l.codp)&&<span style={{fontSize:9,fontFamily:'DM Mono,monospace',color:'#4b5275',whiteSpace:'nowrap'}}>
                      {l.codDocFC&&l.codDocFC!==l.codp&&<span>CÓD FC: <span style={{color:C.acc}}>{l.codDocFC}</span>&nbsp;&nbsp;</span>}
                      CÓD BASE: <span style={{color:C.teal}}>{l.codp||'—'}</span>
                    </span>}
                  </div>)}
                  {td(l.fam||'—',{fontSize:9,color:C.mut})}
                  {td(l.stkDMCN||'—',{textAlign:'right',color:l.stkDMCN>0?C.teal:C.mut,fontSize:9})}
                  {td(l.stkDM01||'—',{textAlign:'right',color:l.stkDM01>0?C.blue:C.mut,fontSize:9})}
                  {td(l.stkDM03||'—',{textAlign:'right',color:l.stkDM03>0?C.green:C.mut,fontSize:9})}
                  {td(<span style={{color:sc.color,...sc.extra}}>{totStk||'—'}</span>,{textAlign:'right',fontSize:9})}
                  {td(l.vs||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {td(l.vq||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {td(l.vm||'—',{textAlign:'right',fontSize:9,color:C.mut})}
                  {/* CANT OC */}
                  {td(<NumIn value={l.cantOC} onChange={v=>updLinea(i,'cantOC',v)} color={est==='NO_ENTREGADO'?C.red:C.txt} width={50} />,{textAlign:'right',padding:'3px 4px'})}
                  {/* CANT FC — siempre en unidades base */}
                  {td((()=>{
                    const cf=l.cantFC||0;
                    if(!cf&&!l.esSobrante)return <span style={{color:C.red,fontSize:9,fontWeight:600}}>—</span>;
                    const cfBase = cf * factor;
                    const color = cfBase < l.cantOC ? C.red : cfBase > l.cantOC ? C.teal : C.green;
                    return <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:0}}>
                      <span style={{color,fontWeight:600,fontSize:10}}>{cfBase.toLocaleString('es-AR')}</span>
                      {l.esCombo&&<span style={{fontSize:8,color:C.mut}}>{cf}×{factor}</span>}
                    </div>;
                  })(),{textAlign:'right'})}
                  {/* FACTOR combo */}
                  {td(l.esCombo
                    ?<span style={{color:C.vio,fontWeight:600,fontSize:10}}>
                        ×{l.factor}
                        {l.comboTipo==='inferido'&&<span style={{fontSize:8,color:C.ora,marginLeft:3}}>?</span>}
                      </span>
                    :<span style={{color:C.mut,fontSize:9}}>—</span>,
                    {textAlign:'right'})}
                  {/* CANT REAL (unidades base) */}
                  {td(l.esCombo
                    ?<span style={{color:C.teal,fontWeight:700,fontSize:11}}>{(l.cantReal||l.cantOC).toLocaleString('es-AR')}</span>
                    :<span style={{color:C.mut,fontSize:9}}>—</span>,
                    {textAlign:'right'})}
                  {/* PRECIO FC — editable (precio por unidad de combo). Sub-texto: precio/u.base si es combo */}
                  {td(<div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:0}}>
                    <NumIn value={l.precioDoc} onChange={v=>updLinea(i,'precioDoc',v)} color={C.acc} width={77} />
                    {l.esCombo&&precioFCenBase>0&&<span style={{fontSize:8,color:C.mut,marginTop:1}}>${precioFCenBase.toLocaleString('es-AR',{maximumFractionDigits:2})}/u</span>}
                  </div>,{textAlign:'right',padding:'3px 4px'})}
                  {td(fp(l.costoReal),{textAlign:'right',color:C.mut})}
                  {td(fp(l.mostrador),{textAlign:'right',color:C.blue})}
                  {td(fp(l.pvMin),{textAlign:'right',color:C.vio})}
                  {td(subtotal>0?'$'+fn(subtotal):<span style={{color:C.red,fontSize:9}}>—</span>,{textAlign:'right',color:C.acc,fontWeight:500})}
                  {td(accion)}
                </tr>
              );
            })}
            {/* Fila de totales */}
            <tr style={{background:'rgba(240,192,64,.04)'}}>
              <td colSpan={6} style={{padding:'5px 5px',fontSize:9,color:C.mut,textAlign:'right',borderTop:`1px solid ${C.b1}`}}>TOTALES →</td>
              <td colSpan={7} style={{padding:'5px 5px',borderTop:`1px solid ${C.b1}`}}></td>
              <td style={{padding:'5px 5px',textAlign:'right',borderTop:`1px solid ${C.b1}`,fontSize:10,fontWeight:600}}>{fn(OCdata.lineas.reduce((s,l)=>s+l.cantOC,0))}</td>
              <td style={{padding:'5px 5px',textAlign:'right',borderTop:`1px solid ${C.b1}`,fontSize:10,fontWeight:600,color:C.acc}}>{fn(OCdata.lineas.reduce((s,l)=>s+(l.cantFC||0)*(l.factor||1),0))}</td>
              <td colSpan={4} style={{padding:'5px 5px',borderTop:`1px solid ${C.b1}`}}></td>
              <td style={{padding:'5px 5px',textAlign:'right',borderTop:`1px solid ${C.b1}`,fontSize:10,color:C.acc,fontWeight:700}}>${fn(OCdata.lineas.reduce((s,l)=>s+(l.cantRemito>0?l.cantRemito*(l.precioDoc||0):l.cantOC*(l.precioDoc||0)),0))}</td>
              <td style={{padding:'5px 5px',borderTop:`1px solid ${C.b1}`}}></td>
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
function ModalArt({modal,setModal,linea,db,onAsignar,onNuevo,OCprov}){
  if(!linea)return null;
  const prov=OCprov||linea.prov||''; // OC provider is the main context
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
              {res.map(({cod,a,type,esMismo},ridx)=>{
                const prevEsMismo = ridx>0?res[ridx-1].esMismo:true;
                const showSep = !esMismo && prevEsMismo && ridx>0;
                const borderCol = type==='exacto'?C.acc:type==='parcial_codp'?C.acc:type==='parcial_cod'?C.teal:C.blue;
                return(<React.Fragment key={cod}>
                  {showSep&&<div style={{padding:'5px 14px',background:'rgba(107,114,128,.1)',borderBottom:`1px solid ${C.b1}`,fontSize:8,color:C.mut,letterSpacing:'.08em',textTransform:'uppercase'}}>— Otros proveedores — al asignar genera nueva línea de proveedor</div>}
                  <div onClick={()=>onAsignar(modal.idx,cod,type,esMismo)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',cursor:'pointer',borderBottom:`1px solid ${C.b2}`,borderLeft:`3px solid ${borderCol}`,background:esMismo?'transparent':'rgba(107,114,128,.03)'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:esMismo?C.txt:C.mut,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.desc}</div>
                      <div style={{fontSize:9,color:C.mut,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{color:C.blue}}>{cod}</span>
                        <span>codp: <span style={{color:C.acc}}>{a.codp||'—'}</span></span>
                        <span style={{color:esMismo?C.teal:C.mut}}>{a.prov||'—'}</span>
                        <span>{a.fam||'—'}</span>
                        {a.costoReal>0&&<span style={{color:C.acc}}>CR: ${fn(a.costoReal)}</span>}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2}}>
                      {type==='exacto'&&<span style={{...bStyle('warn'),fontSize:7}}>exacto</span>}
                      {type==='parcial_codp'&&<span style={{...bStyle('warn'),fontSize:7}}>codp parcial</span>}
                      {type==='parcial_cod'&&<span style={{...bStyle('teal'),fontSize:7}}>cod parcial</span>}
                      {(type==='desc'||(!type))&&<span style={{...bStyle('info'),fontSize:7}}>desc.</span>}
                      {!esMismo&&<span style={{...bStyle('ora'),fontSize:7}}>otro prov.</span>}
                    </div>
                  </div>
                </React.Fragment>);
              })}
            </div>
            <div style={{padding:'8px 14px',borderTop:`1px solid ${C.b1}`,display:'flex',gap:6,flexShrink:0}}>
              <button onClick={()=>setModal(m=>({...m,open:false}))} style={Btn(C.mut)}>Omitir</button>
              <button onClick={()=>setModal(m=>({...m,tab:'nuevo'}))} style={{...Btn(C.vio,'rgba(192,132,252,.08)')}}>＋ No existe — crear nuevo</button>
            </div>
          </div>
        )}

        {modal.tab==='combo'&&(()=>{
          const cl=modal.clasificacion||{};
          const f=modal.nuevoForm;
          const costoCoincide=cl.costoCoincide;
          return(
          <div style={{display:'flex',flexDirection:'column',gap:10,padding:'12px 0'}}>
            {cl.artBase&&(
              <div style={{background:'rgba(45,212,191,.06)',border:`1px solid rgba(45,212,191,.2)`,borderRadius:6,padding:'10px 14px'}}>
                <div style={{fontSize:10,color:C.teal,marginBottom:4}}>Artículo base encontrado</div>
                <div style={{fontSize:12,fontWeight:600,color:C.txt}}>{cl.artBase.desc||'—'}</div>
                <div style={{fontSize:10,color:C.mut,marginTop:2}}>
                  Cod: {cl.codBase} · CR: ${(cl.artBase.costoReal||0).toLocaleString('es-AR')} · Factor: ×{cl.factor} = {cl.factor} unidades del base
                </div>
              </div>
            )}
            <div style={{background:`rgba(240,192,64,.06)`,border:`1px solid rgba(240,192,64,.2)`,borderRadius:6,padding:'10px 14px'}}>
              <div style={{fontSize:10,color:C.acc,marginBottom:8}}>Combo a crear</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div>
                  <div style={{fontSize:9,color:C.mut,marginBottom:3}}>Código sugerido</div>
                  <input value={f.cod||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,cod:e.target.value}}))}
                    style={{width:'100%',padding:'5px 8px',background:'rgba(255,255,255,.04)',border:`1px solid ${C.b1}`,borderRadius:4,color:C.txt,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.mut,marginBottom:3}}>Factor</div>
                  <input value={f.factor||cl.factor||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,factor:Number(e.target.value)}}))}
                    style={{width:'100%',padding:'5px 8px',background:'rgba(255,255,255,.04)',border:`1px solid ${C.b1}`,borderRadius:4,color:C.vio,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
                </div>
              </div>
              <div style={{marginTop:8}}>
                <div style={{fontSize:9,color:C.mut,marginBottom:3}}>Descripción (editable)</div>
                <input value={f.desc||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,desc:e.target.value}}))}
                  style={{width:'100%',padding:'5px 8px',background:'rgba(255,255,255,.04)',border:`1px solid ${C.b1}`,borderRadius:4,color:C.txt,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
                <div>
                  <div style={{fontSize:9,color:C.mut,marginBottom:3}}>Costo sugerido</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input value={f.costoReal||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,costoReal:Number(e.target.value)}}))}
                      style={{flex:1,padding:'5px 8px',background:'rgba(255,255,255,.04)',border:`1px solid ${C.b1}`,borderRadius:4,color:C.teal,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
                    {costoCoincide&&<span style={{fontSize:9,color:C.green}}>✓ coincide FC</span>}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.mut,marginBottom:3}}>Familia</div>
                  <input value={f.fam||''} onChange={e=>setModal(m=>({...m,nuevoForm:{...m.nuevoForm,fam:e.target.value}}))}
                    style={{width:'100%',padding:'5px 8px',background:'rgba(255,255,255,.04)',border:`1px solid ${C.b1}`,borderRadius:4,color:C.txt,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:4}}>
              <button onClick={()=>setModal(m=>({...m,tab:'buscar'}))} style={Btn(C.mut)}>← Buscar en su lugar</button>
              <button onClick={()=>{onNuevo();}} style={{background:C.vio,color:'#fff',border:'none',borderRadius:4,padding:'7px 18px',fontSize:11,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
                ⊕ Confirmar combo nuevo
              </button>
            </div>
          </div>
          );
        })()}
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
