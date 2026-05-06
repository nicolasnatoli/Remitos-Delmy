// ===== LÓGICA DE NEGOCIO — REMITOS =====

export const CATEGORIAS_PEDIDO = [
  'PEDIDO A DEPOSITO COTILLON',
  'PEDIDO A DEPOSITO REPOSTERIA',
  'PEDIDO A DEPOSITO LIBRERIA',
  'PEDIDO A DEPOSITO JUGUETERIA',
  'PEDIDO A DEPOSITO ENVASADO',
  'PEDIDO SUCURSAL A SUCURSAL',
];

export const CATEGORIAS_ENTREGA = [
  'ENVIO DEPOSITO A SUCURSAL',
  'ENVIO PEDIDO TELEFONICO',
  'ENVIO PEDIDO URGENTE',
  'ENVIO PEDIDO A CLIENTE',
  'ENVIO SUCURSAL A SUCURSAL',
];

export const CATEGORIAS_DEVOLUCION = ['ENVIO SUCURSAL A DEPOSITO'];
export const CATEGORIAS_ERROR = ['ERROR ENVIO CON FALTANTES', 'ERROR ENVIO CON SOBRANTES'];

export function esPedido(cat)     { return CATEGORIAS_PEDIDO.includes(cat); }
export function esEntrega(cat)    { return CATEGORIAS_ENTREGA.includes(cat); }
export function esDevolucion(cat) { return CATEGORIAS_DEVOLUCION.includes(cat); }
export function esError(cat)      { return CATEGORIAS_ERROR.includes(cat); }

// Últimos 5 dígitos de un # Remito
export function ultimosCinco(nRemito) {
  const clean = nRemito.replace(/\D/g, '');
  return clean.slice(-5);
}

// Matcheo pedido ↔ entrega
export function matchPedidoEntrega(pedido, entrega) {
  const tag = ultimosCinco(pedido.remito);
  if (entrega.obs && entrega.obs.includes(tag)) return true;
  return false;
}

// Estado de pedido según definiciones
export function calcularEstadoPedido(pedido, todasLasEntregas) {
  // 1. Sin confirmar
  if (pedido.estado !== 'Anulado') return 'sin_confirmar';

  // Obtener entregas asociadas
  const tag = ultimosCinco(pedido.remito);
  const entregas = todasLasEntregas.filter(e => {
    if (!esEntrega(e.categoria)) return false;
    if (e.obs && e.obs.includes(tag)) return true;
    // fallback: misma sucursal destino, fecha >= pedido
    if (e.destino === pedido.origen && e.fecha >= pedido.fecha) {
      const codsPedido = new Set(pedido.lineas.map(l => l.cod));
      return e.lineas.some(l => codsPedido.has(l.cod));
    }
    return false;
  });

  // 2. Abierto (sin entregas)
  if (entregas.length === 0) return 'abierto';

  // 3. CR check
  const crEntrega = entregas.find(e => e.obs && e.obs.includes('CR'));
  if (crEntrega) return 'con_faltantes';

  // 4. Comparar artículos
  const pedidoMap = {};
  for (const l of pedido.lineas) {
    pedidoMap[l.cod] = (pedidoMap[l.cod] || 0) + Number(l.cant);
  }
  const entregadoMap = {};
  for (const e of entregas) {
    for (const l of e.lineas) {
      entregadoMap[l.cod] = (entregadoMap[l.cod] || 0) + Number(l.cant);
    }
  }
  const hayPendiente = Object.entries(pedidoMap).some(([cod, cant]) => {
    return (entregadoMap[cod] || 0) < cant;
  });

  if (hayPendiente) return 'parcial';
  return 'completo';
}

export function getEstadoConfig(estado) {
  const map = {
    sin_confirmar: { label: 'Sin confirmar', color: 'azul',    badge: 'badge-azul' },
    abierto:       { label: 'Abierto',        color: 'azul',    badge: 'badge-azul' },
    parcial:       { label: 'Parcial',         color: 'ambar',   badge: 'badge-ambar' },
    con_faltantes: { label: 'Con faltantes',   color: 'rojo',    badge: 'badge-rojo' },
    completo:      { label: 'Completo',        color: 'verde',   badge: 'badge-verde' },
  };
  return map[estado] || { label: estado, color: 'gray', badge: 'badge-gray' };
}

export const ORDEN_ESTADO = ['abierto','sin_confirmar','parcial','con_faltantes','completo'];

export function ordenEstado(e) { return ORDEN_ESTADO.indexOf(e); }

// Hoy en formato YYYY-MM-DD
export function hoy() {
  return new Date().toISOString().split('T')[0];
}
export function ayer() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.toISOString().split('T')[0];
}

export function formatFecha(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
