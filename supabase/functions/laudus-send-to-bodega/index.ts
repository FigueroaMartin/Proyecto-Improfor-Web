// supabase/functions/laudus-send-to-bodega/index.ts
// Pasa un pedido de venta de Laudus a bodega: crea un `pedido` + `items_pedido`
// en Supabase a partir de la orden de Laudus. Mapea cada línea a productos.id
// por `laudus_id`. Evita duplicados con `pedidos.laudus_order_id`.
//
// Body: { salesOrderId: number, documento?: string, dryRun?: boolean }
//   documento: 'guia' | 'boleta' | 'factura' | 'salida_bodega' (SV) — se guarda
//   en pedidos.tipo_despacho para que bodega distinga salidas sin venta.
// Requiere Secrets: LAUDUS_USERNAME, LAUDUS_PASSWORD, LAUDUS_COMPANY_VATID

import { createClient } from 'jsr:@supabase/supabase-js@2'

const LAUDUS_BASE = 'https://api.laudus.cl'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function laudusLogin(): Promise<string> {
  const userName     = Deno.env.get('LAUDUS_USERNAME')
  const password     = Deno.env.get('LAUDUS_PASSWORD')
  const companyVATId = Deno.env.get('LAUDUS_COMPANY_VATID')
  if (!userName || !password || !companyVATId) throw new Error('Faltan los Secrets de Laudus.')
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const salesOrderId = Number(body?.salesOrderId)
    const dryRun = body?.dryRun === true
    const documento = typeof body?.documento === 'string' ? body.documento : null
    if (!salesOrderId) return json({ ok: false, error: 'Falta salesOrderId' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ¿Ya fue enviado a bodega?
    const { data: existing } = await supabase
      .from('pedidos').select('id, numero, estado')
      .eq('laudus_order_id', salesOrderId).maybeSingle()
    if (existing && !dryRun) {
      return json({ ok: true, already: true, pedidoId: existing.id, numero: existing.numero, estado: existing.estado })
    }

    // Traer la orden completa de Laudus
    const token = await laudusLogin()
    const r = await fetch(`${LAUDUS_BASE}/sales/orders/${salesOrderId}`, {
      method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    })
    if (!r.ok) throw new Error(`No se pudo leer la orden (HTTP ${r.status})`)
    const order = await r.json()

    const cliente   = order?.customer?.name || ''
    const carrier   = order?.carrier?.name || null   // transportista: Starken / Cliente Retira / otro
    const itemsRaw  = Array.isArray(order?.items) ? order.items : []

    // Mapear líneas a productos.id por laudus_id (productId de Laudus)
    const productIds = [...new Set(itemsRaw.map((i: any) => i?.product?.productId).filter((x: any) => x != null))]
    const idMap = new Map<number, string>()
    if (productIds.length > 0) {
      const { data: prods, error: pErr } = await supabase
        .from('productos').select('id, laudus_id').in('laudus_id', productIds)
      if (pErr) throw new Error(pErr.message)
      for (const p of prods || []) idMap.set(p.laudus_id, p.id)
    }

    const items: { producto_id: string; cantidad_pedida: number }[] = []
    const skipped: any[] = []
    for (const it of itemsRaw) {
      const qty = Number(it?.quantity) || 0
      const sku = it?.product?.sku || ''
      // "Flete" es el costo de transporte cobrado dentro de la misma factura/
      // boleta, no un producto físico — aunque exista como fila en `productos`
      // (se sincroniza desde Laudus como cualquier ítem), no debe ir a bodega
      // como algo para separar.
      if (sku.trim().toLowerCase() === 'flete') {
        skipped.push({ sku, desc: it?.itemDescription || '', qty, motivo: 'flete (costo de transporte, no es producto a separar)' })
        continue
      }
      const pid = it?.product?.productId
      const prodId = pid != null ? idMap.get(pid) : null
      if (!prodId || qty <= 0) {
        skipped.push({ sku: sku || null, desc: it?.itemDescription || '', qty,
          motivo: !prodId ? 'no es producto de inventario' : 'cantidad 0' })
        continue
      }
      items.push({ producto_id: prodId, cantidad_pedida: qty })
    }

    if (items.length === 0) {
      return json({ ok: false, error: 'La orden no tiene líneas de productos de inventario.', skipped }, 422)
    }

    if (dryRun) {
      return json({ ok: true, dryRun: true, salesOrderId, cliente, carrier, documento, items: items.length, skipped })
    }

    // Crear pedido + ítems
    const { data: pedido, error: peErr } = await supabase
      .from('pedidos')
      .insert({
        numero: `LAU-${salesOrderId}`,
        cliente,
        notas: `Orden Laudus #${salesOrderId}`,
        estado: 'pendiente',
        laudus_order_id: salesOrderId,
        carrier,
        tipo_despacho: documento,
      })
      .select().single()
    if (peErr) throw new Error(peErr.message)

    const rows = items.map((it) => ({ pedido_id: pedido.id, ...it }))
    const { error: iErr } = await supabase.from('items_pedido').insert(rows)
    if (iErr) throw new Error(iErr.message)

    return json({ ok: true, pedidoId: pedido.id, numero: pedido.numero, carrier, documento, items: items.length, skipped })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500)
  }
})
