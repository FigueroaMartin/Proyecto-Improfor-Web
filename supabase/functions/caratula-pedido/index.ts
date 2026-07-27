// supabase/functions/caratula-pedido/index.ts
// Datos para la carátula de despacho (etiqueta que se pega en las cajas).
// No consulta Laudus en vivo — todo sale de lo ya materializado en Supabase:
//   - pedidos / items_pedido            (tipo_despacho, laudus_order_id)
//   - laudus_pedidos.detalle            (cliente, contacto, OC, transportista)
//   - laudus_guias / laudus_facturas    (el documento real de despacho, si ya existe)
//
// El documento real (folio de guía/boleta/factura) se encuentra cruzando los
// itemId del pedido contra `items[].traceFromId` de guías/facturas emitidas
// (traceFromStep 'O' = viene de un sales order), igual que en laudus-importaciones.
//
// Body: { pedidoId: string }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { pedidoId } = await req.json().catch(() => ({}))
    if (!pedidoId) return new Response(JSON.stringify({ ok: false, error: 'Falta pedidoId' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: pedido, error: errPedido } = await supabase
      .from('pedidos')
      .select('id, numero, cliente, tipo_despacho, carrier, laudus_order_id')
      .eq('id', pedidoId)
      .single()
    if (errPedido || !pedido) {
      return new Response(JSON.stringify({ ok: false, error: 'Pedido no encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    let cliente = pedido.cliente || ''
    let direccion: string | null = null
    let comuna: string | null = null
    let oc: string | null = null
    let transportista = pedido.carrier || null
    let contacto: string | null = null
    let itemIds: number[] = []
    let issuedDate: string | null = null

    if (pedido.laudus_order_id) {
      const { data: lp } = await supabase
        .from('laudus_pedidos')
        .select('items, detalle, issued_date')
        .eq('sales_order_id', pedido.laudus_order_id)
        .maybeSingle()
      if (lp) {
        issuedDate = lp.issued_date
        itemIds = (lp.items || []).map((it: any) => it.itemId).filter((x: any) => x != null)
        const d = lp.detalle
        if (d) {
          cliente = d.customer?.name || cliente
          oc = d.purchaseOrderNumber || null
          transportista = d.carrier?.name || transportista
          const nombreContacto = [d.contact?.firstName, d.contact?.lastName].filter(Boolean).join(' ')
          contacto = nombreContacto || null
          direccion = d.customerDetalle?.address || null
          comuna = d.customerDetalle?.county || null
        }
      }
    }

    // Documento real de despacho (folio), cruzando por itemId — solo si el
    // pedido ya tiene guía/factura emitida en Laudus (sync materializado).
    let docTipo: string | null = null
    let docNumero: string | number | null = null

    if (itemIds.length > 0 && issuedDate) {
      const desde = new Date(issuedDate)
      desde.setDate(desde.getDate() - 3)
      const desdeIso = desde.toISOString()

      if (pedido.tipo_despacho === 'guia') {
        const { data: guias } = await supabase
          .from('laudus_guias')
          .select('sales_waybill_id, items')
          .gte('issued_date', desdeIso)
        const match = (guias || []).find((g: any) =>
          (g.items || []).some((it: any) => it.traceFromStep === 'O' && itemIds.includes(it.traceFromId)))
        if (match) { docTipo = 'Guía de despacho'; docNumero = match.sales_waybill_id }
      } else if (pedido.tipo_despacho === 'boleta' || pedido.tipo_despacho === 'factura') {
        const { data: facturas } = await supabase
          .from('laudus_facturas')
          .select('sales_invoice_id, doc_type, items')
          .gte('issued_date', desdeIso)
        const match = (facturas || []).find((f: any) =>
          (f.items || []).some((it: any) => it.traceFromStep === 'O' && itemIds.includes(it.traceFromId)))
        if (match) { docTipo = match.doc_type || (pedido.tipo_despacho === 'boleta' ? 'Boleta' : 'Factura'); docNumero = match.sales_invoice_id }
      }
      // 'salida_bodega' u otros: sin documento de Laudus, queda en blanco.
    }

    return new Response(JSON.stringify({
      ok: true,
      numero: pedido.numero,
      cliente, direccion, comuna, oc, transportista, contacto,
      tipoDespacho: pedido.tipo_despacho,
      docTipo, docNumero,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
