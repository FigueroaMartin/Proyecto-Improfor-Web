import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import Modal   from '../../components/Modal'
import styles  from './Importaciones.module.css'

const fmtFecha = (str) => {
  if (!str) return ''
  const d = new Date(str)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

const hace60dias = () => {
  const d = new Date()
  d.setDate(d.getDate() - 60)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const incluye = (txt, q) => (txt || '').toLowerCase().includes(q.toLowerCase())

export default function Importaciones() {
  const [desde,    setDesde]    = useState(hace60dias())
  const [data,     setData]     = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error,    setError]    = useState('')

  // Buscadores por columna
  const [qPedidos,     setQPedidos]     = useState('')
  const [qProductos,   setQProductos]   = useState('')
  const [qProveedores, setQProveedores] = useState('')
  const [provAbierto,  setProvAbierto]  = useState(null)

  // Modales
  const [detallePedido,   setDetallePedido]   = useState(null)
  const [detalleProducto, setDetalleProducto] = useState(null)

  const buscar = async () => {
    setCargando(true)
    setError('')
    try {
      const { data: res, error } = await supabase.functions.invoke('laudus-importaciones', {
        body: { desde },
      })
      if (error) throw error
      if (!res?.ok) throw new Error(res?.error || 'Error al buscar importaciones')
      setData(res)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  const pedidosQueEsperan = (sku) => {
    if (!data) return []
    return data.pedidos
      .map(o => {
        const linea = o.lines.find(l => l.sku === sku && l.pending > 0)
        return linea ? { ...o, linea } : null
      })
      .filter(Boolean)
  }

  // ── Filtros ──
  const pedidosFiltrados = !data ? [] : data.pedidos.filter(p =>
    !qPedidos ||
    incluye(String(p.salesOrderId), qPedidos) ||
    incluye(p.customer, qPedidos) ||
    p.lines.some(l => incluye(l.desc, qPedidos) || incluye(l.sku, qPedidos))
  )
  const productosFiltrados = !data ? [] : data.productos.filter(p =>
    !qProductos || incluye(p.desc, qProductos) || incluye(p.sku, qProductos)
  )
  const proveedoresFiltrados = !data ? [] : data.proveedores.filter(g =>
    !qProveedores ||
    incluye(g.proveedor, qProveedores) ||
    g.productos.some(p => incluye(p.desc, qProveedores) || incluye(p.sku, qProveedores))
  )

  return (
    <div className="page">
      <Header title="Importaciones" showBack />

      <div className={styles.container}>

        {/* ── Filtros + buscar ── */}
        <div className={styles.filtros}>
          <label className={styles.filtroLabel}>
            Pedidos desde
            <input
              type="date"
              className={styles.fechaInput}
              value={desde}
              onChange={e => setDesde(e.target.value)}
            />
          </label>
          <button className={styles.btnBuscar} onClick={buscar} disabled={cargando}>
            {cargando ? '⏳ Analizando…' : '🔍 Buscar importaciones'}
          </button>
        </div>

        {error && (
          <div className="empty-state"><div className="emoji">⚠️</div><p>{error}</p></div>
        )}

        {cargando ? (
          <Spinner text="Cruzando pedidos pendientes contra el inventario…" />
        ) : !data ? (
          <div className="empty-state">
            <div className="emoji">🚢</div>
            <p>
              Presiona <strong>Buscar importaciones</strong> para extraer los ítems
              pendientes de cada pedido y compararlos con el stock actual.
            </p>
          </div>
        ) : (
          <>
            {/* ── Resumen ── */}
            <div className={styles.resumen}>
              <div className={styles.statBox}>
                <span className={styles.statNum}>{data.resumen.pedidosConFaltantes}</span>
                <span className={styles.statLbl}>Pedidos con faltantes</span>
              </div>
              <div className={styles.statBox}>
                <span className={styles.statNum}>{data.resumen.productosFaltantes}</span>
                <span className={styles.statLbl}>Productos faltantes</span>
              </div>
              <div className={styles.statBox}>
                <span className={styles.statNum}>{data.resumen.proveedores}</span>
                <span className={styles.statLbl}>Proveedores</span>
              </div>
              <div className={`${styles.statBox} ${styles.statBoxAlerta}`}>
                <span className={styles.statNum}>{data.resumen.unidadesFaltantes.toLocaleString('es-CL')}</span>
                <span className={styles.statLbl}>Unidades a importar</span>
              </div>
            </div>

            {data.productos.length === 0 ? (
              <div className="empty-state">
                <div className="emoji">🎉</div>
                <p>El stock actual cubre todos los pedidos pendientes desde {fmtFecha(desde)}.</p>
              </div>
            ) : (
              <div className={styles.columnas}>

                {/* ══ Columna 1: pedidos ══ */}
                <div className={styles.columna}>
                  <div className={`${styles.columnaHeader} ${styles.headerPedidos}`}>
                    📦 Pedidos con faltantes
                    <span className={styles.columnaCount}>{pedidosFiltrados.length}</span>
                  </div>
                  <input
                    className={styles.colSearch}
                    placeholder="Buscar pedido o cliente…"
                    value={qPedidos}
                    onChange={e => setQPedidos(e.target.value)}
                  />

                  {pedidosFiltrados.map(p => {
                    const faltantes = p.lines.filter(l => l.sinStock)
                    return (
                      <button
                        key={p.salesOrderId}
                        className={`${styles.card} ${styles.cardClickable}`}
                        onClick={() => setDetallePedido(p)}
                      >
                        <div className={styles.cardHeader}>
                          <span className={styles.numero}>#{p.salesOrderId}</span>
                          <span className={styles.fecha}>{fmtFecha(p.issuedDate)}</span>
                        </div>
                        <span className={styles.cliente}>👤 {p.customer || 'Sin cliente'}</span>
                        <div className={styles.lineas}>
                          {faltantes.map((l, i) => (
                            <div key={i} className={styles.linea}>
                              <div className={styles.lineaInfo}>
                                <span className={styles.lineaNombre}>{l.desc}</span>
                                <span className={styles.lineaSku}>{l.sku}</span>
                              </div>
                              <span className={styles.lineaFalta}>falta {l.pending}/{l.qty}</span>
                            </div>
                          ))}
                        </div>
                        <span className={styles.verMas}>Ver detalle del pedido ›</span>
                      </button>
                    )
                  })}
                </div>

                {/* ══ Columna 2: productos ══ */}
                <div className={styles.columna}>
                  <div className={`${styles.columnaHeader} ${styles.headerProductos}`}>
                    🛒 Productos a importar
                    <span className={styles.columnaCount}>{productosFiltrados.length}</span>
                  </div>
                  <input
                    className={styles.colSearch}
                    placeholder="Buscar producto o SKU…"
                    value={qProductos}
                    onChange={e => setQProductos(e.target.value)}
                  />

                  {productosFiltrados.map(prod => (
                    <button
                      key={prod.sku}
                      className={`${styles.card} ${styles.cardProducto} ${styles.cardClickable}`}
                      onClick={() => setDetalleProducto(prod)}
                    >
                      <div className={styles.prodInfo}>
                        <span className={styles.prodNombre}>{prod.desc}</span>
                        <span className={styles.prodSku}>{prod.sku} · 🚢 {prod.proveedor}</span>
                        <span className={styles.prodDetalle}>
                          Pedido por clientes: <strong>{prod.totalPedido}</strong> · Pendiente: <strong>{prod.pendiente}</strong> · Stock: <strong>{prod.stock}</strong>
                          {prod.enTransito > 0 && <> · 🚢 Ya pedido al proveedor: <strong>{prod.enTransito}</strong></>}
                        </span>
                      </div>
                      <div className={styles.faltanteBadge}>
                        <span className={styles.faltanteNum}>{prod.faltante.toLocaleString('es-CL')}</span>
                        <span className={styles.faltanteLbl}>faltan</span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* ══ Columna 3: proveedores (acordeón) ══ */}
                <div className={styles.columna}>
                  <div className={`${styles.columnaHeader} ${styles.headerProveedores}`}>
                    🚢 Por proveedor
                    <span className={styles.columnaCount}>{proveedoresFiltrados.length}</span>
                  </div>
                  <input
                    className={styles.colSearch}
                    placeholder="Buscar proveedor…"
                    value={qProveedores}
                    onChange={e => setQProveedores(e.target.value)}
                  />

                  {proveedoresFiltrados.map(g => {
                    const abierto = provAbierto === g.proveedor
                    return (
                      <div key={g.proveedor} className={styles.provGroup}>
                        <button
                          className={styles.provHeader}
                          onClick={() => setProvAbierto(abierto ? null : g.proveedor)}
                        >
                          <span className={styles.provFlecha}>{abierto ? '▾' : '▸'}</span>
                          <div className={styles.provInfo}>
                            <span className={styles.provNombre}>{g.proveedor}</span>
                            <span className={styles.provMeta}>
                              {g.productos.length} producto{g.productos.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className={styles.faltanteBadge}>
                            <span className={styles.faltanteNum}>{g.totalFaltante.toLocaleString('es-CL')}</span>
                            <span className={styles.faltanteLbl}>uds</span>
                          </div>
                        </button>

                        {abierto && (
                          <div className={styles.provProductos}>
                            {g.productos.map(prod => (
                              <button
                                key={prod.sku}
                                className={`${styles.linea} ${styles.lineaClickable}`}
                                onClick={() => setDetalleProducto(prod)}
                                title="Ver detalle del producto"
                              >
                                <div className={styles.lineaInfo}>
                                  <span className={styles.lineaNombre}>{prod.desc}</span>
                                  <span className={styles.lineaSku}>{prod.sku}</span>
                                </div>
                                <span className={styles.lineaFalta}>{prod.faltante}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ MODAL pedido ══ */}
      <Modal
        isOpen={!!detallePedido}
        onClose={() => setDetallePedido(null)}
        title={detallePedido ? `Pedido #${detallePedido.salesOrderId}` : ''}
      >
        {detallePedido && (() => {
          const sinStock  = detallePedido.lines.filter(l => l.sinStock)
          const conStock  = detallePedido.lines.filter(l => l.pending > 0 && !l.sinStock)
          const cubiertas = detallePedido.lines.filter(l => l.pending === 0)
          return (
            <div className={styles.modalBody}>
              <div className={styles.modalInfoRow}>
                <span className={styles.cliente}>👤 {detallePedido.customer || 'Sin cliente'}</span>
                <span className={styles.fecha}>{fmtFecha(detallePedido.issuedDate)}</span>
              </div>

              {sinStock.length > 0 && (
                <div className={styles.modalSec}>
                  <h4 className={`${styles.secTitulo} ${styles.secRojo}`}>🔴 Sin stock suficiente ({sinStock.length})</h4>
                  {sinStock.map((l, i) => (
                    <div key={i} className={styles.linea}>
                      <div className={styles.lineaInfo}>
                        <span className={styles.lineaNombre}>{l.desc}</span>
                        <span className={styles.lineaSku}>{l.sku}</span>
                      </div>
                      <span className={styles.lineaFalta}>falta {l.pending}/{l.qty}</span>
                    </div>
                  ))}
                </div>
              )}

              {conStock.length > 0 && (
                <div className={styles.modalSec}>
                  <h4 className={`${styles.secTitulo} ${styles.secAmbar}`}>⏳ Pendiente con stock disponible ({conStock.length})</h4>
                  {conStock.map((l, i) => (
                    <div key={i} className={`${styles.linea} ${styles.lineaAmbar}`}>
                      <div className={styles.lineaInfo}>
                        <span className={styles.lineaNombre}>{l.desc}</span>
                        <span className={styles.lineaSku}>{l.sku}</span>
                      </div>
                      <span className={styles.lineaPend}>pend. {l.pending}/{l.qty}</span>
                    </div>
                  ))}
                </div>
              )}

              {cubiertas.length > 0 && (
                <div className={styles.modalSec}>
                  <h4 className={`${styles.secTitulo} ${styles.secVerde}`}>✅ Emitido / cubierto ({cubiertas.length})</h4>
                  {cubiertas.map((l, i) => (
                    <div key={i} className={`${styles.linea} ${styles.lineaVerde}`}>
                      <div className={styles.lineaInfo}>
                        <span className={styles.lineaNombre}>{l.desc}</span>
                        <span className={styles.lineaSku}>{l.sku}</span>
                      </div>
                      <span className={styles.lineaOk}>{l.effective}/{l.qty} ✓</span>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn-outline" onClick={() => setDetallePedido(null)}>Cerrar</button>
            </div>
          )
        })()}
      </Modal>

      {/* ══ MODAL producto ══ */}
      <Modal
        isOpen={!!detalleProducto}
        onClose={() => setDetalleProducto(null)}
        title="Producto faltante"
      >
        {detalleProducto && (() => {
          const esperan = pedidosQueEsperan(detalleProducto.sku)
          return (
            <div className={styles.modalBody}>
              <div className={styles.prodModalHeader}>
                <span className={styles.prodNombre}>{detalleProducto.desc}</span>
                <span className={styles.prodSku}>{detalleProducto.sku} · 🚢 {detalleProducto.proveedor}</span>
              </div>

              <div className={styles.prodStats}>
                <div className={styles.prodStat}>
                  <span className={styles.prodStatNum}>{detalleProducto.totalPedido}</span>
                  <span className={styles.prodStatLbl}>Pedido clientes</span>
                </div>
                <div className={styles.prodStat}>
                  <span className={styles.prodStatNum}>{detalleProducto.pendiente}</span>
                  <span className={styles.prodStatLbl}>Pendiente</span>
                </div>
                <div className={styles.prodStat}>
                  <span className={styles.prodStatNum}>{detalleProducto.stock}</span>
                  <span className={styles.prodStatLbl}>Stock</span>
                </div>
                <div className={styles.prodStat}>
                  <span className={styles.prodStatNum}>{detalleProducto.enTransito ?? 0}</span>
                  <span className={styles.prodStatLbl}>🚢 Al proveedor</span>
                </div>
                <div className={`${styles.prodStat} ${styles.prodStatAlerta}`}>
                  <span className={styles.prodStatNum}>{detalleProducto.faltante.toLocaleString('es-CL')}</span>
                  <span className={styles.prodStatLbl}>Faltan</span>
                </div>
              </div>

              <div className={styles.modalSec}>
                <h4 className={`${styles.secTitulo} ${styles.secRojo}`}>📦 Pedidos que lo esperan ({esperan.length})</h4>
                {esperan.map(o => (
                  <button
                    key={o.salesOrderId}
                    className={`${styles.linea} ${styles.lineaClickable}`}
                    onClick={() => { setDetalleProducto(null); setDetallePedido(o) }}
                    title="Ver detalle del pedido"
                  >
                    <div className={styles.lineaInfo}>
                      <span className={styles.lineaNombre}>#{o.salesOrderId} · {o.customer || 'Sin cliente'}</span>
                      <span className={styles.lineaSku}>{fmtFecha(o.issuedDate)}</span>
                    </div>
                    <span className={styles.lineaFalta}>espera {o.linea.pending}</span>
                  </button>
                ))}
              </div>

              <button className="btn-outline" onClick={() => setDetalleProducto(null)}>Cerrar</button>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
