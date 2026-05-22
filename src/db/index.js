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
  imagenes:  JSON.stringify(row.imagenes || []),
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

export const getProductos = async () => {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .order('nombre', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeProducto)
}

export const getProductoByCodigo = async (codigo) => {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .eq('codigo', codigo)
    .maybeSingle()
  if (error) return null
  return data ? normalizeProducto(data) : null
}

export const insertProducto = async (producto) => {
  const imgs = (() => {
    try { return JSON.parse(producto.imagenes || '[]') }
    catch { return [] }
  })()
  const { error } = await supabase.from('productos').insert({
    codigo:    producto.codigo.trim(),
    nombre:    producto.nombre.trim(),
    stock:     parseInt(producto.stock) || 0,
    categoria: producto.categoria || 'General',
    ubicacion: producto.ubicacion || '',
    imagenes:  imgs,
  })
  if (error) throw new Error(error.message)
}

export const updateProducto = async (id, cambios) => {
  const { error } = await supabase
    .from('productos')
    .update(cambios)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export const deleteProducto = async (id) => {
  const { error } = await supabase.from('productos').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export const updateStock = async (id, nuevoStock) => {
  const { error } = await supabase
    .from('productos')
    .update({ stock: parseInt(nuevoStock) || 0 })
    .eq('id', id)
  if (error) throw new Error(error.message)
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
    .insert({ nombre: bodeguero.nombre.trim(), rol: bodeguero.rol || 'administrador' })
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
