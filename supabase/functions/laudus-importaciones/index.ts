// supabase/functions/laudus-importaciones/index.ts
// Análisis de importaciones: extrae las líneas PENDIENTES de todos los pedidos
// de venta y las compara contra el stock actual y lo ya pedido a proveedores.
//
//   faltante = max(0, demanda pendiente − stock actual − en tránsito del proveedor)
//
// IMPORTANTE: esta función NO consulta la API de Laudus. Todos los datos
// (pedidos, facturas, guías, órdenes de compra, recepciones) ya están
// materializados en Supabase por el cron `sync-laudus-ventas` (tablas
// laudus_pedidos / laudus_facturas / laudus_guias / laudus_compras_ordenes /
// laudus_compras_guias). Las consultas a Laudus quedan centralizadas solo
// en ese cron para no golpear la API en cada clic de "Buscar".
//
// "En tránsito" = lo que ya se le pidió al proveedor (laudus_compras_ordenes)
// y aún no ha llegado (no aparece recibido en laudus_compras_guias). El
// cruce de compras es a nivel SKU porque las recepciones no traen traceFrom.
//
// Devuelve:
//   • pedidos    → pedidos con al menos una línea cuyo producto tiene faltante
//   • productos  → cada producto con totalPedido / pendiente / stock / enTransito / faltante (a importar)
//   • yaPedidos  → todo lo que ya se le pidió al proveedor y sigue en camino
//
// Body opcional: { desde: "2026-04-01" }  (por defecto, últimos 60 días)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function selectAll(supabase: any, table: string, cols: string, dateCol: string, desdeTs: string): Promise<any[]> {
  const PAGE = 1000
  let from = 0
  const all: any[] = []
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .gte(dateCol, desdeTs)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = Date.now()
  try {
    let desde = ''
    try { const b = await req.json(); desde = b?.desde || '' } catch { /* sin body */ }
    if (!desde) {
      const d = new Date(); d.setDate(d.getDate() - 60)
      desde = d.toISOString().slice(0, 10)
    }
    const desdeTs = `${desde}T00:00:00`

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const [pedidosRows, facturasRows, guiasRows, poRows, prRows, syncRow] = await Promise.all([
      selectAll(supabase, 'laudus_pedidos',         'sales_order_id, issued_date, customer, null_doc, items', 'issued_date', desdeTs),
      selectAll(supabase, 'laudus_facturas',        'sales_invoice_id, null_doc, items',                      'issued_date', desdeTs),
      selectAll(supabase, 'laudus_guias',           'sales_waybill_id, null_doc, items',                      'issued_date', desdeTs),
      selectAll(supabase, 'laudus_compras_ordenes', 'purchase_order_id, supplier, null_doc, items',           'issued_date', desdeTs),
      selectAll(supabase, 'laudus_compras_guias',   'purchase_waybill_id, null_doc, items',                   'issued_date', desdeTs),
      supabase.from('laudus_pedidos').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    // Agrupar pedidos de venta
    const ordersMap = new Map<number, any>()
    for (const row of pedidosRows) {
      if (row.null_doc) continue
      ordersMap.set(row.sales_order_id, {
        salesOrderId: row.sales_order_id,
        issuedDate:   row.issued_date,
        customer:     row.customer || '',
        items: (row.items || []).map((it: any) => ({
          itemId: it.itemId, qty: Number(it.qty) || 0, sku: it.sku || '', desc: it.desc || '',
        })),
      })
    }

    // Cobertura por línea (guía manda; si no hay, factura)
    const invQty = new Map<number, number>()
    for (const row of facturasRows) {
      if (row.null_doc) continue
      for (const it of row.items || []) {
        if (it.traceFromStep !== 'O') continue
        invQty.set(it.traceFromId, (invQty.get(it.traceFromId) || 0) + (Number(it.qty) || 0))
      }
    }
    const wbQty = new Map<number, number>()
    for (const row of guiasRows) {
      if (row.null_doc) continue
      for (const it of row.items || []) {
        if (it.traceFromStep !== 'O') continue
        wbQty.set(it.traceFromId, (wbQty.get(it.traceFromId) || 0) + (Number(it.qty) || 0))
      }
    }

    // ── Órdenes de compra a proveedores: cuánto sigue "en camino" por SKU ──
    // (cruce a nivel SKU: las recepciones materializadas no traen traceFrom)
    const recibidoPorSku = new Map<string, number>()
    for (const row of prRows) {
      if (row.null_doc) continue
      for (const it of row.items || []) {
        if (!it.sku) continue
        recibidoPorSku.set(it.sku, (recibidoPorSku.get(it.sku) || 0) + (Number(it.qty) || 0))
      }
    }
    const pedidoCompraPorSku = new Map<string, number>()   // total pedido al proveedor, sin descontar recibido
    const enTransitoPorSku   = new Map<string, number>()
    const yaPedidosPorSku    = new Map<string, any>()
    for (const row of poRows) {
      if (row.null_doc) continue
      for (const it of row.items || []) {
        if (!it.sku) continue
        pedidoCompraPorSku.set(it.sku, (pedidoCompraPorSku.get(it.sku) || 0) + (Number(it.qty) || 0))
      }
    }
    for (const [sku, pedidoTotal] of pedidoCompraPorSku) {
      const recibido = recibidoPorSku.get(sku) || 0
      const pend = Math.max(0, pedidoTotal - recibido)
      if (pend > 0) enTransitoPorSku.set(sku, pend)
    }
    // Detalle (desc/proveedor/nro de órdenes) para la columna "Ya pedidos"
    const skuOrdenes = new Map<string, Set<number>>()
    const skuDescProv = new Map<string, { desc: string, proveedor: string }>()
    for (const row of poRows) {
      if (row.null_doc) continue
      for (const it of row.items || []) {
        if (!it.sku) continue
        const set = skuOrdenes.get(it.sku) || new Set<number>()
        set.add(row.purchase_order_id)
        skuOrdenes.set(it.sku, set)
        if (!skuDescProv.has(it.sku)) skuDescProv.set(it.sku, { desc: it.desc || '', proveedor: row.supplier || 'Sin proveedor' })
      }
    }
    for (const [sku, cantidad] of enTransitoPorSku) {
      const meta = skuDescProv.get(sku) || { desc: '', proveedor: 'Sin proveedor' }
      yaPedidosPorSku.set(sku, {
        sku, desc: meta.desc, cantidad, proveedor: meta.proveedor,
        ordenes: skuOrdenes.get(sku)?.size || 0,
      })
    }

    // Todas las líneas por pedido (para el detalle) + demanda agregada por SKU
    const pendOrders: any[] = []
    const porSku = new Map<string, any>()
    for (const o of ordersMap.values()) {
      const allLines: any[] = []
      let tienePendiente = false
      for (const it of o.items) {
        if (!it.sku) continue   // líneas sin producto (texto libre) no se comparan
        if (it.sku.trim().toLowerCase() === 'flete') continue   // el flete no es un producto a importar
        const inv = invQty.get(it.itemId) || 0
        const wb  = wbQty.get(it.itemId)  || 0
        const effective = wb > 0 ? wb : inv
        const pending   = Math.max(0, it.qty - effective)
        allLines.push({ sku: it.sku, desc: it.desc, qty: it.qty, effective, pending })
        if (pending > 0) {
          tienePendiente = true
          const e = porSku.get(it.sku) || { sku: it.sku, desc: it.desc, pendiente: 0, totalPedido: 0, pedidos: new Set<number>() }
          e.pendiente += pending
          e.totalPedido += it.qty
          e.pedidos.add(o.salesOrderId)
          porSku.set(it.sku, e)
        }
      }
      if (tienePendiente) {
        pendOrders.push({
          salesOrderId: o.salesOrderId,
          issuedDate:   o.issuedDate,
          customer:     o.customer,
          lines:        allLines,
        })
      }
    }

    // Stock actual desde Supabase (productos sincronizados de Laudus)
    const skus = [...porSku.keys()]
    const stockMap = new Map<string, number>()
    const provMap  = new Map<string, string>()
    for (let i = 0; i < skus.length; i += 200) {
      const chunk = skus.slice(i, i + 200)
      const { data, error } = await supabase
        .from('productos')
        .select('codigo, stock, proveedor')
        .in('codigo', chunk)
      if (error) throw new Error(`Stock: ${error.message}`)
      for (const p of data || []) {
        stockMap.set(p.codigo, p.stock || 0)
        if (p.proveedor) provMap.set(p.codigo, p.proveedor)
      }
    }

    // Productos con faltante (demanda pendiente > stock disponible − lo que
    // ya se le pidió al proveedor y sigue en camino, para no duplicar el pedido)
    const productos: any[] = []
    for (const e of porSku.values()) {
      const stock      = stockMap.get(e.sku) ?? 0
      const enTransito = enTransitoPorSku.get(e.sku) || 0
      const faltante   = Math.max(0, e.pendiente - stock - enTransito)
      if (faltante > 0) {
        productos.push({
          sku: e.sku, desc: e.desc,
          totalPedido: e.totalPedido,
          pendiente: e.pendiente, stock, enTransito, faltante,
          pedidos: e.pedidos.size,
          proveedor: provMap.get(e.sku) || 'Sin proveedor',
        })
      }
    }
    productos.sort((a, b) => b.faltante - a.faltante)
    const skusFaltantes = new Set(productos.map(p => p.sku))

    // Agrupar productos faltantes por proveedor
    const provGroups = new Map<string, any>()
    for (const p of productos) {
      const key = p.proveedor || 'Sin proveedor'
      const g = provGroups.get(key) || { proveedor: key, productos: [], totalFaltante: 0 }
      g.productos.push(p)
      g.totalFaltante += p.faltante
      provGroups.set(key, g)
    }
    const proveedores = [...provGroups.values()].sort((a, b) => b.totalFaltante - a.totalFaltante)

    // Cuarta columna: todo lo que ya se le pidió al proveedor y sigue en
    // camino (independiente de si ya cubre o no el faltante del cliente).
    const yaPedidos = [...yaPedidosPorSku.values()].sort((a, b) => b.cantidad - a.cantidad)

    // Pedidos afectados: con al menos una línea pendiente cuyo producto tiene faltante.
    // Cada línea lleva sinStock=true si su pendiente no se cubre con el stock actual.
    const pedidos = pendOrders
      .map(o => ({
        ...o,
        lines: o.lines.map((l: any) => ({
          ...l,
          sinStock: l.pending > 0 && skusFaltantes.has(l.sku),
        })),
      }))
      .filter(o => o.lines.some((l: any) => l.sinStock))
      .sort((a, b) => b.salesOrderId - a.salesOrderId)

    return new Response(JSON.stringify({
      ok: true,
      desde,
      durationMs: Date.now() - started,
      ultimaSync: syncRow?.data?.synced_at || null,
      resumen: {
        pedidosConFaltantes: pedidos.length,
        productosFaltantes:  productos.length,
        unidadesFaltantes:   productos.reduce((s, p) => s + p.faltante, 0),
        proveedores:         proveedores.length,
      },
      pedidos,
      productos,
      proveedores,
      yaPedidos,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
