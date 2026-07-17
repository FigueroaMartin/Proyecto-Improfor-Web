import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ROLES, normalizarRol } from '../../roles'
import { NAV_ITEMS } from '../../navItems'
import styles from './Sidebar.module.css'

const LS_KEY   = 'sidebar_colapsado'
const ANCHO_EXPANDIDO = '240px'
const ANCHO_COLAPSADO = '68px'

// Menú lateral persistente — solo en escritorio (ver media query en el CSS).
// Deja las pantallas del rol activo siempre a mano para cambiar de una a otra
// sin tener que volver al Dashboard cada vez. Es colapsable a solo íconos
// para liberar espacio; la preferencia se guarda en localStorage.
export default function Sidebar() {
  const navigate  = useNavigate()
  const location  = useLocation()

  const [colapsado, setColapsado] = useState(() => localStorage.getItem(LS_KEY) === '1')

  // El ancho real lo expone como variable CSS en :root para que el resto del
  // layout (padding del contenido) se ajuste sin que el Sidebar conozca el resto de la página.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', colapsado ? ANCHO_COLAPSADO : ANCHO_EXPANDIDO)
  }, [colapsado])

  const perfil = (() => {
    try { return JSON.parse(localStorage.getItem('admin_activo') || 'null') }
    catch { return null }
  })()
  if (!perfil) return null

  const rolKey = normalizarRol(perfil.rol) || 'admin_pedidos'
  const rol    = ROLES[rolKey]
  const items  = rol.pantallas.map(k => NAV_ITEMS[k]).filter(Boolean)

  const toggleColapsado = () => {
    setColapsado(v => {
      const next = !v
      localStorage.setItem(LS_KEY, next ? '1' : '0')
      return next
    })
  }

  const cerrarSesion = () => {
    localStorage.removeItem('admin_activo')
    navigate('/', { replace: true })
  }

  return (
    <nav className={`${styles.sidebar} ${colapsado ? styles.colapsado : ''}`}>
      <div className={styles.brand}>
        <span className={styles.brandEmoji}>📦</span>
        {!colapsado && <span className={styles.brandTitle}>Improfor</span>}
        <button
          className={styles.toggleBtn}
          onClick={toggleColapsado}
          title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
        >
          {colapsado ? '»' : '«'}
        </button>
      </div>

      {!colapsado && (
        <span className={styles.rolBadge} style={{ background: rol.bg, color: rol.color }}>
          {rol.emoji} {rol.label}
        </span>
      )}

      <div className={styles.items}>
        <button
          className={`${styles.item} ${location.pathname === '/dashboard' ? styles.itemActive : ''}`}
          onClick={() => navigate('/dashboard')}
          title={colapsado ? 'Inicio' : undefined}
        >
          <span className={styles.itemEmoji}>🏠</span>
          {!colapsado && <span>Inicio</span>}
        </button>

        {items.map(it => (
          <button
            key={it.ruta}
            className={`${styles.item} ${location.pathname === it.ruta ? styles.itemActive : ''}`}
            onClick={() => navigate(it.ruta)}
            title={colapsado ? it.label : undefined}
          >
            <span className={styles.itemEmoji}>{it.emoji}</span>
            {!colapsado && <span>{it.label}</span>}
          </button>
        ))}
      </div>

      <div className={styles.userBox}>
        {!colapsado && <span className={styles.userName}>{perfil.nombre}</span>}
        <button className={styles.logoutBtn} onClick={cerrarSesion} title={colapsado ? 'Salir' : undefined}>
          {colapsado ? '🚪' : 'Salir'}
        </button>
      </div>
    </nav>
  )
}
