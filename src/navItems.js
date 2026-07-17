// src/navItems.js — Catálogo central de pantallas navegables.
// Qué pantallas ve cada rol lo define ROLES[rol].pantallas (en roles.js);
// este archivo solo define cómo se ve/navega cada una. Lo usan tanto el
// Dashboard (grid de cards) como el Sidebar (menú lateral de escritorio),
// para no duplicar label/emoji/ruta en dos lugares.
export const NAV_ITEMS = {
  despachos: {
    emoji: '🚚',
    label: 'Despachos',
    desc:  'Pedidos de Laudus con guía/factura/boleta → enviar a bodega',
    ruta:  '/despachos',
    color: 'var(--accent)',
  },
  importaciones: {
    emoji: '🚢',
    label: 'Importaciones',
    desc:  'Faltantes de stock para pedidos pendientes → qué importar',
    ruta:  '/importaciones',
    color: 'var(--success)',
  },
  estado_pedidos: {
    emoji: '📋',
    label: 'Estado de Pedidos',
    desc:  'Kanban de cumplimiento: pendientes, parciales y despachados + KPIs',
    ruta:  '/estado-pedidos',
    color: '#000000',
  },
  inventario: {
    emoji: '📋',
    label: 'Ver Inventario',
    desc:  'Buscar y gestionar el stock',
    ruta:  '/inventario',
    color: 'var(--primary)',
  },
  pedidos: {
    emoji: '📦',
    label: 'Pedidos',
    desc:  'Supervisar todos los pedidos',
    ruta:  '/pedidos',
    color: 'var(--accent)',
  },
  impresion_pedido: {
    emoji: '🖨️',
    label: 'Impresión de pedido',
    desc:  'Probar el formato de impresión de un pedido',
    ruta:  '/impresion-pedido',
    color: 'var(--muted)',
  },
}
