// ===== API CLIENT — reemplaza localStorage con Redis remoto =====
// Delmy Party SRL · Industrial Partner

// En desarrollo: http://localhost:3001
// En Railway: misma URL base que el frontend (proxy configurado en package.json)
const API_BASE = process.env.REACT_APP_API_URL || '';

function getPin() {
  return localStorage.getItem('delmy_pin') || '';
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const pin = getPin();
  if (pin) h['x-delmy-key'] = pin;
  return h;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── API pública ──────────────────────────────────────────────────────────────
export const api = {
  // Verificar salud del servidor
  health: () => apiFetch('/api/health'),

  // Obtener valor
  get: async (key, fallback = null) => {
    try {
      const { value, exists } = await apiFetch(`/api/store/${key}`);
      return exists ? value : fallback;
    } catch (err) {
      console.warn(`[api.get] ${key} fallback local:`, err.message);
      // fallback a localStorage si el server no responde
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    }
  },

  // Guardar valor
  set: async (key, value) => {
    try {
      await apiFetch(`/api/store/${key}`, {
        method: 'POST',
        body: JSON.stringify({ value }),
      });
      // Mirror en localStorage como cache offline
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`[api.set] ${key} solo local:`, err.message);
      localStorage.setItem(key, JSON.stringify(value));
      return false;
    }
  },

  // Merge de objetos (para remitos — nunca borra, siempre suma)
  merge: async (key, incoming) => {
    try {
      const result = await apiFetch(`/api/store/${key}/merge`, {
        method: 'POST',
        body: JSON.stringify({ value: incoming }),
      });
      // Actualizar cache local con el resultado
      const fresh = await apiFetch(`/api/store/${key}`);
      if (fresh.exists) localStorage.setItem(key, JSON.stringify(fresh.value));
      return result;
    } catch (err) {
      console.warn(`[api.merge] ${key} solo local:`, err.message);
      // fallback: merge en localStorage
      try {
        const v = localStorage.getItem(key);
        const existing = v ? JSON.parse(v) : {};
        const merged = { ...existing, ...incoming };
        localStorage.setItem(key, JSON.stringify(merged));
      } catch {}
      return { ok: false };
    }
  },

  // Borrar clave
  delete: async (key) => {
    try {
      await apiFetch(`/api/store/${key}`, { method: 'DELETE' });
      localStorage.removeItem(key);
      return true;
    } catch (err) {
      console.warn(`[api.delete] ${key}:`, err.message);
      localStorage.removeItem(key);
      return false;
    }
  },

  // Listar todas las claves (para admin)
  list: () => apiFetch('/api/store'),
};

// ─── PIN ──────────────────────────────────────────────────────────────────────
export function savePin(pin) {
  localStorage.setItem('delmy_pin', pin);
}
export function getStoredPin() {
  return localStorage.getItem('delmy_pin') || '';
}
