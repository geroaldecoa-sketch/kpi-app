/* =====================================================
   KPI PRODUCCIÓN – app.js
   ===================================================== */

const API = '/api';
let chartHoras = null, chartProduccion = null, chartParadas = null;
let registroDetalleActual  = null;  // para PDF desde modal de detalle
let datosMensualActuales   = null;  // para PDF reporte mensual
let datosAcumuladoActuales = null;  // para PDF reporte acumulado
let filtrosMensualActuales   = {};
let filtrosAcumuladoActuales = {};

const modalEliminar = new bootstrap.Modal(document.getElementById('modal-eliminar'));
const modalDetalle  = new bootstrap.Modal(document.getElementById('modal-detalle'));
const toastEl  = document.getElementById('toast-notif');
const bsToast  = new bootstrap.Toast(toastEl, { delay: 3500 });

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
  if (id === 'listado')           cargarListado();
  if (id === 'reporte-mensual')   inicializarFiltrosMensual();
  if (id === 'reporte-acumulado') inicializarFiltrosAcumulado();
  if (id === 'configuracion')     cargarConfiguracion();
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

// Color estable por motivo (según su id)
const COLORES_MOTIVO = ['warning text-dark', 'info text-dark', 'danger', 'secondary', 'success', 'primary', 'dark'];
function badgeMotivo(motivoId, nombre) {
  const c = COLORES_MOTIVO[((parseInt(motivoId) || 1) - 1) % COLORES_MOTIVO.length];
  return `<span class="badge bg-${c}">${esc(nombre)}</span>`;
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

// Lee la respuesta como JSON; si el servidor devuelve otra cosa (p. ej. una página HTML), da un error entendible
async function leerJSON(r) {
  const texto = await r.text();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch (_) {
    return { error: `El servidor respondió algo inesperado (${r.status}). Probá reiniciar la aplicación.` };
  }
}

async function apiGet(url) {
  const r = await fetch(url);
  const json = await leerJSON(r);
  if (!r.ok || json.error) throw new Error(json.error || (json.errores || []).join(' · ') || 'Error en la solicitud');
  return json;
}

async function apiPost(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await leerJSON(r);
  if (!r.ok || (json.error && !Array.isArray(json))) throw json;
  return json;
}

async function apiPut(url, data) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await leerJSON(r);
  if (!r.ok || (json.error && !Array.isArray(json))) throw json;
  return json;
}

async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE' });
  const json = await leerJSON(r);
  if (!r.ok) throw new Error(json.error || 'Error al eliminar');
  return json;
}

// ─────────────────────────────────────────────
// UTILIDADES PDF (jsPDF + autoTable)
// ─────────────────────────────────────────────
function nuevoPDF(orientacion = 'p') {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: orientacion, unit: 'mm', format: 'a4' });
}

function pdfHeader(doc, titulo, subtitulo = '') {
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFillColor(0, 86, 179);
  doc.rect(0, 0, ancho, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('KPI Producción – Fábrica de Aceite', 14, 8);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(titulo, 14, 15);
  if (subtitulo) {
    doc.setFontSize(9);
    doc.text(subtitulo, ancho - 14, 15, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
  return 26;
}

function pdfFooter(doc) {
  const pageCount = doc.getNumberOfPages();
  const ancho = doc.internal.pageSize.getWidth();
  const alto  = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Generado el ${new Date().toLocaleDateString('es-AR')} a las ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}   |   Página ${i} de ${pageCount}`,
      14, alto - 5
    );
    doc.setDrawColor(200);
    doc.line(14, alto - 8, ancho - 14, alto - 8);
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
  const totalBidones = (r.bidones_5L || 0) + (r.bidones_10L || 0);

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
                <tr><td>Horas Parados</td><td class="text-end fw-semibold text-danger">${r.horas_parados} hs</td></tr>
                <tr class="border-top"><td><strong>Horas Totales</strong></td><td class="text-end fw-bold">${r.horas_totales} hs</td></tr>
              </tbody>
            </table>
            <!-- Barra visual -->
            <div class="progress mt-2" style="height:8px" title="Verde=Producción, Rojo=Parado">
              <div class="progress-bar bg-success" style="width:${fmt(r.pct_horas_activas)}%"></div>
              <div class="progress-bar bg-danger"  style="width:${fmt(r.pct_horas_paradas)}%"></div>
            </div>
            <div class="d-flex justify-content-between mt-1" style="font-size:0.7rem">
              <span class="text-success">Activas ${fmt(r.pct_horas_activas)}%</span>
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
                <tr><td>Bidones 5L</td><td class="text-end fw-semibold">${(r.bidones_5L || 0).toLocaleString('es-AR')}</td></tr>
                <tr><td>Bidones 10L</td><td class="text-end fw-semibold">${(r.bidones_10L || 0).toLocaleString('es-AR')}</td></tr>
                <tr class="border-top"><td><strong>Total Bidones</strong></td><td class="text-end fw-bold">${totalBidones.toLocaleString('es-AR')}</td></tr>
                <tr><td>Prom. Botellas/hora</td><td class="text-end fw-semibold text-primary">${fmt(r.prom_botellas_hora, 0)}</td></tr>
                <tr><td>Prom. Bidones 5L/hora</td><td class="text-end fw-semibold text-info">${fmt(r.prom_bidones_5L_hora, 1)}</td></tr>
                <tr><td>Prom. Bidones 10L/hora</td><td class="text-end fw-semibold text-info">${fmt(r.prom_bidones_10L_hora, 1)}</td></tr>
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

    <!-- Operarios -->
    <div class="card border-0 bg-light mb-3">
      <div class="card-body py-2">
        <h6 class="text-secondary mb-2"><i class="bi bi-people me-1"></i>Operarios del turno</h6>
        ${(r.operarios || []).length
          ? r.operarios.map(o => `<span class="badge rounded-pill text-bg-primary me-1 mb-1"><i class="bi bi-person me-1"></i>${esc(o.nombre)}</span>`).join('')
          : '<em class="text-muted small">Sin operarios cargados</em>'}
      </div>
    </div>

    <!-- Paradas -->
    <div class="card border-0 bg-light mb-3">
      <div class="card-body py-2">
        <h6 class="text-secondary mb-2"><i class="bi bi-pause-circle me-1"></i>Paradas del turno</h6>
        ${(r.paradas || []).length ? `
          <table class="table table-sm mb-0">
            <thead><tr><th>Motivo</th><th>Detalle</th><th class="text-end">Tiempo</th></tr></thead>
            <tbody>
              ${r.paradas.map(p => `
                <tr>
                  <td>${badgeMotivo(p.motivo_id, p.motivo)}</td>
                  <td>${p.detalle ? esc(p.detalle) : '<span class="text-muted">—</span>'}</td>
                  <td class="text-end">${fmtMin(p.minutos)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr class="fw-bold"><td colspan="2">Total (${r.paradas.length} parada${r.paradas.length === 1 ? '' : 's'})</td><td class="text-end">${fmtMin(r.minutos_parada)}</td></tr></tfoot>
          </table>` : '<em class="text-muted small">Sin paradas</em>'}
      </div>
    </div>

    <!-- Observaciones -->
    <div class="card border-0 bg-light">
      <div class="card-body py-2">
        <h6 class="text-secondary mb-1"><i class="bi bi-journal-text me-1"></i>Observaciones</h6>
        <p class="mb-0 small" style="white-space:pre-line">${r.observaciones ? esc(r.observaciones) : '<em class="text-muted">Sin observaciones</em>'}</p>
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
      ['Horas Producción', `${r.horas_produccion} hs`, `${fmt(r.pct_horas_activas)}%`],
      ['Horas Parados',    `${r.horas_parados} hs`,    `${fmt(r.pct_horas_paradas)}%`],
      ['HORAS TOTALES',    `${r.horas_totales} hs`,    '100%'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 120, 60], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.row.index === 2) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [220, 240, 220]; }
    },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Producción y KPIs
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
  doc.text('PRODUCCIÓN Y KPIs', 16, y + 4.5);
  y += 8;

  const totalBidones = (r.bidones_5L || 0) + (r.bidones_10L || 0);

  doc.autoTable({
    startY: y,
    head: [['Indicador', 'Valor']],
    body: [
      ['Botellas Producidas',         r.botellas_producidas.toLocaleString('es-AR')],
      ['Bidones 5L',                  (r.bidones_5L  || 0).toLocaleString('es-AR')],
      ['Bidones 10L',                 (r.bidones_10L || 0).toLocaleString('es-AR')],
      ['Total Bidones',               totalBidones.toLocaleString('es-AR')],
      ['Promedio Botellas / Hora',    `${fmt(r.prom_botellas_hora,    0)} bot/h`],
      ['Promedio Bidones 5L / Hora',  `${fmt(r.prom_bidones_5L_hora,  1)} bid/h`],
      ['Promedio Bidones 10L / Hora', `${fmt(r.prom_bidones_10L_hora, 1)} bid/h`],
      ['% Horas Activas',             `${fmt(r.pct_horas_activas)}%`],
      ['% Horas Paradas',             `${fmt(r.pct_horas_paradas)}%`],
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  const seccionPDF = (titulo) => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(230, 240, 255); doc.rect(14, y, 182, 6, 'F');
    doc.text(titulo, 16, y + 4.5);
    y += 8;
  };

  // Operarios
  seccionPDF('OPERARIOS DEL TURNO');
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  const ops = (r.operarios || []).map(o => o.nombre).join(', ') || 'Sin operarios cargados';
  const opsLines = doc.splitTextToSize(ops, 180);
  doc.text(opsLines, 14, y + 2);
  y += opsLines.length * 5 + 4;

  // Paradas
  seccionPDF('PARADAS DEL TURNO');
  if ((r.paradas || []).length) {
    doc.autoTable({
      startY: y,
      head: [['Motivo', 'Detalle', 'Minutos']],
      body: [
        ...r.paradas.map(p => [p.motivo, p.detalle || '—', p.minutos]),
        [`TOTAL (${r.paradas.length})`, '', `${r.minutos_parada} min (${fmt(r.minutos_parada / 60, 2)} hs)`],
      ],
      theme: 'striped',
      headStyles: { fillColor: [200, 140, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 50 }, 2: { halign: 'right', cellWidth: 45 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === r.paradas.length) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 240, 200]; }
      },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Sin paradas', 14, y + 2); y += 8;
  }

  // Observaciones
  if (r.observaciones) {
    seccionPDF('OBSERVACIONES');
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(r.observaciones, 180);
    doc.text(lines, 14, y + 2);
  }

  pdfFooter(doc);
  doc.save(`KPI_Registro_${r.fecha}_${r.turno.replace('ñ','n')}.pdf`);
}

// ─────────────────────────────────────────────
// MAESTROS (operarios / motivos) – caché en memoria
// ─────────────────────────────────────────────
let operarios = [];        // todos (activos e inactivos)
let grupos    = [];        // grupos de operarios [{id, nombre, activo, operario_ids}]
let motivos   = [];
let detallesParada = [];   // [{motivo_id, detalle, usos}] para autocompletar

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMin(min) {
  min = parseInt(min) || 0;
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

async function cargarMaestros() {
  try {
    [operarios, motivos, detallesParada, grupos] = await Promise.all([
      apiGet(`${API}/operarios`),
      apiGet(`${API}/motivos`),
      apiGet(`${API}/paradas/detalles`),
      apiGet(`${API}/grupos`),
    ]);
  } catch (err) {
    toast('No se pudieron cargar operarios / motivos: ' + err.message, 'danger');
  }
}

// ─────────────────────────────────────────────
// FORMULARIO – OPERARIOS DEL TURNO
// ─────────────────────────────────────────────
const nombreOperario = o => `${o.nombre} ${o.apellido || ''}`.trim();
const nombreOperarioLista = o => o.apellido ? `${o.apellido}, ${o.nombre}` : o.nombre;

function renderOperariosForm(seleccionados = null) {
  const cont = document.getElementById('f-operarios');
  const actuales = seleccionados ?? operariosSeleccionados();
  const sel = new Set(actuales.map(Number));
  // Activos + los inactivos que ya estaban asignados (al editar un registro viejo)
  const lista = operarios.filter(o => o.activo || sel.has(o.id));

  if (lista.length === 0) {
    cont.innerHTML = `<span class="text-muted small">No hay operarios cargados.
      <a href="#" onclick="irAConfiguracion(event)">Agregá operarios en Configuración</a>.</span>`;
  } else {
    cont.innerHTML = lista.map(o => `
      <div class="chip-operario">
        <input type="checkbox" class="btn-check" id="chk-op-${o.id}" value="${o.id}" autocomplete="off" ${sel.has(o.id) ? 'checked' : ''}>
        <label class="btn btn-outline-primary" for="chk-op-${o.id}" title="${o.dni ? 'DNI ' + esc(o.dni) : ''}">
          <i class="bi bi-person me-1"></i>${esc(nombreOperarioLista(o))}${o.activo ? '' : ' <small>(inactivo)</small>'}
        </label>
      </div>`).join('');
  }
  renderGruposRapidos();
}

// Botones de grupo en la carga: un clic tilda a todo el grupo (si ya estaban todos, los destilda)
function renderGruposRapidos() {
  const cont = document.getElementById('f-grupos');
  const sel  = new Set(operariosSeleccionados());
  const activosIds = new Set(operarios.filter(o => o.activo).map(o => o.id));
  const lista = grupos.filter(g => g.activo && g.operario_ids.some(id => activosIds.has(id)));
  document.getElementById('f-operarios-cant').textContent = sel.size;

  if (lista.length === 0) {
    cont.innerHTML = '';
    cont.classList.add('d-none');
    return;
  }
  cont.classList.remove('d-none');
  cont.innerHTML = '<span class="small text-muted me-1"><i class="bi bi-diagram-3 me-1"></i>Grupos:</span>' +
    lista.map(g => {
      const miembros = g.operario_ids.filter(id => activosIds.has(id));
      const completo = miembros.length > 0 && miembros.every(id => sel.has(id));
      return `<button type="button" class="btn btn-sm ${completo ? 'btn-success' : 'btn-outline-success'} rounded-pill"
                onclick="aplicarGrupo(${g.id})" title="${completo ? 'Quitar' : 'Tildar'} a ${miembros.length} operario${miembros.length === 1 ? '' : 's'}">
                ${completo ? '<i class="bi bi-check2 me-1"></i>' : ''}${esc(g.nombre)} <span class="opacity-75">(${miembros.length})</span>
              </button>`;
    }).join('') +
    (sel.size ? `<button type="button" class="btn btn-sm btn-link text-decoration-none text-secondary" onclick="limpiarOperariosForm()">Destildar todos</button>` : '');
}

function aplicarGrupo(grupoId) {
  const g = grupos.find(x => x.id === grupoId);
  if (!g) return;
  const activosIds = new Set(operarios.filter(o => o.activo).map(o => o.id));
  const miembros = g.operario_ids.filter(id => activosIds.has(id));
  const sel = new Set(operariosSeleccionados());
  const completo = miembros.every(id => sel.has(id));
  miembros.forEach(id => {
    const chk = document.getElementById(`chk-op-${id}`);
    if (chk) chk.checked = !completo;
  });
  renderGruposRapidos();
}

function limpiarOperariosForm() {
  document.querySelectorAll('#f-operarios input:checked').forEach(c => { c.checked = false; });
  renderGruposRapidos();
}

document.getElementById('f-operarios').addEventListener('change', renderGruposRapidos);

function operariosSeleccionados() {
  return [...document.querySelectorAll('#f-operarios input:checked')].map(i => parseInt(i.value));
}

// ─────────────────────────────────────────────
// FORMULARIO – PARADAS DEL TURNO
// ─────────────────────────────────────────────
function opcionesMotivo(seleccionado) {
  const sel = parseInt(seleccionado) || null;
  const lista = motivos.filter(m => m.activo || m.id === sel);
  return '<option value="">— Seleccioná —</option>' +
    lista.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.nombre)}${m.activo ? '' : ' (inactivo)'}</option>`).join('');
}

function agregarParada(p = {}) {
  const tbody = document.getElementById('f-paradas-body');
  const tr = document.createElement('div');
  tr.className = 'row g-2 align-items-center fila-parada';
  tr.innerHTML = `
    <div class="col-12 col-md-4"><select class="form-select form-select-sm par-motivo" aria-label="Motivo">${opcionesMotivo(p.motivo_id)}</select></div>
    <div class="col-12 col-md-5"><input type="text" class="form-control form-control-sm par-detalle" list="dl-detalles-parada"
               maxlength="200" placeholder="Detalle (ej: Sopladora)" aria-label="Detalle" value="${esc(p.detalle || '')}"></div>
    <div class="col-9 col-md-2">
      <div class="input-group input-group-sm">
        <input type="number" class="form-control par-minutos" min="1" step="1" placeholder="0" aria-label="Minutos" value="${p.minutos ?? ''}">
        <span class="input-group-text">min</span>
      </div>
    </div>
    <div class="col-3 col-md-1 text-end">
      <button type="button" class="btn btn-sm btn-outline-danger" title="Quitar parada"><i class="bi bi-trash"></i></button>
    </div>`;
  tr.querySelector('.par-minutos').addEventListener('input', recalcularHoras);
  tr.querySelector('.par-motivo').addEventListener('change', actualizarDatalistDetalles);
  tr.querySelector('.par-detalle').addEventListener('focus', e => actualizarDatalistDetalles(e));
  tr.querySelector('button').addEventListener('click', () => { tr.remove(); recalcularHoras(); });
  tbody.appendChild(tr);
  if (!p.motivo_id) tr.querySelector('.par-motivo').focus();
  recalcularHoras();
}

// Sugiere detalles usados antes con el mismo motivo (o todos si no hay motivo elegido)
function actualizarDatalistDetalles(e) {
  const tr = e.target.closest('.fila-parada');
  const motivoId = parseInt(tr.querySelector('.par-motivo').value) || null;
  const vistos = new Set();
  const opciones = detallesParada
    .filter(d => !motivoId || d.motivo_id === motivoId)
    .filter(d => !vistos.has(d.detalle.toLowerCase()) && vistos.add(d.detalle.toLowerCase()));
  document.getElementById('dl-detalles-parada').innerHTML =
    opciones.map(d => `<option value="${esc(d.detalle)}">`).join('');
}

function paradasDelFormulario() {
  return [...document.querySelectorAll('#f-paradas-body .fila-parada')].map(tr => ({
    motivo_id: parseInt(tr.querySelector('.par-motivo').value) || null,
    detalle:   tr.querySelector('.par-detalle').value.trim(),
    minutos:   parseInt(tr.querySelector('.par-minutos').value) || 0,
  }));
}

// ─────────────────────────────────────────────
// FORMULARIO – HORAS CALCULADAS + KPIs EN TIEMPO REAL
// ─────────────────────────────────────────────
function recalcularHoras() {
  const paradas = paradasDelFormulario();
  const minutos = paradas.reduce((a, p) => a + p.minutos, 0);
  const ht      = parseFloat(document.getElementById('f-horas-totales').value);
  const hpa     = minutos / 60;
  const hp      = isNaN(ht) ? null : ht - hpa;

  document.getElementById('f-paradas-vacio').classList.toggle('d-none', paradas.length > 0);
  document.querySelector('.paradas-head').classList.toggle('oculto', paradas.length === 0);
  document.getElementById('f-paradas-total').innerHTML =
    `Total paradas: <strong>${paradas.length}</strong> · <strong>${minutos} min</strong>${minutos ? ` (${fmt(hpa, 2)} hs)` : ''}`;

  document.getElementById('f-horas-parados').value    = fmt(hpa, 2);
  document.getElementById('f-horas-produccion').value = hp === null ? '' : fmt(Math.max(0, hp), 2);

  const el = document.getElementById('validacion-horas');
  if (!isNaN(ht) && ht > 0 && hp < -0.001) {
    el.classList.remove('d-none');
    el.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Las paradas (${fmt(hpa, 2)} hs) superan las Horas Totales (${ht} hs).</span>`;
  } else {
    el.classList.add('d-none');
  }
  actualizarKPIPreview();
}

document.getElementById('f-horas-totales').addEventListener('input', recalcularHoras);
document.getElementById('f-botellas').addEventListener('input', actualizarKPIPreview);
document.getElementById('f-bidones-5l').addEventListener('input', actualizarKPIPreview);
document.getElementById('f-bidones-10l').addEventListener('input', actualizarKPIPreview);

function actualizarKPIPreview() {
  const ht   = parseFloat(document.getElementById('f-horas-totales').value)   || 0;
  const hp   = parseFloat(document.getElementById('f-horas-produccion').value) || 0;
  const hpa  = parseFloat(document.getElementById('f-horas-parados').value)    || 0;
  const bot  = parseFloat(document.getElementById('f-botellas').value)         || 0;
  const bid5 = parseFloat(document.getElementById('f-bidones-5l').value)       || 0;
  const bid10= parseFloat(document.getElementById('f-bidones-10l').value)      || 0;
  const preview = document.getElementById('kpi-preview');
  if (ht <= 0) { preview.classList.add('d-none'); return; }
  preview.classList.remove('d-none');
  document.getElementById('kpi-pct-activas').textContent = `% Activas: ${fmt(hp  / ht * 100)}%`;
  document.getElementById('kpi-pct-par').textContent     = `% Paradas: ${fmt(hpa / ht * 100)}%`;
  document.getElementById('kpi-prom-bot').textContent    = hp > 0 ? fmt(bot  / hp, 0) : '—';
  document.getElementById('kpi-prom-bid5').textContent   = hp > 0 ? fmt(bid5 / hp, 1) : '—';
  document.getElementById('kpi-prom-bid10').textContent  = hp > 0 ? fmt(bid10/ hp, 1) : '—';
}

// ─────────────────────────────────────────────
// FORMULARIO – SUBMIT
// ─────────────────────────────────────────────

// Flag para prevenir doble envío
let _enviandoFormulario = false;

document.getElementById('form-produccion').addEventListener('submit', async e => {
  e.preventDefault();
  if (_enviandoFormulario) return;

  const alertEl   = document.getElementById('alert-form');
  const btnSubmit = document.getElementById('btn-submit');
  const btnText   = document.getElementById('btn-submit-text');
  alertEl.className = 'alert d-none';

  const data = {
    fecha:               document.getElementById('f-fecha').value,
    turno:               document.getElementById('f-turno').value,
    horas_bidones:       parseFloat(document.getElementById('f-horas-bidones').value)  || 0,
    horas_botellas:      parseFloat(document.getElementById('f-horas-botellas').value) || 0,
    observaciones:       document.getElementById('f-observaciones').value.trim(),
    horas_totales:       document.getElementById('f-horas-totales').value === '' ? '' : parseFloat(document.getElementById('f-horas-totales').value),
    botellas_producidas: document.getElementById('f-botellas').value     === '' ? '' : parseInt(document.getElementById('f-botellas').value),
    bidones_5L:          document.getElementById('f-bidones-5l').value   === '' ? '' : parseInt(document.getElementById('f-bidones-5l').value),
    bidones_10L:         document.getElementById('f-bidones-10l').value  === '' ? '' : parseInt(document.getElementById('f-bidones-10l').value),
    operario_ids:        operariosSeleccionados(),
    paradas:             paradasDelFormulario(),
  };

  _enviandoFormulario = true;
  btnSubmit.disabled = true;
  const textoOriginal = btnText.textContent;
  btnText.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Guardando…';

  const editId = document.getElementById('edit-id').value;

  try {
    if (editId) {
      await apiPut(`${API}/produccion/${editId}`, data);
      toast('✅ Registro actualizado correctamente');
    } else {
      await apiPost(`${API}/produccion`, data);
      toast('✅ Registro guardado correctamente');
    }
    cargarMaestros(); // refresca sugerencias de detalle y contadores de uso
    limpiarFormulario();
    mostrarSeccion('listado');
    document.querySelectorAll('.nav-tab').forEach(l => {
      l.classList.toggle('active', l.dataset.section === 'listado');
    });
  } catch (err) {
    const errores = err.errores || [err.error || err.message || 'Error desconocido'];
    alertEl.className = 'alert alert-danger';
    alertEl.innerHTML = '<strong>Errores:</strong><ul class="mb-0 mt-1">' +
      errores.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>';
    alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    _enviandoFormulario = false;
    btnSubmit.disabled = false;
    btnText.textContent = textoOriginal;
  }
});

function limpiarFormulario() {
  document.getElementById('form-produccion').reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = 'Nuevo Registro de Producción';
  document.getElementById('btn-submit-text').textContent = 'Guardar Registro';
  document.getElementById('btn-cancelar-edicion').style.display = 'none';
  document.getElementById('alert-form').className = 'alert d-none';
  document.getElementById('f-paradas-body').innerHTML = '';
  document.getElementById('f-fecha').value = hoy();
  renderOperariosForm([]);
  recalcularHoras();
}

function cancelarEdicion() { limpiarFormulario(); }

function editarRegistro(id, d) {
  mostrarSeccion('carga');
  document.querySelectorAll('.nav-tab').forEach(l => l.classList.toggle('active', l.dataset.section === 'carga'));
  limpiarFormulario();
  document.getElementById('edit-id').value = id;
  document.getElementById('f-fecha').value = d.fecha;
  document.getElementById('f-turno').value = d.turno;
  document.getElementById('f-horas-bidones').value  = d.horas_bidones;
  document.getElementById('f-horas-botellas').value = d.horas_botellas;
  document.getElementById('f-observaciones').value  = d.observaciones || '';
  document.getElementById('f-horas-totales').value  = d.horas_totales;
  document.getElementById('f-botellas').value      = d.botellas_producidas;
  document.getElementById('f-bidones-5l').value    = d.bidones_5L  || 0;
  document.getElementById('f-bidones-10l').value   = d.bidones_10L || 0;
  renderOperariosForm((d.operarios || []).map(o => o.id));
  (d.paradas || []).forEach(p => agregarParada(p));
  document.getElementById('form-title').textContent      = `Editando Registro #${id}`;
  document.getElementById('btn-submit-text').textContent = 'Actualizar Registro';
  document.getElementById('btn-cancelar-edicion').style.display = '';
  recalcularHoras();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irAConfiguracion(e) {
  if (e) e.preventDefault();
  mostrarSeccion('configuracion');
  document.querySelectorAll('.nav-tab').forEach(l => l.classList.toggle('active', l.dataset.section === 'configuracion'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────────────────────────────────────
// CONFIGURACIÓN – ABM OPERARIOS Y MOTIVOS
// ─────────────────────────────────────────────
const ABM = {
  operarios: {
    url: `${API}/operarios`, prefijo: 'op', tbody: 'tbody-operarios', etiqueta: 'Operario',
    campos: ['nombre', 'apellido', 'dni'],
    obligatorios: { nombre: 'El nombre es obligatorio', apellido: 'El apellido es obligatorio' },
    columnas: 6,
    fila: o => {
      const gs = grupos.filter(g => g.operario_ids.includes(o.id));
      return `
      <td class="fw-semibold">${esc(nombreOperarioLista(o))}</td>
      <td>${o.dni ? esc(Number(o.dni).toLocaleString('es-AR')) : '<span class="text-muted">—</span>'}</td>
      <td>${gs.length ? gs.map(g => `<span class="badge text-bg-light border me-1">${esc(g.nombre)}</span>`).join('') : '<span class="text-muted">—</span>'}</td>
      <td class="text-center">${o.usos}</td>`;
    },
    filtro: o => {
      const q = (document.getElementById('op-buscar').value || '').trim().toLowerCase();
      if (!q) return true;
      return `${o.nombre} ${o.apellido} ${o.dni}`.toLowerCase().includes(q);
    },
    lista: () => operarios,
  },
  motivos: {
    url: `${API}/motivos`, prefijo: 'mo', tbody: 'tbody-motivos', etiqueta: 'Motivo',
    campos: ['nombre'],
    columnas: 4,
    fila: m => `
      <td class="fw-semibold">${esc(m.nombre)}</td>
      <td class="text-center">${m.usos}</td>`,
    lista: () => motivos,
  },
};

async function cargarConfiguracion() {
  await cargarMaestros();
  renderABM('operarios');
  renderABM('motivos');
  renderGruposABM();
}

function renderABM(tipo) {
  const cfg   = ABM[tipo];
  const todos = cfg.lista();
  const lista = cfg.filtro ? todos.filter(cfg.filtro) : todos;
  const cols  = cfg.columnas;
  if (tipo === 'operarios') {
    const activos = todos.filter(o => o.activo).length;
    document.getElementById('op-contador').textContent =
      `${todos.length} operario${todos.length === 1 ? '' : 's'} · ${activos} activo${activos === 1 ? '' : 's'}` +
      (lista.length !== todos.length ? ` · mostrando ${lista.length}` : '');
  }
  document.getElementById(cfg.tbody).innerHTML = lista.length === 0
    ? `<tr><td colspan="${cols}" class="text-center text-muted py-3">${todos.length ? 'Sin resultados para la búsqueda.' : 'Todavía no hay registros.'}</td></tr>`
    : lista.map(x => `
      <tr class="${x.activo ? '' : 'text-muted'}">
        ${cfg.fila(x)}
        <td class="text-center">
          <div class="form-check form-switch d-inline-block mb-0">
            <input class="form-check-input" type="checkbox" ${x.activo ? 'checked' : ''}
              onchange="toggleActivoABM('${tipo}', ${x.id}, this.checked)" title="${x.activo ? 'Desactivar' : 'Activar'}">
          </div>
        </td>
        <td class="text-center" style="white-space:nowrap">
          <button class="btn btn-xs btn-outline-primary me-1" title="Editar" onclick="editarABM('${tipo}', ${x.id})"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-xs btn-outline-secondary" title="${x.usos > 0 ? 'En uso: desactivalo en lugar de eliminarlo' : 'Eliminar'}"
            ${x.usos > 0 ? 'disabled' : ''} onclick="eliminarABM('${tipo}', ${x.id})"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`).join('');
}

function resetFormABM(tipo) {
  const { prefijo } = ABM[tipo];
  document.getElementById(`form-${tipo === 'operarios' ? 'operario' : 'motivo'}`).reset();
  document.getElementById(`${prefijo}-id`).value = '';
  document.querySelector(`#${prefijo}-btn span`).textContent = 'Agregar';
  document.querySelector(`#${prefijo}-btn i`).className = 'bi bi-plus-lg me-1';
  document.getElementById(`${prefijo}-cancelar`).classList.add('d-none');
}

function editarABM(tipo, id) {
  const cfg = ABM[tipo];
  const x = cfg.lista().find(i => i.id === id);
  if (!x) return;
  document.getElementById(`${cfg.prefijo}-id`).value = id;
  cfg.campos.forEach(c => { document.getElementById(`${cfg.prefijo}-${c}`).value = x[c] || ''; });
  document.querySelector(`#${cfg.prefijo}-btn span`).textContent = 'Guardar';
  document.querySelector(`#${cfg.prefijo}-btn i`).className = 'bi bi-check-lg me-1';
  document.getElementById(`${cfg.prefijo}-cancelar`).classList.remove('d-none');
  document.getElementById(`${cfg.prefijo}-nombre`).focus();
}

async function guardarABM(tipo) {
  const cfg = ABM[tipo];
  const id  = document.getElementById(`${cfg.prefijo}-id`).value;
  const data = {};
  cfg.campos.forEach(c => { data[c] = document.getElementById(`${cfg.prefijo}-${c}`).value.trim(); });
  const faltante = Object.entries(cfg.obligatorios || { nombre: 'El nombre es obligatorio' }).find(([c]) => !data[c]);
  if (faltante) { toast(faltante[1], 'warning'); document.getElementById(`${cfg.prefijo}-${faltante[0]}`).focus(); return; }
  const actual = id ? cfg.lista().find(i => i.id === parseInt(id)) : null;
  data.activo = actual ? actual.activo : true;
  try {
    if (id) await apiPut(`${cfg.url}/${id}`, data);
    else    await apiPost(cfg.url, data);
    toast(`${cfg.etiqueta} ${id ? 'actualizado' : 'agregado'}`);
    resetFormABM(tipo);
    await cargarConfiguracion();
    refrescarFormularioCarga();
  } catch (err) {
    toast((err.errores || [err.error || err.message]).join(' · '), 'danger');
  }
}

async function toggleActivoABM(tipo, id, activo) {
  const cfg = ABM[tipo];
  const x = cfg.lista().find(i => i.id === id);
  if (!x) return;
  const data = { activo };
  cfg.campos.forEach(c => { data[c] = x[c] || ''; });
  try {
    await apiPut(`${cfg.url}/${id}`, data);
    toast(`${cfg.etiqueta} ${activo ? 'activado' : 'desactivado'}`, activo ? 'success' : 'secondary');
    await cargarConfiguracion();
    refrescarFormularioCarga();
  } catch (err) {
    toast((err.errores || [err.error || err.message]).join(' · '), 'danger');
    renderABM(tipo);
  }
}

function eliminarABM(tipo, id) {
  const cfg = ABM[tipo];
  const x = cfg.lista().find(i => i.id === id);
  if (!x) return;
  pedirConfirmacion(`¿Confirmás que querés eliminar el ${cfg.etiqueta.toLowerCase()} <strong>${esc(x.nombre)}</strong>?`, async () => {
    try {
      await apiDelete(`${cfg.url}/${id}`);
      toast(`${cfg.etiqueta} eliminado`, 'danger');
      await cargarConfiguracion();
      refrescarFormularioCarga();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
}

// Mantiene lo cargado en el formulario de producción pero con los maestros actualizados
function refrescarFormularioCarga() {
  renderOperariosForm(operariosSeleccionados());
  document.querySelectorAll('#f-paradas-body .par-motivo').forEach(sel => {
    const v = sel.value;
    sel.innerHTML = opcionesMotivo(v);
  });
}

document.getElementById('op-buscar').addEventListener('input', () => renderABM('operarios'));

// ─────────────────────────────────────────────
// CONFIGURACIÓN – GRUPOS DE OPERARIOS
// ─────────────────────────────────────────────
function renderMiembrosGrupo(seleccionados = []) {
  const sel = new Set(seleccionados.map(Number));
  const lista = operarios.filter(o => o.activo || sel.has(o.id));
  const cont = document.getElementById('gr-miembros');
  cont.innerHTML = lista.length === 0
    ? '<span class="text-muted small">Primero cargá o importá operarios.</span>'
    : lista.map(o => `
      <div class="chip-operario">
        <input type="checkbox" class="btn-check" id="chk-gr-${o.id}" value="${o.id}" autocomplete="off" ${sel.has(o.id) ? 'checked' : ''}>
        <label class="btn btn-sm btn-outline-success" for="chk-gr-${o.id}">${esc(nombreOperarioLista(o))}${o.activo ? '' : ' <small>(inactivo)</small>'}</label>
      </div>`).join('');
  actualizarContadorGrupo();
}

function miembrosGrupoSeleccionados() {
  return [...document.querySelectorAll('#gr-miembros input:checked')].map(i => parseInt(i.value));
}

function actualizarContadorGrupo() {
  const n = miembrosGrupoSeleccionados().length;
  document.getElementById('gr-contador').textContent = `(${n} seleccionado${n === 1 ? '' : 's'})`;
}

function marcarTodosGrupo(valor) {
  document.querySelectorAll('#gr-miembros input').forEach(c => { c.checked = valor; });
  actualizarContadorGrupo();
}

function renderGruposABM() {
  const porId = Object.fromEntries(operarios.map(o => [o.id, o]));
  document.getElementById('tbody-grupos').innerHTML = grupos.length === 0
    ? '<tr><td colspan="4" class="text-center text-muted py-3">Todavía no hay grupos.</td></tr>'
    : grupos.map(g => {
      const miembros = g.operario_ids.map(id => porId[id]).filter(Boolean);
      return `
      <tr class="${g.activo ? '' : 'text-muted'}">
        <td class="fw-semibold">${esc(g.nombre)} <span class="badge rounded-pill text-bg-secondary ms-1">${miembros.length}</span></td>
        <td class="small">${miembros.length ? miembros.map(o => esc(nombreOperario(o)) + (o.activo ? '' : ' <em>(inactivo)</em>')).join(', ') : '<span class="text-muted">Sin integrantes</span>'}</td>
        <td class="text-center">
          <div class="form-check form-switch d-inline-block mb-0">
            <input class="form-check-input" type="checkbox" ${g.activo ? 'checked' : ''} onchange="toggleActivoGrupo(${g.id}, this.checked)">
          </div>
        </td>
        <td class="text-center" style="white-space:nowrap">
          <button class="btn btn-xs btn-outline-primary me-1" title="Editar" onclick="editarGrupo(${g.id})"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-xs btn-outline-secondary" title="Eliminar" onclick="eliminarGrupo(${g.id})"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  if (!document.getElementById('gr-id').value) renderMiembrosGrupo(miembrosGrupoSeleccionados());
}

function resetFormGrupo() {
  document.getElementById('form-grupo').reset();
  document.getElementById('gr-id').value = '';
  document.querySelector('#gr-btn span').textContent = 'Crear grupo';
  document.querySelector('#gr-btn i').className = 'bi bi-plus-lg me-1';
  document.getElementById('gr-cancelar').classList.add('d-none');
  renderMiembrosGrupo([]);
}

function editarGrupo(id) {
  const g = grupos.find(x => x.id === id);
  if (!g) return;
  document.getElementById('gr-id').value = id;
  document.getElementById('gr-nombre').value = g.nombre;
  renderMiembrosGrupo(g.operario_ids);
  document.querySelector('#gr-btn span').textContent = 'Guardar grupo';
  document.querySelector('#gr-btn i').className = 'bi bi-check-lg me-1';
  document.getElementById('gr-cancelar').classList.remove('d-none');
  document.getElementById('form-grupo').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('gr-nombre').focus();
}

async function guardarGrupo() {
  const id = document.getElementById('gr-id').value;
  const nombre = document.getElementById('gr-nombre').value.trim();
  const operario_ids = miembrosGrupoSeleccionados();
  if (!nombre) { toast('Poné un nombre al grupo', 'warning'); document.getElementById('gr-nombre').focus(); return; }
  if (operario_ids.length === 0) { toast('Elegí al menos un integrante', 'warning'); return; }
  const actual = id ? grupos.find(g => g.id === parseInt(id)) : null;
  try {
    const data = { nombre, operario_ids, activo: actual ? actual.activo : true };
    if (id) await apiPut(`${API}/grupos/${id}`, data);
    else    await apiPost(`${API}/grupos`, data);
    toast(`Grupo ${id ? 'actualizado' : 'creado'}`);
    await cargarConfiguracion();
    resetFormGrupo();
    refrescarFormularioCarga();
  } catch (err) {
    toast((err.errores || [err.error || err.message]).join(' · '), 'danger');
  }
}

async function toggleActivoGrupo(id, activo) {
  const g = grupos.find(x => x.id === id);
  if (!g) return;
  try {
    await apiPut(`${API}/grupos/${id}`, { nombre: g.nombre, operario_ids: g.operario_ids, activo });
    toast(`Grupo ${activo ? 'activado' : 'desactivado'}`, activo ? 'success' : 'secondary');
    await cargarConfiguracion();
    refrescarFormularioCarga();
  } catch (err) {
    toast((err.errores || [err.error || err.message]).join(' · '), 'danger');
  }
}

function eliminarGrupo(id) {
  const g = grupos.find(x => x.id === id);
  if (!g) return;
  pedirConfirmacion(`¿Eliminar el grupo <strong>${esc(g.nombre)}</strong>? Los operarios no se borran.`, async () => {
    try {
      await apiDelete(`${API}/grupos/${id}`);
      toast('Grupo eliminado', 'danger');
      if (document.getElementById('gr-id').value === String(id)) resetFormGrupo();
      await cargarConfiguracion();
      refrescarFormularioCarga();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
}

document.getElementById('form-grupo').addEventListener('submit', e => { e.preventDefault(); guardarGrupo(); });
document.getElementById('gr-cancelar').addEventListener('click', resetFormGrupo);
document.getElementById('gr-miembros').addEventListener('change', actualizarContadorGrupo);

// ─────────────────────────────────────────────
// CONFIGURACIÓN – IMPORTAR OPERARIOS DESDE EXCEL
// Columnas esperadas (en cualquier orden): Nombre, Apellido, DNI
// ─────────────────────────────────────────────
const modalImportar = new bootstrap.Modal(document.getElementById('modal-importar'));
let importacionPendiente = [];

function textoCelda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
  }
  return String(v);
}

const normalizarEncabezado = s => textoCelda(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function leerExcelOperarios(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas');

  // Buscar la fila de encabezados en las primeras 15 filas
  let filaEnc = null, col = {};
  for (let r = 1; r <= Math.min(15, ws.rowCount) && !filaEnc; r++) {
    const c = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, n) => {
      const t = normalizarEncabezado(cell.value);
      if (t === 'nombre' || t === 'nombres')        c.nombre = n;
      if (t === 'apellido' || t === 'apellidos')    c.apellido = n;
      if (t === 'dni' || t === 'documento' || t === 'nro dni' || t === 'n° dni') c.dni = n;
    });
    if (c.nombre && c.apellido) { filaEnc = r; col = c; }
  }
  if (!filaEnc) throw new Error('No encontré las columnas "Nombre" y "Apellido". Usá la planilla modelo.');

  const filas = [];
  for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Las celdas combinadas repiten el valor de la celda principal: se ignoran
    const valor = n => { const c = row.getCell(n); return c.isMerged && c.master.address !== c.address ? '' : c.value; };
    const limpiar = v => textoCelda(v).trim().replace(/\s+/g, ' ');
    const nombre   = limpiar(valor(col.nombre));
    const apellido = limpiar(valor(col.apellido));
    const dniTxt   = col.dni ? textoCelda(valor(col.dni)) : '';
    const dni      = dniTxt.replace(/\D/g, '');
    if (!nombre && !apellido && !dni) continue; // fila vacía (o celda combinada del encabezado)
    filas.push({ fila: r, nombre, apellido, dni });
  }
  return filas;
}

function analizarImportacion(filas) {
  const porDni = Object.fromEntries(operarios.filter(o => o.dni).map(o => [o.dni, o]));
  const porNombre = Object.fromEntries(operarios.map(o => [`${o.nombre}|${o.apellido}`.toLowerCase(), o]));
  const vistosDni = new Set();
  return filas.map(f => {
    if (!f.nombre || !f.apellido) return { ...f, estado: 'error', detalle: 'Falta nombre o apellido' };
    if (f.dni && (f.dni.length < 7 || f.dni.length > 9)) return { ...f, estado: 'error', detalle: 'DNI inválido' };
    if (f.dni && vistosDni.has(f.dni)) return { ...f, estado: 'error', detalle: 'DNI repetido en el archivo' };
    if (f.dni) vistosDni.add(f.dni);
    const ex = (f.dni && porDni[f.dni]) || porNombre[`${f.nombre}|${f.apellido}`.toLowerCase()];
    if (!ex) return { ...f, estado: 'nuevo', detalle: 'Se agrega' };
    const cambia = ex.nombre !== f.nombre || ex.apellido !== f.apellido || (f.dni && ex.dni !== f.dni);
    return cambia
      ? { ...f, estado: 'actualiza', detalle: `Actualiza a ${esc(nombreOperarioLista(ex))}${ex.dni ? '' : ' (agrega DNI)'}` }
      : { ...f, estado: 'igual', detalle: 'Ya está cargado' };
  });
}

document.getElementById('op-import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!window.ExcelJS) { toast('No se pudo cargar la librería de Excel. Revisá la conexión a internet.', 'danger'); return; }
  try {
    await cargarMaestros();
    const filas = analizarImportacion(await leerExcelOperarios(file));
    if (filas.length === 0) { toast('El archivo no tiene operarios', 'warning'); return; }
    importacionPendiente = filas.filter(f => f.estado === 'nuevo' || f.estado === 'actualiza');

    const cuenta = est => filas.filter(f => f.estado === est).length;
    const badge = { nuevo: 'success', actualiza: 'primary', igual: 'secondary', error: 'danger' };
    const etiqueta = { nuevo: 'Nuevo', actualiza: 'Actualiza', igual: 'Sin cambios', error: 'Error' };
    document.getElementById('importar-body').innerHTML = `
      <p class="mb-2 small text-muted"><i class="bi bi-file-earmark-excel me-1"></i>${esc(file.name)} · ${filas.length} fila${filas.length === 1 ? '' : 's'}</p>
      <div class="d-flex flex-wrap gap-2 mb-3">
        <span class="badge text-bg-success">${cuenta('nuevo')} nuevos</span>
        <span class="badge text-bg-primary">${cuenta('actualiza')} a actualizar</span>
        <span class="badge text-bg-secondary">${cuenta('igual')} sin cambios</span>
        ${cuenta('error') ? `<span class="badge text-bg-danger">${cuenta('error')} con error (no se importan)</span>` : ''}
      </div>
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-0">
          <thead class="table-light"><tr><th>Fila</th><th>Apellido</th><th>Nombre</th><th>DNI</th><th>Estado</th></tr></thead>
          <tbody>
            ${filas.map(f => `
              <tr class="${f.estado === 'error' ? 'table-danger' : ''}">
                <td class="text-muted">${f.fila}</td>
                <td>${esc(f.apellido) || '—'}</td>
                <td>${esc(f.nombre) || '—'}</td>
                <td>${f.dni ? Number(f.dni).toLocaleString('es-AR') : '—'}</td>
                <td><span class="badge text-bg-${badge[f.estado]}">${etiqueta[f.estado]}</span>
                    ${f.estado !== 'nuevo' && f.estado !== 'igual' ? `<span class="small text-muted ms-1">${f.detalle}</span>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    const btn = document.getElementById('btn-confirmar-importar');
    btn.disabled = importacionPendiente.length === 0;
    btn.querySelector('span').textContent = importacionPendiente.length
      ? `Importar ${importacionPendiente.length} operario${importacionPendiente.length === 1 ? '' : 's'}`
      : 'Nada para importar';
    modalImportar.show();
  } catch (err) {
    toast('No se pudo leer el archivo: ' + err.message, 'danger');
  }
});

document.getElementById('btn-confirmar-importar').addEventListener('click', async () => {
  if (importacionPendiente.length === 0) return;
  const btn = document.getElementById('btn-confirmar-importar');
  btn.disabled = true;
  try {
    const r = await apiPost(`${API}/operarios/importar`, {
      operarios: importacionPendiente.map(({ fila, nombre, apellido, dni }) => ({ fila, nombre, apellido, dni })),
    });
    modalImportar.hide();
    const partes = [];
    if (r.creados)      partes.push(`${r.creados} agregados`);
    if (r.actualizados) partes.push(`${r.actualizados} actualizados`);
    toast(`Importación lista: ${partes.join(', ') || 'sin cambios'}${r.errores.length ? ` · ${r.errores.length} con error` : ''}`);
    await cargarConfiguracion();
    refrescarFormularioCarga();
  } catch (err) {
    toast((err.errores || [err.error || err.message]).join(' · '), 'danger');
  } finally {
    btn.disabled = false;
  }
});

async function descargarModeloOperarios() {
  if (!window.ExcelJS) { toast('No se pudo cargar la librería de Excel. Revisá la conexión a internet.', 'danger'); return; }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Operarios');
  ws.columns = [
    { header: 'Nombre',   key: 'nombre',   width: 26 },
    { header: 'Apellido', key: 'apellido', width: 26 },
    { header: 'DNI',      key: 'dni',      width: 14 },
  ];
  ws.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF198754' } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Si ya hay operarios, el modelo sale con ellos (sirve para corregir y volver a importar)
  operarios.filter(o => o.activo).forEach(o => ws.addRow({ nombre: o.nombre, apellido: o.apellido, dni: o.dni ? Number(o.dni) : '' }));
  if (operarios.length === 0) ws.addRow({ nombre: 'Juan Carlos', apellido: 'Pérez', dni: 30123456 });
  const buffer = await wb.xlsx.writeBuffer();
  descargarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'modelo_operarios.xlsx');
}

document.getElementById('form-operario').addEventListener('submit', e => { e.preventDefault(); guardarABM('operarios'); });
document.getElementById('form-motivo').addEventListener('submit',   e => { e.preventDefault(); guardarABM('motivos'); });
document.getElementById('op-cancelar').addEventListener('click', () => resetFormABM('operarios'));
document.getElementById('mo-cancelar').addEventListener('click', () => resetFormABM('motivos'));

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
  listadoActual = null;
  document.querySelectorAll('.btn-export-listado').forEach(b => { b.disabled = true; });
  tbody.innerHTML = '<tr><td colspan="14" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando…</td></tr>';

  try {
    const res  = await apiGet(`${API}/produccion${qs}`);
    const rows = res.data;
    listadoActual = { rows, desde, hasta, turno };
    document.querySelectorAll('.btn-export-listado').forEach(b => { b.disabled = rows.length === 0; });

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" class="text-center py-4 text-muted">No hay registros para mostrar.</td></tr>';
      document.getElementById('listado-info').textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      return `
      <tr>
        <td>${fmtFecha(r.fecha)}</td>
        <td><span class="badge bg-secondary">${r.turno}</span></td>
        <td class="text-end">${fmt(r.horas_totales)}</td>
        <td class="text-end text-success fw-semibold">${fmt(r.horas_produccion)}</td>
        <td class="text-end">${fmt(r.horas_parados)}</td>
        <td class="text-end">
          <span class="badge bg-${r.pct_horas_activas >= 75 ? 'success' : r.pct_horas_activas >= 50 ? 'warning text-dark' : 'danger'}">
            ${fmt(r.pct_horas_activas)}%
          </span>
        </td>
        <td class="text-end">${r.botellas_producidas.toLocaleString('es-AR')}</td>
        <td class="text-end">${(r.bidones_5L  || 0).toLocaleString('es-AR')}</td>
        <td class="text-end">${(r.bidones_10L || 0).toLocaleString('es-AR')}</td>
        <td class="text-end">${fmt(r.prom_botellas_hora,    0)}</td>
        <td class="text-end">${fmt(r.prom_bidones_5L_hora,  1)}</td>
        <td class="text-end">${fmt(r.prom_bidones_10L_hora, 1)}</td>
        <td class="paradas-resumen">${r.cantidad_paradas
          ? r.paradas.map(p => badgeMotivo(p.motivo_id, p.motivo)).join(' ') +
            `<div class="small text-muted">${r.cantidad_paradas} · ${fmtMin(r.minutos_parada)}</div>`
          : '<span class="text-muted small">—</span>'}</td>
        <td class="text-center" style="white-space:nowrap">
          <button class="btn btn-xs btn-outline-info me-1" title="Ver detalle"
            onclick='verDetalle(${r.id}, JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(r))}")))'>
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-xs btn-outline-success me-1" title="Descargar detalle en Excel"
            onclick='descargarExcelTurno(JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(r))}")))'>
            <i class="bi bi-file-earmark-excel"></i>
          </button>
          <button class="btn btn-xs btn-outline-danger me-1" title="Descargar detalle en PDF"
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

// Actualizar encabezado de la tabla del listado
document.querySelector('#tabla-listado thead tr').innerHTML = `
  <th>Fecha</th>
  <th>Turno</th>
  <th class="text-end">Hs. Tot.</th>
  <th class="text-end">Hs. Prod.</th>
  <th class="text-end">Hs. Parados</th>
  <th class="text-end">% Activas</th>
  <th class="text-end">Botellas</th>
  <th class="text-end">Bid 5L</th>
  <th class="text-end">Bid 10L</th>
  <th class="text-end">Bot/h</th>
  <th class="text-end">5L/h</th>
  <th class="text-end">10L/h</th>
  <th>Paradas</th>
  <th class="text-center">Acciones</th>
`;

// ─────────────────────────────────────────────
// LISTADO – DESCARGA DEL DETALLE (Excel / PDF)
// Exporta los turnos que se están viendo (respeta los filtros aplicados)
// ─────────────────────────────────────────────
let listadoActual = null; // { rows, desde, hasta, turno }

function textoOperarios(r) {
  return (r.operarios || []).map(o => o.nombre).join(', ');
}

function textoParadas(r) {
  return (r.paradas || [])
    .map(p => `${p.motivo}${p.detalle ? ' - ' + p.detalle : ''} - ${p.minutos} min`)
    .join('\n');
}

function descripcionFiltros(f) {
  const partes = [];
  if (f.desde && f.desde === f.hasta) partes.push(`Fecha ${fmtFecha(f.desde)}`);
  else if (f.desde && f.hasta) partes.push(`Del ${fmtFecha(f.desde)} al ${fmtFecha(f.hasta)}`);
  else if (f.desde)       partes.push(`Desde el ${fmtFecha(f.desde)}`);
  else if (f.hasta)       partes.push(`Hasta el ${fmtFecha(f.hasta)}`);
  else                    partes.push('Todas las fechas');
  partes.push(f.turno ? `Turno ${f.turno}` : 'Todos los turnos');
  return partes.join(' · ');
}

function nombreArchivoListado(f, ext) {
  const rango = [...new Set([f.desde, f.hasta].filter(Boolean))].map(d => d.replace(/-/g, '')).join('_') || hoy().replace(/-/g, '');
  const turno = f.turno ? '_' + f.turno.normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  return `KPI_Detalle_Turnos_${rango}${turno}.${ext}`;
}

// Paradas de los turnos listados agrupadas por motivo (mayor tiempo primero)
function resumenParadasListado(rows) {
  const map = {};
  rows.forEach(r => (r.paradas || []).forEach(p => {
    map[p.motivo] = map[p.motivo] || { motivo: p.motivo, cantidad: 0, minutos: 0 };
    map[p.motivo].cantidad += 1;
    map[p.motivo].minutos  += p.minutos;
  }));
  return Object.values(map).sort((x, y) => y.minutos - x.minutos);
}

function totalesListado(rows) {
  const t = rows.reduce((a, r) => ({
    ht: a.ht + r.horas_totales, hp: a.hp + r.horas_produccion, hpar: a.hpar + r.horas_parados,
    bot: a.bot + r.botellas_producidas, b5: a.b5 + (r.bidones_5L || 0), b10: a.b10 + (r.bidones_10L || 0),
    cantP: a.cantP + r.cantidad_paradas, minP: a.minP + r.minutos_parada,
  }), { ht: 0, hp: 0, hpar: 0, bot: 0, b5: 0, b10: 0, cantP: 0, minP: 0 });
  t.pctActivas = t.ht > 0 ? t.hp / t.ht * 100 : 0;
  return t;
}

// ── EXCEL ──────────────────────────────────────
async function descargarExcelListado(filtro = null) {
  const f = filtro || listadoActual;
  if (!f || f.rows.length === 0) { toast('No hay registros para exportar', 'warning'); return; }
  if (!window.ExcelJS) { toast('No se pudo cargar la librería de Excel. Revisá la conexión a internet.', 'danger'); return; }

  const rows = f.rows;
  const AZUL = 'FF0056B3', GRIS = 'FFF2F2F2', AMARILLO = 'FFFFF3CD';
  const borde = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                  left: { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
  const aFecha = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'KPI Producción';
  wb.created = new Date();

  // Encabezado común de cada hoja: título, filtros y fila de títulos de columnas
  function prepararHoja(ws, titulo, columnas) {
    ws.columns = columnas.map(c => ({ key: c.key, width: c.width, style: c.style || {} }));
    ws.mergeCells(1, 1, 1, columnas.length);
    ws.getCell(1, 1).value = titulo;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } };
    ws.mergeCells(2, 1, 2, columnas.length);
    ws.getCell(2, 1).value = `${descripcionFiltros(f)}  ·  Generado el ${new Date().toLocaleString('es-AR')}`;
    ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF6C757D' } };
    const head = ws.getRow(4);
    columnas.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
    head.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = borde;
    });
    head.height = 30;
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                     margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '4:4';
    return 5; // primera fila de datos
  }

  function estiloFilas(ws, desde, hasta, nCols) {
    for (let i = desde; i <= hasta; i++) {
      const row = ws.getRow(i);
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        cell.border = borde;
        cell.alignment = { ...(cell.alignment || {}), vertical: 'top', wrapText: true };
      }
    }
  }

  function filaTotal(ws, nroFila, nCols) {
    const row = ws.getRow(nroFila);
    for (let c = 1; c <= nCols; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
      cell.border = borde;
    }
  }

  // ── Hoja 1: Turnos (una fila por turno, con todo el detalle)
  const wsT = wb.addWorksheet('Turnos');
  const colsT = [
    { header: 'Fecha',          key: 'fecha',   width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Turno',          key: 'turno',   width: 9 },
    { header: 'Operarios',      key: 'ops',     width: 28 },
    { header: 'Hs. Totales',    key: 'ht',      width: 9,  style: { numFmt: '0.00' } },
    { header: 'Hs. Producción', key: 'hp',      width: 11, style: { numFmt: '0.00' } },
    { header: 'Hs. Parados',    key: 'hpar',    width: 9,  style: { numFmt: '0.00' } },
    { header: '% Activas',      key: 'pct',     width: 9,  style: { numFmt: '0.0%' } },
    { header: 'Hs. Bidones',    key: 'hbid',    width: 9,  style: { numFmt: '0.00' } },
    { header: 'Hs. Botellas',   key: 'hbot',    width: 9,  style: { numFmt: '0.00' } },
    { header: 'Botellas',       key: 'bot',     width: 10, style: { numFmt: '#,##0' } },
    { header: 'Bidones 5L',     key: 'b5',      width: 9,  style: { numFmt: '#,##0' } },
    { header: 'Bidones 10L',    key: 'b10',     width: 9,  style: { numFmt: '#,##0' } },
    { header: 'Bot/h',          key: 'both',    width: 8,  style: { numFmt: '#,##0' } },
    { header: '5L/h',           key: 'b5h',     width: 7,  style: { numFmt: '0.0' } },
    { header: '10L/h',          key: 'b10h',    width: 7,  style: { numFmt: '0.0' } },
    { header: 'Cant. Paradas',  key: 'cantP',   width: 9 },
    { header: 'Min. Parada',    key: 'minP',    width: 9,  style: { numFmt: '#,##0' } },
    { header: 'Paradas (motivo - detalle - tiempo)', key: 'paradas', width: 42 },
    { header: 'Observaciones',  key: 'obs',     width: 45 },
  ];
  let fila = prepararHoja(wsT, 'Detalle de turnos de producción', colsT);
  const primeraT = fila;
  rows.forEach(r => {
    wsT.getRow(fila++).values = {
      fecha: aFecha(r.fecha), turno: r.turno, ops: textoOperarios(r),
      ht: r.horas_totales, hp: r.horas_produccion, hpar: r.horas_parados, pct: r.pct_horas_activas / 100,
      hbid: r.horas_bidones, hbot: r.horas_botellas,
      bot: r.botellas_producidas, b5: r.bidones_5L || 0, b10: r.bidones_10L || 0,
      both: r.prom_botellas_hora, b5h: r.prom_bidones_5L_hora, b10h: r.prom_bidones_10L_hora,
      cantP: r.cantidad_paradas, minP: r.minutos_parada,
      paradas: textoParadas(r), obs: r.observaciones || '',
    };
  });
  const ultimaT = fila - 1;
  estiloFilas(wsT, primeraT, ultimaT, colsT.length);

  // Totales con fórmulas (se recalculan si la gerencia filtra o edita)
  const t = totalesListado(rows);
  const rng = l => `${l}${primeraT}:${l}${ultimaT}`;
  const sum = (l, res) => ({ formula: `SUM(${rng(l)})`, result: res });
  const rowTot = wsT.getRow(fila);
  rowTot.values = {
    fecha: 'TOTALES', ops: `${rows.length} turno${rows.length === 1 ? '' : 's'}`,
    ht: sum('D', t.ht), hp: sum('E', t.hp), hpar: sum('F', t.hpar),
    pct: { formula: `IF(D${fila}>0,E${fila}/D${fila},0)`, result: t.pctActivas / 100 },
    bot: sum('J', t.bot), b5: sum('K', t.b5), b10: sum('L', t.b10),
    both: { formula: `IF(E${fila}>0,J${fila}/E${fila},0)`, result: t.hp > 0 ? t.bot / t.hp : 0 },
    b5h:  { formula: `IF(E${fila}>0,K${fila}/E${fila},0)`, result: t.hp > 0 ? t.b5 / t.hp : 0 },
    b10h: { formula: `IF(E${fila}>0,L${fila}/E${fila},0)`, result: t.hp > 0 ? t.b10 / t.hp : 0 },
    cantP: sum('P', t.cantP), minP: sum('Q', t.minP),
  };
  filaTotal(wsT, fila, colsT.length);
  wsT.autoFilter = { from: { row: 4, column: 1 }, to: { row: ultimaT, column: colsT.length } };

  // ── Hoja 2: Paradas (una fila por parada)
  const wsP = wb.addWorksheet('Paradas');
  const colsP = [
    { header: 'Fecha',   key: 'fecha',   width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Turno',   key: 'turno',   width: 9 },
    { header: 'Motivo',  key: 'motivo',  width: 22 },
    { header: 'Detalle', key: 'detalle', width: 40 },
    { header: 'Minutos', key: 'min',     width: 10, style: { numFmt: '#,##0' } },
    { header: 'Horas',   key: 'hs',      width: 9,  style: { numFmt: '0.00' } },
  ];
  fila = prepararHoja(wsP, 'Paradas por turno', colsP);
  const primeraP = fila;
  rows.forEach(r => (r.paradas || []).forEach(p => {
    wsP.getRow(fila).values = {
      fecha: aFecha(r.fecha), turno: r.turno, motivo: p.motivo, detalle: p.detalle || '',
      min: p.minutos, hs: { formula: `E${fila}/60`, result: p.minutos / 60 },
    };
    fila++;
  }));
  const ultimaP = fila - 1;
  if (ultimaP >= primeraP) {
    estiloFilas(wsP, primeraP, ultimaP, colsP.length);
    wsP.getRow(fila).values = {
      fecha: 'TOTAL', min: { formula: `SUM(E${primeraP}:E${ultimaP})`, result: t.minP },
      hs: { formula: `E${fila}/60`, result: t.minP / 60 },
    };
    filaTotal(wsP, fila, colsP.length);
    wsP.autoFilter = { from: { row: 4, column: 1 }, to: { row: ultimaP, column: colsP.length } };
  } else {
    wsP.getCell(primeraP, 1).value = 'Sin paradas en los turnos listados';
  }

  // ── Hoja 3: Resumen de paradas por motivo
  const wsR = wb.addWorksheet('Resumen paradas');
  const colsR = [
    { header: 'Motivo',               key: 'motivo', width: 26 },
    { header: 'Cant. paradas',        key: 'cant',   width: 12 },
    { header: 'Minutos',              key: 'min',    width: 11, style: { numFmt: '#,##0' } },
    { header: 'Horas',                key: 'hs',     width: 9,  style: { numFmt: '0.00' } },
    { header: '% del tiempo parado',  key: 'pct',    width: 14, style: { numFmt: '0.0%' } },
  ];
  fila = prepararHoja(wsR, 'Resumen de paradas por motivo', colsR);
  const primeraR = fila;
  const resumen = resumenParadasListado(rows);
  const filaTotR = primeraR + resumen.length;
  resumen.forEach(p => {
    wsR.getRow(fila).values = {
      motivo: p.motivo, cant: p.cantidad, min: p.minutos,
      hs:  { formula: `C${fila}/60`, result: p.minutos / 60 },
      pct: { formula: `IF($C$${filaTotR}>0,C${fila}/$C$${filaTotR},0)`, result: t.minP ? p.minutos / t.minP : 0 },
    };
    fila++;
  });
  if (resumen.length) {
    estiloFilas(wsR, primeraR, fila - 1, colsR.length);
    wsR.getRow(fila).values = {
      motivo: 'TOTAL',
      cant: { formula: `SUM(B${primeraR}:B${fila - 1})`, result: t.cantP },
      min:  { formula: `SUM(C${primeraR}:C${fila - 1})`, result: t.minP },
      hs:   { formula: `C${fila}/60`, result: t.minP / 60 },
      pct:  { formula: `IF(C${fila}>0,1,0)`, result: t.minP ? 1 : 0 },
    };
    filaTotal(wsR, fila, colsR.length);
  } else {
    wsR.getCell(primeraR, 1).value = 'Sin paradas en los turnos listados';
  }

  const buffer = await wb.xlsx.writeBuffer();
  descargarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    nombreArchivoListado(f, 'xlsx'));
  toast('Excel descargado correctamente');
}

// Excel de un solo turno (botón de cada fila del listado)
function descargarExcelTurno(r) {
  descargarExcelListado({ rows: [r], desde: r.fecha, hasta: r.fecha, turno: r.turno });
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── PDF ────────────────────────────────────────
function descargarPDFListado() {
  const f = listadoActual;
  if (!f || f.rows.length === 0) { toast('No hay registros para exportar', 'warning'); return; }

  const rows = f.rows;
  const t = totalesListado(rows);
  const doc = nuevoPDF('l');
  let y = pdfHeader(doc, 'Detalle de Turnos de Producción', descripcionFiltros(f));

  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Turno', 'Operarios', 'Hs. Tot.', 'Hs. Prod.', 'Hs. Par.', '% Act.', 'Botellas', 'Bid 5L', 'Bid 10L', 'Paradas (motivo - detalle - tiempo)', 'Observaciones']],
    body: [
      ...rows.map(r => [
        fmtFecha(r.fecha), r.turno, textoOperarios(r) || '—',
        fmt(r.horas_totales, 2), fmt(r.horas_produccion, 2), fmt(r.horas_parados, 2), `${fmt(r.pct_horas_activas)}%`,
        r.botellas_producidas.toLocaleString('es-AR'), (r.bidones_5L || 0).toLocaleString('es-AR'), (r.bidones_10L || 0).toLocaleString('es-AR'),
        r.cantidad_paradas ? `${textoParadas(r)}\nTotal: ${fmtMin(r.minutos_parada)}` : 'Sin paradas',
        r.observaciones || '—',
      ]),
      [
        'TOTALES', `${rows.length}`, '',
        fmt(t.ht, 2), fmt(t.hp, 2), fmt(t.hpar, 2), `${fmt(t.pctActivas)}%`,
        t.bot.toLocaleString('es-AR'), t.b5.toLocaleString('es-AR'), t.b10.toLocaleString('es-AR'),
        `${t.cantP} parada${t.cantP === 1 ? '' : 's'} · ${fmtMin(t.minP)}`, '',
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 7.5, valign: 'middle' },
    bodyStyles: { fontSize: 7.5, valign: 'top', cellPadding: 1.5 },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: {
      0: { cellWidth: 17 }, 1: { cellWidth: 14 }, 2: { cellWidth: 32 },
      3: { cellWidth: 12, halign: 'right' }, 4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 12, halign: 'right' },
      6: { cellWidth: 12, halign: 'right' }, 7: { cellWidth: 16, halign: 'right' }, 8: { cellWidth: 13, halign: 'right' },
      9: { cellWidth: 13, halign: 'right' }, 10: { cellWidth: 62 }, 11: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === rows.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 235, 255];
      }
    },
    margin: { left: 14, right: 14, bottom: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Resumen de paradas por motivo
  const resumen = resumenParadasListado(rows);
  if (resumen.length) {
    if (y > 160) { doc.addPage(); y = 20; }
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(255, 245, 220); doc.rect(14, y, 269, 6, 'F');
    doc.text('RESUMEN DE PARADAS POR MOTIVO', 16, y + 4.5);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Motivo', 'Cant. paradas', 'Minutos', 'Horas', '% del tiempo parado']],
      body: [
        ...resumen.map(p => [p.motivo, p.cantidad, p.minutos.toLocaleString('es-AR'), fmt(p.minutos / 60, 2), `${(p.minutos / t.minP * 100).toFixed(1)}%`]),
        ['TOTAL', t.cantP, t.minP.toLocaleString('es-AR'), fmt(t.minP / 60, 2), '100%'],
      ],
      theme: 'grid',
      tableWidth: 160,
      headStyles: { fillColor: [200, 140, 0], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === resumen.length) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 240, 200]; }
      },
      margin: { left: 14, right: 14 },
    });
  }

  pdfFooter(doc);
  doc.save(nombreArchivoListado(f, 'pdf'));
  toast('PDF descargado correctamente');
}

function limpiarFiltrosListado() {
  document.getElementById('lst-desde').value = '';
  document.getElementById('lst-hasta').value = '';
  document.getElementById('lst-turno').value = '';
  cargarListado();
}

// ─────────────────────────────────────────────
// ELIMINAR
// ─────────────────────────────────────────────
let _accionConfirmada = null;

function pedirConfirmacion(mensajeHTML, accion) {
  document.getElementById('modal-eliminar-msg').innerHTML = mensajeHTML;
  _accionConfirmada = accion;
  modalEliminar.show();
}

function confirmarEliminar(id) {
  pedirConfirmacion('¿Confirmás que querés eliminar este registro? Esta acción no se puede deshacer.', async () => {
    try {
      await apiDelete(`${API}/produccion/${id}`);
      toast('Registro eliminado', 'danger');
      cargarListado();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
}

document.getElementById('btn-confirmar-eliminar').addEventListener('click', async () => {
  const accion = _accionConfirmada;
  _accionConfirmada = null;
  modalEliminar.hide();
  if (accion) await accion();
});

// ─────────────────────────────────────────────
// REPORTE KPI MENSUAL
// ─────────────────────────────────────────────
// Mismo orden que COLORES_MOTIVO (badges) para que cada motivo tenga siempre el mismo color
const PALETA_PARADAS = ['rgba(255,193,7,0.85)', 'rgba(13,202,240,0.85)', 'rgba(220,53,69,0.85)', 'rgba(108,117,125,0.85)',
                        'rgba(25,135,84,0.85)', 'rgba(13,110,253,0.85)', 'rgba(33,37,41,0.85)'];
const colorMotivoChart = id => PALETA_PARADAS[((parseInt(id) || 1) - 1) % PALETA_PARADAS.length];

// Agrupa las paradas de todos los meses por motivo → [{motivo, cantidad, minutos}] (mayor tiempo primero)
function resumenParadasPeriodo(datos) {
  const map = {};
  datos.forEach(d => (d.paradas || []).forEach(p => {
    map[p.motivo] = map[p.motivo] || { motivo_id: p.motivo_id, motivo: p.motivo, cantidad: 0, minutos: 0 };
    map[p.motivo].cantidad += p.cantidad;
    map[p.motivo].minutos  += p.minutos;
  }));
  return Object.values(map).sort((x, y) => y.minutos - x.minutos);
}

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
    const totBid5L    = datos.reduce((a, d) => a + d.bidones_5L,  0);
    const totBid10L   = datos.reduce((a, d) => a + d.bidones_10L, 0);
    const totBidones  = totBid5L + totBid10L;
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
            <div class="kpi-label">Total Bidones (5L + 10L)</div>
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
            <div class="card-header bg-white"><strong><i class="bi bi-pie-chart me-2 text-warning"></i>Tiempo de Parada por Motivo</strong></div>
            <div class="card-body d-flex align-items-center justify-content-center"><canvas id="chart-paradas" style="max-height:260px"></canvas></div>
          </div>
        </div>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-header bg-white"><strong><i class="bi bi-bar-chart me-2 text-success"></i>Producción Mensual (Botellas, Bidones 5L y 10L)</strong></div>
            <div class="card-body"><canvas id="chart-produccion"></canvas></div>
          </div>
        </div>
      </div>

      <!-- Tabla KPI -->
      <div class="card shadow-sm">
        <div class="card-header bg-white">
          <strong><i class="bi bi-table me-2 text-primary"></i>Tabla KPI Mensual</strong>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover table-sm mb-0 align-middle">
              <thead class="table-primary">
                <tr>
                  <th>Mes</th>
                  <th class="text-end">% Hs. Activas</th>
                  <th class="text-end">% Hs. Paradas</th>
                  <th class="text-end">Bot/hora</th>
                  <th class="text-end">5L/hora</th>
                  <th class="text-end">10L/hora</th>
                  <th class="text-end">Botellas</th>
                  <th class="text-end">Bid 5L</th>
                  <th class="text-end">Bid 10L</th>
                  <th class="text-end">Total Bid.</th>
                  <th class="text-end">Paradas</th>
                  <th class="text-end">Min. Parada</th>
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
                    <td class="text-end">${d.pct_horas_paradas}%</td>
                    <td class="text-end">${fmt(d.prom_botellas_hora,    0)}</td>
                    <td class="text-end">${fmt(d.prom_bidones_5L_hora,  1)}</td>
                    <td class="text-end">${fmt(d.prom_bidones_10L_hora, 1)}</td>
                    <td class="text-end">${d.botellas_producidas.toLocaleString('es-AR')}</td>
                    <td class="text-end">${d.bidones_5L.toLocaleString('es-AR')}</td>
                    <td class="text-end">${d.bidones_10L.toLocaleString('es-AR')}</td>
                    <td class="text-end fw-semibold">${d.total_bidones.toLocaleString('es-AR')}</td>
                    <td class="text-end">${d.cantidad_paradas}</td>
                    <td class="text-end">${d.minutos_paradas.toLocaleString('es-AR')}</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot class="table-light fw-bold">
                <tr>
                  <td>TOTALES</td>
                  <td class="text-end">${avgActivas}%</td>
                  <td class="text-end">${totHT > 0 ? fmt(datos.reduce((a,d)=>a+d.horas_parados,0)/totHT*100) : '—'}%</td>
                  <td class="text-end">${totHP > 0 ? fmt(totBotellas/totHP, 0) : '—'}</td>
                  <td class="text-end">${totHP > 0 ? fmt(totBid5L/totHP,   1) : '—'}</td>
                  <td class="text-end">${totHP > 0 ? fmt(totBid10L/totHP,  1) : '—'}</td>
                  <td class="text-end">${totBotellas.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totBid5L.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totBid10L.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totBidones.toLocaleString('es-AR')}</td>
                  <td class="text-end">${datos.reduce((a,d)=>a+d.cantidad_paradas,0)}</td>
                  <td class="text-end">${datos.reduce((a,d)=>a+d.minutos_paradas,0).toLocaleString('es-AR')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `;

    // Gráfico horas apilado (2 datasets: activas + paradas)
    chartHoras = new Chart(document.getElementById('chart-horas'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '% Hs. Activas', data: datos.map(d => d.pct_horas_activas), backgroundColor: 'rgba(40,167,69,0.8)' },
          { label: '% Hs. Paradas', data: datos.map(d => d.pct_horas_paradas), backgroundColor: 'rgba(220,53,69,0.8)' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { x: { stacked: true }, y: { stacked: true, max: 100, ticks: { callback: v => v + '%' } } }
      }
    });

    // Gráfico producción (botellas, bid5L, bid10L)
    chartProduccion = new Chart(document.getElementById('chart-produccion'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Botellas producidas', data: datos.map(d => d.botellas_producidas), backgroundColor: 'rgba(0,123,255,0.8)',   yAxisID: 'y'  },
          { label: 'Bidones 5L',          data: datos.map(d => d.bidones_5L),          backgroundColor: 'rgba(23,162,184,0.8)',  yAxisID: 'y2' },
          { label: 'Bidones 10L',         data: datos.map(d => d.bidones_10L),         backgroundColor: 'rgba(0,200,150,0.8)',   yAxisID: 'y2' },
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

    // Gráfico paradas (minutos por motivo)
    const resumenP = resumenParadasPeriodo(datos);
    const totalMin = resumenP.reduce((s, p) => s + p.minutos, 0);

    if (totalMin > 0) {
      chartParadas = new Chart(document.getElementById('chart-paradas'), {
        type: 'doughnut',
        data: {
          labels: resumenP.map(p => p.motivo),
          datasets: [{ data: resumenP.map(p => p.minutos), backgroundColor: resumenP.map(p => colorMotivoChart(p.motivo_id)), borderWidth: 2 }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: ctx => {
              const p = resumenP[ctx.dataIndex];
              return ` ${p.motivo}: ${fmtMin(p.minutos)} · ${p.cantidad} parada${p.cantidad === 1 ? '' : 's'} (${(p.minutos / totalMin * 100).toFixed(1)}%)`;
            } } }
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

  const totBotellas = datos.reduce((a, d) => a + d.botellas_producidas, 0);
  const totBid5L    = datos.reduce((a, d) => a + d.bidones_5L,  0);
  const totBid10L   = datos.reduce((a, d) => a + d.bidones_10L, 0);
  const totBidones  = totBid5L + totBid10L;
  const totHT       = datos.reduce((a, d) => a + d.horas_totales, 0);
  const totHP       = datos.reduce((a, d) => a + d.horas_produccion, 0);
  const totHPar     = datos.reduce((a, d) => a + d.horas_parados, 0);
  const avgActivas  = totHT > 0 ? (totHP / totHT * 100).toFixed(1) : 0;
  const totCantP    = datos.reduce((a, d) => a + d.cantidad_paradas, 0);
  const totMinP     = datos.reduce((a, d) => a + d.minutos_paradas, 0);

  // Tarjetas resumen
  doc.autoTable({
    startY: y,
    head: [['% Hs. Activas', 'Total Botellas', 'Total Bid 5L', 'Total Bid 10L', 'Total Bidones', 'Total Horas', 'Meses analizados']],
    body: [[
      `${avgActivas}%`,
      totBotellas.toLocaleString('es-AR'),
      totBid5L.toLocaleString('es-AR'),
      totBid10L.toLocaleString('es-AR'),
      totBidones.toLocaleString('es-AR'),
      `${fmt(totHT, 0)} hs`,
      datos.length,
    ]],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 10, fontStyle: 'bold', halign: 'center', fillColor: [240, 245, 255] },
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
    head: [['Mes', '% Activas', '% Paradas', 'Bot/h', '5L/h', '10L/h', 'Botellas', 'Bid 5L', 'Bid 10L', 'Total Bid.', 'Paradas', 'Min. Parada']],
    body: [
      ...datos.map(d => [
        mesLabel(d.mes),
        `${d.pct_horas_activas}%`,
        `${d.pct_horas_paradas}%`,
        fmt(d.prom_botellas_hora,    0),
        fmt(d.prom_bidones_5L_hora,  1),
        fmt(d.prom_bidones_10L_hora, 1),
        d.botellas_producidas.toLocaleString('es-AR'),
        d.bidones_5L.toLocaleString('es-AR'),
        d.bidones_10L.toLocaleString('es-AR'),
        d.total_bidones.toLocaleString('es-AR'),
        d.cantidad_paradas,
        d.minutos_paradas.toLocaleString('es-AR'),
      ]),
      // Fila de totales
      [
        'TOTALES',
        `${avgActivas}%`,
        `${totHT>0 ? fmt(totHPar/totHT*100) : '—'}%`,
        `${totHP>0 ? fmt(totBotellas/totHP, 0) : '—'}`,
        `${totHP>0 ? fmt(totBid5L/totHP,   1) : '—'}`,
        `${totHP>0 ? fmt(totBid10L/totHP,  1) : '—'}`,
        totBotellas.toLocaleString('es-AR'),
        totBid5L.toLocaleString('es-AR'),
        totBid10L.toLocaleString('es-AR'),
        totBidones.toLocaleString('es-AR'),
        totCantP, totMinP.toLocaleString('es-AR'),
      ]
    ],
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'},
      5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'},
      9:{halign:'right'}, 10:{halign:'right'}, 11:{halign:'right'},
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

  // Tabla de distribución de paradas por motivo
  const resumenP = resumenParadasPeriodo(datos);
  if (totMinP > 0) {
    if (y > 170) { doc.addPage(); y = 20; }
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(255, 245, 220); doc.rect(14, y, 269, 6, 'F');
    doc.text('DISTRIBUCIÓN DE PARADAS POR MOTIVO', 16, y + 4.5);
    y += 8;

    doc.autoTable({
      startY: y,
      head: [['Motivo de Parada', 'Cant. paradas', 'Minutos', 'Horas', '% del tiempo parado']],
      body: [
        ...resumenP.map(p => [p.motivo, p.cantidad, p.minutos.toLocaleString('es-AR'), fmt(p.minutos / 60, 2), `${(p.minutos / totMinP * 100).toFixed(1)}%`]),
        ['TOTAL', totCantP, totMinP.toLocaleString('es-AR'), fmt(totMinP / 60, 2), '100%'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [200, 140, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === resumenP.length) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 240, 200]; }
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
      const subBot  = registros.reduce((a, r) => a + r.botellas_producidas, 0);
      const subBid5 = registros.reduce((a, r) => a + r.bidones_5L, 0);
      const subBid10= registros.reduce((a, r) => a + r.bidones_10L, 0);
      registros.forEach(r => {
        const tot = (r.bidones_5L || 0) + (r.bidones_10L || 0);
        filas += `<tr>
          <td>${fmtFecha(r.fecha)}</td>
          <td><span class="badge bg-secondary">${r.turno}</span></td>
          <td class="text-end">${r.botellas_producidas.toLocaleString('es-AR')}</td>
          <td class="text-end">${(r.bidones_5L  || 0).toLocaleString('es-AR')}</td>
          <td class="text-end">${(r.bidones_10L || 0).toLocaleString('es-AR')}</td>
          <td class="text-end fw-semibold">${tot.toLocaleString('es-AR')}</td>
        </tr>`;
      });
      if (registros.length > 1) {
        filas += `<tr class="table-light">
          <td colspan="2" class="text-end fw-semibold small text-muted">Subtotal ${fmtFecha(fecha)}</td>
          <td class="text-end fw-semibold">${subBot.toLocaleString('es-AR')}</td>
          <td class="text-end fw-semibold">${subBid5.toLocaleString('es-AR')}</td>
          <td class="text-end fw-semibold">${subBid10.toLocaleString('es-AR')}</td>
          <td class="text-end fw-semibold">${(subBid5+subBid10).toLocaleString('es-AR')}</td>
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
            <div class="kpi-label">Total Botellas</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-info">
            <div class="kpi-value text-info">${totales.bidones_5L.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Bidones 5L</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-success">
            <div class="kpi-value text-success">${totales.bidones_10L.toLocaleString('es-AR')}</div>
            <div class="kpi-label">Total Bidones 10L</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="kpi-card border-secondary">
            <div class="kpi-value text-secondary">${datos.length}</div>
            <div class="kpi-label">Turnos Registrados</div>
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
                  <th class="text-end">Botellas</th>
                  <th class="text-end">Bidones 5L</th>
                  <th class="text-end">Bidones 10L</th>
                  <th class="text-end">Total Bidones</th>
                </tr>
              </thead>
              <tbody>${filas}</tbody>
              <tfoot class="table-dark fw-bold">
                <tr>
                  <td colspan="2">TOTAL ACUMULADO</td>
                  <td class="text-end">${totales.botellas.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totales.bidones_5L.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totales.bidones_10L.toLocaleString('es-AR')}</td>
                  <td class="text-end">${totales.bidones_total.toLocaleString('es-AR')}</td>
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

  const porFecha = {};
  datos.forEach(r => { if (!porFecha[r.fecha]) porFecha[r.fecha] = []; porFecha[r.fecha].push(r); });

  // Resumen
  doc.autoTable({
    startY: y,
    head: [['Total Botellas', 'Total Bid 5L', 'Total Bid 10L', 'Total Bidones', 'Turnos', 'Días']],
    body: [[
      totales.botellas.toLocaleString('es-AR'),
      totales.bidones_5L.toLocaleString('es-AR'),
      totales.bidones_10L.toLocaleString('es-AR'),
      totales.bidones_total.toLocaleString('es-AR'),
      datos.length,
      Object.keys(porFecha).length,
    ]],
    theme: 'grid',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 10, fontStyle: 'bold', halign: 'center', fillColor: [240, 245, 255] },
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
      const tot = (r.bidones_5L || 0) + (r.bidones_10L || 0);
      bodyRows.push([
        fmtFecha(r.fecha), r.turno,
        r.botellas_producidas.toLocaleString('es-AR'),
        (r.bidones_5L  || 0).toLocaleString('es-AR'),
        (r.bidones_10L || 0).toLocaleString('es-AR'),
        tot.toLocaleString('es-AR'),
      ]);
    });
    if (registros.length > 1) {
      const subBot  = registros.reduce((a, r) => a + r.botellas_producidas, 0);
      const subBid5 = registros.reduce((a, r) => a + r.bidones_5L,  0);
      const subBid10= registros.reduce((a, r) => a + r.bidones_10L, 0);
      bodyRows.push([
        `Subtotal ${fmtFecha(fecha)}`, '',
        subBot.toLocaleString('es-AR'),
        subBid5.toLocaleString('es-AR'),
        subBid10.toLocaleString('es-AR'),
        (subBid5+subBid10).toLocaleString('es-AR'),
      ]);
    }
  }
  // Fila total
  bodyRows.push([
    'TOTAL ACUMULADO', '',
    totales.botellas.toLocaleString('es-AR'),
    totales.bidones_5L.toLocaleString('es-AR'),
    totales.bidones_10L.toLocaleString('es-AR'),
    totales.bidones_total.toLocaleString('es-AR'),
  ]);

  const subtotalIdxs = new Set();
  let idx = 0;
  for (const [, registros] of Object.entries(porFecha)) {
    idx += registros.length;
    if (registros.length > 1) subtotalIdxs.add(idx++);
  }

  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Turno', 'Botellas', 'Bidones 5L', 'Bidones 10L', 'Total Bidones']],
    body: bodyRows,
    theme: 'striped',
    headStyles: { fillColor: [0, 86, 179], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
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
  cargarMaestros().then(() => renderOperariosForm([]));
});
