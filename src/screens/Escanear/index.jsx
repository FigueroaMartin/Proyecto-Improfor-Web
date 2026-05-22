import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import Header from '../../components/Header'
import styles from './Escanear.module.css'

export default function Escanear() {
  const navigate   = useNavigate()
  const qrInstance = useRef(null)
  const [estado,   setEstado]   = useState('iniciando') // iniciando | activo | error
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let qr = null

    const start = async () => {
      try {
        qr = new Html5Qrcode('qr-reader', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
          verbose: false,
        })
        qrInstance.current = qr

        await qr.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 260, height: 160 } },
          (decoded) => {
            // Éxito: detener y redirigir
            qr.stop().catch(() => {}).finally(() => {
              navigate(`/agregar-producto?codigo=${encodeURIComponent(decoded)}`)
            })
          },
          () => {} // errores de frame: ignorar
        )
        setEstado('activo')
      } catch (err) {
        setEstado('error')
        setErrorMsg(
          err?.message?.includes('permission')
            ? 'No se concedió permiso para usar la cámara.'
            : 'No se pudo iniciar la cámara: ' + (err?.message || err)
        )
      }
    }

    start()

    return () => {
      if (qrInstance.current) {
        qrInstance.current.stop().catch(() => {})
      }
    }
  }, [])

  const cancelar = async () => {
    if (qrInstance.current) {
      await qrInstance.current.stop().catch(() => {})
    }
    navigate(-1)
  }

  return (
    <div className={styles.page}>
      <Header title="Escanear Código" showBack />

      <div className={styles.body}>
        {/* Contenedor del visor */}
        <div className={styles.scannerWrapper}>
          {/* El div #qr-reader es donde html5-qrcode inyecta el video */}
          <div id="qr-reader" className={styles.qrReader} />

          {/* Overlay con mirilla (pointer-events: none para no bloquear el video) */}
          {estado === 'activo' && (
            <div className={styles.overlay}>
              <p className={styles.tip}>Escanea el código del producto</p>
              <div className={styles.frame}>
                <div className={`${styles.corner} ${styles.tl}`} />
                <div className={`${styles.corner} ${styles.tr}`} />
                <div className={`${styles.corner} ${styles.bl}`} />
                <div className={`${styles.corner} ${styles.br}`} />
              </div>
              <p className={styles.sub}>EAN13 · Code128 · QR · UPC</p>
            </div>
          )}

          {/* Estado: iniciando */}
          {estado === 'iniciando' && (
            <div className={styles.overlay}>
              <div className={styles.spinner} />
              <p className={styles.tip}>Iniciando cámara...</p>
            </div>
          )}

          {/* Estado: error */}
          {estado === 'error' && (
            <div className={`${styles.overlay} ${styles.overlayError}`}>
              <p className={styles.errorEmoji}>📷</p>
              <p className={styles.errorMsg}>{errorMsg}</p>
            </div>
          )}
        </div>

        <button className={styles.btnCancelar} onClick={cancelar}>
          ✕  Cancelar
        </button>
      </div>
    </div>
  )
}
