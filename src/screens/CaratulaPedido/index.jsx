import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getPedidos } from '../../db'
import Header  from '../../components/Header'
import Spinner from '../../components/Spinner'
import styles  from './CaratulaPedido.module.css'

const TAMANOS = {
  pequeno: { label: 'Pequeño', clase: 'tPequeno' },
  mediano: { label: 'Mediano', clase: 'tMediano' },
  grande:  { label: 'Grande',  clase: 'tGrande' },
}

export default function CaratulaPedido() {
  const [q,          setQ]          = useState('')
  const [buscando,   setBuscando]   = useState(false)
  const [resultados, setResultados] = useState([])
  const [cargando,   setCargando]   = useState(false)
  const [datos,      setDatos]      = useState(null)
  const [error,      setError]      = useState('')

  const [cantidadCajas, setCantidadCajas] = useState(1)
  const [tamano,        setTamano]        = useState('mediano')

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
      setDatos(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBuscando(false)
    }
  }

  const elegir = async (pedidoId) => {
    setCargando(true)
    setError('')
    try {
      const { data, error: err } = await supabase.functions.invoke('caratula-pedido', {
        body: { pedidoId },
      })
      if (err) throw err
      if (!data?.ok) throw new Error(data?.error || 'No se pudo cargar la carátula')
      setDatos(data)
      setCantidadCajas(1)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCargando(false)
    }
  }

  // El folio de guía se guarda como id interno de Laudus (puede venir
  // negativo); se muestra siempre en positivo, es solo cosmético.
  const docNumeroVisible = datos?.docNumero != null ? String(Math.abs(Number(datos.docNumero))) : ''

  const cajas = datos ? Array.from({ length: Math.max(1, cantidadCajas) }, (_, i) => i + 1) : []

  return (
    <div className="page">
      <Header title="Generador de carátulas" showBack />

      <div className={styles.container}>
        <div className={styles.buscador}>
          <input
            className="input"
            placeholder="Buscar por N° de pedido o cliente…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className={`btn-primary ${styles.btnAuto}`} onClick={buscar} disabled={buscando}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {error && <div className="empty-state"><div className="emoji">⚠️</div><p>{error}</p></div>}

        {resultados.length > 0 && !datos && (
          <div className={styles.lista}>
            {resultados.map(p => (
              <button key={p.id} className={styles.resultado} onClick={() => elegir(p.id)}>
                <span className={styles.resNumero}>{p.numero_pedido}</span>
                <span className={styles.resCliente}>{p.cliente_nombre || 'Sin cliente'}</span>
              </button>
            ))}
          </div>
        )}

        {cargando && <Spinner text="Cargando datos del pedido…" />}

        {datos && (
          <div className={styles.controles}>
            <button className="btn-outline" onClick={() => setDatos(null)}>‹ Elegir otro pedido</button>

            <label className={styles.controlLbl}>
              N° de cajas
              <input
                type="number" min="1" max="50"
                className={`input ${styles.inputCajas}`}
                value={cantidadCajas}
                onChange={e => setCantidadCajas(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>

            <div className={styles.tamanoGrupo}>
              {Object.entries(TAMANOS).map(([key, t]) => (
                <button
                  key={key}
                  className={`${styles.tamanoBtn} ${tamano === key ? styles.tamanoActivo : ''}`}
                  onClick={() => setTamano(key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button className={`btn-primary ${styles.btnAuto}`} onClick={() => window.print()}>
              🖨️ Imprimir ({cajas.length})
            </button>
          </div>
        )}
      </div>

      {datos && (
        <div id="printArea" className={styles.hojaCaratulas}>
          {cajas.map(n => (
            <div key={n} className={`${styles.caratula} ${styles[TAMANOS[tamano].clase]}`}>
              {/* Encabezado: tipo de documento + N° (sin logo) */}
              <div className={styles.caja + ' ' + styles.encabezado}>
                <div className={styles.docTipo}>{(datos.docTipo || (datos.tipoDespacho === 'salida_bodega' ? 'Salida de bodega' : '')).toUpperCase()}</div>
                <div className={styles.docNumero}>{docNumeroVisible}</div>
              </div>

              {/* Cliente destinatario */}
              <div className={styles.caja}>
                <div className={styles.lbl}>SRES :</div>
                <div className={styles.valGrande}>{(datos.cliente || '').toUpperCase()}</div>
                {datos.direccion && <div className={styles.valGrande}>{datos.direccion.toUpperCase()}</div>}
                {datos.comuna && <div className={styles.valGrande}>{datos.comuna.toUpperCase()}</div>}
              </div>

              {/* Transportista + cargo cuenta */}
              {datos.transportista && (
                <div className={`${styles.caja} ${styles.transpCaja}`}>
                  <div className={styles.transportista}>{datos.transportista.toUpperCase()}</div>
                  <div className={styles.transportista}>CARGO CUENTA</div>
                  <div className={styles.transportista}>IMPROFOR</div>
                </div>
              )}

              {/* Contacto: Att. Sr. / nombre / fono / OC */}
              <div className={styles.caja}>
                <div className={styles.lbl}>ATT. SR.</div>
                {datos.contacto && <div className={styles.val}>{datos.contacto.toUpperCase()}</div>}
                {datos.telefonoContacto && <div className={styles.val}>FONO: {datos.telefonoContacto}</div>}
                {datos.oc && <div className={styles.val}>OC {datos.oc}</div>}
              </div>

              {/* Cantidad de cajas + remitente, lado a lado */}
              <div className={styles.filaFinal}>
                <div className={`${styles.caja} ${styles.cajaNum}`}>
                  <div className={styles.lbl}>BOX QUANTITY</div>
                  <div className={styles.cajaNumBox}>
                    {String(n).padStart(2, '0')}/{String(cajas.length).padStart(2, '0')}
                  </div>
                </div>
                <div className={`${styles.caja} ${styles.remitente}`}>
                  <div>IMPROFOR LTDA.</div>
                  <div>CALLE BUSTOS 2154</div>
                  <div>PROVIDENCIA.</div>
                  <div>Stgo  tel: 562-2-495-7766</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
