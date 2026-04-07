const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────
function calcularKPIs(row) {
  const ht = row.horas_totales || 0;
  const hp = row.horas_produccion || 0;
  const hsp = row.horas_sin_produccion || 0;
  const hpar = row.horas_parados || 0;
  const bots = row.botellas_producidas || 0;
  const bids = row.bidones_producidos || 0;

  return {
    ...row,
    pct_horas_activas: ht > 0 ? +((hp / ht) * 100).toFixed(2) : 0,
    pct_horas_sin_produccion: ht > 0 ? +((hsp / ht) * 100).toFixed(2) : 0,
    pct_horas_paradas: ht > 0 ? +((hpar / ht) * 100).toFixed(2) : 0,
    prom_botellas_hora: hp > 0 ? +(bots / hp).toFixed(2) : 0,
    prom_bidones_hora: hp > 0 ? +(bids / hp).toFixed(2) : 0,
  };
}

// ─────────────────────────────────────────────
// PRODUCCIÓN – CRUD
// ─────────────────────────────────────────────

// GET /api/produccion  → lista con filtros opcionales
app.get('/api/produccion', (req, res) => {
  try {
    const db = getDb();
    const { fecha_desde, fecha_hasta, turno, page = 1, limit = 100 } = req.query;

    let sql = 'SELECT * FROM produccion WHERE 1=1';
    const params = [];

    if (fecha_desde) { sql += ' AND fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { sql += ' AND fecha <= ?'; params.push(fecha_hasta); }
    if (turno) { sql += ' AND turno = ?'; params.push(turno); }

    sql += ' ORDER BY fecha DESC, turno DESC';
    sql += ` LIMIT ${parseInt(limit)} OFFSET ${(parseInt(page) - 1) * parseInt(limit)}`;

    const rows = db.prepare(sql).all(...params);
    const total = db.prepare(
      'SELECT COUNT(*) as n FROM produccion WHERE 1=1' +
      (fecha_desde ? ' AND fecha >= ?' : '') +
      (fecha_hasta ? ' AND fecha <= ?' : '') +
      (turno ? ' AND turno = ?' : '')
    ).get(...params.slice(0, params.length - 0 /* no offset params */));

    res.json({ data: rows.map(calcularKPIs), total: total.n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/produccion/:id
app.get('/api/produccion/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM produccion WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(calcularKPIs(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/produccion
app.post('/api/produccion', (req, res) => {
  try {
    const db = getDb();
    const d = req.body;

    // Validaciones
    const errores = validarRegistro(d);
    if (errores.length > 0) return res.status(400).json({ errores });

    const stmt = db.prepare(`
      INSERT INTO produccion
        (fecha, turno, horas_bidones, horas_botellas, detalle_horas,
         motivo_parada, detalle_produccion, horas_totales, horas_produccion,
         horas_sin_produccion, horas_parados, botellas_producidas, bidones_producidos)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const info = stmt.run(
      d.fecha, d.turno,
      d.horas_bidones, d.horas_botellas, d.detalle_horas || '',
      d.motivo_parada || null, d.detalle_produccion || '',
      d.horas_totales, d.horas_produccion, d.horas_sin_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_producidos
    );

    const nuevo = db.prepare('SELECT * FROM produccion WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(calcularKPIs(nuevo));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/produccion/:id
app.put('/api/produccion/:id', (req, res) => {
  try {
    const db = getDb();
    const d = req.body;

    const errores = validarRegistro(d);
    if (errores.length > 0) return res.status(400).json({ errores });

    const stmt = db.prepare(`
      UPDATE produccion SET
        fecha = ?, turno = ?, horas_bidones = ?, horas_botellas = ?,
        detalle_horas = ?, motivo_parada = ?, detalle_produccion = ?,
        horas_totales = ?, horas_produccion = ?, horas_sin_produccion = ?,
        horas_parados = ?, botellas_producidas = ?, bidones_producidos = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    const info = stmt.run(
      d.fecha, d.turno,
      d.horas_bidones, d.horas_botellas, d.detalle_horas || '',
      d.motivo_parada || null, d.detalle_produccion || '',
      d.horas_totales, d.horas_produccion, d.horas_sin_produccion, d.horas_parados,
      d.botellas_producidas, d.bidones_producidos,
      req.params.id
    );

    if (info.changes === 0) return res.status(404).json({ error: 'Registro no encontrado' });

    const actualizado = db.prepare('SELECT * FROM produccion WHERE id = ?').get(req.params.id);
    res.json(calcularKPIs(actualizado));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/produccion/:id
app.delete('/api/produccion/:id', (req, res) => {
  try {
    const db = getDb();
    const info = db.prepare('DELETE FROM produccion WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REPORTES
// ─────────────────────────────────────────────

// GET /api/reportes/mensual
app.get('/api/reportes/mensual', (req, res) => {
  try {
    const db = getDb();
    const { fecha_desde = '2000-01-01', fecha_hasta = '2099-12-31' } = req.query;

    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', fecha) AS mes,
        COUNT(*) AS registros,
        SUM(horas_totales)           AS horas_totales,
        SUM(horas_produccion)        AS horas_produccion,
        SUM(horas_sin_produccion)    AS horas_sin_produccion,
        SUM(horas_parados)           AS horas_parados,
        SUM(botellas_producidas)     AS botellas_producidas,
        SUM(bidones_producidos)      AS bidones_producidos,
        SUM(CASE WHEN motivo_parada = 'Mantenimiento'    THEN 1 ELSE 0 END) AS paradas_mantenimiento,
        SUM(CASE WHEN motivo_parada = 'Falta de insumos' THEN 1 ELSE 0 END) AS paradas_insumos,
        SUM(CASE WHEN motivo_parada = 'Corte de luz'     THEN 1 ELSE 0 END) AS paradas_corte
      FROM produccion
      WHERE fecha BETWEEN ? AND ?
      GROUP BY strftime('%Y-%m', fecha)
      ORDER BY mes
    `).all(fecha_desde, fecha_hasta);

    const resultado = rows.map(r => {
      const ht = r.horas_totales || 0;
      const hp = r.horas_produccion || 0;
      const totalParadas = (r.paradas_mantenimiento + r.paradas_insumos + r.paradas_corte) || 1;

      return {
        mes: r.mes,
        registros: r.registros,
        horas_totales: +ht.toFixed(2),
        horas_produccion: +hp.toFixed(2),
        horas_sin_produccion: +(r.horas_sin_produccion || 0).toFixed(2),
        horas_parados: +(r.horas_parados || 0).toFixed(2),
        botellas_producidas: r.botellas_producidas,
        bidones_producidos: r.bidones_producidos,
        pct_horas_activas: ht > 0 ? +((hp / ht) * 100).toFixed(1) : 0,
        pct_horas_sin_produccion: ht > 0 ? +((r.horas_sin_produccion / ht) * 100).toFixed(1) : 0,
        pct_horas_paradas: ht > 0 ? +((r.horas_parados / ht) * 100).toFixed(1) : 0,
        prom_botellas_hora: hp > 0 ? +(r.botellas_producidas / hp).toFixed(1) : 0,
        prom_bidones_hora: hp > 0 ? +(r.bidones_producidos / hp).toFixed(1) : 0,
        paradas_mantenimiento: r.paradas_mantenimiento,
        paradas_insumos: r.paradas_insumos,
        paradas_corte: r.paradas_corte,
        pct_paradas_mantenimiento: +((r.paradas_mantenimiento / totalParadas) * 100).toFixed(1),
        pct_paradas_insumos: +((r.paradas_insumos / totalParadas) * 100).toFixed(1),
        pct_paradas_corte: +((r.paradas_corte / totalParadas) * 100).toFixed(1),
      };
    });

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/acumulado
app.get('/api/reportes/acumulado', (req, res) => {
  try {
    const db = getDb();
    const { fecha_desde = '2000-01-01', fecha_hasta = '2099-12-31', turno } = req.query;

    let sql = `
      SELECT fecha, turno, botellas_producidas, bidones_producidos
      FROM produccion
      WHERE fecha BETWEEN ? AND ?
    `;
    const params = [fecha_desde, fecha_hasta];
    if (turno) { sql += ' AND turno = ?'; params.push(turno); }
    sql += ' ORDER BY fecha ASC, turno ASC';

    const rows = db.prepare(sql).all(...params);

    const totales = rows.reduce((acc, r) => ({
      botellas: acc.botellas + r.botellas_producidas,
      bidones: acc.bidones + r.bidones_producidos,
    }), { botellas: 0, bidones: 0 });

    res.json({ datos: rows, totales });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// VALIDACIONES
// ─────────────────────────────────────────────
function validarRegistro(d) {
  const errores = [];

  if (!d.fecha) errores.push('La fecha es obligatoria');
  if (!d.turno) errores.push('El turno es obligatorio');

  const campos = ['horas_totales', 'horas_produccion', 'horas_sin_produccion', 'horas_parados',
    'horas_bidones', 'horas_botellas', 'botellas_producidas', 'bidones_producidos'];
  for (const c of campos) {
    if (d[c] === undefined || d[c] === null || d[c] === '') {
      errores.push(`El campo "${c}" es obligatorio`);
    } else if (parseFloat(d[c]) < 0) {
      errores.push(`El campo "${c}" debe ser >= 0`);
    }
  }

  if (errores.length === 0) {
    const ht = parseFloat(d.horas_totales);
    const hp = parseFloat(d.horas_produccion);
    const hsp = parseFloat(d.horas_sin_produccion);
    const hpa = parseFloat(d.horas_parados);
    const suma = +(hp + hsp + hpa).toFixed(4);
    if (Math.abs(suma - ht) > 0.01) {
      errores.push(`Horas Producción (${hp}) + Horas sin Producción (${hsp}) + Horas Parados (${hpa}) = ${suma}, debe ser igual a Horas Totales (${ht})`);
    }
  }

  return errores;
}

// ─────────────────────────────────────────────
// CATCH-ALL para SPA
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 KPI Producción corriendo en http://localhost:${PORT}`);
  getDb(); // inicializar DB al arrancar
});
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Sistema KPI Producción funcionando 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo"));