import { Routes, Route, Navigate } from 'react-router-dom'
import ActualizacionBanner from './components/ActualizacionBanner'
import SeleccionPerfil  from './screens/SeleccionPerfil'
import Dashboard        from './screens/Dashboard'
import Despachos        from './screens/Despachos'
import EstadoPedidos    from './screens/EstadoPedidos'
import Importaciones    from './screens/Importaciones'
import Inventario       from './screens/Inventario'
import Pedidos          from './screens/Pedidos'

// Guard: redirige a '/' si no hay perfil guardado
function RequireAuth({ children }) {
  const perfil = localStorage.getItem('admin_activo')
  if (!perfil) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
    <ActualizacionBanner />
    <Routes>
      <Route path="/"                element={<SeleccionPerfil />} />
      <Route path="/dashboard"       element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/despachos"       element={<RequireAuth><Despachos /></RequireAuth>} />
      <Route path="/estado-pedidos"  element={<RequireAuth><EstadoPedidos /></RequireAuth>} />
      <Route path="/importaciones"   element={<RequireAuth><Importaciones /></RequireAuth>} />
      <Route path="/inventario"      element={<RequireAuth><Inventario /></RequireAuth>} />
      <Route path="/pedidos"         element={<RequireAuth><Pedidos /></RequireAuth>} />
      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
