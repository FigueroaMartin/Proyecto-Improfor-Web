import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { getPedidos } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './EstadoPedidos.module.css'

const BUCKETS = {
  none:       { label: 'Pendientes',  emoji: '⏳', cls: 'colNone'       },
  partial:    { label: 'Parcial',     emoji: '⚠️', cls: 'colPartial'    },
  done:       { label: 'Emitidos',    emoji: '✅', cls: 'colDone'       },
  despachado: { label: 'Despachados', emoji: '📦', cls: 'colDespachado' },
}
const ORDEN_COLS = ['none', 'partial', 'done', 'despachado']

const ESTADO_PILL = {
  none:       { label: 'Pendiente',  cls: 'pillNone'    },
  partial:    { label: 'Parcial',    cls: 'pillPartial' },
  complete:   { label: 'Emitido',    cls: 'pillDone'    },
  dispatched: { label: 'Emitido c/guía', cls: 'pillDone' },
}

const LINEA_ICON = { none: '⏳', partial: '⚠️', complete: '✅', dispatched: '✅' }

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

export default function EstadoPedidos() {
  const [desde,    setDesde]    = useState(fechaLocal(30))
  const [hasta,    setHasta]    = useState(fechaLocal(0))
  const [orders,   setOrders]   = useState(null)
  const [despachados, setDespachados] = useState(new Set())   // laudus_order_id cerrados en bodega
  const [cargando, setCargando] = useState(false)
  const [error,    setError]    = useState('')

  const [q,        setQ]        = useState('')
  const [filtro,   setFiltro]   = useState('todos')   // todos | none | partial | done | despachado
  const [orden,    setOrden]    = useState('fecha')
  const [detalle,  setDetalle]  = useState(null)

  // Set de pedidos de venta Laudus cerrados por el picker (tabla pedidos de Improfor)
  const refrescarDespachados = useCallback(async () => {
    try {
      const peds = await getPedidos()
      setDespachados(new Set(
        peds.filter(p => p.estado === 'cerrado' && p.laudus_order_id != null)
            .map(p => p.laudus_order_id)
      ))
    } catch { /* deja el set como estaba */ }
  }, [])

  useEffect(() => {
    refrescarDespachados()
    // Realtime: cuando el bodeguero cierra un pedido, la card salta a Despachados
    const ch = supabase
      .channel('estado-pedidos-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
        () => refrescarDespachados()
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [refrescarDespachados])

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const [res] = await Promise.all([
        supabase.functions.invoke('laudus-admin-kanban', { body: { desde, hasta } }),
        refrescarDespachados(),
      ])
      if (res.error) throw res.error
      if (!res.data?.ok) throw new Error(res.data?.error || 'Error al cargar pedidos')
      setOrders(res.data.orders || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  // Cargar automáticamente al entrar (la vista existe aunque no haya pedidos)
  useEffect(() => { cargar() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Bucket efectivo: si el picker lo cerró, va a Despachados (sobre cualquier estado de documentos)
  const effBucket = (o) => despachados.has(o.salesOrderId) ? 'despachado' : o.bucket

  // ── Filtro + orden en memoria ──
  const filtrados = (orders || []).filter(o =>
    !q ||
    String(o.salesOrderId).includes(q.trim()) ||
    (o.customer || '').toLowerCase().includes(q.trim().toLowerCase())
  )

  const ordenar = (lista) => {
    const copia = [...lista]
    if (orden === 'pendiente') copia.sort((a, b) => b.pendingAmount - a.pendingAmount)
    else if (orden === 'cliente') copia.sort((a, b) => (a.customer || '').localeCompare(b.customer || ''))
    else copia.sort((a, b) => new Date(b.issuedDate) - new Date(a.issuedDate))
    return copia
  }

  const porBucket = (bucket) => ordenar(filtrados.filter(o => effBucket(o) === bucket))

  // ── KPIs ──
  const kpis = (() => {
    const all = orders || []
    const none    = all.filter(o => effBucket(o) === 'none')
    const partial = all.filter(o => effBucket(o) === 'partial')
    const done    = all.filter(o => effBucket(o) === 'done')
    const desp    = all.filter(o => effBucket(o) === 'despachado')
    const riesgo  = [...none, ...partial].reduce((s, o) => s + o.pendingAmount, 0)
    return {
      none: none.length,
      noneMonto: none.reduce((s, o) => s + o.pendingAmount, 0),
      partial: partial.length,
      partialMonto: partial.reduce((s, o) => s + o.pendingAmount, 0),
      done: done.length,
      desp: desp.length,
      riesgo,
    }
  })()

  // ── Exportar CSV ──
  const exportarCSV = () => {
    const sep = ';'
    const filas = [['N° Pedido', 'Fecha', 'Cliente', 'Estado', '% Cubierto', 'Monto Total', 'Monto Pendiente']]
    for (const o of ordenar(filtrados)) {
      const b = effBucket(o)
      filas.push([
        o.salesOrderId,
        fmtFecha(o.issuedDate),
        o.customer || '',
        BUCKETS[b].label,
        o.pct + '%',
        Math.round(o.totalAmount),
        Math.round(o.pendingAmount),
      ])
    }
    const csv = '﻿' + filas
      .map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(sep))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `estado-pedidos_${desde}_a_${hasta}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const columnasVisibles = filtro === 'todos' ? ORDEN_COLS : [filtro]

  return (
    <div className="page">
      <Header title="Estado de Pedidos" showBack />

      <div className={styles.container}>

        {/* ── Filtros de fecha ── */}
        <div className={styles.filtros}>
          <label className={styles.filtroLabel}>
            Desde
            <input type="date" className={styles.fechaInput} value={desde} onChange={e => setDesde(e.target.value)} />
          </label>
          <label className={styles.filtroLabel}>
            Hasta
            <input type="date" className={styles.fechaInput} value={hasta} onChange={e => setHasta(e.target.value)} />
          </label>
          <button className={styles.btnActualizar} onClick={cargar} disabled={cargando}>
            {cargando ? '⏳ Cargando…' : '↻ Actualizar'}
          </button>
          {orders && (
            <button className={styles.btnCsv} onClick={exportarCSV} title="Descargar CSV del listado filtrado">
              ⬇️ Exportar CSV
            </button>
          )}
        </div>

        {error && (
          <div className="empty-state"><div className="emoji">⚠️</div><p>{error}</p></div>
        )}

        {cargando && !orders ? (
          <Spinner text="Cruzando pedidos con facturas y guías…" />
        ) : (
          <>
            {orders && orders.length === 0 && (
              <p className={styles.sinPedidos}>
                No hay pedidos en el período seleccionado. Ajustá las fechas y presioná Actualizar.
              </p>
            )}

            {/* ── KPIs ── */}
            <div className={styles.kpis}>
              <div className={`${styles.kpi} ${styles.kpiNone}`}>
                <span className={styles.kpiNum}>{kpis.none}</span>
                <span className={styles.kpiLbl}>Pendientes</span>
                <span className={styles.kpiSub}>{fmtPlata(kpis.noneMonto)} sin emitir</span>
              </div>
              <div className={`${styles.kpi} ${styles.kpiPartial}`}>
                <span className={styles.kpiNum}>{kpis.partial}</span>
                <span className={styles.kpiLbl}>Parciales</span>
                <span className={styles.kpiSub}>{fmtPlata(kpis.partialMonto)} pendiente</span>
              </div>
              <div className={`${styles.kpi} ${styles.kpiDone}`}>
                <span className={styles.kpiNum}>{kpis.done}</span>
                <span className={styles.kpiLbl}>Emitidos</span>
                <span className={styles.kpiSub}>doc. emitido, sin cerrar</span>
              </div>
              <div className={`${styles.kpi} ${styles.kpiDesp}`}>
                <span className={styles.kpiNum}>{kpis.desp}</span>
                <span className={styles.kpiLbl}>Despachados</span>
                <span className={styles.kpiSub}>cerrados en bodega</span>
              </div>
              <div className={`${styles.kpi} ${styles.kpiRiesgo}`}>
                <span className={styles.kpiNum}>{fmtPlata(kpis.riesgo)}</span>
                <span className={styles.kpiLbl}>Monto en riesgo</span>
                <span className={styles.kpiSub}>pendiente de despacho</span>
              </div>
            </div>

            {/* ── Búsqueda / filtro / orden ── */}
            <div className={styles.toolbar}>
              <input
                className={styles.search}
                placeholder="🔍 Buscar cliente o N° de pedido…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              <div className={styles.chips}>
                {[['todos', 'Todos'], ['none', '⏳'], ['partial', '⚠️'], ['done', '✅'], ['despachado', '📦']].map(([k, lbl]) => (
                  <button
                    key={k}
                    className={`${styles.chip} ${filtro === k ? styles.chipActivo : ''}`}
                    onClick={() => setFiltro(k)}
                  >{lbl}{k !== 'todos' ? ` ${BUCKETS[k].label}` : ''}</button>
                ))}
              </div>
              <select className={styles.orden} value={orden} onChange={e => setOrden(e.target.value)}>
                <option value="fecha">Ordenar: fecha ↓</option>
                <option value="pendiente">Ordenar: $ pendiente ↓</option>
                <option value="cliente">Ordenar: cliente A-Z</option>
              </select>
              <span className={styles.contador}>{filtrados.length} pedido{filtrados.length !== 1 ? 's' : ''}</span>
            </div>

            {/* ── Kanban ── */}
            <div className={styles.kanban} data-cols={columnasVisibles.length}>
              {columnasVisibles.map(bucket => {
                const col   = BUCKETS[bucket]
                const lista = porBucket(bucket)
                return (
                  <div key={bucket} className={`${styles.columna} ${styles[col.cls]}`}>
                    <div className={styles.columnaHeader}>
                      {col.emoji} {col.label}
                      <span className={styles.columnaCount}>{lista.length}</span>
                    </div>

                    {lista.length === 0 ? (
                      <p className={styles.columnaVacia}>Sin pedidos</p>
                    ) : (
                      lista.map(o => (
                        <button
                          key={o.salesOrderId}
                          className={`${styles.card} ${styles['card_' + bucket]}`}
                          onClick={() => setDetalle(o)}
                        >
                          <div className={styles.cardHeader}>
                            <span className={styles.numero}>#{o.salesOrderId}</span>
                            <span className={styles.fecha}>{fmtFecha(o.issuedDate)}</span>
                          </div>
                          <span className={styles.cliente}>{o.customer || 'Sin cliente'}</span>

                          {bucket === 'despachado' ? (
                            <span className={styles.despBadge}>📦 Cerrado por bodega</span>
                          ) : (
                            <div className={styles.progressRow}>
                              <div className={styles.progressTrack}>
                                <div
                                  className={`${styles.progressFill} ${styles['fill_' + bucket]}`}
                                  style={{ width: `${o.pct}%` }}
                                />
                              </div>
                              <span className={styles.pct}>{o.pct}%</span>
                              <span className={styles.ratio}>{o.doneLines}/{o.totalLines} líneas</span>
                            </div>
                          )}

                          <div className={styles.montos}>
                            <span>Monto: <strong>{fmtPlata(o.totalAmount)}</strong></span>
                            {o.pendingAmount > 0 && bucket !== 'despachado' && (
                              <span className={styles.montoPend}>Pend.: {fmtPlata(o.pendingAmount)}</span>
                            )}
                          </div>

                          {o.docs.length > 0 && (
                            <div className={styles.docChips}>
                              {o.docs.slice(0, 3).map((d, i) => <span key={i} className={styles.docChip}>{d}</span>)}
                              {o.docs.length > 3 && <span className={styles.docChip}>+{o.docs.length - 3}</span>}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ══ MODAL detalle ══ */}
      <Modal
        isOpen={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle ? `Pedido #${detalle.salesOrderId}` : ''}
      >
        {detalle && (() => {
          const pill = ESTADO_PILL[detalle.status] || ESTADO_PILL.none
          const cubierto = detalle.totalAmount - detalle.pendingAmount
          const esDespachado = despachados.has(detalle.salesOrderId)
          return (
            <div className={styles.modalBody}>
              <div className={styles.modalInfoRow}>
                <div className={styles.modalInfoCol}>
                  <span className={styles.cliente}>{detalle.customer || 'Sin cliente'}</span>
                  <span className={styles.fecha}>Emitido: {fmtFecha(detalle.issuedDate)}</span>
                </div>
                <div className={styles.modalPills}>
                  {esDespachado && <span className={`${styles.pill} ${styles.pillDesp}`}>📦 Despachado</span>}
                  <span className={`${styles.pill} ${styles[pill.cls]}`}>{pill.label}</span>
                </div>
              </div>

              {/* Tabla de líneas */}
              <div className={styles.tabla}>
                <div className={`${styles.tRow} ${styles.tHead}`}>
                  <span></span>
                  <span>Producto</span>
                  <span className={styles.tNum}>Pedido</span>
                  <span className={styles.tNum}>Desp.</span>
                  <span className={styles.tNum}>Pend.</span>
                </div>
                {detalle.lines.map((l, i) => (
                  <div key={i} className={styles.tRow}>
                    <span className={styles.tIcon}>{LINEA_ICON[l.status]}</span>
                    <div className={styles.tProd}>
                      <span className={styles.tDesc}>{l.desc}</span>
                      <span className={styles.tSku}>
                        {l.sku}
                        {l.docs.length > 0 && ' · ' + l.docs.map(d => d.name).join(', ')}
                      </span>
                    </div>
                    <span className={styles.tNum}>{l.qty}</span>
                    <span className={styles.tNum}>{l.effective || '—'}</span>
                    <span className={`${styles.tNum} ${l.pending > 0 ? styles.tPend : ''}`}>{l.pending}</span>
                  </div>
                ))}
              </div>

              {/* Totales */}
              <div className={styles.totales}>
                <span>Total: <strong>{fmtPlata(detalle.totalAmount)}</strong></span>
                <span>Cubierto: <strong>{fmtPlata(cubierto)}</strong></span>
                <span className={detalle.pendingAmount > 0 ? styles.montoPend : ''}>
                  Pendiente: <strong>{fmtPlata(detalle.pendingAmount)}</strong>
                </span>
              </div>

              <button className="btn-outline" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
