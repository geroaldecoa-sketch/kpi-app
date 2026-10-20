// ─────────────────────────────────────────────
// COPIA DE SEGURIDAD de la base de Render.   Uso:  npm run backup-render
//
// · Solo LEE la base (conexión en modo solo lectura).
// · Guarda en  backups/render_AAAA-MM-DD_HHMM/ :
//     datos.json        copia completa (la usa "npm run restaurar-backup")
//     backup.sql        script SQL estándar (estructura + datos) por si hace falta restaurar con psql
//     <tabla>.csv       cada tabla en CSV, para abrir con Excel
// · La carpeta backups/ está excluida de git: los datos no se suben a GitHub.
// ─────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { obtenerUrlRender, clienteDesdeUrl, ocultarClave, explicarError, tablasOrdenadas } = require('./herramientas-db');

const dos = n => String(n).padStart(2, '0');

function literalSQL(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function celdaCSV(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function estructuraTabla(client, t) {
  const { rows: cols } = await client.query(`
    SELECT a.attname AS nombre, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS no_nulo,
           pg_get_expr(d.adbin, d.adrelid) AS defecto
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`, [`public.${t}`]);
  const { rows: cons } = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname`, [`public.${t}`]);
  const { rows: idx } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = $1
      AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = $2::regclass)`, [t, `public.${t}`]);
  return { columnas: cols, restricciones: cons, indices: idx };
}

(async () => {
  console.log('\n💾 Copia de seguridad de la base de Render\n');
  const url = await obtenerUrlRender();

  const client = clienteDesdeUrl(url);
  console.log(`\n🔌 Conectando a ${ocultarClave(url)} …`);
  await client.connect();
  // Lectura consistente y sin posibilidad de modificar nada
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

  const { rows: [info] } = await client.query('SELECT current_database() AS base, version() AS version, NOW() AS momento');
  const tablas = await tablasOrdenadas(client);
  if (tablas.length === 0) throw new Error('La base no tiene tablas.');

  const ahora = new Date();
  const nombreCarpeta = `render_${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}_${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;
  const carpeta = path.join(__dirname, 'backups', nombreCarpeta);
  fs.mkdirSync(carpeta, { recursive: true });

  const copia = { creado: ahora.toISOString(), base: info.base, version_postgres: info.version, tablas: {} };
  const sqlEstructura = [], sqlDatos = [], sqlFks = [], sqlSecuencias = [];
  const secuencias = new Set();

  for (const t of tablas) {
    const est = await estructuraTabla(client, t);
    const { rows } = await client.query(`SELECT * FROM "${t}" ORDER BY 1`);
    copia.tablas[t] = { columnas: est.columnas.map(c => c.nombre), filas: rows };
    console.log(`   · ${t}: ${rows.length} filas`);

    // Estructura
    est.columnas.forEach(c => {
      const m = /nextval\('([^']+)'/.exec(c.defecto || '');
      if (m) secuencias.add(m[1].replace(/::regclass$/, ''));
    });
    const defs = est.columnas.map(c =>
      `  "${c.nombre}" ${c.tipo}${c.defecto ? ` DEFAULT ${c.defecto}` : ''}${c.no_nulo ? ' NOT NULL' : ''}`);
    est.restricciones.filter(r => r.contype !== 'f').forEach(r => defs.push(`  CONSTRAINT "${r.conname}" ${r.def}`));
    const ddl = [`CREATE TABLE IF NOT EXISTS "${t}" (\n${defs.join(',\n')}\n);`,
                 ...est.indices.map(i => i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') + ';')];
    const fks = est.restricciones.filter(r => r.contype === 'f').map(r => `ALTER TABLE "${t}" ADD CONSTRAINT "${r.conname}" ${r.def};`);
    sqlEstructura.push(...ddl);
    sqlFks.push(...fks);
    Object.assign(copia.tablas[t], { ddl, fks });

    // Datos
    if (rows.length) {
      const cols = est.columnas.map(c => `"${c.nombre}"`).join(', ');
      for (let i = 0; i < rows.length; i += 200) {
        const lote = rows.slice(i, i + 200).map(r => `  (${est.columnas.map(c => literalSQL(r[c.nombre])).join(', ')})`);
        sqlDatos.push(`INSERT INTO "${t}" (${cols}) VALUES\n${lote.join(',\n')};`);
      }
    }
    if (est.columnas.some(c => /nextval\(/.test(c.defecto || ''))) {
      const col = est.columnas.find(c => /nextval\(/.test(c.defecto || '')).nombre;
      sqlSecuencias.push(`SELECT setval(pg_get_serial_sequence('"${t}"', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${t}"), 0) + 1, false);`);
    }

    // CSV (separador ; para que Excel en español lo abra en columnas)
    const csv = [est.columnas.map(c => c.nombre).join(';'),
                 ...rows.map(r => est.columnas.map(c => celdaCSV(r[c.nombre])).join(';'))].join('\r\n');
    fs.writeFileSync(path.join(carpeta, `${t}.csv`), '﻿' + csv, 'utf8');
  }
  await client.query('COMMIT');
  await client.end();

  copia.secuencias = [...secuencias];
  fs.writeFileSync(path.join(carpeta, 'datos.json'), JSON.stringify(copia, null, 1), 'utf8');
  const sql = [
    `-- Copia de seguridad de la base "${info.base}" (Render) — ${ahora.toLocaleString('es-AR')}`,
    `-- Para restaurar en una base VACÍA:  psql "<url>" -f backup.sql`,
    `-- Para restaurar con la app:          npm run restaurar-backup`,
    'BEGIN;',
    ...[...secuencias].map(s => `CREATE SEQUENCE IF NOT EXISTS ${s};`),
    ...sqlEstructura, ...sqlFks, ...sqlDatos, ...sqlSecuencias,
    'COMMIT;', '',
  ].join('\n\n');
  fs.writeFileSync(path.join(carpeta, 'backup.sql'), sql, 'utf8');

  // Verificación: releer el archivo y comparar cantidades
  const leido = JSON.parse(fs.readFileSync(path.join(carpeta, 'datos.json'), 'utf8'));
  const ok = tablas.every(t => leido.tablas[t].filas.length === copia.tablas[t].filas.length);
  if (!ok) throw new Error('La verificación del archivo falló. Volvé a ejecutar la copia.');

  const total = tablas.reduce((a, t) => a + copia.tablas[t].filas.length, 0);
  console.log(`\n✅ Copia de seguridad guardada y verificada (${tablas.length} tabla${tablas.length === 1 ? '' : 's'}, ${total} filas):`);
  console.log(`   ${carpeta}`);
  console.log('\n   Guardá también una copia de esa carpeta fuera de la PC (pendrive, Drive, mail).');
  process.exit(0);
})().catch(err => { explicarError(err); process.exit(1); });
