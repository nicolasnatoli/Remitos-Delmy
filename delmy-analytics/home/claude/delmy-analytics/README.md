# Delmy Analytics

Sistema de análisis de ventas para Delmy Party SRL.

## Stack
- **Frontend**: React 18 + Vite
- **Backend**: Node.js + Express
- **Base de datos**: SQLite (better-sqlite3)
- **Deploy**: Railway

---

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Desarrollo (frontend + backend en paralelo)
npm run dev
# Frontend: http://localhost:5174
# Backend:  http://localhost:3001

# 3. Solo backend
npm run server

# 4. Build producción
npm run build
npm start
```

---

## Deploy en Railway

### Opción A — Nuevo servicio en el mismo proyecto Remitos-Delmy

1. En Railway → tu proyecto → **+ New Service** → **GitHub Repo**
2. Apuntar al repo `nicolasnatoli/Remitos-Delmy`
3. En **Settings → Root Directory** → poner `/analytics` (si está en subcarpeta)
4. Variables de entorno:
   ```
   NODE_ENV=production
   PORT=3001
   DB_PATH=/app/data/analytics.db
   ```
5. En **Settings → Volumes** → montar `/app/data` para persistir la BD

### Opción B — Repo propio

1. Crear repo `nicolasnatoli/delmy-analytics`
2. Copiar esta carpeta al repo
3. Seguir los mismos pasos de Railway

---

## Uso

### Carga de planillas

1. Ir a la pestaña **↑ CARGAS**
2. Arrastrar o seleccionar una planilla mensual: `DELMY PARTY SRL_DetalleDeVentasRealizadas_DD-MM-YYYY - DD-MM-YYYY.xlsx`
3. El sistema parsea y carga automáticamente
4. Para cargar el histórico: subir cada planilla mensual 2025 + 2026

### Formato de planilla aceptado
- Exportación del sistema de gestión Delmy
- Tipo: "encabezados, detalles, valores"
- Hoja: "Detalle de ventas realizadas"
- 79 columnas, fila 2 = encabezados, filas siguientes = datos
- Tipos de fila: Encabezado | Detalle | Forma de pago

### Idempotencia
- Podés subir la misma planilla N veces sin duplicados
- La clave única es `Nro. comprobante`
- Los datos siempre se actualizan con los más recientes

---

## Estructura de archivos

```
analytics/
├── server/
│   └── index.js          # Express + SQLite + parser de planillas
├── src/
│   ├── App.jsx            # Layout + navegación
│   ├── main.jsx
│   ├── index.css
│   ├── hooks/
│   │   └── useFetch.js
│   ├── components/
│   │   └── shared/
│   │       ├── FilterBar.jsx
│   │       ├── KpiCard.jsx
│   │       └── Charts.jsx  (SVG puro, sin deps externas)
│   └── pages/
│       ├── Dashboard.jsx   # KPIs + evolución + top artículos
│       ├── Ventas.jsx       # Análisis temporal
│       ├── Articulos.jsx    # Ranking + detalle
│       ├── Sucursales.jsx   # Comparativo sucursales
│       ├── Finanzas.jsx     # IVA + márgenes + estructura resultado
│       └── Cargas.jsx       # Upload + historial
├── data/                   # BD SQLite (gitignored)
├── railway.toml
├── package.json
└── vite.config.js
```

---

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | 3001 | Puerto del servidor |
| `NODE_ENV` | development | Entorno |
| `DB_PATH` | ./data/analytics.db | Ruta a la BD SQLite |

---

## API endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/upload` | Subir planilla de ventas |
| GET | `/api/kpis` | KPIs principales |
| GET | `/api/ventas/por-dia` | Ventas diarias |
| GET | `/api/ventas/por-mes` | Ventas mensuales por sucursal |
| GET | `/api/ventas/por-sucursal` | Totales por sucursal |
| GET | `/api/articulos/ranking` | Ranking de artículos |
| GET | `/api/articulos/:codigo` | Detalle de artículo |
| GET | `/api/finanzas/resumen` | IVA, márgenes, tipos comprobante |
| GET | `/api/uploads` | Historial de cargas |
| DELETE | `/api/uploads/:id` | Eliminar una carga |
| GET | `/api/sucursales` | Sucursales disponibles |
| GET | `/api/fechas-rango` | Rango de fechas en la BD |

Todos los endpoints de consulta aceptan query params: `desde`, `hasta`, `sucursal`

---

Industrial Partner para Delmy Party SRL — 2026
