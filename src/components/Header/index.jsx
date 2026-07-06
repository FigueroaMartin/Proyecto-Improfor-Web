import { useNavigate } from 'react-router-dom'
import { getRol } from '../../roles'
import styles from './Header.module.css'

export default function Header({ title, showBack = false, showLogout = false }) {
  const navigate = useNavigate()

  const perfil = (() => {
    try { return JSON.parse(localStorage.getItem('admin_activo') || 'null') }
    catch { return null }
  })()

  const cerrarSesion = () => {
    localStorage.removeItem('admin_activo')
    navigate('/', { replace: true })
  }

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {showBack ? (
          <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        ) : (
          <span className={styles.logo}>📦</span>
        )}
      </div>

      <h1 className={styles.title}>{title}</h1>

      <div className={styles.right}>
        {showLogout && perfil ? (
          <div className={styles.userRow}>
            <span className={styles.userName} title={getRol(perfil.rol)?.label || ''}>
              {getRol(perfil.rol)?.emoji || '🔑'} {perfil.nombre}
            </span>
            <button className={styles.logoutBtn} onClick={cerrarSesion}>Salir</button>
          </div>
        ) : (
          <span />
        )}
      </div>
    </header>
  )
}
