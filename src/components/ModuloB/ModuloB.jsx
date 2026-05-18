import React, { useState, useCallback, useEffect, useRef } from 'react';
import { storage, KEYS, mergeRemitos } from '../../utils/storage';
import { parseExcelRemitos } from '../../utils/excelParser';
import { loadCombos, saveCombos } from '../../utils/db';
import Dashboard from './Dashboard';
import TabPedidos from './TabPedidos';
import TabPendientes from './TabPendientes';
import TabAnomalias from './TabAnomalias';
import TabCombos from './TabCombos';

const TABS = [
  { id: 'dashboard',  label: '◈ Dashboard' },
  { id: 'pedidos',    label: '▤ Pedidos' },
  { id: 'pendientes', label: '⧖ Pendientes' },
  { id: 'anomalias',  label: '⚠ Anomalías' },
  { id: 'combos',     label: '⊕ Combos' },
];

export default function ModuloB() {
  const [tab, setTab]         = useState('dashboard');
  const [remitos, setRemitos] = useState(() => storage.get(KEYS.REMITOS, {}));
  const [loading, setLoading] = useState(false);
  const [lastLoad, setLastLoad] = useState(null);
  const [loadStats, setLoadStats] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [combos, setCombos] = useState({});
  const [combosLoaded, setCombosLoaded] = useState(false);
  const [combosStats, setCombosStats] = useState(null);
  const combosFileRef = useRef();

  useEffect(() => {
    loadCombos().then(c => {
      if (c && Object.keys(c).length > 0) {
        setCombos(c);
        setCombosLoaded(true);
        setCombosStats({ total: Object.keys(c).length, multiComp: Object.values(c).filter(x=>x.componentes?.length>1).length });
      }
    });
  }, []);

  const handleCombosFile = useCallback(async (file) => {
    if (!file) return;
    try {
      let data = {};
      if (file.name.endsWith('.json')) {
        // JSON directo
        const text = await file.text();
        data = JSON.parse(text);
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        // Excel exportado de Stock+ — mismo formato que Compras
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        const hdrIdx = rows.findIndex(r => String(r[0]).trim()==='Tipo' || String(r[1]).trim().includes('Código combo'));
        const dataRows = hdrIdx >= 0 ? rows.slice(hdrIdx+1) : rows.slice(2);
        let current = null;
        for (const r of dataRows) {
          const tipo = String(r[0]||'').trim();
          const codCombo = String(r[1]||'').trim();
          const descCombo = String(r[2]||'').trim();
          const codArt = String(r[5]||'').trim();
          const descArt = String(r[6]||'').trim();
          const cant = parseFloat(String(r[7]||'0').replace(',','.'))||0;
          if(tipo==='Combo' && codCombo && codCombo!=='-') {
            current = codCombo;
            data[codCombo] = { desc: descCombo, componentes: [] };
          } else if((tipo==='Artículo'||tipo==='Articulo') && current && codArt && codArt!=='-') {
            data[current].componentes.push({ cod:codArt, desc:descArt, cant:Math.round(cant)||1 });
          }
        }
      } else {
        alert('Subí el archivo .xlsx de combos exportado de Stock+, o el combos_delmy.json');
        return;
      }
      const total = Object.keys(data).length;
      if (total === 0) { alert('No se encontraron combos en el archivo.'); return; }
      await saveCombos(data);
      setCombos(data);
      setCombosLoaded(true);
      setCombosStats({ total, multiComp: Object.values(data).filter(c=>c.componentes?.length>1).length, archivo: file.name });
      alert(`✓ ${total} combos importados correctamente.`);
    } catch(e) { alert('Error al procesar el archivo: ' + e.message); }
  }, []);

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
            {tab === 'pedidos'    && <TabPedidos  remitos={remitos} combos={combos} />}
            {tab === 'pendientes' && <TabPendientes remitos={remitos} combos={combos} />}
            {tab === 'anomalias'  && <TabAnomalias  remitos={remitos} />}
            {tab === 'combos'     && <TabCombos combos={combos} onLoad={handleCombosFile} loaded={combosLoaded} stats={combosStats} fileRef={combosFileRef} />}
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
