import React, { useState, useCallback } from 'react';
import { storage, KEYS, mergeRemitos } from '../../utils/storage';
import { parseExcelRemitos } from '../../utils/excelParser';
import Dashboard from './Dashboard';
import TabPedidos from './TabPedidos';
import TabPendientes from './TabPendientes';
import TabAnomalias from './TabAnomalias';

const TABS = [
  { id: 'dashboard',  label: '◈ Dashboard' },
  { id: 'pedidos',    label: '▤ Pedidos' },
  { id: 'pendientes', label: '⧖ Pendientes' },
  { id: 'anomalias',  label: '⚠ Anomalías' },
];

export default function ModuloB() {
  const [tab, setTab]         = useState('dashboard');
  const [remitos, setRemitos] = useState(() => storage.get(KEYS.REMITOS, {}));
  const [loading, setLoading] = useState(false);
  const [lastLoad, setLastLoad] = useState(null);
  const [loadStats, setLoadStats] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const nuevos = await parseExcelRemitos(file);
      const existentes = storage.get(KEYS.REMITOS, {});
      const merged = mergeRemitos(existentes, nuevos);
      storage.set(KEYS.REMITOS, merged);
      const added   = Object.keys(nuevos).filter(k => !existentes[k]).length;
      const updated = Object.keys(nuevos).filter(k =>  existentes[k]).length;
      setLoadStats({ total: Object.keys(nuevos).length, added, updated, archivo: file.name });
      setRemitos(merged);
      setLastLoad(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      alert(`Error al procesar el archivo: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Sub-header with tabs + load */}
      <div style={{
        background: 'var(--panel)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-3)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              padding: '14px 16px',
              fontSize: 12,
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-mono)',
              transition: 'color var(--transition)',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastLoad && (
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Última carga: <span style={{ color: 'var(--verde)' }}>{lastLoad}</span>
              {loadStats && <span style={{ marginLeft: 8 }}>
                +{loadStats.added} nuevos · {loadStats.updated} act.
              </span>}
            </div>
          )}
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            style={{
              background: dragOver ? 'rgba(240,192,64,0.2)' : 'rgba(240,192,64,0.08)',
              color: 'var(--accent)',
              border: `1px solid ${dragOver ? 'var(--accent)' : 'rgba(240,192,64,0.2)'}`,
              borderRadius: 'var(--radius)',
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all var(--transition)',
            }}
          >
            {loading ? <span className="pulse">Procesando...</span> : '↑ Cargar planilla .xlsx'}
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
          </label>

          <button onClick={() => {
            if (window.confirm('¿Borrar todos los remitos del almacenamiento local?')) {
              storage.remove(KEYS.REMITOS);
              storage.remove(KEYS.ACUMULADO);
              setRemitos({});
              setLoadStats(null);
              setLastLoad(null);
            }
          }} style={{
            background: 'transparent', color: 'var(--text-3)', fontSize: 11,
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px',
          }}>⌦ Limpiar</button>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {Object.keys(remitos).length === 0 ? (
          <EmptyState onLoad={handleFile} />
        ) : (
          <>
            {tab === 'dashboard'  && <Dashboard  remitos={remitos} />}
            {tab === 'pedidos'    && <TabPedidos  remitos={remitos} />}
            {tab === 'pendientes' && <TabPendientes remitos={remitos} />}
            {tab === 'anomalias'  && <TabAnomalias  remitos={remitos} />}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onLoad }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>📊</div>
      <div style={{ fontFamily: 'var(--font-syne)', fontSize: 20, color: 'var(--text-2)', marginBottom: 8 }}>
        Sin datos cargados
      </div>
      <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 24 }}>
        Cargá el archivo Excel de remitos para comenzar
      </div>
      <label style={{
        background: 'var(--accent)', color: '#0c0e14',
        fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13,
        padding: '10px 24px', borderRadius: 'var(--radius)', cursor: 'pointer',
      }}>
        ↑ Cargar DELMYPARTYSRL_ListadoDetallado...xlsx
        <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={e => onLoad(e.target.files[0])} />
      </label>
      <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 11 }}>
        Podés cargar múltiples veces — los datos se mergean automáticamente
      </div>
    </div>
  );
}
