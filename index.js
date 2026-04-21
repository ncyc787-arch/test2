// index.js — PhoneMSG: главный файл

import { eventSource, event_types } from '../../../../script.js';
import {
    getState, setContacts, getContacts, getSettings, saveSettings, addMessage, save
} from './state.js';
import {
    generateNPCReply, loadAllContacts,
    setAutoMessageCallback, startAutoMessageScheduler, getActiveLorebookName
} from './engine.js';
import {
    renderContactList, renderChat, renderSettings, bindChatEvents,
    appendBubble, updateBubbleImage, showTyping, hideTyping, handleSettingChange,
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
    fab.title = 'PhoneMSG';
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

    window.addEventListener('resize', guardFAB);
    window.addEventListener('orientationchange', guardFAB);
    console.log(LOG, 'FAB создан');
}

function guardFAB() {
    const fab = document.getElementById('phonemsg-fab');
    if (!fab) return;
    const r = fab.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight - 20 || r.left > window.innerWidth - 20 || r.right < 20) {
        fab.style.top = Math.max(120, window.innerHeight - 200) + 'px';
        fab.style.right = '20px';
        fab.style.bottom = 'auto';
    }
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
    const el = document.getElementById('phonemsg-badge');
    if (el) el.style.display = 'flex';
}
function hideBadge() {
    const el = document.getElementById('phonemsg-badge');
    if (el) el.style.display = 'none';
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
    const s = getSettings();
    const mode = isMobile() ? 'fullscreen' : s.displayMode;
    shell.classList.toggle('pmsg-fullscreen', mode === 'fullscreen');
    shell.classList.toggle('pmsg-floating', mode === 'floating');
}

function updateClock() {
    const el = document.getElementById('pmsg-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
        await reloadContacts();
        renderScreen();
    } else if (action === 'fetch-llm-models') {
        const s = getSettings();
        el.disabled = true; el.textContent = '...';
        try {
            window.__phoneMsgLlmModels = await fetchModels(s.extraApi.endpoint, s.extraApi.apiKey);
            renderScreen();
        } catch (err) {
            alert('Не удалось: ' + err.message);
            el.disabled = false; el.textContent = 'Загрузить модели';
        }
    } else if (action === 'fetch-img-models') {
        const s = getSettings();
        el.disabled = true; el.textContent = '...';
        try {
            window.__phoneMsgImgModels = await fetchModels(s.imageApi.endpoint, s.imageApi.apiKey);
            renderScreen();
        } catch (err) {
            alert('Не удалось: ' + err.message);
            el.disabled = false; el.textContent = 'Загрузить модели';
        }
    } else if (action === 'reset-chat') {
        if (!confirm('Сбросить все переписки в этом чате?')) return;
        const state = getState();
        state.conversations = {};
        state.npcMeta = {};
        state.dynamicContacts = {};
        const c = ctx();
        if (c?.chat) {
            c.chat = c.chat.filter(m => !m.extra?.phonemsg_marker);
            try {
                if (typeof c.saveChatConditional === 'function') await c.saveChatConditional();
                else if (typeof c.saveChat === 'function') await c.saveChat();
            } catch {}
        }
        if (c?.saveMetadata) c.saveMetadata();
        rebuildConversationsInject();
        alert('Переписки сброшены');
        setView('list');
        await reloadContacts();
        renderScreen();
    } else if (action === 'regen-image') {
        // Перегенерация картинки (кнопка на пузырьке)
        const contactId = el.dataset.contactId;
        const genId = el.dataset.genId;
        const prompt = el.dataset.prompt;
        if (!contactId || !genId || !prompt) return;
        await regenBubbleImage(contactId, genId, prompt);
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

// ══════════════════════════════════════════════════
// handleSend — отправка текста и/или картинки юзера
// ══════════════════════════════════════════════════
async function handleSend(contact, text, attachedImageDataUrl = null) {
    const c = ctx();
    const userName = c?.name1 || 'Me';

    if (attachedImageDataUrl) {
        const imgMsg = addMessage(contact.id, userName, text || '', {
            type: 'image',
            imageUrl: attachedImageDataUrl,
            caption: text || '',
            injectText: text || 'фото от пользователя',
        });
        appendBubble(contact.id, imgMsg, userName);
    } else {
        const userMsg = addMessage(contact.id, userName, text);
        appendBubble(contact.id, userMsg, userName);
    }

    rebuildConversationsInject();

    const markerText = attachedImageDataUrl
        ? `${text ? text + ' ' : ''}[прикрепил(а) фото]`
        : text;
    try { await pushOutgoingSystemMarker(contact, markerText); }
    catch (e) { console.error(LOG, 'bridge marker failed:', e); }

    showTyping();
    const replies = await generateNPCReply(contact, text || '[фото]', attachedImageDataUrl);
    hideTyping();

    for (const reply of replies) {
        // Сохраняем в state
        const npcMsg = addMessage(contact.id, contact.name, reply.text || '', {
            type: reply.type || 'text',
            imageUrl: reply.imageUrl || '',
            caption: reply.caption || '',
            injectText: reply.injectText || '',
            _generating: reply._generating || false,
            _imgPrompt: reply._imgPrompt || '',
            _genId: reply._genId || '',
        });

        // Если у reply есть _genId — нужно сохранить его в state чтобы updateGeneratedImage нашёл по нему
        if (reply._genId) {
            // Найти последнее добавленное сообщение и записать _genId
            import('./state.js').then(({ getState, save }) => {
                const st = getState();
                const conv = st.conversations?.[contact.id];
                if (conv && conv.length) {
                    const last = conv[conv.length - 1];
                    if (!last._genId) {
                        last._genId = reply._genId;
                        last._imgPrompt = reply._imgPrompt;
                        last._generating = true;
                        save();
                    }
                }
            });
        }

        appendBubble(contact.id, npcMsg, userName, reply._genId);

        if (replies.length > 1) await new Promise(r => setTimeout(r, 300));
    }

    rebuildConversationsInject();
}

// ── Перегенерация конкретного пузырька-картинки ──────────────────────────────
async function regenBubbleImage(contactId, genId, prompt) {
    const { generateImageWithFallback } = await import('./api.js');
    const { getCustomAvatar, getSettings: gs } = await import('./state.js');

    const contact = getContacts().find(c => c.id === contactId);
    const refAvatar = gs().useAvatarAsRef !== false
        ? (getCustomAvatar(contactId) || contact?.avatar || null)
        : null;

    // Помечаем пузырёк как «генерируется снова»
    updateStateMessage(contactId, genId, { _generating: true, imageUrl: '', image: '' });
    updateBubbleImage(contactId, genId, null, true); // показать спиннер

    try {
        const s = gs();
        const prefix = (s.imagePromptPrefix || '').trim();
        const suffix = (s.imagePromptSuffix || '').trim();
        const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');
        const dataUrl = await generateImageWithFallback(fullPrompt, refAvatar);
        updateStateMessage(contactId, genId, { imageUrl: dataUrl, image: dataUrl, _generating: false });
        updateBubbleImage(contactId, genId, dataUrl, false);
    } catch (err) {
        console.warn(LOG, 'regen failed:', err);
        const errText = `[фото не загрузилось: ${String(err?.message || err).slice(0, 80)}]`;
        updateStateMessage(contactId, genId, { imageUrl: '', image: '', text: errText, _generating: false });
        updateBubbleImage(contactId, genId, null, false, errText);
    }
}

function updateStateMessage(contactId, genId, patch) {
    import('./state.js').then(({ getState, save }) => {
        const st = getState();
        const conv = st.conversations?.[contactId];
        if (!conv) return;
        const msg = conv.find(m => m._genId === genId);
        if (!msg) return;
        Object.assign(msg, patch);
        save();
    });
}

async function handleAutoMessage(contact) {
    const c = ctx();
    const userName = c?.name1 || 'Me';
    showBadge();

    const autoPrompt = `(${contact.name} сам(-а) пишет первым(-ой) после паузы. Напиши короткое естественное сообщение.)`;
    const replies = await generateNPCReply(contact, autoPrompt);

    for (const reply of replies) {
        const npcMsg = addMessage(contact.id, contact.name, reply.text || '', {
            type: reply.type || 'text',
            imageUrl: reply.imageUrl || '',
            _generating: reply._generating || false,
            _imgPrompt: reply._imgPrompt || '',
            _genId: reply._genId || '',
        });
        if (reply._genId) {
            import('./state.js').then(({ getState, save }) => {
                const st = getState();
                const conv = st.conversations?.[contact.id];
                if (conv?.length) {
                    const last = conv[conv.length - 1];
                    if (!last._genId) { last._genId = reply._genId; last._imgPrompt = reply._imgPrompt; save(); }
                }
            });
        }
        if (phoneOpen && currentContact?.id === contact.id) {
            appendBubble(contact.id, npcMsg, userName, reply._genId);
        }
        if (replies.length > 1) await new Promise(r => setTimeout(r, 300));
    }
    rebuildConversationsInject();
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

// ── Слушаем событие phonemsg:rerender для обновления пузырька картинки ───────
window.addEventListener('phonemsg:rerender', (e) => {
    const contactId = e.detail?.contactId;
    if (!contactId || !phoneOpen || currentContact?.id !== contactId) return;

    // Находим все пузырьки с _generating и обновляем их
    import('./state.js').then(({ getState }) => {
        const st = getState();
        const conv = st.conversations?.[contactId];
        if (!conv) return;
        for (const msg of conv) {
            if (!msg._genId) continue;
            const el = document.querySelector(`[data-gen-id="${msg._genId}"]`);
            if (!el) continue;
            if (!msg._generating && msg.imageUrl) {
                updateBubbleImage(contactId, msg._genId, msg.imageUrl, false);
            } else if (!msg._generating && msg.text) {
                // Ошибка генерации — показываем текст
                updateBubbleImage(contactId, msg._genId, null, false, msg.text);
            }
        }
    });
});

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
            try { await processExistingChat(); } catch {}
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
                console.log(LOG, `Ready ✓ (${getContacts().length} контактов)`);
            });
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, (idx) => onMessageReceived(idx));
        eventSource.on(event_types.MESSAGE_SENT, () => setTimeout(hideMarkersInDOM, 100));
        if (event_types.CHAT_LOADED) eventSource.on(event_types.CHAT_LOADED, () => setTimeout(hideMarkersInDOM, 100));
        if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => setTimeout(hideMarkersInDOM, 100));
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
