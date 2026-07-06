// Funcion de diagnostico desactivada. Se uso durante el desarrollo para
// sondear campos/endpoints de la API de Laudus (probing puntual, manual).
// Queda desactivada (410) para no consumir cuota de la API por accidente.
Deno.serve(() => new Response(JSON.stringify({ disabled: true }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
