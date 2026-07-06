// supabase/functions/laudus-dispatch-board/index.ts
// Tablero de despacho: trae los pedidos de venta de Laudus que YA tienen un
// documento derivado (factura / boleta / guía) y devuelve, por cada uno, el
// estado de cumplimiento por línea (cruce por traceFrom). Solo lectura a Laudus.
//
// Body opcional: { desde: "2026-05-01" }  (por defecto, últimos 30 días)
// Requiere Secrets: LAUDUS_USERNAME, LAUDUS_PASSWORD, LAUDUS_COMPANY_VATID

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

// Lista paginada de un módulo de ventas, filtrada por issuedDate >= desde
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
        filterBy: [{ field: 'issuedDate', operator: '>=', value: desde }],
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
    let desde = ''
    try { const b = await req.json(); desde = b?.desde || '' } catch { /* sin body */ }
    if (!desde) {
      const d = new Date(); d.setDate(d.getDate() - 30)
      desde = d.toISOString().slice(0, 10)
    }
    const desdeTs = `${desde}T00:00:00`

    const token = await laudusLogin()

    const [orderRows, invoiceRows, waybillRows] = await Promise.all([
      listAll(token, 'sales/orders/list',
        ['salesOrderId', 'issuedDate', 'nullDoc', 'customer.name',
         'items.itemId', 'items.quantity', 'items.product.sku', 'items.product.description'],
        'salesOrderId', desdeTs),
      listAll(token, 'sales/invoices/list',
        ['salesInvoiceId', 'nullDoc', 'issuedDate', 'docType.name',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesInvoiceId', desdeTs),
      listAll(token, 'sales/waybills/list',
        ['salesWaybillId', 'nullDoc', 'issuedDate',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesWaybillId', desdeTs),
    ])

    // Agrupar órdenes por salesOrderId
    const ordersMap = new Map<number, any>()
    for (const row of orderRows) {
      if (row.nullDoc) continue
      let o = ordersMap.get(row.salesOrderId)
      if (!o) {
        o = { salesOrderId: row.salesOrderId, issuedDate: row.issuedDate, customer: row.customer_name || '', items: [] }
        ordersMap.set(row.salesOrderId, o)
      }
      o.items.push({
        itemId: row.items_itemId,
        qty:    Number(row.items_quantity) || 0,
        sku:    row.items_product_sku || '',
        desc:   row.items_product_description || '',
      })
    }

    // Cobertura por línea de orden (fromId = itemId de la orden)
    const invMap = new Map<number, { qty: number; docType: string; invoiceId: string }>()
    for (const row of invoiceRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      const e = invMap.get(id) || { qty: 0, docType: row.docType_name || 'Factura', invoiceId: row.salesInvoiceId }
      e.qty += Number(row.items_quantity) || 0
      invMap.set(id, e)
    }
    const wbMap = new Map<number, { qty: number; waybillId: number }>()
    for (const row of waybillRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      const e = wbMap.get(id) || { qty: 0, waybillId: row.salesWaybillId }
      e.qty += Number(row.items_quantity) || 0
      wbMap.set(id, e)
    }

    // Construir tablero (solo órdenes con al menos un documento derivado)
    const board: any[] = []
    for (const o of ordersMap.values()) {
      let hasDoc = false
      const docLabels = new Set<string>()
      let totalPending = 0
      let completedLines = 0

      const lines = o.items.map((it: any) => {
        const inv = invMap.get(it.itemId)
        const wb  = wbMap.get(it.itemId)
        const invoicedQty = inv?.qty || 0
        const waybillQty  = wb?.qty || 0
        if (invoicedQty > 0 || waybillQty > 0) hasDoc = true
        if (invoicedQty > 0 && inv?.docType) docLabels.add(inv.docType)
        if (waybillQty > 0) docLabels.add('Guía de despacho')
        const effective = waybillQty > 0 ? waybillQty : invoicedQty
        const pending   = Math.max(0, it.qty - effective)
        totalPending += pending
        const status = (it.qty > 0 && effective >= it.qty) ? 'complete' : effective > 0 ? 'partial' : 'none'
        if (status === 'complete') completedLines++
        return { ...it, invoicedQty, waybillQty, effective, pending, status }
      })

      if (!hasDoc) continue

      const totalQty = o.items.reduce((s: number, i: any) => s + i.qty, 0)
      const totalEff = lines.reduce((s: number, l: any) => s + Math.min(l.effective, l.qty), 0)
      const pct = totalQty > 0 ? Math.round((totalEff / totalQty) * 100) : 0
      const status = lines.every((l: any) => l.status === 'complete')
        ? 'complete'
        : lines.some((l: any) => l.status !== 'none') ? 'partial' : 'none'

      board.push({
        salesOrderId: o.salesOrderId,
        issuedDate: o.issuedDate,
        customer: o.customer,
        docs: [...docLabels],
        lines,
        status,
        pct,
        totalPending,
        completedLines,
        totalLines: lines.length,
      })
    }

    board.sort((a, b) => b.salesOrderId - a.salesOrderId)

    return new Response(JSON.stringify({
      ok: true,
      desde,
      count: board.length,
      durationMs: Date.now() - started,
      orders: board,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
