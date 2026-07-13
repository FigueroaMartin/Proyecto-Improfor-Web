import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { getProductos, contarProductos, getProveedores } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './Inventario.module.css'

const parseImagenes = (str) => {
  try { return JSON.parse(str || '[]') } catch { return [] }
}

// Con ~15k productos NO se traen todos: se carga una página acotada y la
// búsqueda se resuelve en el servidor.
const PAGE_SIZE = 100

export default function Inventario() {
  const [productos,  setProductos]  = useState([])
  const [total,      setTotal]      = useState(null)
  const [cargando,   setCargando]   = useState(true)
  const [busqueda,   setBusqueda]   = useState('')
  const [error,      setError]      = useState('')

  // Sincronización con Laudus
  const [sincronizando, setSincronizando] = useState(false)
  const [syncMsg,       setSyncMsg]        = useState('')
  const [lastSync,      setLastSync]       = useState(() => localStorage.getItem('laudus_last_sync') || '')

  // Mostrar descontinuados (por defecto ocultos)
  const [verDescontinuados, setVerDescontinuados] = useState(false)
  // Ocultar productos sin stock (por defecto visible)
  const [soloConStock, setSoloConStock] = useState(false)
  // Filtro por proveedor ('' = todos, '__sin_proveedor__' = sin proveedor asignado)
  const [proveedor,    setProveedor]    = useState('')
  const [proveedores,  setProveedores]  = useState([])

  // Modal detalle (solo lectura)
  const [detalle,    setDetalle]    = useState(null)
  const [imagenFull, setImagenFull] = useState(null)

  const busquedaRef   = useRef('')    // query actual (para usar en realtime)
  const verRef        = useRef(false) // verDescontinuados actual (para realtime)
  const stockRef      = useRef(false) // soloConStock actual (para realtime)
  const proveedorRef  = useRef('')    // proveedor actual (para realtime)
  const searchTimer   = useRef(null)  // debounce del buscador

  const cargar = useCallback(async (q = '', incluir = false, conStock = false, prov = '') => {
    try {
      const data = await getProductos(q, PAGE_SIZE, incluir, conStock, prov)
      setProductos(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  const refrescarTotal = useCallback(async (incluir = false, conStock = false, prov = '') => {
    const n = await contarProductos(incluir, conStock, prov)
    if (n != null) setTotal(n)
  }, [])

  const cargarProveedores = useCallback(async (incluir = false, conStock = false) => {
    try { setProveedores(await getProveedores(incluir, conStock)) } catch { /* deja la lista como estaba */ }
  }, [])

  useEffect(() => {
    cargar('', false)
    refrescarTotal(false)
    cargarProveedores()
    // Debounce: una sincronización masiva emite miles de eventos; los colapsamos
    // en una sola recarga 1,5s después del último cambio.
    let t
    const channel = supabase
      .channel('inventario-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' },
        () => {
          clearTimeout(t)
          t = setTimeout(() => {
            cargar(busquedaRef.current, verRef.current, stockRef.current, proveedorRef.current)
            refrescarTotal(verRef.current, stockRef.current, proveedorRef.current)
            cargarProveedores(verRef.current, stockRef.current)
          }, 1500)
        }
      )
      .subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(channel) }
  }, [cargar, refrescarTotal, cargarProveedores])

  // ── Buscador (debounce + consulta al servidor) ──
  const onBuscar = (val) => {
    setBusqueda(val)
    busquedaRef.current = val
    clearTimeout(searchTimer.current)
    setCargando(true)
    searchTimer.current = setTimeout(() => cargar(val, verRef.current, stockRef.current, proveedorRef.current), 350)
  }

  // ── Toggle ver descontinuados ──
  const toggleDescontinuados = () => {
    const next = !verDescontinuados
    setVerDescontinuados(next)
    verRef.current = next
    setCargando(true)
    cargar(busquedaRef.current, next, stockRef.current, proveedorRef.current)
    refrescarTotal(next, stockRef.current, proveedorRef.current)
    cargarProveedores(next, stockRef.current)
  }

  // ── Toggle ocultar sin stock ──
  const toggleSoloConStock = () => {
    const next = !soloConStock
    setSoloConStock(next)
    stockRef.current = next
    setCargando(true)
    cargar(busquedaRef.current, verRef.current, next, proveedorRef.current)
    refrescarTotal(verRef.current, next, proveedorRef.current)
    cargarProveedores(verRef.current, next)
  }

  // ── Filtro por proveedor ──
  const onCambiarProveedor = (val) => {
    setProveedor(val)
    proveedorRef.current = val
    setCargando(true)
    cargar(busquedaRef.current, verRef.current, stockRef.current, val)
    refrescarTotal(verRef.current, stockRef.current, val)
  }

  // ── Sincronizar inventario desde Laudus ──
  const sincronizar = async () => {
    setSincronizando(true)
    setSyncMsg('')
    try {
      const { data, error } = await supabase.functions.invoke('sync-laudus-inventory')
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Error desconocido en la sincronización')
      localStorage.setItem('laudus_last_sync', data.syncedAt)
      setLastSync(data.syncedAt)
      setSyncMsg(`✅ ${data.upserted} producto${data.upserted !== 1 ? 's' : ''} sincronizado${data.upserted !== 1 ? 's' : ''} desde Laudus`)
      await cargar(busquedaRef.current, verRef.current, stockRef.current, proveedorRef.current)
      await refrescarTotal(verRef.current, stockRef.current, proveedorRef.current)
      await cargarProveedores(verRef.current, stockRef.current)
    } catch (e) {
      setSyncMsg('⚠️ ' + (e.message || String(e)))
    } finally {
      setSincronizando(false)
    }
  }

  const fmtSync = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const hayMas = productos.length >= PAGE_SIZE

  return (
    <div className="page">
      <Header title="Inventario" showBack />

      <div className={`container ${styles.content}`}>

        {/* ── Barra de sincronización con Laudus ── */}
        <div className={styles.syncBar}>
          <div className={styles.syncInfo}>
            <span className={styles.syncLabel}>
              Inventario · Laudus ERP{total != null ? ` · ${total.toLocaleString('es-CL')} productos` : ''}
            </span>
            <span className={styles.syncDate}>
              {lastSync ? `Última sync: ${fmtSync(lastSync)}` : 'Sin sincronizar todavía'}
            </span>
          </div>
          <button className={styles.btnSync} onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? '⏳ Sincronizando…' : '↻ Sincronizar'}
          </button>
        </div>
        {syncMsg && <p className={styles.syncMsg}>{syncMsg}</p>}

        {/* ── Buscador ── */}
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            value={busqueda}
            onChange={e => onBuscar(e.target.value)}
            placeholder="Buscar por nombre o código..."
          />
          {busqueda && (
            <button className={styles.clearBtn} onClick={() => onBuscar('')}>✕</button>
          )}
        </div>

        {/* ── Filtro por proveedor ── */}
        <select
          className={styles.proveedorSelect}
          value={proveedor}
          onChange={e => onCambiarProveedor(e.target.value)}
        >
          <option value="">🏭 Todos los proveedores</option>
          {proveedores.map(p => (
            <option key={p.proveedor} value={p.proveedor}>
              {p.proveedor === '__sin_proveedor__' ? 'Sin proveedor' : p.proveedor} ({p.n})
            </option>
          ))}
        </select>

        {/* ── Toggles de filtro ── */}
        <div className={styles.toggleRow}>
          <label className={styles.toggleDesc}>
            <input
              type="checkbox"
              checked={soloConStock}
              onChange={toggleSoloConStock}
            />
            <span>Solo con stock</span>
          </label>
          <label className={styles.toggleDesc}>
            <input
              type="checkbox"
              checked={verDescontinuados}
              onChange={toggleDescontinuados}
            />
            <span>Ver descontinuados</span>
          </label>
        </div>

        {/* ── Lista ── */}
        {cargando ? (
          <Spinner />
        ) : error ? (
          <div className="empty-state">
            <div className="emoji">⚠️</div>
            <p>{error}</p>
          </div>
        ) : productos.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">{busqueda ? '🔍' : '📦'}</div>
            <p>{busqueda ? `Sin resultados para "${busqueda}"` : 'No hay productos en el inventario'}</p>
            {!busqueda && (
              <p className={styles.emptyHint}>Los productos se sincronizan desde Laudus ERP</p>
            )}
          </div>
        ) : (
          <div className={styles.lista}>
            <p className={styles.contador}>
              {busqueda
                ? `${productos.length}${hayMas ? '+' : ''} resultado${productos.length !== 1 ? 's' : ''}${hayMas ? ' · afiná la búsqueda' : ''}`
                : `Mostrando ${productos.length}${total != null ? ` de ${total.toLocaleString('es-CL')}` : ''} · usá el buscador`}
            </p>
            {productos.map(p => {
              const imgs = parseImagenes(p.imagenes)
              return (
                <div key={p.id} className={`${styles.card} ${p.descontinuado ? styles.cardDesc : ''}`}>
                  {imgs.length > 0 ? (
                    <img
                      src={imgs[0]}
                      alt={p.nombre}
                      className={styles.cardThumb}
                      onClick={() => setImagenFull(imgs[0])}
                      title="Click para ampliar"
                    />
                  ) : (
                    <div className={styles.cardThumbPlaceholder}>📦</div>
                  )}

                  <div className={styles.cardTop}>
                    <div className={styles.cardInfo}>
                      <span className={styles.cardNombre}>{p.nombre}</span>
                      <span className={styles.cardCodigo}>{p.codigo}</span>
                    </div>
                    {p.descontinuado && (
                      <span className={styles.badgeDesc}>Descontinuado</span>
                    )}
                  </div>

                  <div className={styles.cardMiddle}>
                    <span className={styles.categoria}>{p.categoria}</span>
                    <div className={styles.stockRow}>
                      <span className={styles.stockNum}>{p.stock}</span>
                      <span className={styles.stockLabel}>uds</span>
                    </div>
                  </div>

                  {p.proveedor && (
                    <span className={styles.proveedorTag}>🏭 {p.proveedor}</span>
                  )}

                  {p.ubicacion && (
                    <span className={styles.ubicacion}>📍 {p.ubicacion}</span>
                  )}

                  {/* ── Botón Ver producto ── */}
                  <button
                    className={styles.btnVer}
                    onClick={() => setDetalle(p)}
                  >
                    <span>Ver producto</span>
                    <span className={styles.btnVerArrow}>›</span>
                    {imgs.length > 0 && (
                      <span className={styles.btnVerFotos}>🖼️ {imgs.length}</span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          MODAL DETALLE PRODUCTO (solo lectura)
      ══════════════════════════════════════════════ */}
      <Modal
        isOpen={!!detalle}
        onClose={() => setDetalle(null)}
        title="Detalle del producto"
      >
        {detalle && (() => {
          const imgs = parseImagenes(detalle.imagenes)
          return (
            <div className={styles.detalleBody}>
              {/* Nombre + código */}
              <div className={styles.detalleHeader}>
                <div>
                  <h2 className={styles.detalleNombre}>{detalle.nombre}</h2>
                  <span className={styles.detalleCodigo}>{detalle.codigo}</span>
                  {detalle.descontinuado && (
                    <span className={styles.badgeDesc} style={{ marginTop: 6, display: 'inline-block' }}>Descontinuado</span>
                  )}
                </div>
                <div className={styles.detalleStockBadge}>
                  <span className={styles.detalleStockNum}>{detalle.stock}</span>
                  <span className={styles.detalleStockLbl}>uds</span>
                </div>
              </div>

              {/* Categoría */}
              <div className={styles.detalleRow}>
                <span className={styles.detalleLabel}>Categoría</span>
                <span className={styles.detalleCat}>{detalle.categoria}</span>
              </div>

              {/* Proveedor */}
              {detalle.proveedor && (
                <div className={styles.detalleRow}>
                  <span className={styles.detalleLabel}>Proveedor</span>
                  <span className={styles.detalleCat}>🏭 {detalle.proveedor}</span>
                </div>
              )}

              {/* Ubicación */}
              {detalle.ubicacion ? (
                <div className={styles.detalleUbicBox}>
                  <span className={styles.detalleUbicLabel}>📍 Ubicación en bodega</span>
                  <span className={styles.detalleUbicTexto}>{detalle.ubicacion}</span>
                </div>
              ) : (
                <p className={styles.detalleSinUbic}>Sin ubicación registrada</p>
              )}

              {/* Imágenes */}
              {imgs.length > 0 && (
                <div className={styles.detalleImgsBox}>
                  <span className={styles.detalleImgsLabel}>🖼️ Imágenes de referencia ({imgs.length})</span>
                  <div className={styles.detalleImgsScroll}>
                    {imgs.map((uri, i) => (
                      <img
                        key={i}
                        src={uri}
                        alt={`Referencia ${i + 1}`}
                        className={styles.detalleThumb}
                        onClick={() => setImagenFull(uri)}
                        title="Click para ampliar"
                      />
                    ))}
                  </div>
                  <span className={styles.detalleImgsHint}>Haz clic en una imagen para ampliarla</span>
                </div>
              )}

              {/* Cerrar */}
              <div className={styles.detalleAcciones}>
                <button className="btn-outline" onClick={() => setDetalle(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ── Imagen a pantalla completa ── */}
      {imagenFull && (
        <div className={styles.imagenFullOverlay} onClick={() => setImagenFull(null)}>
          <button className={styles.imagenFullCerrar} onClick={() => setImagenFull(null)}>✕</button>
          <img src={imagenFull} alt="Referencia" className={styles.imagenFullImg} />
        </div>
      )}
    </div>
  )
}
