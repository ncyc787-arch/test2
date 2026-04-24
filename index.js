// ═══════════════════════════════════════════
// iMessage — точка входа
// ═══════════════════════════════════════════

import { eventSource, event_types } from '../../../../script.js';
import { reloadRoster, getRoster } from './roster.js';
import { loadState, getSettings } from './state.js';
import { render, handleAction, updateFabBadge, handleFileInput, handleSettingChange } from './ui.js';
import {
    syncToMainChat, syncFromMainChat, clearMainChatInjection, debugInjection,
    injectIntoChatCompletion, startAutoMessageLoop, stopAutoMessageLoop,
} from './engine.js';

const LOG = '[iMessage]';

function injectFab() {
    if (document.getElementById('imessage-fab')) return;
    const settings = getSettings();
    const fab = document.createElement('button');
    fab.id = 'imessage-fab';
    fab.type = 'button';
    fab.title = 'iMessage (зажми и тащи)';

    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    let right = settings.fabPosition?.right ?? 20;
    let top = settings.fabPosition?.top ?? Math.max(120, vh - 200);
    right = Math.max(0, Math.min(vw - 56, right));
    top = Math.max(0, Math.min(vh - 90, top));
    fab.style.right = `${right}px`;
    fab.style.top = `${top}px`;
    fab.style.bottom = 'auto';

    fab.innerHTML = `
        <div class="im-fab-screen">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        </div>
    `;
    (document.documentElement || document.body).appendChild(fab);
    updateFabBadge();
    makeFabDraggable(fab);

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
        fab.classList.add('im-fab-dragging');
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX;
        const dy = p.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        const newRight = Math.max(0, Math.min(window.innerWidth - 56, origRight - dx));
        const newTop = Math.max(0, Math.min(window.innerHeight - 90, origTop + dy));
        fab.style.right = `${newRight}px`;
        fab.style.top = `${newTop}px`;
        fab.style.bottom = 'auto';
        e.preventDefault();
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        fab.classList.remove('im-fab-dragging');
        if (moved) {
            const settings = getSettings();
            settings.fabPosition = {
                right: parseInt(fab.style.right, 10) || 20,
                top: parseInt(fab.style.top, 10) || 120,
            };
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

function injectModal() {
    if (document.getElementById('imessage-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'imessage-modal';
    modal.innerHTML = `
        <div class="im-modal-backdrop" data-im-close></div>
        <div class="im-app" id="imessage-modal-body"></div>
    `;
    (document.documentElement || document.body).appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-im-close')) modal.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
    });
}

async function openApp() {
    const modal = document.getElementById('imessage-modal');
    if (!modal) return;
    modal.classList.add('open');
    if (!Object.keys(getRoster()).length) {
        await reloadRoster();
    }
    render();
}

function bindEvents() {
    const modal = document.getElementById('imessage-modal');
    if (!modal) return;

    modal.addEventListener('click', (e) => {
        const el = e.target.closest('[data-im-action]');
        if (!el || el.tagName === 'FORM') return;
        e.preventDefault();
        e.stopPropagation();
        handleAction(el.getAttribute('data-im-action'), el.getAttribute('data-im-contact'), e);
    });

    let touchTrack = null;
    modal.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        const btn = e.target.closest?.('.im-msg-image-regen, .im-msg-image-regen-failed');
        touchTrack = btn ? { btn, x: t.clientX, y: t.clientY, moved: false } : null;
    }, { passive: true });
    modal.addEventListener('touchmove', (e) => {
        if (!touchTrack) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - touchTrack.x) > 8 || Math.abs(t.clientY - touchTrack.y) > 8) {
            touchTrack.moved = true;
        }
    }, { passive: true });
    modal.addEventListener('touchend', (e) => {
        if (!touchTrack) return;
        const tracked = touchTrack;
        touchTrack = null;
        if (tracked.moved) return;
        e.preventDefault();
        e.stopPropagation();
        const contactId = tracked.btn.getAttribute('data-im-contact');
        handleAction('regen-image', contactId, { target: tracked.btn, preventDefault() {}, stopPropagation() {} });
    }, { passive: false });

    modal.addEventListener('submit', (e) => {
        const el = e.target.closest('[data-im-action]');
        if (!el) return;
        e.preventDefault();
        handleAction(el.getAttribute('data-im-action'), el.getAttribute('data-im-contact'), e);
    });

    modal.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
            handleFileInput(e.target);
        } else if (e.target.dataset?.imSet || e.target.dataset?.imSetDeep) {
            handleSettingChange(e.target);
        }
    });

    modal.addEventListener('input', (e) => {
        if ((e.target.dataset?.imSet || e.target.dataset?.imSetDeep) && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') {
            handleSettingChange(e.target);
        } else if (e.target.dataset?.imPersonaDesc !== undefined) {
            clearTimeout(window.__imPersonaT);
            const val = e.target.value;
            window.__imPersonaT = setTimeout(async () => {
                try {
                    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
                    const pu = c.powerUserSettings;
                    const { user_avatar } = await import('../../../../script.js');
                    if (pu && user_avatar) {
                        if (!pu.persona_descriptions) pu.persona_descriptions = {};
                        if (!pu.persona_descriptions[user_avatar]) pu.persona_descriptions[user_avatar] = { description: '', position: 0, depth: 4, role: 0, lorebook: '', connections: [], title: '' };
                        pu.persona_descriptions[user_avatar].description = val;
                        pu.persona_description = val;
                        if (typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced();
                    }
                } catch {}
            }, 400);
        }
    });

    window.addEventListener('imessage:rerender', () => {
        const m = document.getElementById('imessage-modal');
        if (m?.classList.contains('open')) render();
        updateFabBadge();
    });
}

function onChatChanged() {
    console.log(LOG, 'chat changed');
    updateFabBadge();
    // reset sync cursor для нового чата
    const st = loadState();
    st.lastSyncedMainMsgIdx = -1;
    reloadRoster().then(() => {
        const modal = document.getElementById('imessage-modal');
        if (modal?.classList.contains('open')) render();
        syncToMainChat();
    });
}

function onMessageReceivedInMainChat() {
    // Бот основного чата написал сообщение — проверяем не содержит ли оно
    // "виртуальных iMessage сообщений" которые надо задублировать в наше приложение
    setTimeout(() => {
        try {
            const n = syncFromMainChat();
            if (n > 0) {
                console.log(LOG, `извлёк ${n} сообщений из RP-чата в iMessage`);
                updateFabBadge();
            }
        } catch (e) { console.warn(LOG, 'sync from main failed:', e); }
    }, 300);
}

async function init() {
    injectFab();
    injectModal();
    bindEvents();

    if (eventSource && event_types) {
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        if (event_types.APP_READY) eventSource.on(event_types.APP_READY, onChatChanged);

        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                try { syncToMainChat(); } catch {}
            });
        }
        if (event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
                injectIntoChatCompletion(eventData);
            });
        }
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceivedInMainChat);
        }
        if (event_types.MESSAGE_EDITED) {
            eventSource.on(event_types.MESSAGE_EDITED, onMessageReceivedInMainChat);
        }
    }

    setTimeout(async () => {
        try { await reloadRoster(); } catch (e) { console.error(LOG, e); }
        updateFabBadge();
        syncToMainChat();
        // Первичный синк — подтянуть виртуальные сообщения из существующего чата
        syncFromMainChat();
        // Запускаем таймер автосообщений
        startAutoMessageLoop();
    }, 1500);

    console.log(LOG, 'loaded v1.1.0. Console: imOpen() / imDebug() / imReset() / imReload() / imInject() / imSyncFromMain()');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.imOpen = openApp;
window.imDebug = () => {
    const s = loadState();
    console.log('messages:', Object.keys(s.messages).map(k => `${k}: ${s.messages[k].length}`));
    console.log('unread:', s.unread);
    console.log('roster:', Object.keys(getRoster()));
    return s;
};
window.imReset = async () => {
    const m = await import('./state.js');
    m.resetState();
    clearMainChatInjection();
    updateFabBadge();
    console.log(LOG, 'сброшено');
};
window.imReload = async () => { const n = await reloadRoster(); console.log(LOG, 'контактов:', n); render(); };
window.imInject = debugInjection;
window.imSyncFromMain = () => {
    const n = syncFromMainChat();
    console.log(LOG, `извлечено: ${n}`);
    return n;
};
window.imFabReset = () => {
    const vh = window.innerHeight || 640;
    const settings = getSettings();
    settings.fabPosition = { right: 20, top: Math.max(120, vh - 200) };
    import('./state.js').then(m => m.saveSettings());
    const fab = document.getElementById('imessage-fab');
    if (fab) { fab.style.right = '20px'; fab.style.top = settings.fabPosition.top + 'px'; fab.style.bottom = 'auto'; }
};
