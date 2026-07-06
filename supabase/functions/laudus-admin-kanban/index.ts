// supabase/functions/laudus-admin-kanban/index.ts
// Kanban de estado de pedidos para el Jefe de Administración.
// Trae TODOS los pedidos de venta del rango (con o sin documentos), los cruza
// por traceFrom con facturas/boletas/guías y los clasifica en 3 buckets:
//   none    → sin documentos        (⏳ pendiente)
//   partial → parcialmente cubierto (⚠️)
//   done    → completo / despachado (✅)
// Incluye montos: total, cubierto y pendiente (qty × unitPrice × (1 − disc/100)).
//
// Body opcional: { desde: "2026-05-12", hasta: "2026-06-11" }
//   (default: últimos 30 días → hoy). Los documentos se buscan desde `desde`
//   SIN tope superior, para capturar docs emitidos después del pedido.
// Solo lectura sobre Laudus. Requiere Secrets LAUDUS_*.

const LAUDUS_BASE = 'https://api.laudus.cl'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function laudusLogin(): Promise<string> {
  const userName     = Deno.env.get('LAUDUS_USERNAME')
  const password     = Deno.env.get('LAUDUS_PASSWORD')
  const companyVATId = Deno.env.get('LAUDUS_COMPANY_VATID')
  if (!userName || !password || !companyVATId) {
    throw new Error('Faltan los Secrets de Laudus.')
  }
  const r = await fetch(`${LAUDUS_BASE}/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ userName, password, companyVATId }),
  })
  if (!r.ok) throw new Error(`Login en Laudus fallo (HTTP ${r.status})`)
  const data = await r.json()
  if (!data?.token) throw new Error('Laudus no devolvio token.')
  return data.token
}

async function listAll(token: string, path: string, fields: string[], idField: string, filterBy: any[]): Promise<any[]> {
  const LIMIT = 500
  let offset = 0
  const all: any[] = []
  while (true) {
    const r = await fetch(`${LAUDUS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        fields,
        filterBy,
        orderBy: [{ field: idField, direction: 'DESC' }],
        options: { offset, limit: LIMIT },
      }),
    })
    if (r.status === 204) break
    if (!r.ok) throw new Error(`${path} fallo (HTTP ${r.status})`)
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < LIMIT) break
    offset += LIMIT
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = Date.now()
  try {
    let desde = '', hasta = ''
    try { const b = await req.json(); desde = b?.desde || ''; hasta = b?.hasta || '' } catch { /* sin body */ }
    if (!desde) {
      const d = new Date(); d.setDate(d.getDate() - 30)
      desde = d.toISOString().slice(0, 10)
    }
    if (!hasta) hasta = new Date().toISOString().slice(0, 10)

    const fOrders = [
      { field: 'issuedDate', operator: '>=', value: `${desde}T00:00:00` },
      { field: 'issuedDate', operator: '<=', value: `${hasta}T23:59:59` },
    ]
    // Docs: desde la fecha del pedido en adelante (sin tope) para capturar
    // documentos emitidos después del rango del pedido.
    const fDocs = [{ field: 'issuedDate', operator: '>=', value: `${desde}T00:00:00` }]

    const token = await laudusLogin()

    const [orderRows, invoiceRows, waybillRows] = await Promise.all([
      listAll(token, 'sales/orders/list',
        ['salesOrderId', 'issuedDate', 'nullDoc', 'customer.name',
         'items.itemId', 'items.quantity', 'items.product.sku', 'items.product.description',
         'items.unitPrice', 'items.discountPercentage'],
        'salesOrderId', fOrders),
      listAll(token, 'sales/invoices/list',
        ['salesInvoiceId', 'nullDoc', 'docType.name',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesInvoiceId', fDocs),
      listAll(token, 'sales/waybills/list',
        ['salesWaybillId', 'nullDoc',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesWaybillId', fDocs),
    ])

    // Agrupar pedidos (una fila por línea de ítems)
    const ordersMap = new Map<number, any>()
    for (const row of orderRows) {
      if (row.nullDoc) continue
      let o = ordersMap.get(row.salesOrderId)
      if (!o) {
        o = { salesOrderId: row.salesOrderId, issuedDate: row.issuedDate, customer: row.customer_name || '', items: [] }
        ordersMap.set(row.salesOrderId, o)
      }
      o.items.push({
        itemId:    row.items_itemId,
        qty:       Number(row.items_quantity) || 0,
        sku:       row.items_product_sku || '',
        desc:      row.items_product_description || '',
        unitPrice: Number(row.items_unitPrice) || 0,
        disc:      Number(row.items_discountPercentage) || 0,
      })
    }

    // Cobertura por línea con info de documento
    const invMap = new Map<number, any[]>()
    for (const row of invoiceRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      const arr = invMap.get(id) || []
      arr.push({
        qty: Number(row.items_quantity) || 0,
        docId: `F${row.salesInvoiceId}`,
        docName: `${row.docType_name || 'Factura'} ${row.salesInvoiceId}`,
      })
      invMap.set(id, arr)
    }
    const wbMap = new Map<number, any[]>()
    for (const row of waybillRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      const arr = wbMap.get(id) || []
      arr.push({
        qty: Number(row.items_quantity) || 0,
        docId: `G${row.salesWaybillId}`,
        docName: `Guía ${row.salesWaybillId}`,
      })
      wbMap.set(id, arr)
    }

    // Análisis por línea (la guía determina el despacho físico)
    const analyzeItem = (it: any) => {
      const invEntries = invMap.get(it.itemId) || []
      const wbEntries  = wbMap.get(it.itemId)  || []
      const invoicedQty = invEntries.reduce((s, e) => s + e.qty, 0)
      const waybillQty  = wbEntries.reduce((s, e) => s + e.qty, 0)
      const hasWaybill  = waybillQty > 0
      const effective   = hasWaybill ? waybillQty : invoicedQty
      const pending     = Math.max(0, it.qty - effective)
      const pct         = it.qty > 0 ? Math.min(100, (effective / it.qty) * 100) : 0
      let status: string
      if (pct >= 100)   status = hasWaybill ? 'dispatched' : 'complete'
      else if (pct > 0) status = 'partial'
      else              status = 'none'
      const seen = new Set<string>()
      const docs = [...invEntries, ...wbEntries]
        .map(e => ({ id: e.docId, name: e.docName }))
        .filter(d => d.id && !seen.has(d.id) && seen.add(d.id))
      const precio        = it.unitPrice * (1 - it.disc / 100)
      const amount        = it.qty * precio
      const pendingAmount = pending * precio
      return {
        sku: it.sku, desc: it.desc,
        qty: it.qty, effective, pending, pct: Math.round(pct),
        status, hasWaybill, docs,
        amount, pendingAmount,
      }
    }

    const orders: any[] = []
    for (const o of ordersMap.values()) {
      const lines = o.items.map(analyzeItem)
      if (lines.length === 0) continue

      const isDone = (s: string) => s === 'complete' || s === 'dispatched'
      let status: string
      if (lines.every((l: any) => isDone(l.status))) {
        status = lines.some((l: any) => l.hasWaybill) ? 'dispatched' : 'complete'
      } else if (lines.some((l: any) => isDone(l.status) || l.status === 'partial')) {
        status = 'partial'
      } else {
        status = 'none'
      }
      const bucket = isDone(status) ? 'done' : status   // none | partial | done

      const totalQty = lines.reduce((s: number, l: any) => s + l.qty, 0)
      const totalEff = lines.reduce((s: number, l: any) => s + Math.min(l.effective, l.qty), 0)
      const pct = totalQty > 0 ? Math.round((totalEff / totalQty) * 100) : 0

      const totalAmount   = lines.reduce((s: number, l: any) => s + l.amount, 0)
      const pendingAmount = lines.reduce((s: number, l: any) => s + l.pendingAmount, 0)

      const seen = new Set<string>()
      const docs = lines.flatMap((l: any) => l.docs)
        .filter((d: any) => !seen.has(d.id) && seen.add(d.id))
        .map((d: any) => d.name)

      orders.push({
        salesOrderId: o.salesOrderId,
        issuedDate:   o.issuedDate,
        customer:     o.customer,
        status, bucket, pct,
        totalLines: lines.length,
        doneLines:  lines.filter((l: any) => isDone(l.status)).length,
        totalAmount:   Math.round(totalAmount),
        pendingAmount: Math.round(pendingAmount),
        docs,
        lines,
      })
    }

    orders.sort((a, b) => b.salesOrderId - a.salesOrderId)

    return new Response(JSON.stringify({
      ok: true,
      desde, hasta,
      count: orders.length,
      durationMs: Date.now() - started,
      orders,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
