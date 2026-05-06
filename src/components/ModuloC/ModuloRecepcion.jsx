import React, { useState } from 'react';
// xlsx imported via dynamic use


const ESTADO_OC = {
  borrador:    { label: 'Borrador',    badge: 'badge-gray'  },
  confirmada:  { label: 'Confirmada',  badge: 'badge-azul'  },
  en_transito: { label: 'En tránsito', badge: 'badge-ambar' },
  recibida:    { label: 'Recibida',    badge: 'badge-verde' },
  cancelada:   { label: 'Cancelada',   badge: 'badge-rojo'  },
};

export default function ModuloRecepcion({ compras, update }) {
  const [sel, setSel] = useState(null);

  const pendientes = compras.filter(c => ['confirmada','en_transito'].includes(c.estado));
  const recibidas  = compras.filter(c => c.estado === 'recibida');

  if (sel) {
    return (
      <RecepcionDetalle
        oc={sel}
        onBack={() => setSel(null)}
        onConfirm={(datos) => {
          update(sel.id, {
            estado: 'recibida',
            recepcion: datos,
            fechaRecepcion: new Date().toISOString(),
          });
          setSel(null);
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <div style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', alignItems: 'center', height: 44 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
          RECEPCIÓN · {pendientes.length} pendientes de recibir
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {pendientes.length === 0 && recibidas.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>Sin OC pendientes de recepción</div>
            <div style={{ fontSize: 12 }}>Confirmá una OC en el módulo de Compras y cambiá su estado a "En tránsito"</div>
          </div>
        )}

        {pendientes.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}>PENDIENTES DE RECIBIR</div>
            <div className="card" style={{ marginBottom: 20 }}>
              {pendientes.map((oc, i) => {
                const est = ESTADO_OC[oc.estado] || ESTADO_OC.confirmada;
                return (
                  <div key={oc.id} onClick={() => setSel(oc)} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer',
                    borderBottom: i < pendientes.length-1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{oc.proveedor}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                        {oc.noc} · {oc.fecha} · {oc.lineas?.length || 0} artículos ·{' '}
                        {oc.lineas?.reduce((s,l)=>s+(l.cant||0),0) || 0} uds
                      </div>
                    </div>
                    <span className={`badge ${est.badge}`}>{est.label}</span>
                    <span style={{ fontSize: 20, color: 'var(--accent)' }}>→</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {recibidas.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}>RECIBIDAS RECIENTES</div>
            <div className="card">
              {recibidas.slice(0,10).map((oc,i) => (
                <div key={oc.id} style={{
                  display:'flex', alignItems:'center', gap:14, padding:'10px 16px',
                  borderBottom: i < Math.min(recibidas.length,10)-1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:'var(--text)' }}>{oc.proveedor}</div>
                    <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>
                      {oc.noc} · {oc.fechaRecepcion ? new Date(oc.fechaRecepcion).toLocaleDateString('es-AR') : oc.fecha}
                    </div>
                  </div>
                  <span className="badge badge-verde">Recibida</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Recepción detalle — 4 etapas ────────────────────────────────────────────
function RecepcionDetalle({ oc, onBack, onConfirm }) {
  const [etapa, setEtapa] = useState(1); // 1=Entrega 2=Bultos 3=Artículos 4=Cierre
  const [datos, setDatos] = useState({
    transportista: '', patente: '', nDocumento: oc.noc || '',
    bultosDec: oc.lineas?.length || 0, bultosRecibidos: 0, bultosObs: '',
    lineas: (oc.lineas || []).map(l => ({ ...l, cantRecibida: l.cant, diferencia: 0, obs: '' })),
    obsFinales: '', timestampLlegada: '', timestampCierre: '',
  });

  const updateLinea = (cod, field, val) => {
    setDatos(prev => ({
      ...prev,
      lineas: prev.lineas.map(l => {
        if (l.cod !== cod) return l;
        const updated = { ...l, [field]: field === 'cantRecibida' ? Number(val)||0 : val };
        if (field === 'cantRecibida') {
          updated.diferencia = updated.cantRecibida - (l.cant||0);
        }
        return updated;
      }),
    }));
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    const totalPedido   = datos.lineas.reduce((s,l) => s+(l.cant||0),0);
    const totalRecibido = datos.lineas.reduce((s,l) => s+(l.cantRecibida||0),0);
    w.document.write(`
      <html><head><title>Recepción ${oc.proveedor}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
        h1{font-size:16px;font-weight:900}h2{font-size:13px;margin-top:10px}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th{background:#111;color:white;padding:6px 8px;text-align:left;font-size:10px}
        td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:10px}
        .firma{margin-top:40px;display:flex;gap:60px}
        .firma-item{text-align:center;border-top:1px solid #333;padding-top:6px;width:150px;font-size:10px}
        .red{color:#c00}.green{color:#060}
      </style></head><body>
      <h1>DELMY PARTY SRL — REGISTRO DE RECEPCIÓN</h1>
      <p><strong>Proveedor:</strong> ${oc.proveedor} &nbsp;|&nbsp;
         <strong>Nº Doc:</strong> ${datos.nDocumento} &nbsp;|&nbsp;
         <strong>Fecha:</strong> ${new Date().toLocaleDateString('es-AR')} &nbsp;|&nbsp;
         <strong>Transportista:</strong> ${datos.transportista || '—'} ${datos.patente ? '('+datos.patente+')' : ''}
      </p>
      <p><strong>Bultos declarados:</strong> ${datos.bultosDec} &nbsp;|&nbsp;
         <strong>Bultos recibidos:</strong> ${datos.bultosRecibidos}
         ${datos.bultosDec !== datos.bultosRecibidos ? ' ⚠ DIFERENCIA' : ' ✓ OK'}
      </p>
      <table>
        <tr><th>#</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>CANT. OC</th><th>CANT. RECIBIDA</th><th>DIFERENCIA</th><th>OBS.</th></tr>
        ${datos.lineas.map((l,i) => `
          <tr>
            <td>${i+1}</td><td>${l.cod}</td><td>${l.desc}</td>
            <td style="text-align:right">${l.cant}</td>
            <td style="text-align:right">${l.cantRecibida}</td>
            <td style="text-align:right;${l.diferencia<0?'color:#c00':l.diferencia>0?'color:#060':''}">
              ${l.diferencia>0?'+':''}${l.diferencia}</td>
            <td>${l.obs||''}</td>
          </tr>
        `).join('')}
        <tr style="font-weight:bold">
          <td colspan="3">TOTAL</td>
          <td style="text-align:right">${totalPedido}</td>
          <td style="text-align:right">${totalRecibido}</td>
          <td style="text-align:right">${totalRecibido-totalPedido>0?'+'+(totalRecibido-totalPedido):totalRecibido-totalPedido}</td>
          <td></td>
        </tr>
      </table>
      ${datos.obsFinales ? `<p><strong>Observaciones:</strong> ${datos.obsFinales}</p>` : ''}
      <div class="firma">
        <div class="firma-item">Recibido por<br><br>Nombre y firma</div>
        <div class="firma-item">Verificado por<br><br>Nombre y firma</div>
        <div class="firma-item">Autorizado por<br><br>Nombre y firma</div>
      </div>
      </body></html>
    `);
    w.document.close();
    w.print();
  };

  const ETAPAS = [
    { n:1, label:'Entrega' },
    { n:2, label:'Bultos'  },
    { n:3, label:'Artículos' },
    { n:4, label:'Cierre'  },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 56px)' }}>
      {/* Header */}
      <div style={{ background:'var(--panel)', borderBottom:'1px solid var(--border)', padding:'0 20px', display:'flex', alignItems:'center', gap:16, height:48 }}>
        <button onClick={onBack} style={{ background:'transparent', color:'var(--text-3)', border:'none', fontSize:18, padding:'0 4px' }}>←</button>
        <div style={{ fontFamily:'var(--font-syne)', fontWeight:700, fontSize:15, color:'var(--accent)' }}>{oc.proveedor}</div>
        <div style={{ fontSize:11, color:'var(--text-3)' }}>{oc.noc} · {oc.fecha}</div>
        <div style={{ marginLeft:'auto', display:'flex', gap:0 }}>
          {ETAPAS.map(e => (
            <button key={e.n} onClick={() => setEtapa(e.n)} style={{
              background: etapa===e.n ? 'rgba(240,192,64,0.12)' : 'transparent',
              color: etapa===e.n ? 'var(--accent)' : etapa>e.n ? 'var(--verde)' : 'var(--text-3)',
              borderBottom: etapa===e.n ? '2px solid var(--accent)' : '2px solid transparent',
              borderTop:'none', borderLeft:'none', borderRight:'none',
              padding:'0 16px', height:48, fontSize:11.5, fontFamily:'var(--font-mono)',
            }}>
              {etapa>e.n ? '✓ ' : `${e.n}. `}{e.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:20 }}>
        {/* ETAPA 1 — Entrega */}
        {etapa === 1 && (
          <div style={{ maxWidth:600 }}>
            <div className="card" style={{ padding:20 }}>
              <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700, marginBottom:16 }}>
                E1 — Llegada del transportista
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>TRANSPORTISTA</label>
                  <input value={datos.transportista} onChange={e=>setDatos(p=>({...p,transportista:e.target.value}))}
                    style={{ width:'100%' }} placeholder="Nombre o empresa" />
                </div>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>PATENTE</label>
                  <input value={datos.patente} onChange={e=>setDatos(p=>({...p,patente:e.target.value}))}
                    style={{ width:'100%' }} placeholder="AB 123 CD" />
                </div>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>Nº DOCUMENTO PROVEEDOR</label>
                  <input value={datos.nDocumento} onChange={e=>setDatos(p=>({...p,nDocumento:e.target.value}))}
                    style={{ width:'100%' }} placeholder="0001-00012345" />
                </div>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>HORA DE LLEGADA</label>
                  <input value={datos.timestampLlegada} onChange={e=>setDatos(p=>({...p,timestampLlegada:e.target.value}))}
                    style={{ width:'100%' }} placeholder={new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} />
                </div>
              </div>
              <div style={{ marginTop:16, textAlign:'right' }}>
                <button onClick={() => { setDatos(p=>({...p,timestampLlegada:new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})})); setEtapa(2); }} style={{
                  background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)', fontWeight:600,
                  fontSize:13, padding:'9px 22px', borderRadius:'var(--radius)',
                }}>Registrar llegada →</button>
              </div>
            </div>
          </div>
        )}

        {/* ETAPA 2 — Bultos */}
        {etapa === 2 && (
          <div style={{ maxWidth:600 }}>
            <div className="card" style={{ padding:20 }}>
              <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700, marginBottom:16 }}>
                E2 — Control de bultos
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>BULTOS SEGÚN REMITO</label>
                  <input type="number" value={datos.bultosDec} onChange={e=>setDatos(p=>({...p,bultosDec:Number(e.target.value)}))}
                    style={{ width:'100%', fontSize:18, padding:'8px 10px' }} />
                </div>
                <div>
                  <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>BULTOS FÍSICOS CONTADOS</label>
                  <input type="number" value={datos.bultosRecibidos} onChange={e=>setDatos(p=>({...p,bultosRecibidos:Number(e.target.value)}))}
                    style={{ width:'100%', fontSize:18, padding:'8px 10px',
                      borderColor: datos.bultosRecibidos>0 && datos.bultosRecibidos !== datos.bultosDec ? 'var(--rojo)' : undefined,
                    }} />
                </div>
              </div>
              {datos.bultosRecibidos > 0 && datos.bultosRecibidos !== datos.bultosDec && (
                <div style={{ marginTop:12, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.3)', borderRadius:'var(--radius)', padding:'10px 14px', color:'var(--rojo)', fontSize:13 }}>
                  ⚠ Diferencia de {Math.abs(datos.bultosRecibidos - datos.bultosDec)} bultos —{' '}
                  {datos.bultosRecibidos < datos.bultosDec ? 'FALTANTE' : 'SOBRANTE'}
                </div>
              )}
              {datos.bultosRecibidos > 0 && datos.bultosRecibidos === datos.bultosDec && (
                <div style={{ marginTop:12, background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:'var(--radius)', padding:'10px 14px', color:'var(--verde)', fontSize:13 }}>
                  ✓ Bultos conformes
                </div>
              )}
              <div style={{ marginTop:12 }}>
                <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>OBSERVACIONES DE BULTOS</label>
                <textarea value={datos.bultosObs} onChange={e=>setDatos(p=>({...p,bultosObs:e.target.value}))}
                  rows={2} style={{ width:'100%', resize:'vertical', fontSize:12, padding:'6px 8px' }}
                  placeholder="Daños en embalaje, humedad, etc." />
              </div>
              <div style={{ marginTop:16, display:'flex', justifyContent:'space-between' }}>
                <button onClick={()=>setEtapa(1)} style={{ color:'var(--text-3)', background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 16px', fontSize:12 }}>← Volver</button>
                <button onClick={()=>setEtapa(3)} style={{ background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13, padding:'9px 22px', borderRadius:'var(--radius)' }}>
                  Controlar artículos →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ETAPA 3 — Artículos */}
        {etapa === 3 && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700 }}>E3 — Validación de artículos</div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>setDatos(p=>({...p,lineas:p.lineas.map(l=>({...l,cantRecibida:l.cant,diferencia:0}))}))} style={{
                  background:'rgba(74,222,128,0.1)', color:'var(--verde)', border:'1px solid rgba(74,222,128,0.2)',
                  borderRadius:'var(--radius)', fontSize:11, padding:'5px 12px',
                }}>✓ Todo conforme</button>
              </div>
            </div>

            <div className="card" style={{ overflowX:'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>CÓDIGO</th><th>DESCRIPCIÓN</th>
                    <th style={{textAlign:'right'}}>CANT. OC</th>
                    <th style={{textAlign:'right',minWidth:90}}>CANT. RECIBIDA</th>
                    <th style={{textAlign:'right'}}>DIFERENCIA</th>
                    <th>OBSERVACIÓN</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.lineas.map(l => (
                    <tr key={l.cod} style={{ background: l.diferencia < 0 ? 'rgba(248,113,113,0.04)' : l.diferencia > 0 ? 'rgba(74,222,128,0.04)' : 'transparent' }}>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-2)' }}>{l.cod}</td>
                      <td style={{ fontSize:11 }}>{l.desc}</td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{l.cant}</td>
                      <td style={{ padding:'4px 8px' }}>
                        <input
                          type="number" value={l.cantRecibida}
                          onChange={e=>updateLinea(l.cod,'cantRecibida',e.target.value)}
                          style={{ width:'100%', textAlign:'right', padding:'4px 6px', fontSize:12,
                            borderColor: l.diferencia!==0 ? (l.diferencia<0?'var(--rojo)':'var(--verde)') : undefined,
                          }}
                        />
                      </td>
                      <td style={{ textAlign:'right', fontWeight:600,
                        color: l.diferencia===0?'var(--verde)':l.diferencia<0?'var(--rojo)':'var(--azul)',
                      }}>
                        {l.diferencia>0?'+':''}{l.diferencia}
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input
                          value={l.obs} onChange={e=>updateLinea(l.cod,'obs',e.target.value)}
                          style={{ width:'100%', padding:'4px 6px', fontSize:11 }}
                          placeholder="—"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Resumen diferencias */}
            {datos.lineas.some(l=>l.diferencia!==0) && (
              <div style={{ marginTop:12, display:'flex', gap:10 }}>
                {datos.lineas.filter(l=>l.diferencia<0).length>0 && (
                  <div style={{ background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:'var(--radius)', padding:'8px 14px', fontSize:12, color:'var(--rojo)' }}>
                    ⚠ {datos.lineas.filter(l=>l.diferencia<0).length} artículos con FALTANTE ·{' '}
                    {Math.abs(datos.lineas.filter(l=>l.diferencia<0).reduce((s,l)=>s+l.diferencia,0))} uds
                  </div>
                )}
                {datos.lineas.filter(l=>l.diferencia>0).length>0 && (
                  <div style={{ background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:'var(--radius)', padding:'8px 14px', fontSize:12, color:'var(--azul)' }}>
                    ℹ {datos.lineas.filter(l=>l.diferencia>0).length} artículos con SOBRANTE ·{' '}
                    {datos.lineas.filter(l=>l.diferencia>0).reduce((s,l)=>s+l.diferencia,0)} uds
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop:16, display:'flex', justifyContent:'space-between' }}>
              <button onClick={()=>setEtapa(2)} style={{ color:'var(--text-3)', background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 16px', fontSize:12 }}>← Volver</button>
              <button onClick={()=>setEtapa(4)} style={{ background:'var(--accent)', color:'#0c0e14', fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13, padding:'9px 22px', borderRadius:'var(--radius)' }}>
                Ir al cierre →
              </button>
            </div>
          </div>
        )}

        {/* ETAPA 4 — Cierre */}
        {etapa === 4 && (
          <div style={{ maxWidth:700 }}>
            <div className="card" style={{ padding:20, marginBottom:16 }}>
              <div style={{ fontFamily:'var(--font-syne)', fontSize:16, fontWeight:700, marginBottom:16 }}>
                E4 — Cierre de recepción
              </div>

              {/* Resumen */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
                {[
                  { l:'ARTÍCULOS', v: datos.lineas.length },
                  { l:'UDS. PEDIDAS', v: datos.lineas.reduce((s,l)=>s+(l.cant||0),0) },
                  { l:'UDS. RECIBIDAS', v: datos.lineas.reduce((s,l)=>s+(l.cantRecibida||0),0) },
                ].map(k => (
                  <div key={k.l} style={{ background:'var(--panel-2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'10px 12px', textAlign:'center' }}>
                    <div style={{ fontSize:9, color:'var(--text-3)', letterSpacing:'0.07em', marginBottom:4 }}>{k.l}</div>
                    <div style={{ fontFamily:'var(--font-syne)', fontSize:22, fontWeight:700, color:'var(--accent)' }}>{k.v}</div>
                  </div>
                ))}
              </div>

              {datos.lineas.some(l=>l.diferencia!==0) && (
                <div style={{ background:'rgba(251,146,60,0.08)', border:'1px solid rgba(251,146,60,0.2)', borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:14, fontSize:12, color:'var(--naranja)' }}>
                  ⚠ Esta recepción tiene diferencias — {datos.lineas.filter(l=>l.diferencia!==0).length} artículos afectados.
                  Se registrarán como errores de remito.
                </div>
              )}

              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:10, color:'var(--text-3)', display:'block', marginBottom:3 }}>OBSERVACIONES FINALES</label>
                <textarea value={datos.obsFinales} onChange={e=>setDatos(p=>({...p,obsFinales:e.target.value}))}
                  rows={3} style={{ width:'100%', fontSize:12, padding:'6px 8px', resize:'vertical' }}
                  placeholder="Estado general de la mercadería, incidencias, etc." />
              </div>

              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={()=>setEtapa(3)} style={{ color:'var(--text-3)', background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 16px', fontSize:12 }}>← Revisar</button>
                <button onClick={handlePrint} style={{
                  background:'rgba(240,192,64,0.1)', color:'var(--accent)',
                  border:'1px solid rgba(240,192,64,0.2)', borderRadius:'var(--radius)', fontSize:12, padding:'9px 18px',
                }}>🖨 Imprimir registro</button>
                <button onClick={() => onConfirm(datos)} style={{
                  background:'var(--verde)', color:'#0c0e14', fontFamily:'var(--font-mono)',
                  fontWeight:700, fontSize:13, padding:'9px 24px', borderRadius:'var(--radius)',
                }}>✓ Confirmar recepción</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
