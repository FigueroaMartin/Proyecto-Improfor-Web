import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getProductos, updateProducto, deleteProducto } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './Inventario.module.css'

const CATEGORIAS = ['General', 'Electrónica', 'Alimentos', 'Ropa', 'Herramientas', 'Otros']

export default function Inventario() {
  const navigate = useNavigate()

  const [productos,  setProductos]  = useState([])
  const [cargando,   setCargando]   = useState(true)
  const [busqueda,   setBusqueda]   = useState('')
  const [editando,   setEditando]   = useState(null)   // producto a editar
  const [guardando,  setGuardando]  = useState(false)
  const [error,      setError]      = useState('')

  // Campos del modal de edición
  const [editNombre,    setEditNombre]    = useState('')
  const [editStock,     setEditStock]     = useState('')
  const [editCategoria, setEditCategoria] = useState('General')
  const [editUbicacion, setEditUbicacion] = useState('')

  const cargar = useCallback(async () => {
    try {
      const data = await getProductos()
      setProductos(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()

    // Realtime: se actualiza cuando la app móvil cambia un producto
    const channel = supabase
      .channel('inventario-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' },
        () => cargar()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [cargar])

  // ── Filtrar en tiempo real ──
  const filtrados = productos.filter(p => {
    const q = busqueda.toLowerCase()
    return (
      p.nombre.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q)
    )
  })

  // ── Abrir modal de edición ──
  const abrirEditar = (p) => {
    setEditando(p)
    setEditNombre(p.nombre)
    setEditStock(String(p.stock))
    setEditCategoria(p.categoria)
    setEditUbicacion(p.ubicacion || '')
    setError('')
  }

  // ── Guardar edición ──
  const guardarEdicion = async (e) => {
    e.preventDefault()
    if (!editNombre.trim()) { setError('El nombre es requerido.'); return }
    setGuardando(true)
    try {
      await updateProducto(editando.id, {
        nombre:    editNombre.trim(),
        stock:     parseInt(editStock) || 0,
        categoria: editCategoria,
        ubicacion: editUbicacion.trim(),
      })
      setEditando(null)
      await cargar()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  // ── Eliminar ──
  const eliminar = (p) => {
    if (!window.confirm(`¿Eliminar "${p.nombre}"? Esta acción no se puede deshacer.`)) return
    deleteProducto(p.id)
      .then(cargar)
      .catch(e => setError(e.message))
  }

  return (
    <div className="page">
      <Header title="Inventario" showBack />

      <div className={`container ${styles.content}`}>

        {/* ── Buscador ── */}
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o código..."
          />
          {busqueda && (
            <button className={styles.clearBtn} onClick={() => setBusqueda('')}>✕</button>
          )}
        </div>

        {/* ── Botón agregar ── */}
        <button
          className={styles.btnAgregar}
          onClick={() => navigate('/agregar-producto')}
        >
          ➕  Agregar producto
        </button>

        {/* ── Lista ── */}
        {cargando ? (
          <Spinner />
        ) : filtrados.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">{busqueda ? '🔍' : '📦'}</div>
            <p>{busqueda ? `Sin resultados para "${busqueda}"` : 'No hay productos en el inventario'}</p>
          </div>
        ) : (
          <div className={styles.lista}>
            <p className={styles.contador}>{filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}</p>
            {filtrados.map(p => (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.cardInfo}>
                    <span className={styles.cardNombre}>{p.nombre}</span>
                    <span className={styles.cardCodigo}>{p.codigo}</span>
                  </div>
                  <div className={styles.cardAcciones}>
                    <button className={styles.btnEdit} onClick={() => abrirEditar(p)} title="Editar">✏️</button>
                    <button className={styles.btnDel}  onClick={() => eliminar(p)}   title="Eliminar">🗑️</button>
                  </div>
                </div>
                <div className={styles.cardBottom}>
                  <span className={styles.categoria}>{p.categoria}</span>
                  <div className={styles.stockRow}>
                    <span className={styles.stockNum}>{p.stock}</span>
                    <span className={styles.stockLabel}>uds</span>
                  </div>
                </div>
                {p.ubicacion ? (
                  <span className={styles.ubicacion}>📍 {p.ubicacion}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal de edición ── */}
      <Modal
        isOpen={!!editando}
        onClose={() => setEditando(null)}
        title="Editar producto"
      >
        <form onSubmit={guardarEdicion} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="section-label">Nombre *</label>
          <input
            className="input"
            value={editNombre}
            onChange={e => setEditNombre(e.target.value)}
            required
          />

          <label className="section-label">Stock</label>
          <input
            className="input"
            type="number"
            min="0"
            value={editStock}
            onChange={e => setEditStock(e.target.value)}
          />

          <label className="section-label">Categoría</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIAS.map(cat => (
              <button
                key={cat}
                type="button"
                className={styles.pill}
                style={editCategoria === cat ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)', fontWeight: 700 } : {}}
                onClick={() => setEditCategoria(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <label className="section-label">Ubicación en bodega</label>
          <textarea
            className="input"
            value={editUbicacion}
            onChange={e => setEditUbicacion(e.target.value)}
            placeholder="Ej: Pasillo 3, estante B"
            rows={2}
            style={{ resize: 'vertical' }}
          />

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>⚠️ {error}</p>}

          <button type="submit" className="btn-primary" disabled={guardando} style={{ marginTop: 4 }}>
            {guardando ? 'Guardando...' : '💾  Guardar cambios'}
          </button>
          <button type="button" className="btn-outline" onClick={() => setEditando(null)}>
            Cancelar
          </button>
        </form>
      </Modal>
    </div>
  )
}
