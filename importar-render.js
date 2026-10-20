// ─────────────────────────────────────────────
// Copia los datos de la base de Render a la base LOCAL, para probar
// la versión nueva con datos reales.   Uso:  npm run importar-render
//
// · En Render solo se LEE (la conexión se abre en modo solo lectura).
// · La base local se reemplaza por la copia (se pierden los datos de prueba locales).
// · La URL no se guarda en ningún lado.
// ─────────────────────────────────────────────
const { Client } = require('pg');
const { iniciarBaseLocal, conexionAdmin, URL_LOCAL, DB_NAME } = require('./local-db');
const { preguntar, ocultarClave } = require('./herramientas-db');

// Tablas en orden de dependencia (las que no existan en Render se saltean)
const TABLAS = [
  'produccion', 'operarios', 'motivos_parada',
  'produccion_operarios', 'paradas', 'grupos_operarios', 'grupo_operario_miembros',
];

async function columnas(client, tabla) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [tabla]);
  return rows.map(r => r.column_name);
}

(async () => {
  console.log('\n📦 Copiar datos de Render a la base local\n');

  // 1) URL de Render
  let url = process.argv.slice(2).find(a => /^postgres(ql)?:\/\//.test(a)) || process.env.RENDER_DATABASE_URL || '';
  if (!url) {
    console.log('Pegá la "External Database URL" de tu base en Render');
    console.log('(Render → tu base de datos → Connections → External Database URL)\n');
    url = await preguntar('URL: ');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('Eso no parece una URL de PostgreSQL (tiene que empezar con postgresql://).');
  if (!/\.render\.com/.test(url) && !/localhost|127\.0\.0\.1/.test(url)) {
    console.log('⚠️  La URL no es de render.com. Revisá que sea la "External Database URL" (la "Internal" solo funciona dentro de Render).');
  }

  // 2) Leer Render (solo lectura)
  const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const origen = new Client({ connectionString: url, ssl: esLocal ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  console.log(`\n🔌 Conectando a ${ocultarClave(url)} …`);
  await origen.connect();
  await origen.query('BEGIN TRANSACTION READ ONLY');

  const datos = {};
  for (const t of TABLAS) {
    const cols = await columnas(origen, t);
    if (cols.length === 0) continue;
    const { rows } = await origen.query(`SELECT * FROM ${t}`);
    datos[t] = { cols, rows };
    console.log(`   · ${t}: ${rows.length} filas`);
  }
  await origen.query('COMMIT');
  await origen.end();
  if (!datos.produccion) throw new Error('En esa base no existe la tabla "produccion". ¿Es la base correcta?');

  // 3) Confirmación
  if (!process.argv.includes('--si')) {
    console.log('\nEsto REEMPLAZA tu base local por la copia de Render (los datos de prueba locales se borran).');
    console.log('En Render no se modifica nada.');
    const r = (await preguntar('¿Continuar? (s/n): ')).toLowerCase();
    if (r !== 's' && r !== 'si' && r !== 'sí') { console.log('Cancelado.'); process.exit(0); }
  }

  // 4) Base local nueva y vacía
  const base = await iniciarBaseLocal();
  const admin = conexionAdmin();
  await admin.connect();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [DB_NAME]);
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  process.env.DATABASE_URL = URL_LOCAL;
  process.env.NODE_ENV     = 'development';
  const { pool, initSchema } = require('./database');
  await initSchema(); // crea las tablas de la versión nueva (vacías)

  // 5) Copiar
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const presentes = TABLAS.filter(t => datos[t]);
    await client.query(`TRUNCATE ${presentes.join(', ')} RESTART IDENTITY CASCADE`);

    for (const t of presentes) {
      const { cols, rows } = datos[t];
      const destino = await columnas(client, t);
      const comunes = cols.filter(c => destino.includes(c));
      for (let i = 0; i < rows.length; i += 200) {
        const lote = rows.slice(i, i + 200);
        const valores = [];
        const filas = lote.map(r => `(${comunes.map(c => { valores.push(r[c]); return `$${valores.length}`; }).join(', ')})`);
        await client.query(`INSERT INTO ${t} (${comunes.join(', ')}) VALUES ${filas.join(', ')}`, valores);
      }
      if (destino.includes('id')) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // 6) Adaptar los registros al formato nuevo (lo mismo que pasaría al publicar en Render)
  console.log('\n🔄 Adaptando los registros a la versión nueva…');
  await initSchema();

  const { rows: [r] } = await pool.query(`
    SELECT (SELECT COUNT(*) FROM produccion)::int AS registros,
           (SELECT COUNT(*) FROM paradas)::int    AS paradas,
           (SELECT COUNT(*) FROM produccion WHERE COALESCE(observaciones, '') <> '')::int AS con_obs,
           (SELECT MIN(fecha) FROM produccion) AS desde,
           (SELECT MAX(fecha) FROM produccion) AS hasta`);
  await pool.end();
  await base.detener();

  console.log(`\n✅ Copia lista: ${r.registros} registros${r.desde ? ` (del ${r.desde} al ${r.hasta})` : ''}, ${r.paradas} paradas, ${r.con_obs} con observaciones.`);
  console.log('   Ahora ejecutá:  npm run local   y abrí http://localhost:3000/app.html\n');
  process.exit(0);
})().catch(err => {
  console.error('\n❌ No se pudo copiar:', (err && err.message) || err);
  if (err && /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|timeout/i.test(String(err.message))) {
    console.error('   Revisá la URL y tu conexión a internet. Tiene que ser la "External Database URL".');
  }
  if (err && /password authentication/i.test(String(err.message))) {
    console.error('   Usuario o contraseña incorrectos: copiá la URL completa de nuevo desde Render.');
  }
  process.exit(1);
});
