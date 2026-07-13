// laudus-pedidos-kanban/index.ts  (lee de tablas materializadas)
// Pedidos del kanban admin_pedidos. Lee de laudus_pedidos + productos (stock) +
// kanban_despacho (columna/documento). Los que ya están en bodega NO se filtran:
// vuelven con enviado=true para mostrarlos en modo fantasma.
//
// Body: { desde?: "YYYY-MM-DD", hasta?: "YYYY-MM-DD" }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function fechaLocal(d: Date, offsetDias = 0): string {
  const c = new Date(d)
  c.setDate(c.getDate() + offsetDias)
  return c.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = Date.now()
  try {
    let desde = '', hasta = ''
    try { const b = await req.json(); desde = b?.desde || ''; hasta = b?.hasta || '' } catch {}
    const hoy = new Date()
    if (!desde) desde = fechaLocal(hoy, -30)
    if (!hasta) hasta = fechaLocal(hoy)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const [{ data: pedRows, error: pedErr }, { data: enviados }, { data: kanbanRows }] = await Promise.all([
      supabase.from('laudus_pedidos')
        .select('sales_order_id, issued_date, customer, customer_vatid, items')
        .eq('null_doc', false)
        .gte('issued_date', `${desde}T00:00:00`)
        .lte('issued_date', `${hasta}T23:59:59`)
        .order('sales_order_id', { ascending: false }),
      supabase.from('pedidos').select('laudus_order_id').not('laudus_order_id', 'is', null),
      supabase.from('kanban_despacho').select('laudus_order_id, columna, documento, factura_anticipada'),
    ])
    if (pedErr) throw new Error(pedErr.message)

    const enviadosSet = new Set((enviados || []).map((p: any) => p.laudus_order_id))
    const kmap = new Map((kanbanRows || []).map((r: any) => [r.laudus_order_id, r]))

    const allSkus = [...new Set((pedRows || []).flatMap((p: any) => (p.items || []).map((l: any) => l.sku)).filter(Boolean))]
    const stockMap = new Map<string, number>()
    for (let i = 0; i < allSkus.length; i += 200) {
      const chunk = allSkus.slice(i, i + 200)
      const { data } = await supabase.from('productos').select('codigo, stock').in('codigo', chunk)
      for (const p of data || []) stockMap.set(p.codigo, p.stock ?? 0)
    }

    // "Flete" es el costo de transporte cobrado dentro de la misma factura/
    // boleta, no un producto de inventario — no debe contar para decidir si
    // un pedido tiene stock completo/parcial/sin stock.
    const esFlete = (sku: string) => (sku || '').trim().toLowerCase() === 'flete'

    const orders: any[] = []
    for (const p of pedRows || []) {
      let totalAmount = 0
      let fullLines = 0, anyLines = 0, relevantLines = 0
      const lines = (p.items || []).filter((l: any) => l.sku).map((l: any) => {
        const flete = esFlete(l.sku)
        const stock = flete ? null : (stockMap.get(l.sku) ?? 0)
        const suficiente = flete ? true : stock >= l.qty
        const precio = (Number(l.unitPrice) || 0) * (1 - (Number(l.discount) || 0) / 100)
        totalAmount += precio * l.qty
        if (!flete) {
          relevantLines++
          if (suficiente) fullLines++
          if (stock > 0) anyLines++
        }
        return { sku: l.sku, desc: l.desc, qty: l.qty, precio, stock, suficiente, esFlete: flete }
      })

      let stockStatus: string
      if (relevantLines === 0)    stockStatus = 'pendiente'
      else if (fullLines === relevantLines) stockStatus = 'completo'
      else if (anyLines === 0)    stockStatus = 'sin_stock'
      else                        stockStatus = 'stock_parcial'

      const saved = kmap.get(p.sales_order_id)
      orders.push({
        salesOrderId:  p.sales_order_id,
        issuedDate:    p.issued_date,
        customer:      p.customer || '',
        customerVatId: p.customer_vatid || '',
        totalAmount,
        lines,
        stockStatus,
        columna:            saved?.columna ?? 'pendiente',
        documento:          saved?.documento ?? null,
        factura_anticipada: saved?.factura_anticipada ?? null,
        enviado:            enviadosSet.has(p.sales_order_id),
      })
    }

    orders.sort((a, b) => b.salesOrderId - a.salesOrderId)

    return new Response(JSON.stringify({
      ok: true, desde, hasta,
      fromCache: true,
      durationMs: Date.now() - started,
      orders,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
