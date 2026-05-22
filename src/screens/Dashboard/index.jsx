import { useNavigate } from 'react-router-dom'
import Header from '../../components/Header'
import styles from './Dashboard.module.css'

const CARDS = [
  {
    emoji: '📷',
    label: 'Escanear Código',
    desc:  'Leer código de barras con la webcam',
    ruta:  '/escanear',
    color: '#1976D2',
  },
  {
    emoji: '➕',
    label: 'Agregar Producto',
    desc:  'Registrar un nuevo producto manualmente',
    ruta:  '/agregar-producto',
    color: 'var(--success)',
  },
  {
    emoji: '📋',
    label: 'Ver Inventario',
    desc:  'Buscar, editar y gestionar el stock',
    ruta:  '/inventario',
    color: 'var(--primary)',
  },
  {
    emoji: '📦',
    label: 'Pedidos',
    desc:  'Supervisar todos los pedidos',
    ruta:  '/pedidos',
    color: 'var(--accent)',
  },
]

export default function Dashboard() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <Header title="Improfor" showLogout />

      <div className={`container ${styles.content}`}>
        <div className={styles.bienvenida}>
          <span className={styles.bienvenidaEmoji}>👋</span>
          <p className={styles.bienvenidaTexto}>Sistema de despacho EPP</p>
        </div>

        <div className={styles.grid}>
          {CARDS.map(c => (
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
