// supabase/functions/laudus-importaciones/index.ts
// Análisis de importaciones: extrae las líneas PENDIENTES de todos los pedidos
// de venta de Laudus (cubiertas parcialmente o sin documento), suma la demanda
// por producto y la compara contra el stock actual (tabla productos en Supabase).
//
//   faltante = max(0, demanda pendiente − stock actual)
//
// Devuelve:
//   • pedidos   → pedidos con al menos una línea cuyo producto tiene faltante
//   • productos → cada producto con pendiente / stock / faltante (a importar)
//
// Body opcional: { desde: "2026-04-01" }  (por defecto, últimos 60 días)
// Requiere Secrets: LAUDUS_USERNAME, LAUDUS_PASSWORD, LAUDUS_COMPANY_VATID

import { createClient } from 'jsr:@supabase/supabase-js@2'

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
      const d = new Date(); d.setDate(d.getDate() - 60)
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
        ['salesInvoiceId', 'nullDoc', 'issuedDate',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesInvoiceId', desdeTs),
      listAll(token, 'sales/waybills/list',
        ['salesWaybillId', 'nullDoc', 'issuedDate',
         'items.quantity', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesWaybillId', desdeTs),
    ])

    // Agrupar órdenes
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

    // Cobertura por línea (guía manda; si no hay, factura)
    const invQty = new Map<number, number>()
    for (const row of invoiceRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      invQty.set(id, (invQty.get(id) || 0) + (Number(row.items_quantity) || 0))
    }
    const wbQty = new Map<number, number>()
    for (const row of waybillRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      const id = row.items_traceFrom_fromId
      wbQty.set(id, (wbQty.get(id) || 0) + (Number(row.items_quantity) || 0))
    }

    // Todas las líneas por pedido (para el detalle) + demanda agregada por SKU
    const pendOrders: any[] = []
    const porSku = new Map<string, any>()
    for (const o of ordersMap.values()) {
      const allLines: any[] = []
      let tienePendiente = false
      for (const it of o.items) {
        if (!it.sku) continue   // líneas sin producto (texto libre) no se comparan
        const inv = invQty.get(it.itemId) || 0
        const wb  = wbQty.get(it.itemId)  || 0
        const effective = wb > 0 ? wb : inv
        const pending   = Math.max(0, it.qty - effective)
        allLines.push({ sku: it.sku, desc: it.desc, qty: it.qty, effective, pending })
        if (pending > 0) {
          tienePendiente = true
          const e = porSku.get(it.sku) || { sku: it.sku, desc: it.desc, pendiente: 0, pedidos: new Set<number>() }
          e.pendiente += pending
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
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

    // Productos con faltante (demanda pendiente > stock)
    const productos: any[] = []
    for (const e of porSku.values()) {
      const stock    = stockMap.get(e.sku) ?? 0
      const faltante = Math.max(0, e.pendiente - stock)
      if (faltante > 0) {
        productos.push({
          sku: e.sku, desc: e.desc,
          pendiente: e.pendiente, stock, faltante,
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
      resumen: {
        pedidosConFaltantes: pedidos.length,
        productosFaltantes:  productos.length,
        unidadesFaltantes:   productos.reduce((s, p) => s + p.faltante, 0),
        proveedores:         proveedores.length,
      },
      pedidos,
      productos,
      proveedores,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
