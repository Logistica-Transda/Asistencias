/* ============================================================
   TABLERO DEL TALLER — Asistencias en Ruta TRANSDA
   Activas en tiempo real · Indicadores · Historial · Registro manual
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const U = AR.util;
  AR.sesion.iniciar('taller');

  let rol = '';                   // 'taller' | 'consulta'
  let lista = [];                 // asistencias del periodo + todas las activas
  let rango = periodo('mes');     // {desde, hasta} aaaa-mm-dd
  let filtroEstado = '';          // filtro de la vista Activas
  let casoAbierto = null;
  let nuevasFotos = [];

  const esTaller = () => rol === 'taller';
  const cfg = () => (AR.catalogos.datos && AR.catalogos.datos.config) || { horasAmbar: 2, horasRoja: 4 };

  /* =========================================================
     Utilidades de fecha
     ========================================================= */
  function periodo(p) {
    const hoy = new Date(); const d = (x) => U.isoLocalDia(x);
    const menos = (n) => new Date(Date.now() - n * 86400e3);
    const y = +d(hoy).slice(0, 4), m = +d(hoy).slice(5, 7);
    const pad = (n) => String(n).padStart(2, '0');
    if (p === '7d') return { desde: d(menos(6)), hasta: d(hoy) };
    if (p === '30d') return { desde: d(menos(29)), hasta: d(hoy) };
    if (p === 'anio') return { desde: y + '-01-01', hasta: d(hoy) };
    if (p === 'mesAnt') {
      const ym = m === 1 ? [y - 1, 12] : [y, m - 1];
      const ult = new Date(ym[0], ym[1], 0).getDate();
      return { desde: ym[0] + '-' + pad(ym[1]) + '-01', hasta: ym[0] + '-' + pad(ym[1]) + '-' + pad(ult) };
    }
    return { desde: y + '-' + pad(m) + '-01', hasta: d(hoy) };
  }
  const diaDe = (iso) => iso ? U.isoLocalDia(new Date(iso)) : '';
  const enRango = (a) => { const d = diaDe(a.creadoEn); return d >= rango.desde && d <= rango.hasta; };
  function aInputLocal(iso) {
    const d = iso ? new Date(iso) : new Date(); const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const deInputLocal = (v) => v ? new Date(v).toISOString() : '';
  const fmtFechaCorta = (dia) => dia.slice(8, 10) + '/' + dia.slice(5, 7);

  /* =========================================================
     Login
     ========================================================= */
  $('bEntrar').addEventListener('click', async () => {
    const err = (m) => { $('lError').textContent = m; $('lError').classList.remove('ar-oculto'); };
    $('lError').classList.add('ar-oculto');
    const pin = $('lPin').value.trim(), nombre = $('lNombre').value.trim();
    if (!pin) return err('Escribe el PIN.'); if (nombre.length < 3) return err('Escribe tu nombre.');
    AR.sesion.guardar(pin, nombre);
    $('bEntrar').disabled = true;
    try {
      const d = await AR.catalogos.cargar(true);
      if (d.rol !== 'taller' && d.rol !== 'consulta') throw new Error('Este PIN no tiene acceso al tablero.');
      iniciar();
    } catch (e) { AR.sesion.salir(); err(e.message); }
    finally { $('bEntrar').disabled = false; }
  });
  $('lPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lNombre').focus(); });
  $('lNombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bEntrar').click(); });
  $('bSalir').addEventListener('click', () => { AR.sesion.salir(); location.reload(); });

  function iniciar() {
    rol = (AR.catalogos.datos && AR.catalogos.datos.rol) || 'consulta';
    $('vLogin').classList.add('ar-oculto');
    $('tabs').classList.remove('ar-oculto'); $('hdrDer').classList.remove('ar-oculto');
    $('hdrUsuario').textContent = AR.sesion.usuario() + (esTaller() ? '' : ' · solo lectura');
    document.querySelectorAll('.solo-taller').forEach((el) => el.classList.toggle('oculto-rol', !esTaller()));
    document.querySelectorAll('.hA').forEach((e) => { e.textContent = cfg().horasAmbar; });
    document.querySelectorAll('.hR').forEach((e) => { e.textContent = cfg().horasRoja; });
    llenarCatalogos();
    $('fDesde').value = rango.desde; $('fHasta').value = rango.hasta;
    irA(location.hash.replace('#', '') || 'activas');
    cargar();
    setInterval(() => { if (!document.hidden) cargar(true); }, 60000);
    setInterval(() => { if (!document.hidden && vistaActual() === 'activas') pintarActivas(); }, 30000);
  }

  /* =========================================================
     Navegación
     ========================================================= */
  const vistaActual = () => (document.querySelector('.tab[aria-selected="true"]') || {}).dataset.v;
  function irA(v) {
    if (!['activas', 'tablero', 'historial', 'nuevo'].includes(v) || (v === 'nuevo' && !esTaller())) v = 'activas';
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === v)));
    document.querySelectorAll('.vista').forEach((s) => s.classList.toggle('activa', s.id === 'v-' + v));
    history.replaceState(null, '', '#' + v);
    pintar();
  }
  $('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) irA(t.dataset.v); });

  /* =========================================================
     Datos
     ========================================================= */
  async function cargar(silencioso) {
    $('estadoSync').textContent = 'Actualizando…';
    try {
      const r = await AR.api.llamar('listar', { desde: rango.desde, hasta: rango.hasta });
      lista = r.asistencias;
      $('estadoSync').textContent = 'Actualizado ' + U.hora(new Date());
      pintar();
      if (casoAbierto) { const n = lista.find((a) => a.id === casoAbierto.id); if (n && n.actualizadoEn !== casoAbierto.actualizadoEn) abrirCaso(n.id, true); }
    } catch (e) {
      $('estadoSync').textContent = e.red ? 'Sin conexión' : 'Error';
      if (!silencioso) AR.ui.toast(e.message, 'rojo', 6000);
      if (/PIN/.test(e.message)) { AR.sesion.salir(); location.reload(); }
    }
  }
  $('bActualizar').addEventListener('click', () => cargar());

  function pintar() {
    const activas = lista.filter((a) => AR.ACTIVOS.includes(a.estado));
    $('nActivas').textContent = activas.length;
    const v = vistaActual();
    if (v === 'activas') pintarActivas();
    else if (v === 'tablero') pintarTablero();
    else if (v === 'historial') pintarHistorial();
  }

  function llenarCatalogos() {
    const d = AR.catalogos.datos || {};
    const mot = (d.unidades || []).filter((u) => u.tipo !== 'CISTERNA'), cis = (d.unidades || []).filter((u) => u.tipo === 'CISTERNA');
    $('dlUnidades').innerHTML = mot.map((u) => '<option value="' + U.esc(u.codigo) + '">' + U.esc(u.tipo + ' · ' + (u.placa || '') + ' · ' + (u.piloto || '')) + '</option>').join('');
    $('dlCisternas').innerHTML = cis.map((u) => '<option value="' + U.esc(u.codigo) + '">' + U.esc((u.placa || '') + (u.capacidad ? ' · ' + u.capacidad + ' gal' : '')) + '</option>').join('');
    $('dlPilotos').innerHTML = (d.pilotos || []).map((p) => '<option value="' + U.esc(p.nombre) + '">' + U.esc([p.unidad, p.region].filter(Boolean).join(' · ')) + '</option>').join('');
    const areas = (d.areas && d.areas.length ? d.areas.map((a) => a.area) : AR.AREAS);
    $('nArea').innerHTML = '<option value="">— Elige —</option>' + areas.map((a) => '<option>' + U.esc(a) + '</option>').join('');
    $('fArea').innerHTML = '<option value="">Todas</option>' + areas.map((a) => '<option>' + U.esc(a) + '</option>').join('');
    $('nDepto').innerHTML = '<option value="">— Elige —</option>' + (d.departamentos || []).map((x) => '<option>' + U.esc(x) + '</option>').join('');
    $('hEstado').innerHTML = '<option value="">Todos</option>' + Object.keys(AR.ESTADOS).map((k) => '<option value="' + k + '">' + AR.ESTADOS[k].txt + '</option>').join('');
  }

  /* =========================================================
     ACTIVAS
     ========================================================= */
  function pintarActivas() {
    const activas = lista.filter((a) => AR.ACTIVOS.includes(a.estado));
    const cont = {}; activas.forEach((a) => { cont[a.estado] = (cont[a.estado] || 0) + 1; });
    const vencidas = activas.filter((a) => a.estado !== 'EN_GRUA' && AR.ui.semaforo(a.creadoEn, cfg()) === 'rojo').length;
    $('estados').innerHTML =
      '<button class="estado-box" data-e="" aria-pressed="' + (!filtroEstado) + '"><b>' + activas.length + '</b><span>Activas en total</span></button>' +
      AR.ACTIVOS.map((k) => '<button class="estado-box" data-e="' + k + '" aria-pressed="' + (filtroEstado === k) + '"><b>' + (cont[k] || 0) + '</b><span>' + AR.ESTADOS[k].txt + '</span></button>').join('') +
      '<button class="estado-box" data-e="VENCIDAS" aria-pressed="' + (filtroEstado === 'VENCIDAS') + '"><b style="color:var(--ar-rojo)">' + vencidas + '</b><span>Más de ' + cfg().horasRoja + ' h abiertas</span></button>';
    let l = activas;
    if (filtroEstado === 'VENCIDAS') l = l.filter((a) => a.estado !== 'EN_GRUA' && AR.ui.semaforo(a.creadoEn, cfg()) === 'rojo');
    else if (filtroEstado) l = l.filter((a) => a.estado === filtroEstado);
    // primero las que esperan atención (más antiguas arriba); las que van en grúa al final
    l.sort((a, b) => ((a.estado === 'EN_GRUA') - (b.estado === 'EN_GRUA')) || (new Date(a.creadoEn) - new Date(b.creadoEn)));
    $('tbActivas').innerHTML = l.length ? l.map((a) => {
      const grua = a.estado === 'EN_GRUA' && a.finEn;
      const t0 = grua ? a.finEn : a.creadoEn;
      const sem = grua ? 'ambar' : AR.ui.semaforo(a.creadoEn, cfg());
      return '<tr data-id="' + U.esc(a.id) + '">' +
        '<td><span class="reloj ' + sem + '">' + (grua ? 'Grúa · ' : '') + U.duracion(AR.horasDesde(t0) * 60) + '</span><span class="sub">' + (grua ? 'en grúa desde ' : 'desde ') + U.hora(t0) + (diaDe(t0) !== U.isoLocalDia() ? ' · ' + U.fecha(t0) : '') + '</span></td>' +
        '<td><b>' + U.esc(a.correlativo) + '</b><span class="sub">' + U.esc(String(a.origen || '').split(' — ')[0]) + '</span></td>' +
        '<td><b>' + U.esc(a.unidad) + '</b><span class="sub">' + U.esc([a.cisterna, a.tipoUnidad === 'CAMION CISTERNA' ? 'Camión' : ''].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td><b>' + U.esc(a.area) + '</b>' + (a.prioridad === 'Alta' ? ' <span class="prio-alta">· No se mueve</span>' : '') + '<span class="sub">' + U.esc(String(a.descripcion || '').slice(0, 70)) + '</span></td>' +
        '<td>' + U.esc(a.departamento || '—') + '<span class="sub">' + U.esc(String(a.referencia || '').slice(0, 40)) + '</span></td>' +
        '<td>' + AR.ui.chipEstado(a.estado) + '</td>' +
        '<td>' + (a.mecanicoNombre ? U.esc(a.mecanicoNombre) + '<span class="sub">' + U.esc(a.mecanicoTipo === 'Externo' ? 'Externo' + (a.tallerExterno ? ' · ' + a.tallerExterno : '') : 'Interno') + '</span>' : '<span style="color:var(--ar-rojo);font-weight:700">Sin asignar</span>') + '</td>' +
        '<td>' + U.esc(a.pilotoNombre || '—') + '<span class="sub">' + U.esc(a.pilotoTel || '') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="8" class="vacio">' + (activas.length ? 'Ninguna en este filtro.' : 'No hay asistencias activas. 👍') + '</td></tr>';
  }
  $('estados').addEventListener('click', (e) => { const b = e.target.closest('.estado-box'); if (!b) return; filtroEstado = b.dataset.e; pintarActivas(); });
  $('tbActivas').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrirCaso(tr.dataset.id); });

  /* =========================================================
     INDICADORES
     ========================================================= */
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('.preset'); if (!b) return;
    document.querySelectorAll('.preset').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    rango = periodo(b.dataset.p); $('fDesde').value = rango.desde; $('fHasta').value = rango.hasta; cargar();
  });
  ['fDesde', 'fHasta'].forEach((id) => $(id).addEventListener('change', () => {
    if (!$('fDesde').value || !$('fHasta').value) return;
    if ($('fDesde').value > $('fHasta').value) { AR.ui.toast('La fecha inicial es mayor que la final.', 'rojo'); return; }
    document.querySelectorAll('.preset').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    rango = { desde: $('fDesde').value, hasta: $('fHasta').value }; cargar();
  }));
  ['fArea', 'fTipoMec', 'fTipoUni'].forEach((id) => $(id).addEventListener('change', pintarTablero));

  function datosTablero() {
    return lista.filter((a) => a.estado !== 'ANULADA' && enRango(a) &&
      (!$('fArea').value || a.area === $('fArea').value) &&
      (!$('fTipoMec').value || a.mecanicoTipo === $('fTipoMec').value) &&
      (!$('fTipoUni').value || a.tipoUnidad === $('fTipoUni').value));
  }
  const prom = (arr) => { const v = arr.filter((x) => x !== '' && x !== null && x !== undefined && !isNaN(x)).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  function contar(arr, fn) { const m = {}; arr.forEach((a) => { const k = fn(a); if (k) m[k] = (m[k] || 0) + 1; }); return m; }

  function pintarTablero() {
    const d = datosTablero();
    const activasAhora = lista.filter((a) => AR.ACTIVOS.includes(a.estado)).length;
    const atendidas = d.filter((a) => a.resultado);
    const grua = atendidas.filter((a) => a.resultado === 'Requiere grúa').length;
    const pAsig = prom(d.map((a) => a.minAsignacion)), pLleg = prom(d.map((a) => a.minLlegada)),
      pRep = prom(d.map((a) => a.minReparacion)), pTot = prom(d.map((a) => a.minTotal));
    const unidades = new Set(d.map((a) => a.unidad)).size;
    const kpi = (t, v, s) => '<div class="kpi"><span>' + t + '</span><b>' + v + '</b><small>' + (s || '&nbsp;') + '</small></div>';
    $('kpis').innerHTML =
      kpi('Asistencias en el periodo', d.length, U.fecha(rango.desde + 'T12:00:00') + ' – ' + U.fecha(rango.hasta + 'T12:00:00')) +
      kpi('Activas ahora', activasAhora, 'todas las fechas') +
      kpi('Unidades distintas', unidades, d.length ? (d.length / Math.max(unidades, 1)).toFixed(1) + ' asistencias por unidad' : '') +
      kpi('Uso de grúa', atendidas.length ? Math.round(100 * grua / atendidas.length) + '%' : '—', grua + ' de ' + atendidas.length + ' atendidas') +
      kpi('Reporte → asignación', U.duracion(pAsig), 'promedio') +
      kpi('Asignación → llegada', U.duracion(pLleg), 'promedio') +
      kpi('Tiempo total a cierre', U.duracion(pTot), 'promedio de cerradas');

    // Por día (o por mes si el rango es largo)
    const dias = Math.round((new Date(rango.hasta) - new Date(rango.desde)) / 86400e3) + 1;
    const porDia = contar(d, (a) => diaDe(a.creadoEn));
    let serie = [];
    if (dias <= 62) {
      for (let i = 0; i < dias; i++) {
        const dia = U.isoLocalDia(new Date(new Date(rango.desde + 'T12:00:00').getTime() + i * 86400e3));
        serie.push({ label: fmtFechaCorta(dia), value: porDia[dia] || 0, tip: U.fecha(dia + 'T12:00:00') });
      }
    } else {
      const porMes = contar(d, (a) => diaDe(a.creadoEn).slice(0, 7));
      const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      let cur = rango.desde.slice(0, 7);
      while (cur <= rango.hasta.slice(0, 7)) {
        serie.push({ label: MESES[+cur.slice(5) - 1], value: porMes[cur] || 0, tip: MESES[+cur.slice(5) - 1] + ' ' + cur.slice(0, 4) });
        const [yy, mm] = cur.split('-').map(Number); cur = mm === 12 ? (yy + 1) + '-01' : yy + '-' + String(mm + 1).padStart(2, '0');
      }
    }
    Graf.columnas($('gDia'), serie, { alto: 220, unidad: 'asistencias' });

    Graf.barrasH($('gGrua'), [
      { label: 'Habilitada en ruta', value: atendidas.length - grua },
      { label: 'Requiere grúa', value: grua }
    ], { total: atendidas.length, vacio: 'Aún no hay asistencias atendidas en el periodo.' });

    const top = Object.entries(contar(d, (a) => a.unidad)).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([u, n]) => { const c = AR.catalogos.unidad(u); return { label: u, value: n, tip: c ? (c.placa + ' · ' + c.marca + (c.piloto ? ' · ' + c.piloto : '')) : '' }; });
    Graf.barrasH($('gUnidades'), top, { vacio: 'Sin asistencias en el periodo.' });

    const areas = contar(d, (a) => a.area);
    const ordenAreas = ((AR.catalogos.datos && AR.catalogos.datos.areas) || []).map((x) => x.area);
    Graf.barrasH($('gArea'), (ordenAreas.length ? ordenAreas : AR.AREAS).map((x) => ({ label: x, value: areas[x] || 0 })), { total: d.length });

    Graf.barrasH($('gTiempos'), [
      { label: 'Reporte → asignación', value: pAsig === null ? 0 : Math.round(pAsig), fmt: U.duracion(pAsig) },
      { label: 'Asignación → llegada', value: pLleg === null ? 0 : Math.round(pLleg), fmt: U.duracion(pLleg) },
      { label: 'Llegada → fin trabajo', value: pRep === null ? 0 : Math.round(pRep), fmt: U.duracion(pRep) }
    ], { vacio: 'Sin tiempos registrados.' });

    const mec = contar(d.filter((a) => a.mecanicoNombre), (a) => a.mecanicoTipo || 'Interno');
    Graf.barrasH($('gMec'), [{ label: 'Interno', value: mec.Interno || 0 }, { label: 'Externo', value: mec.Externo || 0 }], { total: (mec.Interno || 0) + (mec.Externo || 0), vacio: 'Sin mecánicos registrados.' });

    const porHora = contar(d, (a) => a.creadoEn ? String(+U.hora(a.creadoEn).slice(0, 2)) : '');
    Graf.columnas($('gHora'), Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: porHora[String(h)] || 0, tip: h + ':00 – ' + h + ':59' })), { alto: 170, unidad: 'reportes' });

    Graf.mapa($('gMapa'), contar(d, (a) => a.departamento));
  }

  /* =========================================================
     Gráficas en SVG (una sola tonalidad; el color no es la única pista: hay etiquetas y tabla)
     ========================================================= */
  const Graf = {};
  const NS = 'http://www.w3.org/2000/svg';
  function tip(el, html) {
    el.addEventListener('mousemove', (e) => { const t = $('tip'); t.innerHTML = html; t.classList.remove('ar-oculto'); t.style.left = Math.min(e.clientX + 14, innerWidth - 270) + 'px'; t.style.top = (e.clientY + 14) + 'px'; });
    el.addEventListener('mouseleave', () => $('tip').classList.add('ar-oculto'));
  }
  function escalaMax(max) { if (max <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

  Graf.columnas = function (cont, datos, o) {
    const W = Math.max(cont.clientWidth || 600, 300), H = o.alto || 200, ml = 30, mb = 24, mt = 14;
    const max = escalaMax(Math.max(1, ...datos.map((x) => x.value)));
    const n = datos.length, paso = (W - ml) / n, bw = Math.max(2, Math.min(38, paso - 2));
    const y = (v) => mt + (H - mt - mb) * (1 - v / max);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfica de columnas">';
    for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = y(v); s += '<line class="grid-l" x1="' + ml + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '"/><text class="eje" x="' + (ml - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + Math.round(v) + '</text>'; }
    const cada = Math.ceil(n / Math.floor((W - ml) / 34));
    datos.forEach((d, i) => {
      const x = ml + i * paso + (paso - bw) / 2, h = (H - mt - mb) * d.value / max;
      if (d.value > 0) s += '<path class="barra" data-i="' + i + '" d="' + barraV(x, y(0), bw, h) + '"/>';
      s += '<rect data-i="' + i + '" x="' + (ml + i * paso) + '" y="' + mt + '" width="' + paso + '" height="' + (H - mt - mb) + '" fill="transparent"/>';
      if (i % cada === 0) s += '<text class="eje" x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + U.esc(d.label) + '</text>';
    });
    // etiqueta solo en el máximo (sin número en cada barra)
    const iMax = datos.reduce((m, d, i) => d.value > datos[m].value ? i : m, 0);
    if (datos[iMax] && datos[iMax].value > 0) s += '<text class="valor" x="' + (ml + iMax * paso + paso / 2) + '" y="' + (y(datos[iMax].value) - 5) + '" text-anchor="middle">' + datos[iMax].value + '</text>';
    s += '</svg>';
    cont.innerHTML = s;
    cont.querySelectorAll('rect[data-i]').forEach((r) => { const d = datos[+r.dataset.i]; tip(r, '<b>' + U.esc(d.tip || d.label) + '</b>' + d.value + ' ' + (o.unidad || '')); });
  };
  function barraV(x, y0, w, h) { // columna con extremo redondeado de 4px, anclada a la base
    const r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + y0 + 'V' + (y0 - h + r) + 'Q' + x + ',' + (y0 - h) + ' ' + (x + r) + ',' + (y0 - h) + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y0 - h) + ' ' + (x + w) + ',' + (y0 - h + r) + 'V' + y0 + 'Z';
  }
  function barraH(x0, y, w, h) {
    const r = Math.min(4, h / 2, w);
    return 'M' + x0 + ',' + y + 'H' + (x0 + w - r) + 'Q' + (x0 + w) + ',' + y + ' ' + (x0 + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x0 + w) + ',' + (y + h) + ' ' + (x0 + w - r) + ',' + (y + h) + 'H' + x0 + 'Z';
  }

  Graf.barrasH = function (cont, datos, o) {
    o = o || {};
    if (!datos.length || datos.every((d) => !d.value)) { cont.innerHTML = '<div class="vacio" style="padding:20px">' + (o.vacio || 'Sin datos.') + '</div>'; return; }
    const W = Math.max(cont.clientWidth || 400, 260), fila = 28, bh = 16;
    const lw = Math.min(170, Math.max(60, ...datos.map((d) => String(d.label).length * 7.2))) + 8;
    const H = datos.length * fila + 4, max = Math.max(1, ...datos.map((d) => d.value)), ancho = W - lw - 70;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfica de barras">';
    datos.forEach((d, i) => {
      const y = i * fila + (fila - bh) / 2, w = ancho * d.value / max;
      const pct = o.total ? ' (' + Math.round(100 * d.value / Math.max(o.total, 1)) + '%)' : '';
      s += '<text class="etq" x="' + (lw - 8) + '" y="' + (y + bh - 3) + '" text-anchor="end">' + U.esc(d.label) + '</text>';
      if (d.value > 0) s += '<path class="barra" d="' + barraH(lw, y, Math.max(w, 2), bh) + '"/>';
      s += '<text class="valor" x="' + (lw + Math.max(w, 2) + 6) + '" y="' + (y + bh - 3) + '">' + U.esc(d.fmt || d.value) + pct + '</text>';
      s += '<rect data-i="' + i + '" x="0" y="' + (i * fila) + '" width="' + W + '" height="' + fila + '" fill="transparent"/>';
    });
    cont.innerHTML = s + '</svg>';
    cont.querySelectorAll('rect[data-i]').forEach((r) => { const d = datos[+r.dataset.i]; tip(r, '<b>' + U.esc(d.label) + '</b>' + U.esc(d.fmt || d.value) + (d.tip ? '<br>' + U.esc(d.tip) : '')); });
  };

  let geo = null;
  const RAMPA = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)'];
  Graf.mapa = async function (cont, conteo) {
    if (!geo) { try { geo = await AR.geo.cargar(); } catch (e) { cont.innerHTML = '<div class="vacio">No se pudo cargar el mapa.</div>'; return; } }
    const W = Math.max(cont.clientWidth || 420, 280);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    geo.features.forEach((f) => f.geometry.coordinates.forEach((p) => p[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); })));
    const k = Math.cos(15.5 * Math.PI / 180), HMAX = 400;
    const escala = Math.min((W - 10) / ((maxX - minX) * k), (HMAX - 10) / (maxY - minY)), H = (maxY - minY) * escala + 10;
    const dx = (W - (maxX - minX) * k * escala) / 2; // centrado horizontal
    const px = (x) => dx + (x - minX) * k * escala, py = (y) => 5 + (maxY - y) * escala;
    const max = Math.max(0, ...Object.values(conteo));
    const color = (n) => { if (!n) return 'var(--sin-dato)'; if (max <= 1) return RAMPA[3]; return RAMPA[1 + Math.round((n - 1) / (max - 1) * 5)]; };
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mapa de asistencias por departamento">';
    geo.features.forEach((f, i) => {
      const d = f.geometry.coordinates.map((poly) => poly.map((ring) => 'M' + ring.map(([x, y]) => px(x).toFixed(1) + ',' + py(y).toFixed(1)).join('L') + 'Z').join('')).join('');
      s += '<path class="depto" data-i="' + i + '" d="' + d + '" fill="' + color(conteo[f.properties.nombre] || 0) + '"/>';
    });
    s += '</svg>';
    const sinUb = Object.entries(conteo).filter(([k]) => !geo.features.some((f) => f.properties.nombre === k)).reduce((s2, [, v]) => s2 + v, 0);
    const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]);
    cont.innerHTML = s +
      '<div class="leyenda"><span>Menos</span>' + RAMPA.slice(1).map((c) => '<i style="background:' + c + '"></i>').join('') + '<span>Más (' + max + ')</span><i style="background:var(--sin-dato);margin-left:10px"></i><span>Sin asistencias</span></div>' +
      '<button class="ver-tabla" type="button">Ver tabla por departamento</button><table class="mini-tabla ar-oculto">' +
      (ranking.length ? ranking.map(([k, v]) => '<tr><td>' + U.esc(k) + '</td><td>' + v + '</td></tr>').join('') : '<tr><td>Sin datos</td><td></td></tr>') + '</table>' +
      (sinUb ? '<div class="sub">' + sinUb + ' sin departamento reconocido</div>' : '');
    cont.querySelector('.ver-tabla').onclick = (e) => { cont.querySelector('.mini-tabla').classList.toggle('ar-oculto'); };
    cont.querySelectorAll('path.depto').forEach((p) => { const f = geo.features[+p.dataset.i]; tip(p, '<b>' + U.esc(f.properties.nombre) + '</b>' + (conteo[f.properties.nombre] || 0) + ' asistencias'); });
  };
  let tRes; addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(() => { if (vistaActual() === 'tablero') pintarTablero(); }, 250); });

  /* =========================================================
     HISTORIAL
     ========================================================= */
  function datosHistorial() {
    const q = $('hBuscar').value.trim().toLowerCase(), est = $('hEstado').value;
    return lista.filter((a) => enRango(a) || AR.ACTIVOS.includes(a.estado))
      .filter((a) => !est || a.estado === est)
      .filter((a) => !q || [a.correlativo, a.unidad, a.cisterna, a.pilotoNombre, a.mecanicoNombre, a.tallerExterno, a.area, a.descripcion, a.departamento, a.diagnostico].join(' ').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
  }
  function pintarHistorial() {
    $('hPeriodo').textContent = U.fecha(rango.desde + 'T12:00:00') + ' – ' + U.fecha(rango.hasta + 'T12:00:00') + ' (cámbialo en Indicadores)';
    const l = datosHistorial();
    $('tbHistorial').innerHTML = l.length ? l.map((a) => '<tr data-id="' + U.esc(a.id) + '">' +
      '<td><b>' + U.esc(a.correlativo) + '</b></td><td>' + U.fechaHora(a.creadoEn) + '</td>' +
      '<td><b>' + U.esc(a.unidad) + '</b><span class="sub">' + U.esc(a.cisterna || '') + '</span></td>' +
      '<td>' + U.esc(a.area) + '<span class="sub">' + U.esc(String(a.descripcion || '').slice(0, 60)) + '</span></td>' +
      '<td>' + U.esc(a.departamento || '—') + '</td>' +
      '<td>' + U.esc(a.mecanicoNombre || '—') + '<span class="sub">' + U.esc(a.mecanicoTipo || '') + '</span></td>' +
      '<td>' + U.esc(a.resultado || '—') + '</td><td>' + AR.ui.chipEstado(a.estado) + '</td>' +
      '<td class="num">' + (a.minTotal !== '' ? U.duracion(a.minTotal) : '—') + '</td></tr>').join('')
      : '<tr><td colspan="9" class="vacio">Sin resultados.</td></tr>';
    const unidades = new Set(l.map((a) => a.unidad));
    $('hConteo').textContent = l.length + ' asistencia(s)' + (unidades.size === 1 && l.length ? ' de la unidad ' + [...unidades][0] : '');
  }
  $('hBuscar').addEventListener('input', U.debounce(pintarHistorial, 200));
  $('hEstado').addEventListener('change', pintarHistorial);
  $('tbHistorial').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrirCaso(tr.dataset.id); });

  $('bExportar').addEventListener('click', () => {
    const l = datosHistorial();
    const cols = [['Correlativo', 'correlativo'], ['Estado', (a) => (AR.ESTADOS[a.estado] || {}).txt || a.estado], ['Fecha reporte', (a) => U.fechaHora(a.creadoEn)], ['Origen', 'origen'],
      ['Unidad', 'unidad'], ['Tipo', 'tipoUnidad'], ['Cisterna', 'cisterna'], ['Componente', 'componente'], ['Piloto', 'pilotoNombre'], ['Tel. piloto', 'pilotoTel'],
      ['Área', 'area'], ['Descripción', 'descripcion'], ['Puede moverse', 'puedeMoverse'], ['Con carga', 'conCarga'], ['Prioridad', 'prioridad'],
      ['Departamento', 'departamento'], ['Referencia', 'referencia'], ['Latitud', 'lat'], ['Longitud', 'lng'],
      ['Mecánico', 'mecanicoNombre'], ['Tipo mecánico', 'mecanicoTipo'], ['Taller externo', 'tallerExterno'],
      ['Asignado', (a) => U.fechaHora(a.asignadoEn)], ['Salida', (a) => U.fechaHora(a.salidaEn)], ['Llegada', (a) => U.fechaHora(a.llegadaEn)], ['Fin trabajo', (a) => U.fechaHora(a.finEn)], ['Cierre', (a) => U.fechaHora(a.cerradoEn)],
      ['Diagnóstico', 'diagnostico'], ['Trabajo realizado', 'trabajoRealizado'], ['Repuestos', 'repuestos'], ['Resultado', 'resultado'],
      ['Grúa proveedor', 'gruaProveedor'], ['Grúa destino', 'gruaDestino'], ['Grúa motivo', 'gruaMotivo'],
      ['Min. asignación', 'minAsignacion'], ['Min. llegada', 'minLlegada'], ['Min. reparación', 'minReparacion'], ['Min. total', 'minTotal'], ['Observaciones', 'observaciones']];
    const celda = (v) => { v = v === undefined || v === null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = '﻿' + cols.map((c) => c[0]).join(',') + '\r\n' + l.map((a) => cols.map((c) => celda(typeof c[1] === 'function' ? c[1](a) : a[c[1]])).join(',')).join('\r\n');
    AR.descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'Asistencias_TRANSDA_' + rango.desde + '_a_' + rango.hasta + '.csv');
  });

  /* =========================================================
     PANEL DE DETALLE Y ACCIONES
     ========================================================= */
  let detalle = null; // {asistencia, bitacora}
  async function abrirCaso(id, silencioso) {
    const base = lista.find((a) => a.id === id);
    if (!base) return;
    casoAbierto = base;
    if (!silencioso) { pintarPanel(base, null); abrirPanel(); }
    try {
      detalle = await AR.api.llamar('detalle', { id });
      casoAbierto = detalle.asistencia;
      pintarPanel(detalle.asistencia, detalle.bitacora);
    } catch (e) { AR.ui.toast(e.message, 'rojo'); }
  }
  function abrirPanel() { $('panel').classList.add('abierto'); $('panel').setAttribute('aria-hidden', 'false'); $('panelFondo').classList.add('abierto'); }
  function cerrarPanel() { $('panel').classList.remove('abierto'); $('panel').setAttribute('aria-hidden', 'true'); $('panelFondo').classList.remove('abierto'); casoAbierto = null; detalle = null; }
  $('pCerrar').addEventListener('click', cerrarPanel); $('panelFondo').addEventListener('click', cerrarPanel);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { const v = document.querySelector('.visor'); if (v) v.remove(); else cerrarPanel(); } });

  function kv(pares) { return '<dl class="ar-kv">' + pares.filter((p) => p[1] !== '' && p[1] !== undefined && p[1] !== null).map((p) => '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>'; }
  function pintarPanel(a, bit) {
    $('pCorr').textContent = a.correlativo + ' · ' + (a.origen || '');
    $('pTitulo').textContent = a.unidad + (a.cisterna ? ' / ' + a.cisterna : '');
    $('pEstado').innerHTML = AR.ui.chipEstado(a.estado) + (AR.ACTIVOS.includes(a.estado) ? ' <span class="reloj ' + AR.ui.semaforo(a.creadoEn, cfg()) + '" style="margin-left:8px">' + U.duracion(AR.horasDesde(a.creadoEn) * 60) + ' abierta</span>' : '');
    const ruta = AR.gps.rutaUrl(a.lat, a.lng);
    const contacto = (nombre, tel) => tel ? U.esc(nombre || '') + ' · <a href="tel:' + U.esc(tel) + '">' + U.esc(tel) + '</a> · <a href="https://wa.me/' + U.telWa(tel) + '" target="_blank" rel="noopener">WhatsApp</a>' : U.esc(nombre || '—');
    let h = '';
    if (esTaller()) h += '<div class="ar-card"><div class="acciones" id="pAcciones">' + botonesAccion(a) + '</div><div id="pForm"></div></div>';
    else h += '<div class="ar-card"><div class="acciones"><button class="ar-btn ar-btn-sec" data-acc="pdf" type="button">Descargar expediente PDF</button></div></div>';
    h += '<div class="ar-card"><h2>Reporte</h2>' + kv([
      ['Fecha', U.fechaHora(a.creadoEn)], ['Reportó', U.esc(a.creadoPor)], ['Piloto', contacto(a.pilotoNombre, a.pilotoTel)],
      ['Unidad', U.esc(a.unidad + ' · ' + (a.tipoUnidad || '')) + (a.componente ? ' · falla en ' + U.esc(a.componente) : '')],
      ['Área', U.esc(a.area)], ['Falla', U.esc(a.descripcion)],
      ['Situación', (a.puedeMoverse === 'NO' ? '<b style="color:var(--ar-rojo)">No puede moverse</b>' : 'Puede moverse') + ' · ' + (a.conCarga === 'SI' ? 'Con carga' : 'Vacía') + ' · Prioridad ' + U.esc(a.prioridad)],
      ['Ubicación', U.esc([a.departamento, a.referencia].filter(Boolean).join(' · ') || '—') + (ruta ? ' · <a href="' + ruta + '" target="_blank" rel="noopener">abrir en mapa</a>' : '')]
    ]) + fotosHtml(a.fotosReporte, 'rep') + '</div>';
    h += '<div class="ar-card"><h2>Atención</h2>' + kv([
      ['Mecánico', a.mecanicoNombre ? contacto(a.mecanicoNombre + ' (' + (a.mecanicoTipo || 'Interno') + (a.tallerExterno ? ' · ' + a.tallerExterno : '') + ')', a.mecanicoTel) : '<span style="color:var(--ar-rojo)">Sin asignar</span>'],
      ['Asignado', U.fechaHora(a.asignadoEn) + (a.minAsignacion !== '' ? ' <span class="sub" style="display:inline">(' + U.duracion(a.minAsignacion) + ' después del reporte)</span>' : '')],
      ['Salida', U.fechaHora(a.salidaEn)],
      ['Llegada', U.fechaHora(a.llegadaEn) + (a.minLlegada !== '' ? ' <span class="sub" style="display:inline">(' + U.duracion(a.minLlegada) + ')</span>' : '')],
      ['Fin trabajo', U.fechaHora(a.finEn) + (a.minReparacion !== '' ? ' <span class="sub" style="display:inline">(' + U.duracion(a.minReparacion) + ' de trabajo)</span>' : '')],
      ['Diagnóstico', U.esc(a.diagnostico)], ['Trabajo', U.esc(a.trabajoRealizado)], ['Repuestos', U.esc(a.repuestos)],
      ['Resultado', a.resultado ? '<b>' + U.esc(a.resultado) + '</b>' : ''],
      ['Grúa', U.esc([a.gruaProveedor, a.gruaDestino && 'destino ' + a.gruaDestino, a.gruaMotivo].filter(Boolean).join(' · '))],
      ['Cierre', U.fechaHora(a.cerradoEn) + (a.cerradoPor ? ' · ' + U.esc(a.cerradoPor) : '') + (a.minTotal !== '' ? ' · total ' + U.duracion(a.minTotal) : '')],
      ['Firma', a.tieneFirma ? 'Registrada' : '']
    ]) + fotosHtml(a.fotosCierre, 'cie') +
      (a.observaciones ? '<h3 style="font-size:14px;margin:12px 0 4px">Observaciones</h3><div style="white-space:pre-line;font-size:14px">' + U.esc(a.observaciones) + '</div>' : '') + '</div>';
    h += '<div class="ar-card"><h2>Bitácora</h2>' + (bit ? '<ul class="bit">' + bit.map((b) => '<li><b>' + U.esc(b.evento) + '</b>' + (b.a && b.a !== b.de ? ' → ' + U.esc((AR.ESTADOS[b.a] || {}).txt || b.a) : '') + '<small>' + U.fechaHora(b.fecha) + ' · ' + U.esc(b.usuario) + ' (' + U.esc(b.rol) + ')' + (b.detalle ? ' · ' + U.esc(b.detalle) : '') + '</small></li>').join('') + '</ul>' : '<p class="sub">Cargando…</p>') + '</div>';
    $('pCuerpo').innerHTML = h;
    cargarFotosPanel();
  }
  function fotosHtml(ids, tipo) {
    const l = AR.idsFotos(ids); if (!l.length) return '';
    return '<div class="ar-fotos" style="margin-top:12px">' + l.map((id) => '<div class="ar-foto" data-foto="' + U.esc(id) + '" data-tipo="' + tipo + '" style="cursor:zoom-in"></div>').join('') + '</div>';
  }
  function cargarFotosPanel() {
    $('pCuerpo').querySelectorAll('[data-foto]').forEach(async (el) => {
      try {
        const src = await AR.fotoRemota(el.dataset.foto);
        el.innerHTML = '<img alt="">'; el.firstChild.src = src;
        el.onclick = () => { const v = document.createElement('div'); v.className = 'visor'; v.innerHTML = '<img alt="">'; v.firstChild.src = src; v.onclick = () => v.remove(); document.body.appendChild(v); };
      } catch (e) { el.textContent = '—'; }
    });
  }

  function botonesAccion(a) {
    const b = (acc, txt, cls) => '<button class="ar-btn ' + (cls || 'ar-btn-sec') + '" type="button" data-acc="' + acc + '">' + txt + '</button>';
    let h = '';
    if (AR.ACTIVOS.includes(a.estado) && a.estado !== 'EN_GRUA') {
      h += b('asignar', a.mecanicoNombre ? 'Cambiar mecánico' : 'Asignar mecánico', a.mecanicoNombre ? '' : 'ar-btn');
      if (!a.salidaEn && !a.llegadaEn) h += b('salida', 'Marcar en ruta');
      if (!a.llegadaEn) h += b('llegada', 'Marcar llegada');
      h += b('cierre', 'Registrar cierre', 'ar-btn-ok');
    }
    if (a.estado === 'EN_GRUA') h += b('grua', 'Recibir unidad de grúa', 'ar-btn-ok');
    if (a.estado === 'CERRADA') h += b('reabrir', 'Reabrir');
    h += b('nota', 'Agregar nota') + b('editar', 'Corregir datos') + b('pdf', 'Expediente PDF');
    if (a.estado !== 'ANULADA') h += b('anular', 'Anular', 'ar-btn-peligro');
    return h;
  }

  $('pCuerpo').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-acc]'); if (!btn || !casoAbierto) return;
    const acc = btn.dataset.acc;
    if (acc === 'pdf') return expedientePdf();
    mostrarSubForm(acc);
  });

  function campo(id, label, html, req) { return '<div class="ar-campo"><label for="' + id + '"' + (req ? ' class="req"' : '') + '>' + label + '</label>' + html + '</div>'; }
  const inp = (id, v, extra) => '<input id="' + id + '" class="ar-input" value="' + U.esc(v || '') + '" ' + (extra || '') + '>';
  const dt = (id, iso) => '<input id="' + id + '" type="datetime-local" class="ar-input" value="' + aInputLocal(iso) + '">';
  function selectMecanicos(actual) {
    const m = (AR.catalogos.datos && AR.catalogos.datos.mecanicos) || [];
    return '<input id="sMec" class="ar-input" list="dlMecT" value="' + U.esc(actual || '') + '" autocomplete="off" placeholder="Nombre del mecánico o taller"><datalist id="dlMecT">' +
      m.map((x) => '<option value="' + U.esc(x.nombre) + '">' + U.esc([x.tipo, x.taller, x.region].filter(Boolean).join(' · ')) + '</option>').join('') + '</datalist>';
  }

  function mostrarSubForm(acc) {
    const a = casoAbierto, f = $('pForm');
    const pie = (txt, cls) => '<div id="sErr" class="ar-aviso rojo ar-oculto"></div><div class="acciones"><button class="ar-btn ' + (cls || '') + '" type="submit">' + txt + '</button><button class="ar-btn ar-btn-sec" type="button" id="sCancelar">Cancelar</button></div>';
    let h = '';
    if (acc === 'asignar') {
      h = '<h3>Asignar mecánico</h3>' + campo('sMec', 'Mecánico', selectMecanicos(a.mecanicoNombre), true) +
        '<div class="dos">' + campo('sTipo', 'Tipo', '<select id="sTipo" class="ar-select"><option>Interno</option><option' + (a.mecanicoTipo === 'Externo' ? ' selected' : '') + '>Externo</option></select>') +
        campo('sTaller', 'Taller externo', inp('sTaller', a.tallerExterno)) + '</div><div class="dos">' +
        campo('sTel', 'Teléfono', inp('sTel', a.mecanicoTel, 'type="tel"')) + campo('sTs', 'Hora de asignación', dt('sTs', a.asignadoEn)) + '</div>' + pie('Asignar');
    } else if (acc === 'salida' || acc === 'llegada') {
      h = '<h3>' + (acc === 'salida' ? 'Mecánico en ruta' : 'Llegada del mecánico al sitio') + '</h3>' + campo('sTs', 'Hora', dt('sTs', null), true) +
        (a.mecanicoNombre ? '' : campo('sMec', 'Mecánico', selectMecanicos(''), true)) + pie('Registrar');
    } else if (acc === 'cierre') {
      h = '<h3>Registrar cierre</h3>' +
        (a.mecanicoNombre ? '<p class="sub" style="margin-top:0">Mecánico: ' + U.esc(a.mecanicoNombre) + '</p>' : campo('sMec', 'Mecánico', selectMecanicos(''), true) +
          '<div class="dos">' + campo('sTipo', 'Tipo', '<select id="sTipo" class="ar-select"><option>Interno</option><option>Externo</option></select>') + campo('sTaller', 'Taller externo', inp('sTaller', '')) + '</div>') +
        '<div class="dos">' + (a.llegadaEn ? '' : campo('sLleg', 'Hora de llegada (si se conoce)', '<input id="sLleg" type="datetime-local" class="ar-input">')) + campo('sTs', 'Hora de fin del trabajo', dt('sTs', null), true) + '</div>' +
        campo('sDiag', 'Diagnóstico', '<textarea id="sDiag" class="ar-textarea"></textarea>', true) +
        campo('sTrab', 'Trabajo realizado', '<textarea id="sTrab" class="ar-textarea"></textarea>', true) +
        campo('sRep', 'Repuestos', inp('sRep', '')) +
        campo('sRes', 'Resultado', '<select id="sRes" class="ar-select"><option value="">— Elige —</option><option value="HABILITADA">Unidad habilitada</option><option value="GRUA">Requiere grúa</option></select>', true) +
        '<div id="sGrua" class="ar-oculto"><div class="dos">' + campo('sGProv', 'Proveedor de grúa', inp('sGProv', '')) + campo('sGDest', 'Destino', inp('sGDest', ''), true) + '</div>' + campo('sGMot', 'Motivo', inp('sGMot', '')) + '</div>' +
        campo('sFotos', 'Fotos del trabajo (opcional)', '<input id="sFotos" type="file" accept="image/*" multiple class="ar-input">') +
        campo('sObs', 'Observaciones', inp('sObs', '')) + pie('Guardar cierre', 'ar-btn-ok');
    } else if (acc === 'grua') {
      h = '<h3>Unidad recibida de grúa</h3><div class="dos">' + campo('sTs', 'Hora de recepción', dt('sTs', null), true) + campo('sGDest', 'Lugar', inp('sGDest', a.gruaDestino)) + '</div>' + pie('Cerrar asistencia', 'ar-btn-ok');
    } else if (acc === 'nota') {
      h = '<h3>Agregar nota</h3>' + campo('sNota', 'Nota', '<textarea id="sNota" class="ar-textarea"></textarea>', true) + pie('Guardar nota');
    } else if (acc === 'anular') {
      h = '<h3>Anular asistencia</h3><p class="sub" style="margin-top:0">Queda en el historial como anulada y no cuenta en los indicadores.</p>' + campo('sMot', 'Motivo', inp('sMot', '', 'placeholder="Ej. Reporte duplicado, prueba"'), true) + pie('Anular', 'ar-btn-peligro');
    } else if (acc === 'reabrir') {
      h = '<h3>Reabrir asistencia</h3>' + campo('sMot', 'Motivo', inp('sMot', ''), true) + pie('Reabrir');
    } else if (acc === 'editar') {
      const areas = (AR.catalogos.datos && AR.catalogos.datos.areas || []).map((x) => x.area);
      const deps = (AR.catalogos.datos && AR.catalogos.datos.departamentos) || [];
      h = '<h3>Corregir datos</h3><p class="sub" style="margin-top:0">Cada cambio queda registrado en la bitácora.</p><div class="dos">' +
        campo('eUNIDAD', 'Unidad', inp('eUNIDAD', a.unidad)) + campo('eCISTERNA', 'Cisterna', inp('eCISTERNA', a.cisterna)) +
        campo('eAREA', 'Área', '<select id="eAREA" class="ar-select">' + (areas.length ? areas : AR.AREAS).map((x) => '<option' + (x === a.area ? ' selected' : '') + '>' + U.esc(x) + '</option>').join('') + '</select>') +
        campo('ePRIORIDAD', 'Prioridad', '<select id="ePRIORIDAD" class="ar-select">' + ['Alta', 'Media', 'Baja'].map((x) => '<option' + (x === a.prioridad ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>') +
        campo('eDEPARTAMENTO', 'Departamento', '<select id="eDEPARTAMENTO" class="ar-select"><option value=""></option>' + deps.map((x) => '<option' + (x === a.departamento ? ' selected' : '') + '>' + U.esc(x) + '</option>').join('') + '</select>') +
        campo('eREFERENCIA', 'Referencia', inp('eREFERENCIA', a.referencia)) +
        campo('ePILOTO_NOMBRE', 'Piloto', inp('ePILOTO_NOMBRE', a.pilotoNombre)) + campo('ePILOTO_TEL', 'Tel. piloto', inp('ePILOTO_TEL', a.pilotoTel)) +
        campo('eMECANICO_NOMBRE', 'Mecánico', inp('eMECANICO_NOMBRE', a.mecanicoNombre)) + campo('eMECANICO_TEL', 'Tel. mecánico', inp('eMECANICO_TEL', a.mecanicoTel)) +
        campo('eASIGNADO_EN', 'Asignado', '<input id="eASIGNADO_EN" type="datetime-local" class="ar-input" value="' + (a.asignadoEn ? aInputLocal(a.asignadoEn) : '') + '">') +
        campo('eSALIDA_EN', 'Salida', '<input id="eSALIDA_EN" type="datetime-local" class="ar-input" value="' + (a.salidaEn ? aInputLocal(a.salidaEn) : '') + '">') +
        campo('eLLEGADA_EN', 'Llegada', '<input id="eLLEGADA_EN" type="datetime-local" class="ar-input" value="' + (a.llegadaEn ? aInputLocal(a.llegadaEn) : '') + '">') +
        campo('eFIN_EN', 'Fin trabajo', '<input id="eFIN_EN" type="datetime-local" class="ar-input" value="' + (a.finEn ? aInputLocal(a.finEn) : '') + '">') +
        '</div>' + campo('eDESCRIPCION', 'Descripción', '<textarea id="eDESCRIPCION" class="ar-textarea">' + U.esc(a.descripcion) + '</textarea>') +
        campo('eDIAGNOSTICO', 'Diagnóstico', '<textarea id="eDIAGNOSTICO" class="ar-textarea">' + U.esc(a.diagnostico) + '</textarea>') +
        campo('eTRABAJO_REALIZADO', 'Trabajo realizado', '<textarea id="eTRABAJO_REALIZADO" class="ar-textarea">' + U.esc(a.trabajoRealizado) + '</textarea>') + pie('Guardar cambios');
    }
    f.innerHTML = '<form class="sub-form" id="sForm" novalidate>' + h + '</form>';
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('sCancelar').onclick = () => { f.innerHTML = ''; };
    if ($('sRes')) $('sRes').onchange = () => $('sGrua').classList.toggle('ar-oculto', $('sRes').value !== 'GRUA');
    if ($('sMec')) $('sMec').onchange = () => {
      const m = ((AR.catalogos.datos && AR.catalogos.datos.mecanicos) || []).find((x) => x.nombre === $('sMec').value); if (!m) return;
      if ($('sTipo')) $('sTipo').value = m.tipo === 'Externo' ? 'Externo' : 'Interno';
      if ($('sTaller') && m.taller) $('sTaller').value = m.taller; if ($('sTel') && m.tel) $('sTel').value = m.tel;
    };
    $('sForm').onsubmit = (ev) => { ev.preventDefault(); ejecutar(acc); };
  }

  async function ejecutar(acc) {
    const a = casoAbierto, v = (id) => ($(id) ? $(id).value.trim() : '');
    const err = (m) => { $('sErr').textContent = m; $('sErr').classList.remove('ar-oculto'); };
    let accion, datos;
    const mec = () => ({ mecanicoNombre: v('sMec'), mecanicoTipo: v('sTipo') || 'Interno', tallerExterno: v('sTaller'), mecanicoTel: v('sTel') });
    try {
      if (acc === 'asignar') {
        if (!v('sMec')) return err('Indica el mecánico.');
        accion = 'evento'; datos = { id: a.id, evento: 'ASIGNAR', datos: Object.assign(mec(), { ts: deInputLocal(v('sTs')) }) };
      } else if (acc === 'salida' || acc === 'llegada') {
        if ($('sMec') && !v('sMec')) return err('Indica el mecánico.');
        accion = 'evento'; datos = { id: a.id, evento: acc === 'salida' ? 'SALIDA' : 'LLEGADA', datos: Object.assign($('sMec') ? mec() : {}, { ts: deInputLocal(v('sTs')) }) };
      } else if (acc === 'cierre') {
        if ($('sMec') && !v('sMec')) return err('Indica el mecánico.');
        if (!v('sDiag') || !v('sTrab')) return err('Escribe diagnóstico y trabajo realizado.');
        if (!v('sRes')) return err('Indica el resultado.');
        if (v('sRes') === 'GRUA' && !v('sGDest')) return err('Indica el destino de la grúa.');
        const fotos = [];
        for (const file of Array.from(($('sFotos') && $('sFotos').files) || []).slice(0, 4)) fotos.push({ dataUrl: (await AR.fotos.comprimir(file)).dataUrl });
        accion = 'cerrar'; datos = { id: a.id, fotos, cierre: Object.assign($('sMec') ? mec() : {}, {
          resultado: v('sRes'), finEn: deInputLocal(v('sTs')), llegadaEn: v('sLleg') ? deInputLocal(v('sLleg')) : '',
          diagnostico: v('sDiag'), trabajoRealizado: v('sTrab'), repuestos: v('sRep'),
          gruaProveedor: v('sGProv'), gruaDestino: v('sGDest'), gruaMotivo: v('sGMot'), observaciones: v('sObs') }) };
      } else if (acc === 'grua') {
        accion = 'evento'; datos = { id: a.id, evento: 'ENTREGA_GRUA', datos: { ts: deInputLocal(v('sTs')), destino: v('sGDest') } };
      } else if (acc === 'nota') {
        if (!v('sNota')) return err('Escribe la nota.');
        accion = 'evento'; datos = { id: a.id, evento: 'NOTA', datos: { nota: v('sNota') } };
      } else if (acc === 'anular') {
        if (!v('sMot')) return err('Indica el motivo.');
        accion = 'anular'; datos = { id: a.id, motivo: v('sMot') };
      } else if (acc === 'reabrir') {
        if (!v('sMot')) return err('Indica el motivo.');
        accion = 'evento'; datos = { id: a.id, evento: 'REABRIR', datos: { motivo: v('sMot') } };
      } else if (acc === 'editar') {
        const cambios = {};
        const map = { UNIDAD: 'unidad', CISTERNA: 'cisterna', AREA: 'area', PRIORIDAD: 'prioridad', DEPARTAMENTO: 'departamento', REFERENCIA: 'referencia', PILOTO_NOMBRE: 'pilotoNombre', PILOTO_TEL: 'pilotoTel',
          MECANICO_NOMBRE: 'mecanicoNombre', MECANICO_TEL: 'mecanicoTel', DESCRIPCION: 'descripcion', DIAGNOSTICO: 'diagnostico', TRABAJO_REALIZADO: 'trabajoRealizado' };
        Object.keys(map).forEach((k) => { if ($('e' + k) && v('e' + k) !== String(a[map[k]] || '')) cambios[k] = v('e' + k); });
        [['ASIGNADO_EN', 'asignadoEn'], ['SALIDA_EN', 'salidaEn'], ['LLEGADA_EN', 'llegadaEn'], ['FIN_EN', 'finEn']].forEach(([k, c]) => {
          const nuevo = v('e' + k), antes = a[c] ? aInputLocal(a[c]) : '';
          if (nuevo !== antes) cambios[k] = nuevo ? deInputLocal(nuevo) : '';
        });
        if (!Object.keys(cambios).length) return err('No hiciste cambios.');
        accion = 'editar'; datos = { id: a.id, cambios };
      }
      const btn = $('sForm').querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Guardando…';
      const r = await AR.api.llamar(accion, datos);
      AR.ui.toast('Guardado ✔', 'ok');
      lista = lista.map((x) => x.id === r.asistencia.id ? r.asistencia : x);
      pintar();
      await abrirCaso(r.asistencia.id, true);
    } catch (e) { if ($('sErr')) err(e.message); else AR.ui.toast(e.message, 'rojo'); const btn = $('sForm') && $('sForm').querySelector('button[type=submit]'); if (btn) { btn.disabled = false; btn.textContent = 'Reintentar'; } }
  }

  async function expedientePdf() {
    try {
      AR.ui.toast('Generando PDF…', '', 2500);
      const a = (detalle && detalle.asistencia) || casoAbierto;
      const fotos = async (ids) => { const out = []; for (const id of AR.idsFotos(ids)) { try { out.push(await AR.fotoRemota(id)); } catch (e) { /* sin foto */ } } return out; };
      let firma = '';
      if (a.firma) { try { firma = await AR.fotoRemota(a.firma); } catch (e) { /* sin firma */ } }
      const blob = await AR.pdf.crear('completo', a, { reporte: await fotos(a.fotosReporte), cierre: await fotos(a.fotosCierre) }, firma);
      AR.descargar(blob, AR.pdf.nombre('completo', a));
    } catch (e) { AR.ui.toast(e.message, 'rojo'); }
  }

  /* =========================================================
     REGISTRO MANUAL
     ========================================================= */
  $('nFecha').value = aInputLocal(null);
  $('nUnidad').addEventListener('change', () => {
    $('nUnidad').value = U.normCodigo($('nUnidad').value);
    const u = AR.catalogos.unidad($('nUnidad').value);
    $('nUnidadInfo').textContent = u ? [u.tipo, u.placa, u.marca, u.piloto].filter(Boolean).join(' · ') : ($('nUnidad').value ? 'No está en el catálogo' : '');
    if (u && u.acople && !$('nCisterna').value) $('nCisterna').value = u.acople;
    if (u && u.piloto && !$('nPiloto').value) { $('nPiloto').value = u.piloto; $('nPiloto').dispatchEvent(new Event('change')); }
  });
  $('nPiloto').addEventListener('change', () => {
    const p = ((AR.catalogos.datos && AR.catalogos.datos.pilotos) || []).find((x) => x.nombre === $('nPiloto').value);
    if (p && p.tel && !$('nTel').value) $('nTel').value = p.tel;
  });
  function leerCoord(t) {
    t = String(t || '');
    const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(t) || /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(t) || /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})/.exec(t);
    if (!m) return null;
    const lat = +m[1], lng = +m[2];
    return lat > 13 && lat < 18.5 && lng > -92.5 && lng < -88 ? { lat, lng } : null;
  }
  $('nCoord').addEventListener('change', async () => {
    const c = leerCoord($('nCoord').value);
    if (!$('nCoord').value) { $('nCoordInfo').textContent = ''; return; }
    if (!c) { $('nCoordInfo').innerHTML = '<span style="color:var(--ar-ambar)">No se reconocieron coordenadas de Guatemala. Revisa el texto o el enlace (los enlaces cortos maps.app.goo.gl no traen coordenadas: ábrelo y copia la dirección completa).</span>'; return; }
    const dep = await AR.geo.departamento(c.lat, c.lng);
    $('nCoordInfo').textContent = c.lat + ', ' + c.lng + (dep ? ' · ' + dep : '');
    if (dep) $('nDepto').value = dep;
  });
  function pintarNuevasFotos() {
    const cont = $('nFotos'), add = $('nFotoAdd');
    cont.querySelectorAll('.ar-foto').forEach((n) => n.remove());
    nuevasFotos.forEach((src, i) => {
      const d = document.createElement('div'); d.className = 'ar-foto'; d.innerHTML = '<img alt=""><button type="button" aria-label="Quitar">×</button>';
      d.querySelector('img').src = src; d.querySelector('button').onclick = () => { nuevasFotos.splice(i, 1); pintarNuevasFotos(); };
      cont.insertBefore(d, add);
    });
    add.classList.toggle('ar-oculto', nuevasFotos.length >= 4);
  }
  $('nFoto').addEventListener('change', async (ev) => {
    for (const f of Array.from(ev.target.files || [])) { if (nuevasFotos.length >= 4) break; try { nuevasFotos.push((await AR.fotos.comprimir(f)).dataUrl); } catch (e) { AR.ui.toast(e.message, 'rojo'); } }
    ev.target.value = ''; pintarNuevasFotos();
  });

  $('fNuevo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = (id) => $(id).value.trim();
    const err = (m) => { $('nError').textContent = m; $('nError').classList.remove('ar-oculto'); };
    $('nError').classList.add('ar-oculto');
    if (!v('nFecha')) return err('Indica fecha y hora del reporte.');
    if (!v('nUnidad')) return err('Indica la unidad.');
    if (!v('nArea')) return err('Elige el área.');
    if (v('nDesc').length < 3) return err('Describe la falla.');
    if (!v('nMueve') || !v('nCarga')) return err('Indica si puede moverse y si va con carga.');
    if (!v('nDepto')) return err('Elige el departamento.');
    const u = AR.catalogos.unidad(v('nUnidad')), p = ((AR.catalogos.datos && AR.catalogos.datos.pilotos) || []).find((x) => x.nombre === v('nPiloto'));
    const c = leerCoord(v('nCoord'));
    const caso = { uid: U.uid(), creadoEn: deInputLocal(v('nFecha')), unidad: U.normCodigo(v('nUnidad')), tipoUnidad: u ? u.tipo : '', cisterna: v('nCisterna') ? U.normCodigo(v('nCisterna')) : '',
      componente: v('nComp'), pilotoId: p ? p.id : '', pilotoNombre: v('nPiloto'), pilotoTel: v('nTel'), area: v('nArea'), descripcion: v('nDesc'),
      puedeMoverse: v('nMueve'), conCarga: v('nCarga'), lat: c ? c.lat : '', lng: c ? c.lng : '', departamento: v('nDepto'), referencia: v('nRef'),
      origenDetalle: v('nOrigen'), observaciones: v('nObs') };
    const b = $('bRegistrar'); b.disabled = true; b.textContent = 'Registrando…';
    try {
      const r = await AR.api.llamar('crear', { caso, fotos: nuevasFotos.map((d) => ({ dataUrl: d })) });
      AR.ui.toast('Registrada ' + r.asistencia.correlativo + ' ✔', 'ok', 5000);
      $('fNuevo').reset(); nuevasFotos = []; pintarNuevasFotos(); $('nFecha').value = aInputLocal(null); $('nUnidadInfo').textContent = ''; $('nCoordInfo').textContent = '';
      await cargar(true); irA('activas'); abrirCaso(r.asistencia.id);
    } catch (e) { err(e.message); }
    finally { b.disabled = false; b.textContent = 'Registrar asistencia'; }
  });

  /* Importar PDF generado por la app: si no existe en el sistema se crea con los mismos datos (mismo ID, sin duplicar);
     si es un cierre y la asistencia sigue abierta, se registra el cierre. */
  $('nPdf').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []); ev.target.value = '';
    for (const f of files) {
      try {
        const d = await AR.pdf.leerDatos(f), c = d.caso;
        const id = c.id || c.uid;
        await cargar(true);
        let existe = lista.find((a) => a.id === id || (c.correlativo && a.correlativo === c.correlativo));
        if (!existe) {
          const caso = Object.assign({}, c, { uid: id, origenDetalle: 'Importado de PDF', precision: c.precisionM || c.precision });
          const r = await AR.api.llamar('crear', { caso });
          existe = r.asistencia; AR.ui.toast(f.name + ': registrada como ' + existe.correlativo, 'ok', 5000);
        } else AR.ui.toast(f.name + ': ya estaba registrada (' + existe.correlativo + ')', '', 4000);
        if ((d.tipo === 'cierre' || d.tipo === 'completo') && c.resultado && AR.ACTIVOS.includes(existe.estado) && existe.estado !== 'EN_GRUA') {
          const r = await AR.api.llamar('cerrar', { id: existe.id, cierre: {
            resultado: c.resultado === 'Requiere grúa' ? 'GRUA' : 'HABILITADA', finEn: c.finEn, salidaEn: c.salidaEn, llegadaEn: c.llegadaEn,
            mecanicoNombre: c.mecanicoNombre, mecanicoTipo: c.mecanicoTipo, tallerExterno: c.tallerExterno, mecanicoTel: c.mecanicoTel,
            diagnostico: c.diagnostico, trabajoRealizado: c.trabajoRealizado, repuestos: c.repuestos,
            gruaProveedor: c.gruaProveedor, gruaDestino: c.gruaDestino, gruaMotivo: c.gruaMotivo, observaciones: 'Cierre importado de PDF' } });
          existe = r.asistencia; AR.ui.toast(f.name + ': cierre registrado', 'ok', 5000);
        }
        await cargar(true);
        if (files.length === 1) { irA('activas'); abrirCaso(existe.id); }
      } catch (e) { AR.ui.toast(f.name + ': ' + e.message, 'rojo', 7000); }
    }
  });

  /* =========================================================
     Arranque
     ========================================================= */
  if (AR.sesion.pin() && AR.catalogos.datos && ['taller', 'consulta'].includes(AR.catalogos.datos.rol)) {
    iniciar();
    AR.catalogos.cargar(true).then(() => { llenarCatalogos(); }, (e) => { if (!e.red) { AR.sesion.salir(); location.reload(); } });
  } else {
    $('vLogin').classList.remove('ar-oculto');
    $('lNombre').value = AR.sesion.usuario();
  }
})();
