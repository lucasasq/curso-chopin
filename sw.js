/* Curso Chopin — service worker: deixa o curso abrir sem internet depois da primeira visita.
   Rede primeiro (para pegar atualizações); se faltar rede, usa a cópia guardada. Versão: 202611131217 */
const CACHE = 'curso-chopin-202611131217';
const ESSENCIAIS = ['./', 'index.html', 'app.js?v=202611131217', 'dados.js?v=202611131217', 'config.js?v=202611131217', 'partitura.js?v=202611131217', 'vendor/vexflow.js?v=202611131217', 'vendor/supabase.js?v=202611131217', 'manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESSENCIAIS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (url.pathname.endsWith('.m4a') || url.pathname.endsWith('.mp3') || url.pathname.endsWith('.mid') || url.pathname.endsWith('.jpg') || ESSENCIAIS.some(x => url.pathname.endsWith(x.split('?')[0])))) {
        const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request).then(x => x || caches.match('index.html')))
  );
});
