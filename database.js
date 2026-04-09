const { Pool } = require('pg');

// ─────────────────────────────────────────────
// CONEXIÓN
// La variable DATABASE_URL la provee automáticamente Render / Railway.
// En local podés crear un archivo .env con:
//   DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/kpi_produccion
// ─────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
});

// ─────────────────────────────────────────────
// ESQUEMA
// ─────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS produccion (
        id                  SERIAL PRIMARY KEY,
        fecha               TEXT    NOT NULL,
        turno               TEXT    NOT NULL
                              CHECK(turno IN ('Mañana','Tarde','Noche')),
        horas_bidones       REAL    NOT NULL DEFAULT 0,
        horas_botellas      REAL    NOT NULL DEFAULT 0,
        detalle_horas       TEXT    DEFAULT '',
        motivo_parada       TEXT,
        detalle_produccion  TEXT    DEFAULT '',
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno);
    `);

    console.log('✅ Esquema de base de datos verificado / creado correctamente');
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// RESET (solo uso manual)
// ─────────────────────────────────────────────
async function resetData() {
  await pool.query('DELETE FROM produccion');
  await pool.query('ALTER SEQUENCE produccion_id_seq RESTART WITH 1');
  console.log('🗑️  Datos de producción eliminados. Contador de IDs reiniciado.');
}

module.exports = { pool, initSchema, resetData };
