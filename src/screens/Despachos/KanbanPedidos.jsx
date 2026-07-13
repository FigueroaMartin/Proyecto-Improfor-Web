import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './KanbanPedidos.module.css'

// ── Definición de columnas ────────────────────────────────────────────────────
const COLS = [
  { id: 'pendiente',     label: 'Pendientes',    emoji: '⏳', grupo: null },
  { id: 'sin_stock',     label: 'Sin stock',     emoji: '🔴', grupo: 'parciales' },
  { id: 'stock_parcial', label: 'Stock parcial', emoji: '🟡', grupo: 'parciales' },
  { id: 'completo',      label: 'Completos',     emoji: '✅', grupo: null },
]

// Documentos de despacho (elegibles al pasar a "Completos")
const DOCS = [
  { id: 'guia',    label: 'Guía de despacho', emoji: '📄' },
  { id: 'boleta',  label: 'Boleta',           emoji: '🧾' },
  { id: 'factura', label: 'Factura',          emoji: '📑' },
]
// "Salida de bodega" (SV) es otro tipo de documento más, propio del flujo de
// Stock parcial: se usa para separar/reservar productos sin despachar con guía.
const DOC_SALIDA_BODEGA = { id: 'salida_bodega', label: 'Salida de bodega (SV)', emoji: '📤' }
const DOC_LABEL = Object.fromEntries([...DOCS, DOC_SALIDA_BODEGA].map(d => [d.id, d]))

// Recomendación de stock (sugerencia — no decide la columna)
const REC = {
  completo:      { label: 'Stock completo', emoji: '✅' },
  stock_parcial: { label: 'Stock parcial',  emoji: '🟡' },
  sin_stock:     { label: 'Sin stock',      emoji: '🔴' },
  pendiente:     { label: 'Sin productos',  emoji: '⚪' },
}

const fmtFecha = (str) => {
  if (!str) return ''
  const d = new Date(str)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

const fmtPlata = (n) => '$ ' + Math.round(n || 0).toLocaleString('es-CL')

const fechaLocal = (diasAtras = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - diasAtras)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Indicador visual de stock del pedido
function StockBadge({ lines }) {
  const rel   = lines.filter(l => l.sku)
  const full  = rel.filter(l => l.suficiente).length
  const any   = rel.filter(l => l.stock > 0).length
  const total = rel.length
  if (!total) return null
  const pct = Math.round(full / total * 100)
  const color = full === total ? '#1e8a44' : any === 0 ? '#d93025' : '#d97706'
  return (
    <div className={styles.stockBadge} style={{ '--c': color }}>
      <div className={styles.stockBar}>
        <div className={styles.stockFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.stockTxt}>
        {full}/{total} líneas con stock
      </span>
    </div>
  )
}

export default function KanbanPedidos() {
  const [orders,   setOrders]   = useState([])
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState('')
  const [desde,    setDesde]    = useState(fechaLocal(30))
  const [hasta,    setHasta]    = useState(fechaLocal(0))

  // Drag & drop
  const [dragging,  setDragging]  = useState(null)   // salesOrderId
  const [dragOver,  setDragOver]  = useState(null)   // colId

  // Envío a bodega (toda la columna Completos)
  const [enviandoTodos,   setEnviandoTodos]   = useState(false)
  const [msg,             setMsg]             = useState('')      // feedback temporal
  const [mostrarEnviados, setMostrarEnviados] = useState(false)   // toggle: ver fantasmas

  // Modal detalle
  const [detalle, setDetalle] = useState(null)

  // Modal de documento al pasar a "Completos"
  const [docModal, setDocModal] = useState(null)   // { order } | null
  const [docPaso,  setDocPaso]  = useState('doc')  // 'doc' | 'anticipada' | 'listado'

  // Modal ¿se despacha? al pasar a "Stock parcial"
  const [parcialModal, setParcialModal] = useState(null)   // { order } | null

  // Facturas del RUT que NO mueven stock (anticipadas) — se consulta al elegir Factura
  const [factSinStock, setFactSinStock] = useState({ cargando: false, data: null, error: '' })

  const cargar = useCallback(async (d = desde, h = hasta) => {
    setCargando(true)
    setError('')
    try {
      const { data, error: err } = await supabase.functions.invoke('laudus-pedidos-kanban', {
        body: { desde: d, hasta: h },
      })
      if (err) throw err
      if (!data?.ok) throw new Error(data?.error || 'Error al cargar pedidos')
      setOrders(data.orders || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDragStart = (e, salesOrderId) => {
    setDragging(salesOrderId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(salesOrderId))
  }

  const handleDragOver = (e, colId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(colId)
  }

  const handleDragLeave = () => setDragOver(null)

  const handleDrop = (e, colId) => {
    e.preventDefault()
    setDragOver(null)
    const orderId = dragging ?? Number(e.dataTransfer.getData('text/plain'))
    if (!orderId) return
    setDragging(null)
    aplicarMovimiento(orderId, colId)
  }

  const handleDragEnd = () => { setDragging(null); setDragOver(null) }

  // ── Mover pedido a una columna ────────────────────────────────────────────────
  // Si el destino es "Completos", primero preguntamos el documento de despacho.
  // Si el destino es "Stock parcial", preguntamos si se despacha sí/no.
  const aplicarMovimiento = (orderId, colId) => {
    if (colId === 'completo') {
      const order = orders.find(o => o.salesOrderId === orderId)
      setDetalle(null)
      setDocPaso('doc')
      setFactSinStock({ cargando: false, data: null, error: '' })
      setDocModal({ order })
      return
    }
    if (colId === 'stock_parcial') {
      const order = orders.find(o => o.salesOrderId === orderId)
      setDetalle(null)
      setParcialModal({ order })
      return
    }
    persistir(orderId, { columna: colId, documento: null, factura_anticipada: null })
  }

  // Escribe el cambio (optimista + Supabase)
  const persistir = async (orderId, campos) => {
    setOrders(prev => prev.map(o => o.salesOrderId === orderId ? { ...o, ...campos } : o))
    const { error } = await supabase.from('kanban_despacho').upsert(
      { laudus_order_id: orderId, ...campos, updated_at: new Date().toISOString() },
      { onConflict: 'laudus_order_id' }
    )
    if (error) {
      // La escritura falló (ej. constraint de BD) — avisamos y recargamos para
      // que la tarjeta vuelva a reflejar el estado real en vez de quedar
      // mostrando un cambio que en realidad no se guardó.
      window.alert('⚠️ No se pudo guardar el cambio: ' + error.message)
      cargar(desde, hasta)
    }
  }

  // ── Enviar TODA una columna (Completos o Stock parcial) a bodega ─────────────
  // Los pedidos no se van del kanban: pasan a modo fantasma (enviado=true).
  const enviarTodosABodega = async (colId) => {
    const pendientes = orders.filter(o => o.columna === colId && !o.enviado)
    if (!pendientes.length) return
    if (!window.confirm(`¿Enviar ${pendientes.length} pedido${pendientes.length > 1 ? 's' : ''} a bodega?`)) return
    setEnviandoTodos(true)
    let ok = 0
    const errs = []
    for (const o of pendientes) {
      try {
        const { data, error } = await supabase.functions.invoke('laudus-send-to-bodega', {
          body: { salesOrderId: o.salesOrderId, documento: o.documento || null },
        })
        if (error) throw error
        if (!data?.ok) throw new Error(data?.error || 'error')
        setOrders(prev => prev.map(x => x.salesOrderId === o.salesOrderId ? { ...x, enviado: true } : x))
        ok++
      } catch {
        errs.push(o.salesOrderId)
      }
    }
    setEnviandoTodos(false)
    setMsg(`✅ ${ok} pedido${ok !== 1 ? 's' : ''} enviado${ok !== 1 ? 's' : ''} a bodega` +
      (errs.length ? ` · ${errs.length} con error (#${errs.join(', #')})` : ''))
    setTimeout(() => setMsg(''), 6000)
  }

  const cerrarDocModal = () => {
    setDocModal(null)
    setDocPaso('doc')
    setFactSinStock({ cargando: false, data: null, error: '' })
  }

  // Respuesta al modal ¿se despacha? de "Stock parcial"
  // Sí → guía de despacho · No → salida de bodega (SV)
  const responderDespachoParcial = (despachar) => {
    const orderId = parcialModal?.order?.salesOrderId
    if (orderId) {
      persistir(orderId, {
        columna: 'stock_parcial',
        documento: despachar ? 'guia' : 'salida_bodega',
        factura_anticipada: null,
      })
    }
    setParcialModal(null)
  }

  // Elección de documento en el modal de "Completos"
  const elegirDocumento = (doc) => {
    if (doc === 'factura') {
      setDocPaso('anticipada')           // pregunta extra
      buscarFacturasSinStock()           // empieza a traer las facturas del RUT
      return
    }
    // Guía / Boleta: se confirma directo
    const orderId = docModal?.order?.salesOrderId
    if (orderId) persistir(orderId, { columna: 'completo', documento: doc, factura_anticipada: null })
    cerrarDocModal()
  }

  // Consulta a Laudus las facturas del RUT que no mueven stock (anticipadas)
  const buscarFacturasSinStock = async () => {
    const vatId = docModal?.order?.customerVatId
    if (!vatId) { setFactSinStock({ cargando: false, data: { facturas: [] }, error: '' }); return }
    setFactSinStock({ cargando: true, data: null, error: '' })
    try {
      const { data, error } = await supabase.functions.invoke('laudus-facturas-sin-stock', {
        body: { vatId },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Error consultando facturas')
      setFactSinStock({ cargando: false, data, error: '' })
    } catch (e) {
      setFactSinStock({ cargando: false, data: null, error: e.message || String(e) })
    }
  }

  // Tras responder Sí/No: guarda la decisión y muestra el listado de facturas
  const responderAnticipada = (anticipada) => {
    const orderId = docModal?.order?.salesOrderId
    if (orderId) persistir(orderId, { columna: 'completo', documento: 'factura', factura_anticipada: anticipada })
    setDocPaso('listado')
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const porCol = (colId) => orders.filter(o => o.columna === colId)

  return (
    <div className={styles.wrap}>

      {/* ── Filtros de fecha ── */}
      <div className={styles.filtros}>
        <label className={styles.filtroLabel}>
          Desde
          <input type="date" className={styles.fechaInput} value={desde}
            onChange={e => setDesde(e.target.value)} />
        </label>
        <label className={styles.filtroLabel}>
          Hasta
          <input type="date" className={styles.fechaInput} value={hasta}
            onChange={e => setHasta(e.target.value)} />
        </label>
        <button className={styles.btnActualizar}
          onClick={() => cargar(desde, hasta)} disabled={cargando}>
          {cargando ? '⏳' : '↻'} Actualizar
        </button>
        <span className={styles.total}>{orders.length} pedido{orders.length !== 1 ? 's' : ''}</span>
        <label className={styles.toggleEnviados}>
          <input
            type="checkbox"
            checked={mostrarEnviados}
            onChange={e => setMostrarEnviados(e.target.checked)}
          />
          Mostrar pedidos ya enviados a bodega
        </label>
      </div>

      {error && (
        <div className={styles.errorBox}>⚠️ {error}</div>
      )}

      {cargando ? (
        <Spinner text="Cargando pedidos y verificando stock…" />
      ) : (
        <div className={styles.board}>

          {msg && <div className={styles.msgBodega}>{msg}</div>}

          {/* ──────── ENCABEZADOS DE GRUPO ──────── */}
          <div className={styles.groupHeaders}>
            <div className={styles.ghSpacer} />           {/* Pendientes */}
            <div className={`${styles.ghLabel} ${styles.ghParciales}`}>
              ⚠️ Parciales
            </div>
            <div className={styles.ghSpacer} />           {/* Completos */}
          </div>

          {/* ──────── LAS 4 COLUMNAS ──────── */}
          <div className={styles.cols}>
            {COLS.map(col => {
              const lista    = porCol(col.id).filter(o => mostrarEnviados || !o.enviado)
              const isOver   = dragOver === col.id
              const esColEnviable = col.id === 'completo' || col.id === 'stock_parcial'
              const pendientesEnvio = esColEnviable
                ? porCol(col.id).filter(o => !o.enviado).length
                : 0
              return (
                <div
                  key={col.id}
                  className={`${styles.col} ${styles['col_' + col.id]} ${isOver ? styles.colOver : ''}`}
                  onDragOver={e => handleDragOver(e, col.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, col.id)}
                >
                  {/* Header de columna */}
                  <div className={`${styles.colHeader} ${styles['header_' + col.id]}`}>
                    <span>{col.emoji} {col.label}</span>
                    <span className={styles.colCount}>{lista.length}</span>
                  </div>

                  {/* Botón de envío masivo (Completos o Stock parcial) */}
                  {esColEnviable && (
                    <button
                      className={styles.btnEnviarCol}
                      disabled={enviandoTodos || pendientesEnvio === 0}
                      onClick={() => enviarTodosABodega(col.id)}
                    >
                      {enviandoTodos
                        ? 'Enviando…'
                        : pendientesEnvio > 0
                          ? `📦 Enviar a bodega (${pendientesEnvio})`
                          : '✓ Todo enviado'}
                    </button>
                  )}

                  {/* Zona de drop vacía */}
                  {lista.length === 0 && (
                    <div className={`${styles.emptyDrop} ${isOver ? styles.emptyOver : ''}`}>
                      {isOver ? '⬇ Soltar aquí' : 'Sin pedidos'}
                    </div>
                  )}

                  {/* Cards */}
                  {lista.map(o => (
                    <div
                      key={o.salesOrderId}
                      className={`${styles.card} ${styles['card_' + col.id]} ${dragging === o.salesOrderId ? styles.cardDragging : ''} ${o.enviado ? styles.cardGhost : ''}`}
                      draggable={!o.enviado}
                      onDragStart={e => { if (!o.enviado) handleDragStart(e, o.salesOrderId) }}
                      onDragEnd={handleDragEnd}
                      onClick={() => setDetalle(o)}
                      title={o.enviado ? 'Ya enviado a bodega' : 'Arrastrar para mover · Click para ver detalle'}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.numero}>#{o.salesOrderId}</span>
                        <span className={styles.fecha}>{fmtFecha(o.issuedDate)}</span>
                      </div>
                      <span className={styles.cliente}>{o.customer || 'Sin cliente'}</span>
                      <StockBadge lines={o.lines} />
                      <div className={styles.cardFooter}>
                        <span className={styles.monto}>{fmtPlata(o.totalAmount)}</span>
                        <span className={`${styles.recom} ${styles['recom_' + o.stockStatus]}`}>
                          {REC[o.stockStatus]?.emoji} {REC[o.stockStatus]?.label}
                        </span>
                      </div>
                      {esColEnviable && o.documento && (
                        <div className={styles.docBadge}>
                          {DOC_LABEL[o.documento]?.emoji} {DOC_LABEL[o.documento]?.label}
                          {o.documento === 'factura' && (
                            <span className={styles.docAnt}>
                              · {o.factura_anticipada ? 'con anticipada' : 'sin anticipada'}
                            </span>
                          )}
                        </div>
                      )}
                      {o.enviado && (
                        <div className={styles.bodegaTag}>📦 En bodega</div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ MODAL DETALLE ══ */}
      <Modal
        isOpen={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle ? `Pedido #${detalle.salesOrderId}` : ''}
      >
        {detalle && (() => {
          const full  = detalle.lines.filter(l => l.suficiente)
          const part  = detalle.lines.filter(l => !l.suficiente && l.stock > 0)
          const zero  = detalle.lines.filter(l => l.stock === 0)
          return (
            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <span className={styles.cliente}>👤 {detalle.customer || 'Sin cliente'}</span>
                <span className={styles.fecha}>{fmtFecha(detalle.issuedDate)}</span>
              </div>

              {/* Mover desde el modal también */}
              <div className={styles.modalMover}>
                <span className={styles.modalMoverLbl}>Mover a:</span>
                {COLS.filter(c => c.id !== detalle.columna).map(c => (
                  <button key={c.id}
                    className={`${styles.btnMover} ${styles['btnMover_' + c.id]}`}
                    onClick={() => aplicarMovimiento(detalle.salesOrderId, c.id)}
                  >{c.emoji} {c.label}</button>
                ))}
              </div>

              {/* Tabla líneas */}
              <div className={styles.tabla}>
                <div className={`${styles.tRow} ${styles.tHead}`}>
                  <span></span>
                  <span>Producto</span>
                  <span className={styles.tNum}>Pedido</span>
                  <span className={styles.tNum}>Stock</span>
                </div>

                {full.length > 0 && full.map((l, i) => (
                  <div key={`f${i}`} className={`${styles.tRow} ${styles.tOk}`}>
                    <span>✅</span>
                    <div className={styles.tProd}>
                      <span className={styles.tDesc}>{l.desc}</span>
                      <span className={styles.tSku}>{l.sku}</span>
                    </div>
                    <span className={styles.tNum}>{l.qty}</span>
                    <span className={`${styles.tNum} ${styles.tStockOk}`}>{l.stock}</span>
                  </div>
                ))}
                {part.length > 0 && part.map((l, i) => (
                  <div key={`p${i}`} className={`${styles.tRow} ${styles.tWarn}`}>
                    <span>🟡</span>
                    <div className={styles.tProd}>
                      <span className={styles.tDesc}>{l.desc}</span>
                      <span className={styles.tSku}>{l.sku}</span>
                    </div>
                    <span className={styles.tNum}>{l.qty}</span>
                    <span className={`${styles.tNum} ${styles.tStockWarn}`}>{l.stock}</span>
                  </div>
                ))}
                {zero.length > 0 && zero.map((l, i) => (
                  <div key={`z${i}`} className={`${styles.tRow} ${styles.tBad}`}>
                    <span>🔴</span>
                    <div className={styles.tProd}>
                      <span className={styles.tDesc}>{l.desc}</span>
                      <span className={styles.tSku}>{l.sku}</span>
                    </div>
                    <span className={styles.tNum}>{l.qty}</span>
                    <span className={`${styles.tNum} ${styles.tStockBad}`}>0</span>
                  </div>
                ))}
              </div>

              <div className={styles.modalTotal}>
                Total pedido: <strong>{fmtPlata(detalle.totalAmount)}</strong>
              </div>

              <button className="btn-outline" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          )
        })()}
      </Modal>

      {/* ══ MODAL DOCUMENTO DE DESPACHO (al pasar a Completos) ══ */}
      <Modal
        isOpen={!!docModal}
        onClose={cerrarDocModal}
        title={docModal ? `Despacho completo · Pedido #${docModal.order?.salesOrderId}` : ''}
      >
        {docModal && docPaso === 'doc' && (
          <div className={styles.docModalBody}>
            <p className={styles.docPregunta}>¿Con qué documento se va a despachar?</p>
            <div className={styles.docOpciones}>
              {DOCS.map(d => (
                <button
                  key={d.id}
                  className={`${styles.docBtn} ${styles['docBtn_' + d.id]}`}
                  onClick={() => elegirDocumento(d.id)}
                >
                  <span className={styles.docBtnEmoji}>{d.emoji}</span>
                  <span className={styles.docBtnLbl}>{d.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {docModal && docPaso === 'anticipada' && (
          <div className={styles.docModalBody}>
            <p className={styles.docPregunta}>📑 Factura · ¿Existe una factura anticipada?</p>
            <span className={styles.docRut}>
              {docModal.order?.customer} · RUT {docModal.order?.customerVatId || '—'}
            </span>
            <div className={styles.docOpciones}>
              <button className={`${styles.docBtn} ${styles.docBtnSi}`} onClick={() => responderAnticipada(true)}>
                <span className={styles.docBtnEmoji}>✅</span>
                <span className={styles.docBtnLbl}>Sí, existe</span>
              </button>
              <button className={`${styles.docBtn} ${styles.docBtnNo}`} onClick={() => responderAnticipada(false)}>
                <span className={styles.docBtnEmoji}>🚫</span>
                <span className={styles.docBtnLbl}>No existe</span>
              </button>
            </div>
            {factSinStock.cargando && (
              <div className={styles.factAviso}>🔍 Buscando facturas que no mueven stock en este RUT…</div>
            )}
            <button className={styles.docVolver} onClick={() => setDocPaso('doc')}>‹ Volver a elegir documento</button>
          </div>
        )}

        {docModal && docPaso === 'listado' && (() => {
          const f = factSinStock
          const lista = f.data?.facturas || []
          return (
            <div className={styles.docModalBody}>
              <p className={styles.docPregunta}>📑 Facturas que no mueven stock</p>
              <span className={styles.docRut}>
                {docModal.order?.customer} · RUT {docModal.order?.customerVatId || '—'}
              </span>

              {f.cargando && (
                <div className={styles.factAviso}>🔍 Buscando facturas en Laudus…</div>
              )}
              {f.error && (
                <div className={styles.factError}>⚠️ {f.error}</div>
              )}

              {!f.cargando && !f.error && (
                lista.length > 0 ? (
                  <div className={styles.factAlertaBox}>
                    <div className={styles.factAlerta}>
                      ⚠️ Este RUT tiene <strong>{lista.length}</strong> factura{lista.length !== 1 ? 's' : ''} que no mueve{lista.length === 1 ? '' : 'n'} stock
                    </div>
                    <div className={styles.factLista}>
                      {lista.map(fac => (
                        <div key={fac.salesInvoiceId} className={styles.factItem}>
                          <div className={styles.factItemTop}>
                            <span className={styles.factNum}>📄 {fac.docType} {fac.salesInvoiceId}</span>
                            <span className={styles.factFecha}>{fmtFecha(fac.issuedDate)}</span>
                          </div>
                          <div className={styles.factLineas}>
                            {fac.lineasSinStock.map((l, i) => (
                              <span key={i} className={styles.factLinea}>
                                {l.desc || l.sku} <span className={styles.factQty}>×{l.qty}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {f.data?.truncado && (
                      <span className={styles.factTrunc}>Se muestran las más recientes; puede haber más.</span>
                    )}
                  </div>
                ) : (
                  <div className={styles.factVacio}>
                    No se encontraron facturas anticipadas para este cliente.
                  </div>
                )
              )}

              <button className="btn-primary" onClick={cerrarDocModal}>✓ Listo</button>
            </div>
          )
        })()}
      </Modal>

      {/* ══ MODAL ¿SE DESPACHA? (al pasar a Stock parcial) ══ */}
      <Modal
        isOpen={!!parcialModal}
        onClose={() => setParcialModal(null)}
        title={parcialModal ? `Stock parcial · Pedido #${parcialModal.order?.salesOrderId}` : ''}
      >
        {parcialModal && (
          <div className={styles.docModalBody}>
            <p className={styles.docPregunta}>🟡 Stock parcial · ¿Se despacha este pedido?</p>
            <div className={styles.docOpciones}>
              <button className={`${styles.docBtn} ${styles.docBtnSi}`} onClick={() => responderDespachoParcial(true)}>
                <span className={styles.docBtnEmoji}>📄</span>
                <span className={styles.docBtnLbl}>Sí, con guía de despacho</span>
              </button>
              <button className={`${styles.docBtn} ${styles.docBtnNo}`} onClick={() => responderDespachoParcial(false)}>
                <span className={styles.docBtnEmoji}>📤</span>
                <span className={styles.docBtnLbl}>No, salida de bodega (SV)</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
