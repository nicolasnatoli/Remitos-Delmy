// ===== HOOK — usePedidos =====
import { useMemo } from 'react';
import {
  esPedido, esEntrega, esError,
  calcularEstadoPedido, ultimosCinco,
  hoy, ayer, ORDEN_ESTADO,
  expandirLineas,
} from '../utils/remitos';

function linkearEntregas(pedido, entregas) {
  const tag = ultimosCinco(pedido.remito);
  const codsPedido = new Set(pedido.lineas.map(l => l.cod));
  return entregas.filter(e => {
    if (!esEntrega(e.categoria)) return false;
    if (e.obs && e.obs.includes(tag)) return true;
    return (
      e.origen === pedido.destino &&
      e.fecha >= pedido.fecha &&
      e.lineas.some(l => codsPedido.has(l.cod))
    );
  });
}

export function usePedidos(remitos) {
  const todosLosRemitos = useMemo(() => Object.values(remitos || {}), [remitos]);
  const pedidos  = useMemo(() => todosLosRemitos.filter(r => esPedido(r.categoria)),  [todosLosRemitos]);
  const entregas = useMemo(() => todosLosRemitos.filter(r => esEntrega(r.categoria)), [todosLosRemitos]);
  const errores  = useMemo(() => todosLosRemitos.filter(r => esError(r.categoria)),   [todosLosRemitos]);

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

    return { recepcionesSinConfirmar, entregasSinReferencia, erroresSinResolver };
  }, [pedidos, entregas, errores]);

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

  return { pedidosConEstado, pedidos, entregas, errores, kpis, anomalias, pendientesConsolidados };
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
