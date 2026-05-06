// ===== STORAGE — usa API Redis (con fallback localStorage) =====
import { api } from './api';

export const KEYS = {
  REMITOS:     'delmy_remitos',
  ACUMULADO:   'delmy_acumulado',
  RECEPCIONES: 'delmy_rec_v3',
  COMPRAS:     'delmy_compras_v2',
  STOCK_DB:    'delmy_stock_db',
  STOCK_META:  'delmy_stock_meta',
  API_KEY:     'delmy_api_key',   // siempre local (nunca al server)
};

// storage.get/set: wrapper async sobre api
// Para compatibilidad con código sync existente, también exponemos
// versiones sync que leen del cache localStorage
export const storage = {
  // Sync — lee solo del cache local (para inicialización de hooks)
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  // Sync — escribe en cache local y dispara escritura remota async
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      // Sync remoto en background (no bloqueante)
      if (key !== KEYS.API_KEY) {
        api.set(key, value).catch(err =>
          console.warn('[storage.set background]', key, err.message)
        );
      }
      return true;
    } catch { return false; }
  },
  remove(key) {
    localStorage.removeItem(key);
    if (key !== KEYS.API_KEY) {
      api.delete(key).catch(() => {});
    }
  },
  // Async — fuerza lectura desde Redis (para sincronización al cargar)
  async fetch(key, fallback = null) {
    return api.get(key, fallback);
  },
};

// Merge de remitos (usa endpoint de merge del servidor)
export async function mergeRemitosRemote(incoming) {
  return api.merge(KEYS.REMITOS, incoming);
}

// Merge local (fallback o para compatibilidad)
export function mergeRemitos(existentes, nuevos) {
  const merged = { ...existentes };
  for (const [k, v] of Object.entries(nuevos)) {
    merged[k] = { ...(merged[k] || {}), ...v };
  }
  return merged;
}

export function saveRecepcion(rec) {
  const list = storage.get(KEYS.RECEPCIONES, []);
  const idx = list.findIndex(r => r.id === rec.id);
  if (idx >= 0) list[idx] = rec;
  else list.unshift(rec);
  storage.set(KEYS.RECEPCIONES, list);
}

export function getApiKey()  { return localStorage.getItem(KEYS.API_KEY) || ''; }
export function setApiKey(k) { localStorage.setItem(KEYS.API_KEY, k); }
