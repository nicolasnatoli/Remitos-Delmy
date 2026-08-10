// ===== HOOK — usePedidos =====
import { useMemo } from 'react';
import {
  esPedido, esEntrega, esError, esCompraDirecta,
  calcularEstadoPedido, ultimosCinco,
  hoy, ayer, ORDEN_ESTADO,
  expandirLineas,
} from '../utils/remitos';

function linkearEntregas(pedido, entregas) {
  const tag = ultimosCinco(pedido.remito);
  const codsPedido = new Set(pedido.lineas.map(l => l.cod));
  return entregas.filter(e => {
    if (!esEntrega(e.categoria)) return false;
    if (e.obs && e.obs.includes(tag)) return true; // tag: se acepta igual aunque la sucursal no cierre — se marca para revisión, no se descarta
    // Fallback: además de depósito de origen correcto y código compartido,
    // ahora exige que la sucursal de destino sea la que hizo el pedido. Sin
    // esto, el fallback empataba ~44% de sus matches con la sucursal
    // equivocada (validado contra datos reales) — puro ruido, no señal.
    return (
      e.origen === pedido.destino &&
      e.destino === pedido.origen &&
      e.fecha >= pedido.fecha &&
      e.lineas.some(l => codsPedido.has(l.cod))
    );
  }).map(e => {
    const viaTag = e.obs && e.obs.includes(tag);
    return {
      ...e,
      viaMatch: viaTag ? 'tag' : 'fallback',
      // Con el fallback ya endurecido arriba, esto solo puede dar false para
      // matches por TAG — un caso que preferimos mostrar para revisar a mano
      // en vez de asumir que está mal (puede haber pedidos legítimos con
      // origen=depósito, no confirmado todavía cómo se usan en la operatoria).
      sucursalConsistente: e.destino === pedido.origen,
    };
  });
}

// Busca si una entrega con diferencia tiene su remito de corrección (ERROR
// ENVIO CON SOBRANTES/FALTANTES) asociado — mismo criterio de match que
// pedido↔entrega: tag en observaciones, o fallback por código + sucursales.
function tieneErrorAsociado(entrega, errores) {
  const tag = ultimosCinco(entrega.remito);
  const cods = new Set(entrega.lineas.map(l => l.cod));
  return errores.some(e => {
    if (e.obs && e.obs.includes(tag)) return true;
    // Fallback: el error involucra las mismas sucursales (en cualquier
    // sentido, porque sobrante/faltante invierten origen/destino) y comparte
    // al menos un código con la entrega original.
    const mismasSucursales =
      (e.origen === entrega.origen && e.destino === entrega.destino) ||
      (e.origen === entrega.destino && e.destino === entrega.origen);
    return mismasSucursales && e.fecha >= entrega.fecha && e.lineas.some(l => cods.has(l.cod));
  });
}

export function usePedidos(remitos) {
  const todosLosRemitos = useMemo(() => Object.values(remitos || {}), [remitos]);
  const pedidos  = useMemo(() => todosLosRemitos.filter(r => esPedido(r.categoria)),  [todosLosRemitos]);
  const entregas = useMemo(() => todosLosRemitos.filter(r => esEntrega(r.categoria)), [todosLosRemitos]);
  const errores  = useMemo(() => todosLosRemitos.filter(r => esError(r.categoria)),   [todosLosRemitos]);
  // Compras directas: entran del proveedor y van directo a sucursal, nunca
  // responden a un pedido interno — se trackean aparte, nunca se intentan linkear.
  const comprasDirectas = useMemo(() => todosLosRemitos.filter(r => esCompraDirecta(r.categoria)), [todosLosRemitos]);

  const pedidosConEstado = useMemo(() => {
    return pedidos.map(pedido => ({
      ...pedido,
      entregasAsociadas: linkearEntregas(pedido, entregas),
      estadoCalculado:   calcularEstadoPedido(pedido, entregas),
    })).sort((a, b) => {
      if (b.fecha !== a.fecha) return b.fecha.localeCompare(a.fecha);
      return (ORDEN_ESTADO||[]).indexOf(a.estadoCalculado) - (ORDEN_ESTADO||[]).indexOf(b.estadoCalculado);
    });
  }, [pedidos, entregas]);

  const kpis = useMemo(() => {
    const hoyStr = hoy();
    return {
      total:        pedidosConEstado.length,
      sinConfirmar: pedidosConEstado.filter(p => p.estadoCalculado === 'sin_confirmar').length,
      abiertos:     pedidosConEstado.filter(p => p.estadoCalculado === 'abierto').length,
      parciales:    pedidosConEstado.filter(p => p.estadoCalculado === 'parcial').length,
      conFaltantes: pedidosConEstado.filter(p => p.estadoCalculado === 'con_faltantes').length,
      completos:    pedidosConEstado.filter(p => p.estadoCalculado === 'completo').length,
      hoy:          pedidosConEstado.filter(p => p.fecha === hoyStr).length,
      entregasHoy:  entregas.filter(e => e.fecha === hoyStr).length,
      enTransito:   entregas.filter(e => e.estado === 'En transito' || e.estado === 'En tránsito').length,
    };
  }, [pedidosConEstado, entregas]);

  const anomalias = useMemo(() => {
    const hoyStr  = hoy();
    const ayerStr = ayer();
    const tagsPedidos = new Set(pedidos.map(p => ultimosCinco(p.remito)));

    const recepcionesSinConfirmar = entregas.filter(e =>
      (e.estado === 'En transito' || e.estado === 'En tránsito') &&
      (e.fecha === hoyStr || e.fecha === ayerStr)
    );

    const entregasSinReferencia = entregas.filter(e => {
      if (e.estado === 'Anulado') return false;
      const tieneRef = e.obs && [...tagsPedidos].some(tag => e.obs.includes(tag));
      if (tieneRef) return false;
      const matchoFallback = pedidos.some(p => {
        const codsPedido = new Set(p.lineas.map(l => l.cod));
        return e.origen === p.destino && e.fecha >= p.fecha && e.lineas.some(l => codsPedido.has(l.cod));
      });
      return !matchoFallback;
    });

    const erroresSinResolver = errores.filter(e =>
      e.estado === 'En transito' || e.estado === 'En tránsito' ||
      !([...tagsPedidos].some(tag => e.obs && e.obs.includes(tag)))
    );

    // "Recibido con diferencia" es un estado real y seleccionable en el ERP al
    // confirmar una recepción — hoy no se está usando en la práctica. Cuando SÍ
    // se use, esto detecta si quedó sin su remito de corrección correspondiente
    // (ERROR ENVIO CON SOBRANTES/FALTANTES), que es lo que efectivamente ajusta
    // el stock. Una entrega marcada con diferencia y sin corrección es un hueco
    // real de stock que nadie está viendo.
    const diferenciasSinCorregir = entregas.filter(e =>
      e.estado === 'Recibido con diferencia' && !tieneErrorAsociado(e, errores)
    );

    // Entrega vinculada a un pedido, pero despachada a una sucursal distinta
    // de la que hizo el pedido — el cruce por tag/código puede dar positivo
    // aunque la mercadería haya ido al lugar equivocado, porque nunca se
    // valida destino contra origen del pedido.
    const entregasSucursalInconsistente = [];
    for (const p of pedidos) {
      const asociadas = linkearEntregas(p, entregas);
      for (const e of asociadas) {
        if (!e.sucursalConsistente) entregasSucursalInconsistente.push({ ...e, pedido: p });
      }
    }

    return { recepcionesSinConfirmar, entregasSinReferencia, erroresSinResolver, diferenciasSinCorregir, entregasSucursalInconsistente };
  }, [pedidos, entregas, errores]);

  // Mapa remito de entrega -> pedido que la reclama, para no recalcularlo en
  // cada pestaña que lo necesite (Pedidos y Entregas lo usan por igual).
  const pedidoDeEntrega = useMemo(() => {
    const m = {};
    for (const p of pedidosConEstado) {
      for (const e of p.entregasAsociadas) m[e.remito] = p;
    }
    return m;
  }, [pedidosConEstado]);

  const pendientesConsolidados = useMemo(() => {
    const mapa = {};
    const hoyStr = hoy();
    // Cargar combos para expansión
    const combos = (() => { try { return JSON.parse(localStorage.getItem('dm_combos_v1')||'{}'); } catch { return {}; } })();
    for (const pedido of pedidosConEstado) {
      if (pedido.estadoCalculado !== 'parcial' && pedido.estadoCalculado !== 'abierto') continue;
      // Expandir entregas a unidades base
      const entregadoMap = {};
      for (const e of pedido.entregasAsociadas) {
        for (const l of expandirLineas(e.lineas, combos)) {
          entregadoMap[l.cod] = (entregadoMap[l.cod]||0) + Number(l.cant||0);
        }
      }
      // Expandir pedido a unidades base
      for (const linea of expandirLineas(pedido.lineas, combos)) {
        const pendiente = Math.max(0, Number(linea.cant||0) - (entregadoMap[linea.cod]||0));
        if (!pendiente) continue;
        if (!mapa[linea.cod]) mapa[linea.cod] = { cod: linea.cod, desc: linea.desc, cant: 0, pedidos: [] };
        mapa[linea.cod].cant += pendiente;
        mapa[linea.cod].pedidos.push({ remito: pedido.remito, sucursal: pedido.origen, fecha: pedido.fecha, esHoy: pedido.fecha === hoyStr, pendiente });
      }
    }
    return Object.values(mapa).sort((a, b) => b.cant - a.cant);
  }, [pedidosConEstado]);

  return { pedidosConEstado, pedidos, entregas, errores, comprasDirectas, pedidoDeEntrega, kpis, anomalias, pendientesConsolidados };
}

export function getComparacion(pedido, entregasAsociadas) {
  const combos = (() => { try { return JSON.parse(localStorage.getItem('dm_combos_v1')||'{}'); } catch { return {}; } })();
  const pedidoMap = {};
  for (const l of expandirLineas(pedido.lineas, combos)) {
    if (!pedidoMap[l.cod]) pedidoMap[l.cod] = { cod: l.cod, desc: l.desc, pedida: 0 };
    pedidoMap[l.cod].pedida += Number(l.cant||0);
  }
  const entregadoMap = {};
  const entregadoDesc = {};
  for (const e of entregasAsociadas) {
    for (const l of expandirLineas(e.lineas, combos)) {
      entregadoMap[l.cod] = (entregadoMap[l.cod]||0) + Number(l.cant||0);
      if (!entregadoDesc[l.cod]) entregadoDesc[l.cod] = l.desc;
    }
  }

  // Artículos pedidos — con su estado
  const resultado = Object.values(pedidoMap).map(item => ({
    ...item,
    entregada: entregadoMap[item.cod]||0,
    pendiente: Math.max(0, item.pedida - (entregadoMap[item.cod]||0)),
    sobrante:  Math.max(0, (entregadoMap[item.cod]||0) - item.pedida),
    noSolicitado: false,
  }));

  // Artículos entregados que NO estaban en el pedido → error de entrega
  for (const [cod, cant] of Object.entries(entregadoMap)) {
    if (!pedidoMap[cod]) {
      resultado.push({
        cod,
        desc: entregadoDesc[cod] || cod,
        pedida: 0,
        entregada: cant,
        pendiente: 0,
        sobrante: cant,
        noSolicitado: true, // entregado sin haber sido pedido
      });
    }
  }

  return resultado;
}

export function groupByFecha(pedidos) {
  const hoyStr  = hoy();
  const ayerStr = ayer();
  const sortFn  = (a,b) => {
    const order = ['sin_confirmar','abierto','parcial','con_faltantes','completo'];
    const ea = order.indexOf(a.estadoCalculado), eb = order.indexOf(b.estadoCalculado);
    return ea !== eb ? ea - eb : b.fecha.localeCompare(a.fecha);
  };
  const g = { hoy:[], ayer:[], anteriores:[] };
  for (const p of pedidos) {
    if (p.fecha === hoyStr) g.hoy.push(p);
    else if (p.fecha === ayerStr) g.ayer.push(p);
    else g.anteriores.push(p);
  }
  g.hoy.sort(sortFn); g.ayer.sort(sortFn); g.anteriores.sort(sortFn);
  return g;
}

// ─── Agrupar cualquier lista de remitos por ruta (origen → destino) ───────────
// Es el eje que pediste para separar "qué pasa en Central→Delmy1" de
// "qué pasa en Central→Delmy3" en vez de ver todo mezclado en una lista plana.
export function groupByRuta(lista) {
  const mapa = {};
  for (const r of lista) {
    const key = `${r.origen} → ${r.destino}`;
    if (!mapa[key]) mapa[key] = { ruta: key, origen: r.origen, destino: r.destino, items: [] };
    mapa[key].items.push(r);
  }
  return Object.values(mapa).sort((a, b) => b.items.length - a.items.length);
}

// ─── Comparación pedido↔entregas CON el detalle de qué remito trajo qué ───────
// Como getComparacion(), pero cada línea además trae `remitos: [{remito, cant,
// estado, sucursalConsistente}]` — de dónde salió específicamente lo entregado,
// para no tener que ir remito por remito adivinando cuál cubrió cuál línea.
export function getComparacionPorRemito(pedido, entregasAsociadas) {
  const combos = (() => { try { return JSON.parse(localStorage.getItem('dm_combos_v1')||'{}'); } catch { return {}; } })();
  const pedidoMap = {};
  for (const l of expandirLineas(pedido.lineas, combos)) {
    if (!pedidoMap[l.cod]) pedidoMap[l.cod] = { cod: l.cod, desc: l.desc, pedida: 0, remitos: [] };
    pedidoMap[l.cod].pedida += Number(l.cant || 0);
  }
  const entregadoDesc = {};
  for (const e of entregasAsociadas) {
    for (const l of expandirLineas(e.lineas, combos)) {
      if (!entregadoDesc[l.cod]) entregadoDesc[l.cod] = l.desc;
      if (!pedidoMap[l.cod]) {
        pedidoMap[l.cod] = { cod: l.cod, desc: l.desc, pedida: 0, remitos: [] };
      }
      pedidoMap[l.cod].remitos.push({
        remito: e.remito, cant: Number(l.cant || 0), estado: e.estado,
        sucursalConsistente: e.sucursalConsistente !== false,
      });
    }
  }

  return Object.values(pedidoMap).map(item => {
    const entregada = item.remitos.reduce((s, r) => s + r.cant, 0);
    return {
      ...item,
      entregada,
      pendiente: Math.max(0, item.pedida - entregada),
      sobrante:  Math.max(0, entregada - item.pedida),
      noSolicitado: item.pedida === 0,
    };
  });
}

// ─── Clasificar las líneas de UNA entrega contra el pedido que la reclama ────
// Separa en dos grupos, en vez de mezclarlos en una sola tabla:
//  - respondeAPedido: la línea corresponde a algo que el pedido pedía —
//    incluye cuánto pedía en total el pedido y cuánto le queda pendiente
//    considerando TODAS sus entregas (no solo ésta).
//  - noSolicitadas: venían en el mismo remito pero el pedido no las pedía.
export function clasificarLineasEntrega(entrega, pedidoVinculado) {
  const combos = (() => { try { return JSON.parse(localStorage.getItem('dm_combos_v1')||'{}'); } catch { return {}; } })();
  const lineasEntrega = expandirLineas(entrega.lineas, combos);

  if (!pedidoVinculado) {
    return { respondeAPedido: [], noSolicitadas: lineasEntrega.map(l => ({ ...l })) };
  }

  const comparacion = getComparacionPorRemito(pedidoVinculado, pedidoVinculado.entregasAsociadas || []);
  const compMap = {};
  for (const c of comparacion) compMap[c.cod] = c;

  const respondeAPedido = [];
  const noSolicitadas = [];
  for (const l of lineasEntrega) {
    const c = compMap[l.cod];
    if (c && c.pedida > 0) {
      respondeAPedido.push({
        ...l,
        pedidaTotal: c.pedida,
        entregadaTotalTodasLasEntregas: c.entregada,
        pendienteTotal: c.pendiente,
      });
    } else {
      noSolicitadas.push({ ...l });
    }
  }
  return { respondeAPedido, noSolicitadas };
}
