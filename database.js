const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// ⚠️  IMPORTANTE: La base de datos SIEMPRE se guarda junto al código,
//     en la misma carpeta que este archivo. NO usar /tmp ni rutas temporales
//     porque los datos se perderían al reiniciar el servidor.
const DB_PATH = path.join(__dirname, 'kpi_produccion.db');
let db;

function getDb() {
  if (!db) {
    console.log(`💾 Base de datos: ${DB_PATH}`);
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  // Crear tabla si no existe (estructura final, sin datos de ejemplo)
  db.exec(`
    CREATE TABLE IF NOT EXISTS produccion (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha              TEXT    NOT NULL,
      turno              TEXT    NOT NULL CHECK(turno IN ('Mañana','Tarde','Noche')),
      horas_bidones      REAL    NOT NULL DEFAULT 0,
      horas_botellas     REAL    NOT NULL DEFAULT 0,
      detalle_horas      TEXT    DEFAULT '',
      motivo_parada      TEXT,
      detalle_produccion TEXT    DEFAULT '',
      horas_totales      REAL    NOT NULL,
      horas_produccion   REAL    NOT NULL,
      horas_parados      REAL    NOT NULL,
      botellas_producidas INTEGER NOT NULL DEFAULT 0,
      bidones_5L          INTEGER NOT NULL DEFAULT 0,
      bidones_10L         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT    DEFAULT (datetime('now')),
      updated_at         TEXT    DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha);
    CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno);
  `);

  // Migraciones sobre tablas existentes (por si viene de versiones anteriores)
  migrateSchema();
}

function migrateSchema() {
  const cols = db.prepare('PRAGMA table_info(produccion)').all().map(c => c.name);

  // ── Migraciones de columnas ──────────────────────────────────────────────

  // Agregar bidones_5L si no existe
  if (!cols.includes('bidones_5L')) {
    db.exec('ALTER TABLE produccion ADD COLUMN bidones_5L INTEGER NOT NULL DEFAULT 0');
    console.log('✅ Migración: columna bidones_5L agregada');
  }

  // Agregar bidones_10L si no existe
  if (!cols.includes('bidones_10L')) {
    db.exec('ALTER TABLE produccion ADD COLUMN bidones_10L INTEGER NOT NULL DEFAULT 0');
    console.log('✅ Migración: columna bidones_10L agregada');
  }

  // Migrar bidones_producidos → bidones_5L
  if (cols.includes('bidones_producidos')) {
    db.exec('UPDATE produccion SET bidones_5L = bidones_producidos WHERE bidones_5L = 0 AND bidones_10L = 0');
    db.exec('ALTER TABLE produccion DROP COLUMN bidones_producidos');
    console.log('✅ Migración: bidones_producidos → bidones_5L');
  }

  // Migrar horas_sin_produccion: sumarla a horas_parados
  if (cols.includes('horas_sin_produccion')) {
    db.exec('UPDATE produccion SET horas_parados = horas_parados + horas_sin_produccion');
    db.exec('ALTER TABLE produccion DROP COLUMN horas_sin_produccion');
    console.log('✅ Migración: horas_sin_produccion sumada a horas_parados y eliminada');
  }

  // ── Migración de restricción motivo_parada (agregar soporte para "Otros") ──
  // La restricción CHECK original no incluye 'Otros'. Si la tabla tiene el
  // CHECK antiguo, se recrea la tabla para quitarlo (la validación queda en
  // el servidor, más flexible).
  const tableSQL = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='produccion'"
  ).get();

  const tieneCheckAntiguo =
    tableSQL &&
    tableSQL.sql &&
    tableSQL.sql.includes("CHECK(motivo_parada IN");

  if (tieneCheckAntiguo) {
    console.log('🔄 Migración: recreando tabla para actualizar restricción motivo_parada…');
    db.exec(`
      BEGIN;

      CREATE TABLE produccion_new (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha              TEXT    NOT NULL,
        turno              TEXT    NOT NULL CHECK(turno IN ('Mañana','Tarde','Noche')),
        horas_bidones      REAL    NOT NULL DEFAULT 0,
        horas_botellas     REAL    NOT NULL DEFAULT 0,
        detalle_horas      TEXT    DEFAULT '',
        motivo_parada      TEXT,
        detalle_produccion TEXT    DEFAULT '',
        horas_totales      REAL    NOT NULL,
        horas_produccion   REAL    NOT NULL,
        horas_parados      REAL    NOT NULL,
        botellas_producidas INTEGER NOT NULL DEFAULT 0,
        bidones_5L          INTEGER NOT NULL DEFAULT 0,
        bidones_10L         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT    DEFAULT (datetime('now')),
        updated_at         TEXT    DEFAULT (datetime('now'))
      );

      INSERT INTO produccion_new
        SELECT id, fecha, turno, horas_bidones, horas_botellas, detalle_horas,
               motivo_parada, detalle_produccion, horas_totales, horas_produccion,
               horas_parados, botellas_producidas, bidones_5L, bidones_10L,
               created_at, updated_at
        FROM produccion;

      DROP TABLE produccion;
      ALTER TABLE produccion_new RENAME TO produccion;

      CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha);
      CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno);

      COMMIT;
    `);
    console.log('✅ Migración: restricción motivo_parada eliminada del esquema (validación en servidor)');
  }
}

/**
 * Elimina todos los registros de producción y reinicia el contador de IDs.
 * Útil para empezar desde cero sin borrar el archivo de base de datos.
 */
function resetData() {
  const db = getDb();
  db.exec('DELETE FROM produccion');
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'produccion'");
  console.log('🗑️ Datos de producción eliminados. Base de datos lista para usar.');
}

module.exports = { getDb, resetData };
