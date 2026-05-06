import React, { useState, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { extractFromDocumentSmart, PROVEEDORES } from '../../utils/claudeVision';
import { storage, KEYS, saveRecepcion, getApiKey } from '../../utils/storage';
import PrintRecepcion from './PrintRecepcion';

const FORMATOS_ACEPTADOS = '.jpg,.jpeg,.png,.webp,.gif,.pdf';

export default function ModuloA() {
  const [step, setStep] = useState('upload'); // upload | extracting | review | done
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [error, setError] = useState('');
  const [recepcion, setRecepcion] = useState(null);
  const [historial, setHistorial] = useState(() => storage.get(KEYS.RECEPCIONES, []));
  const fileRef = useRef();

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setError('');
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleExtract = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setError('Configurá la API Key de Anthropic primero (botón ⚙ API arriba).'); return; }
    if (!file) { setError('Seleccioná un archivo.'); return; }

    setStep('extracting');
    setError('');
    try {
      const data = await extractFromDocumentSmart(file, apiKey);
      setExtracted({
        proveedor: data.proveedor || '',
        documento: data.documento || '',
        fechaDoc:  data.fechaDoc  || '',
        lineas:    data.lineas    || [],
        confianza: data.confianza || 'media',
      });
      setStep('review');
    } catch (err) {
      setError(`Error al procesar: ${err.message}`);
      setStep('upload');
    }
  };

  const handleLineChange = (idx, field, value) => {
    setExtracted(prev => ({
      ...prev,
      lineas: prev.lineas.map((l, i) => i === idx ? { ...l, [field]: field === 'cant' ? Number(value) : value } : l),
    }));
  };

  const handleAddLinea = () => {
    setExtracted(prev => ({ ...prev, lineas: [...prev.lineas, { cod: '', desc: '', cant: 0 }] }));
  };

  const handleRemoveLinea = (idx) => {
    setExtracted(prev => ({ ...prev, lineas: prev.lineas.filter((_, i) => i !== idx) }));
  };

  const handleConfirm = () => {
    const rec = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      proveedor:  extracted.proveedor,
      documento:  extracted.documento,
      fechaDoc:   extracted.fechaDoc,
      lineas:     extracted.lineas,
      viaIA:      true,
      confianza:  extracted.confianza,
    };
    saveRecepcion(rec);
    setRecepcion(rec);
    setHistorial(storage.get(KEYS.RECEPCIONES, []));
    setStep('done');
  };

  const handleReset = () => {
    setStep('upload'); setFile(null); setPreview(null);
    setExtracted(null); setRecepcion(null); setError('');
  };

  return (
    <div style={{ padding: '20px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-syne)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          Módulo A — Recepción de Mercadería
        </div>
        <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>
          Registro de ingreso de mercadería de proveedores externos al depósito
        </div>
      </div>

      {/* Steps indicator */}
      <StepsBar step={step} />

      {error && (
        <div style={{
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
          color: 'var(--rojo)', borderRadius: 'var(--radius)', padding: '10px 14px',
          fontSize: 12.5, marginBottom: 16,
        }}>{error}</div>
      )}

      {/* STEP: Upload */}
      {step === 'upload' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current.click()}
            style={{
              border: '2px dashed var(--border-2)',
              borderRadius: 'var(--radius-lg)',
              minHeight: 300,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 12, cursor: 'pointer',
              transition: 'border-color var(--transition), background var(--transition)',
              background: file ? 'rgba(240,192,64,0.04)' : 'transparent',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={FORMATOS_ACEPTADOS}
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />
            {preview ? (
              <img src={preview} alt="preview" style={{ maxWidth: '80%', maxHeight: 200, borderRadius: 4 }} />
            ) : (
              <div style={{ fontSize: 40, opacity: 0.3 }}>📄</div>
            )}
            <div style={{ color: 'var(--text-2)', fontSize: 13, textAlign: 'center' }}>
              {file ? (
                <><strong style={{ color: 'var(--accent)' }}>{file.name}</strong><br /><span style={{ fontSize: 11, color: 'var(--text-3)' }}>{(file.size/1024).toFixed(1)} KB</span></>
              ) : (
                <>Arrastrá la factura/remito acá<br /><span style={{ fontSize: 11, color: 'var(--text-3)' }}>JPG · PNG · WEBP · GIF · PDF</span></>
              )}
            </div>
          </div>

          {/* Actions panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.06em' }}>
                ACCIÓN
              </div>
              <button
                onClick={handleExtract}
                disabled={!file}
                style={{
                  width: '100%',
                  background: file ? 'var(--accent)' : 'var(--border)',
                  color: file ? '#0c0e14' : 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  fontSize: 13,
                  padding: '10px',
                  borderRadius: 'var(--radius)',
                  cursor: file ? 'pointer' : 'not-allowed',
                }}
              >
                ✦ Extraer con IA
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
                La IA detectará automáticamente proveedor, número de documento, fecha y artículos.
              </div>
            </div>

            {/* Historial reciente */}
            <div className="card" style={{ padding: 16, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.06em' }}>
                RECEPCIONES RECIENTES
              </div>
              {historial.slice(0, 5).map(r => (
                <div key={r.id} style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11.5,
                }}>
                  <div style={{ color: 'var(--text)', fontWeight: 500 }}>{r.proveedor || '—'}</div>
                  <div style={{ color: 'var(--text-3)' }}>{r.documento} · {r.fechaDoc}</div>
                </div>
              ))}
              {historial.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Sin registros</div>}
            </div>
          </div>
        </div>
      )}

      {/* STEP: Extracting */}
      {step === 'extracting' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div className="pulse" style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <div style={{ fontFamily: 'var(--font-syne)', fontSize: 18, color: 'var(--accent)' }}>
            Analizando documento...
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: 12.5, marginTop: 8 }}>
            Claude Vision está extrayendo los datos del documento
          </div>
        </div>
      )}

      {/* STEP: Review */}
      {step === 'review' && extracted && (
        <ReviewStep
          extracted={extracted}
          setExtracted={setExtracted}
          onLineChange={handleLineChange}
          onAddLinea={handleAddLinea}
          onRemoveLinea={handleRemoveLinea}
          onConfirm={handleConfirm}
          onBack={handleReset}
        />
      )}

      {/* STEP: Done */}
      {step === 'done' && recepcion && (
        <div>
          <div style={{
            background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
            borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ color: 'var(--verde)', fontWeight: 600, fontSize: 14 }}>
                ✓ Recepción registrada
              </div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>
                {recepcion.proveedor} · {recepcion.documento}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.print()} style={{
                background: 'var(--accent)', color: '#0c0e14',
                fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 14px',
                borderRadius: 'var(--radius)', fontWeight: 500,
              }}>
                🖨 Imprimir
              </button>
              <button onClick={handleReset} style={{
                background: 'var(--border)', color: 'var(--text)',
                fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 14px',
                borderRadius: 'var(--radius)',
              }}>
                Nueva recepción
              </button>
            </div>
          </div>
          <PrintRecepcion recepcion={recepcion} />
        </div>
      )}
    </div>
  );
}

function StepsBar({ step }) {
  const steps = [
    { id: 'upload',     label: '1. Subir documento' },
    { id: 'extracting', label: '2. Extracción IA' },
    { id: 'review',     label: '3. Revisar y confirmar' },
    { id: 'done',       label: '4. Impresión' },
  ];
  const idx = steps.findIndex(s => s.id === step);
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{
          flex: 1, padding: '8px 12px', fontSize: 11.5,
          background: i === idx ? 'rgba(240,192,64,0.12)' : i < idx ? 'rgba(74,222,128,0.06)' : 'transparent',
          color: i === idx ? 'var(--accent)' : i < idx ? 'var(--verde)' : 'var(--text-3)',
          borderRight: i < steps.length-1 ? '1px solid var(--border)' : 'none',
          textAlign: 'center',
        }}>{s.label}</div>
      ))}
    </div>
  );
}

function ReviewStep({ extracted, setExtracted, onLineChange, onAddLinea, onRemoveLinea, onConfirm, onBack }) {
  const confColor = { alta: 'var(--verde)', media: 'var(--ambar)', baja: 'var(--rojo)' }[extracted.confianza] || 'var(--text-2)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
      {/* Header datos */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-syne)', fontSize: 14, fontWeight: 700 }}>
            Datos del documento
          </div>
          <span style={{ fontSize: 11, color: confColor }}>
            Confianza IA: {extracted.confianza}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
              PROVEEDOR
            </label>
            <select
              value={extracted.proveedor}
              onChange={e => setExtracted(p => ({ ...p, proveedor: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
            >
              <option value="">— Seleccionar —</option>
              {PROVEEDORES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
              Nº DOCUMENTO
            </label>
            <input
              value={extracted.documento}
              onChange={e => setExtracted(p => ({ ...p, documento: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
              placeholder="0001-00012345"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
              FECHA
            </label>
            <input
              value={extracted.fechaDoc}
              onChange={e => setExtracted(p => ({ ...p, fechaDoc: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
              placeholder="DD/MM/YYYY"
            />
          </div>
        </div>
      </div>

      {/* Líneas */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-syne)', fontSize: 14, fontWeight: 700 }}>
            Líneas de detalle ({extracted.lineas.length})
          </div>
          <button onClick={onAddLinea} style={{
            background: 'rgba(240,192,64,0.1)', color: 'var(--accent)',
            border: '1px solid rgba(240,192,64,0.2)', borderRadius: 'var(--radius)',
            fontSize: 12, padding: '4px 10px',
          }}>+ Agregar línea</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th style={{ width: 120 }}>CÓDIGO</th>
                <th>DESCRIPCIÓN</th>
                <th style={{ width: 80 }}>CANT.</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {extracted.lineas.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                  <td>
                    <input value={l.cod} onChange={e => onLineChange(i, 'cod', e.target.value)}
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12 }} />
                  </td>
                  <td>
                    <input value={l.desc} onChange={e => onLineChange(i, 'desc', e.target.value)}
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12 }} />
                  </td>
                  <td>
                    <input type="number" value={l.cant} onChange={e => onLineChange(i, 'cant', e.target.value)}
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12 }} />
                  </td>
                  <td>
                    <button onClick={() => onRemoveLinea(i)} style={{
                      background: 'transparent', color: 'var(--rojo)', fontSize: 14, padding: '2px',
                    }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, textAlign: 'right', color: 'var(--text-2)', fontSize: 12 }}>
          Total documentado: <strong style={{ color: 'var(--accent)' }}>
            {extracted.lineas.reduce((s, l) => s + Number(l.cant || 0), 0)} uds.
          </strong>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onBack} style={{
          background: 'transparent', color: 'var(--text-2)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          padding: '8px 18px', fontSize: 12.5,
        }}>← Volver</button>
        <button onClick={onConfirm} style={{
          background: 'var(--accent)', color: '#0c0e14',
          borderRadius: 'var(--radius)', padding: '8px 22px',
          fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)',
        }}>✓ Confirmar recepción</button>
      </div>
    </div>
  );
}
