// src/roles.js — Catálogo central de roles del panel web.
// 'pantallas' define qué cards del Dashboard ve cada rol.
// ⚠️ Por ahora todos ven lo mismo: las atribuciones se irán diferenciando
// aquí (sacar/agregar pantallas por rol) a medida que se construya.
export const ROLES = {
  admin_pedidos: {
    label: 'Administrador de pedidos',
    emoji: '🔑',
    color: '#4338CA',
    bg:    '#EEF2FF',
    pantallas: ['despachos', 'inventario', 'pedidos'],
  },
  admin_importaciones: {
    label: 'Administrador de importaciones',
    emoji: '🚢',
    color: '#0E7490',
    bg:    '#ECFEFF',
    pantallas: ['importaciones', 'inventario'],
  },
  jefe_admin: {
    label: 'Jefe de administración',
    emoji: '🧭',
    color: '#92400E',
    bg:    '#FFFBEB',
    pantallas: ['estado_pedidos', 'importaciones', 'despachos', 'inventario', 'pedidos'],
  },
  bodega: {
    label: 'Bodega',
    emoji: '📦',
    color: '#047857',
    bg:    '#ECFDF5',
    pantallas: ['pedidos', 'inventario'],
  },
}

// Compatibilidad: perfiles antiguos con rol 'administrador' = admin de pedidos
export const normalizarRol = (rol) =>
  ROLES[rol] ? rol : (rol === 'administrador' ? 'admin_pedidos' : null)

export const getRol = (rol) => ROLES[normalizarRol(rol)] || null
