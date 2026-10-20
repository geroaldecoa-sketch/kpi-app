// ─────────────────────────────────────────────
// Base PostgreSQL local (portable) para correr la app en la PC.
// La usan local.js (npm run local) e importar-render.js (npm run importar-render).
// Los datos se guardan en <usuario>/.kpi-produccion-local (fuera de OneDrive).
// ─────────────────────────────────────────────
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { Client } = require('pg');

const DATA_DIR = process.env.KPI_LOCAL_DB_DIR || path.join(os.homedir(), '.kpi-produccion-local');
const PG_PORT  = parseInt(process.env.PG_PORT) || 5433;
const DB_NAME  = 'kpi_local';
const PG_USER  = 'postgres';
const PG_PASS  = 'postgres';

const URL_LOCAL       = `postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${DB_NAME}`;
const conexionAdmin   = () => new Client({ host: 'localhost', port: PG_PORT, user: PG_USER, password: PG_PASS, database: 'postgres', connectionTimeoutMillis: 3000 });

const logsPg = [];   // últimas líneas de PostgreSQL, para mostrar si algo falla
const registrarLog = m => {
  logsPg.push(...String(m).split(/\r?\n/).filter(Boolean));
  if (logsPg.length > 40) logsPg.splice(0, logsPg.length - 40);
};

// ¿Hay un PostgreSQL nuestro ya escuchando en el puerto? (p. ej. quedó abierto de la vez anterior)
async function baseYaCorriendo() {
  const c = conexionAdmin();
  try {
    await c.connect();
    await c.end();
    return true;
  } catch (_) {
    return false;
  }
}

async function crearBaseSiFalta() {
  const c = conexionAdmin();
  await c.connect();
  const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (rows.length === 0) await c.query(`CREATE DATABASE ${DB_NAME}`);
  await c.end();
}

// Arranca (o reutiliza) la base local. Devuelve { detener }.
async function iniciarBaseLocal() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASS,
    port: PG_PORT,
    persistent: true,
    // UTF8 y locale neutro: evita problemas con la configuración regional de Windows
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'],
    onLog: registrarLog,
    onError: registrarLog,
  });

  let laIniciamosNosotros = false;

  if (await baseYaCorriendo()) {
    console.log(`🐘 Usando la base local que ya estaba abierta (puerto ${PG_PORT})`);
  } else {
    if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
      if (fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length > 0) {
        throw new Error(`La carpeta ${DATA_DIR} existe pero no es una base válida (quedó a medio crear). Borrala y volvé a ejecutar.`);
      }
      console.log(`🛠️  Creando base local en ${DATA_DIR} …`);
      await pg.initialise();
    }

    // Si la vez anterior se cerró de golpe, puede quedar un archivo de bloqueo viejo
    const pidFile = path.join(DATA_DIR, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      console.log('🧹 Limpiando bloqueo de una ejecución anterior…');
      try { fs.unlinkSync(pidFile); } catch (_) {}
    }

    try {
      await pg.start();
    } catch (err) {
      const detalle = logsPg.filter(l => /FATAL|ERROR|could not|already|in use/i.test(l)).slice(-5);
      throw new Error(
        `PostgreSQL no arrancó.\n   ${(detalle.length ? detalle : logsPg.slice(-8)).join('\n   ') || '(sin detalle)'}\n` +
        `   Si el puerto ${PG_PORT} está ocupado por otro programa, probá:  $env:PG_PORT=5434; npm run local`
      );
    }
    laIniciamosNosotros = true;
    console.log(`🐘 PostgreSQL local corriendo en el puerto ${PG_PORT}`);
  }

  await crearBaseSiFalta();

  return {
    async detener() {
      if (laIniciamosNosotros) {
        try { await pg.stop(); } catch (_) {}
      }
    },
  };
}

module.exports = { iniciarBaseLocal, conexionAdmin, URL_LOCAL, DB_NAME, DATA_DIR, PG_PORT };
