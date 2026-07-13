// src/roles.js — Catálogo central de roles del panel web.
// 'pantallas' define qué cards del Dashboard ve cada rol.
// ⚠️ Por ahora todos ven lo mismo: las atribuciones se irán diferenciando
// aquí (sacar/agregar pantallas por rol) a medida que se construya.
export const ROLES = {
  admin_pedidos: {
    label: 'Administrador de pedidos',
    emoji: '🔑',
    color: '#9B1328',
    bg:    '#FBEAEC',
    pantallas: ['despachos', 'inventario', 'pedidos'],
  },
  admin_importaciones: {
    label: 'Administrador de importaciones',
    emoji: '🚢',
    color: '#C36A1D',
    bg:    '#FDF1E4',
    pantallas: ['importaciones', 'inventario'],
  },
  jefe_admin: {
    label: 'Jefe de administración',
    emoji: '🧭',
    color: '#8C6710',
    bg:    '#FBF3DC',
    pantallas: ['estado_pedidos', 'importaciones', 'despachos', 'inventario', 'pedidos'],
  },
  bodega: {
    label: 'Bodega',
    emoji: '📦',
    color: '#000000',
    bg:    '#F1F1F1',
    pantallas: ['pedidos', 'inventario'],
  },
}

// Compatibilidad: perfiles antiguos con rol 'administrador' = admin de pedidos
export const normalizarRol = (rol) =>
  ROLES[rol] ? rol : (rol === 'administrador' ? 'admin_pedidos' : null)

export const getRol = (rol) => ROLES[normalizarRol(rol)] || null
