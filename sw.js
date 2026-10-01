/* Service worker — permite abrir las apps sin señal. Sube VERSION al publicar cambios. */
const VERSION = 'ar-transda-v1.4.0';
const ARCHIVOS = [
  './', 'index.html', 'pilotos.html', 'mecanicos.html', 'taller.html', 'nucleo-prueba.html',
  'config.js', 'core.js', 'taller.js', 'brand.css', 'manifest.webmanifest',
  'vendor/jspdf.umd.min.js',
  'assets/transda-logo.svg', 'assets/transda-logo-blanco.svg',
  'assets/transda-logo-1024.png', 'assets/transda-logo-blanco-1024.png',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/gt-departamentos.geojson'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) =>
    Promise.all(ARCHIVOS.map((u) => c.add(u).catch(() => null))) // tolera páginas aún no publicadas
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la API de Google nunca se guarda
  // Red primero (para recibir actualizaciones); si no hay señal, lo guardado
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
