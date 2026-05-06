import React, { useState, useEffect } from 'react';
import { api, savePin, getStoredPin } from '../../utils/api';

export default function SyncStatus() {
  const [status, setStatus] = useState('connecting'); // connecting | ok | error | offline
  const [showPin, setShowPin]   = useState(false);
  const [pinInput, setPinInput] = useState(getStoredPin());
  const [pinSaved, setPinSaved] = useState(false);
  const [storeInfo, setStoreInfo] = useState(null);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  async function checkHealth() {
    try {
      const h = await api.health();
      setStatus(h.redis ? 'ok' : 'error');
    } catch {
      setStatus('offline');
    }
  }

  async function loadStoreInfo() {
    try {
      const info = await api.list();
      setStoreInfo(info);
    } catch (err) {
      setStoreInfo({ error: err.message });
    }
  }

  const handleSavePin = () => {
    savePin(pinInput.trim());
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 2000);
    checkHealth();
  };

  const handleForceSync = async () => {
    // Subir todo el localStorage a Redis
    const keys = [
      'delmy_remitos','delmy_acumulado','delmy_rec_v3',
      'delmy_compras_v2','delmy_stock_db','delmy_stock_meta',
    ];
    for (const key of keys) {
      const v = localStorage.getItem(key);
      if (v) {
        try { await api.set(key, JSON.parse(v)); } catch {}
      }
    }
    alert('Datos locales sincronizados al servidor ✓');
  };

  const dot = {
    connecting: { color: 'var(--ambar)',  label: 'Conectando...' },
    ok:         { color: 'var(--verde)',  label: 'Redis OK'       },
    error:      { color: 'var(--naranja)',label: 'Redis sin datos' },
    offline:    { color: 'var(--rojo)',   label: 'Sin servidor'   },
  }[status];

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setShowPin(p => !p); if (!showPin) loadStoreInfo(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none',
          color: dot.color, cursor: 'pointer', fontSize: 11,
          padding: '4px 8px',
        }}
        title={dot.label}
      >
        <span style={{
          display: 'inline-block', width: 7, height: 7,
          borderRadius: '50%', background: dot.color,
          boxShadow: status === 'ok' ? `0 0 6px ${dot.color}` : 'none',
        }} />
        <span>{dot.label}</span>
      </button>

      {showPin && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 200,
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 16, width: 280,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, letterSpacing: '0.07em' }}>
            SINCRONIZACIÓN · REDIS
          </div>

          {/* PIN */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
              PIN DE ACCESO
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="password"
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                placeholder="PIN configurado en Railway"
                style={{ flex: 1, padding: '5px 8px', fontSize: 12 }}
              />
              <button onClick={handleSavePin} style={{
                background: pinSaved ? 'rgba(74,222,128,0.15)' : 'rgba(240,192,64,0.15)',
                color: pinSaved ? 'var(--verde)' : 'var(--accent)',
                border: '1px solid currentColor', borderRadius: 'var(--radius)',
                padding: '5px 10px', fontSize: 11,
              }}>{pinSaved ? '✓' : 'OK'}</button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              Si no configuraste PIN en Railway, dejalo vacío.
            </div>
          </div>

          {/* Info del store */}
          {storeInfo && !storeInfo.error && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6, letterSpacing: '0.07em' }}>
                DATOS EN REDIS ({storeInfo.total} claves)
              </div>
              {storeInfo.keys?.map(k => (
                <div key={k.key} style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ color: 'var(--text-2)' }}>{k.key}</span>
                  <span style={{ color: 'var(--text-3)' }}>{k.kb} KB</span>
                </div>
              ))}
            </div>
          )}

          {/* Acciones */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={handleForceSync} style={{
              background: 'rgba(96,165,250,0.1)', color: 'var(--azul)',
              border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--radius)',
              padding: '7px', fontSize: 11, width: '100%',
            }}>
              ↑ Subir datos locales a Redis
            </button>
            <button onClick={() => { setShowPin(false); }} style={{
              background: 'transparent', color: 'var(--text-3)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '6px', fontSize: 11,
            }}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
