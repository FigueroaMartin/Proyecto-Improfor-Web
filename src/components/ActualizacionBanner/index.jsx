/* global __BUILD_ID__ */
import { useState, useEffect } from 'react'
import styles from './ActualizacionBanner.module.css'

// version.json se publica en la raíz del sitio (junto al index.html)
const VERSION_URL = `${import.meta.env.BASE_URL}version.json`
const INTERVALO   = 2 * 60 * 1000   // re-chequear cada 2 minutos

export default function ActualizacionBanner() {
  const [nueva, setNueva] = useState(null)   // versión nueva detectada (o null)

  useEffect(() => {
    // En desarrollo no hay version.json publicado: no chequear.
    if (!import.meta.env.PROD) return
    let activo = true

    const chequear = async () => {
      try {
        // no-store evita el caché del navegador: siempre la versión real del servidor
        const r = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (activo && data?.version && data.version !== __BUILD_ID__) {
          setNueva(data.version)
        }
      } catch { /* sin conexión: reintenta en el próximo ciclo */ }
    }

    chequear()
    const id = setInterval(chequear, INTERVALO)
    // Al volver a la pestaña, chequear de inmediato
    const onVisible = () => { if (document.visibilityState === 'visible') chequear() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      activo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!nueva) return null

  // Recarga forzando el bypass del caché del documento: un query nuevo hace que
  // el navegador no reutilice el index.html viejo cacheado.
  const actualizar = () => {
    window.location.replace(window.location.pathname + '?v=' + nueva + window.location.hash)
  }

  return (
    <div className={styles.banner}>
      <span className={styles.texto}>🚀 Hay una versión nueva disponible</span>
      <button className={styles.btn} onClick={actualizar}>Actualizar ahora</button>
    </div>
  )
}
