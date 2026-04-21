// ═══════════════════════════════════════════
// iMessage Extension — точка входа
// ═══════════════════════════════════════════

import { eventSource, event_types } from '../../../../script.js';
import { loadState, getSettings, save, resetState } from './state.js';
import { render, updateFabBadge, handleAction, handleFileInput, handleSettingChange } from './ui.js';
import { syncToMainChat, clearMainChatInjection, syncFromMainChat, scheduleNextAutoReply, clearAutoReplyTimer, injectIntoChatCompletion } from './engine.js';

const LOG = '[iMsg]';

// ── FAB ──
function injectFab() {
    if (document.getElementById('imsg-fab')) return;
    const settings = getSettings();
    const fab = document.createElement('button');
    fab.id = 'imsg-fab';
    fab.type = 'button';
    fab.title = 'iMessage (тащи чтобы переместить)';

    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    let right = settings.fabPosition?.right ?? 20;
    let top = settings.fabPosition?.top ?? Math.max(120, vh - 200);
    right = Math.max(0, Math.min(vw - 60, right));
    top = Math.max(0, Math.min(vh - 90, top));
    fab.style.right = `${right}px`;
    fab.style.top = `${top}px`;
    fab.style.bottom = 'auto';

    // Внешний вид — iPhone-like телефон
    fab.innerHTML = `
        <div class="imsg-fab-phone">
            <div class="imsg-fab-screen">
                <div class="imsg-fab-bubble imsg-fab-bubble-in"></div>
                <div class="imsg-fab-bubble imsg-fab-bubble-out"></div>
                <div class="imsg-fab-bubble imsg-fab-bubble-in" style="width:55%"></div>
            </div>
        </div>
        <div class="imsg-fab-label">Messages</div>
    `;
    (document.documentElement || document.body).appendChild(fab);
    updateFabBadge();
    makeFabDraggable(fab);

    // Guard против улёта за экран
    const guard = () => {
        const r = fab.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 20 || r.right < 20 || r.left > window.innerWidth - 20) {
            fab.style.top = Math.max(120, window.innerHeight - 200) + 'px';
            fab.style.right = '20px';
            fab.style.bottom = 'auto';
        }
    };
    window.addEventListener('resize', guard);
    window.addEventListener('orientationchange', guard);
}

function makeFabDraggable(fab) {
    let startX = 0, startY = 0, origRight = 0, origTop = 0;
    let dragging = false, moved = false;

    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        startX = p.clientX; startY = p.clientY;
        origRight = parseInt(fab.style.right, 10) || 20;
        origTop = parseInt(fab.style.top, 10) || 120;
        dragging = true; moved = false;
        fab.classList.add('imsg-fab-dragging');
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX, dy = p.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        fab.style.right = `${Math.max(0, Math.min(window.innerWidth - 60, origRight - dx))}px`;
        fab.style.top = `${Math.max(0, Math.min(window.innerHeight - 90, origTop + dy))}px`;
        fab.style.bottom = 'auto';
        e.preventDefault();
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        fab.classList.remove('imsg-fab-dragging');
        if (moved) {
            const s2 = getSettings();
            s2.fabPosition = { right: parseInt(fab.style.right, 10) || 20, top: parseInt(fab.style.top, 10) || 120 };
            import('./state.js').then(m => m.saveSettings());
        } else {
            openApp();
        }
    };
    fab.addEventListener('mousedown', onDown);
    fab.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
}

// ── Modal ──
function injectModal() {
    if (document.getElementById('imsg-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'imsg-modal';
    modal.innerHTML = `
        <div class="imsg-modal-backdrop" data-imsg-close></div>
        <div class="imsg-modal-body" id="imsg-modal-body"></div>
    `;
    (document.documentElement || document.body).appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-imsg-close')) modal.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
    });
}

async function openApp() {
    const modal = document.getElementById('imsg-modal');
    if (!modal) return;
    // Синкаем имена из текущего чата ST
    syncCharNames();
    modal.classList.add('open');
    render();
    updateFabBadge();
}

// Синхронизировать имя персонажа и пользователя из ST в стейт
function syncCharNames() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const s = loadState();
        if (c.name2) s.charName = c.name2;
        if (c.name1) s.userName = c.name1;
        save();
    } catch {}
}

// ── Биндинг событий в модалке ──
function bindEvents() {
    const modal = document.getElementById('imsg-modal');
    if (!modal) return;

    // Клики
    modal.addEventListener('click', (e) => {
        const el = e.target.closest('[data-imsg-action]');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        handleAction(el.getAttribute('data-imsg-action'), null, e);
    });

    // Файлы
    modal.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
            handleFileInput(e.target);
        } else if (e.target.dataset?.imsgSet || e.target.dataset?.imsgSetDeep) {
            handleSettingChange(e.target);
        }
    });

    // Инпуты (live-save для не-файловых полей)
    modal.addEventListener('input', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') return;
        if (e.target.dataset?.imsgSet || e.target.dataset?.imsgSetDeep) {
            if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') {
                handleSettingChange(e.target);
            }
        }
    });

    // Ре-рендер по асинхронным событиям (генерация картинок и т.п.)
    window.addEventListener('imsg:rerender', () => {
        const m = document.getElementById('imsg-modal');
        if (m?.classList.contains('open')) render();
        updateFabBadge();
    });
}

// ── При смене чата в ST ──
function onChatChanged() {
    console.log(LOG, 'chat changed');
    syncCharNames();
    syncToMainChat();
    updateFabBadge();
    // Перезапускаем авто-таймер
    clearAutoReplyTimer();
    scheduleNextAutoReply();
    const modal = document.getElementById('imsg-modal');
    if (modal?.classList.contains('open')) render();
}

// ── После генерации основного чата — проверить не написал ли бот в телефон ──
function onMessageReceived() {
    syncFromMainChat();
    updateFabBadge();
}

// ── Инициализация ──
async function init() {
    injectFab();
    injectModal();
    bindEvents();

    if (eventSource && event_types) {
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        if (event_types.APP_READY) eventSource.on(event_types.APP_READY, onChatChanged);

        // Перед генерацией — обновить инжекцию
        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                try { syncToMainChat(); } catch {}
            });
        }

        // После генерации — проверить синк из основного чата в телефон
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                setTimeout(onMessageReceived, 300);
            });
        }
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                setTimeout(onMessageReceived, 300);
            });
        }

        // Страховочный инжект в chat completion
        if (event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
                injectIntoChatCompletion(eventData);
            });
        }
    }

    // Отложенная инит
    setTimeout(() => {
        syncCharNames();
        syncToMainChat();
        scheduleNextAutoReply();
        updateFabBadge();
        console.log(LOG, 'loaded v1.0.0. Консоль: imsgOpen() / imsgReset() / imsgDebug()');
    }, 1500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// ── Глобальные хелперы для консоли ──
window.imsgOpen = () => openApp();
window.imsgReset = () => { resetState(); clearMainChatInjection(); updateFabBadge(); console.log(LOG, 'сброшено'); };
window.imsgDebug = () => { const s = loadState(); console.log('state:', s); return s; };
window.imsgFabReset = () => {
    const vh = window.innerHeight || 640;
    const s = getSettings();
    s.fabPosition = { right: 20, top: Math.max(120, vh - 200) };
    import('./state.js').then(m => m.saveSettings());
    const fab = document.getElementById('imsg-fab');
    if (fab) { fab.style.right = '20px'; fab.style.top = s.fabPosition.top + 'px'; fab.style.bottom = 'auto'; }
};
