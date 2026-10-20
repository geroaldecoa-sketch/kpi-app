// Utilidades compartidas por los comandos de copia / restauración
const readline = require('readline');
const { Client } = require('pg');

// Una sola interfaz de lectura para todo el comando (evita perder respuestas)
let _rl = null;
function preguntar(texto) {
  if (!_rl) _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => _rl.question(texto, r => res(r.trim())));
}

const ocultarClave = url => url.replace(/\/\/([^:/]+):[^@]+@/, '//$1:****@');

// Pide la URL de Render (o la toma de los argumentos / variable de entorno)
async function obtenerUrlRender() {
  let url = process.argv.slice(2).find(a => /^postgres(ql)?:\/\//.test(a)) || process.env.RENDER_DATABASE_URL || '';
  if (!url) {
    console.log('Pegá la "External Database URL" de tu base en Render');
    console.log('(Render → tu base de datos → Connect → External → ícono de copiar)\n');
    url = await preguntar('URL: ');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('Eso no parece una URL de PostgreSQL (tiene que empezar con postgresql://).');
  return url;
}

function clienteDesdeUrl(url) {
  const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Client({ connectionString: url, ssl: esLocal ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
}

function explicarError(err) {
  const msg = String((err && err.message) || err || 'error desconocido');
  console.error('\n❌', msg);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|timeout/i.test(msg)) console.error('   Revisá la URL y tu conexión a internet. Tiene que ser la "External Database URL".');
  if (/password authentication/i.test(msg)) console.error('   Usuario o contraseña incorrectos: copiá la URL completa de nuevo desde Render.');
}

// Orden de las tablas respetando claves foráneas (primero las referenciadas)
async function tablasOrdenadas(client) {
  const { rows: tablas } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const { rows: fks } = await client.query(`
    SELECT c.conrelid::regclass::text AS tabla, c.confrelid::regclass::text AS referencia
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`);
  const nombres = tablas.map(t => t.tablename);
  const deps = Object.fromEntries(nombres.map(t => [t, new Set()]));
  fks.forEach(f => { if (deps[f.tabla] && f.referencia !== f.tabla) deps[f.tabla].add(f.referencia.replace(/^public\./, '')); });
  const orden = [], vistos = new Set();
  const visitar = t => { if (vistos.has(t)) return; vistos.add(t); (deps[t] || []).forEach(visitar); orden.push(t); };
  nombres.forEach(visitar);
  return orden;
}

module.exports = { preguntar, ocultarClave, obtenerUrlRender, clienteDesdeUrl, explicarError, tablasOrdenadas };
