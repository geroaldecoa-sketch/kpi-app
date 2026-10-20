// ─────────────────────────────────────────────
// MODO LOCAL — corre la app en tu PC con una base PostgreSQL propia,
// sin tocar la base de Render. Uso:  npm run local
//
// La base local se guarda en tu carpeta de usuario (fuera de OneDrive):
//   <usuario>/.kpi-produccion-local
// Para empezar de cero, cerrá la app y borrá esa carpeta.
// Para traer una copia de los datos de Render:  npm run importar-render
// ─────────────────────────────────────────────
const { iniciarBaseLocal, URL_LOCAL } = require('./local-db');

(async () => {
  const base = await iniciarBaseLocal();

  const detener = async () => {
    console.log('\n⏹️  Deteniendo base local…');
    await base.detener();
    process.exit(0);
  };
  process.on('SIGINT', detener);
  process.on('SIGTERM', detener);
  process.on('SIGHUP', detener);   // cierre de la ventana en Windows

  process.env.DATABASE_URL = URL_LOCAL;
  process.env.NODE_ENV     = 'development';
  process.env.PORT         = process.env.PORT || '3000';

  require('./server');
})().catch(err => {
  console.error('❌ No se pudo iniciar la base local:', (err && err.message) || err || 'error desconocido');
  process.exit(1);
});
