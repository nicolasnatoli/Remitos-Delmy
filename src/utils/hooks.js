// ===== HOOKS COMPARTIDOS — COMPRAS / STOCK / VENTAS =====
import { useState } from 'react';
import { storage } from './storage';

// ─── Compras ─────────────────────────────────────────────────────────────────
export function useCompras() {
  const [compras, setCompras] = useState(() => storage.get('delmy_compras_v2', []));
  const save = (data) => { setCompras(data); storage.set('delmy_compras_v2', data); };
  const add    = (oc)      => save([oc, ...compras]);
  const update = (id, ch)  => save(compras.map(c => c.id === id ? { ...c, ...ch } : c));
  const remove = (id)      => save(compras.filter(c => c.id !== id));
  return { compras, add, update, remove };
}

// ─── Stock (planilla de ventas cargada) ───────────────────────────────────────
export function useStock() {
  const [stockDb,   setDb]   = useState(() => storage.get('delmy_stock_db',   {}));
  const [stockMeta, setMeta] = useState(() => storage.get('delmy_stock_meta', {}));
  const setStock = (db, meta) => {
    setDb(db);   storage.set('delmy_stock_db',   db);
    setMeta(meta); storage.set('delmy_stock_meta', meta);
  };
  return { stockDb, stockMeta, setStock };
}

// ─── Ventas ───────────────────────────────────────────────────────────────────
export function useVentas() {
  const [ventas, setVentas] = useState(() => storage.get('delmy_ventas_v1', []));
  const addVentas = (rows) => {
    const ids  = new Set(ventas.map(v => `${v.cod}_${v.fecha}`));
    const news = rows.filter(r => !ids.has(`${r.cod}_${r.fecha}`));
    const merged = [...ventas, ...news];
    setVentas(merged);
    storage.set('delmy_ventas_v1', merged);
  };
  return { ventas, addVentas };
}

// ─── Proveedores (maestro) ────────────────────────────────────────────────────
export function useProveedores() {
  const DEFAULT = [
    'ORIENTAL PARTY S.R.L.','BECHAR SRL','LEDEVIT','DISTRIBUIDORA NORTE',
    'PAPELY MÁS SRL','JUGUETEX SA','GOLOSINAS DEL SUR','REPOSTERÍA TOTAL',
    'COTILLÓN MAYORISTA','LIBRERÍA CENTRAL SA','ALFAPLAST SRL','COLORTEX',
    'PAPELERA QUILMES','DISTRIB. BELGRANO','MEGA TOYS SRL','CARNAVAL SHOP',
    'PASTELART','GLOBOMANIA','EDITORIAL KAPELUZ','SIN PROVEEDOR',
  ];
  const [lista, setLista] = useState(() => storage.get('delmy_proveedores', DEFAULT));
  const add    = (p) => { const n=[...lista,p]; setLista(n); storage.set('delmy_proveedores',n); };
  const remove = (p) => { const n=lista.filter(x=>x!==p); setLista(n); storage.set('delmy_proveedores',n); };
  return { lista, add, remove };
}

// ─── Artículos (maestro) ──────────────────────────────────────────────────────
export function useArticulos() {
  const [articulos, setArticulos] = useState(() => storage.get('delmy_articulos', []));
  const setFromStock = (stockDb) => {
    const arts = Object.entries(stockDb).map(([cod, v]) => ({
      cod, desc: v.desc || '', proveedor: v.proveedor || '', familia: v.familia || '',
    }));
    setArticulos(arts);
    storage.set('delmy_articulos', arts);
  };
  return { articulos, setFromStock };
}
