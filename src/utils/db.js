// ===== DB — capa de datos unificada =====
// Redis para todo lo que supera localStorage
// Delmy Party SRL · Industrial Partner

export const SK = {
  art:    'dm_art_v3',
  stk:    'dm_stk_v3',
  vs:     'dm_vs_v3',
  vq:     'dm_vq_v3',
  vm:     'dm_vm_v3',
  vh:     'dm_vh_v3',
  plan:   'dm_plan_v3',
  share:  'dm_share_v3',
  meta:   'dm_meta_v3',
  pins:   'dm_pins_v3',
  ocs:    'dm_ocs_v3',
  rec:    'dm_rec_v3',
  nuevos: 'dm_nuevos_art',
  lista:  'dm_lista_compra',  // listado activo de compra
};

// ─── localStorage ─────────────────────────────────────────────────────────────
export const lsGet    = (k,d=null)  => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):d; } catch { return d; } };
export const lsSet    = (k,v)       => { try { localStorage.setItem(k,JSON.stringify(v)); return true; } catch { return false; } };
export const lsSetRaw = (k,v)       => { try { localStorage.setItem(k,v); return true; } catch { return false; } };
export const lsGetRaw = (k)         => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsDel    = (k)         => { try { localStorage.removeItem(k); } catch {} };

// ─── API Redis via servidor ───────────────────────────────────────────────────
async function apiFetch(path, opts={}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||`HTTP ${res.status}`); }
  return res.json();
}

export const api = {
  get:   (key)      => apiFetch(`/api/store/${key}`),
  set:   (key, val) => apiFetch(`/api/store/${key}`,       { method:'POST',   body: JSON.stringify({value:val}) }),
  del:   (key)      => apiFetch(`/api/store/${key}`,       { method:'DELETE'  }),
  list:  ()         => apiFetch(`/api/store`),
};

// ─── Artículos (Redis — grande) ───────────────────────────────────────────────
export async function saveArt(artCompact) {
  try {
    await api.set(SK.art, artCompact);
    try { localStorage.setItem(SK.art, JSON.stringify(artCompact)); } catch { /* ok si no entra */ }
    return true;
  } catch(e) { console.error('[saveArt]', e.message); return false; }
}

// Expandir formato compacto "prov|codp|desc|fam|cat|marca|cr|pv|most" a objeto
function expandArtCompact(compact) {
  const o = {};
  for (const [k, s] of Object.entries(compact || {})) {
    if (typeof s === 'string') {
      const p = s.split('|');
      o[k] = { prov:p[0]||'', codp:p[1]||'', desc:p[2]||'', fam:p[3]||'', cat:p[4]||'', marca:p[5]||'', costoReal:+p[6]||0, pvMin:+p[7]||0, mostrador:+p[8]||0 };
    } else if (s && typeof s === 'object') {
      o[k] = s; // ya expandido
    }
  }
  return o;
}

export async function loadArt() {
  // 1. localStorage si tiene datos
  try {
    const local = localStorage.getItem(SK.art);
    if (local) {
      const obj = JSON.parse(local);
      if (obj && Object.keys(obj).length > 100) return expandArtCompact(obj);
    }
  } catch {}
  // 2. Redis
  try {
    const { value, exists } = await api.get(SK.art);
    if (exists && value && Object.keys(value).length > 0) {
      try { localStorage.setItem(SK.art, JSON.stringify(value)); } catch {}
      return expandArtCompact(value);
    }
  } catch(e) { console.error('[loadArt Redis]', e.message); }
  return {};
}

// ─── Datos de stock/ventas (Redis — medianos) ─────────────────────────────────
export async function saveMedium(key, value) {
  try {
    await api.set(key, value);
    lsSet(key, value);
    return true;
  } catch(e) {
    // Fallback solo localStorage
    return lsSet(key, value);
  }
}

export async function loadMedium(key, expandFn) {
  // 1. localStorage
  try {
    const local = localStorage.getItem(key);
    if (local) {
      const obj = JSON.parse(local);
      if (obj && Object.keys(obj).length > 0) return expandFn ? expandFn(obj) : obj;
    }
  } catch {}
  // 2. Redis
  try {
    const { value, exists } = await api.get(key);
    if (exists && value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      return expandFn ? expandFn(value) : value;
    }
  } catch(e) { console.error(`[loadMedium ${key}]`, e.message); }
  return {};
}

// ─── Meta / configuración pequeña (solo localStorage) ────────────────────────
export const getMeta  = ()    => lsGet(SK.meta, {});
export const saveMeta = (m)   => lsSet(SK.meta, m);

// ─── Lista de compra activa ───────────────────────────────────────────────────
export const getListaCompra  = ()  => lsGet(SK.lista, { prov:'', items:{}, ts:null });
export const saveListaCompra = (l) => lsSet(SK.lista, l);
export const clearListaCompra= ()  => lsDel(SK.lista);
