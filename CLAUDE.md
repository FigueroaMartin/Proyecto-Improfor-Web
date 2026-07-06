# Improfor — Panel Web (Admin)

## Stack

- **Frontend:** React 18 + Vite 6, CSS Modules, sin TypeScript, sin librerías de UI
- **Backend:** Supabase JS v2 (auth, DB, realtime, Edge Functions, pg_cron + pg_net)
- **Deploy:** GitHub Pages · `npm run deploy` → rama `gh-pages`
  - URL: `https://martinfigueroaa.github.io/Proyecto-Improfor-Web/`
  - Base path configurado en `vite.config.js`: `base: '/Proyecto-Improfor-Web/'`
  - `vite.config.js` genera un `BUILD_ID` por build (`__BUILD_ID__` + `dist/version.json`) para el banner de actualización
- **Router:** React Router v6 con `<BrowserRouter basename="/Proyecto-Improfor-Web">`
- **ERP:** Laudus REST API — la mayoría de las pantallas ya **NO llaman a Laudus en vivo**: leen de tablas materializadas en Supabase, sincronizadas por cron. Ver sección "Materialización".

---

## ⚠️ Estado del repositorio

El repo solo tiene el commit inicial (`git log` → 1 commit). Todo el trabajo de sesiones posteriores vivía sin commitear hasta que se hizo el commit de puesta al día. **Commitear seguido** — no hay red de seguridad si se pierde la carpeta local.

Algunas Edge Functions se desplegaron directo a Supabase (vía MCP) sin pasar por archivo local en su momento; ya están todas bajadas a `supabase/functions/` — mantenerlas ahí sincronizadas manualmente si se editan desde el dashboard de Supabase.

---

## Estructura de directorios

```
src/
  App.jsx                      — rutas protegidas por RequireAuth + <ActualizacionBanner/>
  roles.js                     — catálogo de roles y sus pantallas
  main.jsx
  lib/supabase.js              — cliente Supabase (anon key, pública)
  db/index.js                  — queries Supabase (productos, pedidos, bodegueros)
  styles/global.css            — variables CSS globales y clases de utilidad
  components/
    Header/                    — header con botón de volver
    Modal/                     — modal genérico con overlay
    Spinner/                   — spinner de carga con texto
    ActualizacionBanner/       — detecta build nuevo (version.json) y ofrece recargar
  screens/
    SeleccionPerfil/           — login por perfil (guarda en localStorage)
    Dashboard/                 — cards de navegación filtradas por rol
    Despachos/
      index.jsx                 — board 2 columnas (roles != admin_pedidos)
      KanbanPedidos.jsx          — kanban 4 columnas (admin_pedidos): Pendientes/Parcial/Completos
    EstadoPedidos/              — kanban 4 columnas de pedidos Laudus (jefe_admin)
    Importaciones/               — análisis de faltantes 3 columnas + proveedores + "en tránsito"
    Inventario/                  — catálogo de productos read-only con búsqueda
    Pedidos/
      index.jsx                 — listado clásico (roles != bodega)
      KanbanBodega.jsx           — kanban 4 columnas (bodega): Activos → Starken/Transportistas/Cliente retira

supabase/functions/
  sync-laudus-inventory/       — sincroniza ~15k productos Laudus → tabla productos (manual, botón)
  sync-laudus-ventas/          — MATERIALIZA ventas+compras Laudus → tablas laudus_* (cron 2x/día)
  laudus-dispatch-board/       — board clásico de despachos (lee tablas materializadas)
  laudus-send-to-bodega/       — crea entrada en tabla pedidos al enviar a bodega (GET vivo a Laudus, 1 orden)
  laudus-importaciones/        — análisis de faltantes + "en tránsito" (lee tablas materializadas)
  laudus-admin-kanban/         — datos del kanban de estado de pedidos (lee tablas materializadas)
  laudus-pedidos-kanban/       — datos del kanban admin_pedidos en Despachos (lee tablas materializadas)
  laudus-facturas-sin-stock/   — detecta facturas anticipadas (moveStock) por RUT — VIVO, GET por factura
  laudus-print-docs/           — PDFs base64 de docs de un pedido (VIVO)
  laudus-probe/                — sonda de diagnóstico, DESACTIVADA (devuelve 410)
```

---

## Autenticación / Roles

No hay auth de Supabase. El login es por selección de perfil:
- Se guarda en `localStorage.admin_activo` (`{ id, nombre, rol }`).
- `RequireAuth` en App.jsx redirige a `/` si no hay perfil.
- El Dashboard filtra las cards según `ROLES[rol].pantallas`.
- Algunas pantallas cambian de componente según el rol (ver abajo), no solo de visibilidad.

### Roles definidos (`src/roles.js`)

| Rol | Label | Pantallas |
|-----|-------|-----------|
| `admin_pedidos` | Administrador de pedidos | despachos (→ Kanban gestión), inventario, pedidos |
| `admin_importaciones` | Administrador de importaciones | importaciones, inventario |
| `jefe_admin` | Jefe de administración | estado_pedidos, importaciones, despachos, inventario, pedidos |
| `bodega` | Bodega | pedidos (→ Kanban bodega), inventario |

---

## Pantallas

### `/despachos` — Despachos
**Si `rol === 'admin_pedidos'` → `KanbanPedidos.jsx`** (kanban de gestión):
- 3 columnas base: **Pendientes** → **Parcial** (dividida en Sin stock / Stock parcial visualmente) → **Completos**.
- Todo pedido nuevo arranca en Pendientes; el admin decide arrastrar según su propio criterio (hay una recomendación de stock, pero no auto-clasifica).
- Al mover a **Completos**: modal obligatorio → elegir documento (Guía / Boleta / Factura). Si es Factura → pregunta "¿existe factura anticipada?" y **consulta `laudus-facturas-sin-stock`** (vivo) para avisar si el RUT tiene facturas que no mueven stock.
- Botón de columna **"Enviar a bodega (N)"** en Completos: envía todos de una vez vía `laudus-send-to-bodega`. Los enviados quedan en modo **fantasma** (atenuados, no arrastrables) dentro de la misma columna, con toggle "Mostrar pedidos ya enviados a bodega" para ocultarlos/mostrarlos.
- Persistencia de columna/documento en tabla `kanban_despacho`.

**Otros roles → `index.jsx`** (board clásico 2 columnas, vía `laudus-dispatch-board`):
- ⏳ Pendientes por enviar / 📦 Activos en bodega. Filtro de fecha (default hoy).

### `/estado-pedidos` — Estado de Pedidos *(solo jefe_admin)*
Kanban de 4 columnas (vía `laudus-admin-kanban`), carga automática al entrar:
- ⏳ Pendientes (rojo) / ⚠️ Parcial (naranja) / ✅ Emitidos (azul) / 📦 Despachados (verde — el picker cerró el pedido en la app móvil).
- 5 KPIs, filtro de fechas, buscador, chips de estado, export CSV, modal de detalle línea a línea.

### `/importaciones` — Importaciones *(admin_importaciones, jefe_admin)*
3 columnas (vía `laudus-importaciones`, lee tablas materializadas):
- 📦 Pedidos con faltantes / 🛒 Productos a importar / 🚢 Por proveedor (acordeón).
- Cada producto muestra **Pendiente, Stock y 🚢 En tránsito** — el "en tránsito" descuenta órdenes de compra abiertas aún no recibidas (cruce a nivel SKU contra `laudus_compras_ordenes` / `laudus_compras_guias`, ver Materialización).
- Buscador por columna, resumen de stats, filtro de fechas.

### `/inventario` — Inventario
Catálogo read-only sincronizado desde Laudus (`sync-laudus-inventory`, botón manual):
- Búsqueda server-side debounced (350 ms), cap de 100 resultados.
- Toggles: "Solo con stock" (`stock > 0`) y "Ver descontinuados".
- Realtime debounced (1500 ms).

### `/pedidos` — Pedidos
**Si `rol === 'bodega'` → `KanbanBodega.jsx`**:
- 4 columnas: 📋 **Activos** → 📦 **Starken** / 🚚 **Transportistas** / 🙋 **Cliente retira**.
- Clasificación automática al cerrar un pedido, según el campo `carrier` capturado por `laudus-send-to-bodega` al enviarlo (`Starken` → Starken, `Cliente Retira` → Cliente retira, cualquier otro/vacío → Transportistas).
- Badges de color por destino: Starken verde, Transportistas naranja, Cliente retira azul. Diseñada **mobile-first** — es el prototipo de lo que luego se replica en la app móvil (ver Notas de producto).

**Otros roles → `index.jsx`**: listado clásico con tabs Activos/Cerrados y modal de detalle.

---

## Materialización de Laudus (Fase 1 y 2 — completa)

Para evitar que cada carga de pantalla le pegue a Laudus en vivo (8-20s por consulta, rate limit ~2000/mes), se materializan los datos en tablas Supabase, refrescadas por cron:

- **`sync-laudus-ventas`**: trae ventas (pedidos/facturas/guías, 90 días) y compras (órdenes + recepciones/goods receipts, 365 días) → upsert en tablas `laudus_*`.
- **Cron**: `pg_cron` job `sync-laudus-ventas-30min` (nombre histórico, ya no corre cada 30 min) → **2 veces al día, lun-vie, 09:00 y 16:00 hora Chile** (`0 12,13,19,20 * * *` en UTC + guard `America/Santiago` que filtra a esas horas exactas y absorbe el cambio de horario). Consumo estimado ~350 llamadas/mes.
- Las pantallas (`laudus-pedidos-kanban`, `laudus-admin-kanban`, `laudus-importaciones`, `laudus-dispatch-board`) leen de las tablas, no de Laudus — responden en ~1-3s en vez de 8-20s.
- **Siguen en vivo** (a propósito, no materializadas): `laudus-facturas-sin-stock` (moveStock solo existe en el GET individual de cada factura) y `laudus-print-docs` (PDFs on-demand).
- **Goods receipts**: el endpoint real es `purchases/waybills` (no `goodsReceipts`), ID `purchaseWaybillId`. El `traceFrom` línea-a-línea **no está disponible en `/list`** (solo en el GET individual) → el cruce compras↔ventas para "en tránsito" es **a nivel SKU**, no línea por línea (conservador: nunca subestima el faltante).
- Para refrescar fuera de horario: invocar `sync-laudus-ventas` manualmente (no hay botón en la UI todavía).

---

## Supabase — Tablas relevantes

| Tabla | Uso |
|-------|-----|
| `productos` | Catálogo sincronizado desde Laudus. `laudus_id` (único, estable), `codigo` (SKU, no único), `barcode`, `stock`, `proveedor`, `marca`, `descontinuado`. |
| `pedidos` | Pedidos internos Improfor (bandeja de bodega). `laudus_order_id` vincula con Laudus. `carrier` (transportista, capturado al enviar a bodega). Estados: `pendiente → en_proceso → cerrado`. |
| `items_pedido` | Líneas de cada pedido. |
| `bodegueros` | Usuarios/perfiles (ambas apps) con su `rol`. |
| `kanban_despacho` | Persistencia del kanban admin_pedidos: `laudus_order_id`, `columna`, `documento`, `factura_anticipada`. |
| `laudus_pedidos` | Pedidos de venta Laudus materializados (`sales_order_id`, `customer`, `customer_vatid`, `items` jsonb). |
| `laudus_facturas` | Facturas de venta materializadas (`sales_invoice_id`, `items` jsonb con traceFrom). |
| `laudus_guias` | Guías de despacho de venta materializadas. |
| `laudus_compras_ordenes` | Órdenes de compra materializadas (`purchase_order_id`, `archived`, `items` jsonb). |
| `laudus_compras_guias` | Recepciones/goods receipts materializadas (`purchase_waybill_id`, `items` jsonb, sin traceFrom). |
| `laudus_sync_log` | Bitácora de cada corrida del sync (ok/error, conteos, duración). |

🔴 **RLS deshabilitado en las 11 tablas** — pendiente de activar. Cualquiera con la anon key puede leer/escribir todo. Ver "Seguridad".

---

## API Laudus — Referencia rápida

**Base URL:** `https://api.laudus.cl`

Headers obligatorios en **cada** request:
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json   ← sin esto devuelve CSV
```

Endpoints confirmados:
- `POST /security/login` → token
- `POST /production/products/list` → productos
- `GET  /production/products/stock` → `{ products: [{productId, sku, stock}] }`
- `POST /sales/orders/list` · `POST /sales/invoices/list` · `POST /sales/waybills/list`
- `GET  /sales/orders/{id}` → detalle del pedido (incluye `carrier.name`, `customer.VATId` — NO disponibles en `/list`)
- `GET  /sales/invoices/{id}` → detalle (incluye `items[].moveStock` — NO disponible en `/list`)
- `GET  /sales/invoices/{id}/pdf` / `GET /sales/waybills/{id}/pdf` → PDF binario
- `POST /purchases/orders/list` → órdenes de compra (`purchaseOrderId`, `supplier.name`, `archived`)
- `POST /purchases/waybills/list` → recepciones / **goods receipts** (`purchaseWaybillId`) — el `/list` NO expone `traceFrom`, solo el GET individual

Campos custom confirmados (dot-notation en request, underscore en respuesta):
- `customFields.proveedor_` → `customFields_proveedor_`
- `customFields.marca_` → `customFields_marca_`

Cruce pedido → documentos (ventas):
```
items_traceFrom_fromStep === "O"   (O = Order)
items_traceFrom_fromId  === pedido.items_itemId
```
Cruce análogo en compras usa `fromStep === "2"`, pero no accesible vía `/list` (ver Materialización).

RUT del cliente = `customer.VATId` (ej. `"22.660.795-1"`). Filtra en `/list` con `{ field: 'customer.VATId', operator: '=', value: vatId }`.

HTTP 204 = sin resultados → tratar como `[]`, no como error.

---

## Seguridad

- `.env` en `.gitignore`. **Nunca en git.**
- Supabase anon key es pública (solo lectura con RLS — pero RLS está deshabilitado, ver arriba).
- Credenciales Laudus **solo** como Secrets de Edge Function. Nunca en cliente ni en git.
- RLS en Supabase: **pendiente de activar** en las 11 tablas públicas.
- El rate limit de Laudus (~2000 llamadas/mes) es la razón del cron 2x/día — no aumentar la frecuencia sin revisar el consumo.

---

## Comandos

```bash
# Desarrollo
npm run dev

# Build + deploy a GitHub Pages
npm run deploy

# Deploy Edge Function (desde supabase/functions/<nombre>/)
supabase functions deploy <nombre> --no-verify-jwt
```
