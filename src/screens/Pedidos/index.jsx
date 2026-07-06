import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { getPedidos, getPedidoById } from '../../db'
import Header       from '../../components/Header'
import Spinner      from '../../components/Spinner'
import Modal        from '../../components/Modal'
import KanbanBodega from './KanbanBodega'
import styles       from './Pedidos.module.css'

const tiempoRelativo = (fechaStr) => {
  if (!fechaStr) return ''
  const diff = Date.now() - new Date(fechaStr).getTime()
  const min  = Math.floor(diff / 60000)
  const hrs  = Math.floor(min / 60)
  const dias = Math.floor(hrs / 24)
  if (dias > 0) return `hace ${dias} día${dias > 1 ? 's' : ''}`
  if (hrs  > 0) return `hace ${hrs} hora${hrs > 1 ? 's' : ''}`
  if (min  > 0) return `hace ${min} min`
  return 'ahora mismo'
}

const formatFecha = (str) => {
  if (!str) return '—'
  const d = new Date(str)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const BADGE = {
  pendiente:  { label: 'Pendiente',  cls: 'badgePendiente' },
  en_proceso: { label: 'En proceso', cls: 'badgeProceso'   },
  cerrado:    { label: '✓ Cerrado',  cls: 'badgeCerrado'   },
}

export default function Pedidos() {
  const rol = JSON.parse(localStorage.getItem('admin_activo') || '{}').rol

  const [pedidos,      setPedidos]      = useState([])
  const [tab,          setTab]          = useState('activos')
  const [cargando,     setCargando]     = useState(true)
  const [error,        setError]        = useState('')

  // Modal detalle
  const [detalle,      setDetalle]      = useState(null)   // pedido completo con items
  const [cargandoDet,  setCargandoDet]  = useState(false)

  const cargar = useCallback(async () => {
    try {
      const data = await getPedidos()
      setPedidos(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const channel = supabase
      .channel('pedidos-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
        () => cargar()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [cargar])

  const verPedido = async (pedido) => {
    setCargandoDet(true)
    setDetalle({ ...pedido, items: [] })   // abre el modal de inmediato
    try {
      const completo = await getPedidoById(pedido.id)
      setDetalle(completo)
    } catch {
      // Si falla, deja lo que ya tenemos
    } finally {
      setCargandoDet(false)
    }
  }

  const activos  = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'en_proceso')
  const cerrados = pedidos.filter(p => p.estado === 'cerrado')
  const lista    = tab === 'activos' ? activos : cerrados

  // El perfil de bodega ve el tablero por columnas (Activos → Starken / Transportistas / Cliente retira)
  if (rol === 'bodega') {
    return (
      <div className="page">
        <Header title="Pedidos" showBack />
        <KanbanBodega />
      </div>
    )
  }

  return (
    <div className="page">
      <Header title="Pedidos" showBack />

      <div className={styles.container}>

        {/* ── Tabs ── */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'activos' ? styles.tabActive : ''}`}
            onClick={() => setTab('activos')}
          >
            Activos
            {activos.length > 0 && <span className={styles.tabBadge}>{activos.length}</span>}
          </button>
          <button
            className={`${styles.tab} ${tab === 'cerrados' ? styles.tabActive : ''}`}
            onClick={() => setTab('cerrados')}
          >
            Cerrados
          </button>
        </div>

        {/* ── Lista ── */}
        {cargando ? (
          <Spinner />
        ) : error ? (
          <p className={styles.errorMsg}>⚠️ {error}</p>
        ) : lista.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">{tab === 'activos' ? '🎉' : '📭'}</div>
            <p>{tab === 'activos' ? 'No hay pedidos activos' : 'No hay pedidos cerrados'}</p>
          </div>
        ) : (
          <div className={styles.lista}>
            {lista.map(p => {
              const badge = BADGE[p.estado] || BADGE.pendiente
              return (
                <div key={p.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.numero}>{p.numero_pedido}</span>
                    <span className={`${styles.badge} ${styles[badge.cls]}`}>{badge.label}</span>
                  </div>

                  {p.cliente_nombre && (
                    <span className={styles.cliente}>👤 {p.cliente_nombre}</span>
                  )}
                  {p.notas_admin && (
                    <span className={styles.notas} title={p.notas_admin}>
                      📋 {p.notas_admin}
                    </span>
                  )}
                  {p.bodeguero_nombre && (
                    <span className={styles.bodeguero}>👷 {p.bodeguero_nombre}</span>
                  )}

                  <span className={styles.tiempo}>
                    {p.estado === 'cerrado'
                      ? `Cerrado ${tiempoRelativo(p.cerrado_en)}`
                      : p.estado === 'en_proceso'
                        ? `En despacho desde ${tiempoRelativo(p.tomado_en)}`
                        : `Creado ${tiempoRelativo(p.creado_en)}`}
                  </span>

                  {/* ── Botón Ver pedido ── */}
                  <button className={styles.btnVer} onClick={() => verPedido(p)}>
                    <span>Ver pedido</span>
                    <span className={styles.btnVerArrow}>›</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          MODAL DETALLE PEDIDO
      ══════════════════════════════════════════════ */}
      <Modal
        isOpen={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle?.numero_pedido || 'Detalle del pedido'}
      >
        {detalle && (
          <div className={styles.detalleBody}>

            {/* Estado */}
            <div className={styles.detalleEstadoRow}>
              {(() => {
                const b = BADGE[detalle.estado] || BADGE.pendiente
                return <span className={`${styles.badge} ${styles[b.cls]} ${styles.badgeLg}`}>{b.label}</span>
              })()}
            </div>

            {/* Info general */}
            <div className={styles.detalleGrid}>
              <FilaDetalle label="Cliente"        valor={detalle.cliente_nombre  || 'Sin especificar'} />
              <FilaDetalle label="Bodeguero"      valor={detalle.bodeguero_nombre|| 'Sin asignar'}     />
              <div className={styles.detalleDivider} />
              <FilaDetalle label="Creado"   valor={formatFecha(detalle.creado_en)} />
              <FilaDetalle label="Tomado"   valor={formatFecha(detalle.tomado_en)} />
              <FilaDetalle label="Cerrado"  valor={formatFecha(detalle.cerrado_en)} />
            </div>

            {/* Notas del admin */}
            {detalle.notas_admin && (
              <div className={styles.notasBox}>
                <span className={styles.notasLabel}>📋 Notas del admin</span>
                <span className={styles.notasTexto}>{detalle.notas_admin}</span>
              </div>
            )}

            {/* Ítems */}
            <div className={styles.itemsSection}>
              <span className={styles.itemsTitulo}>
                Productos del pedido
                {detalle.items?.length > 0 && ` (${detalle.items.length})`}
              </span>

              {cargandoDet ? (
                <div style={{ padding: '16px 0' }}><Spinner text="Cargando ítems..." /></div>
              ) : detalle.items?.length === 0 ? (
                <p className={styles.itemsVacio}>Sin ítems registrados</p>
              ) : (
                <div className={styles.itemsLista}>
                  {detalle.items?.map(item => (
                    <div
                      key={item.id}
                      className={`${styles.itemRow} ${item.verificado === 1 ? styles.itemOk : styles.itemPend}`}
                    >
                      <span className={styles.itemIcono}>{item.verificado === 1 ? '✅' : '⏳'}</span>
                      <div className={styles.itemInfo}>
                        <span className={styles.itemNombre}>{item.producto_nombre}</span>
                        <span className={styles.itemCodigo}>{item.producto_codigo}</span>
                      </div>
                      <div className={styles.itemCants}>
                        <span className={styles.itemCantPedida}>×{item.cantidad_pedida}</span>
                        {item.cantidad_despachada != null && (
                          <span className={styles.itemCantDesp}>
                            {item.cantidad_despachada}/{item.cantidad_pedida} despachados
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="btn-outline" onClick={() => setDetalle(null)}>
              Cerrar
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

function FilaDetalle({ label, valor }) {
  return (
    <div className={styles.filaDetalle}>
      <span className={styles.filaLabel}>{label}</span>
      <span className={styles.filaValor}>{valor}</span>
    </div>
  )
}
