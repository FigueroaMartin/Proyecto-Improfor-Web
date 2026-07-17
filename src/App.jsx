import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ActualizacionBanner from './components/ActualizacionBanner'
import Sidebar          from './components/Sidebar'
import SeleccionPerfil  from './screens/SeleccionPerfil'
import Dashboard        from './screens/Dashboard'
import Despachos        from './screens/Despachos'
import EstadoPedidos    from './screens/EstadoPedidos'
import Importaciones    from './screens/Importaciones'
import Inventario       from './screens/Inventario'
import Pedidos          from './screens/Pedidos'
import ImpresionPedido  from './screens/ImpresionPedido'

// Guard: redirige a '/' si no hay perfil guardado
function RequireAuth({ children }) {
  const perfil = localStorage.getItem('admin_activo')
  if (!perfil) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const location = useLocation()
  const perfil = (() => {
    try { return JSON.parse(localStorage.getItem('admin_activo') || 'null') }
    catch { return null }
  })()
  // El menú lateral solo tiene sentido con sesión iniciada y fuera de la
  // pantalla de selección de perfil.
  const conSidebar = !!perfil && location.pathname !== '/'

  return (
    <>
    <ActualizacionBanner />
    <div className={conSidebar ? 'shell-con-sidebar' : ''}>
      {conSidebar && <Sidebar />}
      <Routes>
        <Route path="/"                element={<SeleccionPerfil />} />
        <Route path="/dashboard"       element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/despachos"       element={<RequireAuth><Despachos /></RequireAuth>} />
        <Route path="/estado-pedidos"  element={<RequireAuth><EstadoPedidos /></RequireAuth>} />
        <Route path="/importaciones"   element={<RequireAuth><Importaciones /></RequireAuth>} />
        <Route path="/inventario"      element={<RequireAuth><Inventario /></RequireAuth>} />
        <Route path="/pedidos"         element={<RequireAuth><Pedidos /></RequireAuth>} />
        <Route path="/impresion-pedido" element={<RequireAuth><ImpresionPedido /></RequireAuth>} />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
    </>
  )
}
