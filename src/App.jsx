import { Routes, Route, Navigate } from 'react-router-dom'
import SeleccionPerfil  from './screens/SeleccionPerfil'
import Dashboard        from './screens/Dashboard'
import AgregarProducto  from './screens/AgregarProducto'
import Escanear         from './screens/Escanear'
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
    <Routes>
      <Route path="/"                element={<SeleccionPerfil />} />
      <Route path="/dashboard"       element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/agregar-producto" element={<RequireAuth><AgregarProducto /></RequireAuth>} />
      <Route path="/escanear"        element={<RequireAuth><Escanear /></RequireAuth>} />
      <Route path="/inventario"      element={<RequireAuth><Inventario /></RequireAuth>} />
      <Route path="/pedidos"         element={<RequireAuth><Pedidos /></RequireAuth>} />
      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
