// src/db/index.js — Mismas funciones que la app móvil (async/await + Supabase)
import { supabase } from '../lib/supabase'

// ─── Normalización: mismos nombres de campo que usa la app móvil ──────────────

const normalizeProducto = (row) => ({
  id:        row.id,
  codigo:    row.codigo,
  nombre:    row.nombre,
  stock:     row.stock,
  categoria: row.categoria  || 'General',
  ubicacion: row.ubicacion  || '',
  proveedor: row.proveedor  || null,
  imagenes:  JSON.stringify(row.imagenes || []),
  descontinuado: row.descontinuado === true,
})

const normalizePedido = (row) => ({
  id:               row.id,
  numero_pedido:    row.numero,
  estado:           row.estado,
  cliente_nombre:   row.cliente,
  notas_admin:      row.notas,
  bodeguero_id:     row.bodeguero_id,
  bodeguero_nombre: row.bodegueros?.nombre || null,
  foto_cierre_url:  row.foto_cierre,
  creado_en:        row.created_at,
  tomado_en:        row.tomado_en,
  cerrado_en:       row.cerrado_en,
  laudus_order_id:  row.laudus_order_id ?? null,
  carrier:          row.carrier ?? null,
})

const normalizeItem = (row) => ({
  id:                  row.id,
  pedido_id:           row.pedido_id,
  producto_id:         row.producto_id,
  cantidad_pedida:     row.cantidad_pedida,
  cantidad_despachada: row.cantidad_despachada,
  verificado:          row.verificado ? 1 : 0,
  producto_nombre:     row.productos?.nombre,
  producto_codigo:     row.productos?.codigo,
})

// ─── Productos ────────────────────────────────────────────────────────────────

// Lista acotada con búsqueda server-side. Con ~15k productos NO se puede traer
// todo (el payload satura la conexión). Por eso siempre va con .limit().
export const getProductos = async (q = '', limit = 100, incluirDescontinuados = false, soloConStock = false, proveedor = '') => {
  let query = supabase
    .from('productos')
    .select('id, codigo, nombre, stock, categoria, ubicacion, proveedor, imagenes, descontinuado')
    .order('nombre', { ascending: true })
    .limit(limit)
  if (!incluirDescontinuados) query = query.eq('descontinuado', false)
  if (soloConStock) query = query.gt('stock', 0)
  if (proveedor === '__sin_proveedor__') query = query.is('proveedor', null)
  else if (proveedor) query = query.eq('proveedor', proveedor)
  const t = (q || '').trim().replace(/[,()%]/g, ' ').trim()
  if (t) query = query.or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeProducto)
}

// Total de productos (consulta liviana, solo el conteo). Por defecto solo activos.
export const contarProductos = async (incluirDescontinuados = false, soloConStock = false, proveedor = '') => {
  let query = supabase.from('productos').select('*', { count: 'exact', head: true })
  if (!incluirDescontinuados) query = query.eq('descontinuado', false)
  if (soloConStock) query = query.gt('stock', 0)
  if (proveedor === '__sin_proveedor__') query = query.is('proveedor', null)
  else if (proveedor) query = query.eq('proveedor', proveedor)
  const { count, error } = await query
  if (error) return null
  return count ?? 0
}

// Lista de proveedores distintos (para el selector de filtro). El conteo por
// proveedor respeta los mismos toggles activos (descontinuados/stock) para
// que no quede desalineado con lo que en realidad se ve al elegirlo.
export const getProveedores = async (incluirDescontinuados = false, soloConStock = false) => {
  let query = supabase.from('productos').select('proveedor')
  if (!incluirDescontinuados) query = query.eq('descontinuado', false)
  if (soloConStock) query = query.gt('stock', 0)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const conteo = new Map()
  for (const row of data || []) {
    const key = row.proveedor || '__sin_proveedor__'
    conteo.set(key, (conteo.get(key) || 0) + 1)
  }
  const lista = [...conteo.entries()]
    .map(([proveedor, n]) => ({ proveedor, n }))
    .sort((a, b) => {
      if (a.proveedor === '__sin_proveedor__') return 1
      if (b.proveedor === '__sin_proveedor__') return -1
      return a.proveedor.localeCompare(b.proveedor)
    })
  return lista
}

// ─── Bodegueros ───────────────────────────────────────────────────────────────

export const getBodegueros = async () => {
  const { data, error } = await supabase
    .from('bodegueros')
    .select('*')
    .order('nombre', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export const insertBodeguero = async (bodeguero) => {
  const { error } = await supabase
    .from('bodegueros')
    .insert({ nombre: bodeguero.nombre.trim(), rol: bodeguero.rol || 'admin_pedidos' })
  if (error) throw new Error(error.message)
}

// ─── Número de pedido: formato IMP-YYYY-NNN ───────────────────────────────────

const generarNumeroPedido = async () => {
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .like('numero', `IMP-${year}-%`)
  const nnn = String((count || 0) + 1).padStart(3, '0')
  return `IMP-${year}-${nnn}`
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────

export const getPedidos = async () => {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, bodegueros(nombre)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []).map(normalizePedido)
}

export const getPedidoById = async (id) => {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, bodegueros(nombre), items_pedido(*, productos(nombre, codigo))')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return {
    ...normalizePedido(data),
    items: (data.items_pedido || []).map(normalizeItem),
  }
}

export const insertPedido = async (pedido) => {
  const numero = await generarNumeroPedido()
  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      numero,
      cliente: pedido.cliente_nombre || '',
      notas:   pedido.notas_admin   || '',
      estado:  'pendiente',
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export const updatePedido = async (id, cambios) => {
  const { error } = await supabase.from('pedidos').update(cambios).eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Ítems de pedido ──────────────────────────────────────────────────────────

export const getItemsByPedido = async (pedidoId) => {
  const { data, error } = await supabase
    .from('items_pedido')
    .select('*, productos(nombre, codigo)')
    .eq('pedido_id', pedidoId)
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeItem)
}

export const insertItem = async (item) => {
  const { error } = await supabase.from('items_pedido').insert({
    pedido_id:       item.pedido_id,
    producto_id:     item.producto_id,
    cantidad_pedida: item.cantidad_pedida,
  })
  if (error) throw new Error(error.message)
}

export const updateItem = async (id, cambios) => {
  const { error } = await supabase.from('items_pedido').update(cambios).eq('id', id)
  if (error) throw new Error(error.message)
}
