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
      horas_sin_produccion REAL NOT NULL,
      horas_parados    REAL    NOT NULL,
      botellas_producidas  INTEGER NOT NULL DEFAULT 0,
      bidones_producidos   INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    DEFAULT (datetime('now')),
      updated_at       TEXT    DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_produccion_fecha ON produccion(fecha);
    CREATE INDEX IF NOT EXISTS idx_produccion_turno ON produccion(turno);
  `);

  const count = db.prepare('SELECT COUNT(*) as n FROM produccion').get();
  if (count.n === 0) insertSampleData();
}

function insertSampleData() {
  const insert = db.prepare(`
    INSERT INTO produccion
      (fecha,turno,horas_bidones,horas_botellas,detalle_horas,
       motivo_parada,detalle_produccion,horas_totales,horas_produccion,
       horas_sin_produccion,horas_parados,botellas_producidas,bidones_producidos)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const samples = [
    ['2026-01-06', 'Mañana', 4, 4, 'Operación normal', null, 'Producción fluida', 8, 7, 0.5, 0.5, 3200, 140],
    ['2026-01-06', 'Tarde', 3, 5, 'Cambio de formato', null, 'Cambio de línea', 8, 6.5, 1, 0.5, 2800, 120],
    ['2026-01-07', 'Mañana', 4, 4, 'Mantenimiento línea 1', 'Mantenimiento', 'Parada mantenimiento', 8, 5, 1, 2, 2100, 90],
    ['2026-01-07', 'Tarde', 4, 4, 'Normal', null, 'Sin novedad', 8, 7.5, 0.5, 0, 3400, 150],
    ['2026-01-08', 'Mañana', 4, 4, 'Falta de etiquetas', 'Falta de insumos', 'Retraso por insumos', 8, 6, 0, 2, 2500, 100],
    ['2026-01-08', 'Tarde', 4, 4, 'Normal', null, 'Producción completa', 8, 8, 0, 0, 3600, 160],
    ['2026-01-09', 'Mañana', 4, 4, 'Corte eléctrico 1.5hs', 'Corte de luz', 'Corte imprevisto', 8, 6, 0, 2, 2700, 110],
    ['2026-01-09', 'Tarde', 4, 4, 'Normal', null, 'Sin novedades', 8, 7, 1, 0, 3100, 135],
    ['2026-01-13', 'Mañana', 4, 4, 'Normal', null, 'Buena producción', 8, 7.5, 0.5, 0, 3350, 148],
    ['2026-01-13', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3000, 130],
    ['2026-01-14', 'Mañana', 4, 4, 'Mant correctivo bomba', 'Mantenimiento', 'Falla bomba línea 2', 8, 4, 2, 2, 1800, 75],
    ['2026-01-14', 'Tarde', 4, 4, 'Normal', null, 'Sin novedad', 8, 7, 1, 0, 3100, 132],
    ['2026-01-20', 'Mañana', 5, 3, 'Producción bidones', null, 'Alta demanda bidones', 8, 8, 0, 0, 1800, 200],
    ['2026-01-20', 'Tarde', 3, 5, 'Producción botellas', null, 'Alta demanda botellas', 8, 7.5, 0.5, 0, 3400, 90],
    ['2026-01-21', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 6.5, 1, 0.5, 2900, 120],
    ['2026-02-03', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3100, 130],
    ['2026-02-03', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7.5, 0.5, 0, 3300, 140],
    ['2026-02-04', 'Mañana', 4, 4, 'Falta de envases', 'Falta de insumos', 'Producción reducida', 8, 5, 1, 2, 2200, 85],
    ['2026-02-04', 'Tarde', 4, 4, 'Normal', null, 'Recuperación', 8, 7, 1, 0, 3000, 125],
    ['2026-02-10', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 8, 0, 0, 3600, 155],
    ['2026-02-10', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3100, 130],
    ['2026-02-11', 'Mañana', 4, 4, 'Mantenimiento', 'Mantenimiento', 'Mant programado', 8, 5, 1, 2, 2000, 80],
    ['2026-02-17', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7.5, 0.5, 0, 3300, 140],
    ['2026-02-17', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3000, 128],
    ['2026-02-18', 'Mañana', 4, 4, 'Corte de luz tarde', 'Corte de luz', 'Corte 2 horas', 8, 6, 0, 2, 2600, 105],
    ['2026-03-02', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3100, 130],
    ['2026-03-02', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7.5, 0.5, 0, 3350, 142],
    ['2026-03-03', 'Mañana', 5, 3, 'Alta demanda bidones', null, 'Bidones prioritarios', 8, 8, 0, 0, 1900, 210],
    ['2026-03-09', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3100, 132],
    ['2026-03-09', 'Tarde', 4, 4, 'Mant preventivo', 'Mantenimiento', 'Revisión general', 8, 5, 1, 2, 2100, 88],
    ['2026-03-10', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7.5, 0.5, 0, 3300, 140],
    ['2026-03-16', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 8, 0, 0, 3600, 155],
    ['2026-03-16', 'Tarde', 4, 4, 'Falta de tapas', 'Falta de insumos', 'Sin tapas 1.5hs', 8, 6, 0.5, 1.5, 2600, 108],
    ['2026-03-17', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3000, 128],
    ['2026-03-23', 'Mañana', 4, 4, 'Normal', null, 'Normal', 8, 7.5, 0.5, 0, 3300, 140],
    ['2026-03-23', 'Tarde', 4, 4, 'Normal', null, 'Normal', 8, 7, 1, 0, 3050, 130],
  ];

  for (const row of samples) insert.run(...row);
  console.log('✅ Datos de ejemplo insertados');
}

module.exports = { getDb };
