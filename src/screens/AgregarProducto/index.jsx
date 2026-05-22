import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Header from '../../components/Header'
import { insertProducto } from '../../db'
import styles from './AgregarProducto.module.css'

const CATEGORIAS = ['General', 'Electrónica', 'Alimentos', 'Ropa', 'Herramientas', 'Otros']

export default function AgregarProducto() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const codigoInicial = searchParams.get('codigo') || ''

  const [codigo,    setCodigo]    = useState(codigoInicial)
  const [nombre,    setNombre]    = useState('')
  const [stock,     setStock]     = useState('')
  const [categoria, setCategoria] = useState('General')
  const [ubicacion, setUbicacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState('')
  const [exito,     setExito]     = useState('')

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    if (!codigo.trim()) { setError('El código de barras es requerido.'); return }
    if (!nombre.trim()) { setError('El nombre del producto es requerido.'); return }
    setGuardando(true)
    try {
      await insertProducto({ codigo, nombre, stock, categoria, ubicacion, imagenes: '[]' })
      setExito(`"${nombre.trim()}" agregado al inventario.`)
      // Limpiar formulario tras éxito
      setTimeout(() => {
        setExito('')
        navigate('/inventario')
      }, 1400)
    } catch (e) {
      if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
        setError('Ya existe un producto con ese código.')
      } else {
        setError(e.message || 'No se pudo guardar el producto.')
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="page">
      <Header title="Agregar Producto" showBack />

      <div className={`container ${styles.content}`}>
        <form onSubmit={guardar} className={styles.form}>

          {/* ── Código ── */}
          <label className="section-label">Código de barras *</label>
          <input
            className="input"
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
            placeholder="Ej: 7891234567890"
            autoComplete="off"
          />

          {/* ── Nombre ── */}
          <label className="section-label">Nombre del producto *</label>
          <input
            className="input"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Casco de seguridad talla M"
            autoCapitalize="words"
          />

          {/* ── Stock ── */}
          <label className="section-label">Stock inicial</label>
          <input
            className="input"
            value={stock}
            onChange={e => setStock(e.target.value)}
            placeholder="0"
            type="number"
            min="0"
          />

          {/* ── Categoría ── */}
          <label className="section-label">Categoría</label>
          <div className={styles.pills}>
            {CATEGORIAS.map(cat => (
              <button
                key={cat}
                type="button"
                className={`${styles.pill} ${categoria === cat ? styles.pillActive : ''}`}
                onClick={() => setCategoria(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* ── Ubicación ── */}
          <label className="section-label">Ubicación en bodega</label>
          <textarea
            className={`input ${styles.textarea}`}
            value={ubicacion}
            onChange={e => setUbicacion(e.target.value)}
            placeholder="Ej: Pasillo 3, estante B, nivel 2"
            rows={3}
          />

          {/* ── Mensajes ── */}
          {error && <p className={styles.errorMsg}>⚠️ {error}</p>}
          {exito && <p className={styles.exitoMsg}>✅ {exito}</p>}

          {/* ── Botones ── */}
          <button
            type="submit"
            className="btn-primary"
            disabled={guardando}
            style={{ marginTop: 8 }}
          >
            {guardando ? 'Guardando...' : '💾  Guardar producto'}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  )
}
