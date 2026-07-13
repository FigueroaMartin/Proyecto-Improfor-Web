// supabase/functions/check-stock-salida-bodega/index.ts
// Chequeo periódico (cron cada 5 min) SOLO contra el stock ya sincronizado en
// Supabase (`productos.stock`) — no llama a Laudus, para no sumar carga a esa
// API. Revisa las "salidas de bodega" (SV) abiertas: si algún producto
// pendiente tiene ahora más stock que el registrado la última vez
// (`items_pedido.stock_referencia`), marca `pedidos.stock_actualizado = true`
// para que la tarjeta del bodeguero muestre el aviso y el botón de
// "Productos separados".
//
// No requiere body ni parámetros.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = Date.now()
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Salidas de bodega abiertas (no cerradas todavía)
    const { data: pedidos, error: pErr } = await supabase
      .from('pedidos')
      .select('id, numero, stock_actualizado')
      .eq('tipo_despacho', 'salida_bodega')
      .neq('estado', 'cerrado')
    if (pErr) throw new Error(pErr.message)
    if (!pedidos || pedidos.length === 0) {
      return new Response(JSON.stringify({ ok: true, revisados: 0, actualizados: 0, durationMs: Date.now() - started }),
        { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const pedidoIds = pedidos.map(p => p.id)
    const { data: items, error: iErr } = await supabase
      .from('items_pedido')
      .select('id, pedido_id, cantidad_pedida, cantidad_despachada, stock_referencia, productos(stock)')
      .in('pedido_id', pedidoIds)
    if (iErr) throw new Error(iErr.message)

    const conMejora = new Set<string>()
    for (const it of items || []) {
      const pendiente = (it.cantidad_pedida ?? 0) - (it.cantidad_despachada ?? 0)
      if (pendiente <= 0) continue
      const stockActual = (it as any).productos?.stock ?? 0
      const referencia = it.stock_referencia ?? 0
      if (stockActual > referencia) conMejora.add(it.pedido_id)
    }

    let actualizados = 0
    const yaMarcados = new Set(pedidos.filter(p => p.stock_actualizado).map(p => p.id))
    const porMarcar = [...conMejora].filter(id => !yaMarcados.has(id))
    if (porMarcar.length > 0) {
      const { error: uErr } = await supabase
        .from('pedidos')
        .update({ stock_actualizado: true })
        .in('id', porMarcar)
      if (uErr) throw new Error(uErr.message)
      actualizados = porMarcar.length
    }

    return new Response(JSON.stringify({
      ok: true, revisados: pedidos.length, actualizados, durationMs: Date.now() - started,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
