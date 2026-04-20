// index.js — PhoneMSG: главный файл

import { eventSource, event_types } from '../../../../script.js';
import {
    getState, setContacts, getContacts, getSettings, saveSettings, addMessage
} from './state.js';
import {
    generateNPCReply, loadAllContacts,
    setAutoMessageCallback, startAutoMessageScheduler, getActiveLorebookName
} from './engine.js';
import {
    renderContactList, renderChat, renderSettings, bindChatEvents,
    appendBubble, showTyping, hideTyping, handleSettingChange,
    setView, getView, setCurrentContactId
} from './ui.js';
import { fetchModels } from './api.js';
import {
    pushOutgoingSystemMarker, processBotMessage, processExistingChat,
    hideMarkersInDOM, rebuildConversationsInject
} from './bridge.js';

const LOG = '[PhoneMSG]';
let phoneOpen = false;
let currentContact = null;

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null);
const isMobile = () => window.innerWidth <= 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent || '');

// ═══════════════════════════════════════════════
// FAB
// ═══════════════════════════════════════════════
function createFAB() {
    if (document.getElementById('phonemsg-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'phonemsg-fab';
    fab.title = 'PhoneMSG (зажми и тащи чтобы передвинуть)';
    fab.innerHTML = `
        <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
        </svg>
        <span id="phonemsg-badge" class="pmsg-badge" style="display:none">!</span>
    `;

    const s = getSettings();
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    let right = s.fabPosition?.right ?? 20;
    let top = s.fabPosition?.top ?? Math.max(120, vh - 200);
    right = Math.max(0, Math.min(vw - 56, right));
    top = Math.max(0, Math.min(vh - 90, top));
    fab.style.right = `${right}px`;
    fab.style.top = `${top}px`;
    fab.style.bottom = 'auto';

    (document.documentElement || document.body).appendChild(fab);
    makeFabDraggable(fab);

    const guard = () => {
        const r = fab.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 20 || r.left > window.innerWidth - 20 || r.right < 20) {
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
        fab.classList.add('pmsg-fab-dragging');
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
        fab.classList.remove('pmsg-fab-dragging');
        if (moved) {
            const s = getSettings();
            s.fabPosition = {
                right: parseInt(fab.style.right, 10) || 20,
                top: parseInt(fab.style.top, 10) || 120,
            };
            saveSettings();
        } else {
            togglePhone();
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

function showBadge() {
    const badge = document.getElementById('phonemsg-badge');
    if (badge) badge.style.display = 'flex';
}
function hideBadge() {
    const badge = document.getElementById('phonemsg-badge');
    if (badge) badge.style.display = 'none';
}

function createPhoneShell() {
    if (document.getElementById('phonemsg-shell')) return;
    const shell = document.createElement('div');
    shell.id = 'phonemsg-shell';
    shell.innerHTML = `
        <div class="pmsg-phone-frame">
            <div class="pmsg-notch"></div>
            <div class="pmsg-status-bar">
                <span class="pmsg-time-status" id="pmsg-clock">9:41</span>
                <span class="pmsg-signal">●●●●</span>
                <button class="pmsg-close-btn" data-action="close-phone" title="Закрыть">×</button>
            </div>
            <div id="phonemsg-screen"></div>
        </div>
    `;
    shell.style.display = 'none';
    (document.documentElement || document.body).appendChild(shell);

    updateClock();
    setInterval(updateClock, 60000);

    shell.addEventListener('click', handleShellClick);
    shell.addEventListener('change', handleShellChange);
    shell.addEventListener('input', handleShellInput);
}

function applyDisplayMode() {
    const shell = document.getElementById('phonemsg-shell');
    if (!shell) return;
    const mobile = isMobile();
    const s = getSettings();
    const mode = mobile ? 'fullscreen' : s.displayMode;
    shell.classList.toggle('pmsg-fullscreen', mode === 'fullscreen');
    shell.classList.toggle('pmsg-floating', mode === 'floating');
}

function updateClock() {
    const el = document.getElementById('pmsg-clock');
    if (el) {
        el.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
}

function togglePhone() {
    const shell = document.getElementById('phonemsg-shell');
    if (!shell) return;
    phoneOpen = !phoneOpen;
    if (phoneOpen) {
        applyDisplayMode();
        shell.style.display = 'flex';
        hideBadge();
        if (!getContacts().length) {
            reloadContacts().then(() => renderScreen());
        } else {
            renderScreen();
        }
    } else {
        shell.style.display = 'none';
    }
}

function renderScreen() {
    const screen = document.getElementById('phonemsg-screen');
    if (!screen) return;
    const contacts = getContacts();
    const view = getView();

    if (view === 'settings') {
        screen.innerHTML = renderSettings();
        return;
    }

    if (view === 'chat' && currentContact) {
        screen.innerHTML = renderChat(contacts, currentContact.id);
        bindChatEvents(currentContact, handleSend);
        return;
    }

    screen.innerHTML = renderContactList(contacts);
    screen.querySelectorAll('.pmsg-contact-row').forEach(row => {
        row.onclick = () => {
            const id = row.dataset.id;
            currentContact = contacts.find(c => c.id === id) || null;
            if (currentContact) {
                setView('chat');
                setCurrentContactId(currentContact.id);
                renderScreen();
            }
        };
    });
}

async function handleShellClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'close-phone') {
        togglePhone();
    } else if (action === 'open-settings') {
        setView('settings');
        renderScreen();
    } else if (action === 'back-to-list') {
        setView('list');
        currentContact = null;
        setCurrentContactId(null);
        renderScreen();
    } else if (action === 'reload-contacts') {
        el.disabled = true;
        el.textContent = 'Загружаю...';
        await reloadContacts();
        rebuildConversationsInject();
        renderScreen();
    } else if (action === 'fetch-llm-models') {
        const s = getSettings();
        el.disabled = true;
        el.textContent = '...';
        try {
            const models = await fetchModels(s.extraApi.endpoint, s.extraApi.apiKey);
            window.__phoneMsgLlmModels = models;
            renderScreen();
        } catch (err) {
            alert('Не удалось: ' + err.message);
            el.disabled = false;
            el.textContent = 'Загрузить модели';
        }
    } else if (action === 'fetch-img-models') {
        const s = getSettings();
        el.disabled = true;
        el.textContent = '...';
        try {
            const models = await fetchModels(s.imageApi.endpoint, s.imageApi.apiKey);
            window.__phoneMsgImgModels = models;
            renderScreen();
        } catch (err) {
            alert('Не удалось: ' + err.message);
            el.disabled = false;
            el.textContent = 'Загрузить модели';
        }
    } else if (action === 'reset-chat') {
        if (!confirm('Сбросить все переписки в этом чате?')) return;
        const state = getState();
        state.conversations = {};
        state.npcMeta = {};
        state.dynamicContacts = {};
        const c = ctx();
        if (c?.saveMetadata) c.saveMetadata();
        rebuildConversationsInject();
        alert('Переписки сброшены');
        setView('list');
        await reloadContacts();
        renderScreen();
    } else if (action === 'clear-avatar') {
        const id = el.dataset.id;
        if (!id) return;
        const { clearCustomAvatar } = await import('./state.js');
        clearCustomAvatar(id);
        renderScreen();
    }
}

function handleShellChange(e) {
    const inp = e.target;
    if (inp.dataset?.set || inp.dataset?.setDeep) {
        handleSettingChange(inp);
        if (inp.dataset.set === 'lorebookSource' || inp.dataset.set === 'displayMode') {
            applyDisplayMode();
            renderScreen();
        }
        if (inp.dataset.set === 'bridgeEnabled') {
            rebuildConversationsInject();
        }
    }
}

function handleShellInput(e) {
    const inp = e.target;
    if ((inp.dataset?.set || inp.dataset?.setDeep) && inp.type !== 'checkbox' && inp.tagName !== 'SELECT') {
        handleSettingChange(inp);
    }
}

async function handleSend(contact, text) {
    const c = ctx();
    const userName = c?.name1 || 'Me';

    const userMsg = addMessage(contact.id, userName, text);
    appendBubble(contact.id, userMsg, userName);

    rebuildConversationsInject();

    try { await pushOutgoingSystemMarker(contact, text); }
    catch (e) { console.error(LOG, 'bridge marker failed:', e); }

    showTyping();
    const reply = await generateNPCReply(contact, text);
    hideTyping();

    if (reply) {
        const npcMsg = addMessage(contact.id, contact.name, reply.text || '', {
            type: reply.type || 'text',
            imageUrl: reply.imageUrl || null,
            caption: reply.caption || '',
            injectText: reply.injectText || '',
        });
        appendBubble(contact.id, npcMsg, userName);
        rebuildConversationsInject();
    }
}

async function handleAutoMessage(contact) {
    const c = ctx();
    const userName = c?.name1 || 'Me';
    showBadge();

    const autoPrompt = `(${contact.name} сам(-а) пишет первым(-ой) после паузы. Напиши короткое естественное сообщение.)`;
    const reply = await generateNPCReply(contact, autoPrompt);

    if (reply) {
        const npcMsg = addMessage(contact.id, contact.name, reply.text || '', {
            type: reply.type || 'text',
            imageUrl: reply.imageUrl || null,
            caption: reply.caption || '',
            injectText: reply.injectText || '',
        });
        if (phoneOpen && currentContact?.id === contact.id) {
            appendBubble(contact.id, npcMsg, userName);
        }
        rebuildConversationsInject();
    }
}

async function reloadContacts() {
    const contacts = await loadAllContacts();
    setContacts(contacts);
    if (phoneOpen) renderScreen();
}

async function onMessageReceived(messageIndex) {
    const c = ctx();
    if (!c || !c.chat) return;

    const idx = typeof messageIndex === 'number' ? messageIndex : c.chat.length - 1;

    try {
        const changed = await processBotMessage(idx);
        if (changed) {
            await reloadContacts();
            showBadge();
            rebuildConversationsInject();
        }
    } catch (e) {
        console.error(LOG, 'onMessageReceived failed:', e);
    }
}

function init() {
    try {
        createFAB();
        createPhoneShell();
    } catch (e) {
        console.error(LOG, 'init failed:', e);
        setTimeout(init, 1000);
        return;
    }

    if (eventSource && event_types) {
        eventSource.on(event_types.CHAT_CHANGED, async () => {
            currentContact = null;
            setView('list');
            setCurrentContactId(null);
            await reloadContacts();
            try { await processExistingChat(); } catch (e) { console.warn(LOG, 'processExistingChat:', e); }
            hideMarkersInDOM();
            rebuildConversationsInject();
            if (phoneOpen) renderScreen();
        });

        if (event_types.APP_READY) {
            eventSource.on(event_types.APP_READY, async () => {
                await reloadContacts();
                try { await processExistingChat(); } catch {}
                hideMarkersInDOM();
                rebuildConversationsInject();
            });
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, (messageIndex) => {
            onMessageReceived(messageIndex);
        });
        eventSource.on(event_types.MESSAGE_SENT, () => {
            setTimeout(hideMarkersInDOM, 100);
        });

        if (event_types.CHAT_LOADED) {
            eventSource.on(event_types.CHAT_LOADED, () => setTimeout(hideMarkersInDOM, 100));
        }
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => setTimeout(hideMarkersInDOM, 100));
        }
    }

    setAutoMessageCallback(handleAutoMessage);
    startAutoMessageScheduler(getContacts);

    setTimeout(async () => {
        try {
            await reloadContacts();
            try { await processExistingChat(); } catch {}
            hideMarkersInDOM();
            rebuildConversationsInject();
        } catch (e) {
            console.warn(LOG, 'Отложенная загрузка:', e);
        }
    }, 1500);

    setInterval(hideMarkersInDOM, 3000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.phoneMsgOpen = () => { if (!phoneOpen) togglePhone(); };
window.phoneMsgClose = () => { if (phoneOpen) togglePhone(); };
window.phoneMsgReload = () => reloadContacts().then(() => phoneOpen && renderScreen());
window.phoneMsgDebug = () => ({
    contacts: getContacts(),
    state: getState(),
    settings: getSettings(),
    activeLorebook: getActiveLorebookName(),
});
window.phoneMsgReprocess = async () => {
    await processExistingChat();
    hideMarkersInDOM();
    await reloadContacts();
    rebuildConversationsInject();
    if (phoneOpen) renderScreen();
};
window.phoneMsgInject = () => {
    rebuildConversationsInject();
    console.log('[PhoneMSG] инжект пересобран');
};
