// sync-laudus-ventas/index.ts
// Materializa VENTAS (pedidos/facturas/guias) y COMPRAS (ordenes de compra +
// recepciones/goods receipts) de Laudus. Cron lun-vie 9-17:30 hora Chile.
// El cruce compras es a nivel SKU (el /list de recepciones no expone traceFrom).
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
        'salesOrderId', 'issuedDate', 'nullDoc', 'customer.name', 'customer.VATId',
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
    for (const row of orderRows) {
      let o = pedMap.get(row.salesOrderId)
      if (!o) { o = { sales_order_id: row.salesOrderId, issued_date: row.issuedDate || null, customer: row.customer_name || '', customer_vatid: row.customer_VATId || '', null_doc: !!row.nullDoc, items: [], synced_at: nowIso }; pedMap.set(row.salesOrderId, o) }
      if (row.items_itemId != null) o.items.push({ itemId: row.items_itemId, qty: Number(row.items_quantity) || 0, sku: row.items_product_sku || '', desc: row.items_product_description || '', unitPrice: Number(row.items_unitPrice) || 0, discount: Number(row.items_discountPercentage) || 0 })
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

    await upsertChunks(supabase, 'laudus_pedidos',         pedidos,     'sales_order_id')
    await upsertChunks(supabase, 'laudus_facturas',        facturas,    'sales_invoice_id')
    await upsertChunks(supabase, 'laudus_guias',           guias,       'sales_waybill_id')
    await upsertChunks(supabase, 'laudus_compras_ordenes', ordenesC,    'purchase_order_id')
    await upsertChunks(supabase, 'laudus_compras_guias',   recepciones, 'purchase_waybill_id')

    const detalle = { pedidos: pedidos.length, facturas: facturas.length, guias: guias.length, ordenesCompra: ordenesC.length, recepciones: recepciones.length, desde, desdeC, durationMs: Date.now() - t0 }
    await supabase.from('laudus_sync_log').insert({ tipo: 'ventas+compras', ok: true, detalle, started_at: started })

    return new Response(JSON.stringify({ ok: true, ...detalle }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    try { await supabase.from('laudus_sync_log').insert({ tipo: 'ventas+compras', ok: false, detalle: { error: msg }, started_at: started }) } catch {}
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
