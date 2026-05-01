// ═══════════════════════════════════════════
// iMessage — точка входа
// ═══════════════════════════════════════════

import { eventSource, event_types } from '../../../../script.js';
import { reloadRoster, getRoster } from './roster.js';
import { loadState, getSettings, saveSettings } from './state.js';
import { render, handleAction, updateFabBadge, handleFileInput, handleSettingChange, showContextMenu, closeContextMenu, applyTheme } from './ui.js';
import {
    syncToMainChat, syncFromMainChat, clearMainChatInjection, debugInjection,
    injectIntoChatCompletion, startAutoMessageLoop, stopAutoMessageLoop,
} from './engine.js';

const LOG = '[iMessage]';

// ══════════════════════════════════════════════════════════
// ПАНЕЛЬКА РАСШИРЕНИЯ (Extensions sidebar)
// ══════════════════════════════════════════════════════════

function injectExtensionPanel() {
    const container = document.getElementById('imessage-ext-container')
        || document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!container) {
        console.warn(LOG, 'extensions_settings container not found, panel skipped');
        return;
    }
    if (document.getElementById('imessage-ext-drawer')) return;

    const settings = getSettings();

    // ── inline-drawer (стандартный паттерн ST) ──
    const inlineDrawer = document.createElement('div');
    inlineDrawer.id = 'imessage-ext-drawer';
    inlineDrawer.classList.add('inline-drawer');
    container.append(inlineDrawer);

    // Toggle (заголовок)
    const inlineDrawerToggle = document.createElement('div');
    inlineDrawerToggle.classList.add('inline-drawer-toggle', 'inline-drawer-header');

    const extensionName = document.createElement('b');
    extensionName.textContent = '📱 iMessage';

    const inlineDrawerIcon = document.createElement('div');
    inlineDrawerIcon.classList.add('inline-drawer-icon', 'fa-solid', 'fa-circle-chevron-down', 'down');

    inlineDrawerToggle.append(extensionName, inlineDrawerIcon);

    // Content
    const inlineDrawerContent = document.createElement('div');
    inlineDrawerContent.classList.add('inline-drawer-content');

    // Галочка 1: Включить iMessage
    const enabledLabel = document.createElement('label');
    enabledLabel.classList.add('checkbox_label');
    enabledLabel.style.marginBottom = '6px';

    const enabledCb = document.createElement('input');
    enabledCb.id = 'imessage-ext-enabled';
    enabledCb.type = 'checkbox';
    enabledCb.checked = settings.enabled !== false;

    const enabledText = document.createElement('span');
    enabledText.textContent = 'Включить iMessage';
    enabledLabel.append(enabledCb, enabledText);

    const enabledHint = document.createElement('small');
    enabledHint.style.cssText = 'display:block;margin-bottom:10px;opacity:.7;padding-left:24px';
    enabledHint.textContent = 'Выключи чтобы полностью отключить расширение без перезагрузки.';

    // Галочка 2: Скрыть FAB
    const hideFabLabel = document.createElement('label');
    hideFabLabel.classList.add('checkbox_label');
    hideFabLabel.style.marginBottom = '6px';

    const hideFabCb = document.createElement('input');
    hideFabCb.id = 'imessage-ext-hide-fab';
    hideFabCb.type = 'checkbox';
    hideFabCb.checked = !!settings.hideFab;

    const hideFabText = document.createElement('span');
    hideFabText.textContent = 'Скрыть кнопку на экране';
    hideFabLabel.append(hideFabCb, hideFabText);

    const hideFabHint = document.createElement('small');
    hideFabHint.style.cssText = 'display:block;opacity:.7;padding-left:24px';
    hideFabHint.textContent = 'Убирает круглую иконку. Расширение продолжает работать в фоне.';

    // Дропдаун: Анимация уведомления
    const animLabel = document.createElement('label');
    animLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;margin-bottom:6px';

    const animText = document.createElement('span');
    animText.textContent = 'Анимация уведомления';

    const animSelect = document.createElement('select');
    animSelect.id = 'imessage-ext-fab-anim';
    animSelect.style.cssText = 'flex:1;padding:4px 8px;border-radius:6px;background:#2a2a2c;color:#fff;border:1px solid rgba(255,255,255,.15);font-family:inherit;font-size:13px';
    [
        ['none', 'Нет'],
        ['shake', 'Тряска'],
        ['wiggle', 'Покачивание'],
        ['ring', 'Звонок'],
        ['pulse', 'Пульс'],
    ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        if ((settings.fabAnimation || 'wiggle') === val) opt.selected = true;
        animSelect.appendChild(opt);
    });
    animLabel.append(animText, animSelect);

    const animHint = document.createElement('small');
    animHint.style.cssText = 'display:block;opacity:.7;padding-left:24px;margin-bottom:10px';
    animHint.textContent = 'Как иконка реагирует на новое сообщение (только когда iMessage свёрнут).';

    // Дропдаун: Тема телефона
    const themeLabel = document.createElement('label');
    themeLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;margin-bottom:6px';

    const themeText = document.createElement('span');
    themeText.textContent = 'Тема телефона';

    const themeSelect = document.createElement('select');
    themeSelect.id = 'imessage-ext-phone-theme';
    themeSelect.style.cssText = 'flex:1;padding:4px 8px;border-radius:6px;background:#2a2a2c;color:#fff;border:1px solid rgba(255,255,255,.15);font-family:inherit;font-size:13px';
    [
        ['default', 'iMessage (тёмная)'],
        ['kawaii', '♡ Kawaii'],
    ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        if ((settings.phoneTheme || 'default') === val) opt.selected = true;
        themeSelect.appendChild(opt);
    });
    themeLabel.append(themeText, themeSelect);

    const themeHint = document.createElement('small');
    themeHint.style.cssText = 'display:block;opacity:.7;padding-left:24px;margin-bottom:10px';
    themeHint.textContent = 'Внешний вид телефона: цвета, шрифт, форма кнопок.';

    // Слайдер: Размер иконки
    const sizeLabel = document.createElement('label');
    sizeLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;margin-bottom:6px';

    const sizeText = document.createElement('span');
    sizeText.textContent = 'Размер иконки';

    const sizeValue = document.createElement('span');
    sizeValue.style.cssText = 'min-width:36px;text-align:right;font-size:13px;opacity:.8';
    sizeValue.textContent = `${settings.fabSize || 56}px`;

    const sizeRange = document.createElement('input');
    sizeRange.id = 'imessage-ext-fab-size';
    sizeRange.type = 'range';
    sizeRange.min = '32';
    sizeRange.max = '128';
    sizeRange.step = '4';
    sizeRange.value = String(settings.fabSize || 56);
    sizeRange.style.cssText = 'flex:1;accent-color:#0a84ff';

    sizeLabel.append(sizeText, sizeRange, sizeValue);

    const sizeHint = document.createElement('small');
    sizeHint.style.cssText = 'display:block;opacity:.7;padding-left:24px;margin-bottom:10px';
    sizeHint.textContent = 'Размер плавающей кнопки на экране (32–128px).';

    inlineDrawerContent.append(enabledLabel, enabledHint, hideFabLabel, hideFabHint, animLabel, animHint, themeLabel, themeHint, sizeLabel, sizeHint);
    inlineDrawer.append(inlineDrawerToggle, inlineDrawerContent);

    // ── События ──
    enabledCb.addEventListener('change', () => {
        const s = getSettings();
        s.enabled = enabledCb.checked;
        saveSettings();
        applyEnabledState();
    });

    hideFabCb.addEventListener('change', () => {
        const s = getSettings();
        s.hideFab = hideFabCb.checked;
        saveSettings();
        applyFabVisibility();
    });

    animSelect.addEventListener('change', () => {
        const s = getSettings();
        s.fabAnimation = animSelect.value;
        saveSettings();
    });

    themeSelect.addEventListener('change', () => {
        const s = getSettings();
        s.phoneTheme = themeSelect.value;
        saveSettings();
        applyTheme();
    });

    sizeRange.addEventListener('input', () => {
        const v = parseInt(sizeRange.value, 10);
        sizeValue.textContent = `${v}px`;
        const s = getSettings();
        s.fabSize = v;
        saveSettings();
        applyTheme();
    });
}

function applyEnabledState() {
    const settings = getSettings();
    const enabled = settings.enabled !== false;
    const fab = document.getElementById('imessage-fab');
    const modal = document.getElementById('imessage-modal');

    if (enabled) {
        // Включаем — показываем FAB (если не скрыт) и разрешаем работу
        applyFabVisibility();
        startAutoMessageLoop();
        console.log(LOG, 'расширение включено');
    } else {
        // Выключаем — прячем всё, останавливаем автосообщения
        if (fab) fab.style.display = 'none';
        if (modal) modal.classList.remove('open');
        stopAutoMessageLoop();
        clearMainChatInjection();
        console.log(LOG, 'расширение выключено');
    }
}

function applyFabVisibility() {
    const settings = getSettings();
    const fab = document.getElementById('imessage-fab');
    if (!fab) return;
    // FAB видим только если расширение включено И fab не скрыт
    if (settings.enabled !== false && !settings.hideFab) {
        fab.style.display = '';
    } else {
        fab.style.display = 'none';
    }
}

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
    if (!isEnabled()) return;
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
        } else if (e.target.dataset?.imCharToggle !== undefined) {
            // Чекбокс выбора персонажа для character-cards
            const charName = e.target.dataset.imCharToggle;
            const settings = getSettings();
            if (!Array.isArray(settings.characterContacts)) settings.characterContacts = [];
            if (e.target.checked) {
                if (!settings.characterContacts.includes(charName)) settings.characterContacts.push(charName);
            } else {
                settings.characterContacts = settings.characterContacts.filter(n => n !== charName);
            }
            import('./state.js').then(m => m.saveSettings());
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

    // ── Long press → контекстное меню (мобильные) ──
    let longPressState = null;
    const LONG_PRESS_MS = 400;
    const LONG_PRESS_MOVE_THRESHOLD = 10;

    modal.addEventListener('touchstart', (e) => {
        // Только на мобилках (hover: none)
        if (window.matchMedia('(hover: hover)').matches) return;
        const msgEl = e.target.closest?.('.im-msg');
        if (!msgEl) return;
        // Не мешаем кнопкам, ссылкам, инпутам
        const tag = e.target.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.target.closest?.('button, a, input, textarea, label, .im-sticker-panel')) return;

        const t = e.touches[0];
        const timer = setTimeout(() => {
            if (!longPressState) return;
            longPressState.fired = true;

            // Вибрация
            try { navigator.vibrate(30); } catch {}

            // Визуальный фидбек
            msgEl.classList.add('im-msg-held');

            // Определяем данные сообщения
            const chatBody = msgEl.closest('.im-chat-body');
            const allMsgs = chatBody ? [...chatBody.querySelectorAll('.im-msg')] : [];
            const msgIndex = allMsgs.indexOf(msgEl);

            // Получаем contactId и данные из state
            const st = loadState();
            const contactId = st.openContactId;
            if (!contactId) return;

            const msgs = st.messages?.[contactId] || [];
            // Маппинг: DOM-элементы .im-msg не включают date-sep, typing, и т.д.
            // Но индексы DOM-сообщений соответствуют msgs[] (каждое сообщение = один .im-msg)
            // Нужно отфильтровать элементы типа .im-typing и .im-date-sep
            const realMsgEls = allMsgs.filter(el => !el.classList.contains('im-typing'));
            const realIdx = realMsgEls.indexOf(msgEl);
            if (realIdx < 0 || realIdx >= msgs.length) return;

            const msg = msgs[realIdx];
            const isLastContactMsg = msg.from !== 'user' && realIdx === msgs.length - 1;

            showContextMenu(contactId, msg.ts, msg, msgEl.getBoundingClientRect(), isLastContactMsg);
        }, LONG_PRESS_MS);

        longPressState = { timer, x: t.clientX, y: t.clientY, fired: false, msgEl };
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
        if (!longPressState) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - longPressState.x) > LONG_PRESS_MOVE_THRESHOLD ||
            Math.abs(t.clientY - longPressState.y) > LONG_PRESS_MOVE_THRESHOLD) {
            clearTimeout(longPressState.timer);
            longPressState = null;
        }
    }, { passive: true });

    const cancelLongPress = (e) => {
        if (!longPressState) return;
        clearTimeout(longPressState.timer);
        if (longPressState.fired) {
            // Предотвращаем клик/тап после long press
            e.preventDefault();
            e.stopPropagation();
        }
        longPressState = null;
    };
    modal.addEventListener('touchend', cancelLongPress, { passive: false });
    modal.addEventListener('touchcancel', cancelLongPress, { passive: false });

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

function isEnabled() {
    return getSettings().enabled !== false;
}

async function init() {
    // Панелька всегда инжектится — чтобы можно было включить/выключить
    injectExtensionPanel();
    injectFab();
    injectModal();
    bindEvents();

    // Применяем начальное состояние enabled/hideFab
    applyEnabledState();
    applyTheme();

    if (eventSource && event_types) {
        eventSource.on(event_types.CHAT_CHANGED, () => { if (isEnabled()) onChatChanged(); });
        if (event_types.APP_READY) eventSource.on(event_types.APP_READY, () => { if (isEnabled()) onChatChanged(); });

        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                if (!isEnabled()) return;
                try { syncToMainChat(); } catch {}
            });
        }
        if (event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
                if (!isEnabled()) return;
                injectIntoChatCompletion(eventData);
            });
        }
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => { if (isEnabled()) onMessageReceivedInMainChat(); });
        }
        if (event_types.MESSAGE_EDITED) {
            eventSource.on(event_types.MESSAGE_EDITED, () => { if (isEnabled()) onMessageReceivedInMainChat(); });
        }
    }

    setTimeout(async () => {
        if (!isEnabled()) return;
        try { await reloadRoster(); } catch (e) { console.error(LOG, e); }
        updateFabBadge();
        syncToMainChat();
        syncFromMainChat();
        startAutoMessageLoop();
    }, 1500);

    console.log(LOG, 'loaded v1.2.0. Console: imOpen() / imDebug() / imReset() / imReload() / imInject() / imSyncFromMain()');
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
window.imTestAnim = () => {
    const fab = document.getElementById('imessage-fab');
    if (!fab) { console.log('FAB not found'); return; }
    const animType = getSettings().fabAnimation || 'wiggle';
    const cls = `im-fab-anim-${animType}`;
    console.log('[iMessage] testing animation:', cls);
    ['im-fab-anim-shake','im-fab-anim-wiggle','im-fab-anim-ring','im-fab-anim-pulse'].forEach(c => fab.classList.remove(c));
    void fab.offsetWidth;
    fab.classList.add(cls);
    const cleanup = () => fab.classList.remove(cls);
    fab.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 1000);
};
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
