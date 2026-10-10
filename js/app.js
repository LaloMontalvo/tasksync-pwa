/* =========================================================
   TaskSync PWA - Core Client Script & Task Manager
   ========================================================= */

// Configuración VAPID y Endpoint para comunicación en segundo plano con el Backend
const VAPID_PUBLIC_KEY = 'BKsTf1wxQNiM0tlZUpgzbxoPP-C3phHxs4wEKs7MgK-XJ1vp37vl3YWUNewnNjvTS7I-pHIrGUna2TVpWXmCwpM';
const BACKEND_SUBSCRIBE_URL = 'http://localhost:3000/api/subscribe';

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
            
            // Inicializar suscripción push en segundo plano si está permitido
            iniciarPushEnSegundoPlano();
        } catch (err) {
            console.warn('ℹ️ Registro de Service Worker:', err.message || err);
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
    if (!statusPill || !statusText) return;
    if (navigator.onLine) {
        statusPill.className = 'status-pill online';
        statusText.textContent = 'En Línea';
    } else {
        statusPill.className = 'status-pill offline';
        statusText.textContent = 'Modo Offline';
    }
}
window.addEventListener('online', actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);

// =========================================================
// 2. SUSCRIPCIÓN PUSH SILENCIOSA EN EL BACKEND
// =========================================================
async function iniciarPushEnSegundoPlano() {
    if (!('Notification' in window) || !('PushManager' in window)) return;

    try {
        const registro = await navigator.serviceWorker.ready;
        let sub = await registro.pushManager.getSubscription();

        // Si ya hay suscripción, enviarla de forma segura al backend
        if (sub) {
            enviarSuscripcionAlServidor(sub);
        }
    } catch (err) {
        console.debug('Push background check:', err);
    }
}

async function suscribirPushBackend() {
    if (!('Notification' in window) || !('PushManager' in window)) return;

    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') return;

        const registro = await navigator.serviceWorker.ready;
        let sub = await registro.pushManager.getSubscription();

        if (!sub) {
            sub = await registro.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        if (sub) {
            await enviarSuscripcionAlServidor(sub);
        }
    } catch (err) {
        console.debug('Push subscription:', err.message);
    }
}

async function enviarSuscripcionAlServidor(sub) {
    try {
        await fetch(BACKEND_SUBSCRIBE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub)
        });
    } catch (err) {
        // En frontend no interrumpimos al usuario si el servidor backend local está apagado
        console.debug('Servidor Node backend no disponible en este momento:', err.message);
    }
}

// =========================================================
// 3. GESTIÓN DE TAREAS Y HÁBITOS (OFFLINE STORAGE)
// =========================================================
function cargarTareas() {
    const guardadas = localStorage.getItem('tasksync_tasks');
    if (guardadas) {
        try {
            tasks = JSON.parse(guardadas);
        } catch (e) {
            tasks = [];
        }
    } else {
        // Tareas iniciales de bienvenida
        tasks = [
            { id: 1, title: 'Instalar PWA en el celular o navegador', category: 'estudio', priority: 'high', completed: false, date: new Date().toLocaleDateString() },
            { id: 2, title: 'Revisar pendientes del día', category: 'trabajo', priority: 'medium', completed: true, date: new Date().toLocaleDateString() },
            { id: 3, title: 'Tomar 2 litros de agua (Hábito saludable)', category: 'salud', priority: 'low', completed: false, date: new Date().toLocaleDateString() }
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

    // Notificación en el dispositivo si están habilitadas
    if ('Notification' in window && Notification.permission === 'granted' && registroSW) {
        registroSW.showNotification('📝 Tarea guardada', {
            body: `"${titulo}" agregada a ${selectTaskCategory.value.toUpperCase()}`,
            icon: './icons/icon-192x192.png'
        });
    } else if ('Notification' in window && Notification.permission === 'default') {
        // Solicitar permisos amigablemente en background
        suscribirPushBackend();
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
                        <span class="category-chip category-${tarea.category}">${tarea.category}</span>
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
});
