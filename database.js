const { Pool } = require('pg');

// ─────────────────────────────────────────────
// CONEXIÓN
// La variable DATABASE_URL la provee automáticamente Render / Railway.
// En local podés crear un archivo .env con:
//   DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/kpi_produccion
// ─────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En producción (Render/Railway) siempre habilitar SSL.
  // En local con PostgreSQL sin SSL, poner NODE_ENV=development
  ssl: process.env.NODE_ENV !== 'development'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
});

const MOTIVOS_INICIALES = ['Mantenimiento', 'Falta de insumos', 'Corte de luz', 'Otros'];

// ─────────────────────────────────────────────
// ESQUEMA
// ─────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Producción (tabla principal, un registro por fecha + turno)
    await client.query(`
      CREATE TABLE IF NOT EXISTS produccion (
        id                  SERIAL PRIMARY KEY,
        fecha               TEXT    NOT NULL,
        turno               TEXT    NOT NULL
                              CHECK(turno IN ('Mañana','Tarde','Noche')),
        horas_bidones       REAL    NOT NULL DEFAULT 0,
        horas_botellas      REAL    NOT NULL DEFAULT 0,
        detalle_horas       TEXT    DEFAULT '',   -- legado (migrado a observaciones)
        motivo_parada       TEXT,                 -- legado (migrado a tabla paradas)
        detalle_produccion  TEXT    DEFAULT '',   -- legado (migrado a observaciones)
        horas_totales       REAL    NOT NULL,
        horas_produccion    REAL    NOT NULL,
        horas_parados       REAL    NOT NULL,
        botellas_producidas INTEGER NOT NULL DEFAULT 0,
        bidones_5L          INTEGER NOT NULL DEFAULT 0,
        bidones_10L         INTEGER NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE produccion ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno)`);

    // ── Operarios (ABM)
    await client.query(`
      CREATE TABLE IF NOT EXISTS operarios (
        id          SERIAL PRIMARY KEY,
        nombre      TEXT    NOT NULL,
        legajo      TEXT    DEFAULT '',
        activo      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE operarios ADD COLUMN IF NOT EXISTS apellido TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE operarios ADD COLUMN IF NOT EXISTS dni      TEXT NOT NULL DEFAULT ''`);
    await client.query(`DROP INDEX IF EXISTS ux_operarios_nombre`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_operarios_nombre_apellido ON operarios (LOWER(nombre), LOWER(apellido))`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_operarios_dni ON operarios (dni) WHERE dni <> ''`);

    // ── Grupos de operarios (solo para facilitar la carga: tildan varios de una vez)
    await client.query(`
      CREATE TABLE IF NOT EXISTS grupos_operarios (
        id          SERIAL PRIMARY KEY,
        nombre      TEXT    NOT NULL,
        activo      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_grupos_nombre ON grupos_operarios (LOWER(nombre))`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS grupo_operario_miembros (
        grupo_id    INTEGER NOT NULL REFERENCES grupos_operarios(id) ON DELETE CASCADE,
        operario_id INTEGER NOT NULL REFERENCES operarios(id)        ON DELETE CASCADE,
        PRIMARY KEY (grupo_id, operario_id)
      );
    `);

    // ── Motivos de parada (ABM)
    await client.query(`
      CREATE TABLE IF NOT EXISTS motivos_parada (
        id          SERIAL PRIMARY KEY,
        nombre      TEXT    NOT NULL,
        activo      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_motivos_nombre ON motivos_parada (LOWER(nombre))`);

    // ── Operarios que trabajaron en cada turno (N a N)
    await client.query(`
      CREATE TABLE IF NOT EXISTS produccion_operarios (
        produccion_id INTEGER NOT NULL REFERENCES produccion(id) ON DELETE CASCADE,
        operario_id   INTEGER NOT NULL REFERENCES operarios(id)  ON DELETE RESTRICT,
        PRIMARY KEY (produccion_id, operario_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_prodop_operario ON produccion_operarios(operario_id)`);

    // ── Paradas del turno (varias por registro)
    await client.query(`
      CREATE TABLE IF NOT EXISTS paradas (
        id            SERIAL PRIMARY KEY,
        produccion_id INTEGER NOT NULL REFERENCES produccion(id)     ON DELETE CASCADE,
        motivo_id     INTEGER NOT NULL REFERENCES motivos_parada(id) ON DELETE RESTRICT,
        detalle       TEXT    DEFAULT '',
        minutos       INTEGER NOT NULL CHECK (minutos >= 0),
        orden         INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_paradas_produccion ON paradas(produccion_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_paradas_motivo ON paradas(motivo_id)`);

    // ── Motivos iniciales (solo si la tabla está vacía)
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM motivos_parada');
    if (n === 0) {
      for (const nombre of MOTIVOS_INICIALES) {
        await client.query('INSERT INTO motivos_parada (nombre) VALUES ($1)', [nombre]);
      }
      console.log('✅ Motivos de parada iniciales cargados');
    }

    await migrarDatosLegado(client);

    await client.query('COMMIT');
    console.log('✅ Esquema de base de datos verificado / creado correctamente');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// MIGRACIÓN DE REGISTROS VIEJOS (idempotente)
//  · detalle_horas + detalle_produccion → observaciones
//  · motivo_parada (uno por turno)      → una fila en paradas con las horas paradas
// ─────────────────────────────────────────────
async function migrarDatosLegado(client) {
  const obs = await client.query(`
    UPDATE produccion SET
      observaciones = CONCAT_WS(E'\\n',
        NULLIF(COALESCE(observaciones, ''), ''),
        CASE WHEN COALESCE(detalle_horas, '')      <> '' THEN 'Detalle de horas: '  || detalle_horas      END,
        CASE WHEN COALESCE(detalle_produccion, '') <> '' THEN 'Detalle producción: ' || detalle_produccion END
      ),
      detalle_horas = '',
      detalle_produccion = ''
    WHERE COALESCE(detalle_horas, '') <> '' OR COALESCE(detalle_produccion, '') <> ''
  `);
  if (obs.rowCount > 0) console.log(`🔄 Migradas observaciones de ${obs.rowCount} registros`);

  const { rows: legado } = await client.query(`
    SELECT id, motivo_parada, horas_parados FROM produccion
    WHERE motivo_parada IS NOT NULL AND motivo_parada <> ''
  `);
  for (const r of legado) {
    let motivo = await client.query('SELECT id FROM motivos_parada WHERE LOWER(nombre) = LOWER($1)', [r.motivo_parada]);
    if (motivo.rows.length === 0) {
      motivo = await client.query('INSERT INTO motivos_parada (nombre) VALUES ($1) RETURNING id', [r.motivo_parada]);
    }
    const yaTiene = await client.query('SELECT 1 FROM paradas WHERE produccion_id = $1 LIMIT 1', [r.id]);
    if (yaTiene.rows.length === 0) {
      await client.query(
        'INSERT INTO paradas (produccion_id, motivo_id, detalle, minutos, orden) VALUES ($1, $2, $3, $4, 0)',
        [r.id, motivo.rows[0].id, '', Math.round((parseFloat(r.horas_parados) || 0) * 60)]
      );
    }
    await client.query('UPDATE produccion SET motivo_parada = NULL WHERE id = $1', [r.id]);
  }
  if (legado.length > 0) console.log(`🔄 Migradas paradas de ${legado.length} registros`);
}

// ─────────────────────────────────────────────
// RESET (solo uso manual) — borra producción, no los maestros
// ─────────────────────────────────────────────
async function resetData() {
  await pool.query('DELETE FROM produccion'); // paradas y operarios del turno caen por CASCADE
  await pool.query('ALTER SEQUENCE produccion_id_seq RESTART WITH 1');
  console.log('🗑️  Datos de producción eliminados. Contador de IDs reiniciado.');
}

module.exports = { pool, initSchema, resetData };
