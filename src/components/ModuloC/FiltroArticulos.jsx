// ─── FiltroArticulos — filtros aditivos en cadena ────────────────────────────
// Uso: <FiltroArticulos art={db.art} onChange={setFiltrados} />
// Cada filtro achica el universo del anterior.
// Chips removibles muestran filtros activos.

import React, { useState, useMemo, useCallback, useRef } from 'react';

const C = {
  bg:'#0c0e14', p:'#111420', p2:'#161925', b1:'#1e2133', b2:'#242840',
  acc:'#f0c040', green:'#4ade80', red:'#f87171', blue:'#60a5fa',
  teal:'#2dd4bf', ora:'#fb923c', vio:'#c084fc', mut:'#6b7280', txt:'#e8eaf0',
};

// Aplica un filtro a una lista de [cod, art]
function aplicarFiltro(lista, filtro) {
  const { tipo, valor } = filtro;
  const v = valor.toLowerCase().trim();
  return lista.filter(([cod, a]) => {
    switch(tipo) {
      case 'familia':   return (a.fam||'').toLowerCase() === v;
      case 'categoria': return (a.cat||'').toLowerCase() === v;
      case 'marca':     return (a.marca||'').toLowerCase() === v;
      case 'proveedor': return (a.prov||'').toLowerCase().includes(v);
      case 'texto':
        return cod.toLowerCase().includes(v)
          || (a.codp||'').toLowerCase().includes(v)
          || (a.desc||'').toLowerCase().includes(v);
      default: return true;
    }
  });
}

const CHIP_COLORS = {
  familia:   { bg:'rgba(45,212,191,.15)',  color:'#2dd4bf' },
  categoria: { bg:'rgba(96,165,250,.15)',  color:'#60a5fa' },
  marca:     { bg:'rgba(192,132,252,.15)', color:'#c084fc' },
  proveedor: { bg:'rgba(251,146,60,.15)',  color:'#fb923c' },
  texto:     { bg:'rgba(240,192,64,.15)',  color:'#f0c040' },
};

export default function FiltroArticulos({ art, onChange, placeholder = 'Buscar...', compact = false }) {
  const [filtros, setFiltros] = useState([]); // [{tipo, valor, label}]
  const [query, setQuery]     = useState('');
  const [dropdown, setDropdown] = useState(null); // 'familia'|'categoria'|'marca'|'proveedor'|null
  const inputRef = useRef();

  // Lista filtrada progresiva
  const listaBruta = useMemo(() => Object.entries(art||{}), [art]);

  const listaFiltrada = useMemo(() => {
    let lista = listaBruta;
    for (const f of filtros) lista = aplicarFiltro(lista, f);
    return lista;
  }, [listaBruta, filtros]);

  // Opciones disponibles para cada dimensión (solo dentro del universo filtrado)
  const opciones = useMemo(() => ({
    familia:   [...new Set(listaFiltrada.map(([,a])=>a.fam||'').filter(Boolean))].sort(),
    categoria: [...new Set(listaFiltrada.map(([,a])=>a.cat||'').filter(Boolean))].sort(),
    marca:     [...new Set(listaFiltrada.map(([,a])=>a.marca||'').filter(Boolean))].sort(),
    proveedor: [...new Set(listaFiltrada.map(([,a])=>a.prov||'').filter(Boolean))].sort(),
  }), [listaFiltrada]);

  // Resultado final aplicando también el query actual
  const resultado = useMemo(() => {
    if (!query.trim()) return listaFiltrada;
    return aplicarFiltro(listaFiltrada, { tipo:'texto', valor:query });
  }, [listaFiltrada, query]);

  // Notificar cambios
  const prev = useRef(null);
  useMemo(() => {
    if (prev.current !== resultado) {
      prev.current = resultado;
      onChange?.(resultado);
    }
  }, [resultado, onChange]);

  const agregarFiltro = useCallback((tipo, valor, label) => {
    setFiltros(f => [...f, { tipo, valor, label: label||valor }]);
    setDropdown(null);
  }, []);

  const quitarFiltro = useCallback((idx) => {
    setFiltros(f => f.filter((_,i)=>i!==idx));
  }, []);

  const confirmarTexto = useCallback(() => {
    if (!query.trim()) return;
    agregarFiltro('texto', query.trim(), `"${query.trim()}"`);
    setQuery('');
  }, [query, agregarFiltro]);

  const BTNS = [
    { label:'Familia',   key:'familia' },
    { label:'Categoría', key:'categoria' },
    { label:'Marca',     key:'marca' },
    { label:'Proveedor', key:'proveedor' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {/* Fila principal: input + botones dimensión */}
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{display:'flex',flex:1,minWidth:200,background:C.p2,border:`1px solid ${C.b2}`,borderRadius:6,overflow:'hidden'}}>
          <input
            ref={inputRef}
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') confirmarTexto(); }}
            placeholder={placeholder}
            style={{flex:1,background:'transparent',border:'none',padding:'7px 10px',color:C.txt,fontFamily:'DM Mono,monospace',fontSize:11,outline:'none'}}
          />
          {query&&<button onClick={confirmarTexto} style={{background:C.acc,border:'none',padding:'0 10px',color:'#0c0e14',cursor:'pointer',fontSize:10,fontFamily:'DM Mono,monospace',fontWeight:600}}>+ Agregar</button>}
        </div>
        {BTNS.map(({label,key})=>(
          <button key={key} onClick={()=>setDropdown(dropdown===key?null:key)}
            style={{padding:'5px 10px',background:dropdown===key?'rgba(240,192,64,.1)':'transparent',border:`1px solid ${dropdown===key?C.acc:C.b1}`,borderRadius:5,color:dropdown===key?C.acc:C.mut,fontSize:10,fontFamily:'DM Mono,monospace',cursor:'pointer'}}>
            {label} {opciones[key].length>0&&<span style={{color:dropdown===key?C.acc:C.mut,fontSize:8}}>({opciones[key].length})</span>}
          </button>
        ))}
        <span style={{fontSize:9,color:C.mut,marginLeft:4}}>{resultado.length.toLocaleString('es-AR')} arts</span>
      </div>

      {/* Chips de filtros activos */}
      {filtros.length>0&&(
        <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:8,color:C.mut,marginRight:2}}>FILTROS:</span>
          {filtros.map((f,i)=>{
            const cs=CHIP_COLORS[f.tipo]||CHIP_COLORS.texto;
            return(
              <span key={i} style={{display:'flex',alignItems:'center',gap:4,background:cs.bg,color:cs.color,borderRadius:10,padding:'2px 8px',fontSize:9,fontFamily:'DM Mono,monospace'}}>
                <span style={{fontSize:7,opacity:.7}}>{f.tipo}:</span> {f.label}
                <span onClick={()=>quitarFiltro(i)} style={{cursor:'pointer',opacity:.7,marginLeft:2,fontWeight:700}}>×</span>
              </span>
            );
          })}
          <button onClick={()=>setFiltros([])} style={{background:'transparent',border:'none',color:C.mut,fontSize:9,cursor:'pointer',padding:'0 4px'}}>Limpiar todo</button>
        </div>
      )}

      {/* Dropdown de opciones */}
      {dropdown&&(
        <div style={{background:C.p,border:`1px solid ${C.b1}`,borderRadius:6,maxHeight:200,overflowY:'auto',display:'flex',flexWrap:'wrap',gap:4,padding:8}}>
          {opciones[dropdown].slice(0,100).map(v=>(
            <button key={v} onClick={()=>agregarFiltro(dropdown,v)}
              style={{padding:'3px 10px',background:C.p2,border:`1px solid ${C.b1}`,borderRadius:10,color:C.txt,fontSize:9,fontFamily:'DM Mono,monospace',cursor:'pointer',whiteSpace:'nowrap'}}>
              {v}
            </button>
          ))}
          {opciones[dropdown].length===0&&<span style={{fontSize:9,color:C.mut}}>Sin opciones disponibles</span>}
        </div>
      )}
    </div>
  );
}
