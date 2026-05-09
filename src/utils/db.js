// ===== DB — capa de datos unificada =====
// Redis para artículos (grande) · localStorage para el resto
// Delmy Party SRL · Industrial Partner

const SK = {
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
};

// ─── localStorage sync ────────────────────────────────────────────────────────
export function lsGet(k, d=null) {
  try { const v=localStorage.getItem(k); return v?JSON.parse(v):d; } catch { return d; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
}
export function lsSetRaw(k, v) {
  try { localStorage.setItem(k, v); return true; } catch { return false; }
}
export function lsGetRaw(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

// ─── API (Redis via servidor) ─────────────────────────────────────────────────
async function apiFetch(path, opts={}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(opts.headers||{}) },
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||`HTTP ${res.status}`); }
  return res.json();
}

export const api = {
  get:   (key)       => apiFetch(`/api/store/${key}`),
  set:   (key, val)  => apiFetch(`/api/store/${key}`,    { method:'POST',  body: JSON.stringify({value:val}) }),
  merge: (key, val)  => apiFetch(`/api/store/${key}/merge`, { method:'POST', body: JSON.stringify({value:val}) }),
  del:   (key)       => apiFetch(`/api/store/${key}`,    { method:'DELETE' }),
};

// ─── Artículos — siempre via Redis (demasiado grande para localStorage) ───────
export async function saveArt(artObj) {
  // Guardar en Redis
  try {
    await api.set(SK.art, artObj);
    // Cache local solo para la sesión actual (puede fallar por tamaño — no importa)
    lsSet('dm_art_cache_ts', Date.now()); // solo timestamp como bandera
    try { localStorage.setItem(SK.art, JSON.stringify(artObj)); } catch { /* muy grande, ok */ }
    return true;
  } catch(e) {
    console.error('[saveArt]', e.message);
    return false;
  }
}

export async function loadArt() {
  // 1. Intentar localStorage primero (rápido)
  const local = lsGet(SK.art, null);
  if (local && Object.keys(local).length > 0) return local;
  // 2. Fallback a Redis
  try {
    const { value, exists } = await api.get(SK.art);
    if (exists && value) {
      try { localStorage.setItem(SK.art, JSON.stringify(value)); } catch { /* ok */ }
      return value;
    }
  } catch(e) {
    console.error('[loadArt]', e.message);
  }
  return {};
}

export { SK };
