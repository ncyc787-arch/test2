// ui.js — интерфейс PhoneMSG

import {
    getConversation, getContacts, getSettings, saveSettings,
    getCustomAvatar, setCustomAvatar, clearCustomAvatar
} from './state.js';
import { fetchModels, isExtraLLMConfigured, isImageApiConfigured } from './api.js';
import { getActiveLorebookName } from './engine.js';

let currentView = 'list';
let currentContactId = null;

export function setView(v) { currentView = v; }
export function getView() { return currentView; }
export function setCurrentContactId(id) { currentContactId = id; }
export function getCurrentContactId() { return currentContactId; }

export function filterVisibleText(text) {
    if (!text) return '';
    return String(text)
        .replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<horae[\s\S]*?<\/horae>/gi, '')
        .replace(/<horaeevent[\s\S]*?<\/horaeevent>/gi, '')
        .replace(/\[телефон:[^\]]+\]\s*/gi, '')
        .replace(/\[контакт:[^\]]+\]\s*/gi, '')
        .replace(/\[IMG:[^\]]+\]\s*/gi, '')
        .split('\n').filter(line => {
            const l = line.trim().toLowerCase();
            if (!l) return true;
            return !(
                l.startsWith('event:') || l.startsWith('time:') || l.startsWith('npc:') ||
                l.startsWith('location:') || l.startsWith('atmosphere:') ||
                l.startsWith('affection:') || l.startsWith('character:') ||
                (/^[a-z_]+:/.test(l) && l.includes('|'))
            );
        }).join('\n').trim();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function avatarHTML(contact, size = 44) {
    const color = contact.color || '#007AFF';
    const initial = (contact.name || '?').charAt(0).toUpperCase();
    const custom = getCustomAvatar(contact.id);
    const src = custom || contact.avatar || null;

    if (src) {
        return `<div class="pmsg-avatar" style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;">
            <img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover;display:block;">
        </div>`;
    }
    const fontSize = Math.floor(size * 0.45);
    return `<div class="pmsg-avatar" style="background:${esc(color)};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${fontSize}px;font-weight:600;flex-shrink:0;">
        ${esc(initial)}
    </div>`;
}

// ── Пузырёк с картинкой (статический или «генерируется») ────────────────────
function imageBubbleHTML(msg, isMe = false, contactId = '') {
    const colorClass = isMe ? 'pmsg-bubble-me' : 'pmsg-bubble-them';

    if (msg._generating) {
        return `<div class="pmsg-image-wrap ${colorClass}" data-gen-id="${esc(msg._genId || '')}">
            <div class="pmsg-img-spinner">
                <span></span><span></span><span></span>
            </div>
            <div style="font-size:11px;opacity:0.6;margin-top:4px;padding:0 8px 6px;">генерирую фото...</div>
        </div>`;
    }

    if (!msg.imageUrl && !msg.image) {
        // Ошибка / пустое — показываем текст ошибки
        const errText = msg.text || '[фото не загрузилось]';
        return `<div class="pmsg-bubble ${colorClass}" data-gen-id="${esc(msg._genId || '')}">${esc(errText)}</div>`;
    }

    const src = msg.imageUrl || msg.image || '';
    const caption = filterVisibleText(msg.caption || msg.text || '');
    const genId = msg._genId || '';
    const prompt = msg._imgPrompt || '';

    return `<div class="pmsg-image-wrap ${colorClass}" data-gen-id="${esc(genId)}" style="border-radius:18px;overflow:hidden;max-width:220px;">
        <img class="pmsg-image" src="${esc(src)}" loading="lazy"
             style="width:100%;display:block;cursor:pointer;"
             onclick="window.open('${esc(src)}','_blank')">
        ${caption ? `<div class="pmsg-image-caption">${esc(caption)}</div>` : ''}
        ${(!isMe && genId && prompt) ? `
        <div style="display:flex;justify-content:flex-end;padding:2px 6px 4px;">
            <button class="pmsg-regen-btn" data-action="regen-image"
                data-contact-id="${esc(contactId)}"
                data-gen-id="${esc(genId)}"
                data-prompt="${esc(prompt)}"
                title="Перегенерировать">↺</button>
        </div>` : ''}
    </div>`;
}

export function renderContactList(contacts) {
    const activeLb = getActiveLorebookName();
    const lbInfo = activeLb
        ? `<div class="pmsg-lb-info">📚 ${esc(activeLb)}</div>`
        : `<div class="pmsg-lb-info pmsg-warn">⚠ Лорбук не привязан</div>`;

    if (!contacts.length) {
        return `
        <div class="pmsg-header">
            <div class="pmsg-header-title">Сообщения</div>
            <button class="pmsg-settings-btn" data-action="open-settings">⚙</button>
        </div>
        ${lbInfo}
        <div class="pmsg-empty">
            <div style="font-size:48px;margin-bottom:12px;">📱</div>
            <div>Контакты не найдены</div>
            <small>Добавь запись в лорбук с "phone_contact" в поле comment.</small>
            <button class="pmsg-btn" data-action="reload-contacts" style="margin-top:16px;">Обновить</button>
        </div>`;
    }

    const items = contacts.map(c => `
        <div class="pmsg-contact-row" data-id="${esc(c.id)}">
            ${avatarHTML(c, 44)}
            <div class="pmsg-contact-info">
                <div class="pmsg-contact-name">${c.source === 'chat' ? '💬 ' : ''}${esc(c.name)}</div>
                <div class="pmsg-contact-preview">${esc(getLastMessagePreview(c.id))}</div>
            </div>
            <div class="pmsg-contact-time">${esc(getLastTime(c.id))}</div>
        </div>`).join('');

    return `
        <div class="pmsg-header">
            <div class="pmsg-header-title">Сообщения</div>
            <button class="pmsg-settings-btn" data-action="open-settings">⚙</button>
        </div>
        ${lbInfo}
        <div class="pmsg-contact-list">${items}</div>`;
}

function getLastMessagePreview(npcId) {
    const conv = getConversation(npcId);
    if (!conv.length) return 'Нет сообщений';
    const last = conv[conv.length - 1];
    if (last.type === 'image') return last._generating ? '⏳ генерирует фото...' : '📷 Фото';
    const text = filterVisibleText(last.text || '');
    return text.slice(0, 35) + (text.length > 35 ? '…' : '');
}

function getLastTime(npcId) {
    const conv = getConversation(npcId);
    return conv.length ? conv[conv.length - 1].time : '';
}

export function renderChat(contacts, npcId) {
    const contact = contacts.find(c => c.id === npcId);
    if (!contact) return '<div class="pmsg-empty">Контакт не найден</div>';

    const messages = getConversation(npcId);
    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    const userName = c.name1 || 'Me';

    const bubbles = messages.map(m => {
        const isMe = m.sender === userName;
        let inner = '';

        if (m.type === 'image' || m._generating || m._imgPrompt) {
            inner = imageBubbleHTML(m, isMe, npcId);
        } else {
            const visibleText = filterVisibleText(m.text || '');
            if (!visibleText) return '';
            inner = `<div class="pmsg-bubble ${isMe ? 'pmsg-bubble-me' : 'pmsg-bubble-them'}">${esc(visibleText)}</div>`;
        }

        return `<div class="pmsg-bubble-wrap ${isMe ? 'pmsg-me' : 'pmsg-them'}">
            ${!isMe ? avatarHTML(contact, 28) : ''}
            <div class="pmsg-msg-content">
                ${inner}
                <div class="pmsg-time">${esc(m.time)}</div>
            </div>
        </div>`;
    }).filter(Boolean).join('');

    const customAvatar = getCustomAvatar(contact.id);

    return `
        <div class="pmsg-header">
            <button class="pmsg-back" data-action="back-to-list">‹</button>
            ${avatarHTML(contact, 32)}
            <div class="pmsg-header-name">${esc(contact.name)}</div>
            <label class="pmsg-settings-btn" title="Загрузить аватар" style="cursor:pointer;">
                🖼<input type="file" accept="image/*" data-avatar-upload="${esc(contact.id)}" style="display:none">
            </label>
            ${customAvatar ? `<button class="pmsg-settings-btn" data-action="clear-avatar" data-id="${esc(contact.id)}">✕</button>` : ''}
        </div>
        <div class="pmsg-messages" id="pmsg-messages">
            ${bubbles || '<div class="pmsg-empty-chat">Нет сообщений</div>'}
        </div>
        <div id="pmsg-attach-preview" style="display:none;padding:6px 12px;align-items:center;gap:6px;background:rgba(0,0,0,0.08);">
            <span id="pmsg-attach-name" style="font-size:12px;opacity:0.8;flex:1;"></span>
            <button id="pmsg-attach-clear" style="background:none;border:none;cursor:pointer;font-size:14px;opacity:0.7;">✕</button>
        </div>
        <div class="pmsg-input-bar">
            <label class="pmsg-attach-btn" title="Прикрепить фото" style="cursor:pointer;padding:0 8px;display:flex;align-items:center;opacity:0.65;flex-shrink:0;">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
                <input type="file" id="pmsg-attach-input" accept="image/*" style="display:none">
            </label>
            <input type="text" id="pmsg-input" class="pmsg-input" placeholder="iMessage" maxlength="500" autocomplete="off">
            <button id="pmsg-send-btn" class="pmsg-send-btn">
                <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
            </button>
        </div>`;
}

export function bindChatEvents(contact, onSend) {
    const sendBtn = document.getElementById('pmsg-send-btn');
    const input = document.getElementById('pmsg-input');
    const attachInput = document.getElementById('pmsg-attach-input');
    const attachPreview = document.getElementById('pmsg-attach-preview');
    const attachName = document.getElementById('pmsg-attach-name');
    const attachClear = document.getElementById('pmsg-attach-clear');
    const avatarInput = document.querySelector(`[data-avatar-upload="${contact.id}"]`);

    let pendingAttach = null;

    if (attachInput) {
        attachInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                pendingAttach = String(reader.result || '');
                if (attachPreview) attachPreview.style.display = 'flex';
                if (attachName) attachName.textContent = `📎 ${file.name}`;
                attachInput.value = '';
            };
            reader.readAsDataURL(file);
        };
    }

    if (attachClear) {
        attachClear.onclick = () => {
            pendingAttach = null;
            if (attachPreview) attachPreview.style.display = 'none';
        };
    }

    if (sendBtn && input) {
        const doSend = () => {
            const text = input.value.trim();
            if (!text && !pendingAttach) return;
            input.value = '';
            const img = pendingAttach;
            pendingAttach = null;
            if (attachPreview) attachPreview.style.display = 'none';
            onSend(contact, text, img);
        };
        sendBtn.onclick = doSend;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
        };
    }

    if (avatarInput) {
        avatarInput.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                setCustomAvatar(contact.id, String(reader.result || ''));
                const screen = document.getElementById('phonemsg-screen');
                if (screen) {
                    screen.innerHTML = renderChat(getContacts(), contact.id);
                    bindChatEvents(contact, onSend);
                }
            };
            reader.readAsDataURL(file);
        };
    }

    const msgs = document.getElementById('pmsg-messages');
    if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

export function appendBubble(npcId, msg, userName, genId = null) {
    const msgs = document.getElementById('pmsg-messages');
    if (!msgs) return;
    const isMe = msg.sender === userName;
    const contacts = getContacts();
    const contact = contacts.find(c => c.id === npcId);

    const div = document.createElement('div');
    div.className = `pmsg-bubble-wrap ${isMe ? 'pmsg-me' : 'pmsg-them'}`;

    let inner = '';
    // Картинка: либо уже есть imageUrl, либо _generating, либо есть _imgPrompt (ждём генерацию)
    if (msg.type === 'image' || msg._generating || msg._imgPrompt) {
        const msgWithGenId = { ...msg, _genId: genId || msg._genId };
        inner = imageBubbleHTML(msgWithGenId, isMe, npcId);
    } else {
        const visibleText = filterVisibleText(msg.text || '');
        if (!visibleText) return;
        inner = `<div class="pmsg-bubble ${isMe ? 'pmsg-bubble-me' : 'pmsg-bubble-them'}">${esc(visibleText)}</div>`;
    }

    div.innerHTML = `
        ${!isMe && contact ? avatarHTML(contact, 28) : ''}
        <div class="pmsg-msg-content">
            ${inner}
            <div class="pmsg-time">${esc(msg.time)}</div>
        </div>`;
    msgs.appendChild(div);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

// ── Обновить пузырёк картинки по genId (без перерендера всего чата) ──────────
export function updateBubbleImage(contactId, genId, imageUrl, isGenerating, errorText = '') {
    const el = document.querySelector(`[data-gen-id="${genId}"]`);
    if (!el) return;

    const isMe = el.classList.contains('pmsg-bubble-me');
    const colorClass = isMe ? 'pmsg-bubble-me' : 'pmsg-bubble-them';

    if (isGenerating) {
        el.innerHTML = `<div class="pmsg-img-spinner"><span></span><span></span><span></span></div>
            <div style="font-size:11px;opacity:0.6;margin-top:4px;padding:0 8px 6px;">генерирую фото...</div>`;
        return;
    }

    if (errorText) {
        el.outerHTML = `<div class="pmsg-bubble ${colorClass}" data-gen-id="${esc(genId)}">${esc(errorText)}</div>`;
        return;
    }

    if (imageUrl) {
        const prompt = el.dataset?.prompt || '';
        el.innerHTML = `
            <img class="pmsg-image" src="${esc(imageUrl)}" loading="lazy"
                 style="width:100%;display:block;cursor:pointer;"
                 onclick="window.open('${esc(imageUrl)}','_blank')">
            ${!isMe && prompt ? `
            <div style="display:flex;justify-content:flex-end;padding:2px 6px 4px;">
                <button class="pmsg-regen-btn" data-action="regen-image"
                    data-contact-id="${esc(contactId)}"
                    data-gen-id="${esc(genId)}"
                    data-prompt="${esc(prompt)}"
                    title="Перегенерировать">↺</button>
            </div>` : ''}`;
        el.style.cssText = 'border-radius:18px;overflow:hidden;max-width:220px;';
        // Скроллим вниз
        const msgs = document.getElementById('pmsg-messages');
        if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
    }
}

export function showTyping() {
    const msgs = document.getElementById('pmsg-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.id = 'pmsg-typing';
    div.className = 'pmsg-bubble-wrap pmsg-them';
    div.innerHTML = `<div class="pmsg-bubble pmsg-bubble-them pmsg-typing-dots">
        <span></span><span></span><span></span>
    </div>`;
    msgs.appendChild(div);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

export function hideTyping() {
    document.getElementById('pmsg-typing')?.remove();
}

export function renderSettings() {
    const s = getSettings();
    const llmStatus = isExtraLLMConfigured()
        ? `<span class="pmsg-status ok">● подключен</span>`
        : `<span class="pmsg-status err">● не настроен</span>`;
    const imgStatus = isImageApiConfigured()
        ? `<span class="pmsg-status ok">● готов</span>`
        : `<span class="pmsg-status warn">● не настроен</span>`;

    const llmModels = window.__phoneMsgLlmModels || [];
    const llmModelOptions = llmModels.length
        ? `<select class="pmsg-input" data-set-deep="extraApi.model">
            ${llmModels.map(m => `<option value="${esc(m)}" ${m === s.extraApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="pmsg-input" data-set-deep="extraApi.model" value="${esc(s.extraApi.model)}" placeholder="gpt-4o-mini">`;

    const imgModels = window.__phoneMsgImgModels || [];
    const imgModelOptions = imgModels.length
        ? `<select class="pmsg-input" data-set-deep="imageApi.model">
            <option value="">— не выбрано —</option>
            ${imgModels.map(m => `<option value="${esc(m)}" ${m === s.imageApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="pmsg-input" data-set-deep="imageApi.model" value="${esc(s.imageApi.model)}" placeholder="dall-e-3, flux-pro, gemini-2.0-flash-exp">`;

    const activeLb = getActiveLorebookName();

    return `
        <div class="pmsg-header">
            <button class="pmsg-back" data-action="back-to-list">‹</button>
            <div class="pmsg-header-name">Настройки</div>
        </div>
        <div class="pmsg-settings-body">
            <h3 class="pmsg-set-section">Отображение</h3>
            <label class="pmsg-set-field"><span>Режим</span>
                <select class="pmsg-input" data-set="displayMode">
                    <option value="floating" ${s.displayMode === 'floating' ? 'selected' : ''}>Плавающее окно</option>
                    <option value="fullscreen" ${s.displayMode === 'fullscreen' ? 'selected' : ''}>На весь экран</option>
                </select>
            </label>

            <h3 class="pmsg-set-section">Лорбук с контактами</h3>
            <label class="pmsg-set-field"><span>Источник</span>
                <select class="pmsg-input" data-set="lorebookSource">
                    <option value="chat" ${s.lorebookSource === 'chat' ? 'selected' : ''}>Из чата / карточки (авто)</option>
                    <option value="named" ${s.lorebookSource === 'named' ? 'selected' : ''}>По имени</option>
                </select>
            </label>
            ${s.lorebookSource === 'named' ? `<label class="pmsg-set-field"><span>Имя лорбука</span>
                <input type="text" class="pmsg-input" data-set="lorebookName" value="${esc(s.lorebookName)}">
            </label>` : ''}
            <div class="pmsg-hint">${activeLb ? `Активный: <b>${esc(activeLb)}</b>` : 'Лорбук не найден.'}</div>
            <button class="pmsg-btn" data-action="reload-contacts">Обновить контакты</button>

            <h3 class="pmsg-set-section">Мост с основным чатом</h3>
            <label class="pmsg-set-field"><span class="pmsg-checkbox-field">
                <input type="checkbox" data-set="bridgeEnabled" ${s.bridgeEnabled ? 'checked' : ''}>
                Включить двунаправленный мост
            </span></label>

            <h3 class="pmsg-set-section">API для ответов НПС ${llmStatus}</h3>
            <label class="pmsg-set-field"><span class="pmsg-checkbox-field">
                <input type="checkbox" data-set="useMainApi" ${s.useMainApi ? 'checked' : ''}>
                Использовать основной API SillyTavern
            </span></label>
            <div class="pmsg-hint">Выключи если хочешь Extra API (нужен для vision от юзера).</div>
            <label class="pmsg-set-field"><span>Endpoint</span>
                <input type="text" class="pmsg-input" data-set-deep="extraApi.endpoint" value="${esc(s.extraApi.endpoint)}" placeholder="https://api.openai.com">
            </label>
            <label class="pmsg-set-field"><span>API Key</span>
                <input type="password" class="pmsg-input" data-set-deep="extraApi.apiKey" value="${esc(s.extraApi.apiKey)}">
            </label>
            <button class="pmsg-btn" data-action="fetch-llm-models">Загрузить модели</button>
            <label class="pmsg-set-field"><span>Модель</span>${llmModelOptions}</label>

            <h3 class="pmsg-set-section">Image API ${imgStatus}</h3>
            <label class="pmsg-set-field"><span>Тип API</span>
                <select class="pmsg-input" data-set-deep="imageApi.apiType">
                    <option value="openai" ${s.imageApi.apiType === 'openai' ? 'selected' : ''}>OpenAI / совместимые</option>
                    <option value="gemini" ${s.imageApi.apiType === 'gemini' ? 'selected' : ''}>Gemini (nano-banana)</option>
                </select>
            </label>
            <label class="pmsg-set-field"><span class="pmsg-checkbox-field">
                <input type="checkbox" data-set="useSillyImagesConfig" ${s.useSillyImagesConfig ? 'checked' : ''}>
                Если пусто — брать из sillyimages
            </span></label>
            <label class="pmsg-set-field"><span class="pmsg-checkbox-field">
                <input type="checkbox" data-set="useAvatarAsRef" ${s.useAvatarAsRef !== false ? 'checked' : ''}>
                Использовать аватар как реф-изображение
            </span></label>
            <label class="pmsg-set-field"><span>Endpoint</span>
                <input type="text" class="pmsg-input" data-set-deep="imageApi.endpoint" value="${esc(s.imageApi.endpoint)}">
            </label>
            <label class="pmsg-set-field"><span>API Key</span>
                <input type="password" class="pmsg-input" data-set-deep="imageApi.apiKey" value="${esc(s.imageApi.apiKey)}">
            </label>
            <button class="pmsg-btn" data-action="fetch-img-models">Загрузить модели</button>
            <label class="pmsg-set-field"><span>Модель</span>${imgModelOptions}</label>
            <label class="pmsg-set-field"><span>Размер</span>
                <select class="pmsg-input" data-set-deep="imageApi.size">
                    ${['512x512','768x768','1024x1024','1024x1536','1536x1024'].map(sz =>
                        `<option value="${sz}" ${s.imageApi.size === sz ? 'selected' : ''}>${sz}</option>`
                    ).join('')}
                </select>
            </label>
            ${s.imageApi.apiType === 'gemini' ? `
            <label class="pmsg-set-field"><span>Aspect ratio</span>
                <input type="text" class="pmsg-input" data-set-deep="imageApi.aspectRatio" value="${esc(s.imageApi.aspectRatio || '1:1')}" placeholder="1:1, 9:16, 16:9">
            </label>` : ''}

            <h3 class="pmsg-set-section">Промпты для картинок</h3>
            <div class="pmsg-hint">Prefix/Suffix добавляются к каждому промпту от НПС.</div>
            <label class="pmsg-set-field"><span>Префикс</span>
                <textarea class="pmsg-input" data-set="imagePromptPrefix" rows="2">${esc(s.imagePromptPrefix)}</textarea>
            </label>
            <label class="pmsg-set-field"><span>Суффикс</span>
                <textarea class="pmsg-input" data-set="imagePromptSuffix" rows="2">${esc(s.imagePromptSuffix)}</textarea>
            </label>
            <label class="pmsg-set-field"><span>Negative prompt</span>
                <textarea class="pmsg-input" data-set="imageNegativePrompt" rows="2">${esc(s.imageNegativePrompt)}</textarea>
            </label>

            <h3 class="pmsg-set-section">Автосообщения</h3>
            <div class="pmsg-hint">НПС пишут первыми, если давно не было активности.</div>
            <label class="pmsg-set-field"><span class="pmsg-checkbox-field">
                <input type="checkbox" data-set="autoMessagesEnabled" ${s.autoMessagesEnabled ? 'checked' : ''}>
                Включить автосообщения
            </span></label>
            <label class="pmsg-set-field"><span>Молчание перед первым сообщением (мин)</span>
                <input type="number" class="pmsg-input" data-set="autoMessageSilenceMin"
                    value="${s.autoMessageSilenceMin ?? 30}" min="5" max="1440" step="5">
            </label>
            <label class="pmsg-set-field"><span>Кулдаун между автосообщениями (мин)</span>
                <input type="number" class="pmsg-input" data-set="autoMessageCooldownMin"
                    value="${s.autoMessageCooldownMin ?? 60}" min="10" max="1440" step="10">
            </label>

            <h3 class="pmsg-set-section">Опасная зона</h3>
            <button class="pmsg-btn pmsg-danger" data-action="reset-chat">Сбросить переписки в этом чате</button>
        </div>`;
}

export function handleSettingChange(input) {
    const s = getSettings();
    if (input.dataset.set) {
        const k = input.dataset.set;
        s[k] = input.type === 'checkbox' ? input.checked
            : input.type === 'number' ? Number(input.value) || 0
            : input.value;
    } else if (input.dataset.setDeep) {
        const path = input.dataset.setDeep.split('.');
        let cur = s;
        for (let i = 0; i < path.length - 1; i++) {
            if (cur[path[i]] === undefined) cur[path[i]] = {};
            cur = cur[path[i]];
        }
        const last = path[path.length - 1];
        cur[last] = input.type === 'checkbox' ? input.checked
            : input.type === 'number' ? Number(input.value) || 0
            : input.value;
    }
    saveSettings();
}
