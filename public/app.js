/* =====================================================
   KPI PRODUCCIÓN – app.js
   ===================================================== */

const API = '/api';
let chartHoras = null, chartProduccion = null, chartParadas = null;
let idAEliminar = null;
let registroDetalleActual = null;   // para PDF desde modal de detalle
let datosMensualActuales  = null;   // para PDF reporte mensual
let datosAcumuladoActuales = null;  // para PDF reporte acumulado
let filtrosMensualActuales   = {};
let filtrosAcumuladoActuales = {};

const modalEliminar = new bootstrap.Modal(document.getElementById('modal-eliminar'));
const modalDetalle  = new bootstrap.Modal(document.getElementById('modal-detalle'));
const toastEl = document.getElementById('toast-notif');
const bsToast = new bootstrap.Toast(toastEl, { delay: 3500 });

// ─────────────────────────────────────────────
// NAVEGACIÓN
// ─────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const section = link.dataset.section;
    mostrarSeccion(section);
    document.querySelectorAll('.nav-tab').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
  });
});

function mostrarSeccion(id) {
  document.querySelectorAll('.app-section').forEach(s => s.classList.add('d-none'));
  document.getElementById(`section-${id}`).classList.remove('d-none');
  if (id === 'listado')            cargarListado();
  if (id === 'reporte-mensual')    inicializarFiltrosMensual();
  if (id === 'reporte-acumulado')  inicializarFiltrosAcumulado();
}

// ─────────────────────────────────────────────
// UTILIDADES GENERALES
// ─────────────────────────────────────────────
function toast(msg, tipo = 'success') {
  toastEl.className = `toast align-items-center border-0 text-white bg-${tipo}`;
  document.getElementById('toast-msg').textContent = msg;
  bsToast.show();
}

function fmt(n, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return parseFloat(n).toFixed(dec);
}

function fmtFecha(fechaISO) {
  if (!fechaISO) return '—';
  const [y, m, d] = fechaISO.split('-');
  return `${d}/${m}/${y}`;
}

function mesLabel(mesISO) {
  const [y, m] = mesISO.split('-');
  const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${nombres[parseInt(m) - 1]} ${y}`;
}

function mesLabelCorto(mesISO) {
  const [y, m] = mesISO.split('-');
  const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${nombres[parseInt(m) - 1]} ${y}`;
}

function hoy() {
  return new Date().toISOString().split('T')[0];
}

function primerDiaSeisMesesAtras() {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function apiGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json()).error || 'Error en la solicitud');
  return r.json();
}

async function apiPost(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await r.json();
  if (!r.ok) throw json;
  return json;
}

async function apiPut(url, data) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await r.json();
  if (!r.ok) throw json;
  return json;
}

async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json()).error || 'Error al eliminar');
  return r.json();
}

// ─────────────────────────────────────────────
// UTILIDADES PDF (jsPDF + autoTable)
// ─────────────────────────────────────────────
function nuevoPDF(orientacion = 'p') {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: orientacion, unit: 'mm', format: 'a4' });
}

function pdfHeader(doc, titulo, subtitulo = '') {
  // Banda de color primario
  doc.setFillColor(0, 86, 179);
  doc.rect(0, 0, 210, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('KPI Producción – Fábrica de Aceite', 14, 8);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(titulo, 14, 15);
  if (subtitulo) {
    doc.setFontSize(9);
    doc.text(subtitulo, 210 - 14, 15, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
  return 26; // y de inicio del contenido
}

function pdfFooter(doc) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Generado el ${new Date().toLocaleDateString('es-AR')} a las ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}   |   Página ${i} de ${pageCount}`,
      14, 292
    );
    doc.setDrawColor(200);
    doc.line(14, 289, 196, 289);
    doc.setTextColor(0);
  }
}

// ─────────────────────────────────────────────
// MODAL DETALLE DEL TURNO
// ─────────────────────────────────────────────
function verDetalle(id, r) {
  registroDetalleActual = r;
  document.getElementById('detalle-modal-titulo').innerHTML =
    `<i class="bi bi-clipboard2-data me-2"></i>Detalle — ${fmtFecha(r.fecha)} · Turno ${r.turno}`;

  const colorActivas = r.pct_horas_activas >= 75 ? 'success' : r.pct_horas_activas >= 50 ? 'warning' : 'danger';
  const motivoBadge  = r.motivo_parada
    ? `<span class="badge bg-${r.motivo_parada==='Mantenimiento'?'warning text-dark':r.motivo_parada==='Corte de luz'?'danger':'info'}">${r.motivo_parada}</span>`
    : '<span class="text-muted">Sin parada</span>';

  document.getElementById('detalle-modal-body').innerHTML = `
    <!-- Encabezado info -->
    <div class="row g-2 mb-3">
      <div class="col-6 col-md-3">
        <div class="bg-light rounded p-2 text-center">
          <div class="fw-bold text-primary" style="font-size:1.1rem">${fmtFecha(r.fecha)}</div>
          <div class="text-muted small">Fecha</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="bg-light rounded p-2 text-center">
          <div class="fw-bold" style="font-size:1.1rem">${r.turno}</div>
          <div class="text-muted small">Turno</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="bg-light rounded p-2 text-center">
          <div class="fw-bold" style="font-size:1.1rem">${r.horas_totales} hs</div>
          <div class="text-muted small">Horas Totales</div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="bg-light rounded p-2 text-center">
          <div class="fw-bold text-${colorActivas}" style="font-size:1.1rem">${fmt(r.pct_horas_activas)}%</div>
          <div class="text-muted small">% Activas</div>
        </div>
      </div>
    </div>

    <!-- Horas y KPIs -->
    <div class="row g-3 mb-3">
      <div class="col-md-6">
        <div class="card border-0 bg-light h-100">
          <div class="card-body py-2">
            <h6 class="text-secondary mb-2"><i class="bi bi-clock me-1"></i>Distribución de Horas</h6>
            <table class="table table-sm table-borderless mb-0">
              <tbody>
                <tr><td>Horas Producción</td><td class="text-end fw-semibold text-success">${r.horas_produccion} hs</td></tr>
                <tr><td>Horas sin Producción</td><td class="text-end fw-semibold text-warning">${r.horas_sin_produccion} hs</td></tr>
                <tr><td>Horas Parados</td><td class="text-end fw-semibold text-danger">${r.horas_parados} hs</td></tr>
                <tr class="border-top"><td><strong>Horas Totales</strong></td><td class="text-end fw-bold">${r.horas_totales} hs</td></tr>
              </tbody>
            </table>
            <!-- Barra visual -->
            <div class="progress mt-2" style="height:8px" title="Verde=Producción, Amarillo=s/Prod, Rojo=Parado">
              <div class="progress-bar bg-success" style="width:${fmt(r.pct_horas_activas)}%"></div>
              <div class="progress-bar bg-warning" style="width:${fmt(r.pct_horas_sin_produccion)}%"></div>
              <div class="progress-bar bg-danger" style="width:${fmt(r.pct_horas_paradas)}%"></div>
            </div>
            <div class="d-flex justify-content-between mt-1" style="font-size:0.7rem">
              <span class="text-success">Activas ${fmt(r.pct_horas_activas)}%</span>
              <span class="text-warning">s/Prod ${fmt(r.pct_horas_sin_produccion)}%</span>
              <span class="text-danger">Paradas ${fmt(r.pct_horas_paradas)}%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card border-0 bg-light h-100">
          <div class="card-body py-2">
            <h6 class="text-secondary mb-2"><i class="bi bi-box-seam me-1"></i>Producción</h6>
            <table class="table table-sm table-borderless mb-0">
              <tbody>
                <tr><td>Botellas producidas</td><td class="text-end fw-semibold">${r.botellas_producidas.toLocaleString('es-AR')}</td></tr>
                <tr><td>Bidones producidos</td><td class="text-end fw-semibold">${r.bidones_producidos.toLocaleString('es-AR')}</td></tr>
                <tr><td>Prom. Botellas/hora</td><td class="text-end fw-semibold text-primary">${fmt(r.prom_botellas_hora, 0)}</td></tr>
                <tr><td>Prom. Bidones/hora</td><td class="text-end fw-semibold text-info">${fmt(r.prom_bidones_hora, 1)}</td></tr>
              </tbody>
            </table>
            <h6 class="text-secondary mb-1 mt-2"><i class="bi bi-clock-history me-1"></i>Horas por Producto</h6>
            <table class="table table-sm table-borderless mb-0">
              <tbody>
                <tr><td>Horas Bidones</td><td class="text-end">${r.horas_bidones} hs</td></tr>
                <tr><td>Horas Botellas</td><td class="text-end">${r.horas_botellas} hs</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Parada y notas -->
    <div class="row g-3">
      <div class="col-md-4">
        <div class="card border-0 bg-light">
          <div class="card-body py-2">
            <h6 class="text-secondary mb-1"><i class="bi bi-exclamation-triangle me-1"></i>Motivo de Parada</h6>
            ${motivoBadge}
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card border-0 bg-light">
          <div class="card-body py-2">
            <h6 class="text-secondary mb-1"><i class="bi bi-chat-left-text me-1"></i>Detalle de Horas</h6>
            <p class="mb-0 small">${r.detalle_horas || '<em class="text-muted">Sin detalle</em>'}</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card border-0 bg-light">
          <div class="card-body py-2">
            <h6 class="text-secondary mb-1"><i class="bi bi-journal-text me-1"></i>Detalle Producción</h6>
            <p class="mb-0 small">${r.detalle_produccion || '<em class="text-muted">Sin detalle</em>'}</p>
          </div>
        </div>
      </div>
    </div>
  `;

  modalDetalle.show();
}

// Botón PDF desde el modal de detalle
document.getElementById('btn-detalle-pdf').addEventListener('click', () => {
  if (registroDetalleActual) descargarPDFRegistro(registroDetalleActual);
});

// ─────────────────────────────────────────────
// PDF – REGISTRO INDIVIDUAL
// ─────────────────────────────────────────────
function descargarPDFRegistro(r) {
  const doc = nuevoPDF();
  let y = pdfHeader(doc, `Detalle de Turno — ${fmtFecha(r.fecha)} · ${r.turno}`,
    `Generado: ${new Date().toLocaleDateString('es-AR')}`);

  // Bloque info básica
  doc.autoTable({
    startY: y,
    head: [['Campo', 'Valor', 'Campo', 'Valor']],
    body: [
      ['Fecha', fmtFecha(r.fecha), 'Turno', r.turno],
      ['Hs. Bidones', `${r.horas_bidones} hs`, 'Hs. Botellas', `${r.horas_botellas} hs`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 2: { fontStyle: 'bold', cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Distribución de horas
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
  doc.text('DISTRIBUCIÓN DE HORAS', 16, y + 4.5);
  y += 8;

  doc.autoTable({
    startY: y,
    head: [['Concepto', 'Horas', '% del Total']],
    body: [
      ['Horas Producción',       `${r.horas_produccion} hs`,       `${fmt(r.pct_horas_activas)}%`],
      ['Horas sin Producción',   `${r.horas_sin_produccion} hs`,   `${fmt(r.pct_horas_sin_produccion)}%`],
      ['Horas Parados',          `${r.horas_parados} hs`,          `${fmt(r.pct_horas_paradas)}%`],
      ['HORAS TOTALES',          `${r.horas_totales} hs`,          '100%'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 120, 60], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.row.index === 3) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [220, 240, 220]; }
    },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Producción y KPIs
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
  doc.text('PRODUCCIÓN Y KPIs', 16, y + 4.5);
  y += 8;

  doc.autoTable({
    startY: y,
    head: [['Indicador', 'Valor']],
    body: [
      ['Botellas Producidas',       r.botellas_producidas.toLocaleString('es-AR')],
      ['Bidones Producidos',        r.bidones_producidos.toLocaleString('es-AR')],
      ['Promedio Botellas / Hora',  `${fmt(r.prom_botellas_hora, 0)} bot/h`],
      ['Promedio Bidones / Hora',   `${fmt(r.prom_bidones_hora, 1)} bid/h`],
      ['% Horas Activas',           `${fmt(r.pct_horas_activas)}%`],
      ['% Horas sin Producción',    `${fmt(r.pct_horas_sin_produccion)}%`],
      ['% Horas Paradas',           `${fmt(r.pct_horas_paradas)}%`],
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Notas / textos libres
  if (r.motivo_parada || r.detalle_horas || r.detalle_produccion) {
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
    doc.text('OBSERVACIONES', 16, y + 4.5);
    y += 10;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    if (r.motivo_parada) {
      doc.setFont('helvetica', 'bold'); doc.text('Motivo de Parada: ', 14, y);
      doc.setFont('helvetica', 'normal'); doc.text(r.motivo_parada, 60, y); y += 6;
    }
    if (r.detalle_horas) {
      doc.setFont('helvetica', 'bold'); doc.text('Detalle de Horas:', 14, y); y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(r.detalle_horas, 180);
      doc.text(lines, 14, y); y += lines.length * 5 + 4;
    }
    if (r.detalle_produccion) {
      doc.setFont('helvetica', 'bold'); doc.text('Detalle Producción:', 14, y); y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(r.detalle_produccion, 180);
      doc.text(lines, 14, y);
    }
  }

  pdfFooter(doc);
  doc.save(`KPI_Registro_${r.fecha}_${r.turno.replace('ñ','n')}.pdf`);
}

// ─────────────────────────────────────────────
// FORMULARIO ABM – VALIDACIÓN EN TIEMPO REAL
// ─────────────────────────────────────────────
function actualizarSumaHoras() {
  const hp  = parseFloat(document.getElementById('f-horas-produccion').value) || 0;
  const hsp = parseFloat(document.getElementById('f-horas-sin-produccion').value) || 0;
  const hpa = parseFloat(document.getElementById('f-horas-parados').value) || 0;
  const ht  = parseFloat(document.getElementById('f-horas-totales').value) || 0;
  const suma = +(hp + hsp + hpa).toFixed(4);
  const el = document.getElementById('validacion-horas');
  el.classList.remove('d-none');

  if (ht > 0) {
    const ok = Math.abs(suma - ht) <= 0.01;
    el.innerHTML = ok
      ? `<span class="text-success"><i class="bi bi-check-circle me-1"></i>${hp} + ${hsp} + ${hpa} = ${suma} hs ✔</span>`
      : `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Suma = ${suma} hs ≠ Horas Totales (${ht} hs). Deben coincidir.</span>`;
  }
  actualizarKPIPreview();
}

document.getElementById('f-horas-totales').addEventListener('input', actualizarSumaHoras);
document.getElementById('f-botellas').addEventListener('input', actualizarKPIPreview);
document.getElementById('f-bidones').addEventListener('input', actualizarKPIPreview);

function actualizarKPIPreview() {
  const ht  = parseFloat(document.getElementById('f-horas-totales').value) || 0;
  const hp  = parseFloat(document.getElementById('f-horas-produccion').value) || 0;
  const hsp = parseFloat(document.getElementById('f-horas-sin-produccion').value) || 0;
  const hpa = parseFloat(document.getElementById('f-horas-parados').value) || 0;
  const bot = parseFloat(document.getElementById('f-botellas').value) || 0;
  const bid = parseFloat(document.getElementById('f-bidones').value) || 0;
  if (ht <= 0) return;
  const preview = document.getElementById('kpi-preview');
  preview.classList.remove('d-none');
  document.getElementById('kpi-pct-activas').textContent = `% Activas: ${fmt(hp / ht * 100)}%`;
  document.getElementById('kpi-pct-sp').textContent = `% s/Prod: ${fmt(hsp / ht * 100)}%`;
  document.getElementById('kpi-pct-par').textContent = `% Paradas: ${fmt(hpa / ht * 100)}%`;
  document.getElementById('kpi-prom-bot').textContent = hp > 0 ? fmt(bot / hp, 0) : '—';
  document.getElementById('kpi-prom-bid').textContent = hp > 0 ? fmt(bid / hp, 1) : '—';
}

// ─────────────────────────────────────────────
// FORMULARIO ABM – SUBMIT
// ─────────────────────────────────────────────
document.getElementById('form-produccion').addEventListener('submit', async e => {
  e.preventDefault();
  const alertEl = document.getElementById('alert-form');
  alertEl.className = 'alert d-none';

  const data = {
    fecha:               document.getElementById('f-fecha').value,
    turno:               document.getElementById('f-turno').value,
    horas_bidones:       parseFloat(document.getElementById('f-horas-bidones').value) || 0,
    horas_botellas:      parseFloat(document.getElementById('f-horas-botellas').value) || 0,
    detalle_horas:       document.getElementById('f-detalle-horas').value.trim(),
    motivo_parada:       document.getElementById('f-motivo-parada').value || null,
    detalle_produccion:  document.getElementById('f-detalle-produccion').value.trim(),
    horas_totales:       parseFloat(document.getElementById('f-horas-totales').value),
    horas_produccion:    parseFloat(document.getElementById('f-horas-produccion').value),
    horas_sin_produccion:parseFloat(document.getElementById('f-horas-sin-produccion').value),
    horas_parados:       parseFloat(document.getElementById('f-horas-parados').value),
    botellas_producidas: parseInt(document.getElementById('f-botellas').value) || 0,
    bidones_producidos:  parseInt(document.getElementById('f-bidones').value) || 0,
  };

  const editId = document.getElementById('edit-id').value;

  try {
    if (editId) {
      await apiPut(`${API}/produccion/${editId}`, data);
      toast('Registro actualizado correctamente');
    } else {
      await apiPost(`${API}/produccion`, data);
      toast('Registro guardado correctamente');
    }
    limpiarFormulario();
    mostrarSeccion('listado');
    document.querySelectorAll('.nav-tab').forEach(l => {
      l.classList.toggle('active', l.dataset.section === 'listado');
    });
  } catch (err) {
    const errores = err.errores || [err.error || 'Error desconocido'];
    alertEl.className = 'alert alert-danger';
    alertEl.innerHTML = '<strong>Errores:</strong><ul class="mb-0 mt-1">' +
      errores.map(e => `<li>${e}</li>`).join('') + '</ul>';
  }
});

function limpiarFormulario() {
  document.getElementById('form-produccion').reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = 'Nuevo Registro de Producción';
  document.getElementById('btn-submit-text').textContent = 'Guardar Registro';
  document.getElementById('btn-cancelar-edicion').style.display = 'none';
  document.getElementById('alert-form').className = 'alert d-none';
  document.getElementById('validacion-horas').classList.add('d-none');
  document.getElementById('kpi-preview').classList.add('d-none');
  document.getElementById('f-fecha').value = hoy();
}

function cancelarEdicion() { limpiarFormulario(); }

function editarRegistro(id, d) {
  mostrarSeccion('carga');
  document.querySelectorAll('.nav-tab').forEach(l => l.classList.toggle('active', l.dataset.section === 'carga'));
  document.getElementById('edit-id').value = id;
  document.getElementById('f-fecha').value = d.fecha;
  document.getElementById('f-turno').value = d.turno;
  document.getElementById('f-horas-bidones').value = d.horas_bidones;
  document.getElementById('f-horas-botellas').value = d.horas_botellas;
  document.getElementById('f-detalle-horas').value = d.detalle_horas || '';
  document.getElementById('f-motivo-parada').value = d.motivo_parada || '';
  document.getElementById('f-detalle-produccion').value = d.detalle_produccion || '';
  document.getElementById('f-horas-totales').value = d.horas_totales;
  document.getElementById('f-horas-produccion').value = d.horas_produccion;
  document.getElementById('f-horas-sin-produccion').value = d.horas_sin_produccion;
  document.getElementById('f-horas-parados').value = d.horas_parados;
  document.getElementById('f-botellas').value = d.botellas_producidas;
  document.getElementById('f-bidones').value = d.bidones_producidos;
  document.getElementById('form-title').textContent = `Editando Registro #${id}`;
  document.getElementById('btn-submit-text').textContent = 'Actualizar Registro';
  document.getElementById('btn-cancelar-edicion').style.display = '';
  actualizarSumaHoras();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────────────────────────────────────
// LISTADO
// ─────────────────────────────────────────────
async function cargarListado() {
  const desde = document.getElementById('lst-desde').value;
  const hasta = document.getElementById('lst-hasta').value;
  const turno = document.getElementById('lst-turno').value;

  let qs = '?limit=500';
  if (desde) qs += `&fecha_desde=${desde}`;
  if (hasta) qs += `&fecha_hasta=${hasta}`;
  if (turno) qs += `&turno=${encodeURIComponent(turno)}`;

  const tbody = document.getElementById('tbody-listado');
  tbody.innerHTML = '<tr><td colspan="14" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando…</td></tr>';

  try {
    const res = await apiGet(`${API}/produccion${qs}`);
    const rows = res.data;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" class="text-center py-4 text-muted">No hay registros para mostrar.</td></tr>';
      document.getElementById('listado-info').textContent = '';
      return;
    }

    const motorParada = { 'Mantenimiento': 'warning', 'Falta de insumos': 'info', 'Corte de luz': 'danger' };

    tbody.innerHTML = rows.map(r => {
      const rData = JSON.stringify(r).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
      <tr>
        <td>${fmtFecha(r.fecha)}</td>
        <td><span class="badge bg-secondary">${r.turno}</span></td>
        <td class="text-end">${fmt(r.horas_totales)}</td>
        <td class="text-end text-success fw-semibold">${fmt(r.horas_produccion)}</td>
        <td class="text-end">${fmt(r.horas_sin_produccion)}</td>
        <td class="text-end">${fmt(r.horas_parados)}</td>
        <td class="text-end">
          <span class="badge bg-${r.pct_horas_activas >= 75 ? 'success' : r.pct_horas_activas >= 50 ? 'warning text-dark' : 'danger'}">
            ${fmt(r.pct_horas_activas)}%
          </span>
        </td>
        <td class="text-end">${r.botellas_producidas.toLocaleString('es-AR')}</td>
        <td class="text-end">${r.bidones_producidos.toLocaleString('es-AR')}</td>
        <td class="text-end">${fmt(r.prom_botellas_hora, 0)}</td>
        <td class="text-end">${fmt(r.prom_bidones_hora, 1)}</td>
        <td>${r.motivo_parada
          ? `<span class="badge bg-${motorParada[r.motivo_parada] || 'secondary'}">${r.motivo_parada}</span>`
          : '<span class="text-muted small">—</span>'}</td>
        <td class="text-center" style="white-space:nowrap">
          <button class="btn btn-xs btn-outline-info me-1" title="Ver detalle"
            onclick='verDetalle(${r.id}, JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(r))}")))'>
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-xs btn-outline-danger me-1" title="Descargar PDF"
            onclick='descargarPDFRegistro(JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(r))}")))'>
            <i class="bi bi-file-earmark-pdf"></i>
          </button>
          <button class="btn btn-xs btn-outline-primary me-1" title="Editar"
            onclick='editarRegistro(${r.id}, JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(r))}")))'>
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-xs btn-outline-secondary" title="Eliminar"
            onclick="confirmarEliminar(${r.id})">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('listado-info').textContent =
      `Mostrando ${rows.length} de ${res.total} registros`;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center text-danger py-3">${err.message}</td></tr>`;
  }
}

// Actualizar colspan del thead también
document.querySelector('#tabla-listado thead tr').innerHTML = `
  <th>Fecha</th>
  <th>Turno</th>
  <th class="text-end">Hs. Tot.</th>
  <th class="text-end">Hs. Prod.</th>
  <th class="text-end">Hs. s/Prod.</th>
  <th class="text-end">Hs. Parados</th>
  <th class="text-end">% Activas</th>
  <th class="text-end">Botellas</th>
  <th class="text-end">Bidones</th>
  <th class="text-end">Bot/h</th>
  <th class="text-end">Bid/h</th>
  <th>Motivo Parada</th>
  <th class="text-center">Acciones</th>
`;

function limpiarFiltrosListado() {
  document.getElementById('lst-desde').value = '';
  document.getElementById('lst-hasta').value = '';
  document.getElementById('lst-turno').value = '';
  cargarListado();
}

// ─────────────────────────────────────────────
// ELIMINAR
// ─────────────────────────────────────────────
function confirmarEliminar(id) {
  idAEliminar = id;
  modalEliminar.show();
}

document.getElementById('btn-confirmar-eliminar').addEventListener('click', async () => {
  if (!idAEliminar) return;
  try {
    await apiDelete(`${API}/produccion/${idAEliminar}`);
    toast('Registro eliminado', 'danger');
    modalEliminar.hide();
    cargarListado();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    idAEliminar = null;
  }
});

// ─────────────────────────────────────────────
// REPORTE KPI MENSUAL
// ─────────────────────────────────────────────
function inicializarFiltrosMensual() {
  if (!document.getElementById('rm-desde').value) {
    document.getElementById('rm-desde').value = primerDiaSeisMesesAtras();
    document.getElementById('rm-hasta').value = hoy();
    cargarReporteMensual();
  }
}

function limpiarFiltrosReporte() {
  document.getElementById('rm-desde').value = '';
  document.getElementById('rm-hasta').value = '';
  document.getElementById('reporte-mensual-content').innerHTML =
    '<div class="text-center text-muted py-5"><i class="bi bi-bar-chart display-4 d-block mb-2"></i>Seleccioná un rango de fechas y generá el reporte.</div>';
  datosMensualActuales = null;
  if (chartHoras)     { chartHoras.destroy();     chartHoras = null; }
  if (chartProduccion){ chartProduccion.destroy(); chartProduccion = null; }
  if (chartParadas)   { chartParadas.destroy();    chartParadas = null; }
}

async function cargarReporteMensual() {
  const desde = document.getElementById('rm-desde').value;
  const hasta = document.getElementById('rm-hasta').value;
  if (!desde || !hasta) { toast('Ingresá el rango de fechas', 'warning'); return; }

  filtrosMensualActuales = { desde, hasta };
  const cont = document.getElementById('reporte-mensual-content');
  cont.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

  if (chartHoras)     { chartHoras.destroy();     chartHoras = null; }
  if (chartProduccion){ chartProduccion.destroy(); chartProduccion = null; }
  if (chartParadas)   { chartParadas.destroy();    chartParadas = null; }

  try {
    const datos = await apiGet(`${API}/reportes/mensual?fecha_desde=${desde}&fecha_hasta=${hasta}`);
    datosMensualActuales = datos;

    if (datos.length === 0) {
      cont.innerHTML = '<div class="alert alert-info">No hay datos para el período seleccionado.</div>';
      return;
    }

    const labels      = datos.map(d => mesLabelCorto(d.mes));
    const totBotellas = datos.reduce((a, d) => a + d.botellas_producidas, 0);
    const totBidones  = datos.reduce((a, d) => a + d.bidones_producidos, 0);
    const totHT       = datos.reduce((a, d) => a + d.horas_totales, 0);
    const totHP       = datos.reduce((a, d) => a + d.horas_produccion, 0);
    const avgActivas  = totHT > 0 ? (totHP / totHT * 100).toFixed(1) : 0;

    cont.innerHTML = `
      <!-- Botón descarga PDF -->
      <div class="d-flex justify-content-end mb-3">
        <button class="btn btn-sm btn-danger" onclick="descargarPDFMensual()">
          <i class="bi bi-file-earmark-pdf me-2"></i>Descargar Reporte PDF
        </button>
      </div>

      <!-- KPI Cards -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">
          <div class="kpi-card border-success">
            <div class="kpi-value text-success">${avgActivas}%</div>
            <div class="kpi-label">% Hs. Activas Promedio</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-primary">
            <div class="kpi-value text-primary">${totBotellas.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Botellas</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-info">
            <div class="kpi-value text-info">${totBidones.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Bidones</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-secondary">
            <div class="kpi-value text-secondary">${fmt(totHT, 0)} hs</div>
            <div class="kpi-label">Total Horas Trabajadas</div>
          </div>
        </div>
      </div>

      <!-- Gráficos -->
      <div class="row g-4 mb-4">
        <div class="col-12 col-lg-8">
          <div class="card shadow-sm h-100">
            <div class="card-header bg-white"><strong><i class="bi bi-clock-history me-2 text-primary"></i>Distribución de Horas (%)</strong></div>
            <div class="card-body"><canvas id="chart-horas"></canvas></div>
          </div>
        </div>
        <div class="col-12 col-lg-4">
          <div class="card shadow-sm h-100">
            <div class="card-header bg-white"><strong><i class="bi bi-pie-chart me-2 text-warning"></i>Motivos de Parada</strong></div>
            <div class="card-body d-flex align-items-center justify-content-center"><canvas id="chart-paradas" style="max-height:260px"></canvas></div>
          </div>
        </div>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-header bg-white"><strong><i class="bi bi-bar-chart me-2 text-success"></i>Producción Mensual (Botellas y Bidones)</strong></div>
            <div class="card-body"><canvas id="chart-produccion"></canvas></div>
          </div>
        </div>
      </div>

      <!-- Tabla KPI -->
      <div class="card shadow-sm">
        <div class="card-header bg-white d-flex justify-content-between align-items-center">
          <strong><i class="bi bi-table me-2 text-primary"></i>Tabla KPI Mensual</strong>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover table-sm mb-0 align-middle">
              <thead class="table-primary">
                <tr>
                  <th>Mes</th>
                  <th class="text-end">% Hs. Activas</th>
                  <th class="text-end">% Hs. s/Prod.</th>
                  <th class="text-end">% Hs. Paradas</th>
                  <th class="text-end">Bot/hora</th>
                  <th class="text-end">Bid/hora</th>
                  <th class="text-end">Botellas</th>
                  <th class="text-end">Bidones</th>
                  <th class="text-end">P. Mant.</th>
                  <th class="text-end">P. Insumos</th>
                  <th class="text-end">P. Corte</th>
                </tr>
              </thead>
              <tbody>
                ${datos.map(d => `
                  <tr>
                    <td class="fw-semibold">${mesLabelCorto(d.mes)}</td>
                    <td class="text-end">
                      <span class="badge bg-${d.pct_horas_activas >= 75 ? 'success' : d.pct_horas_activas >= 50 ? 'warning text-dark' : 'danger'}">
                        ${d.pct_horas_activas}%
                      </span>
                    </td>
                    <td class="text-end">${d.pct_horas_sin_produccion}%</td>
                    <td class="text-end">${d.pct_horas_paradas}%</td>
                    <td class="text-end">${fmt(d.prom_botellas_hora, 0)}</td>
                    <td class="text-end">${fmt(d.prom_bidones_hora, 1)}</td>
                    <td class="text-end">${d.botellas_producidas.toLocaleString('es-AR')}</td>
                    <td class="text-end">${d.bidones_producidos.toLocaleString('es-AR')}</td>
                    <td class="text-end">${d.paradas_mantenimiento}</td>
                    <td class="text-end">${d.paradas_insumos}</td>
                    <td class="text-end">${d.paradas_corte}</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot class="table-light fw-bold">
                <tr>
                  <td>TOTALES</td>
                  <td class="text-end">${avgActivas}%</td>
                  <td class="text-end">${totHT > 0 ? fmt(datos.reduce((a,d)=>a+d.horas_sin_produccion,0)/totHT*100) : '—'}%</td>
                  <td class="text-end">${totHT > 0 ? fmt(datos.reduce((a,d)=>a+d.horas_parados,0)/totHT*100) : '—'}%</td>
                  <td class="text-end">${totHP > 0 ? fmt(totBotellas/totHP, 0) : '—'}</td>
                  <td class="text-end">${totHP > 0 ? fmt(totBidones/totHP, 1) : '—'}</td>
                  <td class="text-end">${totBotellas.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totBidones.toLocaleString('es-AR')}</td>
                  <td class="text-end">${datos.reduce((a,d)=>a+d.paradas_mantenimiento,0)}</td>
                  <td class="text-end">${datos.reduce((a,d)=>a+d.paradas_insumos,0)}</td>
                  <td class="text-end">${datos.reduce((a,d)=>a+d.paradas_corte,0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `;

    // Gráfico horas apilado
    chartHoras = new Chart(document.getElementById('chart-horas'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '% Hs. Activas',        data: datos.map(d => d.pct_horas_activas),        backgroundColor: 'rgba(40,167,69,0.8)' },
          { label: '% Hs. s/Producción',   data: datos.map(d => d.pct_horas_sin_produccion), backgroundColor: 'rgba(255,193,7,0.8)' },
          { label: '% Hs. Paradas',        data: datos.map(d => d.pct_horas_paradas),        backgroundColor: 'rgba(220,53,69,0.8)' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { x: { stacked: true }, y: { stacked: true, max: 100, ticks: { callback: v => v + '%' } } }
      }
    });

    // Gráfico producción
    chartProduccion = new Chart(document.getElementById('chart-produccion'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Botellas producidas', data: datos.map(d => d.botellas_producidas), backgroundColor: 'rgba(0,123,255,0.8)', yAxisID: 'y' },
          { label: 'Bidones producidos',  data: datos.map(d => d.bidones_producidos),  backgroundColor: 'rgba(23,162,184,0.8)', yAxisID: 'y2' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          y:  { position: 'left',  title: { display: true, text: 'Botellas' } },
          y2: { position: 'right', title: { display: true, text: 'Bidones' }, grid: { drawOnChartArea: false } }
        }
      }
    });

    // Gráfico paradas
    const totMant    = datos.reduce((a, d) => a + d.paradas_mantenimiento, 0);
    const totInsumos = datos.reduce((a, d) => a + d.paradas_insumos, 0);
    const totCorte   = datos.reduce((a, d) => a + d.paradas_corte, 0);
    const totalP     = totMant + totInsumos + totCorte;

    if (totalP > 0) {
      chartParadas = new Chart(document.getElementById('chart-paradas'), {
        type: 'doughnut',
        data: {
          labels: ['Mantenimiento', 'Falta de insumos', 'Corte de luz'],
          datasets: [{ data: [totMant, totInsumos, totCorte], backgroundColor: ['rgba(255,193,7,0.85)', 'rgba(23,162,184,0.85)', 'rgba(220,53,69,0.85)'], borderWidth: 2 }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${(ctx.raw / totalP * 100).toFixed(1)}%)` } }
          }
        }
      });
    } else {
      document.getElementById('chart-paradas').parentElement.innerHTML =
        '<div class="text-center text-muted py-4 small">Sin paradas registradas en el período</div>';
    }

  } catch (err) {
    cont.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────
// PDF – REPORTE KPI MENSUAL
// ─────────────────────────────────────────────
function descargarPDFMensual() {
  const datos = datosMensualActuales;
  if (!datos || datos.length === 0) { toast('No hay datos para exportar', 'warning'); return; }

  const { desde, hasta } = filtrosMensualActuales;
  const doc = nuevoPDF('l'); // landscape para tabla ancha
  let y = pdfHeader(doc, `Reporte KPI Mensual de Producción`,
    `Período: ${fmtFecha(desde)} al ${fmtFecha(hasta)}`);

  // Totales generales
  const totBotellas = datos.reduce((a, d) => a + d.botellas_producidas, 0);
  const totBidones  = datos.reduce((a, d) => a + d.bidones_producidos, 0);
  const totHT       = datos.reduce((a, d) => a + d.horas_totales, 0);
  const totHP       = datos.reduce((a, d) => a + d.horas_produccion, 0);
  const totHSP      = datos.reduce((a, d) => a + d.horas_sin_produccion, 0);
  const totHPar     = datos.reduce((a, d) => a + d.horas_parados, 0);
  const avgActivas  = totHT > 0 ? (totHP / totHT * 100).toFixed(1) : 0;
  const totMant     = datos.reduce((a, d) => a + d.paradas_mantenimiento, 0);
  const totInsumos  = datos.reduce((a, d) => a + d.paradas_insumos, 0);
  const totCorte    = datos.reduce((a, d) => a + d.paradas_corte, 0);

  // Tarjetas resumen
  doc.autoTable({
    startY: y,
    head: [['% Hs. Activas', 'Total Botellas', 'Total Bidones', 'Total Horas', 'Meses analizados']],
    body: [[
      `${avgActivas}%`,
      totBotellas.toLocaleString('es-AR'),
      totBidones.toLocaleString('es-AR'),
      `${fmt(totHT, 0)} hs`,
      datos.length,
    ]],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 11, fontStyle: 'bold', halign: 'center', fillColor: [240, 245, 255] },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Tabla KPI principal
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setFillColor(230, 240, 255); doc.rect(14, y, 269, 6, 'F');
  doc.text('INDICADORES KPI POR MES', 16, y + 4.5);
  y += 8;

  doc.autoTable({
    startY: y,
    head: [['Mes', '% Activas', '% s/Prod.', '% Paradas', 'Bot/h', 'Bid/h', 'Botellas', 'Bidones', 'P.Mant.', 'P.Insum.', 'P.Corte']],
    body: [
      ...datos.map(d => [
        mesLabel(d.mes),
        `${d.pct_horas_activas}%`,
        `${d.pct_horas_sin_produccion}%`,
        `${d.pct_horas_paradas}%`,
        fmt(d.prom_botellas_hora, 0),
        fmt(d.prom_bidones_hora, 1),
        d.botellas_producidas.toLocaleString('es-AR'),
        d.bidones_producidos.toLocaleString('es-AR'),
        d.paradas_mantenimiento,
        d.paradas_insumos,
        d.paradas_corte,
      ]),
      // Fila de totales
      [
        'TOTALES',
        `${avgActivas}%`,
        `${totHT>0 ? fmt(totHSP/totHT*100) : '—'}%`,
        `${totHT>0 ? fmt(totHPar/totHT*100) : '—'}%`,
        `${totHP>0 ? fmt(totBotellas/totHP, 0) : '—'}`,
        `${totHP>0 ? fmt(totBidones/totHP, 1) : '—'}`,
        totBotellas.toLocaleString('es-AR'),
        totBidones.toLocaleString('es-AR'),
        totMant, totInsumos, totCorte,
      ]
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.row.index === datos.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 235, 255];
      }
    },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Tabla de distribución de paradas
  if (totMant + totInsumos + totCorte > 0) {
    const totalP = totMant + totInsumos + totCorte;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(255, 245, 220); doc.rect(14, y, 269, 6, 'F');
    doc.text('DISTRIBUCIÓN DE PARADAS', 16, y + 4.5);
    y += 8;

    doc.autoTable({
      startY: y,
      head: [['Motivo de Parada', 'Cantidad de ocurrencias', '% del total']],
      body: [
        ['Mantenimiento',    totMant,    `${(totMant    / totalP * 100).toFixed(1)}%`],
        ['Falta de insumos', totInsumos, `${(totInsumos / totalP * 100).toFixed(1)}%`],
        ['Corte de luz',     totCorte,   `${(totCorte   / totalP * 100).toFixed(1)}%`],
        ['TOTAL',            totalP,     '100%'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [200, 140, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.row.index === 3) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 240, 200]; }
      },
      margin: { left: 14, right: 14 },
    });
  }

  pdfFooter(doc);
  const desde2 = desde.replace(/-/g, '');
  const hasta2 = hasta.replace(/-/g, '');
  doc.save(`KPI_Mensual_${desde2}_${hasta2}.pdf`);
  toast('PDF descargado correctamente');
}

// ─────────────────────────────────────────────
// REPORTE ACUMULADO
// ─────────────────────────────────────────────
function inicializarFiltrosAcumulado() {
  if (!document.getElementById('ra-desde').value) {
    document.getElementById('ra-desde').value = primerDiaSeisMesesAtras();
    document.getElementById('ra-hasta').value = hoy();
    cargarReporteAcumulado();
  }
}

function limpiarFiltrosAcumulado() {
  document.getElementById('ra-desde').value = '';
  document.getElementById('ra-hasta').value = '';
  document.getElementById('ra-turno').value = '';
  datosAcumuladoActuales = null;
  document.getElementById('reporte-acumulado-content').innerHTML =
    '<div class="text-center text-muted py-5"><i class="bi bi-clipboard-data display-4 d-block mb-2"></i>Seleccioná un rango de fechas y generá el reporte.</div>';
}

async function cargarReporteAcumulado() {
  const desde = document.getElementById('ra-desde').value;
  const hasta = document.getElementById('ra-hasta').value;
  const turno = document.getElementById('ra-turno').value;
  if (!desde || !hasta) { toast('Ingresá el rango de fechas', 'warning'); return; }

  filtrosAcumuladoActuales = { desde, hasta, turno };
  const cont = document.getElementById('reporte-acumulado-content');
  cont.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

  let qs = `?fecha_desde=${desde}&fecha_hasta=${hasta}`;
  if (turno) qs += `&turno=${encodeURIComponent(turno)}`;

  try {
    const res = await apiGet(`${API}/reportes/acumulado${qs}`);
    datosAcumuladoActuales = res;
    const { datos, totales } = res;

    if (datos.length === 0) {
      cont.innerHTML = '<div class="alert alert-info">No hay datos para el período seleccionado.</div>';
      return;
    }

    const porFecha = {};
    datos.forEach(r => {
      if (!porFecha[r.fecha]) porFecha[r.fecha] = [];
      porFecha[r.fecha].push(r);
    });

    let filas = '';
    for (const [fecha, registros] of Object.entries(porFecha)) {
      const subBot = registros.reduce((a, r) => a + r.botellas_producidas, 0);
      const subBid = registros.reduce((a, r) => a + r.bidones_producidos, 0);
      registros.forEach(r => {
        filas += `<tr>
          <td>${fmtFecha(r.fecha)}</td>
          <td><span class="badge bg-secondary">${r.turno}</span></td>
          <td class="text-end">${r.botellas_producidas.toLocaleString('es-AR')}</td>
          <td class="text-end">${r.bidones_producidos.toLocaleString('es-AR')}</td>
        </tr>`;
      });
      if (registros.length > 1) {
        filas += `<tr class="table-light">
          <td colspan="2" class="text-end fw-semibold small text-muted">Subtotal ${fmtFecha(fecha)}</td>
          <td class="text-end fw-semibold">${subBot.toLocaleString('es-AR')}</td>
          <td class="text-end fw-semibold">${subBid.toLocaleString('es-AR')}</td>
        </tr>`;
      }
    }

    cont.innerHTML = `
      <!-- Botón PDF -->
      <div class="d-flex justify-content-end mb-3">
        <button class="btn btn-sm btn-danger" onclick="descargarPDFAcumulado()">
          <i class="bi bi-file-earmark-pdf me-2"></i>Descargar Reporte PDF
        </button>
      </div>

      <!-- Cards -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">
          <div class="kpi-card border-primary">
            <div class="kpi-value text-primary">${totales.botellas.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Botellas Acumuladas</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-info">
            <div class="kpi-value text-info">${totales.bidones.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Bidones Acumulados</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-secondary">
            <div class="kpi-value text-secondary">${datos.length}</div>
            <div class="kpi-label">Turnos Registrados</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-success">
            <div class="kpi-value text-success">${Object.keys(porFecha).length}</div>
            <div class="kpi-label">Días con Producción</div>
          </div>
        </div>
      </div>

      <!-- Tabla -->
      <div class="card shadow-sm">
        <div class="card-header bg-white">
          <strong><i class="bi bi-clipboard-data me-2 text-primary"></i>Producción Acumulada</strong>
          <span class="text-muted small ms-2">
            Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}${turno ? ' · Turno: ' + turno : ''}
          </span>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover table-sm mb-0 align-middle">
              <thead class="table-primary">
                <tr>
                  <th>Fecha</th><th>Turno</th>
                  <th class="text-end">Botellas Producidas</th>
                  <th class="text-end">Bidones Producidos</th>
                </tr>
              </thead>
              <tbody>${filas}</tbody>
              <tfoot class="table-dark fw-bold">
                <tr>
                  <td colspan="2">TOTAL ACUMULADO</td>
                  <td class="text-end">${totales.botellas.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totales.bidones.toLocaleString('es-AR')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    cont.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────
// PDF – REPORTE ACUMULADO
// ─────────────────────────────────────────────
function descargarPDFAcumulado() {
  const res = datosAcumuladoActuales;
  if (!res || res.datos.length === 0) { toast('No hay datos para exportar', 'warning'); return; }

  const { desde, hasta, turno } = filtrosAcumuladoActuales;
  const { datos, totales } = res;
  const doc = nuevoPDF();
  let y = pdfHeader(doc,
    `Reporte Producción Acumulada`,
    `Período: ${fmtFecha(desde)} al ${fmtFecha(hasta)}${turno ? ' · ' + turno : ''}`
  );

  // Resumen
  const porFecha = {};
  datos.forEach(r => { if (!porFecha[r.fecha]) porFecha[r.fecha] = []; porFecha[r.fecha].push(r); });

  doc.autoTable({
    startY: y,
    head: [['Total Botellas', 'Total Bidones', 'Turnos', 'Días']],
    body: [[
      totales.botellas.toLocaleString('es-AR'),
      totales.bidones.toLocaleString('es-AR'),
      datos.length,
      Object.keys(porFecha).length,
    ]],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 11, fontStyle: 'bold', halign: 'center', fillColor: [240, 245, 255] },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Título tabla
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
  doc.text('DETALLE POR TURNO', 16, y + 4.5);
  y += 8;

  // Construir filas con subtotales
  const bodyRows = [];
  for (const [fecha, registros] of Object.entries(porFecha)) {
    registros.forEach(r => {
      bodyRows.push([fmtFecha(r.fecha), r.turno,
        r.botellas_producidas.toLocaleString('es-AR'),
        r.bidones_producidos.toLocaleString('es-AR')]);
    });
    if (registros.length > 1) {
      const subBot = registros.reduce((a, r) => a + r.botellas_producidas, 0);
      const subBid = registros.reduce((a, r) => a + r.bidones_producidos, 0);
      bodyRows.push([`Subtotal ${fmtFecha(fecha)}`, '', subBot.toLocaleString('es-AR'), subBid.toLocaleString('es-AR')]);
    }
  }
  // Fila total
  bodyRows.push(['TOTAL ACUMULADO', '', totales.botellas.toLocaleString('es-AR'), totales.bidones.toLocaleString('es-AR')]);

  const subtotalIdxs = new Set();
  let idx = 0;
  for (const [, registros] of Object.entries(porFecha)) {
    idx += registros.length;
    if (registros.length > 1) subtotalIdxs.add(idx++);
  }

  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Turno', 'Botellas Producidas', 'Bidones Producidos']],
    body: bodyRows,
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (data) => {
      const isLast = data.row.index === bodyRows.length - 1;
      const isSub  = subtotalIdxs.has(data.row.index);
      if (isLast) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [200, 220, 255]; }
      else if (isSub) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [230, 240, 230]; }
    },
    margin: { left: 14, right: 14 },
  });

  pdfFooter(doc);
  const d1 = desde.replace(/-/g, ''), d2 = hasta.replace(/-/g, '');
  doc.save(`KPI_Acumulado_${d1}_${d2}${turno ? '_' + turno : ''}.pdf`);
  toast('PDF descargado correctamente');
}

// ─────────────────────────────────────────────
// INICIO
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('[data-section="carga"]').classList.add('active');
  limpiarFormulario();
});
