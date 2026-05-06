// ===== STORAGE UTILITIES =====
// Delmy Party SRL — Sistema Operativo

export const KEYS = {
  REMITOS:    'delmy_remitos',
  ACUMULADO:  'delmy_acumulado',
  RECEPCIONES:'delmy_rec_v3',
  API_KEY:    'delmy_api_key',
};

export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { localStorage.removeItem(key); },
};

// Merge remitos por # Remito (Opción C)
export function mergeRemitos(existentes, nuevos) {
  const merged = { ...existentes };
  for (const [k, v] of Object.entries(nuevos)) {
    merged[k] = { ...(merged[k] || {}), ...v };
  }
  return merged;
}

// Agregar recepción
export function saveRecepcion(rec) {
  const list = storage.get(KEYS.RECEPCIONES, []);
  const idx = list.findIndex(r => r.id === rec.id);
  if (idx >= 0) list[idx] = rec;
  else list.unshift(rec);
  storage.set(KEYS.RECEPCIONES, list);
}

export function getApiKey() { return storage.get(KEYS.API_KEY, ''); }
export function setApiKey(k) { storage.set(KEYS.API_KEY, k); }
