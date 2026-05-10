# Delmy Party SRL — Sistema de Gestión Operativa

Sistema web para gestión de compras, almacenamiento y reposición de mercadería.  
Desarrollado por **Industrial Partner**.

---

## Módulos

### Módulo A — Recepción de Mercadería
- Sube foto/PDF de facturas o remitos de proveedores
- La IA (Claude Vision) extrae automáticamente: proveedor, Nº documento, fecha y artículos
- El operario revisa y corrige antes de confirmar
- Genera un **Registro de Recepción imprimible** (IT-REC-001)

### Módulo B — Control de Movimientos Internos
- Carga diaria del Excel `DELMYPARTYSRL_ListadoDetalladoDeRemitos_DDMMAAAA.xlsx`
- Merge inteligente por `# Remito` (nunca duplica, nunca borra)
- **Dashboard** con KPIs del día y alertas activas
- **Pedidos** con detalle expandible y comparación pedido vs entrega
- **Pendientes** por artículo (operario) o por pedido (coordinador)
- **Anomalías** detectadas automáticamente

---

## Requisitos

- Node.js 18+
- Una API Key de Anthropic (para Módulo A — extracción IA)

---

## Instalación local

```bash
git clone https://github.com/TU_USUARIO/delmy-sistema.git
cd delmy-sistema
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000)

---

## Deploy en Railway

### Opción 1 — Desde GitHub (recomendado)

1. Subí el repo a GitHub
2. En [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Seleccioná este repositorio
4. Railway detecta automáticamente la configuración y hace el build
5. Una vez desplegado, abre la URL generada

### Opción 2 — Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

---

## Configuración post-deploy

Una vez en el aire:

1. Entrá al sistema
2. Hacé click en el botón **⚙ API** en la barra superior
3. Ingresá tu API Key de Anthropic (`sk-ant-...`)
4. Guardá — la clave se almacena en el navegador (localStorage)

> ⚠️ La API Key se guarda **solo en el navegador local**. Cada usuario debe configurar la suya.

---

## Arquitectura

| Aspecto | Decisión |
|---|---|
| Frontend | React 18 (SPA) |
| Persistencia | localStorage — sin backend |
| Merge de datos | Por `# Remito` (Opción C) |
| Extracción IA | Claude Vision API (claude-sonnet-4) |
| Linkeo pedido↔entrega | Observaciones (5 dígitos) + fallback artículo/sucursal |
| Cierre con faltantes | Código `CR` en observaciones |

---

## Paleta de colores

| Rol | Color |
|---|---|
| Fondo | `#0c0e14` |
| Panel | `#111420` |
| Acento | `#f0c040` (dorado) |
| Verde (completo) | `#4ade80` |
| Ámbar (parcial) | `#f0c040` |
| Rojo (faltantes) | `#f87171` |
| Azul (abierto) | `#60a5fa` |

---

## Sistema de ubicación en depósito

Formato: `PL01 - F - A - 4`

- `PL01` → Pallet / medio de transporte
- `F/T` → Frente / Trasero
- `A/B/C` → Columna de bultos
- `1-9` → Altura del bulto

---

*Delmy Party SRL · Sistema Operativo v1.0 · Industrial Partner*


                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    
