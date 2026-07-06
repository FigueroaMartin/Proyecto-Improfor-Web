// laudus-facturas-sin-stock/index.ts
// Dado el RUT (VATId) de un cliente, devuelve sus facturas que tienen al menos
// un ítem que NO mueve stock (moveStock === false) = facturas anticipadas /
// de solo facturación, cuya mercadería aún no salió de bodega.
//
// moveStock solo existe en el GET individual /sales/invoices/{id}, por eso:
//   1) /list filtrando por customer.VATId  (acota al cliente)
//   2) GET de cada factura -> revisar items[].moveStock
//
// Body: { vatId: "14.241.488-0", mesesAtras?: 12 }

const BASE = 'https://api.laudus.cl'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      userName:     Deno.env.get('LAUDUS_USERNAME'),
      password:     Deno.env.get('LAUDUS_PASSWORD'),
      companyVATId: Deno.env.get('LAUDUS_COMPANY_VATID'),
    }),
  })
  if (!r.ok) throw new Error(`Login Laudus fallo (HTTP ${r.status})`)
  const d = await r.json()
  if (!d.token) throw new Error('Laudus no devolvio token')
  return d.token
}

function fechaLocal(d: Date, offMeses = 0): string {
  const c = new Date(d)
  c.setMonth(c.getMonth() - offMeses)
  return c.toISOString().slice(0, 10)
}

const MAX_FACTURAS = 60   // tope de facturas a inspeccionar por cliente
const CHUNK = 6           // GETs en paralelo

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = Date.now()
  try {
    let vatId = '', mesesAtras = 12
    try { const b = await req.json(); vatId = (b?.vatId || '').trim(); mesesAtras = Number(b?.mesesAtras) || 12 } catch {}
    if (!vatId) throw new Error('Falta vatId (RUT del cliente).')

    const token = await login()
    const H = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }

    const desde = fechaLocal(new Date(), mesesAtras)

    // 1) Facturas del cliente (acotadas por RUT y fecha)
    const lr = await fetch(`${BASE}/sales/invoices/list`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        fields: ['salesInvoiceId', 'issuedDate', 'nullDoc', 'docType.name', 'customer.name'],
        filterBy: [
          { field: 'customer.VATId', operator: '=',  value: vatId },
          { field: 'issuedDate',     operator: '>=', value: `${desde}T00:00:00` },
        ],
        orderBy: [{ field: 'salesInvoiceId', direction: 'DESC' }],
        options: { offset: 0, limit: MAX_FACTURAS },
      }),
    })

    let rows: any[] = []
    if (lr.status !== 204) {
      if (!lr.ok) throw new Error(`invoices/list HTTP ${lr.status}`)
      rows = await lr.json()
    }
    const noAnuladas = (rows || []).filter((r: any) => !r.nullDoc)
    const truncado = noAnuladas.length >= MAX_FACTURAS

    // 2) GET de cada factura -> revisar moveStock
    const facturas: any[] = []
    for (let i = 0; i < noAnuladas.length; i += CHUNK) {
      const slice = noAnuladas.slice(i, i + CHUNK)
      const dets = await Promise.all(slice.map(async (r: any) => {
        try {
          const g = await fetch(`${BASE}/sales/invoices/${r.salesInvoiceId}`, { headers: H })
          if (!g.ok) return null
          return { row: r, inv: await g.json() }
        } catch { return null }
      }))

      for (const d of dets) {
        if (!d) continue
        const items = d.inv?.items || []
        const lineasSinStock = items
          .filter((it: any) => it.moveStock === false)
          .map((it: any) => ({
            sku:  it.product?.sku || '',
            desc: it.product?.description || it.itemDescription || '',
            qty:  Number(it.quantity) || 0,
          }))
        if (lineasSinStock.length === 0) continue   // mueve todo el stock: no es anticipada

        facturas.push({
          salesInvoiceId: d.row.salesInvoiceId,
          issuedDate:     d.row.issuedDate,
          docType:        d.row.docType_name || 'Factura',
          total:          d.inv?.totals?.total ?? null,
          lineasSinStock,
          nLineasSinStock: lineasSinStock.length,
          totalLineas:     items.length,
        })
      }
    }

    facturas.sort((a, b) => new Date(b.issuedDate).getTime() - new Date(a.issuedDate).getTime())

    return new Response(JSON.stringify({
      ok: true,
      vatId,
      cliente: noAnuladas[0]?.customer_name || '',
      facturasInspeccionadas: noAnuladas.length,
      conSinStock: facturas.length,
      truncado,
      durationMs: Date.now() - started,
      facturas,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
