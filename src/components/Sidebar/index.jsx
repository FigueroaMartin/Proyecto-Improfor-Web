import { useNavigate, useLocation } from 'react-router-dom'
import { ROLES, normalizarRol } from '../../roles'
import { NAV_ITEMS } from '../../navItems'
import styles from './Sidebar.module.css'

// Menú lateral persistente — solo en escritorio (ver media query en el CSS).
// Deja las pantallas del rol activo siempre a mano para cambiar de una a otra
// sin tener que volver al Dashboard cada vez.
export default function Sidebar() {
  const navigate  = useNavigate()
  const location  = useLocation()

  const perfil = (() => {
    try { return JSON.parse(localStorage.getItem('admin_activo') || 'null') }
    catch { return null }
  })()
  if (!perfil) return null

  const rolKey = normalizarRol(perfil.rol) || 'admin_pedidos'
  const rol    = ROLES[rolKey]
  const items  = rol.pantallas.map(k => NAV_ITEMS[k]).filter(Boolean)

  const cerrarSesion = () => {
    localStorage.removeItem('admin_activo')
    navigate('/', { replace: true })
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandEmoji}>📦</span>
        <span className={styles.brandTitle}>Improfor</span>
      </div>

      <span className={styles.rolBadge} style={{ background: rol.bg, color: rol.color }}>
        {rol.emoji} {rol.label}
      </span>

      <div className={styles.items}>
        <button
          className={`${styles.item} ${location.pathname === '/dashboard' ? styles.itemActive : ''}`}
          onClick={() => navigate('/dashboard')}
        >
          <span className={styles.itemEmoji}>🏠</span>
          <span>Inicio</span>
        </button>

        {items.map(it => (
          <button
            key={it.ruta}
            className={`${styles.item} ${location.pathname === it.ruta ? styles.itemActive : ''}`}
            onClick={() => navigate(it.ruta)}
          >
            <span className={styles.itemEmoji}>{it.emoji}</span>
            <span>{it.label}</span>
          </button>
        ))}
      </div>

      <div className={styles.userBox}>
        <span className={styles.userName}>{perfil.nombre}</span>
        <button className={styles.logoutBtn} onClick={cerrarSesion}>Salir</button>
      </div>
    </nav>
  )
}
