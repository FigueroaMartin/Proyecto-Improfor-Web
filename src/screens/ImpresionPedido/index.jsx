import { useState } from 'react'
import { getPedidos, getPedidoParaImprimir } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import styles  from './ImpresionPedido.module.css'

const fmtFechaHora = (str) => {
  if (!str) return ''
  const d = new Date(str)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const fmtPlata = (n) => n == null ? '' : Math.round(n).toLocaleString('es-CL')

const ENTREGA_LABEL = {
  salida_bodega: 'Salida de bodega (SV)',
}

export default function ImpresionPedido() {
  const [q,         setQ]         = useState('')
  const [buscando,  setBuscando]  = useState(false)
  const [resultados, setResultados] = useState([])
  const [cargando,  setCargando]  = useState(false)
  const [pedido,    setPedido]    = useState(null)
  const [error,     setError]     = useState('')

  const buscar = async () => {
    setBuscando(true)
    setError('')
    try {
      const todos = await getPedidos()
      const t = q.trim().toLowerCase()
      const filtrados = !t ? todos.slice(0, 20) : todos.filter(p =>
        (p.numero_pedido || '').toLowerCase().includes(t) ||
        (p.cliente_nombre || '').toLowerCase().includes(t)
      ).slice(0, 20)
      setResultados(filtrados)
      setPedido(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBuscando(false)
    }
  }

  const elegir = async (id) => {
    setCargando(true)
    setError('')
    try {
      const p = await getPedidoParaImprimir(id)
      if (!p) throw new Error('No se pudo cargar el pedido')
      setPedido(p)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  const totalNeto = pedido
    ? pedido.items.reduce((s, it) => s + (it.precio_unit != null ? it.precio_unit * it.cantidad_pedida : 0), 0)
    : 0
  const hayPrecios = pedido ? pedido.items.some(it => it.precio_unit != null) : false
  const iva = hayPrecios ? Math.round(totalNeto * 0.19) : null
  const totalConIva = hayPrecios ? totalNeto + iva : null

  const entregaTexto = pedido
    ? (ENTREGA_LABEL[pedido.tipo_despacho] || pedido.carrier || '')
    : ''

  return (
    <div className="page">
      <Header title="Impresión de pedido" showBack />

      <div className={styles.container}>
        <div className={styles.buscador}>
          <input
            className="input"
            placeholder="Buscar por N° de pedido o cliente…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscar()}
          />
          <button className="btn-primary" onClick={buscar} disabled={buscando} style={{ width: 'auto', padding: '10px 18px' }}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {error && <div className="empty-state"><div className="emoji">⚠️</div><p>{error}</p></div>}

        {resultados.length > 0 && !pedido && (
          <div className={styles.lista}>
            {resultados.map(p => (
              <button key={p.id} className={styles.resultado} onClick={() => elegir(p.id)}>
                <span className={styles.resNumero}>{p.numero_pedido}</span>
                <span className={styles.resCliente}>{p.cliente_nombre || 'Sin cliente'}</span>
              </button>
            ))}
          </div>
        )}

        {cargando && <Spinner text="Cargando pedido…" />}

        {pedido && (
          <div className={styles.accionesDoc}>
            <button className="btn-outline" onClick={() => setPedido(null)}>‹ Elegir otro pedido</button>
            <button className="btn-primary" onClick={() => window.print()} style={{ width: 'auto', padding: '10px 18px' }}>
              🖨️ Imprimir
            </button>
          </div>
        )}
      </div>

      {pedido && (
        <div id="printArea" className={styles.doc}>
          <div className={styles.docHeader}>
            <div>
              <div className={styles.empresa}>Sociedad de Importación y Exportación Improfor Limitada</div>
              <div className={styles.empresaRut}>RUT: 77.127.510-9</div>
            </div>
            <div className={styles.pedidoNum}>
              Pedido N° <strong>{pedido.numero_pedido}</strong>
            </div>
          </div>

          <table className={styles.infoTabla}>
            <tbody>
              <tr>
                <td className={styles.lbl}>Cliente</td>
                <td colSpan={3}>{pedido.cliente_nombre || ''}</td>
                <td className={styles.lbl}>RUT</td>
                <td>{pedido.cliente_rut || ''}</td>
              </tr>
              <tr>
                <td className={styles.lbl}>Contacto</td>
                <td></td>
                <td className={styles.lbl}>Teléfono contacto</td>
                <td></td>
                <td className={styles.lbl}>Vendedor</td>
                <td></td>
              </tr>
              <tr>
                <td className={styles.lbl}>Forma de pago</td>
                <td></td>
                <td className={styles.lbl}>OC</td>
                <td></td>
                <td className={styles.lbl}>Cotización</td>
                <td></td>
              </tr>
              <tr>
                <td className={styles.lbl}>Verificador</td>
                <td>{pedido.bodeguero_nombre || ''}</td>
                <td className={styles.lbl}>Previsto</td>
                <td></td>
                <td className={styles.lbl}>Entrega</td>
                <td>{entregaTexto}</td>
              </tr>
              <tr>
                <td className={styles.lbl}>Fecha/Hora</td>
                <td>{fmtFechaHora(pedido.creado_en)}</td>
                <td className={styles.lbl}>Dirección</td>
                <td></td>
                <td className={styles.lbl}>Comuna</td>
                <td></td>
              </tr>
              <tr>
                <td className={styles.lbl}>Ciudad</td>
                <td></td>
                <td className={styles.lbl}>País</td>
                <td></td>
                <td className={styles.lbl}>Email</td>
                <td></td>
              </tr>
              <tr>
                <td className={styles.lbl}>Notas</td>
                <td colSpan={5} className={pedido.notas_admin ? styles.notasResaltado : ''}>
                  {pedido.notas_admin || ''}
                </td>
              </tr>
            </tbody>
          </table>

          <table className={styles.itemsTabla}>
            <thead>
              <tr>
                <th>N° Item</th>
                <th>Producto</th>
                <th>Guía</th>
                <th>Descripción</th>
                <th>Cantidad pedida</th>
                <th>Precio unit. en CLP</th>
                <th>Total neto</th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((it, i) => (
                <tr key={it.id}>
                  <td className={styles.center}>{i + 1}</td>
                  <td>{it.producto_codigo || ''}</td>
                  <td></td>
                  <td>{it.producto_nombre || ''}</td>
                  <td className={styles.right}>{it.cantidad_pedida}</td>
                  <td className={styles.right}>{fmtPlata(it.precio_unit)}</td>
                  <td className={styles.right}>{it.precio_unit != null ? fmtPlata(it.precio_unit * it.cantidad_pedida) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.totales}>
            <div className={styles.totalRow}>
              <span>Total Neto en CLP</span>
              <span>{hayPrecios ? fmtPlata(totalNeto) : ''}</span>
            </div>
            <div className={styles.totalRow}>
              <span>IVA</span>
              <span>{hayPrecios ? fmtPlata(iva) : ''}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.totalFinal}`}>
              <span>Total con IVA</span>
              <span>{hayPrecios ? fmtPlata(totalConIva) : ''}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
