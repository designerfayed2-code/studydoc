// Service worker: caches the whole app so it opens and works with no internet.
const VERSION = '6a355a6329';
const CACHE = 'studydoc-' + VERSION;
const FILES = ['./', './index.html', './app.js', './core.js', './store.js', './pdfread.js', './ocr.js', './prompt.js', './styles.css',
  './pdf.min.js', './pdf.worker.min.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './help-ar.html'];

// OCR engine files (~17 MB): cached best-effort so a missing file can never break the app install.
const OCR_FILES = ['./tesseract.esm.min.js', './tesseract-worker.min.js', './tesseract-core-lstm.wasm.js',
  './tesseract-core-simd-lstm.wasm.js', './tesseract-core-relaxedsimd-lstm.wasm.js', './ara.traineddata.gz', './eng.traineddata.gz'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(FILES);
    await Promise.allSettled(OCR_FILES.map((u) => c.add(u)));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('studydoc-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
