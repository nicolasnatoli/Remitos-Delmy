import React from 'react';

export default function PrintRecepcion({ recepcion }) {
  if (!recepcion) return null;

  const now = new Date();
  const timestamp = `${now.toLocaleDateString('es-AR')} ${now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  const total = recepcion.lineas.reduce((s, l) => s + Number(l.cant || 0), 0);

  return (
    <div style={{
      background: 'white',
      color: '#111',
      fontFamily: 'Arial, sans-serif',
      fontSize: 11,
      maxWidth: 800,
      margin: '0 auto',
      border: '1px solid #ccc',
      borderRadius: 4,
    }}>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area {
            position: fixed; top: 0; left: 0;
            width: 100%; padding: 20mm;
          }
        }
      `}</style>

      <div className="print-area" style={{ padding: 32 }}>
        {/* Header */}
        <div style={{ borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.05em' }}>
                DELMY PARTY SRL
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                REGISTRO DE RECEPCIÓN DE MERCADERÍA
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 10, color: '#666' }}>
              <div style={{ fontWeight: 700, fontSize: 11 }}>IT-REC-001 | Rev. 1</div>
              <div>Sistema: Industrial Partner</div>
            </div>
          </div>
        </div>

        {/* Datos del documento */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: 12, marginBottom: 20,
          background: '#f8f8f8', padding: 12, borderRadius: 4,
        }}>
          <div>
            <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.08em', marginBottom: 2 }}>PROVEEDOR</div>
            <div style={{ fontWeight: 700 }}>{recepcion.proveedor || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.08em', marginBottom: 2 }}>Nº DOCUMENTO</div>
            <div style={{ fontWeight: 700 }}>{recepcion.documento || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.08em', marginBottom: 2 }}>FECHA DOCUMENTO</div>
            <div>{recepcion.fechaDoc || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.08em', marginBottom: 2 }}>FECHA GENERACIÓN</div>
            <div>{timestamp}</div>
          </div>
        </div>

        {/* Tabla */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr style={{ background: '#111', color: 'white' }}>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: 30, fontSize: 9, letterSpacing: '0.06em' }}>#</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', width: 100, fontSize: 9, letterSpacing: '0.06em' }}>CÓDIGO</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 9, letterSpacing: '0.06em' }}>DESCRIPCIÓN</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: 70, fontSize: 9, letterSpacing: '0.06em' }}>CANT. DOC.</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: 80, fontSize: 9, letterSpacing: '0.06em' }}>CANT. RECIBIDA</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: 130, fontSize: 9, letterSpacing: '0.06em' }}>UBICACIÓN</th>
            </tr>
          </thead>
          <tbody>
            {recepcion.lineas.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#888' }}>{i + 1}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'Courier New, monospace' }}>{l.cod}</td>
                <td style={{ padding: '6px 8px' }}>{l.desc}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{l.cant}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{
                    border: '1px solid #999', height: 20, borderRadius: 2,
                  }} />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, color: '#555', fontFamily: 'Courier New, monospace' }}>
                  ___ - ___ - ___ - ___
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total */}
        <div style={{ textAlign: 'right', marginBottom: 24, fontSize: 12 }}>
          <strong>Total documentado: {total} unidades</strong>
        </div>

        {/* Nota ubicación */}
        <div style={{
          background: '#f8f8f8', padding: 8, borderRadius: 4, marginBottom: 24,
          fontSize: 9, color: '#666'
        }}>
          <strong>Formato de ubicación:</strong> PL01 - F/T - A/B/C - 1-9 &nbsp;
          (Pallet · Frente/Trasero · Columna · Altura)
        </div>

        {/* Firmas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 30, marginTop: 16 }}>
          {['Recibido por', 'Verificado por', 'Autorizado por'].map(label => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginTop: 40, fontSize: 10 }}>
                {label}
              </div>
              <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                Nombre y firma
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
