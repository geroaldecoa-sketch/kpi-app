const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/tmp/kpi_produccion.db'
  : path.join(__dirname, 'kpi_produccion.db');
let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS produccion (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha            TEXT    NOT NULL,
      turno            TEXT    NOT NULL CHECK(turno IN ('Mañana','Tarde','Noche')),
      horas_bidones    REAL    NOT NULL DEFAULT 0,
      horas_botellas   REAL    NOT NULL DEFAULT 0,
      detalle_horas    TEXT    DEFAULT '',
      motivo_parada    TEXT    CHECK(motivo_parada IN ('Mantenimiento','Falta de insumos','Corte de luz') OR motivo_parada IS NULL),
      detalle_produccion TEXT  DEFAULT '',
      horas_totales    REAL    NOT NULL,
      horas_produccion REAL    NOT NULL,
      horas_parados    REAL    NOT NULL,
      botellas_producidas  INTEGER NOT NULL DEFAULT 0,
      bidones_5L           INTEGER NOT NULL DEFAULT 0,
      bidones_10L          INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    DEFAULT (datetime('now')),
      updated_at       TEXT    DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha);
    CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno);
  `);

  // Migraciones sobre tablas existentes
  migrateSchema();

  const count = db.prepare('SELECT COUNT(*) as n FROM produccion').get();
  if (count.n === 0) insertSampleData();
}

function migrateSchema() {
  const cols = db.prepare('PRAGMA table_info(produccion)').all().map(c => c.name);

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

  // Migrar bidones_producidos → bidones_5L (todos los bidones existentes van a 5L)
  if (cols.includes('bidones_producidos')) {
    db.exec('UPDATE produccion SET bidones_5L = bidones_producidos WHERE bidones_5L = 0 AND bidones_10L = 0');
    db.exec('ALTER TABLE produccion DROP COLUMN bidones_producidos');
    console.log('✅ Migración: bidones_producidos migrado a bidones_5L y eliminado');
  }

  // Migrar horas_sin_produccion: sumarla a horas_parados para mantener el balance
  if (cols.includes('horas_sin_produccion')) {
    db.exec('UPDATE produccion SET horas_parados = horas_parados + horas_sin_produccion');
    db.exec('ALTER TABLE produccion DROP COLUMN horas_sin_produccion');
    console.log('✅ Migración: horas_sin_produccion sumada a horas_parados y eliminada');
  }
}

function insertSampleData() {
  const insert = db.prepare(`
    INSERT INTO produccion
      (fecha, turno, horas_bidones, horas_botellas, detalle_horas,
       motivo_parada, detalle_produccion, horas_totales, horas_produccion,
       horas_parados, botellas_producidas, bidones_5L, bidones_10L)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Formato: fecha, turno, hs_bid, hs_bot, det_hs, motivo, det_prod,
  //          hs_tot, hs_prod, hs_parados, botellas, bidones_5L, bidones_10L
  // horas_totales = horas_produccion + horas_parados
  const samples = [
    ['2026-01-06', 'Mañana', 4, 4, 'Operación normal',        null,              'Producción fluida',       8, 7,   1,   3200, 84,  56],
    ['2026-01-06', 'Tarde',  3, 5, 'Cambio de formato',       null,              'Cambio de línea',         8, 6.5, 1.5, 2800, 72,  48],
    ['2026-01-07', 'Mañana', 4, 4, 'Mantenimiento línea 1',   'Mantenimiento',   'Parada mantenimiento',    8, 5,   3,   2100, 54,  36],
    ['2026-01-07', 'Tarde',  4, 4, 'Normal',                  null,              'Sin novedad',             8, 7.5, 0.5, 3400, 90,  60],
    ['2026-01-08', 'Mañana', 4, 4, 'Falta de etiquetas',      'Falta de insumos','Retraso por insumos',     8, 6,   2,   2500, 60,  40],
    ['2026-01-08', 'Tarde',  4, 4, 'Normal',                  null,              'Producción completa',     8, 8,   0,   3600, 96,  64],
    ['2026-01-09', 'Mañana', 4, 4, 'Corte eléctrico 1.5hs',  'Corte de luz',    'Corte imprevisto',        8, 6,   2,   2700, 66,  44],
    ['2026-01-09', 'Tarde',  4, 4, 'Normal',                  null,              'Sin novedades',           8, 7,   1,   3100, 81,  54],
    ['2026-01-13', 'Mañana', 4, 4, 'Normal',                  null,              'Buena producción',        8, 7.5, 0.5, 3350, 89,  59],
    ['2026-01-13', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3000, 78,  52],
    ['2026-01-14', 'Mañana', 4, 4, 'Mant correctivo bomba',   'Mantenimiento',   'Falla bomba línea 2',     8, 4,   4,   1800, 45,  30],
    ['2026-01-14', 'Tarde',  4, 4, 'Normal',                  null,              'Sin novedad',             8, 7,   1,   3100, 79,  53],
    ['2026-01-20', 'Mañana', 5, 3, 'Producción bidones',      null,              'Alta demanda bidones',    8, 8,   0,   1800, 120, 80],
    ['2026-01-20', 'Tarde',  3, 5, 'Producción botellas',     null,              'Alta demanda botellas',   8, 7.5, 0.5, 3400, 54,  36],
    ['2026-01-21', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 6.5, 1.5, 2900, 72,  48],
    ['2026-02-03', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3100, 78,  52],
    ['2026-02-03', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7.5, 0.5, 3300, 84,  56],
    ['2026-02-04', 'Mañana', 4, 4, 'Falta de envases',        'Falta de insumos','Producción reducida',     8, 5,   3,   2200, 51,  34],
    ['2026-02-04', 'Tarde',  4, 4, 'Normal',                  null,              'Recuperación',            8, 7,   1,   3000, 75,  50],
    ['2026-02-10', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 8,   0,   3600, 93,  62],
    ['2026-02-10', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3100, 78,  52],
    ['2026-02-11', 'Mañana', 4, 4, 'Mantenimiento',           'Mantenimiento',   'Mant programado',         8, 5,   3,   2000, 48,  32],
    ['2026-02-17', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7.5, 0.5, 3300, 84,  56],
    ['2026-02-17', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3000, 77,  51],
    ['2026-02-18', 'Mañana', 4, 4, 'Corte de luz tarde',      'Corte de luz',    'Corte 2 horas',           8, 6,   2,   2600, 63,  42],
    ['2026-03-02', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3100, 78,  52],
    ['2026-03-02', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7.5, 0.5, 3350, 85,  57],
    ['2026-03-03', 'Mañana', 5, 3, 'Alta demanda bidones',    null,              'Bidones prioritarios',    8, 8,   0,   1900, 126, 84],
    ['2026-03-09', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3100, 79,  53],
    ['2026-03-09', 'Tarde',  4, 4, 'Mant preventivo',         'Mantenimiento',   'Revisión general',        8, 5,   3,   2100, 53,  35],
    ['2026-03-10', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7.5, 0.5, 3300, 84,  56],
    ['2026-03-16', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 8,   0,   3600, 93,  62],
    ['2026-03-16', 'Tarde',  4, 4, 'Falta de tapas',          'Falta de insumos','Sin tapas 1.5hs',         8, 6,   2,   2600, 65,  43],
    ['2026-03-17', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3000, 77,  51],
    ['2026-03-23', 'Mañana', 4, 4, 'Normal',                  null,              'Normal',                  8, 7.5, 0.5, 3300, 84,  56],
    ['2026-03-23', 'Tarde',  4, 4, 'Normal',                  null,              'Normal',                  8, 7,   1,   3050, 78,  52],
  ];

  for (const row of samples) insert.run(...row);
  console.log('✅ Datos de ejemplo insertados');
}

module.exports = { getDb };
