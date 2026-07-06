import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getPedidos } from '../../db'
import Header        from '../../components/Header'
import Spinner       from '../../components/Spinner'
import Modal         from '../../components/Modal'
import KanbanPedidos from './KanbanPedidos'
import styles        from './Despachos.module.css'

const STATUS = {
  none:     { label: 'Pendiente', cls: 'pillNone',     icon: '⏳' },
  partial:  { label: 'Parcial',   cls: 'pillPartial',  icon: '⚠️' },
  complete: { label: 'Completo',  cls: 'pillComplete', icon: '✅' },
}

const ESTADO_BODEGA = {
  pendiente:  { label: 'En cola',     cls: 'badgeCola'    },
  en_proceso: { label: 'En despacho', cls: 'badgeProceso' },
}

const fmtFecha = (str) => {
  if (!str) return ''
  const d = new Date(str)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const tiempoRelativo = (str) => {
  if (!str) return ''
  const min = Math.floor((Date.now() - new Date(str).getTime()) / 60000)
  const hrs = Math.floor(min / 60)
  const dias = Math.floor(hrs / 24)
  if (dias > 0) return `hace ${dias} día${dias > 1 ? 's' : ''}`
  if (hrs > 0)  return `hace ${hrs} hora${hrs > 1 ? 's' : ''}`
  if (min > 0)  return `hace ${min} min`
  return 'ahora mismo'
}

// Fecha local de hoy (no UTC) — el tablero parte siempre en el día actual
const hoy = () => {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Despachos() {
  const navigate = useNavigate()
  const rol = JSON.parse(localStorage.getItem('admin_activo') || '{}').rol

  const [desde,    setDesde]    = useState(hoy())
  const [orders,   setOrders]   = useState([])   // tablero Laudus
  const [pedidos,  setPedidos]  = useState([])   // pedidos Supabase (bodega)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState('')

  const [enviando, setEnviando] = useState(null)
  const [detalle,  setDetalle]  = useState(null)

  const cargarBoard = useCallback(async (desdeParam) => {
    const { data, error } = await supabase.functions.invoke('laudus-dispatch-board', {
      body: { desde: desdeParam },
    })
    if (error) throw error
    if (!data?.ok) throw new Error(data?.error || 'Error al cargar el tablero')
    setOrders(data.orders || [])
  }, [])

  const cargarPedidos = useCallback(async () => {
    try { setPedidos(await getPedidos()) } catch { /* la columna queda como estaba */ }
  }, [])

  const cargar = useCallback(async (desdeParam) => {
    setCargando(true)
    setError('')
    try {
      await Promise.all([cargarBoard(desdeParam), cargarPedidos()])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }, [cargarBoard, cargarPedidos])

  useEffect(() => {
    cargar(hoy())
    // Realtime: la columna "en bodega" refleja tomas/cierres al instante
    const channel = supabase
      .channel('despachos-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
        () => cargarPedidos()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [cargar, cargarPedidos])

  // ── Derivados de columnas ──
  const enviadosSet = new Set(pedidos.map(p => p.laudus_order_id).filter(x => x != null))
  const porEnviar   = orders.filter(o => !enviadosSet.has(o.salesOrderId))
  const activos     = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'en_proceso')

  const enviarABodega = async (order) => {
    setEnviando(order.salesOrderId)
    try {
      const { data, error } = await supabase.functions.invoke('laudus-send-to-bodega', {
        body: { salesOrderId: order.salesOrderId },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'No se pudo enviar a bodega')
      await cargarPedidos()   // la card salta de columna
    } catch (e) {
      alert('⚠️ ' + (e.message || String(e)))
    } finally {
      setEnviando(null)
    }
  }

  // El administrador de pedidos ve el kanban de gestión (arrastrable por stock)
  if (rol === 'admin_pedidos') {
    return (
      <div className="page">
        <Header title="Despachos" showBack />
        <KanbanPedidos />
      </div>
    )
  }

  return (
    <div className="page">
      <Header title="Despachos" showBack />

      <div className={styles.container}>

        {/* ── Filtro de fecha ── */}
        <div className={styles.filtros}>
          <label className={styles.filtroLabel}>
            Desde
            <input
              type="date"
              className={styles.fechaInput}
              value={desde}
              onChange={e => setDesde(e.target.value)}
            />
          </label>
          <button className={styles.btnActualizar} onClick={() => cargar(desde)} disabled={cargando}>
            {cargando ? '⏳ Cargando…' : '↻ Actualizar'}
          </button>
        </div>

        {cargando ? (
          <Spinner text="Consultando Laudus…" />
        ) : error ? (
          <div className="empty-state"><div className="emoji">⚠️</div><p>{error}</p></div>
        ) : (
          <div className={styles.columnas}>

            {/* ══ Columna 1: pendientes por enviar ══ */}
            <div className={styles.columna}>
              <div className={`${styles.columnaHeader} ${styles.headerPend}`}>
                ⏳ Pendientes por enviar
                <span className={styles.columnaCount}>{porEnviar.length}</span>
              </div>

              {porEnviar.length === 0 ? (
                <div className={styles.columnaVacia}>
                  <span className={styles.vaciaEmoji}>📭</span>
                  <p>Sin pedidos con documento por enviar</p>
                </div>
              ) : (
                porEnviar.map(o => {
                  const st = STATUS[o.status] || STATUS.none
                  return (
                    <div key={o.salesOrderId} className={styles.card}>
                      <div className={styles.cardHeader}>
                        <span className={styles.numero}>#{o.salesOrderId}</span>
                        <span className={`${styles.pill} ${styles[st.cls]}`}>{st.icon} {st.label}</span>
                      </div>

                      <span className={styles.cliente}>👤 {o.customer || 'Sin cliente'}</span>
                      <span className={styles.fecha}>{fmtFecha(o.issuedDate)}</span>

                      <div className={styles.chips}>
                        {o.docs.map((d, i) => <span key={i} className={styles.chip}>{d}</span>)}
                      </div>

                      <div className={styles.progressTrack}>
                        <div className={styles.progressFill} style={{ width: `${o.pct}%` }} />
                      </div>
                      <span className={styles.resumen}>
                        {o.completedLines}/{o.totalLines} líneas · {o.totalPending} uds pendientes · {o.pct}%
                      </span>

                      <div className={styles.acciones}>
                        <button className={styles.btnVer} onClick={() => setDetalle(o)}>Ver detalle ›</button>
                        <button
                          className={styles.btnEnviar}
                          onClick={() => enviarABodega(o)}
                          disabled={enviando === o.salesOrderId}
                        >
                          {enviando === o.salesOrderId ? 'Enviando…' : '📦 Enviar a bodega'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* ══ Columna 2: activos en bodega ══ */}
            <div className={styles.columna}>
              <div className={`${styles.columnaHeader} ${styles.headerBodega}`}>
                📦 Activos en bodega
                <span className={styles.columnaCount}>{activos.length}</span>
              </div>

              {activos.length === 0 ? (
                <div className={styles.columnaVacia}>
                  <span className={styles.vaciaEmoji}>🎉</span>
                  <p>No hay pedidos activos en bodega</p>
                </div>
              ) : (
                activos.map(p => {
                  const eb = ESTADO_BODEGA[p.estado] || ESTADO_BODEGA.pendiente
                  return (
                    <div key={p.id} className={`${styles.card} ${styles.cardBodega}`}>
                      <div className={styles.cardHeader}>
                        <span className={styles.numero}>{p.numero_pedido}</span>
                        <span className={`${styles.pill} ${styles[eb.cls]}`}>{eb.label}</span>
                      </div>

                      {p.cliente_nombre && (
                        <span className={styles.cliente}>👤 {p.cliente_nombre}</span>
                      )}
                      {p.bodeguero_nombre && (
                        <span className={styles.bodeguero}>👷 {p.bodeguero_nombre}</span>
                      )}
                      <span className={styles.fecha}>
                        {p.estado === 'en_proceso'
                          ? `En despacho desde ${tiempoRelativo(p.tomado_en)}`
                          : `Enviado ${tiempoRelativo(p.creado_en)}`}
                      </span>

                      <div className={styles.acciones}>
                        {p.laudus_order_id && (
                          <span className={styles.laudusRef}>Laudus #{p.laudus_order_id}</span>
                        )}
                        <button className={styles.btnVer} onClick={() => navigate('/pedidos')}>
                          Ver en Pedidos ›
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal detalle (orden Laudus) ── */}
      <Modal
        isOpen={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle ? `Pedido #${detalle.salesOrderId}` : ''}
      >
        {detalle && (() => {
          const pendientes = detalle.lines.filter(l => l.pending > 0)
          const cubiertas  = detalle.lines.filter(l => l.effective > 0)
          return (
            <div className={styles.detalleBody}>
              <div className={styles.detalleInfo}>
                <span className={styles.detalleCliente}>👤 {detalle.customer}</span>
                <div className={styles.chips}>
                  {detalle.docs.map((d, i) => <span key={i} className={styles.chip}>{d}</span>)}
                </div>
              </div>

              {pendientes.length > 0 && (
                <div className={styles.tablaSec}>
                  <h4 className={`${styles.tablaTitulo} ${styles.tituloPend}`}>⏳ Pendiente de despacho</h4>
                  {pendientes.map((l, i) => (
                    <div key={i} className={`${styles.linea} ${styles.lineaPend}`}>
                      <div className={styles.lineaInfo}>
                        <span className={styles.lineaNombre}>{l.desc}</span>
                        <span className={styles.lineaSku}>{l.sku}</span>
                      </div>
                      <span className={styles.lineaQty}>{l.pending} / {l.qty}</span>
                    </div>
                  ))}
                </div>
              )}

              {cubiertas.length > 0 && (
                <div className={styles.tablaSec}>
                  <h4 className={`${styles.tablaTitulo} ${styles.tituloOk}`}>✅ Emitido / despachado</h4>
                  {cubiertas.map((l, i) => (
                    <div key={i} className={`${styles.linea} ${styles.lineaOk}`}>
                      <div className={styles.lineaInfo}>
                        <span className={styles.lineaNombre}>{l.desc}</span>
                        <span className={styles.lineaSku}>{l.sku}</span>
                      </div>
                      <span className={styles.lineaQty}>{l.effective} / {l.qty}</span>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn-outline" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
