# Improfor Web Admin

Panel web de administración para el sistema de despacho EPP **Improfor**.  
Comparte la misma base de datos Supabase que la app móvil Expo.

---

## Stack

| Capa       | Tecnología                          |
|------------|-------------------------------------|
| Framework  | React 18 + Vite 6                   |
| Estilos    | CSS Modules + CSS puro              |
| Base datos | Supabase (compartida con app móvil) |
| Navegación | React Router v6                     |
| Escáner    | html5-qrcode (webcam)               |
| Deploy     | GitHub Pages via gh-pages           |

---

## Instalación local

```bash
# 1. Clonar el repositorio
git clone https://github.com/TU_USUARIO/improfor-web.git
cd improfor-web

# 2. Instalar dependencias
npm install

# 3. Crear el archivo de variables de entorno
cp .env.example .env
# Editar .env con tus credenciales Supabase reales

# 4. Correr en modo desarrollo
npm run dev
# → http://localhost:5173/improfor-web/
```

> **⚠️ IMPORTANTE:** El archivo `.env` nunca debe subirse a GitHub.  
> Ya está en `.gitignore`. Solo `.env.example` se sube al repositorio.

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto con:

```env
VITE_SUPABASE_URL=https://ffbsntjrevtnafjaeuny.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_nAlopKjXZ9QflX78Am66MQ_NgMx_Od2
```

---

## Deploy en GitHub Pages

### Primera vez (configuración inicial)

```bash
# 1. Crear repositorio en GitHub llamado exactamente: improfor-web
#    (debe coincidir con el basename de React Router y el base de Vite)

# 2. Inicializar git y conectar con el repo remoto
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/improfor-web.git
git push -u origin main

# 3. Hacer el primer deploy
npm run deploy
# Esto ejecuta: vite build → gh-pages -d dist
# Sube la carpeta dist/ a la rama gh-pages automáticamente

# 4. Activar GitHub Pages
# Ir a: GitHub repo → Settings → Pages
# Source: Deploy from a branch
# Branch: gh-pages / (root)
# → Guardar

# 5. URL final (disponible en ~2 minutos):
# https://TU_USUARIO.github.io/improfor-web/
```

### Deploys posteriores

```bash
npm run build   # opcional, deploy ya lo incluye
npm run deploy  # build + sube a gh-pages
```

### ⚠️ Si cambias el nombre del repositorio

Actualiza estos dos archivos:

**`vite.config.js`:**
```js
base: '/NUEVO_NOMBRE_REPO/',
```

**`src/main.jsx`:**
```jsx
<BrowserRouter basename="/NUEVO_NOMBRE_REPO">
```

---

## Correr en paralelo con la app móvil

La app móvil y la web comparten exactamente las mismas tablas Supabase.
No hay conflicto — ambas pueden estar activas al mismo tiempo.

```
┌─────────────────┐         ┌─────────────────────────────┐
│  App móvil      │  ←───→  │  Supabase                   │
│  (Expo)         │         │  - productos                │
└─────────────────┘         │  - pedidos                  │
                            │  - bodegueros               │
┌─────────────────┐  ←───→  │  - items_pedido             │
│  Web admin      │         └─────────────────────────────┘
│  (React+Vite)   │
└─────────────────┘
```

**Realtime activo:**
- Cuando la app móvil modifica un producto → la web se actualiza sola (sin recargar)
- Cuando la web modifica un producto → la app móvil se actualiza sola

Esto funciona gracias a `supabase.channel().on('postgres_changes').subscribe()` en:
- `src/screens/Inventario/index.jsx`
- `src/screens/Pedidos/index.jsx`

---

## Estructura del proyecto

```
improfor-web/
├── public/
│   └── 404.html              # Redirect para SPA en GitHub Pages
├── src/
│   ├── lib/
│   │   └── supabase.js       # Cliente Supabase (usa variables .env)
│   ├── db/
│   │   └── index.js          # Funciones DB (misma firma que app móvil)
│   ├── components/
│   │   ├── Header/           # Barra de navegación superior
│   │   ├── Spinner/          # Indicador de carga
│   │   └── Modal/            # Modal genérico (edición)
│   ├── screens/
│   │   ├── SeleccionPerfil/  # / — login por perfil
│   │   ├── Dashboard/        # /dashboard — menú principal
│   │   ├── AgregarProducto/  # /agregar-producto
│   │   ├── Escanear/         # /escanear — webcam barcode
│   │   ├── Inventario/       # /inventario — lista + editar
│   │   └── Pedidos/          # /pedidos — activos/cerrados
│   ├── styles/
│   │   └── global.css        # Variables CSS y reset
│   ├── App.jsx               # Rutas + guards de auth
│   └── main.jsx              # Entry point
├── index.html
├── vite.config.js            # base: '/improfor-web/'
├── package.json
├── .env.example
└── .gitignore                # .env está excluido
```

---

## Pantallas

| Ruta               | Pantalla          | Descripción                              |
|--------------------|-------------------|------------------------------------------|
| `/`                | Selección Perfil  | Login por nombre (solo admins)           |
| `/dashboard`       | Dashboard         | Menú de navegación con cards             |
| `/agregar-producto`| Agregar Producto  | Formulario nuevo producto                |
| `/escanear`        | Escanear          | Webcam → redirige a agregar con código   |
| `/inventario`      | Inventario        | Lista, buscar, editar, eliminar          |
| `/pedidos`         | Pedidos           | Tabs Activos / Cerrados con realtime     |
