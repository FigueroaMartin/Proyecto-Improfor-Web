import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Identificador único de este build. Cambia en cada deploy y sirve para
// detectar (desde la app ya cargada) cuándo hay una versión nueva publicada.
const BUILD_ID = Date.now().toString()

// Escribe dist/version.json al terminar el build. La app lo consulta con
// cache:'no-store' y, si la versión difiere de la que está corriendo,
// muestra el banner "Actualizar".
function versionJsonPlugin() {
  return {
    name: 'improfor-version-json',
    apply: 'build',
    closeBundle() {
      writeFileSync(resolve('dist', 'version.json'), JSON.stringify({ version: BUILD_ID }))
    },
  }
}

export default defineConfig({
  base: '/Proyecto-Improfor-Web/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), versionJsonPlugin()],
})
