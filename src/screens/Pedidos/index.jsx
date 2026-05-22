import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { getPedidos } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import styles  from './Pedidos.module.css'

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

const BADGE = {
  pendiente:  { label: 'Pendiente',   className: 'badgePendiente'  },
  en_proceso: { label: 'En proceso',  className: 'badgeProceso'    },
  cerrado:    { label: '✓ Cerrado',   className: 'badgeCerrado'    },
}

export default function Pedidos() {
  const [pedidos,  setPedidos]  = useState([])
  const [tab,      setTab]      = useState('activos')   // activos | cerrados
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState('')

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

    // Realtime: sincroniza con la app móvil
    const channel = supabase
      .channel('pedidos-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
        () => cargar()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [cargar])

  const activos  = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'en_proceso')
  const cerrados = pedidos.filter(p => p.estado === 'cerrado')
  const lista    = tab === 'activos' ? activos : cerrados

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
            {activos.length > 0 && (
              <span className={styles.tabBadge}>{activos.length}</span>
            )}
          </button>
          <button
            className={`${styles.tab} ${tab === 'cerrados' ? styles.tabActive : ''}`}
            onClick={() => setTab('cerrados')}
          >
            Cerrados
          </button>
        </div>

        {/* ── Contenido ── */}
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
                    <span className={`${styles.badge} ${styles[badge.className]}`}>
                      {badge.label}
                    </span>
                  </div>

                  {p.cliente_nombre ? (
                    <span className={styles.cliente}>👤 {p.cliente_nombre}</span>
                  ) : null}

                  {p.notas_admin ? (
                    <span className={styles.notas} title={p.notas_admin}>
                      📋 {p.notas_admin}
                    </span>
                  ) : null}

                  {p.bodeguero_nombre ? (
                    <span className={styles.bodeguero}>👷 {p.bodeguero_nombre}</span>
                  ) : null}

                  <span className={styles.tiempo}>
                    {p.estado === 'cerrado'
                      ? `Cerrado ${tiempoRelativo(p.cerrado_en)}`
                      : p.estado === 'en_proceso'
                        ? `En despacho desde ${tiempoRelativo(p.tomado_en)}`
                        : `Creado ${tiempoRelativo(p.creado_en)}`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
