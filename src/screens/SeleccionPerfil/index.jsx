import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBodegueros, insertBodeguero } from '../../db'
import Spinner from '../../components/Spinner'
import styles from './SeleccionPerfil.module.css'

export default function SeleccionPerfil() {
  const navigate  = useNavigate()
  const [perfiles,   setPerfiles]   = useState([])
  const [cargando,   setCargando]   = useState(true)
  const [mostrando,  setMostrando]  = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [guardando,  setGuardando]  = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    // Si ya hay sesión activa, ir directo al dashboard
    const activo = localStorage.getItem('admin_activo')
    if (activo) { navigate('/dashboard', { replace: true }); return }
    cargar()
  }, [])

  const cargar = async () => {
    setCargando(true)
    try {
      const todos = await getBodegueros()
      setPerfiles(todos.filter(b => b.rol === 'administrador'))
    } catch (e) {
      setError('Error al cargar perfiles: ' + e.message)
    } finally {
      setCargando(false)
    }
  }

  const elegir = (perfil) => {
    localStorage.setItem('admin_activo', JSON.stringify({ id: perfil.id, nombre: perfil.nombre, rol: perfil.rol }))
    navigate('/dashboard', { replace: true })
  }

  const agregar = async (e) => {
    e.preventDefault()
    if (!nuevoNombre.trim()) return
    setGuardando(true)
    try {
      await insertBodeguero({ nombre: nuevoNombre.trim(), rol: 'administrador' })
      setNuevoNombre('')
      setMostrando(false)
      await cargar()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Logo + título ── */}
        <div className={styles.header}>
          <span className={styles.emoji}>📦</span>
          <h1 className={styles.titulo}>Improfor</h1>
          <p className={styles.subtitulo}>Panel Administrador</p>
          <p className={styles.pregunta}>¿Quién eres?</p>
        </div>

        {/* ── Lista de perfiles ── */}
        {cargando ? (
          <Spinner />
        ) : (
          <div className={styles.lista}>
            {perfiles.length === 0 && !mostrando && (
              <p className={styles.vacio}>
                No hay administradores creados.{'\n'}Agrega el primero abajo.
              </p>
            )}
            {perfiles.map(p => (
              <button key={p.id} className={styles.card} onClick={() => elegir(p)}>
                <span className={styles.cardEmoji}>🔑</span>
                <div className={styles.cardInfo}>
                  <span className={styles.cardNombre}>{p.nombre}</span>
                  <span className={styles.rolBadge}>Administrador</span>
                </div>
                <span className={styles.arrow}>›</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {error && <p className={styles.errorMsg}>{error}</p>}

        {/* ── Formulario nuevo perfil ── */}
        {mostrando ? (
          <form className={styles.form} onSubmit={agregar}>
            <label className="section-label">Nombre</label>
            <input
              className="input"
              value={nuevoNombre}
              onChange={e => setNuevoNombre(e.target.value)}
              placeholder="Ej: Carlos Pérez"
              autoFocus
              required
            />
            <button
              type="submit"
              className={`btn-primary ${styles.btnGuardar}`}
              disabled={guardando}
            >
              {guardando ? 'Creando...' : 'Crear perfil'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => { setMostrando(false); setNuevoNombre('') }}
            >
              Cancelar
            </button>
          </form>
        ) : (
          <button className={styles.btnAgregar} onClick={() => setMostrando(true)}>
            + Agregar administrador
          </button>
        )}

      </div>
    </div>
  )
}
