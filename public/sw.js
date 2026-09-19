const CACHE_NAME = 'mybrain-cache-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(ASSETS);
      const shell = await cache.match('/index.html');
      const html = shell ? await shell.text() : '';
      const bundles = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
      await cache.addAll(bundles);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k.startsWith('mybrain-cache-') && k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

// Android share target: keep the explicitly shared text on this device until reviewed.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share' || event.request.method !== 'POST') return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const file = form.getAll('files').find(value => typeof value !== 'string');
    if (file && (file.size > 1500000 || !file.name.toLowerCase().endsWith('.txt'))) return new Response('Csak legfeljebb 1,5 MB-os .txt fájl osztható meg.', {status:400});
    const text = file ? await file.text() : [form.get('text'),form.get('url')].filter(value => typeof value === 'string').join('\n');
    if (!text.trim() || text.length > 500000) return new Response('Üres vagy túl hosszú szöveg (legfeljebb 500 000 karakter).', {status:400});
    const name = file ? file.name : String(form.get('title') || 'WhatsApp megosztás');
    const id = crypto.randomUUID();
    const cache = await caches.open('mybrain-shared');
    for (const request of await cache.keys()) await cache.delete(request);
    await cache.put(`/__shared/${id}`,new Response(JSON.stringify({name:name.slice(0,120),text}),{headers:{'Content-Type':'application/json'}}));
    return Response.redirect(`${self.location.origin}/?tab=import&share=${id}`,303);
  })());
});

// Network-first strategy with offline fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Skip caching API calls to keep them fresh
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)));
        }
        return networkResponse;
      })
      .catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/index.html') : null) || Response.error())
  );
});

// Push notification receiver
self.addEventListener('push', (event) => {
  let data = { title: 'MyBrain Alert', body: 'You have new actionable inbox items.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) return;
        }
        return client.focus();
      }
      return clients.openWindow(event.notification.data || '/');
    })
  );
});
