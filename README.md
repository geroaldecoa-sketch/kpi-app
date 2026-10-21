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

## Correr en tu PC (sin deploy)

Requisito: Node.js 18 o superior.

```bash
cd kpi-sistema-v2
npm install        # la primera vez (descarga también un PostgreSQL portable)
npm run local
# Abrí http://localhost:3000/app.html
```

`npm run local` levanta un PostgreSQL propio en el puerto 5433 y guarda los datos en
`C:\Users\<usuario>\.kpi-produccion-local` (fuera de OneDrive). **No se conecta a la base de Render.**
Para cortar: `Ctrl + C`. Para empezar con la base vacía: cerrá la app y borrá esa carpeta.

### Probar con una copia de los datos de Render

```bash
npm run importar-render
```

Pide la **External Database URL** (Render → base de datos → Connections), lee los datos de Render en modo
**solo lectura** y los copia a la base local, adaptándolos al formato nuevo. Reemplaza la base local
(cerrá la app antes). En Render no se modifica nada y la URL no se guarda.

### Copia de seguridad de Render

```bash
npm run backup-render      # copia completa (solo lectura) en backups/render_AAAA-MM-DD_HHMMSS/
npm run restaurar-backup   # restaura una copia en la base local (para revisar) o en Render
```

Cada copia trae `datos.json` (para restaurar con la app), `backup.sql` (restaurable con `psql`) y un CSV por tabla.
Restaurar en Render pide escribir `RESTAURAR` y antes guarda una copia del estado actual.
La carpeta `backups/` no se sube a git.

`npm start` es el comando de producción (usa `DATABASE_URL`) y es el que corre Render.

## Base de datos (PostgreSQL)

Las tablas se crean solas al arrancar (`initSchema` en `database.js`). Los registros viejos se migran automáticamente: `motivo_parada` pasa a una fila en `paradas` (con las horas paradas en minutos) y `detalle_horas` + `detalle_produccion` pasan a `observaciones`.

### Tablas

| Tabla | Contenido |
|-------|-----------|
| `produccion` | Un registro por fecha + turno: horas, producción, `observaciones` |
| `operarios` | ABM de operarios (nombre, apellido, DNI, activo). Se pueden importar desde Excel |
| `grupos_operarios` / `grupo_operario_miembros` | Grupos de operarios para tildarlos juntos en la carga |
| `motivos_parada` | ABM de motivos de parada (nombre, activo) |
| `submotivos_parada` | ABM de submotivos: cada motivo tiene su propia lista (ej: Mantenimiento → Sopladora) |
| `produccion_operarios` | Operarios que trabajaron en cada turno (N a N) |
| `paradas` | Paradas de cada turno: motivo, submotivo, detalle, minutos |

**Horas calculadas:** `horas_parados = suma de minutos de las paradas / 60` y `horas_produccion = horas_totales − horas_parados`.

Los operarios y motivos que ya se usaron no se pueden eliminar (se desactivan para que no aparezcan en la carga).

## KPIs calculados automáticamente

| KPI | Fórmula |
|-----|---------|
| % Horas Activas | (horas_produccion / horas_totales) × 100 |
| % Horas Paradas | (horas_parados / horas_totales) × 100 |
| Promedio Botellas/hora | botellas_producidas / horas_produccion |
| Promedio Bidones/hora | bidones / horas_produccion |
| Tiempo de parada por motivo | suma de minutos de `paradas` agrupado por motivo |

## API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/produccion` | Lista registros con operarios y paradas (filtros: fecha_desde, fecha_hasta, turno) |
| GET | `/api/produccion/:id` | Un registro |
| POST | `/api/produccion` | Crear registro (`operario_ids: []`, `paradas: [{motivo_id, detalle, minutos}]`) |
| PUT | `/api/produccion/:id` | Actualizar registro |
| DELETE | `/api/produccion/:id` | Eliminar registro |
| GET/POST | `/api/operarios` | Listar (`?activos=1`) / crear operario |
| PUT/DELETE | `/api/operarios/:id` | Editar / eliminar operario |
| POST | `/api/operarios/importar` | Importa operarios (`[{nombre, apellido, dni}]`): crea o actualiza por DNI |
| GET/POST | `/api/grupos` | Listar / crear grupo (`{nombre, operario_ids}`) |
| PUT/DELETE | `/api/grupos/:id` | Editar / eliminar grupo |
| GET/POST | `/api/motivos` | Listar / crear motivo de parada |
| PUT/DELETE | `/api/motivos/:id` | Editar / eliminar motivo |
| GET/POST | `/api/submotivos` | Listar / crear submotivo (`{motivo_id, nombre}`) |
| PUT/DELETE | `/api/submotivos/:id` | Editar / eliminar submotivo |
| GET | `/api/paradas/detalles` | Detalles ya usados (autocompletar) |
| GET | `/api/reportes/mensual` | Reporte KPI mensual agrupado (incluye paradas por motivo) |
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
