/* ============================================================
   NÚCLEO — Asistencias en Ruta TRANSDA
   Compartido por: pilotos.html · mecanicos.html · taller.html
   Requiere: config.js (AR_CONFIG) y vendor/jspdf.umd.min.js
   ============================================================ */
(function (global) {
  'use strict';
  const CFG = global.AR_CONFIG || {};
  const AR = {};
  AR.VERSION = '1.4.0';

  /* ------------------------------------------------------------
     Estados, áreas y constantes de negocio
     ------------------------------------------------------------ */
  AR.ESTADOS = {
    REPORTADA: { txt: 'Reportada · sin mecánico', clase: 'rojo', orden: 1 },
    ASIGNADA:  { txt: 'Mecánico asignado',        clase: 'ambar', orden: 2 },
    EN_RUTA:   { txt: 'Mecánico en ruta',         clase: 'info', orden: 3 },
    EN_SITIO:  { txt: 'Mecánico en sitio',        clase: 'info', orden: 4 },
    EN_GRUA:   { txt: 'En grúa',                  clase: 'ambar', orden: 5 },
    CERRADA:   { txt: 'Cerrada',                  clase: 'ok', orden: 6 },
    ANULADA:   { txt: 'Anulada',                  clase: 'gris', orden: 7 }
  };
  AR.ACTIVOS = ['REPORTADA', 'ASIGNADA', 'EN_RUTA', 'EN_SITIO', 'EN_GRUA'];
  AR.AREAS = ['Mecánica', 'Electromecánica', 'Llantas', 'Soldadura', 'Otro'];

  /* ------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------ */
  const U = AR.util = {};
  U.uid = function () {
    const r = (global.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(6)), function (b) { return b.toString(16).padStart(2, '0'); }).join('') : Math.random().toString(16).slice(2, 14);
    return 'AR' + Date.now().toString(36).toUpperCase() + '-' + r.toUpperCase();
  };
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  const TZ = 'America/Guatemala';
  U.fecha = function (v) { // dd/mm/aaaa
    const d = v instanceof Date ? v : new Date(v); if (!v || isNaN(d)) return '';
    return d.toLocaleDateString('es-GT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  U.hora = function (v) { // HH:mm
    const d = v instanceof Date ? v : new Date(v); if (!v || isNaN(d)) return '';
    return d.toLocaleTimeString('es-GT', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  };
  U.fechaHora = function (v) { const f = U.fecha(v); return f ? f + ' ' + U.hora(v) : ''; };
  U.isoLocalDia = function (d) { // aaaa-mm-dd en hora de Guatemala
    d = d || new Date();
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  U.minutosEntre = function (a, b) {
    if (!a || !b) return null; const m = Math.round((new Date(b) - new Date(a)) / 60000); return m >= 0 ? m : null;
  };
  U.duracion = function (min) {
    if (min === null || min === undefined || min === '' || isNaN(min)) return '—';
    min = Math.round(Number(min));
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + ' h' + (m ? ' ' + m + ' min' : '');
    const d = Math.floor(h / 24); return d + ' d ' + (h % 24) + ' h';
  };
  U.normCodigo = function (v) {
    const s = String(v || '').toUpperCase().replace(/\s+/g, '');
    let m = /^ER-?0*(\d+)$/.exec(s); if (m) return 'ER' + m[1].padStart(3, '0');
    m = /^C-?0*(\d+)$/.exec(s); if (m) return 'C' + m[1].padStart(2, '0');
    return s;
  };
  U.debounce = function (fn, ms) { let t; return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; };
  U.telWa = function (tel) { // normaliza a 502XXXXXXXX
    let d = String(tel || '').replace(/\D/g, '');
    if (d.length === 8) d = '502' + d;
    return d;
  };
  U.b64utf8 = function (str) { return btoa(unescape(encodeURIComponent(str))); };
  U.utf8b64 = function (b64) { return decodeURIComponent(escape(atob(b64))); };

  /* ------------------------------------------------------------
     Almacenamiento local seguro (nunca rompe la app)
     ------------------------------------------------------------ */
  const S = AR.store = {
    get: function (k, def) { try { const v = localStorage.getItem('ar.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('ar.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('ar.' + k); } catch (e) { /* nada */ } }
  };

  /* IndexedDB mínima (cola de envíos con fotos, que no caben en localStorage) */
  const IDB = AR.idb = {};
  let dbProm = null;
  function db() {
    if (dbProm) return dbProm;
    dbProm = new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error('Este navegador no permite guardar datos sin conexión.'));
      const rq = indexedDB.open('ar-transda', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('cola', { keyPath: 'k', autoIncrement: true }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    return dbProm;
  }
  function tx(modo, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        const t = d.transaction('cola', modo); const st = t.objectStore('cola'); let out;
        Promise.resolve(fn(st)).then(function (v) { out = v; });
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  IDB.agregar = function (item) { return tx('readwrite', function (st) { return st.add(item); }); };
  IDB.todos = function () { return tx('readonly', function (st) { return st.getAll(); }); };
  IDB.borrar = function (k) { return tx('readwrite', function (st) { return st.delete(k); }); };

  /* ------------------------------------------------------------
     Eventos simples
     ------------------------------------------------------------ */
  const oyentes = {};
  AR.on = function (ev, fn) { (oyentes[ev] = oyentes[ev] || []).push(fn); };
  AR.emit = function (ev, data) { (oyentes[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  /* ------------------------------------------------------------
     Sesión (PIN y nombre del usuario, por aplicación)
     ------------------------------------------------------------ */
  /* El PIN nunca se guarda en el celular: solo un token de sesión que vence a los 30 días
     (o antes, si el taller cambia el PIN de ese rol). */
  AR.sesion = {
    app: 'general',
    iniciar: function (app) {
      this.app = app;
      S.del('pin.' + app); // limpia versiones anteriores que guardaban el PIN
      AR.catalogos.datos = S.get('catalogos.' + app, null);
    },
    token: function () {
      const t = S.get('token.' + this.app, ''), exp = S.get('expira.' + this.app, '');
      if (t && exp && new Date(exp) < new Date()) { this.salir(true); return ''; }
      return t;
    },
    activa: function () { return !!this.token(); },
    usuario: function () { return S.get('usuario.' + this.app, ''); },
    rol: function () { return this.token() ? S.get('rol.' + this.app, '') : ''; },
    expira: function () { return S.get('expira.' + this.app, ''); },
    guardar: function (r) {
      S.set('token.' + this.app, r.token); S.set('rol.' + this.app, r.rol);
      S.set('usuario.' + this.app, r.usuario || ''); S.set('expira.' + this.app, r.expira || '');
    },
    /** soloLocal: no avisa al servidor (p. ej. porque la sesión ya venció allá). */
    salir: function (soloLocal) {
      const t = S.get('token.' + this.app, '');
      if (t && !soloLocal) AR.api.llamar('salir', {}, { token: t }).catch(function () { /* sin señal: vence sola */ });
      ['token.', 'rol.', 'expira.', 'catalogos.'].forEach((k) => S.del(k + this.app));
      AR.catalogos.datos = null;
    }
  };

  /* ------------------------------------------------------------
     API (Google Apps Script) + cola sin conexión
     ------------------------------------------------------------ */
  const API = AR.api = {};
  API.configurada = function () { return !!CFG.API_URL && /^https:\/\/script\.google\.com\//.test(CFG.API_URL); };

  /** Llama al servidor. Lanza Error con mensaje en español si falla. err.red = true si fue falta de señal. */
  API.llamar = function (accion, datos, opciones) {
    opciones = opciones || {};
    if (!API.configurada()) return Promise.reject(Object.assign(new Error('La app aún no está conectada a Google Sheets (falta API_URL en config.js).'), { red: false }));
    const cuerpo = Object.assign({ accion: accion }, opciones.anonimo ? {} : { token: opciones.token || AR.sesion.token() }, datos || {});
    const ctrl = global.AbortController ? new AbortController() : null;
    const t = setTimeout(function () { if (ctrl) ctrl.abort(); }, CFG.TIMEOUT_MS || 45000);
    // text/plain evita la verificación CORS previa que Apps Script no soporta
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw Object.assign(new Error('El servidor respondió ' + r.status + '.'), { red: r.status >= 500 });
        return r.json();
      }, function (e) {
        throw Object.assign(new Error(e && e.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'Sin conexión a internet.'), { red: true });
      })
      .then(function (res) {
        clearTimeout(t);
        if (!res || !res.ok) {
          const err = Object.assign(new Error((res && res.error) || 'Error desconocido del servidor.'), { red: false, codigo: (res && res.codigo) || '' });
          if (err.codigo === 'SESION' && !opciones.token) { AR.sesion.salir(true); AR.emit('sesion', err.message); }
          throw err;
        }
        return res;
      }, function (e) { clearTimeout(t); throw e; });
  };

  /** Ingreso con PIN. soloVerificar: valida el PIN sin abrir sesión (devuelve rol y, para mecánicos, la lista de nombres). */
  API.login = function (pin, usuario, soloVerificar) {
    pin = String(pin || '').replace(/\D/g, '');
    if (pin.length !== 8) return Promise.reject(Object.assign(new Error('El PIN debe tener 8 dígitos.'), { red: false, codigo: 'FORMATO' }));
    return API.llamar('login', { pin: pin, usuario: String(usuario || '').trim(), soloVerificar: !!soloVerificar }, { anonimo: true }).then(function (r) {
      if (!soloVerificar) { AR.sesion.guardar(r); AR.catalogos.datos = null; }
      return r;
    });
  };

  /**
   * Envía y, si no hay señal, guarda en la cola para reintentar solo.
   * Devuelve {enviado:true, res} o {encolado:true}.
   */
  API.enviar = function (accion, datos, etiqueta) {
    return API.llamar(accion, datos).then(function (res) {
      return { enviado: true, res: res };
    }, function (e) {
      if (!e.red) throw e;
      const item = { accion: accion, datos: datos, token: AR.sesion.token(), app: AR.sesion.app, etiqueta: etiqueta || accion, creado: new Date().toISOString(), intentos: 0 };
      return IDB.agregar(item).then(function () {
        AR.emit('cola', { pendientes: null });
        API.contarCola();
        return { encolado: true };
      });
    });
  };

  let procesando = false;
  /** Reintenta los envíos pendientes en orden (FIFO). */
  API.procesarCola = function () {
    if (procesando || !API.configurada()) return Promise.resolve(0);
    procesando = true;
    let enviados = 0;
    return IDB.todos().then(function (items) {
      // solo los envíos de esta app (pilotos y mecánicos pueden compartir celular)
      items = items.filter(function (it) { return !it.app || it.app === AR.sesion.app; }).sort(function (a, b) { return a.k - b.k; });
      let p = Promise.resolve();
      let detener = false;
      items.forEach(function (it) {
        p = p.then(function () {
          if (detener) return;
          const enviar = function (token) { return API.llamar(it.accion, it.datos, { token: token }); };
          return enviar(it.token || AR.sesion.token()).catch(function (e) {
            // la sesión con que se guardó venció: se reintenta con la sesión actual
            const actual = AR.sesion.token();
            if (e.codigo === 'SESION' && actual && actual !== it.token) return enviar(actual);
            throw e;
          }).then(function (res) {
            enviados++;
            AR.emit('enviado', { item: it, res: res });
            return IDB.borrar(it.k);
          }, function (e) {
            if (e.red) { detener = true; return; } // sigue sin señal: se reintenta después
            if (e.codigo === 'SESION') { detener = true; AR.emit('sesion', 'Ingresa de nuevo con tu PIN para enviar lo pendiente.'); return; } // se conserva
            // error de datos (p. ej. límite diario): se descarta para no bloquear la cola y se avisa
            AR.emit('errorCola', { item: it, error: e.message });
            return IDB.borrar(it.k);
          });
        });
      });
      return p;
    }).then(function () { procesando = false; API.contarCola(); return enviados; },
            function (e) { procesando = false; console.warn(e); return enviados; });
  };
  API.contarCola = function () {
    return IDB.todos().then(function (l) {
      l = l.filter(function (it) { return !it.app || it.app === AR.sesion.app; });
      AR.emit('cola', { pendientes: l.length, items: l }); return l.length;
    }, function () { return 0; });
  };
  if (global.addEventListener) {
    global.addEventListener('online', function () { API.procesarCola(); });
    setInterval(function () { if (navigator.onLine) API.procesarCola(); }, 60000);
  }

  /* ------------------------------------------------------------
     Catálogos (se guardan en el celular para usarse sin señal)
     ------------------------------------------------------------ */
  AR.catalogos = {
    datos: null, // se carga en AR.sesion.iniciar (cada app guarda su propio catálogo)
    cargar: function (forzar) {
      const self = this;
      const edad = self.datos ? Date.now() - (self.datos._t || 0) : Infinity;
      if (!forzar && self.datos && edad < 6 * 3600e3) { API.llamar('catalogos').then(guardar, function () {}); return Promise.resolve(self.datos); }
      return API.llamar('catalogos').then(guardar, function (e) {
        if (self.datos && e.red) return self.datos; // sin señal: usa lo guardado
        throw e;
      });
      function guardar(res) {
        const d = { unidades: res.unidades, pilotos: res.pilotos, mecanicos: res.mecanicos, areas: res.areas, departamentos: res.departamentos, config: res.config, rol: res.rol, _t: Date.now() };
        self.datos = d; S.set('catalogos.' + AR.sesion.app, d); AR.emit('catalogos', d); return d;
      }
    },
    unidad: function (codigo) {
      codigo = U.normCodigo(codigo);
      return ((this.datos && this.datos.unidades) || []).filter(function (u) { return U.normCodigo(u.codigo) === codigo; })[0] || null;
    },
    pilotoPorUnidad: function (codigo) {
      codigo = U.normCodigo(codigo);
      return ((this.datos && this.datos.pilotos) || []).filter(function (p) { return U.normCodigo(p.unidad) === codigo || U.normCodigo(p.cisterna) === codigo; })[0] || null;
    }
  };

  /* ------------------------------------------------------------
     GPS
     ------------------------------------------------------------ */
  AR.gps = {
    obtener: function (timeoutMs) {
      return new Promise(function (res, rej) {
        if (!navigator.geolocation) return rej(new Error('Este celular no permite obtener la ubicación.'));
        if (!global.isSecureContext) return rej(new Error('La ubicación solo funciona abriendo la app desde su enlace https.'));
        navigator.geolocation.getCurrentPosition(function (p) {
          res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), precision: Math.round(p.coords.accuracy), ts: new Date(p.timestamp || Date.now()).toISOString() });
        }, function (e) {
          const m = { 1: 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.', 2: 'No se pudo obtener la ubicación. Sal a un lugar abierto e intenta de nuevo.', 3: 'La ubicación tardó demasiado. Intenta de nuevo.' };
          rej(new Error(m[e.code] || 'No se pudo obtener la ubicación.'));
        }, { enableHighAccuracy: true, timeout: timeoutMs || 25000, maximumAge: 60000 });
      });
    },
    mapaUrl: function (lat, lng) { return lat && lng ? 'https://maps.google.com/?q=' + lat + ',' + lng : ''; }
  };

  /* ------------------------------------------------------------
     Departamento a partir del GPS (sin internet: polígonos locales)
     ------------------------------------------------------------ */
  let geoProm = null;
  AR.geo = {
    url: 'assets/gt-departamentos.geojson',
    cargar: function () {
      if (!geoProm) geoProm = fetch(AR.geo.url).then(function (r) { if (!r.ok) throw new Error('geo'); return r.json(); }).catch(function (e) { geoProm = null; throw e; });
      return geoProm;
    },
    departamento: function (lat, lng) {
      return AR.geo.cargar().then(function (fc) {
        let mejor = null, dmin = Infinity;
        for (const f of fc.features) {
          for (const poly of f.geometry.coordinates) {
            if (dentro(lng, lat, poly)) return f.properties.nombre;
            const d = distAnillo(lng, lat, poly[0]);
            if (d < dmin) { dmin = d; mejor = f.properties.nombre; }
          }
        }
        return dmin < 0.08 ? mejor : ''; // ~9 km de tolerancia en bordes/costa
      }, function () { return ''; });
    }
  };
  function enAnillo(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function dentro(x, y, poly) { if (!enAnillo(x, y, poly[0])) return false; for (let h = 1; h < poly.length; h++) if (enAnillo(x, y, poly[h])) return false; return true; }
  function distAnillo(x, y, r) { let m = Infinity; for (const p of r) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < m) m = d; } return m; }

  /* ------------------------------------------------------------
     Fotos: compresión en el celular antes de enviar
     ------------------------------------------------------------ */
  AR.fotos = {
    comprimir: function (file, maxPx, calidad) {
      maxPx = maxPx || CFG.FOTO_MAX_PX || 1280; calidad = calidad || CFG.FOTO_CALIDAD || 0.72;
      return new Promise(function (res, rej) {
        if (!file || !/^image\//.test(file.type || 'image/')) return rej(new Error('El archivo no es una imagen.'));
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () {
          const esc = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * esc), h = Math.round(img.naturalHeight * esc);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/jpeg', calidad);
          res({ dataUrl: dataUrl, ancho: w, alto: h, kb: Math.round(dataUrl.length * 0.75 / 1024), nombre: file.name || 'foto.jpg' });
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la foto (formato no compatible).')); };
        img.src = url;
      });
    }
  };

  /* ------------------------------------------------------------
     Logo como imagen (para el PDF)
     ------------------------------------------------------------ */
  const logos = {};
  AR.logo = function (variante) {
    variante = variante || 'blanco';
    if (logos[variante]) return logos[variante];
    const src = variante === 'blanco' ? 'assets/transda-logo-blanco-1024.png' : 'assets/transda-logo-1024.png';
    logos[variante] = new Promise(function (res) {
      const img = new Image();
      img.onload = function () {
        const c = document.createElement('canvas'); c.width = 240; c.height = Math.round(240 * img.naturalHeight / img.naturalWidth);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res({ dataUrl: c.toDataURL('image/png'), ratio: img.naturalHeight / img.naturalWidth });
      };
      img.onerror = function () { res(null); };
      img.src = src;
    });
    return logos[variante];
  };

  /* ------------------------------------------------------------
     PDF (jsPDF) — legible para personas + datos incrustados para el sistema
     ------------------------------------------------------------ */
  const MARCA_DATOS = 'ARDATA1:';
  /** Las fuentes estándar del PDF solo tienen Latin-1: se quitan emojis y se normalizan comillas. */
  function pdfTexto(v) {
    return String(v).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...').replace(/[^\n\r\t\x20-\x7E\xA0-\xFF]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }
  AR.pdf = {};

  /**
   * tipo: 'reporte' (piloto) | 'cierre' (mecánico) | 'completo' (taller)
   * caso: objeto con las claves camelCase del backend (ver publica_ en Code.gs)
   * fotos: { reporte: [dataUrl], cierre: [dataUrl] }, firma: dataUrl
   */
  AR.pdf.crear = function (tipo, caso, fotos, firma) {
    if (!global.jspdf) return Promise.reject(new Error('No se cargó el generador de PDF.'));
    fotos = fotos || {};
    return AR.logo('blanco').then(function (logo) {
      const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'letter', compress: true });
      const W = 215.9, H = 279.4, M = 14, AZUL = [42, 71, 152], NAVY = [33, 41, 79], GRIS = [91, 98, 117];
      let y = 0;
      const titulo = { reporte: 'REPORTE DE ASISTENCIA EN RUTA', cierre: 'CIERRE DE ASISTENCIA EN RUTA', completo: 'EXPEDIENTE DE ASISTENCIA EN RUTA' }[tipo] || 'ASISTENCIA EN RUTA';

      function encabezado() {
        doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]); doc.rect(0, 0, W, 26, 'F');
        if (logo) doc.addImage(logo.dataUrl, 'PNG', M, 3.5, 17, 17 * logo.ratio);
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
        doc.text(titulo, M + 22, 11.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
        doc.text('TRANSDA · Gasolineras Don Arturo · Taller de Mantenimiento', M + 22, 17.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        doc.text(caso.correlativo || 'PENDIENTE', W - M, 11.5, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text(caso.correlativo ? 'No. de asistencia' : 'Correlativo se asigna al sincronizar', W - M, 17.5, { align: 'right' });
        y = 34;
      }
      function nuevaPagina() { doc.addPage(); encabezado(); }
      function asegurar(alto) { if (y + alto > H - 18) nuevaPagina(); }
      function seccion(txt) {
        asegurar(14);
        doc.setFillColor(232, 237, 248); doc.rect(M, y - 5, W - 2 * M, 8, 'F');
        doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(txt.toUpperCase(), M + 2.5, y + 0.5); y += 9;
      }
      function filas(pares) {
        const colL = 48, ancho = W - 2 * M - colL;
        pares.forEach(function (p) {
          if (p[1] === undefined || p[1] === null || p[1] === '') return;
          const lineas = doc.splitTextToSize(pdfTexto(p[1]), ancho);
          asegurar((lineas.length - 1) * 3.9 + 7);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
          doc.text(pdfTexto(p[0]), M + 2.5, y);
          doc.setFont('helvetica', 'bold'); doc.setTextColor(27, 32, 51);
          doc.text(lineas, M + colL, y);
          if (p[2]) doc.link(M + colL, y - 4, doc.getTextWidth(lineas[0]), 5, { url: p[2] });
          y += (lineas.length - 1) * 3.9 + 6.5;
        });
        y += 2;
      }
      function galeria(lista, rotulo) {
        lista = (lista || []).filter(Boolean);
        if (!lista.length) return;
        const cols = 3, gap = 4, w = (W - 2 * M - gap * (cols - 1)) / cols, h = w * 0.75;
        asegurar(h + 18); // título + primera fila juntos
        seccion(rotulo + ' (' + lista.length + ')');
        lista.forEach(function (src, i) {
          if (i % cols === 0) { if (i) y += h + gap; asegurar(h + 4); }
          const x = M + (i % cols) * (w + gap);
          try {
            const props = doc.getImageProperties(src);
            const r = Math.min(w / props.width, h / props.height);
            const iw = props.width * r, ih = props.height * r;
            doc.setDrawColor(217, 222, 232); doc.rect(x, y, w, h);
            doc.addImage(src, props.fileType || 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'FAST');
          } catch (e) { doc.setFontSize(8); doc.text('Foto no disponible', x + 3, y + 8); }
        });
        y += h + 8;
      }

      encabezado();
      // Franja de estado
      const est = AR.ESTADOS[caso.estado] || { txt: caso.estado || 'Nueva' };
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text('Unidad ' + (caso.unidad || '-') + (caso.cisterna ? '  ·  Cisterna ' + caso.cisterna : ''), M, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
      doc.text('Estado: ' + est.txt, W - M, y, { align: 'right' });
      y += 8;

      const mapa = AR.gps.mapaUrl(caso.lat, caso.lng);
      seccion('1. Reporte de la falla');
      filas([
        ['Fecha y hora', U.fechaHora(caso.creadoEn)],
        ['Reportado por', [caso.pilotoNombre, caso.pilotoTel].filter(Boolean).join(' · ') || caso.creadoPor],
        ['Origen del reporte', caso.origen],
        ['Tipo de unidad', caso.tipoUnidad],
        ['Componente afectado', caso.componente],
        ['Área', caso.area],
        ['Descripción', caso.descripcion],
        ['¿Puede moverse?', caso.puedeMoverse === 'SI' ? 'Sí' : caso.puedeMoverse === 'NO' ? 'No' : ''],
        ['¿Con carga?', caso.conCarga === 'SI' ? 'Sí' : caso.conCarga === 'NO' ? 'No' : ''],
        ['Prioridad', caso.prioridad],
        ['Departamento', caso.departamento],
        ['Referencia', caso.referencia],
        ['Ubicación GPS', caso.lat ? caso.lat + ', ' + caso.lng + (caso.precisionM ? '  (±' + caso.precisionM + ' m)' : '') + '  — abrir mapa' : 'No disponible', mapa]
      ]);

      if (tipo !== 'reporte') {
        seccion('2. Atención del mecánico');
        filas([
          ['Mecánico', [caso.mecanicoNombre, caso.mecanicoTipo, caso.tallerExterno].filter(Boolean).join(' · ')],
          ['Teléfono', caso.mecanicoTel],
          ['Asignado', U.fechaHora(caso.asignadoEn)],
          ['Salida a ruta', U.fechaHora(caso.salidaEn)],
          ['Llegada al sitio', U.fechaHora(caso.llegadaEn)],
          ['Fin del trabajo', U.fechaHora(caso.finEn)],
          ['Diagnóstico', caso.diagnostico],
          ['Trabajo realizado', caso.trabajoRealizado],
          ['Repuestos', caso.repuestos],
          ['Resultado', caso.resultado === 'Requiere grúa' ? 'REQUIERE GRÚA' : caso.resultado ? 'UNIDAD HABILITADA' : ''],
          ['Grúa', [caso.gruaProveedor, caso.gruaDestino && ('destino: ' + caso.gruaDestino)].filter(Boolean).join(' · ')],
          ['Motivo grúa', caso.gruaMotivo],
          ['Cierre del caso', U.fechaHora(caso.cerradoEn)]
        ]);
        seccion('3. Tiempos');
        filas([
          ['Reporte a asignación', U.duracion(caso.minAsignacion !== '' ? caso.minAsignacion : U.minutosEntre(caso.creadoEn, caso.asignadoEn))],
          ['Asignación a llegada', U.duracion(caso.minLlegada !== '' ? caso.minLlegada : U.minutosEntre(caso.asignadoEn, caso.llegadaEn))],
          ['Llegada a fin de trabajo', U.duracion(caso.minReparacion !== '' ? caso.minReparacion : U.minutosEntre(caso.llegadaEn, caso.finEn))],
          ['Tiempo total', U.duracion(caso.minTotal !== '' && caso.minTotal !== undefined ? caso.minTotal : U.minutosEntre(caso.creadoEn, caso.cerradoEn || caso.finEn))]
        ]);
      }
      if (caso.observaciones) { seccion('Observaciones'); filas([['Notas', caso.observaciones]]); }

      galeria(fotos.reporte, 'Fotos del reporte');
      galeria(fotos.cierre, 'Fotos del trabajo');

      if (firma) {
        asegurar(40); seccion('Firma del mecánico');
        try { doc.addImage(firma, 'PNG', M + 2, y, 60, 24); } catch (e) { /* firma inválida */ }
        doc.setDrawColor(150); doc.line(M + 2, y + 25, M + 70, y + 25);
        doc.setFontSize(9); doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]); doc.text(caso.mecanicoNombre || '', M + 2, y + 30);
        y += 36;
      }

      // Pie de página en todas las hojas
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
        doc.text('Generado ' + U.fechaHora(new Date()) + ' · Asistencias en Ruta TRANSDA v' + AR.VERSION, M, H - 8);
        doc.text('Página ' + i + ' de ' + n, W - M, H - 8, { align: 'right' });
      }

      // Datos incrustados (sin fotos) para que el tablero pueda leer este PDF si llega por WhatsApp
      const datos = Object.assign({}, caso); delete datos.firma;
      doc.setProperties({
        title: titulo + ' ' + (caso.correlativo || ''),
        subject: 'Asistencia en Ruta TRANSDA',
        author: caso.mecanicoNombre || caso.pilotoNombre || caso.creadoPor || 'TRANSDA',
        creator: 'Asistencias en Ruta TRANSDA',
        keywords: MARCA_DATOS + U.b64utf8(JSON.stringify({ tipo: tipo, v: 1, caso: datos }))
      });
      return doc.output('blob');
    });
  };

  AR.pdf.nombre = function (tipo, caso) {
    const base = (caso.correlativo || 'AR-PENDIENTE') + '_' + (caso.unidad || 'UNIDAD');
    return base + '_' + ({ reporte: 'Reporte', cierre: 'Cierre', completo: 'Expediente' }[tipo] || tipo) + '.pdf';
  };

  /** Lee los datos incrustados de un PDF generado por el sistema. */
  AR.pdf.leerDatos = function (file) {
    return file.arrayBuffer().then(function (buf) {
      const bytes = new Uint8Array(buf);
      let txt = '';
      for (let i = 0; i < bytes.length; i += 65536) txt += String.fromCharCode.apply(null, bytes.subarray(i, i + 65536));
      const m = /ARDATA1:([A-Za-z0-9+/=]+)/.exec(txt);
      if (!m) throw new Error('Este PDF no fue generado por el sistema de Asistencias en Ruta.');
      return JSON.parse(U.utf8b64(m[1]));
    });
  };

  /* ------------------------------------------------------------
     Compartir por WhatsApp (menú nativo del celular)
     ------------------------------------------------------------ */
  AR.compartir = function (blob, nombre, texto, telefono) {
    const file = new File([blob], nombre, { type: blob.type || 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: nombre, text: texto || '' }).then(function () { return 'compartido'; }, function (e) {
        if (e && e.name === 'AbortError') return 'cancelado';
        AR.descargar(blob, nombre); return 'descargado';
      });
    }
    // Computadora o navegador sin "compartir archivos": descarga + abre WhatsApp con el texto
    AR.descargar(blob, nombre);
    const tel = U.telWa(telefono);
    if (texto) global.open('https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texto + '\n(Adjunta el PDF descargado: ' + nombre + ')'), '_blank');
    return Promise.resolve('descargado');
  };
  AR.descargar = function (blob, nombre) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  AR.textoWhatsApp = function (tipo, caso) {
    const map = AR.gps.mapaUrl(caso.lat, caso.lng);
    if (tipo === 'reporte') {
      return '🚨 *ASISTENCIA EN RUTA* ' + (caso.correlativo || '(pendiente de correlativo)') +
        '\nUnidad: *' + caso.unidad + '*' + (caso.cisterna ? ' / ' + caso.cisterna : '') +
        '\nÁrea: ' + caso.area + '\nFalla: ' + caso.descripcion +
        '\n¿Puede moverse?: ' + (caso.puedeMoverse === 'SI' ? 'Sí' : 'No') + ' · ¿Con carga?: ' + (caso.conCarga === 'SI' ? 'Sí' : 'No') +
        (caso.departamento ? '\nDepartamento: ' + caso.departamento : '') + (map ? '\nUbicación: ' + map : '') +
        '\nPiloto: ' + (caso.pilotoNombre || '') + (caso.pilotoTel ? ' · ' + caso.pilotoTel : '');
    }
    return '✅ *CIERRE ASISTENCIA* ' + (caso.correlativo || '') + '\nUnidad: *' + caso.unidad + '*' +
      '\nResultado: *' + (caso.resultado === 'Requiere grúa' ? 'REQUIERE GRÚA' : 'UNIDAD HABILITADA') + '*' +
      '\nMecánico: ' + (caso.mecanicoNombre || '') + '\nTrabajo: ' + (caso.trabajoRealizado || caso.diagnostico || '');
  };

  /* ------------------------------------------------------------
     UI mínima compartida
     ------------------------------------------------------------ */
  AR.ui = {};
  AR.ui.toast = function (msg, tipo, ms) {
    const el = document.createElement('div'); el.className = 'ar-toast ' + (tipo || ''); el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, ms || 3500);
  };
  AR.ui.chipEstado = function (estado) {
    const e = AR.ESTADOS[estado] || { txt: estado, clase: 'gris' };
    return '<span class="ar-chip ' + e.clase + '">' + U.esc(e.txt) + '</span>';
  };
  /** Semáforo por horas transcurridas: ok < ámbar < rojo */
  AR.ui.semaforo = function (creadoEn, cfg) {
    cfg = cfg || (AR.catalogos.datos && AR.catalogos.datos.config) || { horasAmbar: 2, horasRoja: 4 };
    const h = (Date.now() - new Date(creadoEn)) / 3600e3;
    return h >= cfg.horasRoja ? 'rojo' : h >= cfg.horasAmbar ? 'ambar' : 'ok';
  };

  /* Registro del service worker (funciona sin señal una vez abierta) */
  AR.registrarSW = function () {
    if ('serviceWorker' in navigator && global.isSecureContext && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW', e); });
    }
  };

  /* ------------------------------------------------------------
     Fotos guardadas en Drive (se piden a la API con PIN) — con caché
     ------------------------------------------------------------ */
  const cacheFotos = {};
  AR.fotoRemota = function (fileId) {
    if (!fileId) return Promise.reject(new Error('Sin foto'));
    if (!cacheFotos[fileId]) {
      cacheFotos[fileId] = AR.api.llamar('foto', { fileId: fileId }).then(function (r) {
        return 'data:' + r.mime + ';base64,' + r.base64;
      }).catch(function (e) { delete cacheFotos[fileId]; throw e; });
    }
    return cacheFotos[fileId];
  };
  AR.idsFotos = function (txt) { return String(txt || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); };

  /* ------------------------------------------------------------
     Firma en pantalla (dedo o mouse)
     ------------------------------------------------------------ */
  AR.firma = function (canvas) {
    const ctx = canvas.getContext('2d');
    let dibujando = false, vacia = true, ultimo = null;
    function ajustar() {
      const r = canvas.getBoundingClientRect(), dpr = global.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1B2033';
      vacia = true;
    }
    function punto(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) { dibujando = true; ultimo = punto(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      if (!dibujando) return; const p = punto(e);
      ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ultimo = p; vacia = false;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { dibujando = false; }); });
    ajustar();
    return {
      limpiar: ajustar,
      vacia: function () { return vacia; },
      dataUrl: function () {
        if (vacia) return '';
        // fondo blanco para que se vea en el PDF
        const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
        return c.toDataURL('image/png');
      }
    };
  };

  AR.gps.rutaUrl = function (lat, lng) { return lat && lng ? 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng : ''; };
  AR.horasDesde = function (iso) { return iso ? (Date.now() - new Date(iso)) / 3600e3 : 0; };

  global.AR = AR;
})(window);
