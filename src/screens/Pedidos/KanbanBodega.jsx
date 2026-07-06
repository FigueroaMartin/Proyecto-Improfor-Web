import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { getPedidos, getPedidoById, updatePedido } from '../../db'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './KanbanBodega.module.css'

// Las 3 columnas de destino imitan la disposición física de la bodega.
const COLS = [
  { id: 'activos',        label: 'Pedidos activos', emoji: '📋', cls: 'colActivos' },
  { id: 'starken',        label: 'Starken',         emoji: '📦', cls: 'colStarken' },
  { id: 'transportistas', label: 'Transportistas',  emoji: '🚚', cls: 'colTransp'  },
  { id: 'cliente_retira', label: 'Cliente retira',  emoji: '🙋', cls: 'colRetira'  },
]

const norm = (s) => (s || '').trim().toLowerCase()

// Destino según el transportista (Starken / Cliente retira / Transportistas).
function destinoDe(carrier) {
  const c = norm(carrier)
  if (c === 'starken')        return 'starken'
  if (c === 'cliente retira') return 'cliente_retira'
  return 'transportistas'   // cualquier otro transportista (o sin asignar)
}

// Clasificación automática: al cerrar, el pedido va a su columna según el carrier.
function columnaDe(p) {
  if (p.estado !== 'cerrado') return 'activos'
  return destinoDe(p.carrier)
}

const tiempoRel = (str) => {
  if (!str) return ''
  const min = Math.floor((Date.now() - new Date(str).getTime()) / 60000)
  const hrs = Math.floor(min / 60), dias = Math.floor(hrs / 24)
  if (dias > 0) return `hace ${dias}d`
  if (hrs  > 0) return `hace ${hrs}h`
  if (min  > 0) return `hace ${min}m`
  return 'recién'
}

export default function KanbanBodega() {
  const [pedidos,     setPedidos]     = useState([])
  const [cargando,    setCargando]    = useState(true)
  const [error,       setError]       = useState('')
  const [detalle,     setDetalle]     = useState(null)
  const [cargandoDet, setCargandoDet] = useState(false)
  const [cerrando,    setCerrando]    = useState(null)

  const cargar = useCallback(async () => {
    try { setPedidos(await getPedidos()); setError('') }
    catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [])

  useEffect(() => {
    cargar()
    const ch = supabase
      .channel('bodega-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [cargar])

  const verPedido = async (p) => {
    setCargandoDet(true)
    setDetalle({ ...p, items: [] })
    try { const c = await getPedidoById(p.id); if (c) setDetalle(c) }
    catch { /* deja lo que hay */ }
    finally { setCargandoDet(false) }
  }

  const cerrar = async (p) => {
    if (!window.confirm(`¿Cerrar ${p.numero_pedido}? Se moverá a su columna de despacho.`)) return
    setCerrando(p.id)
    try {
      await updatePedido(p.id, { estado: 'cerrado', cerrado_en: new Date().toISOString() })
      await cargar()
    } catch (e) { window.alert('Error al cerrar: ' + e.message) }
    finally { setCerrando(null) }
  }

  const porCol = (id) => pedidos.filter(p => columnaDe(p) === id)

  if (cargando) return <div className={styles.wrap}><Spinner /></div>
  if (error)    return <div className={styles.wrap}><p className={styles.error}>⚠️ {error}</p></div>

  return (
    <div className={styles.wrap}>
      <div className={styles.board}>
        {COLS.map(col => {
          const lista = porCol(col.id)
          const esActivos = col.id === 'activos'
          return (
            <section key={col.id} className={`${styles.col} ${styles[col.cls]}`}>
              <div className={styles.colHeader}>
                <span>{col.emoji} {col.label}</span>
                <span className={styles.count}>{lista.length}</span>
              </div>

              {lista.length === 0 ? (
                <p className={styles.vacio}>Sin pedidos</p>
              ) : lista.map(p => (
                <div key={p.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.numero}>{p.numero_pedido}</span>
                    {!esActivos && p.carrier && (
                      <span className={`${styles.transpBadge} ${styles['transp_' + col.id]}`}>{p.carrier}</span>
                    )}
                  </div>

                  {p.cliente_nombre && <span className={styles.cliente}>👤 {p.cliente_nombre}</span>}

                  {esActivos && (
                    <span className={`${styles.transpBadge} ${styles.transpDestino} ${styles['transp_' + destinoDe(p.carrier)]}`}>
                      🚚 {p.carrier || 'Sin transportista'}
                    </span>
                  )}

                  <span className={styles.tiempo}>
                    {p.estado === 'cerrado' ? `Cerrado ${tiempoRel(p.cerrado_en)}` : `Creado ${tiempoRel(p.creado_en)}`}
                  </span>

                  <div className={styles.acciones}>
                    <button className={styles.btnVer} onClick={() => verPedido(p)}>Ver pedido</button>
                    {esActivos && (
                      <button
                        className={styles.btnCerrar}
                        disabled={cerrando === p.id}
                        onClick={() => cerrar(p)}
                      >
                        {cerrando === p.id ? 'Cerrando…' : '✓ Cerrar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>

      {/* ── Modal detalle ── */}
      <Modal isOpen={!!detalle} onClose={() => setDetalle(null)} title={detalle?.numero_pedido || 'Pedido'}>
        {detalle && (
          <div className={styles.modalBody}>
            <div className={styles.modalInfo}>
              {detalle.cliente_nombre && <span className={styles.cliente}>👤 {detalle.cliente_nombre}</span>}
              {detalle.carrier && (
                <span className={`${styles.transpBadge} ${styles['transp_' + destinoDe(detalle.carrier)]}`}>
                  🚚 {detalle.carrier}
                </span>
              )}
            </div>

            <div className={styles.itemsBox}>
              <span className={styles.itemsTitulo}>
                Productos {detalle.items?.length > 0 ? `(${detalle.items.length})` : ''}
              </span>
              {cargandoDet ? (
                <Spinner text="Cargando ítems…" />
              ) : detalle.items?.length === 0 ? (
                <p className={styles.vacio}>Sin ítems</p>
              ) : (
                detalle.items.map(it => (
                  <div key={it.id} className={styles.itemRow}>
                    <span className={styles.itemIcono}>{it.verificado === 1 ? '✅' : '⏳'}</span>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemNombre}>{it.producto_nombre}</span>
                      <span className={styles.itemCodigo}>{it.producto_codigo}</span>
                    </div>
                    <span className={styles.itemQty}>×{it.cantidad_pedida}</span>
                  </div>
                ))
              )}
            </div>

            <button className="btn-outline" onClick={() => setDetalle(null)}>Cerrar</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
