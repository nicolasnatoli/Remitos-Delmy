import { useMemo } from 'react';
import {
  esPedido, esEntrega,
  calcularEstadoPedido, ultimosCinco,
  hoy, ayer,
} from '../utils/remitos';

export function usePedidos(remitos) {
  return useMemo(() => {
    const todos = Object.values(remitos);
    const pedidos  = todos.filter(r => esPedido(r.categoria));
    const entregas = todos.filter(r => esEntrega(r.categoria));

    // Calcular estado de cada pedido
    const pedidosConEstado = pedidos.map(p => ({
      ...p,
      estadoCalculado: calcularEstadoPedido(p, entregas),
      entregasAsociadas: getEntregasAsociadas(p, entregas),
    }));

    return { pedidosConEstado, entregas, todos };
  }, [remitos]);
}

export function getEntregasAsociadas(pedido, todasLasEntregas) {
  const tag = ultimosCinco(pedido.remito);
  return todasLasEntregas.filter(e => {
    if (e.obs && e.obs.includes(tag)) return true;
    if (e.destino === pedido.origen && e.fecha >= pedido.fecha) {
      const codsPedido = new Set(pedido.lineas.map(l => l.cod));
      return e.lineas.some(l => codsPedido.has(l.cod));
    }
    return false;
  });
}

export function getComparacion(pedido, entregasAsociadas) {
  const pedidoMap = {};
  for (const l of pedido.lineas) {
    pedidoMap[l.cod] = { cod: l.cod, desc: l.desc, pedida: (pedidoMap[l.cod]?.pedida || 0) + Number(l.cant) };
  }
  const entregadoMap = {};
  for (const e of entregasAsociadas) {
    for (const l of e.lineas) {
      entregadoMap[l.cod] = (entregadoMap[l.cod] || 0) + Number(l.cant);
    }
  }
  return Object.values(pedidoMap).map(item => ({
    ...item,
    entregada: entregadoMap[item.cod] || 0,
    pendiente: Math.max(0, item.pedida - (entregadoMap[item.cod] || 0)),
    sobrante:  Math.max(0, (entregadoMap[item.cod] || 0) - item.pedida),
  }));
}

export function groupByFecha(pedidosConEstado) {
  const hoyStr  = hoy();
  const ayerStr = ayer();
  const grupos  = { hoy: [], ayer: [], anteriores: [] };
  for (const p of pedidosConEstado) {
    if (p.fecha === hoyStr) grupos.hoy.push(p);
    else if (p.fecha === ayerStr) grupos.ayer.push(p);
    else grupos.anteriores.push(p);
  }
  const ordenEstados = ['sin_confirmar','abierto','parcial','con_faltantes','completo'];
  const sortFn = (a, b) => {
    const ea = ordenEstados.indexOf(a.estadoCalculado);
    const eb = ordenEstados.indexOf(b.estadoCalculado);
    return ea !== eb ? ea - eb : b.fecha.localeCompare(a.fecha);
  };
  grupos.hoy.sort(sortFn);
  grupos.ayer.sort(sortFn);
  grupos.anteriores.sort(sortFn);
  return grupos;
}
