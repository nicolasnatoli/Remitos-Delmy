import React, { useState } from 'react';
import { getApiKey, setApiKey } from '../../utils/storage';

export default function Layout({ children, activeModule, setActiveModule }) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
  const [saved, setSaved] = useState(false);

  const handleSaveKey = () => {
    setApiKey(apiKeyInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        background: 'var(--panel)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-syne)',
              fontWeight: 800,
              fontSize: 15,
              color: 'var(--accent)',
              letterSpacing: '0.02em',
            }}>DELMY PARTY</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
              SISTEMA OPERATIVO · INDUSTRIAL PARTNER
            </div>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'A', label: 'Recepción' },
            { id: 'B', label: 'Movimientos' },
          ].map(m => (
            <button key={m.id} onClick={() => setActiveModule(m.id)} style={{
              background: activeModule === m.id ? 'rgba(240,192,64,0.12)' : 'transparent',
              color: activeModule === m.id ? 'var(--accent)' : 'var(--text-2)',
              border: activeModule === m.id ? '1px solid rgba(240,192,64,0.3)' : '1px solid transparent',
              borderRadius: 'var(--radius)',
              padding: '5px 14px',
              fontSize: 12.5,
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ opacity: 0.5, marginRight: 4 }}>MOD {m.id}</span>
              {m.label}
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowApiKey(!showApiKey)} title="Configurar API Key" style={{
            background: getApiKey() ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
            color: getApiKey() ? 'var(--verde)' : 'var(--rojo)',
            border: `1px solid ${getApiKey() ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
            borderRadius: 'var(--radius)',
            padding: '4px 10px',
            fontSize: 11,
          }}>
            ⚙ API {getApiKey() ? '✓' : '✗'}
          </button>
        </div>
      </header>

      {/* API Key panel */}
      {showApiKey && (
        <div style={{
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 20px',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            Anthropic API Key:
          </span>
          <input
            type="password"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder="sk-ant-..."
            style={{ flex: 1, padding: '5px 10px', fontSize: 12 }}
          />
          <button onClick={handleSaveKey} style={{
            background: saved ? 'rgba(74,222,128,0.15)' : 'rgba(240,192,64,0.15)',
            color: saved ? 'var(--verde)' : 'var(--accent)',
            border: '1px solid currentColor',
            borderRadius: 'var(--radius)',
            padding: '5px 14px',
            fontSize: 12,
          }}>
            {saved ? '✓ Guardado' : 'Guardar'}
          </button>
          <button onClick={() => setShowApiKey(false)} style={{
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 16,
            padding: '0 4px',
          }}>×</button>
        </div>
      )}

      {/* Main */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
