// ═══════════════════════════════════════════
// UI — iMessage интерфейс
// ═══════════════════════════════════════════

import { loadState, save, pushMessage, updateMessage, deleteMessage, getSettings, saveSettings, resetState, getUnreadCount } from './state.js';
import { generateCharReply, regenerateChatImage, captionUserImage, syncToMainChat, clearMainChatInjection } from './engine.js';
import { fetchModels, isExtraLLMConfigured, isImageApiConfigured } from './api.js';

// ── SVG иконки ──
const ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.4L17 7a7.5 7.5 0 00-1.7-1L15 3.5h-4L10.7 6a7.5 7.5 0 00-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.4L9 17a7.5 7.5 0 001.7 1l.3 2.5h4l.3-2.5a7.5 7.5 0 001.7-1l2.5 1 2-3.4-2.1-1.6zM13 16a4 4 0 110-8 4 4 0 010 8z"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5a4 4 0 11-8 0V5a2.5 2.5 0 015 0v10.5a1 1 0 11-2 0V6H10v9.5a2.5 2.5 0 005 0V5a4 4 0 10-8 0v12.5a5.5 5.5 0 0011 0V6h-1.5z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4zm7-12H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V7l-5-4z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A8 8 0 1019.73 15H17.6a6 6 0 11-1.37-7.2L13 11h7V4l-2.35 2.35z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>',
    videocam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z"/></svg>',
    checkmark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    delivered: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (dayDiff === 0) return 'Сегодня';
    if (dayDiff === 1) return 'Вчера';
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
};

const sameDay = (a, b) => {
    if (!a || !b) return false;
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ── Аватар персонажа ──
function charAvatarHTML(size = 36, cls = '') {
    const settings = getSettings();
    const s = loadState();
    const charName = s.charName || '?';
    const initial = charName[0] || '?';

    // Попробовать аватарку из ST
    let stAvatarUrl = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        if (c.characters && c.characterId != null) {
            const char = c.characters[c.characterId];
            if (char?.avatar && char.avatar !== 'none') {
                stAvatarUrl = `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}`;
            }
        }
    } catch {}

    const avatarSrc = settings.charAvatar || stAvatarUrl || '';
    const style = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;${cls}`;
    if (avatarSrc) {
        return `<img src="${esc(avatarSrc)}" style="${style}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" alt="">
                <div style="${style};display:none;background:var(--imsg-bubble-in);align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size*0.4)}px;color:var(--imsg-text)">${esc(initial)}</div>`;
    }
    return `<div style="${style};background:var(--imsg-bubble-in);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size*0.4)}px;color:var(--imsg-text)">${esc(initial)}</div>`;
}

// ── Шапка iMessage ──
function renderHeader() {
    const s = loadState();
    const charName = esc(s.charName || 'Персонаж');
    return `
    <div class="imsg-status-bar">
        <span>${hhmm()}</span>
        <div style="display:flex;gap:4px;align-items:center;font-size:11px;opacity:.7">
            <span>●●●</span>
            <span>WiFi</span>
            <span>🔋</span>
            <button class="imsg-close-btn" data-imsg-action="close-app" title="закрыть">×</button>
        </div>
    </div>
    <div class="imsg-header">
        <button class="imsg-header-back" data-imsg-action="close-app">${ICONS.back}</button>
        <div class="imsg-header-center">
            <div class="imsg-header-avatar">${charAvatarHTML(36)}</div>
            <div class="imsg-header-name">${charName}</div>
        </div>
        <div class="imsg-header-actions">
            <button class="imsg-icon-btn" title="настройки" data-imsg-action="view-settings">${ICONS.gear}</button>
        </div>
    </div>`;
}

// ── Рендер сообщений ──
function renderMessages() {
    const s = loadState();
    const msgs = s.messages || [];
    if (!msgs.length) {
        return `<div class="imsg-empty">Начните переписку</div>`;
    }
    return msgs.map((m, idx) => {
        const prev = idx > 0 ? msgs[idx - 1] : null;
        const dateSep = (!prev || !sameDay(prev.ts, m.ts))
            ? `<div class="imsg-date-sep">${formatDate(m.ts)}</div>` : '';

        const isUser = m.from === 'user';
        const cls = isUser ? 'imsg-bubble imsg-bubble-out' : 'imsg-bubble imsg-bubble-in';
        const delCls = m.deleted ? ' imsg-bubble-deleted' : '';

        let content = '';

        // Изображение
        if (m.image) {
            const regenBtn = (!isUser && m._imgPrompt)
                ? `<button class="imsg-regen-btn" data-imsg-action="regen-image" data-imsg-ts="${m.ts}" title="перегенерировать">${ICONS.refresh}</button>`
                : '';
            content += `<div class="imsg-img-wrap">
                <img src="${esc(m.image)}" class="imsg-img" data-imsg-action="zoom-image" data-imsg-src="${esc(m.image)}" alt="">
                ${regenBtn}
            </div>`;
        } else if (m._generating) {
            content += `<div class="imsg-img-placeholder">📷 генерируется…</div>`;
        } else if (!isUser && m._imgPrompt && !m.image && !m._generating) {
            content += `<button class="imsg-regen-failed" data-imsg-action="regen-image" data-imsg-ts="${m.ts}">${ICONS.refresh} повторить</button>`;
        }

        // Текст
        if (m.text) {
            content += `<span class="imsg-bubble-text">${esc(m.text)}</span>`;
        }

        // Время + доставлено (только последнее от юзера)
        const isLastUser = isUser && (idx === msgs.length - 1 || msgs.slice(idx + 1).every(x => x.from !== 'user'));
        const timeStr = formatTime(m.ts);
        const timeBlock = timeStr ? `<div class="imsg-bubble-time ${isUser ? 'imsg-bubble-time-out' : ''}">${timeStr}${isLastUser ? ` ${ICONS.delivered}` : ''}</div>` : '';

        // Кнопка удалить (на своих сообщениях)
        const deleteBtn = isUser && !m.deleted
            ? `<button class="imsg-delete-btn" data-imsg-action="delete-msg" data-imsg-ts="${m.ts}" title="удалить">${ICONS.trash}</button>`
            : '';

        const fromMain = m._fromMain ? ' <span class="imsg-from-main" title="из основного чата">↩</span>' : '';

        return `${dateSep}
        <div class="imsg-msg-row ${isUser ? 'imsg-msg-row-out' : 'imsg-msg-row-in'}">
            ${!isUser ? `<div class="imsg-msg-avatar">${charAvatarHTML(28)}</div>` : ''}
            <div class="imsg-msg-col">
                <div class="${cls}${delCls}">${content}</div>
                ${timeBlock}${fromMain}
            </div>
            ${isUser ? deleteBtn : ''}
        </div>`;
    }).join('');
}

// ── Основной чат ──
function viewChat() {
    const s = loadState();
    const isTyping = s.__typing;
    const typingBlock = isTyping ? `
    <div class="imsg-msg-row imsg-msg-row-in">
        <div class="imsg-msg-avatar">${charAvatarHTML(28)}</div>
        <div class="imsg-typing-bubble"><span></span><span></span><span></span></div>
    </div>` : '';

    return `
    <div class="imsg-app">
        ${renderHeader()}
        <div class="imsg-body" id="imsg-body">
            ${renderMessages()}
            ${typingBlock}
        </div>
        <div class="imsg-input-bar">
            <label class="imsg-attach-btn" title="прикрепить фото">
                ${ICONS.camera}
                <input type="file" accept="image/*" data-imsg-file-input style="display:none">
            </label>
            <div class="imsg-input-wrap">
                <textarea class="imsg-input" placeholder="iMessage" rows="1" id="imsg-input"></textarea>
            </div>
            <button class="imsg-send-btn" data-imsg-action="send-msg" id="imsg-send">${ICONS.send}</button>
        </div>
    </div>`;
}

// ── Настройки ──
function viewSettings() {
    const settings = getSettings();
    const s = loadState();

    const llmOk = isExtraLLMConfigured();
    const imgOk = isImageApiConfigured();

    const llmModels = window.__imsgLlmModels || [];
    const imgModels = window.__imsgImgModels || [];

    const llmModelEl = llmModels.length
        ? `<select class="imsg-set-input" data-imsg-set-deep="extraApi.model">
            ${llmModels.map(m => `<option value="${esc(m)}" ${m === settings.extraApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="imsg-set-input" data-imsg-set-deep="extraApi.model" value="${esc(settings.extraApi.model)}" placeholder="или введи вручную">`;

    const imgModelEl = imgModels.length
        ? `<select class="imsg-set-input" data-imsg-set-deep="imageApi.model">
            <option value="">— не выбрано —</option>
            ${imgModels.map(m => `<option value="${esc(m)}" ${m === settings.imageApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="imsg-set-input" data-imsg-set-deep="imageApi.model" value="${esc(settings.imageApi.model)}" placeholder="dall-e-3, flux-pro и т.д.">`;

    // Текущий аватар персонажа ST
    let stAvatarUrl = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        if (c.characters && c.characterId != null) {
            const char = c.characters[c.characterId];
            if (char?.avatar && char.avatar !== 'none') {
                stAvatarUrl = `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}`;
            }
        }
    } catch {}

    const charAvatarPreview = (settings.charAvatar || stAvatarUrl)
        ? `<img src="${esc(settings.charAvatar || stAvatarUrl)}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:6px" alt="">`
        : `<div style="width:60px;height:60px;border-radius:50%;background:var(--imsg-bubble-in);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:6px">${esc((s.charName || '?')[0])}</div>`;

    return `
    <div class="imsg-app">
        <div class="imsg-status-bar">
            <span>${hhmm()}</span>
            <div style="display:flex;gap:4px;align-items:center">
                <button class="imsg-close-btn" data-imsg-action="close-app">×</button>
            </div>
        </div>
        <div class="imsg-settings-header">
            <button class="imsg-header-back" data-imsg-action="view-chat">${ICONS.back} Чат</button>
            <span class="imsg-settings-title">Настройки</span>
        </div>
        <div class="imsg-body imsg-settings-body">

            <div class="imsg-set-section">LLM API <span class="imsg-status-pill ${llmOk ? 'ok' : 'err'}">${llmOk ? '● подключён' : '● не настроен'}</span></div>
            <div class="imsg-set-hint">Все запросы (ответы персонажа, генерация карточек) идут сюда. Основной API ST не трогается.</div>
            <label class="imsg-set-field">
                <span>Endpoint (без /v1)</span>
                <input type="text" class="imsg-set-input" data-imsg-set-deep="extraApi.endpoint" value="${esc(settings.extraApi.endpoint)}" placeholder="https://api.openai.com">
            </label>
            <label class="imsg-set-field">
                <span>API Key</span>
                <input type="password" class="imsg-set-input" data-imsg-set-deep="extraApi.apiKey" value="${esc(settings.extraApi.apiKey)}" placeholder="sk-...">
            </label>
            <div class="imsg-set-row">
                <button class="imsg-set-btn" data-imsg-action="fetch-llm-models">Загрузить модели</button>
            </div>
            <label class="imsg-set-field">
                <span>Модель</span>
                ${llmModelEl}
            </label>
            <div class="imsg-set-row" style="gap:8px">
                <label class="imsg-set-field" style="flex:1">
                    <span>temperature</span>
                    <input type="number" step="0.1" min="0" max="2" class="imsg-set-input" data-imsg-set-deep="extraApi.temperature" value="${settings.extraApi.temperature}">
                </label>
                <label class="imsg-set-field" style="flex:1">
                    <span>max tokens</span>
                    <input type="number" step="50" min="50" max="8000" class="imsg-set-input" data-imsg-set-deep="extraApi.maxTokens" value="${settings.extraApi.maxTokens}">
                </label>
            </div>

            <div class="imsg-set-section">Image API <span class="imsg-status-pill ${imgOk ? 'ok' : 'warn'}">${imgOk ? '● готов' : '● fallback /sd'}</span></div>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set="useSillyImagesConfig" ${settings.useSillyImagesConfig ? 'checked' : ''}>
                <span>Использовать настройки расширения sillyimages если своё не задано</span>
            </label>
            <label class="imsg-set-field">
                <span>Image API тип</span>
                <select class="imsg-set-input" data-imsg-set-deep="imageApi.apiType">
                    <option value="openai" ${settings.imageApi.apiType !== 'gemini' ? 'selected' : ''}>OpenAI-compatible</option>
                    <option value="gemini" ${settings.imageApi.apiType === 'gemini' ? 'selected' : ''}>Gemini</option>
                </select>
            </label>
            <label class="imsg-set-field">
                <span>Endpoint</span>
                <input type="text" class="imsg-set-input" data-imsg-set-deep="imageApi.endpoint" value="${esc(settings.imageApi.endpoint)}" placeholder="https://api.openai.com">
            </label>
            <label class="imsg-set-field">
                <span>API Key</span>
                <input type="password" class="imsg-set-input" data-imsg-set-deep="imageApi.apiKey" value="${esc(settings.imageApi.apiKey)}" placeholder="sk-...">
            </label>
            <div class="imsg-set-row">
                <button class="imsg-set-btn" data-imsg-action="fetch-img-models">Загрузить модели</button>
            </div>
            <label class="imsg-set-field">
                <span>Модель</span>
                ${imgModelEl}
            </label>
            <label class="imsg-set-field">
                <span>Размер</span>
                <select class="imsg-set-input" data-imsg-set-deep="imageApi.size">
                    ${['512x512','768x768','1024x1024','1024x1536','1536x1024'].map(sz =>
                        `<option value="${sz}" ${settings.imageApi.size === sz ? 'selected':''}>${sz}</option>`
                    ).join('')}
                </select>
            </label>

            <div class="imsg-set-section">Промпты для картинок</div>
            <label class="imsg-set-field">
                <span>Префикс (стиль/качество)</span>
                <textarea class="imsg-set-input" data-imsg-set="imagePromptPrefix" rows="2" placeholder="photorealistic, natural lighting, sharp focus">${esc(settings.imagePromptPrefix || '')}</textarea>
            </label>
            <label class="imsg-set-field">
                <span>Суффикс</span>
                <textarea class="imsg-set-input" data-imsg-set="imagePromptSuffix" rows="2" placeholder="instagram aesthetic, cinematic">${esc(settings.imagePromptSuffix || '')}</textarea>
            </label>
            <label class="imsg-set-field">
                <span>Negative prompt</span>
                <textarea class="imsg-set-input" data-imsg-set="imageNegativePrompt" rows="2" placeholder="cartoon, blurry, watermark">${esc(settings.imageNegativePrompt || '')}</textarea>
            </label>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set="useAvatarAsRef" ${settings.useAvatarAsRef !== false ? 'checked' : ''}>
                <span>Использовать аватар как reference при генерации фото в чате</span>
            </label>

            <div class="imsg-set-section">Аватар персонажа</div>
            <div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px">
                ${charAvatarPreview}
                <label class="imsg-set-btn" style="cursor:pointer">
                    Загрузить файл
                    <input type="file" accept="image/*" data-imsg-avatar-upload style="display:none">
                </label>
                ${settings.charAvatar ? `<button class="imsg-set-btn danger" data-imsg-action="clear-char-avatar">Удалить загруженный</button>` : ''}
            </div>
            <div class="imsg-set-hint">Если не загружен — берётся аватар из карточки персонажа ST.</div>

            <div class="imsg-set-section">Лорбук</div>
            <div class="imsg-set-hint">Если к текущему чату или персонажу привязан лорбук — его содержимое автоматически передаётся персонажу как дополнительный контекст. Дополнительных настроек не требуется. Используется лорбук из значка 📕 в шапке ST, или поле «World» в карточке персонажа.</div>

            <div class="imsg-set-section">Синк с основным чатом</div>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set="injectIntoMain" ${settings.injectIntoMain ? 'checked' : ''}>
                <span>Подмешивать переписку из телефона в основной чат ST</span>
            </label>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set="includePersonaDescription" ${settings.includePersonaDescription !== false ? 'checked' : ''}>
                <span>Передавать описание персоны пользователя персонажу</span>
            </label>
            <div class="imsg-set-hint">Когда персонаж в основном чате «пишет в телефон» — сообщение автоматически появится в расширении.</div>

            <div class="imsg-set-section">Картинки от персонажа</div>
            <div class="imsg-set-hint">Персонаж может сам отправлять фото в переписке (когда это уместно по сюжету). Требует настроенного Image API.</div>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set="allowCharImages" ${settings.allowCharImages !== false ? 'checked' : ''}>
                <span>Разрешить персонажу отправлять фото</span>
            </label>

            <div class="imsg-set-section">Авто-сообщения</div>
            <div class="imsg-set-hint">Персонаж сам напишет спустя указанное время, если ты не ответила.</div>
            <label class="imsg-set-field row">
                <input type="checkbox" data-imsg-set-deep="autoReply.enabled" ${settings.autoReply?.enabled ? 'checked' : ''}>
                <span>Включить авто-сообщения</span>
            </label>
            <div class="imsg-set-row" style="gap:8px">
                <label class="imsg-set-field" style="flex:1">
                    <span>Мин. минут</span>
                    <input type="number" min="1" max="1440" class="imsg-set-input" data-imsg-set-deep="autoReply.minMinutes" value="${settings.autoReply?.minMinutes ?? 15}">
                </label>
                <label class="imsg-set-field" style="flex:1">
                    <span>Макс. минут</span>
                    <input type="number" min="1" max="10080" class="imsg-set-input" data-imsg-set-deep="autoReply.maxMinutes" value="${settings.autoReply?.maxMinutes ?? 120}">
                </label>
            </div>
            ${s.nextAutoTs ? `<div class="imsg-set-hint">Следующий авто-ответ: ~${formatTime(s.nextAutoTs)}</div>` : ''}

            <div class="imsg-set-section">Опасная зона</div>
            <button class="imsg-set-btn danger" data-imsg-action="reset-state">Очистить переписку в этом чате</button>

        </div>
    </div>`;
}

// ── Рендер ──
export function render() {
    const root = document.getElementById('imsg-modal-body');
    if (!root) return;
    const s = loadState();

    const html = (s.view === 'settings') ? viewSettings() : viewChat();
    root.innerHTML = html;

    // Скролл вниз
    requestAnimationFrame(() => {
        const body = document.getElementById('imsg-body');
        if (body) body.scrollTop = body.scrollHeight;
    });

    // Авто-ресайз textarea
    const ta = document.getElementById('imsg-input');
    if (ta) {
        ta.addEventListener('input', () => {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
        });
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAction('send-msg', null, e);
            }
        });
    }
}

export function updateFabBadge() {
    const fab = document.getElementById('imsg-fab');
    if (!fab) return;
    const n = getUnreadCount();
    let badge = fab.querySelector('.imsg-fab-badge');
    if (n > 0) {
        if (!badge) { badge = document.createElement('div'); badge.className = 'imsg-fab-badge'; fab.appendChild(badge); }
        badge.textContent = n > 9 ? '9+' : String(n);
    } else if (badge) {
        badge.remove();
    }
}

// ── Хелперы ──
function fileToDataURL(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

async function resizeImage(dataUrl, maxSize = 800) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            let { width: w, height: h } = img;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

function setDeep(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function openZoom(src) {
    const old = document.getElementById('imsg-zoom-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'imsg-zoom-overlay';
    overlay.innerHTML = `
        <div class="imsg-zoom-scroll">
            <img src="${src}" class="imsg-zoom-img" alt="">
        </div>
        <button class="imsg-zoom-close">✕</button>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.imsg-zoom-close').addEventListener('click', close);
    overlay.querySelector('.imsg-zoom-close').addEventListener('touchend', (e) => { e.preventDefault(); close(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('imsg-zoom-scroll')) close(); });
    (document.documentElement || document.body).appendChild(overlay);
}

// ── Action handler ──
export async function handleAction(action, _boyId, evt) {
    const s = loadState();
    const settings = getSettings();

    if (action === 'zoom-image') {
        const el = evt?.target?.closest?.('[data-imsg-src]');
        const src = el?.getAttribute('data-imsg-src');
        if (src) openZoom(src);
        return;
    }

    if (action === 'close-app') {
        const modal = document.getElementById('imsg-modal');
        if (modal) modal.classList.remove('open');
        return;
    }

    if (action === 'view-chat') {
        s.view = 'chat'; save(); render(); return;
    }

    if (action === 'view-settings') {
        s.view = 'settings'; save(); render(); return;
    }

    if (action === 'send-msg') {
        const input = document.getElementById('imsg-input');
        const text = input?.value?.trim();
        if (!text) return;
        input.value = '';
        input.style.height = 'auto';
        pushMessage({ from: 'user', text });
        syncToMainChat();
        s.__typing = true; save();
        render();
        try {
            const n = await generateCharReply();
            if (n > 0) updateFabBadge();
        } catch (e) { console.error('[iMsg] send-msg reply failed:', e); }
        s.__typing = false; save();
        render();
        return;
    }

    if (action === 'delete-msg') {
        const el = evt?.target?.closest?.('[data-imsg-ts]');
        const ts = el?.getAttribute('data-imsg-ts');
        if (!ts) return;
        deleteMessage(Number(ts));
        syncToMainChat();
        render();
        return;
    }

    if (action === 'regen-image') {
        const el = evt?.target?.closest?.('[data-imsg-ts]');
        const ts = el?.getAttribute('data-imsg-ts');
        if (!ts) return;
        try { await regenerateChatImage(Number(ts)); }
        catch (e) { console.error('[iMsg] regen-image failed:', e); }
        return;
    }

    if (action === 'clear-char-avatar') {
        settings.charAvatar = null;
        saveSettings(); render(); return;
    }

    if (action === 'reset-state') {
        if (!confirm('Очистить всю переписку в этом чате?')) return;
        resetState();
        syncToMainChat();
        render(); updateFabBadge();
        return;
    }

    if (action === 'fetch-llm-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        try {
            const models = await fetchModels(settings.extraApi.endpoint, settings.extraApi.apiKey);
            window.__imsgLlmModels = models;
            render();
        } catch (e) {
            alert('Ошибка: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; }
        }
        return;
    }

    if (action === 'fetch-img-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        try {
            const models = await fetchModels(settings.imageApi.endpoint, settings.imageApi.apiKey);
            window.__imsgImgModels = models;
            render();
        } catch (e) {
            alert('Ошибка: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; }
        }
        return;
    }
}

export async function handleFileInput(input) {
    // Прикрепить фото в чат
    if (input.hasAttribute('data-imsg-file-input')) {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await fileToDataURL(file);
        const small = await resizeImage(dataUrl);
        const msg = pushMessage({ from: 'user', image: small, text: '', ts: Date.now() });
        syncToMainChat();
        const s = loadState();
        s.__typing = true; save();
        render();
        captionUserImage(msg.ts, small).catch(() => {});
        try {
            const n = await generateCharReply();
            if (n > 0) updateFabBadge();
        } catch (e) { console.error(e); }
        s.__typing = false; save();
        render();
        return;
    }

    // Загрузить аватар персонажа
    if (input.hasAttribute('data-imsg-avatar-upload')) {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await fileToDataURL(file);
        const small = await resizeImage(dataUrl, 512);
        settings.charAvatar = small;
        saveSettings(); render();
        return;
    }
}

export function handleSettingChange(input) {
    const settings = getSettings();
    const getVal = () => {
        if (input.type === 'checkbox') return input.checked;
        if (input.type === 'number') return Number(input.value) || 0;
        return input.value;
    };

    if (input.dataset.imsgSet) {
        settings[input.dataset.imsgSet] = getVal();
        saveSettings();
        if (input.dataset.imsgSet === 'injectIntoMain') {
            if (settings.injectIntoMain) syncToMainChat();
            else clearMainChatInjection();
        }
    } else if (input.dataset.imsgSetDeep) {
        setDeep(settings, input.dataset.imsgSetDeep, getVal());
        saveSettings();
        // Авто-таймер: перезапустить если изменилась настройка
        if (input.dataset.imsgSetDeep.startsWith('autoReply')) {
            import('./engine.js').then(e => e.resetAutoReplyTimer());
        }
    }
}
