/* =========================================================
   TaskSync PWA - Core Client Script & Push Notification Engine
   ========================================================= */

// VAPID Public Key por defecto (compatible con la práctica de Twittor Node Server)
let VAPID_PUBLIC_KEY = 'BKsTf1wxQNiM0tlZUpgzbxoPP-C3phHxs4wEKs7MgK-XJ1vp37vl3YWUNewnNjvTS7I-pHIrGUna2TVpWXmCwpM';

// Convertidor de Clave VAPID Base64 a Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Variables Globales
let registroSW = null;
let deferredPrompt = null;
let tasks = [];
let currentFilter = 'all';

// Elementos DOM
const statusPill = document.getElementById('status-pill');
const statusText = document.getElementById('status-text');
const btnInstall = document.getElementById('btn-install');

const pushStatusBadge = document.getElementById('push-status-badge');
const pushStatusText = document.getElementById('push-status-text');
const btnPushToggle = document.getElementById('btn-push-toggle');
const btnTestPush = document.getElementById('btn-test-push');
const inputVapidKey = document.getElementById('input-vapid-key');
const inputServerUrl = document.getElementById('input-server-url');

const taskForm = document.getElementById('task-form');
const inputTaskTitle = document.getElementById('task-title');
const selectTaskCategory = document.getElementById('task-category');
const selectTaskPriority = document.getElementById('task-priority');
const taskListContainer = document.getElementById('task-list');

const statTotal = document.getElementById('stat-total');
const statPending = document.getElementById('stat-pending');
const statCompleted = document.getElementById('stat-completed');

// =========================================================
// 1. REGISTRO DEL SERVICE WORKER & ESTADO PWA
// =========================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            registroSW = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
            console.log('✅ Service Worker registrado con éxito. Scope:', registroSW.scope);
            verificarEstadoSuscripcionPush();
        } catch (err) {
            console.error('❌ Error al registrar el Service Worker:', err);
        }
    });
}

// Detectar prompt de instalación PWA
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) {
        btnInstall.style.display = 'inline-flex';
    }
});

if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Respuesta del usuario a la instalación: ${outcome}`);
        deferredPrompt = null;
        btnInstall.style.display = 'none';
    });
}

// Detectar cambios de Red (Online / Offline)
function actualizarEstadoRed() {
    if (navigator.onLine) {
        statusPill.className = 'status-pill online';
        statusText.textContent = 'En Línea (Conectado)';
    } else {
        statusPill.className = 'status-pill offline';
        statusText.textContent = 'Sin Red (Modo Offline Active)';
    }
}
window.addEventListener('online', actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);

// =========================================================
// 2. GESTIÓN DE NOTIFICACIONES PUSH & SERVIDOR NODE
// =========================================================
async function verificarEstadoSuscripcionPush() {
    if (!('Notification' in window) || !('PushManager' in window)) {
        pushStatusBadge.textContent = 'No soportado';
        pushStatusBadge.className = 'push-badge inactive';
        pushStatusText.textContent = 'Este navegador no soporta Notificaciones Push.';
        btnPushToggle.disabled = true;
        return;
    }

    try {
        const registro = await navigator.serviceWorker.ready;
        const sub = await registro.pushManager.getSubscription();

        if (sub) {
            actualizarUINotificaciones(true, sub);
        } else {
            actualizarUINotificaciones(false);
        }
    } catch (err) {
        console.error('Error al verificar suscripción push:', err);
    }
}

function actualizarUINotificaciones(activa, sub = null) {
    if (activa) {
        pushStatusBadge.textContent = 'Activadas';
        pushStatusBadge.className = 'push-badge active';
        pushStatusText.textContent = 'Suscrito a notificaciones push del servidor.';
        btnPushToggle.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Desactivar Notificaciones';
        btnPushToggle.className = 'btn btn-secondary';
        if (sub) console.log('✅ Suscripción Activa:', JSON.stringify(sub));
    } else {
        pushStatusBadge.textContent = 'Inactivas';
        pushStatusBadge.className = 'push-badge inactive';
        pushStatusText.textContent = 'No estás suscrito a las notificaciones.';
        btnPushToggle.innerHTML = '<i class="fa-solid fa-bell"></i> Activar Notificaciones';
        btnPushToggle.className = 'btn btn-primary';
    }
}

// Alternar Suscripción Push
if (btnPushToggle) {
    btnPushToggle.addEventListener('click', async () => {
        if (!('Notification' in window) || !('PushManager' in window)) return;

        try {
            const permiso = await Notification.requestPermission();
            console.log('Permiso de notificación:', permiso);
            if (permiso !== 'granted') {
                alert('Debes permitir las notificaciones en tu navegador.');
                return;
            }

            const registro = await navigator.serviceWorker.ready;
            let sub = await registro.pushManager.getSubscription();

            if (sub) {
                // Cancelar suscripción
                await sub.unsubscribe();
                console.log('Suscripción eliminada');
                actualizarUINotificaciones(false);
            } else {
                // Crear nueva suscripción VAPID
                const claveVapid = inputVapidKey.value.trim() || VAPID_PUBLIC_KEY;
                sub = await registro.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(claveVapid)
                });
                console.log('✅ Nueva suscripción Push creada:', sub);

                // Enviar suscripción al servidor Node API
                await enviarSuscripcionAlServidor(sub);
                actualizarUINotificaciones(true, sub);
            }
        } catch (err) {
            console.error('Error al alternar notificaciones push:', err);
            alert('Error al gestionar las notificaciones: ' + err.message);
        }
    });
}

// Enviar Endpoint / Keys al Servidor Backend Node
async function enviarSuscripcionAlServidor(sub) {
    const serverUrl = inputServerUrl.value.trim() || 'http://localhost:3000/api/subscribe';
    try {
        const resp = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub)
        });
        if (resp.ok) {
            console.log('✅ Suscripción enviada exitosamente al servidor Node:', serverUrl);
        } else {
            console.warn('⚠️ El servidor respondió con estado:', resp.status);
        }
    } catch (err) {
        console.warn('⚠️ No se pudo conectar al servidor Node (Asegúrate de ejecutar npm start en el servidor):', err.message);
    }
}

// Probar Notificación Local
if (btnTestPush) {
    btnTestPush.addEventListener('click', async () => {
        if (Notification.permission === 'granted') {
            const registro = await navigator.serviceWorker.ready;
            registro.showNotification('🎉 ¡Prueba de Notificación TaskSync!', {
                body: 'Esta es una notificación de prueba funcionando desde la PWA.',
                icon: 'icons/icon-192x192.png',
                badge: 'icons/icon-192x192.png',
                vibrate: [100, 50, 100]
            });
        } else {
            alert('Primero activa las notificaciones usando el botón "Activar Notificaciones".');
        }
    });
}

// =========================================================
// 3. GESTIÓN DE TAREAS Y HÁBITOS (OFFLINE STORAGE)
// =========================================================
function cargarTareas() {
    const guardadas = localStorage.getItem('tasksync_tasks');
    if (guardadas) {
        tasks = JSON.parse(guardadas);
    } else {
        // Tareas demo iniciales
        tasks = [
            { id: 1, title: 'Instalar PWA en el celular o navegador', category: 'estudio', priority: 'high', completed: false, date: new Date().toLocaleDateString() },
            { id: 2, title: 'Revisar notificaciones push y Service Worker', category: 'trabajo', priority: 'high', completed: true, date: new Date().toLocaleDateString() },
            { id: 3, title: 'Beber 2 litros de agua (Hábito diario)', category: 'salud', priority: 'medium', completed: false, date: new Date().toLocaleDateString() }
        ];
        guardarTareas();
    }
    renderizarTareas();
}

function guardarTareas() {
    localStorage.setItem('tasksync_tasks', JSON.stringify(tasks));
    actualizarEstadisticas();
}

function actualizarEstadisticas() {
    const total = tasks.length;
    const completadas = tasks.filter(t => t.completed).length;
    const pendientes = total - completadas;

    if (statTotal) statTotal.textContent = total;
    if (statPending) statPending.textContent = pendientes;
    if (statCompleted) statCompleted.textContent = completadas;
}

function agregarTarea(e) {
    e.preventDefault();
    const titulo = inputTaskTitle.value.trim();
    if (!titulo) return;

    const nuevaTarea = {
        id: Date.now(),
        title: titulo,
        category: selectTaskCategory.value,
        priority: selectTaskPriority.value,
        completed: false,
        date: new Date().toLocaleDateString()
    };

    tasks.unshift(nuevaTarea);
    guardarTareas();
    renderizarTareas();

    inputTaskTitle.value = '';

    // Si las notificaciones están permitidas, enviar recordatorio local
    if (Notification.permission === 'granted' && registroSW) {
        registroSW.showNotification('📝 Nueva Tarea Registrada', {
            body: `Se agregó: "${titulo}" (${selectTaskCategory.value.toUpperCase()})`,
            icon: 'icons/icon-192x192.png'
        });
    }
}

function toggleCompletada(id) {
    tasks = tasks.map(t => {
        if (t.id === id) {
            return { ...t, completed: !t.completed };
        }
        return t;
    });
    guardarTareas();
    renderizarTareas();
}

function eliminarTarea(id) {
    tasks = tasks.filter(t => t.id !== id);
    guardarTareas();
    renderizarTareas();
}

function renderizarTareas() {
    if (!taskListContainer) return;
    taskListContainer.innerHTML = '';

    let tareasFiltradas = tasks;
    if (currentFilter !== 'all') {
        tareasFiltradas = tasks.filter(t => t.category === currentFilter);
    }

    if (tareasFiltradas.length === 0) {
        taskListContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-check"></i>
                <p>No hay tareas registradas en esta categoría.</p>
            </div>
        `;
        return;
    }

    tareasFiltradas.forEach(tarea => {
        const item = document.createElement('div');
        item.className = `task-item ${tarea.completed ? 'completed' : ''}`;
        
        item.innerHTML = `
            <div class="task-left">
                <div class="custom-checkbox" onclick="toggleCompletada(${tarea.id})">
                    ${tarea.completed ? '<i class="fa-solid fa-check"></i>' : ''}
                </div>
                <div class="task-details">
                    <span class="task-text">${escaparHTML(tarea.title)}</span>
                    <div class="task-meta">
                        <span class="category-chip">${tarea.category}</span>
                        <span class="priority-${tarea.priority}">
                            <i class="fa-solid fa-circle" style="font-size: 0.5rem;"></i> Prioridad ${tarea.priority.toUpperCase()}
                        </span>
                        <span>• ${tarea.date}</span>
                    </div>
                </div>
            </div>
            <div class="task-actions">
                <button class="btn-icon" onclick="eliminarTarea(${tarea.id})" title="Eliminar tarea">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;

        taskListContainer.appendChild(item);
    });
}

// Filtros por Categoría
document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        renderizarTareas();
    });
});

function escaparHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    actualizarEstadoRed();
    cargarTareas();
    if (taskForm) taskForm.addEventListener('submit', agregarTarea);

    if (inputVapidKey) inputVapidKey.value = VAPID_PUBLIC_KEY;
});
