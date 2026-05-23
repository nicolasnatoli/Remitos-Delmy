// ===== DB — capa de datos unificada =====
// Redis para todo lo que supera localStorage
// Delmy Party SRL · Industrial Partner

export const SK = {
  art:    'dm_art_v3',
  stk:    'dm_stk_v3',
  vs:     'dm_vs_v3',
  vq:     'dm_vq_v3',
  vm:     'dm_vm_v3',
  vh:     'dm_vh_v3',
  plan:   'dm_plan_v3',
  share:  'dm_share_v3',
  meta:   'dm_meta_v3',
  pins:   'dm_pins_v3',
  ocs:    'dm_ocs_v3',
  rec:    'dm_rec_v3',
  nuevos: 'dm_nuevos_art',
  lista:  'dm_lista_compra',
  combos: 'dm_combos_v1',    // tabla de combos y componentes
  opEvents: 'dm_eventos_operacion_v1', // event log operacional central
  opAudit:  'dm_auditoria_operacion_v1', // métricas/auditoría agregada
};

// ─── Combos ───────────────────────────────────────────────────────────────────
export async function loadCombos() {
  try {
    const { value, exists } = await api.get(SK.combos);
    if (exists && value && Object.keys(value).length > 0) return value;
  } catch {}
  try {
    const local = localStorage.getItem(SK.combos);
    if (local) return JSON.parse(local);
  } catch {}
  return {};
}

export async function saveCombos(combos) {
  try { localStorage.setItem(SK.combos, JSON.stringify(combos)); } catch {}
  return api.set(SK.combos, combos);
}

// Expandir un remito: si una línea es un combo, devuelve sus componentes unitarios
// Si no es combo, devuelve la línea tal cual
// ─── Detectar factor de combo desde la descripción ──────────────────────────
// Regla: el código del combo es opaco (depende del proveedor).
// El factor real siempre está en la descripción.
// Ejemplos:
//   "20 Bolsas x 50u"   → 20 × 50 = 1000
//   "12 Packs x10u"     → 12 × 10 = 120
//   "X1000un"           → 1000
//   "x 24"              → 24
//   "Bolsita x10"       → 10
export function detectarFactorCombo(desc) {
  if (!desc) return null;
  const d = desc.toLowerCase();

  // Patrón 1: N bolsas/packs/cajas × Mu  (empaque doble)
  // Requiere palabra de tipo de bulto explícita — no se confunde con tamaños de envase
  const m1 = d.match(/(\d+)\s*(?:bolsas?|packs?|cajas?|bultos?|bols\.?)\s*[x×]\s*(\d+)/i);
  if (m1) {
    const ext = parseInt(m1[1]);
    const int_ = parseInt(m1[2]);
    return {
      factorExt: ext, factorInt: int_, factorTotal: ext * int_,
      tipo: 'doble', detalle: `${ext}×${int_}`,
      nivelesCombo: [
        { factorSiBaseEsBulto: ext, factorSiBaseEs1u: int_,        label: `×${int_}u (pack)`,     codSufijo: `x${int_}` },
        { factorSiBaseEsBulto: ext, factorSiBaseEs1u: ext * int_,  label: `×${ext*int_}u (caja)`, codSufijo: `x${ext*int_}` },
      ]
    };
  }

  // Patrón 2: "x N unidades" o "× N u" — pero NO si va seguido de cc/ml/gr/kg/cc (tamaño de envase)
  // Ej válido:   "CUCHILLO x 50u"  →  factor 50
  // Ej inválido: "200CC", "375cc", "50cc", "x 200cc", "x 1.5kg" → ignorar
  const m2 = d.match(/[x×]\s*(\d+)\s*(un?\.?|uds?\.?)\b/i);
  if (m2) {
    const f = parseInt(m2[1]);
    if (f > 1) return {
      factorExt: f, factorInt: 1, factorTotal: f,
      tipo: 'simple', detalle: 'x'+f,
      nivelesCombo: [{ factorSiBaseEsBulto: f, factorSiBaseEs1u: f, label: `×${f}u`, codSufijo: `x${f}` }]
    };
  }

  // Patrón 3: "por N unidades" o "de N unidades" — explícito
  const m3 = d.match(/(?:por|de)\s+(\d+)\s*(?:unidades?|un?\.?)\b/i);
  if (m3 && parseInt(m3[1]) > 1) {
    const f = parseInt(m3[1]);
    return {
      factorExt: f, factorInt: 1, factorTotal: f,
      tipo: 'simple', detalle: `×${f}`,
      nivelesCombo: [{ factorSiBaseEsBulto: f, factorSiBaseEs1u: f, label: `×${f}u`, codSufijo: `x${f}` }]
    };
  }

  // Patrón 4: "X N" al final de la descripción (ej: "CUCHILLO CRISTAL X 50")
  // Solo si N > 1 y no hay cc/ml/gr después
  const m4 = d.match(/\bx\s*(\d+)\s*$/i);
  if (m4 && parseInt(m4[1]) > 1) {
    const f = parseInt(m4[1]);
    return {
      factorExt: f, factorInt: 1, factorTotal: f,
      tipo: 'simple', detalle: `×${f}`,
      nivelesCombo: [{ factorSiBaseEsBulto: f, factorSiBaseEs1u: f, label: `×${f}u`, codSufijo: `x${f}` }]
    };
  }

  return null;
}

// ─── Expandir líneas con combos ───────────────────────────────────────────────
// PRIORIDAD 1: combo conocido en dm_combos_v1 (factor exacto)
// PRIORIDAD 2: factor inferido de la descripción (requiere confirmación)
// PRIORIDAD 3: artículo unitario (factor = 1)
export function expandirLineasConCombos(lineas, combos, modo = 'expandir') {
  // modo='expandir' → devuelve artículos unitarios con cant real
  // modo='anotar'   → devuelve líneas originales con metadata del combo
  const expandidas = [];
  for (const l of lineas) {

    // PRIORIDAD 1: combo conocido
    const combo = combos?.[l.cod];
    if (combo && combo.componentes?.length > 0) {
      if (modo === 'expandir') {
        for (const comp of combo.componentes) {
          expandidas.push({
            ...l,
            cod:       comp.cod,
            desc:      comp.desc,
            cant:      l.cant * comp.cant,
            esCombo:   true,
            comboTipo: 'conocido',
            codCombo:  l.cod,
            descCombo: combo.desc,
            cantCombo: l.cant,
            factor:    comp.cant,
            factorDesc: comp.cant > 99 ? `${l.cant}×${comp.cant}=${l.cant*comp.cant}u` : `×${comp.cant}`,
          });
        }
      } else {
        expandidas.push({
          ...l,
          esCombo: true, comboTipo: 'conocido',
          factor: combo.componentes[0]?.cant || 1,
          factorDesc: `×${combo.componentes[0]?.cant || 1}`,
          cantReal: l.cant * (combo.componentes[0]?.cant || 1),
        });
      }
      continue;
    }

    // PRIORIDAD 2: factor inferido de la descripción
    const inferido = detectarFactorCombo(l.desc);
    if (inferido && inferido.factor > 1) {
      if (modo === 'expandir') {
        // Intentar encontrar el artículo base (quitar sufijo del código)
        const codBase = l.cod.replace(/[/\\-]\d+$/, '').trim() || l.cod;
        expandidas.push({
          ...l,
          cod:       codBase,
          cant:      l.cant * inferido.factor,
          esCombo:   true,
          comboTipo: 'inferido',   // requiere confirmación del usuario
          codCombo:  l.cod,
          descCombo: l.desc,
          cantCombo: l.cant,
          factor:    inferido.factor,
          factorTipo: inferido.tipo,
          factorDesc: `${l.cant}×${inferido.factor}=${l.cant*inferido.factor}u`,
        });
      } else {
        expandidas.push({
          ...l,
          esCombo: true, comboTipo: 'inferido',
          factor: inferido.factor,
          factorDesc: inferido.detalle,
          cantReal: l.cant * inferido.factor,
        });
      }
      continue;
    }

    // PRIORIDAD 3: artículo unitario
    expandidas.push({ ...l, esCombo: false, factor: 1, cantReal: l.cant });
  }
  return expandidas;
}

// ─── localStorage ─────────────────────────────────────────────────────────────
export const lsGet    = (k,d=null)  => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):d; } catch { return d; } };
export const lsSet    = (k,v)       => { try { localStorage.setItem(k,JSON.stringify(v)); return true; } catch { return false; } };
export const lsSetRaw = (k,v)       => { try { localStorage.setItem(k,v); return true; } catch { return false; } };
export const lsGetRaw = (k)         => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsDel    = (k)         => { try { localStorage.removeItem(k); } catch {} };

// ─── API Redis via servidor ───────────────────────────────────────────────────
async function apiFetch(path, opts={}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||`HTTP ${res.status}`); }
  return res.json();
}

export const api = {
  get:   (key)      => apiFetch(`/api/store/${key}`),
  set:   (key, val) => apiFetch(`/api/store/${key}`,       { method:'POST',   body: JSON.stringify({value:val}) }),
  del:   (key)      => apiFetch(`/api/store/${key}`,       { method:'DELETE'  }),
  list:  ()         => apiFetch(`/api/store`),
};

// ─── Artículos (Redis — grande) ───────────────────────────────────────────────
export async function saveArt(artCompact) {
  try {
    await api.set(SK.art, artCompact);
    try { localStorage.setItem(SK.art, JSON.stringify(artCompact)); } catch { /* ok si no entra */ }
    return true;
  } catch(e) { console.error('[saveArt]', e.message); return false; }
}

// Expandir formato compacto "prov|codp|desc|fam|cat|marca|cr|pv|most" a objeto
function expandArtCompact(compact) {
  const o = {};
  for (const [k, s] of Object.entries(compact || {})) {
    if (typeof s === 'string') {
      const p = s.split('|');
      o[k] = { prov:p[0]||'', codp:p[1]||'', desc:p[2]||'', fam:p[3]||'', cat:p[4]||'', marca:p[5]||'', costoReal:+p[6]||0, pvMin:+p[7]||0, mostrador:+p[8]||0 };
    } else if (s && typeof s === 'object') {
      o[k] = s; // ya expandido
    }
  }
  return o;
}

export async function loadArt() {
  // SIEMPRE intentar Redis primero — es la fuente de verdad para artículos
  // localStorage solo se usa como cache de sesión pero Redis tiene la versión completa
  try {
    const { value, exists } = await api.get(SK.art);
    if (exists && value && Object.keys(value).length > 1000) {
      // Redis tiene datos completos — usar esos
      return expandArtCompact(value);
    }
  } catch(e) { console.error('[loadArt Redis]', e.message); }
  
  // Fallback: localStorage (puede tener versión parcial)
  try {
    const local = localStorage.getItem(SK.art);
    if (local) {
      const obj = JSON.parse(local);
      if (obj && Object.keys(obj).length > 100) {
        return expandArtCompact(obj);
      }
    }
  } catch {}
  
  return {};
}

// ─── Datos de stock/ventas (Redis — medianos) ─────────────────────────────────
export async function saveMedium(key, value) {
  try {
    await api.set(key, value);
    lsSet(key, value);
    return true;
  } catch(e) {
    // Fallback solo localStorage
    return lsSet(key, value);
  }
}

export async function loadMedium(key, expandFn) {
  // 1. localStorage
  try {
    const local = localStorage.getItem(key);
    if (local) {
      const obj = JSON.parse(local);
      if (obj && Object.keys(obj).length > 0) return expandFn ? expandFn(obj) : obj;
    }
  } catch {}
  // 2. Redis
  try {
    const { value, exists } = await api.get(key);
    if (exists && value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      return expandFn ? expandFn(value) : value;
    }
  } catch(e) { console.error(`[loadMedium ${key}]`, e.message); }
  return {};
}

// ─── Meta / configuración pequeña (solo localStorage) ────────────────────────
export const getMeta  = ()    => lsGet(SK.meta, {});
export const saveMeta = (m)   => lsSet(SK.meta, m);

// ─── Lista de compra activa ───────────────────────────────────────────────────
export const getListaCompra  = ()  => lsGet(SK.lista, { prov:'', items:{}, ts:null });
export const saveListaCompra = (l) => lsSet(SK.lista, l);
export const clearListaCompra= ()  => lsDel(SK.lista);


// ═══════════════════════════════════════════════════════════════════════════════
// FASE 1 — Núcleo operacional central
// Estados universales + Event Log
// ═══════════════════════════════════════════════════════════════════════════════

export const ESTADOS_OPERACIONALES = {
  PENDIENTE:  'PENDIENTE',
  EN_PROCESO: 'EN_PROCESO',
  VALIDANDO:  'VALIDANDO',
  OBSERVADO:  'OBSERVADO',
  CORREGIR:   'CORREGIR',
  PARCIAL:    'PARCIAL',
  APROBADO:   'APROBADO',
  FINALIZADO: 'FINALIZADO',
  CANCELADO:  'CANCELADO',
};

export const MODULOS_OPERACION = {
  COMPRAS:      'compras',
  RECEPCION:    'recepcion',
  STOCK:        'stock',
  MOVIMIENTOS:  'movimientos',
  INVENTARIO:   'inventario',
  VENTAS:       'ventas',
  ANALYTICS:    'analytics',
  SISTEMA:      'sistema',
};

export const TIPOS_EVENTO_OPERACION = {
  CREADO:             'CREADO',
  GUARDADO:           'GUARDADO',
  ESTADO_CAMBIADO:    'ESTADO_CAMBIADO',
  DOCUMENTO_CARGADO:  'DOCUMENTO_CARGADO',
  ERROR_DETECTADO:    'ERROR_DETECTADO',
  CORRECCION_CREADA:  'CORRECCION_CREADA',
  CORRECCION_APLICADA:'CORRECCION_APLICADA',
  RECEPCION_CREADA:   'RECEPCION_CREADA',
  MOVIMIENTO_CREADO:  'MOVIMIENTO_CREADO',
  INVENTARIO_AJUSTADO:'INVENTARIO_AJUSTADO',
  AUDITORIA:          'AUDITORIA',
};

export function crearEventoOperacion({
  modulo = MODULOS_OPERACION.SISTEMA,
  tipo_evento = TIPOS_EVENTO_OPERACION.GUARDADO,
  objeto = '',
  objeto_id = '',
  estado_anterior = '',
  estado_nuevo = '',
  resultado = 'ok',
  criticidad = 'normal',
  usuario = 'Operario',
  duracion_ms = null,
  payload = {},
} = {}) {
  const ts = new Date().toISOString();

  return {
    id_evento: `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fecha_hora: ts,
    usuario,
    modulo,
    tipo_evento,
    objeto,
    objeto_id,
    estado_anterior,
    estado_nuevo,
    resultado,
    criticidad,
    duracion_ms,
    payload,
  };
}

export async function registrarEventoOperacion(eventoInput = {}) {
  const evento = crearEventoOperacion(eventoInput);

  let eventos = [];
  try {
    eventos = lsGet(SK.opEvents, []);
    if (!Array.isArray(eventos)) eventos = [];
  } catch {
    eventos = [];
  }

  eventos.push(evento);

  // Mantener una cola local razonable para no saturar localStorage.
  // Redis conserva la misma estructura como respaldo compartido.
  if (eventos.length > 3000) eventos = eventos.slice(eventos.length - 3000);

  try { lsSet(SK.opEvents, eventos); } catch {}

  try {
    await api.set(SK.opEvents, eventos);
  } catch(e) {
    console.error('[registrarEventoOperacion Redis]', e.message);
  }

  return evento;
}

export async function cargarEventosOperacion({ modulo = '', objeto = '', objeto_id = '', limit = 500 } = {}) {
  let eventos = [];

  try {
    const { value, exists } = await api.get(SK.opEvents);
    if (exists && Array.isArray(value)) {
      eventos = value;
      try { lsSet(SK.opEvents, value); } catch {}
    }
  } catch(e) {
    console.error('[cargarEventosOperacion Redis]', e.message);
  }

  if (!eventos.length) {
    eventos = lsGet(SK.opEvents, []);
    if (!Array.isArray(eventos)) eventos = [];
  }

  if (modulo) eventos = eventos.filter(e => e.modulo === modulo);
  if (objeto) eventos = eventos.filter(e => e.objeto === objeto);
  if (objeto_id) eventos = eventos.filter(e => e.objeto_id === objeto_id);

  return eventos.slice(-limit).reverse();
}

export async function registrarCambioEstado({
  modulo,
  objeto,
  objeto_id,
  estado_anterior,
  estado_nuevo,
  usuario = 'Operario',
  payload = {},
}) {
  return registrarEventoOperacion({
    modulo,
    tipo_evento: TIPOS_EVENTO_OPERACION.ESTADO_CAMBIADO,
    objeto,
    objeto_id,
    estado_anterior,
    estado_nuevo,
    resultado: 'ok',
    usuario,
    payload,
  });
}

export function calcularResumenEventos(eventos = []) {
  const resumen = {
    total: eventos.length,
    porModulo: {},
    porTipo: {},
    porResultado: {},
    porCriticidad: {},
  };

  for (const e of eventos) {
    resumen.porModulo[e.modulo] = (resumen.porModulo[e.modulo] || 0) + 1;
    resumen.porTipo[e.tipo_evento] = (resumen.porTipo[e.tipo_evento] || 0) + 1;
    resumen.porResultado[e.resultado] = (resumen.porResultado[e.resultado] || 0) + 1;
    resumen.porCriticidad[e.criticidad] = (resumen.porCriticidad[e.criticidad] || 0) + 1;
  }

  return resumen;
}

