// ===== HOOKS COMPARTIDOS — con sincronización Redis =====
import { useState, useEffect } from 'react';
import { storage, KEYS } from './storage';
import { api } from './api';

// Hook genérico con sync remoto al montar
function useSyncedState(key, fallback) {
  const [data, setData]   = useState(() => storage.get(key, fallback));
  const [synced, setSynced] = useState(false);

  // Al montar: traer desde Redis y actualizar si hay diferencia
  useEffect(() => {
    api.get(key, null).then(remote => {
      if (remote !== null) {
        setData(remote);
        localStorage.setItem(key, JSON.stringify(remote));
      }
      setSynced(true);
    }).catch(() => setSynced(true));
  }, [key]);

  const save = (value) => {
    setData(value);
    storage.set(key, value); // escribe local + dispara remoto
  };

  return { data, save, synced };
}

// ─── Compras ─────────────────────────────────────────────────────────────────
export function useCompras() {
  const { data: compras, save, synced } = useSyncedState(KEYS.COMPRAS, []);
  const add    = (oc)     => save([oc, ...compras]);
  const update = (id, ch) => save(compras.map(c => c.id === id ? { ...c, ...ch } : c));
  const remove = (id)     => save(compras.filter(c => c.id !== id));
  return { compras, add, update, remove, synced };
}

// ─── Stock ────────────────────────────────────────────────────────────────────
export function useStock() {
  const { data: stockDb,   save: saveDb,   synced: s1 } = useSyncedState(KEYS.STOCK_DB,   {});
  const { data: stockMeta, save: saveMeta, synced: s2 } = useSyncedState(KEYS.STOCK_META, {});

  const setStock = (db, meta) => {
    saveDb(db);
    saveMeta(meta);
  };

  return { stockDb, stockMeta, setStock, synced: s1 && s2 };
}

// ─── Proveedores ─────────────────────────────────────────────────────────────
const PROVEEDORES_DEFAULT = [
  'ORIENTAL PARTY S.R.L.','BECHAR SRL','LEDEVIT','DISTRIBUIDORA NORTE',
  'PAPELY MÁS SRL','JUGUETEX SA','GOLOSINAS DEL SUR','REPOSTERÍA TOTAL',
  'COTILLÓN MAYORISTA','LIBRERÍA CENTRAL SA','ALFAPLAST SRL','COLORTEX',
  'PAPELERA QUILMES','DISTRIB. BELGRANO','MEGA TOYS SRL','CARNAVAL SHOP',
  'PASTELART','GLOBOMANIA','EDITORIAL KAPELUZ','SIN PROVEEDOR',
];

export function useProveedores() {
  const { data: lista, save } = useSyncedState('delmy_proveedores', PROVEEDORES_DEFAULT);
  const add    = (p) => save([...lista, p]);
  const remove = (p) => save(lista.filter(x => x !== p));
  return { lista, add, remove };
}
