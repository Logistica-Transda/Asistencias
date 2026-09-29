/**
 * ASISTENCIAS EN RUTA — TRANSDA / Gasolineras Don Arturo
 * Backend en Google Apps Script sobre la Google Sheet "Asistencias en Ruta TRANSDA".
 *
 * Instalación (una sola vez):
 *   1. Menú Asistencias ▸ Configurar sistema   (o ejecuta configurarSistema() desde el editor)
 *   2. Implementar ▸ Nueva implementación ▸ Aplicación web
 *        Ejecutar como: Yo    ·    Quién tiene acceso: Cualquier persona
 *   3. Copia la URL que termina en /exec y pégala en config.js de la app.
 *
 * Todas las llamadas llegan por POST (texto JSON) con {accion, pin, usuario, ...}.
 * La seguridad es por PIN de rol (hoja Config). Las fotos se guardan PRIVADAS en Drive
 * y solo se entregan a través de esta API con un PIN válido.
 */

const VERSION = '1.0.0';
const HOJA = {
  ASIS: 'Asistencias', BIT: 'Bitacora', UNI: 'Unidades', PIL: 'Pilotos',
  MEC: 'Mecanicos', AREAS: 'Areas', DEP: 'Departamentos', CFG: 'Config'
};
const ESTADOS_ACTIVOS = ['REPORTADA', 'ASIGNADA', 'EN_RUTA', 'EN_SITIO', 'EN_GRUA'];
const ESTADOS = ESTADOS_ACTIVOS.concat(['CERRADA', 'ANULADA']);
const AREAS_VALIDAS = ['Mecánica', 'Electromecánica', 'Llantas', 'Soldadura', 'Otro'];
const MAX_FOTOS = 6;

const ASIST_COLS = [
  'ID', 'CORRELATIVO', 'ESTADO', 'ORIGEN', 'CREADO_EN', 'CREADO_POR',
  'UNIDAD', 'TIPO_UNIDAD', 'CISTERNA', 'COMPONENTE', 'PILOTO_ID', 'PILOTO_NOMBRE', 'PILOTO_TEL',
  'AREA', 'DESCRIPCION', 'PUEDE_MOVERSE', 'CON_CARGA', 'PRIORIDAD',
  'LAT', 'LNG', 'PRECISION_M', 'DEPARTAMENTO', 'REFERENCIA',
  'FOTOS_REPORTE',
  'MECANICO_NOMBRE', 'MECANICO_TIPO', 'TALLER_EXTERNO', 'MECANICO_TEL',
  'ASIGNADO_EN', 'SALIDA_EN', 'LLEGADA_EN', 'LLEGADA_LAT', 'LLEGADA_LNG', 'FIN_EN',
  'DIAGNOSTICO', 'TRABAJO_REALIZADO', 'REPUESTOS', 'RESULTADO',
  'GRUA_PROVEEDOR', 'GRUA_DESTINO', 'GRUA_MOTIVO',
  'FOTOS_CIERRE', 'FIRMA', 'CERRADO_EN', 'CERRADO_POR', 'OBSERVACIONES',
  'MIN_ASIGNACION', 'MIN_LLEGADA', 'MIN_REPARACION', 'MIN_TOTAL', 'ACTUALIZADO_EN'
];
const BIT_COLS = ['FECHA_HORA', 'ID', 'CORRELATIVO', 'EVENTO', 'ESTADO_ANTERIOR', 'ESTADO_NUEVO', 'USUARIO', 'ROL', 'DETALLE'];
const COLS_FECHA = ['CREADO_EN', 'ASIGNADO_EN', 'SALIDA_EN', 'LLEGADA_EN', 'FIN_EN', 'CERRADO_EN', 'ACTUALIZADO_EN'];

// Qué rol puede ejecutar cada acción
const PERMISOS = {
  catalogos:      ['piloto', 'mecanico', 'taller', 'consulta'],
  crear:          ['piloto', 'taller'],
  listarActivas:  ['mecanico', 'taller', 'consulta'],
  listar:         ['taller', 'consulta'],
  detalle:        ['mecanico', 'taller', 'consulta'],
  evento:         ['mecanico', 'taller'],
  cerrar:         ['mecanico', 'taller'],
  editar:         ['taller'],
  anular:         ['taller'],
  foto:           ['mecanico', 'taller', 'consulta']
};

/* ============================ ENTRADA HTTP ============================ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.accion || p.accion === 'ping') {
    return salida_({ ok: true, sistema: 'Asistencias en Ruta TRANSDA', version: VERSION, hora: new Date().toISOString() });
  }
  return salida_(manejar_(p));
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return salida_({ ok: false, error: 'Solicitud inválida (JSON).' }); }
  return salida_(manejar_(req));
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function manejar_(req) {
  try {
    if (req.accion === 'ping') return { ok: true, version: VERSION, hora: new Date().toISOString() };
    const fn = ACCIONES_[req.accion];
    if (!fn) throw new Error('Acción desconocida: ' + req.accion);
    const rol = autenticar_(req.pin);
    if (PERMISOS[req.accion].indexOf(rol) < 0) throw new Error('Tu PIN no tiene permiso para esta acción.');
    const ctx = { rol: rol, usuario: texto_(req.usuario, 80) || rol };
    const res = fn(req, ctx) || {};
    res.ok = true; res.rol = rol; res.version = VERSION;
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

const ACCIONES_ = {
  catalogos: accCatalogos_,
  crear: accCrear_,
  listarActivas: function (req) { return { asistencias: leerAsistencias_().filter(esActiva_).map(publica_) }; },
  listar: accListar_,
  detalle: accDetalle_,
  evento: accEvento_,
  cerrar: accCerrar_,
  editar: accEditar_,
  anular: accAnular_,
  foto: accFoto_
};

/* ============================ AUTENTICACIÓN ============================ */

function autenticar_(pin) {
  pin = String(pin || '').trim();
  if (!pin) throw new Error('Ingresa tu PIN.');
  const c = config_();
  const mapa = { PIN_TALLER: 'taller', PIN_MECANICO: 'mecanico', PIN_PILOTO: 'piloto', PIN_CONSULTA: 'consulta' };
  for (const k in mapa) if (c[k] && String(c[k]).trim() === pin) return mapa[k];
  Utilities.sleep(800); // frena intentos repetidos
  throw new Error('PIN incorrecto.');
}

/* ============================ ACCIONES ============================ */

function accCatalogos_() {
  const c = config_();
  const activo = function (r) { return String(r.ACTIVO || 'SI').toUpperCase() !== 'NO'; };
  return {
    unidades: leerTabla_(HOJA.UNI).filter(activo).map(function (r) {
      return { codigo: r.CODIGO, tipo: r.TIPO, placa: r.PLACA, marca: r.MARCA, modelo: r.MODELO,
               acople: r.ACOPLE, capacidad: r.CAPACIDAD_GAL, piloto: r.PILOTO_ASIGNADO, region: r.REGION_BASE };
    }),
    pilotos: leerTabla_(HOJA.PIL).filter(activo).map(function (r) {
      return { id: r.ID_AURORA, nombre: r.NOMBRE, unidad: r.UNIDAD, cisterna: r.CISTERNA, region: r.REGION, tel: r.TELEFONO };
    }),
    mecanicos: leerTabla_(HOJA.MEC).filter(function (r) { return activo(r) && r.NOMBRE && !/^\(ejemplo\)/i.test(r.NOMBRE); })
      .map(function (r) { return { nombre: r.NOMBRE, tipo: r.TIPO, taller: r.TALLER, tel: r.TELEFONO, region: r.REGION, areas: r.AREAS }; }),
    areas: leerTabla_(HOJA.AREAS).map(function (r) { return { area: r.AREA, descripcion: r.DESCRIPCION }; }),
    departamentos: leerTabla_(HOJA.DEP).map(function (r) { return r.DEPARTAMENTO; }),
    config: {
      whatsappTaller: String(c.WHATSAPP_TALLER || ''),
      horasAmbar: Number(c.HORAS_ALERTA_AMBAR) || 2,
      horasRoja: Number(c.HORAS_ALERTA_ROJA) || 4
    }
  };
}

function accCrear_(req, ctx) {
  const d = req.caso || {};
  const unidad = normCodigo_(d.unidad);
  if (!unidad) throw new Error('Falta la unidad.');
  if (AREAS_VALIDAS.indexOf(d.area) < 0) throw new Error('Área de falla inválida.');
  if (!texto_(d.descripcion)) throw new Error('Describe la falla.');
  if (!d.uid) throw new Error('Falta el identificador del reporte (uid).');

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const existentes = leerAsistencias_();
    const dup = existentes.filter(function (a) { return a.ID === d.uid; })[0];
    if (dup) return { asistencia: publica_(dup), duplicado: true };

    const creado = fechaCliente_(d.creadoEn);
    const correlativo = siguienteCorrelativo_(existentes, creado);
    const fotos = guardarFotos_(req.fotos, correlativo, 'reporte');
    const uni = buscarUnidad_(unidad);
    const fila = {
      ID: d.uid, CORRELATIVO: correlativo, ESTADO: 'REPORTADA',
      ORIGEN: ctx.rol === 'piloto' ? 'Piloto' : ('Taller' + (d.origenDetalle ? ' — ' + texto_(d.origenDetalle, 60) : '')),
      CREADO_EN: creado, CREADO_POR: ctx.usuario,
      UNIDAD: unidad, TIPO_UNIDAD: (uni && uni.TIPO) || texto_(d.tipoUnidad, 30),
      CISTERNA: normCodigo_(d.cisterna) || (uni && uni.ACOPLE) || '',
      COMPONENTE: texto_(d.componente, 30),
      PILOTO_ID: texto_(d.pilotoId, 20), PILOTO_NOMBRE: texto_(d.pilotoNombre, 80), PILOTO_TEL: texto_(d.pilotoTel, 20),
      AREA: d.area, DESCRIPCION: texto_(d.descripcion, 2000),
      PUEDE_MOVERSE: siNo_(d.puedeMoverse), CON_CARGA: siNo_(d.conCarga),
      PRIORIDAD: texto_(d.prioridad, 10) || 'Media',
      LAT: num_(d.lat), LNG: num_(d.lng), PRECISION_M: num_(d.precision),
      DEPARTAMENTO: texto_(d.departamento, 40), REFERENCIA: texto_(d.referencia, 300),
      FOTOS_REPORTE: fotos.join(','),
      OBSERVACIONES: texto_(d.observaciones, 1000),
      ACTUALIZADO_EN: new Date()
    };
    escribirAsistencia_(fila, true);
    bitacora_(fila, 'CREADA', '', 'REPORTADA', ctx, fila.AREA + ' · ' + fila.DESCRIPCION.slice(0, 120));
    return { asistencia: publica_(fila) };
  } finally { lock.releaseLock(); }
}

function accListar_(req) {
  const desde = req.desde ? new Date(req.desde + 'T00:00:00-06:00') : null;
  const hasta = req.hasta ? new Date(req.hasta + 'T23:59:59-06:00') : null;
  const lista = leerAsistencias_().filter(function (a) {
    if (esActiva_(a)) return true; // las activas siempre se devuelven
    const f = a.CREADO_EN instanceof Date ? a.CREADO_EN : new Date(a.CREADO_EN);
    return (!desde || f >= desde) && (!hasta || f <= hasta);
  });
  return { asistencias: lista.map(publica_) };
}

function accDetalle_(req) {
  const a = buscarAsistencia_(req.id);
  const bit = leerTabla_(HOJA.BIT).filter(function (b) { return b.ID === a.ID; }).map(function (b) {
    return { fecha: iso_(b.FECHA_HORA), evento: b.EVENTO, de: b.ESTADO_ANTERIOR, a: b.ESTADO_NUEVO,
             usuario: b.USUARIO, rol: b.ROL, detalle: b.DETALLE };
  });
  const pub = publica_(a);
  pub.firma = a.FIRMA || '';
  return { asistencia: pub, bitacora: bit };
}

/**
 * Eventos intermedios: ASIGNAR, SALIDA, LLEGADA, NOTA, ENTREGA_GRUA (cierra un caso en grúa),
 * REABRIR (solo taller).
 */
function accEvento_(req, ctx) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const a = buscarAsistencia_(req.id);
    const ev = String(req.evento || '').toUpperCase();
    const d = req.datos || {};
    const ts = fechaCliente_(d.ts);
    const antes = a.ESTADO;
    if (a.ESTADO === 'ANULADA') throw new Error('La asistencia está anulada.');
    if (a.ESTADO === 'CERRADA' && ev !== 'NOTA' && ev !== 'REABRIR') throw new Error('La asistencia ya está cerrada.');
    let detalle = '';

    switch (ev) {
      case 'ASIGNAR':
        if (!texto_(d.mecanicoNombre)) throw new Error('Indica el mecánico.');
        a.MECANICO_NOMBRE = texto_(d.mecanicoNombre, 80);
        a.MECANICO_TIPO = d.mecanicoTipo === 'Externo' ? 'Externo' : 'Interno';
        a.TALLER_EXTERNO = texto_(d.tallerExterno, 80);
        a.MECANICO_TEL = texto_(d.mecanicoTel, 20);
        a.ASIGNADO_EN = a.ASIGNADO_EN || ts;
        if (a.ESTADO === 'REPORTADA') a.ESTADO = 'ASIGNADA';
        detalle = a.MECANICO_NOMBRE + ' (' + a.MECANICO_TIPO + (a.TALLER_EXTERNO ? ' · ' + a.TALLER_EXTERNO : '') + ')';
        break;
      case 'SALIDA':
        a.SALIDA_EN = ts;
        if (!a.ASIGNADO_EN) a.ASIGNADO_EN = ts;
        if (d.mecanicoNombre && !a.MECANICO_NOMBRE) { a.MECANICO_NOMBRE = texto_(d.mecanicoNombre, 80); a.MECANICO_TIPO = d.mecanicoTipo || 'Interno'; }
        if (['REPORTADA', 'ASIGNADA'].indexOf(a.ESTADO) >= 0) a.ESTADO = 'EN_RUTA';
        detalle = 'Mecánico en ruta';
        break;
      case 'LLEGADA':
        a.LLEGADA_EN = ts; a.LLEGADA_LAT = num_(d.lat); a.LLEGADA_LNG = num_(d.lng);
        if (!a.ASIGNADO_EN) a.ASIGNADO_EN = a.SALIDA_EN || ts;
        if (d.mecanicoNombre && !a.MECANICO_NOMBRE) { a.MECANICO_NOMBRE = texto_(d.mecanicoNombre, 80); a.MECANICO_TIPO = d.mecanicoTipo || 'Interno'; }
        if (['REPORTADA', 'ASIGNADA', 'EN_RUTA'].indexOf(a.ESTADO) >= 0) a.ESTADO = 'EN_SITIO';
        detalle = 'Llegada al sitio' + (d.lat ? ' (' + Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5) + ')' : '');
        break;
      case 'ENTREGA_GRUA':
        if (a.ESTADO !== 'EN_GRUA') throw new Error('La asistencia no está en grúa.');
        a.ESTADO = 'CERRADA'; a.CERRADO_EN = ts; a.CERRADO_POR = ctx.usuario;
        detalle = 'Unidad entregada por grúa en ' + (texto_(d.destino, 80) || a.GRUA_DESTINO || 'destino');
        break;
      case 'REABRIR':
        if (ctx.rol !== 'taller') throw new Error('Solo el taller puede reabrir.');
        a.ESTADO = a.LLEGADA_EN ? 'EN_SITIO' : (a.MECANICO_NOMBRE ? 'ASIGNADA' : 'REPORTADA');
        a.CERRADO_EN = ''; a.CERRADO_POR = '';
        detalle = texto_(d.motivo, 300) || 'Reabierta';
        break;
      case 'NOTA':
        detalle = texto_(d.nota, 1000);
        if (!detalle) throw new Error('La nota está vacía.');
        a.OBSERVACIONES = (a.OBSERVACIONES ? a.OBSERVACIONES + '\n' : '') + '[' + fmt_(new Date()) + ' ' + ctx.usuario + '] ' + detalle;
        break;
      default:
        throw new Error('Evento desconocido: ' + ev);
    }
    calcularTiempos_(a);
    a.ACTUALIZADO_EN = new Date();
    escribirAsistencia_(a, false);
    bitacora_(a, ev, antes, a.ESTADO, ctx, detalle);
    return { asistencia: publica_(a) };
  } finally { lock.releaseLock(); }
}

function accCerrar_(req, ctx) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const a = buscarAsistencia_(req.id);
    const d = req.cierre || {};
    if (a.ESTADO === 'ANULADA') throw new Error('La asistencia está anulada.');
    if (a.ESTADO === 'CERRADA') return { asistencia: publica_(a), duplicado: true };
    const resultado = String(d.resultado || '').toUpperCase();
    if (['HABILITADA', 'GRUA'].indexOf(resultado) < 0) throw new Error('Indica si la unidad quedó habilitada o requiere grúa.');
    if (!texto_(d.trabajoRealizado) && !texto_(d.diagnostico)) throw new Error('Describe el diagnóstico o el trabajo realizado.');
    if (!texto_(d.mecanicoNombre) && !a.MECANICO_NOMBRE) throw new Error('Indica el nombre del mecánico.');
    const antes = a.ESTADO;
    const fin = fechaCliente_(d.finEn);

    if (texto_(d.mecanicoNombre)) {
      a.MECANICO_NOMBRE = texto_(d.mecanicoNombre, 80);
      a.MECANICO_TIPO = d.mecanicoTipo === 'Externo' ? 'Externo' : 'Interno';
      a.TALLER_EXTERNO = texto_(d.tallerExterno, 80) || a.TALLER_EXTERNO;
      a.MECANICO_TEL = texto_(d.mecanicoTel, 20) || a.MECANICO_TEL;
    }
    // Horas que el mecánico registró sin conexión (si no llegaron como eventos)
    if (d.salidaEn && !a.SALIDA_EN) a.SALIDA_EN = fechaCliente_(d.salidaEn);
    if (d.llegadaEn && !a.LLEGADA_EN) { a.LLEGADA_EN = fechaCliente_(d.llegadaEn); a.LLEGADA_LAT = num_(d.llegadaLat); a.LLEGADA_LNG = num_(d.llegadaLng); }
    if (!a.ASIGNADO_EN) a.ASIGNADO_EN = a.SALIDA_EN || a.LLEGADA_EN || fin;

    a.FIN_EN = fin;
    a.DIAGNOSTICO = texto_(d.diagnostico, 2000);
    a.TRABAJO_REALIZADO = texto_(d.trabajoRealizado, 2000);
    a.REPUESTOS = texto_(d.repuestos, 1000);
    a.RESULTADO = resultado === 'GRUA' ? 'Requiere grúa' : 'Habilitada';
    if (resultado === 'GRUA') {
      a.GRUA_PROVEEDOR = texto_(d.gruaProveedor, 80);
      a.GRUA_DESTINO = texto_(d.gruaDestino, 120);
      a.GRUA_MOTIVO = texto_(d.gruaMotivo, 500);
      a.ESTADO = 'EN_GRUA';
    } else {
      a.ESTADO = 'CERRADA';
      a.CERRADO_EN = fin; a.CERRADO_POR = ctx.usuario;
    }
    const nuevas = guardarFotos_(req.fotos, a.CORRELATIVO, 'cierre');
    a.FOTOS_CIERRE = [a.FOTOS_CIERRE].concat(nuevas).filter(String).join(',');
    if (d.firma && /^data:image\/png;base64,/.test(d.firma)) {
      a.FIRMA = guardarFotos_([{ nombre: 'firma.png', dataUrl: d.firma }], a.CORRELATIVO, 'firma')[0] || '';
    }
    if (texto_(d.observaciones)) a.OBSERVACIONES = (a.OBSERVACIONES ? a.OBSERVACIONES + '\n' : '') + texto_(d.observaciones, 1000);
    calcularTiempos_(a);
    a.ACTUALIZADO_EN = new Date();
    escribirAsistencia_(a, false);
    bitacora_(a, 'CIERRE_MECANICO', antes, a.ESTADO, ctx, a.RESULTADO + ' · ' + (a.TRABAJO_REALIZADO || a.DIAGNOSTICO).slice(0, 150));
    return { asistencia: publica_(a) };
  } finally { lock.releaseLock(); }
}

/** Corrección manual del taller: solo campos de texto/catálogo, nunca ID ni correlativo. */
function accEditar_(req, ctx) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const a = buscarAsistencia_(req.id);
    const editables = ['UNIDAD', 'CISTERNA', 'COMPONENTE', 'PILOTO_NOMBRE', 'PILOTO_TEL', 'AREA', 'DESCRIPCION', 'PRIORIDAD',
      'DEPARTAMENTO', 'REFERENCIA', 'MECANICO_NOMBRE', 'MECANICO_TIPO', 'TALLER_EXTERNO', 'MECANICO_TEL',
      'DIAGNOSTICO', 'TRABAJO_REALIZADO', 'REPUESTOS', 'GRUA_PROVEEDOR', 'GRUA_DESTINO', 'GRUA_MOTIVO',
      'ASIGNADO_EN', 'SALIDA_EN', 'LLEGADA_EN', 'FIN_EN', 'CERRADO_EN'];
    const cambios = [];
    const c = req.cambios || {};
    Object.keys(c).forEach(function (k) {
      if (editables.indexOf(k) < 0) return;
      let v = c[k];
      if (COLS_FECHA.indexOf(k) >= 0) v = v ? fechaCliente_(v) : '';
      else if (k === 'AREA' && AREAS_VALIDAS.indexOf(v) < 0) return;
      else if (k === 'UNIDAD' || k === 'CISTERNA') v = normCodigo_(v);
      else v = texto_(v, 2000);
      cambios.push(k + ': ' + fmtValor_(a[k]) + ' → ' + fmtValor_(v));
      a[k] = v;
    });
    if (!cambios.length) throw new Error('No hay cambios válidos.');
    calcularTiempos_(a);
    a.ACTUALIZADO_EN = new Date();
    escribirAsistencia_(a, false);
    bitacora_(a, 'EDICION', a.ESTADO, a.ESTADO, ctx, cambios.join(' | ').slice(0, 1500));
    return { asistencia: publica_(a) };
  } finally { lock.releaseLock(); }
}

function accAnular_(req, ctx) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const a = buscarAsistencia_(req.id);
    const motivo = texto_(req.motivo, 300);
    if (!motivo) throw new Error('Indica el motivo de anulación.');
    const antes = a.ESTADO;
    a.ESTADO = 'ANULADA'; a.ACTUALIZADO_EN = new Date();
    escribirAsistencia_(a, false);
    bitacora_(a, 'ANULADA', antes, 'ANULADA', ctx, motivo);
    return { asistencia: publica_(a) };
  } finally { lock.releaseLock(); }
}

function accFoto_(req) {
  const id = String(req.fileId || '');
  if (!/^[\w-]{10,}$/.test(id)) throw new Error('Foto inválida.');
  const raiz = config_().CARPETA_FOTOS_ID;
  const file = DriveApp.getFileById(id);
  if (!enCarpeta_(file, raiz)) throw new Error('La foto no pertenece al sistema.');
  const blob = file.getBlob();
  return { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()), nombre: file.getName() };
}

/* ============================ DATOS ============================ */

function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function hoja_(nombre) {
  const sh = libro_().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja "' + nombre + '". Ejecuta Asistencias ▸ Configurar sistema.');
  return sh;
}

function leerTabla_(nombre) {
  const sh = hoja_(nombre);
  const valores = sh.getDataRange().getValues();
  if (valores.length < 2) return [];
  const enc = valores[0].map(function (h) { return String(h).trim(); });
  const out = [];
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i];
    if (fila.every(function (v) { return v === '' || v === null; })) continue;
    const o = { _fila: i + 1 };
    enc.forEach(function (h, j) { if (h) o[h] = fila[j]; });
    out.push(o);
  }
  return out;
}

function leerAsistencias_() { return leerTabla_(HOJA.ASIS); }

function buscarAsistencia_(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el ID de la asistencia.');
  const a = leerAsistencias_().filter(function (x) { return x.ID === id || x.CORRELATIVO === id; })[0];
  if (!a) throw new Error('No se encontró la asistencia ' + id + '.');
  return a;
}

function escribirAsistencia_(obj, nueva) {
  const sh = hoja_(HOJA.ASIS);
  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const fila = enc.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  if (nueva) sh.appendRow(fila);
  else sh.getRange(obj._fila, 1, 1, fila.length).setValues([fila]);
}

function bitacora_(a, evento, antes, despues, ctx, detalle) {
  hoja_(HOJA.BIT).appendRow([new Date(), a.ID, a.CORRELATIVO, evento, antes || '', despues || '', ctx.usuario, ctx.rol, detalle || '']);
}

function buscarUnidad_(codigo) {
  return leerTabla_(HOJA.UNI).filter(function (u) { return normCodigo_(u.CODIGO) === codigo; })[0] || null;
}

function config_() {
  const c = {};
  leerTabla_(HOJA.CFG).forEach(function (r) { if (r.CLAVE) c[String(r.CLAVE).trim()] = r.VALOR; });
  return c;
}

function siguienteCorrelativo_(existentes, fecha) {
  const anio = Utilities.formatDate(fecha, 'America/Guatemala', 'yyyy');
  const pref = 'AR-' + anio + '-';
  let max = 0;
  existentes.forEach(function (a) {
    const c = String(a.CORRELATIVO || '');
    if (c.indexOf(pref) === 0) max = Math.max(max, parseInt(c.slice(pref.length), 10) || 0);
  });
  return pref + ('0000' + (max + 1)).slice(-4);
}

/** Minutos por etapa (mismos KPI de la propuesta original). */
function calcularTiempos_(a) {
  const m = function (x, y) {
    if (!x || !y) return '';
    const v = Math.round((new Date(y) - new Date(x)) / 60000);
    return v >= 0 ? v : '';
  };
  a.MIN_ASIGNACION = m(a.CREADO_EN, a.ASIGNADO_EN);
  a.MIN_LLEGADA = m(a.ASIGNADO_EN, a.LLEGADA_EN);
  a.MIN_REPARACION = m(a.LLEGADA_EN, a.FIN_EN);
  a.MIN_TOTAL = m(a.CREADO_EN, a.CERRADO_EN || '');
}

function esActiva_(a) { return ESTADOS_ACTIVOS.indexOf(a.ESTADO) >= 0; }

/** Versión para el cliente: fechas ISO, sin la firma (pesa), claves en camelCase. */
function publica_(a) {
  const o = {};
  ASIST_COLS.forEach(function (k) {
    if (k === 'FIRMA') return;
    let v = a[k];
    if (COLS_FECHA.indexOf(k) >= 0) v = iso_(v);
    o[camel_(k)] = v === undefined ? '' : v;
  });
  o.tieneFirma = !!a.FIRMA;
  return o;
}

/* ============================ FOTOS EN DRIVE ============================ */

function carpetaFotos_() {
  const id = config_().CARPETA_FOTOS_ID;
  if (!id) throw new Error('Falta CARPETA_FOTOS_ID. Ejecuta Asistencias ▸ Configurar sistema.');
  return DriveApp.getFolderById(id);
}

function guardarFotos_(fotos, correlativo, etapa) {
  if (!fotos || !fotos.length) return [];
  if (fotos.length > MAX_FOTOS + 1) throw new Error('Máximo ' + MAX_FOTOS + ' fotos por envío.');
  const raiz = carpetaFotos_();
  const mes = Utilities.formatDate(new Date(), 'America/Guatemala', 'yyyy-MM');
  const carpetaMes = subcarpeta_(raiz, mes);
  const carpeta = subcarpeta_(carpetaMes, correlativo);
  const ids = [];
  fotos.forEach(function (f, i) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(f.dataUrl || '');
    if (!m) return;
    const bytes = Utilities.base64Decode(m[3]);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Una foto supera 4 MB.');
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const nombre = correlativo + '_' + etapa + '_' + (i + 1) + '.' + ext;
    ids.push(carpeta.createFile(Utilities.newBlob(bytes, m[1], nombre)).getId());
  });
  return ids;
}

function subcarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function enCarpeta_(file, raizId) {
  // sube hasta 3 niveles: raiz / yyyy-MM / correlativo / archivo
  let nivel = [file];
  for (let i = 0; i < 3; i++) {
    const siguiente = [];
    for (let j = 0; j < nivel.length; j++) {
      const ps = nivel[j].getParents();
      while (ps.hasNext()) { const p = ps.next(); if (p.getId() === raizId) return true; siguiente.push(p); }
    }
    nivel = siguiente;
  }
  return false;
}

/* ============================ UTILIDADES ============================ */

function texto_(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  const limpio = /^[=+\-@]/.test(s) ? "'" + s : s; // evita fórmulas inyectadas en la hoja
  return max ? limpio.slice(0, max) : limpio;
}
function num_(v) { const n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? '' : n; }
function siNo_(v) { return v === true || v === 'SI' || v === 'Sí' || v === 'si' ? 'SI' : (v === false || v === 'NO' || v === 'no' ? 'NO' : ''); }
function iso_(v) { if (!v) return ''; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? '' : d.toISOString(); }
function fmt_(d) { return Utilities.formatDate(d, 'America/Guatemala', 'dd/MM/yyyy HH:mm'); }
function fmtValor_(v) { return v instanceof Date ? fmt_(v) : String(v === undefined ? '' : v); }
function camel_(k) { return k.toLowerCase().replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

/** C2, c-02, "C 002" → C02 · ER76, er-076 → ER076 */
function normCodigo_(v) {
  const s = String(v || '').toUpperCase().replace(/\s+/g, '');
  const pad = function (d, n) { while (d.length < n) d = '0' + d; return d; };
  let m = /^ER-?0*(\d+)$/.exec(s); if (m) return 'ER' + pad(m[1], 3);
  m = /^C-?0*(\d+)$/.exec(s); if (m) return 'C' + pad(m[1], 2);
  return texto_(v, 20).toUpperCase();
}

/** Usa la hora del celular (evento real, aunque llegue tarde por falta de señal) si es razonable. */
function fechaCliente_(v) {
  const ahora = new Date();
  if (!v) return ahora;
  const d = new Date(v);
  if (isNaN(d)) return ahora;
  const dif = d - ahora;
  if (dif > 10 * 60000 || dif < -7 * 24 * 3600000) return ahora; // reloj desfasado: se usa hora del servidor
  return d;
}

/* ============================ INSTALACIÓN ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Asistencias')
    .addItem('Configurar sistema', 'configurarSistema')
    .addItem('Probar conexión', 'probarConexion')
    .addSeparator()
    .addItem('Activar respaldo diario a OneDrive', 'activarRespaldoDiario')
    .addItem('Enviar respaldo ahora', 'respaldoManual')
    .addToUi();
}

function configurarSistema() {
  const ss = libro_();
  ss.setSpreadsheetTimeZone('America/Guatemala');
  const asegurar = function (nombre, cols) {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) sh.appendRow(cols);
    const enc = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    const faltan = cols.filter(function (c) { return enc.indexOf(c) < 0; });
    if (faltan.length) sh.getRange(1, enc.filter(String).length + 1, 1, faltan.length).setValues([faltan]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#2A4798').setFontColor('#FFFFFF');
    return sh;
  };
  asegurar(HOJA.ASIS, ASIST_COLS);
  asegurar(HOJA.BIT, BIT_COLS);
  asegurar(HOJA.UNI, ['CODIGO', 'TIPO', 'PLACA', 'MARCA', 'MODELO', 'ESTATUS', 'ACOPLE', 'CAPACIDAD_GAL', 'PILOTO_ASIGNADO', 'REGION_BASE', 'ACTIVO']);
  asegurar(HOJA.PIL, ['ID_AURORA', 'NOMBRE', 'TIPO', 'UNIDAD', 'CISTERNA', 'REGION', 'TELEFONO', 'ACTIVO']);
  asegurar(HOJA.MEC, ['NOMBRE', 'TIPO', 'TALLER', 'TELEFONO', 'REGION', 'AREAS', 'ACTIVO']);
  asegurar(HOJA.AREAS, ['AREA', 'DESCRIPCION']);
  asegurar(HOJA.DEP, ['DEPARTAMENTO']);
  const cfg = asegurar(HOJA.CFG, ['CLAVE', 'VALOR', 'DESCRIPCION']);

  // Formato de fecha en columnas de tiempo
  const shA = ss.getSheetByName(HOJA.ASIS);
  const encA = shA.getRange(1, 1, 1, shA.getLastColumn()).getValues()[0];
  COLS_FECHA.forEach(function (c) {
    const j = encA.indexOf(c);
    if (j >= 0) shA.getRange(2, j + 1, shA.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  });
  ss.getSheetByName(HOJA.BIT).getRange('A2:A').setNumberFormat('dd/mm/yyyy hh:mm:ss');

  // Claves de configuración que deben existir (no pisa valores ya escritos)
  const defaults = [
    ['PIN_PILOTO', '1111', 'PIN para el formulario de pilotos (cámbialo)'],
    ['PIN_MECANICO', '2222', 'PIN para el formulario de mecánicos (cámbialo)'],
    ['PIN_TALLER', '3333', 'PIN del Jefe de Taller / asistente / turno nocturno (cámbialo)'],
    ['PIN_CONSULTA', '4444', 'PIN de solo lectura: Monitoreo, Programación, Transportes, Gerencia (cámbialo)'],
    ['WHATSAPP_TALLER', '', 'Número del Jefe de Taller (502 + 8 dígitos)'],
    ['HORAS_ALERTA_AMBAR', '2', 'Horas sin cerrar para marcar en ámbar'],
    ['HORAS_ALERTA_ROJA', '4', 'Horas sin cerrar para marcar en rojo'],
    ['RESPALDO_CORREO', '', 'Correo de la empresa (Outlook) que recibe el respaldo diario en Excel'],
    ['RESPALDO_HORA', '23', 'Hora del respaldo diario (0-23, hora de Guatemala)'],
    ['RESPALDO_DIAS_DRIVE', '30', 'Días que se guardan copias del respaldo en Google Drive']
  ];
  const actual = config_();
  defaults.forEach(function (d) { if (!(d[0] in actual)) cfg.appendRow(d); });

  // Carpeta privada de fotos
  const c = config_();
  let carpetaId = c.CARPETA_FOTOS_ID;
  let valida = false;
  if (carpetaId) { try { DriveApp.getFolderById(carpetaId); valida = true; } catch (e) { valida = false; } }
  if (!valida) {
    carpetaId = DriveApp.createFolder('Asistencias en Ruta TRANSDA — Fotos').getId();
    setConfig_('CARPETA_FOTOS_ID', carpetaId, 'Carpeta de fotos (no editar)');
  }
  const msg = 'Sistema configurado.\n\nCarpeta de fotos: ' + DriveApp.getFolderById(carpetaId).getUrl() +
    '\n\nSiguiente paso: Implementar ▸ Nueva implementación ▸ Aplicación web (Ejecutar como: Yo · Acceso: Cualquier persona).' +
    '\n\nRecuerda cambiar los 4 PIN y escribir RESPALDO_CORREO en la hoja Config;' +
    ' luego usa Asistencias ▸ Activar respaldo diario a OneDrive.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function probarConexion() {
  const c = config_();
  const r = manejar_({ accion: 'catalogos', pin: c.PIN_CONSULTA });
  const msg = r.ok
    ? 'Conexión correcta.\nUnidades: ' + r.unidades.length + ' · Pilotos: ' + r.pilotos.length + ' · Mecánicos: ' + r.mecanicos.length
    : 'Error: ' + r.error;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function setConfig_(clave, valor, desc) {
  const sh = hoja_(HOJA.CFG);
  const datos = sh.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === clave) { sh.getRange(i + 1, 2).setValue(valor); return; }
  }
  sh.appendRow([clave, valor, desc || '']);
}

/* ============================ RESPALDO A ONEDRIVE ============================
 * Cada día genera un Excel (.xlsx) con las hojas de datos (SIN la hoja Config,
 * que tiene los PIN), guarda una copia en Google Drive y la envía por correo a
 * RESPALDO_CORREO. En Outlook, un flujo ESTÁNDAR de Power Automate (sin licencia
 * premium) guarda el adjunto en la carpeta de OneDrive.
 */
const HOJAS_RESPALDO = [HOJA.ASIS, HOJA.BIT, HOJA.UNI, HOJA.PIL, HOJA.MEC];
const ASUNTO_RESPALDO = '[RESPALDO-AR]';

function activarRespaldoDiario() {
  const c = config_();
  if (!/@/.test(String(c.RESPALDO_CORREO || ''))) throw new Error('Escribe RESPALDO_CORREO en la hoja Config antes de activar el respaldo.');
  const hora = Math.min(23, Math.max(0, parseInt(c.RESPALDO_HORA, 10) || 23));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'respaldoDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('respaldoDiario').timeBased().atHour(hora).everyDays(1).inTimezone('America/Guatemala').create();
  const r = respaldoDiario(); // primer envío inmediato para validar el flujo
  const msg = 'Respaldo diario activado: todos los días a las ' + hora + ':00 (hora de Guatemala).\n' +
    'Se envió un primer respaldo a ' + c.RESPALDO_CORREO + ' (' + r.archivo + ').';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return r;
}

function respaldoManual() {
  const r = respaldoDiario();
  const msg = 'Respaldo enviado: ' + r.archivo + ' → ' + r.correo;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function respaldoDiario() {
  const c = config_();
  const correo = String(c.RESPALDO_CORREO || '').trim();
  if (!correo) throw new Error('Falta RESPALDO_CORREO en la hoja Config.');
  const ahora = new Date();
  const sello = Utilities.formatDate(ahora, 'America/Guatemala', 'yyyy-MM-dd_HHmm');
  const nombre = 'Asistencias_TRANSDA_' + sello + '.xlsx';

  // 1) Libro temporal solo con las hojas de datos + un resumen
  const origen = libro_();
  const temp = SpreadsheetApp.create('tmp_respaldo_' + sello);
  try {
    HOJAS_RESPALDO.forEach(function (n) {
      const sh = origen.getSheetByName(n);
      if (sh) sh.copyTo(temp).setName(n);
    });
    const res = resumenRespaldo_(ahora);
    const hr = temp.getSheets()[0]; // hoja inicial vacía → Resumen
    hr.setName('Resumen');
    hr.getRange(1, 1, res.length, 2).setValues(res);
    temp.setActiveSheet(hr); temp.moveActiveSheet(1);
    SpreadsheetApp.flush();

    // 2) Exportar a .xlsx
    const url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=xlsx';
    const resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('No se pudo exportar a Excel (' + resp.getResponseCode() + ').');
    const blob = resp.getBlob().setName(nombre);

    // 3) Copia en Google Drive (con rotación)
    const carpeta = carpetaRespaldos_();
    carpeta.createFile(blob.copyBlob().setName(nombre));
    limpiarRespaldos_(carpeta, Number(c.RESPALDO_DIAS_DRIVE) || 30);

    // 4) Correo a Outlook → Power Automate lo guarda en OneDrive
    const activas = res.filter(function (r) { return r[0] === 'Asistencias activas'; })[0];
    MailApp.sendEmail({
      to: correo,
      subject: ASUNTO_RESPALDO + ' Asistencias TRANSDA ' + sello.replace('_', ' '),
      body: 'Respaldo automático del sistema Asistencias en Ruta TRANSDA.\n\n' +
        res.map(function (r) { return r[0] + ': ' + (r[1] instanceof Date ? fmt_(r[1]) : r[1]); }).join('\n') +
        '\n\nArchivo adjunto: ' + nombre + '\nEste correo lo procesa un flujo de Power Automate; no es necesario responder.',
      attachments: [blob],
      name: 'Asistencias en Ruta TRANSDA'
    });
    bitacoraSistema_('RESPALDO', 'Enviado a ' + correo + ' · ' + nombre + (activas ? ' · activas: ' + activas[1] : ''));
    return { archivo: nombre, correo: correo };
  } catch (err) {
    bitacoraSistema_('RESPALDO_ERROR', String(err && err.message || err));
    throw err;
  } finally {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
  }
}

function resumenRespaldo_(ahora) {
  const lista = leerAsistencias_();
  const mesActual = Utilities.formatDate(ahora, 'America/Guatemala', 'yyyy-MM');
  const delMes = lista.filter(function (a) { return a.CREADO_EN && Utilities.formatDate(new Date(a.CREADO_EN), 'America/Guatemala', 'yyyy-MM') === mesActual; });
  return [
    ['Respaldo generado', ahora],
    ['Asistencias registradas (total)', lista.length],
    ['Asistencias activas', lista.filter(esActiva_).length],
    ['Asistencias del mes', delMes.length],
    ['Del mes con grúa', delMes.filter(function (a) { return a.RESULTADO === 'Requiere grúa'; }).length],
    ['Del mes cerradas', delMes.filter(function (a) { return a.ESTADO === 'CERRADA'; }).length],
    ['Nota', 'Copia de solo lectura. El sistema oficial es la Google Sheet; los cambios aquí no se sincronizan.']
  ];
}

function carpetaRespaldos_() {
  const c = config_();
  if (c.CARPETA_RESPALDOS_ID) { try { return DriveApp.getFolderById(c.CARPETA_RESPALDOS_ID); } catch (e) { /* se recrea */ } }
  const f = DriveApp.createFolder('Asistencias en Ruta TRANSDA — Respaldos');
  setConfig_('CARPETA_RESPALDOS_ID', f.getId(), 'Carpeta de respaldos en Drive (no editar)');
  return f;
}

function limpiarRespaldos_(carpeta, dias) {
  const limite = Date.now() - dias * 86400000;
  const it = carpeta.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getDateCreated().getTime() < limite) f.setTrashed(true); }
}

function bitacoraSistema_(evento, detalle) {
  try { hoja_(HOJA.BIT).appendRow([new Date(), '', '', evento, '', '', 'Sistema', 'sistema', detalle]); } catch (e) { Logger.log(detalle); }
}
