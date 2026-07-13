// laudus-dispatch-board/index.ts  (Fase 2: lee de tablas materializadas)
// Board de despachos (pedidos con documento emitido). Ya NO llama a Laudus en
// vivo: lee de laudus_pedidos / laudus_facturas / laudus_guias (cron). Mismo formato.
//
// Body opcional: { desde: "YYYY-MM-DD" }  (por defecto, últimos 30 días)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const [{ data: pedRows, error: pedErr }, { data: facRows }, { data: guiaRows }] = await Promise.all([
      supabase.from('laudus_pedidos')
        .select('sales_order_id, issued_date, customer, items')
        .eq('null_doc', false).gte('issued_date', desdeTs)
        .order('sales_order_id', { ascending: false }),
      supabase.from('laudus_facturas')
        .select('sales_invoice_id, doc_type, items')
        .eq('null_doc', false).gte('issued_date', desdeTs),
      supabase.from('laudus_guias')
        .select('sales_waybill_id, items')
        .eq('null_doc', false).gte('issued_date', desdeTs),
    ])
    if (pedErr) throw new Error(pedErr.message)

    const invMap = new Map<number, { qty: number; docType: string; invoiceId: string }>()
    for (const f of facRows || []) for (const it of f.items || []) {
      if (it.traceFromStep !== 'O' || it.traceFromId == null) continue
      const e = invMap.get(it.traceFromId) || { qty: 0, docType: f.doc_type || 'Factura', invoiceId: f.sales_invoice_id }
      e.qty += Number(it.qty) || 0
      invMap.set(it.traceFromId, e)
    }
    const wbMap = new Map<number, { qty: number; waybillId: number }>()
    for (const g of guiaRows || []) for (const it of g.items || []) {
      if (it.traceFromStep !== 'O' || it.traceFromId == null) continue
      const e = wbMap.get(it.traceFromId) || { qty: 0, waybillId: g.sales_waybill_id }
      e.qty += Number(it.qty) || 0
      wbMap.set(it.traceFromId, e)
    }

    // "Flete" es el costo de transporte cobrado en la misma factura/guía, no
    // un producto — se muestra en la línea pero no cuenta para el % de avance.
    const esFlete = (sku: string) => (sku || '').trim().toLowerCase() === 'flete'

    const board: any[] = []
    for (const o of pedRows || []) {
      const items = (o.items || []).map((l: any) => ({ itemId: l.itemId, qty: l.qty, sku: l.sku, desc: l.desc, esFlete: esFlete(l.sku) }))
      let hasDoc = false
      const docLabels = new Set<string>()
      let totalPending = 0
      let completedLines = 0
      const lines = items.map((it: any) => {
        const inv = invMap.get(it.itemId)
        const wb  = wbMap.get(it.itemId)
        const invoicedQty = inv?.qty || 0
        const waybillQty  = wb?.qty || 0
        if (invoicedQty > 0 || waybillQty > 0) hasDoc = true
        if (invoicedQty > 0 && inv?.docType) docLabels.add(inv.docType)
        if (waybillQty > 0) docLabels.add('Guía de despacho')
        const effective = waybillQty > 0 ? waybillQty : invoicedQty
        const pending   = Math.max(0, it.qty - effective)
        if (!it.esFlete) totalPending += pending
        const status = (it.qty > 0 && effective >= it.qty) ? 'complete' : effective > 0 ? 'partial' : 'none'
        if (!it.esFlete && status === 'complete') completedLines++
        return { ...it, invoicedQty, waybillQty, effective, pending, status }
      })
      if (!hasDoc) continue
      const contables = items.filter((i: any) => !i.esFlete)
      const linesContables = lines.filter((l: any) => !l.esFlete)
      const totalQty = contables.reduce((s: number, i: any) => s + i.qty, 0)
      const totalEff = linesContables.reduce((s: number, l: any) => s + Math.min(l.effective, l.qty), 0)
      const pct = totalQty > 0 ? Math.round((totalEff / totalQty) * 100) : 0
      const status = linesContables.length === 0 ? 'none' : linesContables.every((l: any) => l.status === 'complete') ? 'complete' : linesContables.some((l: any) => l.status !== 'none') ? 'partial' : 'none'
      board.push({ salesOrderId: o.sales_order_id, issuedDate: o.issued_date, customer: o.customer, docs: [...docLabels], lines, status, pct, totalPending, completedLines, totalLines: linesContables.length })
    }
    board.sort((a, b) => b.salesOrderId - a.salesOrderId)

    return new Response(JSON.stringify({ ok: true, desde, fromCache: true, count: board.length, durationMs: Date.now() - started, orders: board }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
