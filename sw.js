const STATIC_CACHE = 'tasksync-static-v2';
const DYNAMIC_CACHE = 'tasksync-dynamic-v2';
const INMUTABLE_CACHE = 'tasksync-inmutable-v2';

const APP_SHELL = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/favicon.ico'
];

const APP_SHELL_INMUTABLE = [
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Instalación del SW: Guardar en caché el App Shell
self.addEventListener('install', (e) => {
    console.log('[SW] Instalando Service Worker...');
    const cacheStatic = caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL));
    const cacheInmutable = caches.open(INMUTABLE_CACHE).then((cache) => cache.addAll(APP_SHELL_INMUTABLE));

    e.waitUntil(Promise.all([cacheStatic, cacheInmutable]));
    self.skipWaiting();
});

// Activación del SW: Limpiar cachés antiguas
self.addEventListener('activate', (e) => {
    console.log('[SW] Activando Service Worker...');
    const respuesta = caches.keys().then((keys) => {
        return Promise.all(
            keys.map((key) => {
                if (key !== STATIC_CACHE && key.includes('static')) {
                    return caches.delete(key);
                }
                if (key !== DYNAMIC_CACHE && key.includes('dynamic')) {
                    return caches.delete(key);
                }
            })
        );
    });

    e.waitUntil(respuesta);
    return self.clients.claim();
});

// Estrategia de Caché: Cache with Network Fallback & Dynamic Cache
self.addEventListener('fetch', (e) => {
    // Si la petición es hacia una API o servidor externo (ej. localhost:3000/api), no cachear
    if (e.request.url.includes('/api/')) {
        return;
    }

    const respuesta = caches.match(e.request).then((res) => {
        if (res) return res;

        // Si no está en caché, ir a la red y guardar dinámicamente
        return fetch(e.request).then((newRes) => {
            return caches.open(DYNAMIC_CACHE).then((cache) => {
                // Solo cachear peticiones GET válidas
                if (e.request.method === 'GET' && newRes.status === 200) {
                    cache.put(e.request, newRes.clone());
                }
                return newRes;
            });
        }).catch(() => {
            // Fallback offline para navegación principal
            if (e.request.headers.get('accept').includes('text/html')) {
                return caches.match('./index.html');
            }
        });
    });

    e.respondWith(respuesta);
});

// ESCUCHAR NOTIFICACIONES PUSH DESDE EL SERVIDOR NODE.JS
self.addEventListener('push', (e) => {
    console.log('[SW] Notificación Push recibida:', e);

    let data = {
        titulo: 'TaskSync Notificación',
        cuerpo: 'Tienes tareas y hábitos pendientes por revisar.',
        icon: 'icons/icon-192x192.png',
        badge: 'icons/icon-192x192.png'
    };

    if (e.data) {
        try {
            const payload = e.data.json();
            data.titulo = payload.titulo || payload.title || data.titulo;
            data.cuerpo = payload.cuerpo || payload.body || payload.mensaje || data.cuerpo;
            if (payload.icon) data.icon = payload.icon;
            if (payload.badge) data.badge = payload.badge;
        } catch (err) {
            data.cuerpo = e.data.text();
        }
    }

    const options = {
        body: data.cuerpo,
        icon: data.icon || 'icons/icon-192x192.png',
        badge: data.badge || 'icons/icon-192x192.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            { action: 'explore', title: 'Ver App', icon: 'icons/icon-192x192.png' },
            { action: 'close', title: 'Cerrar' }
        ]
    };

    e.waitUntil(
        self.registration.showNotification(data.titulo, options)
    );
});

// AL HACER CLIC EN LA NOTIFICACIÓN
self.addEventListener('notificationclick', (e) => {
    console.log('[SW] Clic en notificación:', e.notification);
    e.notification.close();

    if (e.action === 'close') return;

    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('index.html') || client.url === '/' || client.url.includes(self.location.origin)) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./');
            }
        })
    );
});
