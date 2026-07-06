// supabase/functions/laudus-print-docs/index.ts
// Devuelve los PDFs de los documentos (facturas/boletas/guías) derivados de un
// pedido de venta de Laudus, para imprimirlos desde la app de picking al cerrar.
//
//   Body: { laudusOrderId: 41273 }
//   →     { ok, count, docs: [{ id, tipo, nombre, pdfBase64 }] }
//
// Flujo: GET pedido (itemIds) → listar facturas/guías desde la fecha del pedido
// → cruce por traceFrom (fromStep 'O') → GET /{doc}/pdf por cada documento.
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

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = Date.now()
  try {
    let laudusOrderId: number | null = null
    try { const b = await req.json(); laudusOrderId = b?.laudusOrderId ?? null } catch { /* sin body */ }
    if (!laudusOrderId) throw new Error('Falta laudusOrderId en el body.')

    const token = await laudusLogin()
    const HG = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }

    // 1) Pedido completo → itemIds + fecha
    const or = await fetch(`${LAUDUS_BASE}/sales/orders/${laudusOrderId}`, { headers: HG })
    if (!or.ok) throw new Error(`No se pudo leer el pedido ${laudusOrderId} (HTTP ${or.status})`)
    const order = await or.json()
    const itemIds = new Set((order?.items || []).map((it: any) => it.itemId).filter((x: any) => x != null))
    if (itemIds.size === 0) throw new Error('El pedido no tiene líneas.')
    const fechaPedido = String(order?.issuedDate || '').slice(0, 10) || '2000-01-01'
    const desdeTs = `${fechaPedido}T00:00:00`

    // 2) Documentos derivados (cruce por traceFrom)
    const [invoiceRows, waybillRows] = await Promise.all([
      listAll(token, 'sales/invoices/list',
        ['salesInvoiceId', 'nullDoc', 'docType.name', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesInvoiceId', desdeTs),
      listAll(token, 'sales/waybills/list',
        ['salesWaybillId', 'nullDoc', 'items.traceFrom.fromId', 'items.traceFrom.fromStep'],
        'salesWaybillId', desdeTs),
    ])

    const targets: { tipo: string; modulo: string; id: any; nombre: string }[] = []
    const seen = new Set<string>()

    for (const row of invoiceRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      if (!itemIds.has(row.items_traceFrom_fromId)) continue
      const key = `F${row.salesInvoiceId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({
        tipo: row.docType_name || 'Factura',
        modulo: 'sales/invoices',
        id: row.salesInvoiceId,
        nombre: `${row.docType_name || 'Factura'} ${row.salesInvoiceId}`,
      })
    }
    for (const row of waybillRows) {
      if (row.nullDoc || row.items_traceFrom_fromStep !== 'O') continue
      if (!itemIds.has(row.items_traceFrom_fromId)) continue
      const key = `G${row.salesWaybillId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({
        tipo: 'Guía de despacho',
        modulo: 'sales/waybills',
        id: row.salesWaybillId,
        nombre: `Guía ${row.salesWaybillId}`,
      })
    }

    // 3) Descargar el PDF de cada documento
    const docs: any[] = []
    for (const t of targets) {
      try {
        const r = await fetch(`${LAUDUS_BASE}/${t.modulo}/${t.id}/pdf`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/pdf' },
        })
        if (!r.ok) {
          docs.push({ id: t.id, tipo: t.tipo, nombre: t.nombre, error: `HTTP ${r.status}` })
          continue
        }
        const buf = await r.arrayBuffer()
        docs.push({ id: t.id, tipo: t.tipo, nombre: t.nombre, pdfBase64: toBase64(buf) })
      } catch (e) {
        docs.push({ id: t.id, tipo: t.tipo, nombre: t.nombre, error: String((e as Error).message) })
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      laudusOrderId,
      count: docs.filter(d => d.pdfBase64).length,
      durationMs: Date.now() - started,
      docs,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
