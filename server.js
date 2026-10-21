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
// UTILIDADES
// ─────────────────────────────────────────────
const r2 = n => Math.round(n * 100) / 100;

function calcularKPIs(row) {
  const ht    = parseFloat(row.horas_totales)    || 0;
  const hp    = parseFloat(row.horas_produccion) || 0;
  const hpar  = parseFloat(row.horas_parados)    || 0;
  const bots  = parseInt(row.botellas_producidas) || 0;
  const bid5  = parseInt(row.bidones_5l  ?? row.bidones_5L)  || 0;
  const bid10 = parseInt(row.bidones_10l ?? row.bidones_10L) || 0;
  const paradas   = row.paradas   || [];
  const operarios = row.operarios || [];

  // PostgreSQL devuelve los nombres de columna en minúsculas
  return {
    id:                    row.id,
    fecha:                 row.fecha,
    turno:                 row.turno,
    horas_bidones:         parseFloat(row.horas_bidones)  || 0,
    horas_botellas:        parseFloat(row.horas_botellas) || 0,
    observaciones:         row.observaciones || '',
    horas_totales:         ht,
    horas_produccion:      r2(hp),
    horas_parados:         r2(hpar),
    botellas_producidas:   bots,
    bidones_5L:            bid5,
    bidones_10L:           bid10,
    operarios,
    paradas,
    cantidad_paradas:      paradas.length,
    minutos_parada:        paradas.reduce((a, p) => a + (p.minutos || 0), 0),
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

// SELECT de producción con operarios y paradas embebidos
const SELECT_PRODUCCION = `
  SELECT p.*,
    COALESCE((
      SELECT json_agg(json_build_object('id', o.id, 'nombre', TRIM(o.nombre || ' ' || o.apellido), 'dni', o.dni) ORDER BY LOWER(o.apellido), LOWER(o.nombre))
      FROM produccion_operarios po JOIN operarios o ON o.id = po.operario_id
      WHERE po.produccion_id = p.id
    ), '[]') AS operarios,
    COALESCE((
      SELECT json_agg(json_build_object(
               'id', pa.id, 'motivo_id', pa.motivo_id, 'motivo', m.nombre,
               'submotivo_id', pa.submotivo_id, 'submotivo', COALESCE(s.nombre, ''),
               'detalle', pa.detalle, 'minutos', pa.minutos) ORDER BY pa.orden, pa.id)
      FROM paradas pa
      JOIN motivos_parada m         ON m.id = pa.motivo_id
      LEFT JOIN submotivos_parada s ON s.id = pa.submotivo_id
      WHERE pa.produccion_id = p.id
    ), '[]') AS paradas
  FROM produccion p
`;

async function obtenerRegistro(id, db = pool) {
  const r = await db.query(`${SELECT_PRODUCCION} WHERE p.id = $1`, [id]);
  return r.rows[0] ? calcularKPIs(r.rows[0]) : null;
}

// Normaliza y valida el cuerpo del registro. Devuelve { errores, datos }.
async function validarRegistro(d) {
  const errores = [];

  if (!d.fecha)  errores.push('La fecha es obligatoria');
  if (!d.turno)  errores.push('El turno es obligatorio');

  const campos = [
    'horas_totales', 'horas_bidones', 'horas_botellas',
    'botellas_producidas', 'bidones_5L', 'bidones_10L',
  ];
  for (const c of campos) {
    if (d[c] === undefined || d[c] === null || d[c] === '') {
      errores.push(`El campo "${c}" es obligatorio`);
    } else if (isNaN(parseFloat(d[c])) || parseFloat(d[c]) < 0) {
      errores.push(`El campo "${c}" debe ser un número >= 0`);
    }
  }

  // Operarios
  const operarioIds = [...new Set((Array.isArray(d.operario_ids) ? d.operario_ids : [])
    .map(x => parseInt(x)).filter(x => x > 0))];
  if (operarioIds.length > 0) {
    const { rows } = await pool.query('SELECT id FROM operarios WHERE id = ANY($1::int[])', [operarioIds]);
    if (rows.length !== operarioIds.length) errores.push('Hay operarios seleccionados que no existen');
  }

  // Paradas
  const paradas = (Array.isArray(d.paradas) ? d.paradas : []).map((p, i) => ({
    motivo_id:    parseInt(p.motivo_id),
    submotivo_id: parseInt(p.submotivo_id) || null,
    detalle:      (p.detalle || '').toString().trim(),
    minutos:   parseInt(p.minutos),
    orden:     i,
  }));
  paradas.forEach((p, i) => {
    if (!(p.motivo_id > 0))                errores.push(`Parada ${i + 1}: el motivo es obligatorio`);
    if (!(p.minutos > 0))                  errores.push(`Parada ${i + 1}: los minutos deben ser mayores a 0`);
  });
  const motivoIds = [...new Set(paradas.map(p => p.motivo_id).filter(x => x > 0))];
  if (motivoIds.length > 0) {
    const { rows } = await pool.query('SELECT id FROM motivos_parada WHERE id = ANY($1::int[])', [motivoIds]);
    if (rows.length !== motivoIds.length) errores.push('Hay paradas con un motivo que no existe');

    // Submotivo: debe pertenecer al motivo, y es obligatorio si el motivo tiene submotivos activos
    const { rows: subs } = await pool.query(
      'SELECT id, motivo_id, activo FROM submotivos_parada WHERE motivo_id = ANY($1::int[])', [motivoIds]);
    paradas.forEach((p, i) => {
      const delMotivo = subs.filter(s => s.motivo_id === p.motivo_id);
      if (p.submotivo_id) {
        if (!delMotivo.some(s => s.id === p.submotivo_id)) errores.push(`Parada ${i + 1}: el submotivo no corresponde al motivo elegido`);
      } else if (delMotivo.some(s => s.activo)) {
        errores.push(`Parada ${i + 1}: elegí el submotivo`);
      }
    });
  }

  // Horas: parados = suma de paradas; producción = totales − parados
  const ht      = parseFloat(d.horas_totales) || 0;
  const minutos = paradas.reduce((a, p) => a + (p.minutos > 0 ? p.minutos : 0), 0);
  const hpar    = minutos / 60;
  const hp      = ht - hpar;
  if (errores.length === 0 && hp < -0.001) {
    errores.push(`Las paradas suman ${minutos} min (${r2(hpar)} hs) y superan las Horas Totales (${ht} hs)`);
  }

  return {
    errores,
    datos: {
      fecha: d.fecha,
      turno: d.turno,
      horas_bidones:       parseFloat(d.horas_bidones)  || 0,
      horas_botellas:      parseFloat(d.horas_botellas) || 0,
      observaciones:       (d.observaciones || '').toString().trim(),
      horas_totales:       ht,
      horas_produccion:    Math.max(0, hp),
      horas_parados:       hpar,
      botellas_producidas: parseInt(d.botellas_producidas) || 0,
      bidones_5L:          parseInt(d.bidones_5L)  || 0,
      bidones_10L:         parseInt(d.bidones_10L) || 0,
      operarioIds,
      paradas,
    },
  };
}

async function guardarHijos(client, produccionId, datos) {
  await client.query('DELETE FROM produccion_operarios WHERE produccion_id = $1', [produccionId]);
  await client.query('DELETE FROM paradas WHERE produccion_id = $1', [produccionId]);
  for (const opId of datos.operarioIds) {
    await client.query('INSERT INTO produccion_operarios (produccion_id, operario_id) VALUES ($1, $2)', [produccionId, opId]);
  }
  for (const p of datos.paradas) {
    await client.query(
      'INSERT INTO paradas (produccion_id, motivo_id, submotivo_id, detalle, minutos, orden) VALUES ($1, $2, $3, $4, $5, $6)',
      [produccionId, p.motivo_id, p.submotivo_id, p.detalle, p.minutos, p.orden]
    );
  }
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
        `${SELECT_PRODUCCION} WHERE ${where} ORDER BY fecha DESC, turno DESC LIMIT $${idx} OFFSET $${idx + 1}`,
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
    const reg = await obtenerRegistro(parseInt(req.params.id));
    if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(reg);
  } catch (err) {
    console.error('❌ Error en GET /api/produccion/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/produccion
app.post('/api/produccion', async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('📥 Datos recibidos (POST /api/produccion):', JSON.stringify(req.body));

    const { errores, datos: d } = await validarRegistro(req.body);
    if (errores.length > 0) {
      console.warn('⚠️  Registro rechazado por errores de validación:', errores);
      return res.status(400).json({ errores });
    }

    // Control de duplicados: no permitir mismo fecha+turno
    const existe = await client.query(
      'SELECT id FROM produccion WHERE fecha = $1 AND turno = $2',
      [d.fecha, d.turno]
    );
    if (existe.rows.length > 0) {
      const idExistente = existe.rows[0].id;
      return res.status(409).json({
        errores: [`Ya existe un registro para el turno "${d.turno}" del ${d.fecha} (id: ${idExistente}). Usá la opción Editar.`]
      });
    }

    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO produccion
        (fecha, turno, horas_bidones, horas_botellas, observaciones,
         horas_totales, horas_produccion, horas_parados,
         botellas_producidas, bidones_5l, bidones_10l)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      d.fecha, d.turno, d.horas_bidones, d.horas_botellas, d.observaciones,
      d.horas_totales, d.horas_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_5L, d.bidones_10L,
    ]);
    const id = result.rows[0].id;
    await guardarHijos(client, id, d);
    await client.query('COMMIT');

    console.log(`✅ Registro guardado (id: ${id}, fecha: ${d.fecha}, turno: ${d.turno}, paradas: ${d.paradas.length}, operarios: ${d.operarioIds.length})`);
    res.status(201).json(await obtenerRegistro(id));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error en POST /api/produccion:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/produccion/:id
app.put('/api/produccion/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    console.log(`📥 Datos recibidos (PUT /api/produccion/${id}):`, JSON.stringify(req.body));

    const { errores, datos: d } = await validarRegistro(req.body);
    if (errores.length > 0) {
      console.warn('⚠️  Actualización rechazada por errores de validación:', errores);
      return res.status(400).json({ errores });
    }

    const duplicado = await client.query(
      'SELECT id FROM produccion WHERE fecha = $1 AND turno = $2 AND id != $3',
      [d.fecha, d.turno, id]
    );
    if (duplicado.rows.length > 0) {
      const idDup = duplicado.rows[0].id;
      return res.status(409).json({
        errores: [`Ya existe otro registro para el turno "${d.turno}" del ${d.fecha} (id: ${idDup}).`]
      });
    }

    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE produccion SET
        fecha = $1, turno = $2, horas_bidones = $3, horas_botellas = $4,
        observaciones = $5, horas_totales = $6, horas_produccion = $7, horas_parados = $8,
        botellas_producidas = $9, bidones_5l = $10, bidones_10l = $11,
        updated_at = NOW()
      WHERE id = $12
      RETURNING id
    `, [
      d.fecha, d.turno, d.horas_bidones, d.horas_botellas, d.observaciones,
      d.horas_totales, d.horas_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_5L, d.bidones_10L,
      id,
    ]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    await guardarHijos(client, id, d);
    await client.query('COMMIT');

    console.log(`✅ Registro actualizado correctamente (id: ${id})`);
    res.json(await obtenerRegistro(id));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error en PUT /api/produccion/:id:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/produccion/:id — elimina el registro (y sus paradas/operarios por CASCADE)
app.delete('/api/produccion/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
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
// ABM GENÉRICO DE MAESTROS (operarios / motivos de parada)
// ─────────────────────────────────────────────
function abmMaestro({ ruta, tabla, etiqueta, campos, usoSql, orden = 'LOWER(t.nombre)', normalizar = x => x, msgDuplicado }) {
  const dup = msgDuplicado || `Ya existe un ${etiqueta} con ese nombre`;
  const limpiar = body => {
    const out = {};
    for (const c of campos) out[c] = (body[c] ?? '').toString().trim().replace(/\s+/g, ' ');
    normalizar(out);
    out.activo = body.activo === undefined ? true : !!body.activo;
    return out;
  };

  // Listar (con cantidad de usos para saber si se puede borrar)
  app.get(ruta, async (req, res) => {
    try {
      const soloActivos = req.query.activos === '1';
      const { rows } = await pool.query(`
        SELECT t.*, (${usoSql})::int AS usos
        FROM ${tabla} t
        ${soloActivos ? 'WHERE t.activo' : ''}
        ORDER BY t.activo DESC, ${orden}
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(ruta, async (req, res) => {
    try {
      const d = limpiar(req.body);
      if (!d.nombre) return res.status(400).json({ errores: ['El nombre es obligatorio'] });
      const cols = [...campos, 'activo'];
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        cols.map(c => d[c])
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ errores: [dup] });
      res.status(500).json({ error: err.message });
    }
  });

  app.put(`${ruta}/:id`, async (req, res) => {
    try {
      const d = limpiar(req.body);
      if (!d.nombre) return res.status(400).json({ errores: ['El nombre es obligatorio'] });
      const cols = [...campos, 'activo'];
      const { rows } = await pool.query(
        `UPDATE ${tabla} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
         WHERE id = $${cols.length + 1} RETURNING *`,
        [...cols.map(c => d[c]), parseInt(req.params.id)]
      );
      if (rows.length === 0) return res.status(404).json({ error: `${etiqueta} no encontrado` });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ errores: [dup] });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete(`${ruta}/:id`, async (req, res) => {
    try {
      const { rows } = await pool.query(`DELETE FROM ${tabla} WHERE id = $1 RETURNING id`, [parseInt(req.params.id)]);
      if (rows.length === 0) return res.status(404).json({ error: `${etiqueta} no encontrado` });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(409).json({
          error: `No se puede eliminar: el ${etiqueta} ya está usado en registros de producción. Desactivalo para que no aparezca más en la carga.`
        });
      }
      res.status(500).json({ error: err.message });
    }
  });
}

const soloDigitos = v => (v ?? '').toString().replace(/\D/g, '');

// Importación masiva desde Excel (se registra antes que el ABM genérico)
// Busca por DNI; si no hay DNI, por nombre + apellido. Crea o actualiza.
app.post('/api/operarios/importar', async (req, res) => {
  const lista = Array.isArray(req.body.operarios) ? req.body.operarios : [];
  if (lista.length === 0) return res.status(400).json({ errores: ['No hay operarios para importar'] });
  const client = await pool.connect();
  const resultado = { creados: 0, actualizados: 0, sin_cambios: 0, errores: [] };
  try {
    await client.query('BEGIN');
    for (const [i, o] of lista.entries()) {
      const nombre   = (o.nombre   ?? '').toString().trim().replace(/\s+/g, ' ');
      const apellido = (o.apellido ?? '').toString().trim().replace(/\s+/g, ' ');
      const dni      = soloDigitos(o.dni);
      if (!nombre || !apellido) { resultado.errores.push(`Fila ${o.fila || i + 1}: falta nombre o apellido`); continue; }

      let existente = null;
      if (dni) existente = (await client.query('SELECT * FROM operarios WHERE dni = $1', [dni])).rows[0];
      if (!existente) {
        existente = (await client.query(
          'SELECT * FROM operarios WHERE LOWER(nombre) = LOWER($1) AND LOWER(apellido) = LOWER($2)', [nombre, apellido]
        )).rows[0];
      }

      if (!existente) {
        await client.query('INSERT INTO operarios (nombre, apellido, dni) VALUES ($1, $2, $3)', [nombre, apellido, dni]);
        resultado.creados++;
      } else if (existente.nombre !== nombre || existente.apellido !== apellido || (dni && existente.dni !== dni)) {
        await client.query(
          'UPDATE operarios SET nombre = $1, apellido = $2, dni = $3, updated_at = NOW() WHERE id = $4',
          [nombre, apellido, dni || existente.dni, existente.id]
        );
        resultado.actualizados++;
      } else {
        resultado.sin_cambios++;
      }
    }
    await client.query('COMMIT');
    console.log(`📥 Importación de operarios: ${JSON.stringify(resultado)}`);
    res.json(resultado);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ errores: ['Hay operarios repetidos (mismo DNI o mismo nombre y apellido)'] });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

abmMaestro({
  ruta: '/api/operarios', tabla: 'operarios', etiqueta: 'operario',
  campos: ['nombre', 'apellido', 'dni'],
  orden: 'LOWER(t.apellido), LOWER(t.nombre)',
  normalizar: d => { d.dni = soloDigitos(d.dni); },
  msgDuplicado: 'Ya existe un operario con ese nombre y apellido o con ese DNI',
  usoSql: 'SELECT COUNT(*) FROM produccion_operarios x WHERE x.operario_id = t.id',
});

// ─────────────────────────────────────────────
// GRUPOS DE OPERARIOS
// ─────────────────────────────────────────────
async function listarGrupos() {
  const { rows } = await pool.query(`
    SELECT g.*,
      COALESCE((SELECT json_agg(m.operario_id ORDER BY m.operario_id)
                FROM grupo_operario_miembros m WHERE m.grupo_id = g.id), '[]') AS operario_ids
    FROM grupos_operarios g
    ORDER BY g.activo DESC, LOWER(g.nombre)
  `);
  return rows;
}

app.get('/api/grupos', async (req, res) => {
  try { res.json(await listarGrupos()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

async function guardarGrupo(req, res, id = null) {
  const nombre = (req.body.nombre ?? '').toString().trim().replace(/\s+/g, ' ');
  const activo = req.body.activo === undefined ? true : !!req.body.activo;
  const ids = [...new Set((Array.isArray(req.body.operario_ids) ? req.body.operario_ids : [])
    .map(x => parseInt(x)).filter(x => x > 0))];
  if (!nombre) return res.status(400).json({ errores: ['El nombre del grupo es obligatorio'] });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let grupoId = id;
    if (id) {
      const r = await client.query('UPDATE grupos_operarios SET nombre = $1, activo = $2, updated_at = NOW() WHERE id = $3 RETURNING id', [nombre, activo, id]);
      if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Grupo no encontrado' }); }
    } else {
      grupoId = (await client.query('INSERT INTO grupos_operarios (nombre, activo) VALUES ($1, $2) RETURNING id', [nombre, activo])).rows[0].id;
    }
    await client.query('DELETE FROM grupo_operario_miembros WHERE grupo_id = $1', [grupoId]);
    if (ids.length) {
      await client.query(
        'INSERT INTO grupo_operario_miembros (grupo_id, operario_id) SELECT $1, UNNEST($2::int[]) ON CONFLICT DO NOTHING',
        [grupoId, ids]
      );
    }
    await client.query('COMMIT');
    res.status(id ? 200 : 201).json((await listarGrupos()).find(g => g.id === grupoId));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ errores: ['Ya existe un grupo con ese nombre'] });
    if (err.code === '23503') return res.status(400).json({ errores: ['Hay operarios del grupo que no existen'] });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

app.post('/api/grupos', (req, res) => guardarGrupo(req, res));
app.put('/api/grupos/:id', (req, res) => guardarGrupo(req, res, parseInt(req.params.id)));
app.delete('/api/grupos/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM grupos_operarios WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

abmMaestro({
  ruta: '/api/motivos', tabla: 'motivos_parada', etiqueta: 'motivo',
  campos: ['nombre'],
  usoSql: 'SELECT COUNT(*) FROM paradas x WHERE x.motivo_id = t.id',
});

// ─────────────────────────────────────────────
// SUBMOTIVOS DE PARADA (dependen del motivo)
// ─────────────────────────────────────────────
app.get('/api/submotivos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, m.nombre AS motivo,
        (SELECT COUNT(*) FROM paradas x WHERE x.submotivo_id = s.id)::int AS usos
      FROM submotivos_parada s JOIN motivos_parada m ON m.id = s.motivo_id
      ORDER BY LOWER(m.nombre), s.activo DESC, LOWER(s.nombre)`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function guardarSubmotivo(req, res, id = null) {
  const nombre    = (req.body.nombre ?? '').toString().trim().replace(/\s+/g, ' ');
  const motivo_id = parseInt(req.body.motivo_id);
  const activo    = req.body.activo === undefined ? true : !!req.body.activo;
  if (!(motivo_id > 0)) return res.status(400).json({ errores: ['Elegí el motivo'] });
  if (!nombre)          return res.status(400).json({ errores: ['El nombre del submotivo es obligatorio'] });
  try {
    if (id) {
      // No permitir cambiar de motivo si ya se usó (quedarían paradas inconsistentes)
      const { rows: [actual] } = await pool.query(
        'SELECT motivo_id, (SELECT COUNT(*) FROM paradas WHERE submotivo_id = $1)::int AS usos FROM submotivos_parada WHERE id = $1', [id]);
      if (!actual) return res.status(404).json({ error: 'Submotivo no encontrado' });
      if (actual.usos > 0 && actual.motivo_id !== motivo_id) {
        return res.status(409).json({ errores: ['Este submotivo ya se usó: no se puede pasar a otro motivo. Creá uno nuevo.'] });
      }
      const { rows } = await pool.query(
        'UPDATE submotivos_parada SET motivo_id = $1, nombre = $2, activo = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
        [motivo_id, nombre, activo, id]);
      return res.json(rows[0]);
    }
    const { rows } = await pool.query(
      'INSERT INTO submotivos_parada (motivo_id, nombre, activo) VALUES ($1, $2, $3) RETURNING *', [motivo_id, nombre, activo]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ errores: ['Ese motivo ya tiene un submotivo con ese nombre'] });
    if (err.code === '23503') return res.status(400).json({ errores: ['El motivo no existe'] });
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/submotivos', (req, res) => guardarSubmotivo(req, res));
app.put('/api/submotivos/:id', (req, res) => guardarSubmotivo(req, res, parseInt(req.params.id)));
app.delete('/api/submotivos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM submotivos_parada WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: 'Submotivo no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar: el submotivo ya está usado en paradas. Desactivalo para que no aparezca más en la carga.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Detalles de parada ya usados (para autocompletar en la carga)
app.get('/api/paradas/detalles', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT motivo_id, submotivo_id, detalle, COUNT(*)::int AS usos
      FROM paradas WHERE COALESCE(detalle, '') <> ''
      GROUP BY motivo_id, submotivo_id, detalle
      ORDER BY usos DESC, detalle
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
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

    const [resProd, resParadas, resSub] = await Promise.all([
      pool.query(`
        SELECT
          TO_CHAR(fecha::date, 'YYYY-MM')  AS mes,
          COUNT(*)::int                    AS registros,
          SUM(horas_totales)               AS horas_totales,
          SUM(horas_produccion)            AS horas_produccion,
          SUM(horas_parados)               AS horas_parados,
          SUM(botellas_producidas)::int    AS botellas_producidas,
          SUM(bidones_5l)::int             AS bidones_5l,
          SUM(bidones_10l)::int            AS bidones_10l
        FROM produccion
        WHERE fecha BETWEEN $1 AND $2
        GROUP BY TO_CHAR(fecha::date, 'YYYY-MM')
        ORDER BY mes
      `, [fecha_desde, fecha_hasta]),
      pool.query(`
        SELECT
          TO_CHAR(p.fecha::date, 'YYYY-MM') AS mes,
          m.id                              AS motivo_id,
          m.nombre                          AS motivo,
          COUNT(*)::int                     AS cantidad,
          SUM(pa.minutos)::int              AS minutos
        FROM paradas pa
        JOIN produccion p     ON p.id = pa.produccion_id
        JOIN motivos_parada m ON m.id = pa.motivo_id
        WHERE p.fecha BETWEEN $1 AND $2
        GROUP BY 1, 2, 3
        ORDER BY 1, 3
      `, [fecha_desde, fecha_hasta]),
      pool.query(`
        SELECT
          TO_CHAR(p.fecha::date, 'YYYY-MM') AS mes,
          m.id                              AS motivo_id,
          m.nombre                          AS motivo,
          COALESCE(s.nombre, '')            AS submotivo,
          COUNT(*)::int                     AS cantidad,
          SUM(pa.minutos)::int              AS minutos
        FROM paradas pa
        JOIN produccion p             ON p.id = pa.produccion_id
        JOIN motivos_parada m         ON m.id = pa.motivo_id
        LEFT JOIN submotivos_parada s ON s.id = pa.submotivo_id
        WHERE p.fecha BETWEEN $1 AND $2
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 3, 4
      `, [fecha_desde, fecha_hasta]),
    ]);

    const resultado = resProd.rows.map(r => {
      const ht    = parseFloat(r.horas_totales)    || 0;
      const hp    = parseFloat(r.horas_produccion) || 0;
      const hpar  = parseFloat(r.horas_parados)    || 0;
      const bid5  = parseInt(r.bidones_5l)         || 0;
      const bid10 = parseInt(r.bidones_10l)        || 0;
      const paradas = resParadas.rows
        .filter(p => p.mes === r.mes)
        .map(p => ({ motivo_id: p.motivo_id, motivo: p.motivo, cantidad: p.cantidad, minutos: p.minutos }));
      const paradas_submotivo = resSub.rows
        .filter(p => p.mes === r.mes)
        .map(p => ({ motivo_id: p.motivo_id, motivo: p.motivo, submotivo: p.submotivo, cantidad: p.cantidad, minutos: p.minutos }));

      return {
        mes:                   r.mes,
        registros:             r.registros,
        horas_totales:         +ht.toFixed(2),
        horas_produccion:      +hp.toFixed(2),
        horas_parados:         +hpar.toFixed(2),
        botellas_producidas:   r.botellas_producidas,
        bidones_5L:            bid5,
        bidones_10L:           bid10,
        total_bidones:         bid5 + bid10,
        pct_horas_activas:     ht > 0 ? +((hp / ht) * 100).toFixed(1) : 0,
        pct_horas_paradas:     ht > 0 ? +((hpar / ht) * 100).toFixed(1) : 0,
        prom_botellas_hora:    hp > 0 ? +(r.botellas_producidas / hp).toFixed(1) : 0,
        prom_bidones_5L_hora:  hp > 0 ? +(bid5  / hp).toFixed(1) : 0,
        prom_bidones_10L_hora: hp > 0 ? +(bid10 / hp).toFixed(1) : 0,
        cantidad_paradas:      paradas.reduce((a, p) => a + p.cantidad, 0),
        minutos_paradas:       paradas.reduce((a, p) => a + p.minutos, 0),
        paradas,
        paradas_submotivo,
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
// Rutas de API inexistentes: responder JSON (no la página HTML)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Ruta de API no encontrada: ${req.method} ${req.path}. Reiniciá el servidor si acabás de actualizar la aplicación.` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Conexión a PostgreSQL establecida');

    // Crear tablas si no existen + migrar registros viejos
    await initSchema();

    app.listen(PORT, () => {
      console.log(`\n🚀 KPI Producción corriendo en http://localhost:${PORT}`);
      console.log(`   Landing page: http://localhost:${PORT}/`);
      console.log(`   Sistema KPI:  http://localhost:${PORT}/app.html\n`);
    });
  } catch (err) {
    console.error('❌ No se pudo iniciar:', err.message);
    console.error('   Verificá que DATABASE_URL esté configurado correctamente');
    process.exit(1);
  }
}

start();
