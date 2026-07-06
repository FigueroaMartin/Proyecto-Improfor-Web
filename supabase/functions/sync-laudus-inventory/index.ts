// supabase/functions/sync-laudus-inventory/index.ts
// Sincroniza el inventario completo (catálogo + stock) desde Laudus ERP a Supabase.
//
// Endpoints Laudus usados:
//   POST /security/login                  -> token
//   POST /production/products/list        -> catálogo (paginado, en paralelo)
//   GET  /production/products/stock       -> stock masivo de TODOS los productos (1 llamada)
//
// Requiere Secrets: LAUDUS_USERNAME, LAUDUS_PASSWORD, LAUDUS_COMPANY_VATID
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const LAUDUS_BASE = 'https://api.laudus.cl'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRODUCT_FIELDS = [
  'productId',
  'sku',
  'description',
  'barCode',
  'productCategory.name',
  'unitOfMeasure',
  'unitPrice',
  'discontinued',
  'customFields.proveedor_',
  'customFields.marca_',
]

const PAGE_LIMIT  = 500   // máximo por página de Laudus
const CONCURRENCY = 6     // páginas en paralelo por ola

async function laudusLogin(): Promise<string> {
  const userName     = Deno.env.get('LAUDUS_USERNAME')
  const password     = Deno.env.get('LAUDUS_PASSWORD')
  const companyVATId = Deno.env.get('LAUDUS_COMPANY_VATID')
  if (!userName || !password || !companyVATId) {
    throw new Error('Faltan los Secrets de Laudus (LAUDUS_USERNAME / LAUDUS_PASSWORD / LAUDUS_COMPANY_VATID).')
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

// Stock masivo de todos los productos en una sola llamada
async function fetchStockMap(token: string): Promise<Map<number, number>> {
  const r = await fetch(`${LAUDUS_BASE}/production/products/stock`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  if (!r.ok) throw new Error(`stock masivo fallo (HTTP ${r.status})`)
  const data = await r.json()
  const map = new Map<number, number>()
  for (const p of data?.products ?? []) {
    map.set(p.productId, Math.round(Number(p.stock) || 0))
  }
  return map
}

async function fetchProductPage(token: string, offset: number): Promise<any[]> {
  const r = await fetch(`${LAUDUS_BASE}/production/products/list`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      fields: PRODUCT_FIELDS,
      orderBy: [{ field: 'sku', direction: 'ASC' }],
      options: { offset, limit: PAGE_LIMIT },
    }),
  })
  if (r.status === 204) return []
  if (!r.ok) {
    let detail = ''
    try { detail = (await r.text()).slice(0, 200) } catch { /* ignore */ }
    throw new Error(`products/list fallo (HTTP ${r.status}) ${detail}`)
  }
  const rows = await r.json()
  return Array.isArray(rows) ? rows : []
}

// Catálogo completo con paginación en paralelo (olas de CONCURRENCY páginas)
async function fetchAllProducts(token: string): Promise<any[]> {
  const all: any[] = []
  let base = 0
  let done = false

  while (!done) {
    const offsets: number[] = []
    for (let i = 0; i < CONCURRENCY; i++) offsets.push(base + i * PAGE_LIMIT)
    base += CONCURRENCY * PAGE_LIMIT

    const pages = await Promise.all(offsets.map((o) => fetchProductPage(token, o)))
    for (const rows of pages) {
      all.push(...rows)
      if (rows.length < PAGE_LIMIT) done = true
    }
    if (all.length > 100000) break   // tope de seguridad
  }
  return all
}

function mapRow(row: any, stockMap: Map<number, number>, syncedAt: string) {
  return {
    laudus_id: row.productId ?? null,
    codigo:    String(row.sku ?? '').trim(),
    nombre:    row.description ?? '',
    stock:     Math.max(0, stockMap.get(row.productId) ?? 0),
    categoria: row.productCategory_name ?? 'General',
    barcode:   row.barCode ? String(row.barCode).trim() : null,
    precio:    row.unitPrice != null ? Number(row.unitPrice) : null,
    unidad:    row.unitOfMeasure ?? null,
    descontinuado: row.discontinued === true,
    proveedor: (row.customFields_proveedor_ || '').trim() || null,
    marca:     (row.customFields_marca_ || '').trim() || null,
    synced_at: syncedAt,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started  = Date.now()
  const syncedAt = new Date().toISOString()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = await laudusLogin()

    // Stock masivo + catálogo (el stock primero, es 1 sola llamada)
    const stockMap = await fetchStockMap(token)
    const rows     = await fetchAllProducts(token)

    // Mapear + descartar SKU vacío / sin laudus_id + de-duplicar por laudus_id
    // (el SKU puede cambiar en Laudus; laudus_id = productId es el id estable)
    const mapped = rows.map((r) => mapRow(r, stockMap, syncedAt))
      .filter((p) => p.codigo.length > 0 && p.laudus_id != null)
    const byId = new Map<number, any>()
    for (const p of mapped) byId.set(p.laudus_id, p)
    const unique = [...byId.values()]

    // Upsert por lotes (conflicto por `laudus_id`; preserva ubicacion/imagenes)
    let upserted = 0
    const CHUNK = 500
    for (let i = 0; i < unique.length; i += CHUNK) {
      const batch = unique.slice(i, i + CHUNK)
      const { error } = await supabase
        .from('productos')
        .upsert(batch, { onConflict: 'laudus_id', ignoreDuplicates: false })
      if (error) throw new Error(`Upsert fallo: ${error.message}`)
      upserted += batch.length
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total: rows.length,
        conStock: stockMap.size,
        productos: unique.length,
        upserted,
        durationMs: Date.now() - started,
        syncedAt,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
