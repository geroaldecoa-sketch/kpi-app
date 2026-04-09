const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { pool, initSchema, resetData } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const MOTIVOS_VALIDOS = ['Mantenimiento', 'Falta de insumos', 'Corte de luz', 'Otros'];

// ─────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────
function calcularKPIs(row) {
  const ht    = parseFloat(row.horas_totales)    || 0;
  const hp    = parseFloat(row.horas_produccion) || 0;
  const hpar  = parseFloat(row.horas_parados)    || 0;
  const bots  = parseInt(row.botellas_producidas) || 0;
  const bid5  = parseInt(row.bidones_5l  ?? row.bidones_5L)  || 0;
  const bid10 = parseInt(row.bidones_10l ?? row.bidones_10L) || 0;

  // PostgreSQL devuelve los nombres de columna en minúsculas
  return {
    id:                    row.id,
    fecha:                 row.fecha,
    turno:                 row.turno,
    horas_bidones:         parseFloat(row.horas_bidones)  || 0,
    horas_botellas:        parseFloat(row.horas_botellas) || 0,
    detalle_horas:         row.detalle_horas      || '',
    motivo_parada:         row.motivo_parada      || null,
    detalle_produccion:    row.detalle_produccion || '',
    horas_totales:         ht,
    horas_produccion:      hp,
    horas_parados:         hpar,
    botellas_producidas:   bots,
    bidones_5L:            bid5,
    bidones_10L:           bid10,
    created_at:            row.created_at,
    updated_at:            row.updated_at,
    // KPIs calculados
    total_bidones:         bid5 + bid10,
    pct_horas_activas:     ht > 0 ? +((hp   / ht) * 100).toFixed(2) : 0,
    pct_horas_paradas:     ht > 0 ? +((hpar / ht) * 100).toFixed(2) : 0,
    prom_botellas_hora:    hp > 0 ? +(bots  / hp).toFixed(2) : 0,
    prom_bidones_5L_hora:  hp > 0 ? +(bid5  / hp).toFixed(2) : 0,
    prom_bidones_10L_hora: hp > 0 ? +(bid10 / hp).toFixed(2) : 0,
  };
}

function validarRegistro(d) {
  const errores = [];

  if (!d.fecha)  errores.push('La fecha es obligatoria');
  if (!d.turno)  errores.push('El turno es obligatorio');

  if (d.motivo_parada && !MOTIVOS_VALIDOS.includes(d.motivo_parada)) {
    errores.push(`Motivo de parada inválido. Permitidos: ${MOTIVOS_VALIDOS.join(', ')}`);
  }

  const campos = [
    'horas_totales', 'horas_produccion', 'horas_parados',
    'horas_bidones', 'horas_botellas',
    'botellas_producidas', 'bidones_5L', 'bidones_10L',
  ];
  for (const c of campos) {
    if (d[c] === undefined || d[c] === null || d[c] === '') {
      errores.push(`El campo "${c}" es obligatorio`);
    } else if (parseFloat(d[c]) < 0) {
      errores.push(`El campo "${c}" debe ser >= 0`);
    }
  }

  if (errores.length === 0) {
    const ht   = parseFloat(d.horas_totales);
    const hp   = parseFloat(d.horas_produccion);
    const hpa  = parseFloat(d.horas_parados);
    const suma = +(hp + hpa).toFixed(4);
    if (Math.abs(suma - ht) > 0.01) {
      errores.push(
        `Horas Producción (${hp}) + Horas Parados (${hpa}) = ${suma}, debe ser igual a Horas Totales (${ht})`
      );
    }
  }

  return errores;
}

// ─────────────────────────────────────────────
// PRODUCCIÓN – CRUD
// ─────────────────────────────────────────────

// GET /api/produccion
app.get('/api/produccion', async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, turno, page = 1, limit = 100 } = req.query;

    const conditions = ['1=1'];
    const params     = [];
    let   idx        = 1;

    if (fecha_desde) { conditions.push(`fecha >= $${idx++}`); params.push(fecha_desde); }
    if (fecha_hasta) { conditions.push(`fecha <= $${idx++}`); params.push(fecha_hasta); }
    if (turno)       { conditions.push(`turno = $${idx++}`);  params.push(turno); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM produccion WHERE ${where} ORDER BY fecha DESC, turno DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]
      ),
      pool.query(`SELECT COUNT(*) AS n FROM produccion WHERE ${where}`, params),
    ]);

    console.log(`📋 GET /api/produccion → ${rowsResult.rows.length} registros`);
    res.json({ data: rowsResult.rows.map(calcularKPIs), total: parseInt(countResult.rows[0].n) });
  } catch (err) {
    console.error('❌ Error en GET /api/produccion:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/produccion/:id
app.get('/api/produccion/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produccion WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(calcularKPIs(result.rows[0]));
  } catch (err) {
    console.error('❌ Error en GET /api/produccion/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/produccion
app.post('/api/produccion', async (req, res) => {
  try {
    const d = req.body;
    console.log('📥 Datos recibidos (POST /api/produccion):', JSON.stringify(d));

    const errores = validarRegistro(d);
    if (errores.length > 0) {
      console.warn('⚠️  Registro rechazado por errores de validación:', errores);
      return res.status(400).json({ errores });
    }

    // Control de duplicados: no permitir mismo fecha+turno
    const existe = await pool.query(
      'SELECT id FROM produccion WHERE fecha = $1 AND turno = $2',
      [d.fecha, d.turno]
    );
    if (existe.rows.length > 0) {
      const idExistente = existe.rows[0].id;
      console.warn(`⚠️  Duplicado detectado: fecha=${d.fecha} turno=${d.turno} (id: ${idExistente})`);
      return res.status(409).json({
        errores: [`Ya existe un registro para el turno "${d.turno}" del ${d.fecha} (id: ${idExistente}). Usá la opción Editar.`]
      });
    }

    const result = await pool.query(`
      INSERT INTO produccion
        (fecha, turno, horas_bidones, horas_botellas, detalle_horas,
         motivo_parada, detalle_produccion, horas_totales, horas_produccion,
         horas_parados, botellas_producidas, bidones_5l, bidones_10l)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      d.fecha, d.turno,
      d.horas_bidones, d.horas_botellas, d.detalle_horas || '',
      d.motivo_parada || null, d.detalle_produccion || '',
      d.horas_totales, d.horas_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_5L, d.bidones_10L,
    ]);

    const nuevo = result.rows[0];
    console.log(`✅ Registro guardado correctamente (id: ${nuevo.id}, fecha: ${d.fecha}, turno: ${d.turno})`);
    res.status(201).json(calcularKPIs(nuevo));
  } catch (err) {
    console.error('❌ Error en POST /api/produccion:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/produccion/:id
app.put('/api/produccion/:id', async (req, res) => {
  try {
    const d  = req.body;
    const id = parseInt(req.params.id);
    console.log(`📥 Datos recibidos (PUT /api/produccion/${id}):`, JSON.stringify(d));

    const errores = validarRegistro(d);
    if (errores.length > 0) {
      console.warn('⚠️  Actualización rechazada por errores de validación:', errores);
      return res.status(400).json({ errores });
    }

    // Control de duplicados al editar
    const duplicado = await pool.query(
      'SELECT id FROM produccion WHERE fecha = $1 AND turno = $2 AND id != $3',
      [d.fecha, d.turno, id]
    );
    if (duplicado.rows.length > 0) {
      const idDup = duplicado.rows[0].id;
      console.warn(`⚠️  Conflicto al editar: ya existe registro id=${idDup} para fecha=${d.fecha} turno=${d.turno}`);
      return res.status(409).json({
        errores: [`Ya existe otro registro para el turno "${d.turno}" del ${d.fecha} (id: ${idDup}).`]
      });
    }

    const result = await pool.query(`
      UPDATE produccion SET
        fecha = $1, turno = $2, horas_bidones = $3, horas_botellas = $4,
        detalle_horas = $5, motivo_parada = $6, detalle_produccion = $7,
        horas_totales = $8, horas_produccion = $9, horas_parados = $10,
        botellas_producidas = $11, bidones_5l = $12, bidones_10l = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `, [
      d.fecha, d.turno,
      d.horas_bidones, d.horas_botellas, d.detalle_horas || '',
      d.motivo_parada || null, d.detalle_produccion || '',
      d.horas_totales, d.horas_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_5L, d.bidones_10L,
      id,
    ]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });

    console.log(`✅ Registro actualizado correctamente (id: ${id})`);
    res.json(calcularKPIs(result.rows[0]));
  } catch (err) {
    console.error('❌ Error en PUT /api/produccion/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/produccion/:id — elimina SOLO el registro indicado
app.delete('/api/produccion/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`🗑️  Eliminando registro id: ${id}`);
    const result = await pool.query('DELETE FROM produccion WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    console.log(`✅ Registro id: ${id} eliminado`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error en DELETE /api/produccion/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN – Reset total (solo uso manual)
// ─────────────────────────────────────────────
app.post('/api/admin/reset', async (req, res) => {
  try {
    console.warn('⚠️  RESET TOTAL solicitado — se eliminarán TODOS los registros');
    await resetData();
    console.warn('✅ Base de datos reseteada');
    res.json({ ok: true, mensaje: 'Todos los datos de producción fueron eliminados.' });
  } catch (err) {
    console.error('❌ Error en POST /api/admin/reset:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REPORTES
// ─────────────────────────────────────────────

// GET /api/reportes/mensual
app.get('/api/reportes/mensual', async (req, res) => {
  try {
    const { fecha_desde = '2000-01-01', fecha_hasta = '2099-12-31' } = req.query;

    // PostgreSQL usa TO_CHAR en lugar de strftime
    const result = await pool.query(`
      SELECT
        TO_CHAR(fecha::date, 'YYYY-MM')  AS mes,
        COUNT(*)::int                    AS registros,
        SUM(horas_totales)               AS horas_totales,
        SUM(horas_produccion)            AS horas_produccion,
        SUM(horas_parados)               AS horas_parados,
        SUM(botellas_producidas)::int    AS botellas_producidas,
        SUM(bidones_5l)::int             AS bidones_5l,
        SUM(bidones_10l)::int            AS bidones_10l,
        SUM(CASE WHEN motivo_parada = 'Mantenimiento'    THEN 1 ELSE 0 END)::int AS paradas_mantenimiento,
        SUM(CASE WHEN motivo_parada = 'Falta de insumos' THEN 1 ELSE 0 END)::int AS paradas_insumos,
        SUM(CASE WHEN motivo_parada = 'Corte de luz'     THEN 1 ELSE 0 END)::int AS paradas_corte,
        SUM(CASE WHEN motivo_parada = 'Otros'            THEN 1 ELSE 0 END)::int AS paradas_otros
      FROM produccion
      WHERE fecha BETWEEN $1 AND $2
      GROUP BY TO_CHAR(fecha::date, 'YYYY-MM')
      ORDER BY mes
    `, [fecha_desde, fecha_hasta]);

    const resultado = result.rows.map(r => {
      const ht    = parseFloat(r.horas_totales)    || 0;
      const hp    = parseFloat(r.horas_produccion) || 0;
      const bid5  = parseInt(r.bidones_5l)         || 0;
      const bid10 = parseInt(r.bidones_10l)        || 0;
      const totalBidones = bid5 + bid10;
      const totalParadas =
        (r.paradas_mantenimiento + r.paradas_insumos + r.paradas_corte + r.paradas_otros) || 1;

      return {
        mes:                       r.mes,
        registros:                 r.registros,
        horas_totales:             +ht.toFixed(2),
        horas_produccion:          +hp.toFixed(2),
        horas_parados:             +(parseFloat(r.horas_parados) || 0).toFixed(2),
        botellas_producidas:       r.botellas_producidas,
        bidones_5L:                bid5,
        bidones_10L:               bid10,
        total_bidones:             totalBidones,
        pct_horas_activas:         ht > 0 ? +((hp / ht) * 100).toFixed(1) : 0,
        pct_horas_paradas:         ht > 0 ? +((parseFloat(r.horas_parados) / ht) * 100).toFixed(1) : 0,
        prom_botellas_hora:        hp > 0 ? +(r.botellas_producidas / hp).toFixed(1) : 0,
        prom_bidones_5L_hora:      hp > 0 ? +(bid5  / hp).toFixed(1) : 0,
        prom_bidones_10L_hora:     hp > 0 ? +(bid10 / hp).toFixed(1) : 0,
        paradas_mantenimiento:     r.paradas_mantenimiento,
        paradas_insumos:           r.paradas_insumos,
        paradas_corte:             r.paradas_corte,
        paradas_otros:             r.paradas_otros,
        pct_paradas_mantenimiento: +((r.paradas_mantenimiento / totalParadas) * 100).toFixed(1),
        pct_paradas_insumos:       +((r.paradas_insumos       / totalParadas) * 100).toFixed(1),
        pct_paradas_corte:         +((r.paradas_corte         / totalParadas) * 100).toFixed(1),
        pct_paradas_otros:         +((r.paradas_otros         / totalParadas) * 100).toFixed(1),
      };
    });

    res.json(resultado);
  } catch (err) {
    console.error('❌ Error en GET /api/reportes/mensual:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/acumulado
app.get('/api/reportes/acumulado', async (req, res) => {
  try {
    const { fecha_desde = '2000-01-01', fecha_hasta = '2099-12-31', turno } = req.query;

    const conditions = ['fecha BETWEEN $1 AND $2'];
    const params     = [fecha_desde, fecha_hasta];

    if (turno) {
      conditions.push(`turno = $${params.length + 1}`);
      params.push(turno);
    }

    const result = await pool.query(`
      SELECT fecha, turno, botellas_producidas, bidones_5l, bidones_10l
      FROM produccion
      WHERE ${conditions.join(' AND ')}
      ORDER BY fecha ASC, turno ASC
    `, params);

    const rows = result.rows.map(r => ({
      fecha:               r.fecha,
      turno:               r.turno,
      botellas_producidas: parseInt(r.botellas_producidas) || 0,
      bidones_5L:          parseInt(r.bidones_5l)  || 0,
      bidones_10L:         parseInt(r.bidones_10l) || 0,
    }));

    const totales = rows.reduce((acc, r) => ({
      botellas:      acc.botellas      + r.botellas_producidas,
      bidones_5L:    acc.bidones_5L    + r.bidones_5L,
      bidones_10L:   acc.bidones_10L   + r.bidones_10L,
      bidones_total: acc.bidones_total + r.bidones_5L + r.bidones_10L,
    }), { botellas: 0, bidones_5L: 0, bidones_10L: 0, bidones_total: 0 });

    res.json({ datos: rows, totales });
  } catch (err) {
    console.error('❌ Error en GET /api/reportes/acumulado:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// CATCH-ALL
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────
async function start() {
  try {
    // Verificar conexión a PostgreSQL
    await pool.query('SELECT 1');
    console.log('✅ Conexión a PostgreSQL establecida');

    // Crear tablas si no existen
    await initSchema();

    app.listen(PORT, () => {
      console.log(`\n🚀 KPI Producción corriendo en http://localhost:${PORT}`);
      console.log(`   Landing page: http://localhost:${PORT}/`);
      console.log(`   Sistema KPI:  http://localhost:${PORT}/app.html\n`);
    });
  } catch (err) {
    console.error('❌ No se pudo conectar a PostgreSQL:', err.message);
    console.error('   Verificá que DATABASE_URL esté configurado correctamente');
    process.exit(1);
  }
}

start();
