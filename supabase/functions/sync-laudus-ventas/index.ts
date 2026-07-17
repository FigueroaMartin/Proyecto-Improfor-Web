// sync-laudus-ventas/index.ts
// Materializa VENTAS (pedidos/facturas/guias) y COMPRAS (ordenes de compra +
// recepciones/goods receipts) de Laudus. Cron lun-vie 9-17:30 hora Chile.
// El cruce compras es a nivel SKU (el /list de recepciones no expone traceFrom).
//
// Ademas, para los pedidos NUEVOS o MODIFICADOS desde la ultima sync, trae el
// objeto completo del pedido (GET sales/orders/{id}, sin filtro de fields) y
// del cliente (GET sales/customers/{id}, cacheado por corrida) y los guarda
// en laudus_pedidos.detalle. Son llamadas extra (1 por pedido nuevo/cambiado
// + 1 por cliente distinto), acotadas por MAX_DETALLE para no disparar el
// tiempo de la funcion si hay muchos pedidos pendientes de un solo golpe.
//
// Body opcional: { dias: 90, diasCompras: 365 }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const LAUDUS_BASE = 'https://api.laudus.cl'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function login(): Promise<string> {
  const r = await fetch(`${LAUDUS_BASE}/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      userName:     Deno.env.get('LAUDUS_USERNAME'),
      password:     Deno.env.get('LAUDUS_PASSWORD'),
      companyVATId: Deno.env.get('LAUDUS_COMPANY_VATID'),
    }),
  })
  if (!r.ok) throw new Error(`Login Laudus fallo (HTTP ${r.status})`)
  const d = await r.json()
  if (!d.token) throw new Error('Laudus no devolvio token')
  return d.token
}

async function listAll(token: string, path: string, fields: string[], idField: string, desde: string): Promise<any[]> {
  const LIMIT = 500
  let offset = 0
  const all: any[] = []
  while (true) {
    const r = await fetch(`${LAUDUS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        fields,
        filterBy: [{ field: 'issuedDate', operator: '>=', value: `${desde}T00:00:00` }],
        orderBy: [{ field: idField, direction: 'DESC' }],
        options: { offset, limit: LIMIT },
      }),
    })
    if (r.status === 204) break
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`)
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < LIMIT) break
    offset += LIMIT
  }
  return all
}

function fechaLocal(d: Date, offsetDias = 0): string {
  const c = new Date(d)
  c.setDate(c.getDate() + offsetDias)
  return c.toISOString().slice(0, 10)
}

async function upsertChunks(supabase: any, tabla: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase.from(tabla).upsert(chunk, { onConflict })
    if (error) throw new Error(`${tabla}: ${error.message}`)
  }
}

async function fetchJson(token: string, path: string): Promise<any> {
  const r = await fetch(`${LAUDUS_BASE}/${path}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
  return r.json()
}

// Corre `tasks` con a lo mas `limite` promesas en vuelo a la vez.
async function conPool<T>(items: T[], limite: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = new Date().toISOString()
  const t0 = Date.now()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    let dias = 90, diasCompras = 365
    try { const b = await req.json(); dias = Number(b?.dias) || 90; diasCompras = Number(b?.diasCompras) || 365 } catch {}
    const desde = fechaLocal(new Date(), -dias)
    const desdeC = fechaLocal(new Date(), -diasCompras)
    const nowIso = new Date().toISOString()

    const token = await login()

    const [orderRows, invoiceRows, waybillRows, poRows, prRows] = await Promise.all([
      listAll(token, 'sales/orders/list', [
        'salesOrderId', 'issuedDate', 'nullDoc', 'modifiedAt', 'customer.name', 'customer.VATId',
        'items.itemId', 'items.quantity', 'items.product.sku', 'items.product.description',
        'items.unitPrice', 'items.discountPercentage',
      ], 'salesOrderId', desde),
      listAll(token, 'sales/invoices/list', [
        'salesInvoiceId', 'issuedDate', 'nullDoc', 'docType.name',
        'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep',
      ], 'salesInvoiceId', desde),
      listAll(token, 'sales/waybills/list', [
        'salesWaybillId', 'issuedDate', 'nullDoc',
        'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep',
      ], 'salesWaybillId', desde),
      // COMPRAS: ordenes de compra
      listAll(token, 'purchases/orders/list', [
        'purchaseOrderId', 'issuedDate', 'nullDoc', 'archived', 'status', 'supplier.name',
        'items.itemId', 'items.quantity', 'items.product.sku', 'items.product.productId', 'items.product.description',
      ], 'purchaseOrderId', desdeC),
      // COMPRAS: recepciones (goods receipts) — sin traceFrom (no existe en /list)
      listAll(token, 'purchases/waybills/list', [
        'purchaseWaybillId', 'issuedDate', 'nullDoc', 'supplier.name',
        'items.quantity', 'items.product.sku', 'items.product.productId',
      ], 'purchaseWaybillId', desdeC),
    ])

    const pedMap = new Map<number, any>()
    const modifiedAtByOrder = new Map<number, string>()
    for (const row of orderRows) {
      let o = pedMap.get(row.salesOrderId)
      if (!o) { o = { sales_order_id: row.salesOrderId, issued_date: row.issuedDate || null, customer: row.customer_name || '', customer_vatid: row.customer_VATId || '', null_doc: !!row.nullDoc, items: [], synced_at: nowIso }; pedMap.set(row.salesOrderId, o) }
      if (row.items_itemId != null) o.items.push({ itemId: row.items_itemId, qty: Number(row.items_quantity) || 0, sku: row.items_product_sku || '', desc: row.items_product_description || '', unitPrice: Number(row.items_unitPrice) || 0, discount: Number(row.items_discountPercentage) || 0 })
      if (row.modifiedAt) modifiedAtByOrder.set(row.salesOrderId, row.modifiedAt)
    }
    const facMap = new Map<string, any>()
    for (const row of invoiceRows) {
      let f = facMap.get(row.salesInvoiceId)
      if (!f) { f = { sales_invoice_id: row.salesInvoiceId, issued_date: row.issuedDate || null, null_doc: !!row.nullDoc, doc_type: row.docType_name || '', items: [], synced_at: nowIso }; facMap.set(row.salesInvoiceId, f) }
      f.items.push({ qty: Number(row.items_quantity) || 0, traceFromId: row.items_traceFrom_fromId ?? null, traceFromStep: row.items_traceFrom_fromStep ?? null })
    }
    const guiMap = new Map<number, any>()
    for (const row of waybillRows) {
      let g = guiMap.get(row.salesWaybillId)
      if (!g) { g = { sales_waybill_id: row.salesWaybillId, issued_date: row.issuedDate || null, null_doc: !!row.nullDoc, items: [], synced_at: nowIso }; guiMap.set(row.salesWaybillId, g) }
      g.items.push({ qty: Number(row.items_quantity) || 0, traceFromId: row.items_traceFrom_fromId ?? null, traceFromStep: row.items_traceFrom_fromStep ?? null })
    }
    const poMap = new Map<number, any>()
    for (const row of poRows) {
      let o = poMap.get(row.purchaseOrderId)
      if (!o) { o = { purchase_order_id: row.purchaseOrderId, issued_date: row.issuedDate || null, supplier: row.supplier_name || '', status: row.status != null ? String(row.status) : null, null_doc: !!row.nullDoc, archived: !!row.archived, items: [], synced_at: nowIso }; poMap.set(row.purchaseOrderId, o) }
      if (row.items_itemId != null) o.items.push({ itemId: row.items_itemId, qty: Number(row.items_quantity) || 0, sku: row.items_product_sku || '', productId: row.items_product_productId ?? null, desc: row.items_product_description || '' })
    }
    const prMap = new Map<number, any>()
    for (const row of prRows) {
      let g = prMap.get(row.purchaseWaybillId)
      if (!g) { g = { purchase_waybill_id: row.purchaseWaybillId, issued_date: row.issuedDate || null, supplier: row.supplier_name || '', null_doc: !!row.nullDoc, items: [], synced_at: nowIso }; prMap.set(row.purchaseWaybillId, g) }
      g.items.push({ qty: Number(row.items_quantity) || 0, sku: row.items_product_sku || '', productId: row.items_product_productId ?? null })
    }

    const pedidos = [...pedMap.values()], facturas = [...facMap.values()], guias = [...guiMap.values()]
    const ordenesC = [...poMap.values()], recepciones = [...prMap.values()]

    // ── Detalle completo (pedido + cliente) para lo nuevo/modificado ──
    // Se compara contra el modifiedAt guardado en la ultima corrida
    // (detalle->>'modifiedAt'); si no hay detalle o cambio, se trae de nuevo.
    const MAX_DETALLE = 200
    const CONCURRENCIA_DETALLE = 5
    let detalleFetched = 0
    let detalleCapeados = 0
    try {
      const idsConDatos = pedidos.map(p => p.sales_order_id)
      const existentes = new Map<number, { tieneDetalle: boolean, modAt: string | null }>()
      for (let i = 0; i < idsConDatos.length; i += 500) {
        const chunk = idsConDatos.slice(i, i + 500)
        const { data, error } = await supabase
          .from('laudus_pedidos')
          .select('sales_order_id, detalle')
          .in('sales_order_id', chunk)
        if (error) throw new Error(`leer detalle existente: ${error.message}`)
        for (const row of data || []) {
          existentes.set(row.sales_order_id, { tieneDetalle: row.detalle != null, modAt: row.detalle?.modifiedAt ?? null })
        }
      }

      // Pendiente si: nunca se guardó, o se guardó pero sin detalle todavia,
      // o el modifiedAt de Laudus cambió desde la ultima vez que se trajo.
      // (ojo: comparar solo modifiedAt no alcanza — un pedido nunca editado
      // tiene modifiedAt null tanto en Laudus como en lo ya guardado, y esa
      // igualdad null===null no debe confundirse con "ya tiene detalle".)
      const pendientes = pedidos.filter(p => {
        const modAt = modifiedAtByOrder.get(p.sales_order_id) ?? null
        const info = existentes.get(p.sales_order_id)
        return !info || !info.tieneDetalle || info.modAt !== modAt
      })
      const aProcesar = pendientes.slice(0, MAX_DETALLE)
      detalleCapeados = Math.max(0, pendientes.length - aProcesar.length)

      const pedidoPorId = new Map(pedidos.map(p => [p.sales_order_id, p]))
      const clienteCache = new Map<number, any>()

      await conPool(aProcesar, CONCURRENCIA_DETALLE, async (p) => {
        const orderFull = await fetchJson(token, `sales/orders/${p.sales_order_id}`)
        const customerId = orderFull?.customer?.customerId
        let clienteFull: any = null
        if (customerId != null) {
          if (clienteCache.has(customerId)) {
            clienteFull = clienteCache.get(customerId)
          } else {
            clienteFull = await fetchJson(token, `sales/customers/${customerId}`).catch(() => null)
            clienteCache.set(customerId, clienteFull)
          }
        }
        const destino = pedidoPorId.get(p.sales_order_id)
        if (destino) {
          destino.detalle = { ...orderFull, customerDetalle: clienteFull }
          detalleFetched++
        }
      })
    } catch (e) {
      // El detalle completo es un enriquecimiento best-effort: si falla, se
      // sigue con la sync normal (columnas ya existentes) sin cortar todo.
      console.error('Detalle completo de pedidos fallo:', (e as Error)?.message ?? e)
    }

    await upsertChunks(supabase, 'laudus_pedidos',         pedidos,     'sales_order_id')
    await upsertChunks(supabase, 'laudus_facturas',        facturas,    'sales_invoice_id')
    await upsertChunks(supabase, 'laudus_guias',           guias,       'sales_waybill_id')
    await upsertChunks(supabase, 'laudus_compras_ordenes', ordenesC,    'purchase_order_id')
    await upsertChunks(supabase, 'laudus_compras_guias',   recepciones, 'purchase_waybill_id')

    const detalle = {
      pedidos: pedidos.length, facturas: facturas.length, guias: guias.length,
      ordenesCompra: ordenesC.length, recepciones: recepciones.length,
      detalleCompleto: { traidos: detalleFetched, capeados: detalleCapeados },
      desde, desdeC, durationMs: Date.now() - t0,
    }
    await supabase.from('laudus_sync_log').insert({ tipo: 'ventas+compras', ok: true, detalle, started_at: started })

    return new Response(JSON.stringify({ ok: true, ...detalle }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    try { await supabase.from('laudus_sync_log').insert({ tipo: 'ventas+compras', ok: false, detalle: { error: msg }, started_at: started }) } catch {}
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
