import { useNavigate } from 'react-router-dom'
import Header from '../../components/Header'
import { ROLES, normalizarRol } from '../../roles'
import { NAV_ITEMS } from '../../navItems'
import styles from './Dashboard.module.css'

// Logo animado (video loop) oculto por ahora a pedido del cliente — no se usa,
// pero se deja el código listo para reactivarlo cambiando este flag a true.
const MOSTRAR_LOGO_ANIMADO = false

export default function Dashboard() {
  const navigate = useNavigate()

  const perfil = (() => {
    try { return JSON.parse(localStorage.getItem('admin_activo') || 'null') }
    catch { return null }
  })()
  const rolKey = normalizarRol(perfil?.rol) || 'admin_pedidos'
  const rol    = ROLES[rolKey]
  const cards  = rol.pantallas.map(k => NAV_ITEMS[k]).filter(Boolean)

  return (
    <div className="page">
      <Header title="Improfor" showLogout />

      <div className={`container ${styles.content}`}>
        <div className={styles.bienvenida}>
          {MOSTRAR_LOGO_ANIMADO && (
            <div className={styles.logoFrame}>
              <video
                className={styles.logoVideo}
                src={import.meta.env.BASE_URL + 'assets/logo-loop.mp4'}
                autoPlay
                muted
                loop
                playsInline
              >
                Improfor
              </video>
            </div>
          )}
          <p className={styles.bienvenidaTexto}>Sistema de despacho EPP</p>
          <span
            className={styles.rolBadge}
            style={{ background: rol.bg, color: rol.color }}
          >
            {rol.emoji} {rol.label}
          </span>
        </div>

        <div className={styles.grid}>
          {cards.map(c => (
            <button
              key={c.ruta}
              className={styles.card}
              style={{ borderLeftColor: c.color }}
              onClick={() => navigate(c.ruta)}
            >
              <span className={styles.cardEmoji}>{c.emoji}</span>
              <div className={styles.cardText}>
                <span className={styles.cardLabel}>{c.label}</span>
                <span className={styles.cardDesc}>{c.desc}</span>
              </div>
              <span className={styles.cardArrow} style={{ color: c.color }}>›</span>
            </button>
          ))}
        </div>

        <p className={styles.footer}>Modo online · Supabase</p>
      </div>
    </div>
  )
}
