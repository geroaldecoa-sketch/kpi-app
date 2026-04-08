# Sistema KPI Producción – Envasadora de Aceite

Sistema web para gestión de KPIs de producción. Permite cargar datos por turno y generar reportes automáticos.

## Estructura de archivos

```
kpi-sistema/
├── server.js        ← API REST (Express.js)
├── database.js      ← SQLite (node:sqlite nativo de Node.js ≥22)
├── package.json
├── render.yaml      ← Configuración deploy Render
└── public/
    ├── index.html   ← Interfaz de usuario
    ├── app.js       ← Lógica frontend
    └── styles.css   ← Estilos
```

## Requisitos

- Node.js **v22** o superior (usa SQLite nativo incorporado)
- npm

## Instalación local

```bash
cd kpi-sistema
npm install
npm start
# Abre http://localhost:3000
```

Para desarrollo con auto-reinicio:
```bash
npm run dev
```

## Base de datos (SQLite)

La base de datos se crea automáticamente en `kpi_produccion.db`. En producción se guarda en `/var/data/kpi_produccion.db` (disco persistente de Render).

### Tabla `produccion`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | INTEGER | Clave primaria autoincremental |
| fecha | TEXT | Fecha en formato YYYY-MM-DD |
| turno | TEXT | Mañana / Tarde / Noche |
| horas_bidones | REAL | Horas trabajando con bidones |
| horas_botellas | REAL | Horas trabajando con botellas |
| detalle_horas | TEXT | Descripción libre de las horas |
| motivo_parada | TEXT | Mantenimiento / Falta de insumos / Corte de luz |
| detalle_produccion | TEXT | Novedades del turno |
| horas_totales | REAL | Total de horas del turno |
| horas_produccion | REAL | Horas activas produciendo |
| horas_sin_produccion | REAL | Horas sin producción (sin parada) |
| horas_parados | REAL | Horas detenidos |
| botellas_producidas | INTEGER | Unidades de botellas producidas |
| bidones_producidos | INTEGER | Unidades de bidones producidos |

**Validación clave:** `horas_produccion + horas_sin_produccion + horas_parados = horas_totales`

## KPIs calculados automáticamente

| KPI | Fórmula |
|-----|---------|
| % Horas Activas | (horas_produccion / horas_totales) × 100 |
| % Horas sin Producción | (horas_sin_produccion / horas_totales) × 100 |
| % Horas Paradas | (horas_parados / horas_totales) × 100 |
| Promedio Botellas/hora | botellas_producidas / horas_produccion |
| Promedio Bidones/hora | bidones_producidos / horas_produccion |

## API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/produccion` | Lista registros (filtros: fecha_desde, fecha_hasta, turno) |
| GET | `/api/produccion/:id` | Un registro |
| POST | `/api/produccion` | Crear registro |
| PUT | `/api/produccion/:id` | Actualizar registro |
| DELETE | `/api/produccion/:id` | Eliminar registro |
| GET | `/api/reportes/mensual` | Reporte KPI mensual agrupado |
| GET | `/api/reportes/acumulado` | Reporte acumulado por fecha/turno |

## Deploy en Render (gratis)

1. Subir el proyecto a GitHub:
   ```bash
   git init
   git add .
   git commit -m "Sistema KPI inicial"
   git remote add origin https://github.com/TU_USUARIO/kpi-produccion.git
   git push -u origin main
   ```

2. Ir a [render.com](https://render.com) → New → Web Service

3. Conectar el repositorio de GitHub

4. Configurar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node

5. En la sección **Disks** (storage persistente):
   - Mount Path: `/var/data`
   - Size: 1 GB

6. Click **Create Web Service** → ¡listo!

> **Nota sobre Node.js en Render:** Render usa Node 18 por defecto. Para usar Node 22 (necesario para `node:sqlite` nativo), agregar en el panel de Render la variable de entorno: `NODE_VERSION = 22`

---
*Sistema desarrollado para uso interno de fábrica envasadora de aceite.*
