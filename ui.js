// ui.js — интерфейс PhoneMSG: список, чат, настройки

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
        .replace(/<horae>\s*<\/horae>/gi, '')
        .replace(/<horaeevent>\s*<\/horaeevent>/gi, '')
        .replace(/<horae>[\s\S]*?<\/horae>/gi, '')
        .replace(/<horaeevent>[\s\S]*?<\/horaeevent>/gi, '')
        .split('\n').filter(line => {
            const l = line.trim().toLowerCase();
            if (!l) return true;
            return !(
                l.startsWith('event:') ||
                l.startsWith('time:') ||
                l.startsWith('npc:') ||
                l.startsWith('location:') ||
                l.startsWith('atmosphere:') ||
                l.startsWith('characters:') ||
                l.startsWith('costume:') ||
                l.startsWith('affection:') ||
                l.startsWith('character:') ||
                l.startsWith('race:') ||
                l.startsWith('occupation:') ||
                l.startsWith('gender:') ||
                l.startsWith('age:') ||
                (/^[a-z_]+:/.test(l) && l.includes('|'))
            );
        }).join('\n').trim();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function avatarHTML(contact, size = 44) {
    const color = contact.color || '#007AFF';
    const initial = (contact.name || '?').charAt(0).toUpperCase();
    const custom = getCustomAvatar(contact.id);
    const src = custom || contact.avatar || null;
    if (src) {
        return `<div class="pmsg-avatar" style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;">
            <img src="${esc(src)}" alt="${esc(initial)}" style="width:100%;height:100%;object-fit:cover;display:block;">
        </div>`;
    }
    const fontSize = Math.floor(size * 0.45);
    return `<div class="pmsg-avatar" style="background:${esc(color)};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${fontSize}px;font-weight:600;flex-shrink:0;">
        ${esc(initial)}
    </div>`;
}

function imageBubbleHTML(msg) {
    const caption = filterVisibleText(msg.caption || msg.text || '');
    return `
        <div class="pmsg-image-wrap">
            <img class="pmsg-image" src="${esc(msg.imageUrl)}" alt="${esc(caption || 'Фото')}" loading="lazy">
            ${caption ? `<div class="pmsg-image-caption">${esc(caption)}</div>` : ''}
        </div>
    `;
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
            <button class="pmsg-settings-btn" data-action="open-settings" title="Настройки">⚙</button>
        </div>
        ${lbInfo}
        <div class="pmsg-empty">
            <div style="font-size:48px;margin-bottom:12px;">📱</div>
            <div>Контакты не найдены</div>
            <small>Добавь запись в лорбук с "phone_contact" в поле comment,<br>
            или пусть бот напишет <code>[контакт:Имя:ID]</code> в чате.</small>
            <button class="pmsg-btn" data-action="reload-contacts" style="margin-top:16px;">Обновить</button>
        </div>`;
    }

    const items = contacts.map(c => {
        const sourceIcon = c.source === 'chat' ? '💬 ' : '';
        return `
        <div class="pmsg-contact-row" data-id="${esc(c.id)}">
            ${avatarHTML(c, 44)}
            <div class="pmsg-contact-info">
                <div class="pmsg-contact-name">${sourceIcon}${esc(c.name)}</div>
                <div class="pmsg-contact-preview">${esc(getLastMessagePreview(c.id))}</div>
            </div>
            <div class="pmsg-contact-time">${esc(getLastTime(c.id))}</div>
        </div>
    `;}).join('');

    return `
        <div class="pmsg-header">
            <div class="pmsg-header-title">Сообщения</div>
            <button class="pmsg-settings-btn" data-action="open-settings" title="Настройки">⚙</button>
        </div>
        ${lbInfo}
        <div class="pmsg-contact-list">${items}</div>
    `;
}

function getLastMessagePreview(npcId) {
    const conv = getConversation(npcId);
    if (!conv.length) return 'Нет сообщений';
    const last = conv[conv.length - 1];
    if (last.type === 'image') return '📷 Фото';
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

        if (m.type === 'image' && m.imageUrl) {
            inner = imageBubbleHTML(m);
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
                🖼
                <input type="file" accept="image/*" data-avatar-upload="${esc(contact.id)}" style="display:none">
            </label>
            ${customAvatar ? `<button class="pmsg-settings-btn" data-action="clear-avatar" data-id="${esc(contact.id)}" title="Сбросить аватар">✕</button>` : ''}
        </div>
        <div class="pmsg-messages" id="pmsg-messages">
            ${bubbles || '<div class="pmsg-empty-chat">Нет сообщений</div>'}
        </div>
        <div class="pmsg-input-bar">
            <input type="text" id="pmsg-input" class="pmsg-input"
                   placeholder="iMessage" maxlength="500" autocomplete="off">
            <button id="pmsg-send-btn" class="pmsg-send-btn">
                <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
            </button>
        </div>
    `;
}

export function bindChatEvents(contact, onSend) {
    const sendBtn = document.getElementById('pmsg-send-btn');
    const input = document.getElementById('pmsg-input');
    const avatarInput = document.querySelector(`[data-avatar-upload="${contact.id}"]`);

    if (sendBtn && input) {
        const doSend = () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            onSend(contact, text);
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
                    const contacts = getContacts();
                    screen.innerHTML = renderChat(contacts, contact.id);
                    bindChatEvents(contact, onSend);
                }
            };
            reader.readAsDataURL(file);
        };
    }

    const msgs = document.getElementById('pmsg-messages');
    if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

export function appendBubble(npcId, msg, userName) {
    const msgs = document.getElementById('pmsg-messages');
    if (!msgs) return;
    const isMe = msg.sender === userName;

    const contacts = getContacts();
    const contact = contacts.find(c => c.id === npcId);

    const div = document.createElement('div');
    div.className = `pmsg-bubble-wrap ${isMe ? 'pmsg-me' : 'pmsg-them'}`;

    let inner = '';
    if (msg.type === 'image' && msg.imageUrl) {
        inner = imageBubbleHTML(msg);
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
        </div>
    `;
    msgs.appendChild(div);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
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
        : `<input type="text" class="pmsg-input" data-set-deep="imageApi.model" value="${esc(s.imageApi.model)}" placeholder="dall-e-3, flux-pro">`;

    const activeLb = getActiveLorebookName();

    return `
        <div class="pmsg-header">
            <button class="pmsg-back" data-action="back-to-list">‹</button>
            <div class="pmsg-header-name">Настройки</div>
        </div>
        <div class="pmsg-settings-body">
            <h3 class="pmsg-set-section">Отображение</h3>
            <label class="pmsg-set-field">
                <span>Режим</span>
                <select class="pmsg-input" data-set="displayMode">
                    <option value="floating" ${s.displayMode === 'floating' ? 'selected' : ''}>Плавающее окно (можно двигать)</option>
                    <option value="fullscreen" ${s.displayMode === 'fullscreen' ? 'selected' : ''}>На весь экран</option>
                </select>
            </label>
            <div class="pmsg-hint">На мобильном всегда fullscreen.</div>

            <h3 class="pmsg-set-section">Лорбук с контактами</h3>
            <label class="pmsg-set-field">
                <span>Источник</span>
                <select class="pmsg-input" data-set="lorebookSource">
                    <option value="chat" ${s.lorebookSource === 'chat' ? 'selected' : ''}>Из чата / карточки (авто)</option>
                    <option value="named" ${s.lorebookSource === 'named' ? 'selected' : ''}>По имени</option>
                </select>
            </label>
            ${s.lorebookSource === 'named' ? `
            <label class="pmsg-set-field">
                <span>Имя лорбука</span>
                <input type="text" class="pmsg-input" data-set="lorebookName" value="${esc(s.lorebookName)}">
            </label>` : ''}
            <div class="pmsg-hint">${activeLb ? `Активный: <b>${esc(activeLb)}</b>` : 'Лорбук не найден.'}</div>
            <button class="pmsg-btn" data-action="reload-contacts">Обновить контакты</button>

            <h3 class="pmsg-set-section">Мост с основным чатом</h3>
            <label class="pmsg-set-field">
                <span class="pmsg-checkbox-field">
                    <input type="checkbox" data-set="bridgeEnabled" ${s.bridgeEnabled ? 'checked' : ''}>
                    Включить двунаправленный мост
                </span>
            </label>

            <h3 class="pmsg-set-section">API для ответов НПС ${llmStatus}</h3>
            <label class="pmsg-set-field">
                <span class="pmsg-checkbox-field">
                    <input type="checkbox" data-set="useMainApi" ${s.useMainApi ? 'checked' : ''}>
                    Использовать основной API SillyTavern
                </span>
            </label>
            <div class="pmsg-hint">Если выключено — все ответы НПС пойдут через Extra API ниже.</div>
            <label class="pmsg-set-field">
                <span>Endpoint</span>
                <input type="text" class="pmsg-input" data-set-deep="extraApi.endpoint" value="${esc(s.extraApi.endpoint)}" placeholder="https://api.openai.com">
            </label>
            <label class="pmsg-set-field">
                <span>API Key</span>
                <input type="password" class="pmsg-input" data-set-deep="extraApi.apiKey" value="${esc(s.extraApi.apiKey)}" placeholder="sk-...">
            </label>
            <button class="pmsg-btn" data-action="fetch-llm-models">Загрузить модели</button>
            <label class="pmsg-set-field">
                <span>Модель</span>
                ${llmModelOptions}
            </label>

            <h3 class="pmsg-set-section">Image API (аватары и фото) ${imgStatus}</h3>
            <label class="pmsg-set-field">
                <span class="pmsg-checkbox-field">
                    <input type="checkbox" data-set="useSillyImagesConfig" ${s.useSillyImagesConfig ? 'checked' : ''}>
                    Если пусто — брать из sillyimages
                </span>
            </label>
            <label class="pmsg-set-field">
                <span>Endpoint</span>
                <input type="text" class="pmsg-input" data-set-deep="imageApi.endpoint" value="${esc(s.imageApi.endpoint)}">
            </label>
            <label class="pmsg-set-field">
                <span>API Key</span>
                <input type="password" class="pmsg-input" data-set-deep="imageApi.apiKey" value="${esc(s.imageApi.apiKey)}">
            </label>
            <button class="pmsg-btn" data-action="fetch-img-models">Загрузить модели</button>
            <label class="pmsg-set-field">
                <span>Модель</span>
                ${imgModelOptions}
            </label>
            <label class="pmsg-set-field">
                <span>Размер</span>
                <select class="pmsg-input" data-set-deep="imageApi.size">
                    ${['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'].map(sz => `<option value="${sz}" ${s.imageApi.size === sz ? 'selected' : ''}>${sz}</option>`).join('')}
                </select>
            </label>

            <h3 class="pmsg-set-section">Промпты для картинок</h3>
            <label class="pmsg-set-field">
                <span>Префикс</span>
                <textarea class="pmsg-input" data-set="imagePromptPrefix" rows="2">${esc(s.imagePromptPrefix)}</textarea>
            </label>
            <label class="pmsg-set-field">
                <span>Суффикс</span>
                <textarea class="pmsg-input" data-set="imagePromptSuffix" rows="2">${esc(s.imagePromptSuffix)}</textarea>
            </label>
            <label class="pmsg-set-field">
                <span>Negative prompt</span>
                <textarea class="pmsg-input" data-set="imageNegativePrompt" rows="2">${esc(s.imageNegativePrompt)}</textarea>
            </label>

            <h3 class="pmsg-set-section">Опасная зона</h3>
            <button class="pmsg-btn pmsg-danger" data-action="reset-chat">Сбросить переписки в этом чате</button>
        </div>
    `;
}

export function handleSettingChange(input) {
    const s = getSettings();

    if (input.dataset.set) {
        const k = input.dataset.set;
        let v;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'number') v = Number(input.value) || 0;
        else v = input.value;
        s[k] = v;
    } else if (input.dataset.setDeep) {
        const path = input.dataset.setDeep.split('.');
        let cur = s;
        for (let i = 0; i < path.length - 1; i++) {
            if (cur[path[i]] === undefined) cur[path[i]] = {};
            cur = cur[path[i]];
        }
        const last = path[path.length - 1];
        let v;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'number') v = Number(input.value) || 0;
        else v = input.value;
        cur[last] = v;
    }
    saveSettings();
}
