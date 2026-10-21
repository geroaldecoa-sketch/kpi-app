// ─────────────────────────────────────────────
// RESTAURAR una copia de seguridad.   Uso:  npm run restaurar-backup
//
// Deja la base elegida EXACTAMENTE como estaba en la copia:
// · 1) Base local  → para revisar la copia en tu PC (no toca Render).
// · 2) Render      → vuelve producción al estado de la copia. Antes de tocar nada
//                    saca automáticamente una copia del estado actual.
// ─────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { preguntar, obtenerUrlRender, clienteDesdeUrl, ocultarClave, explicarError } = require('./herramientas-db');

const CARPETA_BACKUPS = path.join(__dirname, 'backups');

// Solo se restauran las tablas de ESTA aplicación. La base de Render es compartida con otros
// sistemas (banco de horas, lotetrack…) y sus tablas NO se tocan.
const TABLAS_KPI = [
  'produccion', 'operarios', 'motivos_parada', 'submotivos_parada', 'produccion_operarios',
  'paradas', 'grupos_operarios', 'grupo_operario_miembros',
];

async function elegirCopia() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('-') && !/^postgres/.test(a));
  if (arg) return path.resolve(arg);
  const copias = fs.existsSync(CARPETA_BACKUPS)
    ? fs.readdirSync(CARPETA_BACKUPS).filter(d => fs.existsSync(path.join(CARPETA_BACKUPS, d, 'datos.json'))).sort().reverse()
    : [];
  if (copias.length === 0) throw new Error('No hay copias en la carpeta backups/. Primero ejecutá: npm run backup-render');
  console.log('Copias disponibles:');
  copias.slice(0, 15).forEach((c, i) => console.log(`   ${i + 1}) ${c}${i === 0 ? '   (la más reciente)' : ''}`));
  const r = await preguntar('\n¿Cuál restaurar? (Enter = la más reciente): ');
  const n = r ? parseInt(r) : 1;
  if (!(n >= 1 && n <= copias.length)) throw new Error('Opción inválida.');
  return path.join(CARPETA_BACKUPS, copias[n - 1]);
}

async function restaurar(client, copia) {
  // Respeta el orden de dependencias de la copia; solo tablas del KPI
  const tablas = Object.keys(copia.tablas).filter(t => TABLAS_KPI.includes(t));
  if (tablas.length === 0) throw new Error('La copia no tiene tablas del KPI.');
  await client.query('BEGIN');
  try {
    for (const s of copia.secuencias || []) await client.query(`CREATE SEQUENCE IF NOT EXISTS ${s}`);

    // Crear las tablas que falten (p. ej. base vacía)
    const creadas = [];
    for (const t of tablas) {
      const { rows } = await client.query(`SELECT to_regclass($1) AS existe`, [`public.${t}`]);
      if (!rows[0].existe) {
        for (const sql of copia.tablas[t].ddl || []) await client.query(sql);
        creadas.push(t);
      }
    }
    for (const t of creadas) for (const fk of copia.tablas[t].fks || []) await client.query(fk);

    // Vaciar (CASCADE también vacía las tablas que dependen de éstas, p. ej. paradas de la versión nueva)
    await client.query(`TRUNCATE ${tablas.map(t => `"${t}"`).join(', ')} CASCADE`);

    for (const t of tablas) {
      const { columnas, filas } = copia.tablas[t];
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t]);
      const destino = new Set(cols.map(c => c.column_name));
      const comunes = columnas.filter(c => destino.has(c));
      for (let i = 0; i < filas.length; i += 200) {
        const valores = [];
        const lote = filas.slice(i, i + 200).map(f =>
          `(${comunes.map(c => { valores.push(f[c] !== null && typeof f[c] === 'object' ? JSON.stringify(f[c]) : f[c]); return `$${valores.length}`; }).join(', ')})`);
        await client.query(`INSERT INTO "${t}" (${comunes.map(c => `"${c}"`).join(', ')}) VALUES ${lote.join(', ')}`, valores);
      }
      const sq = destino.has('id')
        ? (await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [`public.${t}`])).rows[0]
        : null;
      if (sq && sq.seq) await client.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${t}"), 0) + 1, false)`, [sq.seq]);
      console.log(`   · ${t}: ${filas.length} filas`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`No se restauró nada (se deshicieron los cambios): ${err.message}`);
  }
}

(async () => {
  console.log('\n♻️  Restaurar copia de seguridad\n');
  const carpeta = await elegirCopia();
  const copia = JSON.parse(fs.readFileSync(path.join(carpeta, 'datos.json'), 'utf8'));
  const kpi    = Object.keys(copia.tablas).filter(t => TABLAS_KPI.includes(t));
  const otras  = Object.keys(copia.tablas).filter(t => !TABLAS_KPI.includes(t));
  console.log(`\nCopia: ${path.basename(carpeta)}`);
  console.log(`   Se restauran (KPI): ${kpi.map(t => `${t} (${copia.tablas[t].filas.length})`).join(', ')}`);
  if (otras.length) console.log(`   No se tocan (otros sistemas): ${otras.join(', ')}`);

  let destino = process.argv.includes('--render') ? '2' : process.argv.includes('--local') ? '1' : '';
  if (!destino) {
    console.log('\n¿Dónde la restauro?');
    console.log('   1) Base local  (para revisarla en tu PC, no toca Render)');
    console.log('   2) Render      (PRODUCCIÓN: reemplaza los datos actuales)');
    destino = await preguntar('Opción: ');
  }

  if (destino === '1') {
    const { iniciarBaseLocal, URL_LOCAL } = require('./local-db');
    const base = await iniciarBaseLocal();
    const client = clienteDesdeUrl(URL_LOCAL);
    await client.connect();
    console.log('\nRestaurando en la base local…');
    await restaurar(client, copia);
    await client.end();
    await base.detener();
    console.log('\n✅ Base local restaurada. Abrila con:  npm run local');
  } else if (destino === '2') {
    const url = await obtenerUrlRender();
    console.log(`\n⚠️  Vas a reemplazar los datos de PRODUCCIÓN (${ocultarClave(url)}) por la copia ${path.basename(carpeta)}.`);
    const ok = await preguntar('Para confirmar escribí RESTAURAR: ');
    if (ok !== 'RESTAURAR') { console.log('Cancelado. No se tocó nada.'); process.exit(0); }

    console.log('\n💾 Primero, copia de seguridad del estado actual de Render…');
    execFileSync(process.execPath, [path.join(__dirname, 'backup-render.js'), url], { stdio: 'inherit' });

    const client = clienteDesdeUrl(url);
    await client.connect();
    console.log('\nRestaurando en Render…');
    await restaurar(client, copia);
    await client.end();
    console.log('\n✅ Render restaurado al estado de la copia. Si en Render corre la versión nueva, reiniciá el servicio para que vuelva a adaptar los datos.');
  } else {
    console.log('Opción inválida. No se tocó nada.');
  }
  process.exit(0);
})().catch(err => { explicarError(err); process.exit(1); });
