// ═══════════════════════════════════════════
// UI — iMessage интерфейс
// ═══════════════════════════════════════════

import {
    getRoster, getContactOrder, getCustomAvatar, setCustomAvatar, clearCustomAvatar,
    reloadRoster, regenerateContactMeta, hideContact,
} from './roster.js';
import {
    loadState, save, pushMessage, markRead, getSettings, saveSettings, resetState,
} from './state.js';
import {
    generateContactReply, generateAvatar, syncToMainChat, syncFromMainChat,
    regenerateChatImage, captionUserImage, debugInjection, refreshAllSummaries,
    generateRpSummary, saveManualRpSummary, clearRpSummary, getRpSummary,
    forceRefreshContactSummary,
} from './engine.js';
import { fetchModels, isExtraLLMConfigured, isImageApiConfigured } from './api.js';
import { STICKER_PACKS, getPackOrder, stickerUrl, findStickerById, getAllStickers } from './stickers.js';
import { user_avatar, getThumbnailUrl } from '../../../../script.js';

// ── SVG ──
const ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.5-8a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.2l2 6.2-2 6.2a1 1 0 001.4 1.2zM5.7 11l11.3-2-11.3-2v4zm0 2l11.3 2-11.3 2v-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5a4 4 0 11-8 0V5a2.5 2.5 0 015 0v10.5a1 1 0 11-2 0V6H10v9.5a2.5 2.5 0 005 0V5a4 4 0 10-8 0v12.5a5.5 5.5 0 0011 0V6h-1.5z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.4L17 7a7.5 7.5 0 00-1.7-1L15 3.5h-4L10.7 6a7.5 7.5 0 00-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.4L9 17a7.5 7.5 0 001.7 1l.3 2.5h4l.3-2.5a7.5 7.5 0 001.7-1l2.5 1 2-3.4-2.1-1.6zM13 16a4 4 0 110-8 4 4 0 010 8z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A8 8 0 1019.73 15H17.6a6 6 0 11-1.37-7.2L13 11h7V4l-2.35 2.35z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sticker: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatMsgTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatMsgDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (dayDiff === 0) return 'Сегодня';
    if (dayDiff === 1) return 'Вчера';
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
};

const sameDay = (a, b) => {
    if (!a || !b) return false;
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

const relTime = (ts) => {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `${mins} мин`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} д`;
    return formatMsgDate(ts);
};

function avatarHTML(contactId, contact, size = 48) {
    const grad = contact._gradient || 'linear-gradient(135deg,#8e8e93,#636366)';
    const initial = contact._initial || (contact.name || '?')[0].toUpperCase();
    const custom = getCustomAvatar(contactId);
    if (custom) {
        return `<div class="im-avatar" style="background:#000 center/cover no-repeat url('${esc(custom)}');width:${size}px;height:${size}px"></div>`;
    }
    return `<div class="im-avatar" style="background:${grad};width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.42)}px">${esc(initial)}</div>`;
}

function totalUnread() {
    const s = loadState();
    return Object.values(s.unread || {}).reduce((a, b) => a + (b || 0), 0);
}

// ══════════════════════════════════════════════════════════
// ЭКРАНЫ
// ══════════════════════════════════════════════════════════

function viewList() {
    const ROSTER = getRoster();
    const order = getContactOrder();
    const s = loadState();

    // Сортировка: сначала с сообщениями (по времени последнего), потом остальные по порядку в лорбуке
    const withMsgs = [];
    const withoutMsgs = [];
    for (const id of order) {
        const msgs = s.messages?.[id] || [];
        if (msgs.length) {
            withMsgs.push({ id, lastTs: msgs[msgs.length - 1].ts || 0 });
        } else {
            withoutMsgs.push({ id, lastTs: 0 });
        }
    }
    withMsgs.sort((a, b) => b.lastTs - a.lastTs);
    const sorted = [...withMsgs, ...withoutMsgs];

    if (!sorted.length) {
        return wrap(`
        <div class="im-header im-header-main">
            <div class="im-header-actions-left">
                <span class="im-header-btn" data-im-action="view-settings">${ICONS.gear}</span>
            </div>
            <div class="im-header-title">Сообщения</div>
            <div class="im-header-actions-right">
                <span class="im-header-btn" data-im-action="view-me">${ICONS.user}</span>
                <span class="im-header-btn" data-im-action="close-app" title="Закрыть iMessage">${ICONS.close}</span>
            </div>
        </div>
        <div class="im-empty">
            <div class="im-empty-icon">💬</div>
            <div class="im-empty-title">Нет контактов</div>
            <div class="im-empty-sub">Привяжи к чату лорбук (📕 в шапке ST) и нажми «Перезагрузить» в настройках.</div>
            <button class="im-btn-primary" data-im-action="view-settings">Настройки</button>
        </div>`, 'list');
    }

    const rows = sorted.map(({ id }) => {
        const contact = ROSTER[id];
        if (!contact) return '';
        const msgs = s.messages?.[id] || [];
        const last = msgs[msgs.length - 1];
        const unread = s.unread?.[id] || 0;
        const preview = last
            ? (last.from === 'user' ? 'Вы: ' : '') + (last.sticker ? '🩷 Стикер' : last.image ? '📷 Фото' : (last.deleted ? 'Удалено' : (last.text || '').slice(0, 60)))
            : '';
        const timeLbl = last ? relTime(last.ts) : '';
        const autoMark = contact._autoCreated
            ? `<span class="im-list-auto-mark" title="Авто-создан из RP. Открой контакт и прочитай подсказку">⚡</span>`
            : '';
        return `<div class="im-list-row${unread ? ' has-unread' : ''}" data-im-action="open-chat" data-im-contact="${id}">
            ${avatarHTML(id, contact, 48)}
            <div class="im-list-body">
                <div class="im-list-head">
                    <span class="im-list-name">${esc(contact.name)}${autoMark}</span>
                    <span class="im-list-time">${esc(timeLbl)}</span>
                </div>
                <div class="im-list-preview ${last?.deleted ? 'im-text-deleted' : ''}">${esc(preview) || '<span style="opacity:.5">нет сообщений</span>'}</div>
            </div>
            ${unread ? `<div class="im-unread-badge">${unread > 99 ? '99+' : unread}</div>` : ''}
        </div>`;
    }).join('');

    return wrap(`
    <div class="im-header im-header-main">
        <div class="im-header-actions-left">
            <span class="im-header-btn" data-im-action="view-settings">${ICONS.gear}</span>
        </div>
        <div class="im-header-title">Сообщения</div>
        <div class="im-header-actions-right">
            <span class="im-header-btn" data-im-action="view-me">${ICONS.user}</span>
            <span class="im-header-btn" data-im-action="close-app" title="Закрыть iMessage">${ICONS.close}</span>
        </div>
    </div>
    <div class="im-search">
        <input type="text" class="im-search-input" placeholder="Поиск" data-im-search>
    </div>
    <div class="im-list">${rows}</div>
    `, 'list');
}

function viewChat(contactId) {
    const ROSTER = getRoster();
    const contact = ROSTER[contactId];
    if (!contact) return viewList();
    const s = loadState();
    const msgs = s.messages?.[contactId] || [];

    const msgsHTML = msgs.map((m, idx) => {
        const isUser = m.from === 'user';
        const cls = isUser ? 'im-msg im-msg-user' : 'im-msg im-msg-contact';
        const delCls = m.deleted ? ' im-msg-deleted' : '';
        const hasSticker = !!m.sticker;
        const stickerCls = hasSticker ? ' im-msg-has-sticker' : '';
        const stickerWithTextCls = hasSticker && m.text ? ' im-msg-sticker-with-text' : '';

        let stickerHTML = '';
        if (m.sticker) {
            const url = stickerUrl(m.sticker);
            stickerHTML = `<div class="im-msg-sticker-wrap${stickerWithTextCls}">
                <img src="${url}" class="im-msg-sticker" alt="sticker" data-im-action="zoom-image" data-im-src="${url}">
            </div>`;
        }

        let imgHTML = '';
        if (m.image) {
            const regenBtn = !isUser && m._imgPrompt
                ? `<button class="im-msg-image-regen" data-im-action="regen-image" data-im-contact="${contactId}" data-im-msgts="${m.ts}">${ICONS.refresh}</button>`
                : '';
            imgHTML = `<div class="im-msg-image-wrap">
                <img src="${esc(m.image)}" class="im-msg-image" alt="фото" data-im-action="zoom-image" data-im-src="${esc(m.image)}">
                ${regenBtn}
            </div>`;
        } else if (m._generating) {
            imgHTML = `<div class="im-msg-image-loading">📷 генерируется…</div>`;
        }

        const txtHTML = m.text ? `<div class="im-msg-text">${esc(m.text)}</div>` : '';

        const failedRegen = (!isUser && m._imgPrompt && !m.image && !m._generating)
            ? `<button class="im-msg-image-regen-failed" data-im-action="regen-image" data-im-contact="${contactId}" data-im-msgts="${m.ts}">${ICONS.refresh} повторить</button>`
            : '';

        const prev = idx > 0 ? msgs[idx - 1] : null;
        const dateSep = (!prev || !sameDay(prev.ts, m.ts))
            ? `<div class="im-date-sep"><b>${formatMsgDate(m.ts)}</b> ${formatMsgTime(m.ts)}</div>`
            : '';

        // Группировка: tail=последнее в серии от того же отправителя
        const next = idx < msgs.length - 1 ? msgs[idx + 1] : null;
        const isTail = !next || next.from !== m.from || !sameDay(next.ts, m.ts);
        const tailCls = isTail ? ' im-msg-tail' : '';

        return `${dateSep}<div class="${cls}${delCls}${tailCls}${stickerCls}">${stickerHTML}${imgHTML}${txtHTML}${failedRegen}</div>`;
    }).join('');

    const typing = s.__typing === contactId
        ? `<div class="im-msg im-msg-contact im-msg-tail im-typing"><span></span><span></span><span></span></div>`
        : '';

    return wrap(`
    <div class="im-header im-header-chat">
        <button class="im-header-btn im-back" data-im-action="back-to-list">${ICONS.back}</button>
        <div class="im-chat-header-body" data-im-action="view-contact-info" data-im-contact="${contactId}">
            ${avatarHTML(contactId, contact, 36)}
            <div class="im-chat-header-name">${esc(contact.name)}</div>
            <div class="im-chat-header-caret">›</div>
        </div>
        <button class="im-header-btn" data-im-action="view-contact-info" data-im-contact="${contactId}" title="Информация">${ICONS.info}</button>
    </div>
    <div class="im-chat-body" id="im-chat-body">
        ${msgs.length ? msgsHTML : `<div class="im-chat-hint">Новая переписка с ${esc(contact.name)}</div>`}
        ${typing}
    </div>
    <div class="im-sticker-panel" id="im-sticker-panel" style="display:none">${buildStickerPanel(contactId)}</div>
    <form class="im-chat-input" data-im-action="send-msg" data-im-contact="${contactId}">
        <label class="im-chat-attach" title="прикрепить">
            ${ICONS.paperclip}
            <input type="file" accept="image/*" data-im-image-input="${contactId}" style="display:none">
        </label>
        <button type="button" class="im-sticker-btn" data-im-action="toggle-stickers" data-im-contact="${contactId}" title="Стикеры">${ICONS.sticker}</button>
        <input type="text" class="im-chat-field" placeholder="iMessage" autocomplete="off" />
        <button type="submit" class="im-chat-send">${ICONS.send}</button>
    </form>
    `, 'chat', 'im-body-fill');
}

function viewContactInfo(contactId) {
    const ROSTER = getRoster();
    const contact = ROSTER[contactId];
    if (!contact) return viewList();
    const s = loadState();
    const msgCount = s.messages?.[contactId]?.length || 0;
    const rawDesc = contact._rawDescription || '';

    return wrap(`
    <div class="im-header im-header-chat">
        <button class="im-header-btn im-back" data-im-action="back-to-chat">${ICONS.back}</button>
        <div class="im-chat-header-body" style="pointer-events:none">
            <div class="im-chat-header-name">Информация</div>
        </div>
        <div style="width:36px"></div>
    </div>
    <div class="im-contact-info">
        <div class="im-contact-avatar-big">
            ${avatarHTML(contactId, contact, 120)}
        </div>
        <div class="im-contact-name">${esc(contact.name)}</div>
        <div class="im-contact-stats">${msgCount} ${msgCount === 1 ? 'сообщение' : msgCount < 5 ? 'сообщения' : 'сообщений'}</div>

        ${contact._autoCreated ? `
        <div class="im-contact-section" style="border:1px solid rgba(255,204,0,.3);background:rgba(255,204,0,.08)">
            <div class="im-contact-section-title" style="color:#ffcc00">⚡ Авто-создан из RP</div>
            <div class="im-contact-desc">Контакт появился сам когда в чате ST бот написал «${esc(contact.name)} texts: ...». У него нет описания, поэтому LLM отвечает обезличенно. Чтобы задать характер и стиль — добавь запись с именем «${esc(contact.name)}» в лорбук этого чата и нажми «Перечитать из лорбука» ниже.</div>
        </div>` : ''}

        ${rawDesc ? `
        <div class="im-contact-section">
            <div class="im-contact-section-title">О контакте</div>
            <div class="im-contact-desc">${esc(rawDesc)}</div>
        </div>` : ''}

        ${contact.styleNote ? `
        <div class="im-contact-section">
            <div class="im-contact-section-title">Как пишет</div>
            <div class="im-contact-desc">${esc(contact.styleNote)}</div>
        </div>` : ''}

        <div class="im-contact-actions">
            <button class="im-btn-row" data-im-action="gen-avatar" data-im-contact="${contactId}">
                <span>Сгенерировать фото</span>
            </button>
            <label class="im-btn-row">
                <span>Загрузить фото</span>
                <input type="file" accept="image/*" data-im-avatar-upload="${contactId}" style="display:none">
            </label>
            ${getCustomAvatar(contactId) ? `
            <button class="im-btn-row im-btn-row-danger" data-im-action="clear-avatar" data-im-contact="${contactId}">
                <span>Удалить фото</span>
            </button>` : ''}
            <button class="im-btn-row" data-im-action="regen-card" data-im-contact="${contactId}">
                <span>Перечитать из лорбука</span>
            </button>
            <button class="im-btn-row" data-im-action="refresh-contact-summary" data-im-contact="${contactId}">
                <span>Обновить саммари переписки</span>
            </button>
            <button class="im-btn-row im-btn-row-danger" data-im-action="clear-chat" data-im-contact="${contactId}">
                <span>Очистить чат</span>
            </button>
            <button class="im-btn-row im-btn-row-danger" data-im-action="hide-contact" data-im-contact="${contactId}">
                <span>Скрыть контакт</span>
            </button>
        </div>

        ${(() => {
            const summary = s.summaries?.[contactId];
            if (!summary?.text) return '';
            const genDate = summary.ts
                ? new Date(summary.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '';
            return `
            <div class="im-contact-section">
                <div class="im-contact-section-title">Саммари переписки ${genDate ? `(обновлено ${genDate})` : ''}</div>
                <div class="im-contact-desc">${esc(summary.text)}</div>
            </div>`;
        })()}
    </div>
    `, 'contact-info', 'im-body-fill');
}

function viewRpEvents() {
    const s = loadState();
    const rp = s.rpSummary || {};
    const hasText = !!(rp.text && rp.text.trim());
    const lastGenLbl = rp.ts
        ? new Date(rp.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : 'не создавалось';
    const manualLbl = rp.manualEdit ? ' (отредактировано вручную)' : '';

    return `<div class="im-view">
        <div class="im-head">
            <button class="im-back" data-im-action="back-to-settings">‹</button>
            <div class="im-title">События RP</div>
            <button class="im-back" data-im-action="close-app" title="Закрыть iMessage" style="font-size:18px">✕</button>
        </div>
        <div class="im-settings">
            <div class="im-set-hint" style="padding:12px;background:rgba(100,150,255,.06);border-radius:8px;margin-bottom:8px">
                Это саммари того, что происходит в основном RP-чате: события, отношения, сюжетные линии. <b>Видят ВСЕ контакты</b> (они «в курсе» твоей жизни).
                <br><br>
                <b>Зачем:</b> если вчера в RP ты с кем-то встречалась, поссорилась, сходила на свидание — контакт в iMessage будет знать об этом и не выдумает херню.
                <br><br>
                Можно сгенерировать автоматически из последних ~100 сообщений RP-чата, или написать/отредактировать вручную. Если отредактировал вручную — пометка <i>«отредактировано вручную»</i> появится рядом.
            </div>

            <div class="im-set-field">
                <span>Последняя генерация: <b>${lastGenLbl}</b>${manualLbl}</span>
            </div>

            <label class="im-set-field">
                <span>Текст саммари (можно редактировать):</span>
                <textarea id="im-rp-summary-text" class="im-set-input" rows="12" style="font-family:-apple-system,system-ui,sans-serif;line-height:1.5" placeholder="Например: 'Лили вчера сходила на свидание с Хоупенсом, было неловко. Аякс узнал и взбесился. На работе — конфликт с боссом...'">${esc(rp.text || '')}</textarea>
            </label>

            <div class="im-set-row">
                <button class="im-set-btn" data-im-action="gen-rp-summary" style="flex:2">🔄 Сгенерировать из RP-чата</button>
                <button class="im-set-btn" data-im-action="save-rp-summary" style="flex:1">💾 Сохранить вручную</button>
            </div>
            ${hasText ? `<button class="im-set-btn small" data-im-action="clear-rp-summary" style="color:#ff453a">Очистить</button>` : ''}
        </div>
    </div>`;
}

function viewSettings() {
    const settings = getSettings();
    const llmStatus = isExtraLLMConfigured()
        ? `<span class="im-status ok">подключен</span>`
        : `<span class="im-status err">не настроен</span>`;
    const imgStatus = isImageApiConfigured()
        ? `<span class="im-status ok">готов</span>`
        : `<span class="im-status warn">fallback /sd</span>`;

    const llmModels = window.__imLlmModels || [];
    const llmModelOptions = llmModels.length
        ? `<select class="im-set-input" data-im-set-deep="extraApi.model">
            ${llmModels.map(m => `<option value="${esc(m)}" ${m === settings.extraApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="im-set-input" data-im-set-deep="extraApi.model" value="${esc(settings.extraApi.model)}" placeholder="нажми Загрузить модели">`;

    const imgModels = window.__imImgModels || [];
    const imgModelOptions = imgModels.length
        ? `<select class="im-set-input" data-im-set-deep="imageApi.model">
            <option value="">— не выбрано —</option>
            ${imgModels.map(m => `<option value="${esc(m)}" ${m === settings.imageApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="im-set-input" data-im-set-deep="imageApi.model" value="${esc(settings.imageApi.model)}" placeholder="напр. dall-e-3, flux, nano-banana">`;

    return wrap(`
    <div class="im-header im-header-chat">
        <button class="im-header-btn im-back" data-im-action="back-to-list">${ICONS.back}</button>
        <div class="im-chat-header-body" style="pointer-events:none">
            <div class="im-chat-header-name">Настройки</div>
        </div>
        <span class="im-header-btn" data-im-action="close-app" title="Закрыть iMessage">${ICONS.close}</span>
    </div>
    <div class="im-settings">

        <h3 class="im-set-section">Контакты</h3>
        <label class="im-set-field">
            <span>Источник контактов</span>
            <select class="im-set-input" data-im-set="rosterSource">
                <option value="chat-lorebook" ${settings.rosterSource === 'chat-lorebook' ? 'selected' : ''}>Лорбук чата (📕 в ST)</option>
                <option value="named-lorebook" ${settings.rosterSource === 'named-lorebook' ? 'selected' : ''}>Лорбук по имени</option>
            </select>
        </label>
        ${settings.rosterSource === 'named-lorebook' ? `
        <label class="im-set-field">
            <span>Имя лорбука</span>
            <input type="text" class="im-set-input" data-im-set="lorebookName" value="${esc(settings.lorebookName)}">
        </label>` : ''}
        <div class="im-set-hint">Каждая запись лорбука = один контакт. Имя из <b>comment</b>, описание из <b>content</b>.</div>
        <button class="im-set-btn" data-im-action="reload-roster">Перезагрузить контакты</button>

        <h3 class="im-set-section">LLM API ${llmStatus}</h3>
        <div class="im-set-hint">Все запросы iMessage идут сюда. Основной API ST не трогается.</div>
        <label class="im-set-field">
            <span>Endpoint</span>
            <input type="text" class="im-set-input" data-im-set-deep="extraApi.endpoint" value="${esc(settings.extraApi.endpoint)}" placeholder="https://api.openai.com">
        </label>
        <label class="im-set-field">
            <span>API Key</span>
            <input type="password" class="im-set-input" data-im-set-deep="extraApi.apiKey" value="${esc(settings.extraApi.apiKey)}" placeholder="sk-...">
        </label>
        <button class="im-set-btn" data-im-action="fetch-llm-models">Загрузить модели</button>
        <label class="im-set-field">
            <span>Модель</span>
            ${llmModelOptions}
        </label>
        <div class="im-set-row">
            <label class="im-set-field" style="flex:1">
                <span>temperature</span>
                <input type="number" step="0.1" min="0" max="2" class="im-set-input" data-im-set-deep="extraApi.temperature" value="${settings.extraApi.temperature}">
            </label>
            <label class="im-set-field" style="flex:1">
                <span>max tokens</span>
                <input type="number" step="50" min="50" max="8000" class="im-set-input" data-im-set-deep="extraApi.maxTokens" value="${settings.extraApi.maxTokens}">
            </label>
        </div>

        <h3 class="im-set-section">Image API ${imgStatus}</h3>
        <label class="im-set-field row">
            <input type="checkbox" data-im-set="useSillyImagesConfig" ${settings.useSillyImagesConfig ? 'checked' : ''}>
            <span>Использовать настройки sillyimages если поля ниже пусты</span>
        </label>
        <label class="im-set-field">
            <span>Endpoint</span>
            <input type="text" class="im-set-input" data-im-set-deep="imageApi.endpoint" value="${esc(settings.imageApi.endpoint)}">
        </label>
        <label class="im-set-field">
            <span>API Key</span>
            <input type="password" class="im-set-input" data-im-set-deep="imageApi.apiKey" value="${esc(settings.imageApi.apiKey)}">
        </label>
        <button class="im-set-btn" data-im-action="fetch-img-models">Загрузить модели</button>
        <label class="im-set-field">
            <span>Модель</span>
            ${imgModelOptions}
        </label>
        <label class="im-set-field">
            <span>Размер</span>
            <select class="im-set-input" data-im-set-deep="imageApi.size">
                ${['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'].map(sz => `<option value="${sz}" ${settings.imageApi.size === sz ? 'selected' : ''}>${sz}</option>`).join('')}
            </select>
        </label>

        <h3 class="im-set-section">Промпты картинок</h3>
        <label class="im-set-field">
            <span>Префикс</span>
            <textarea class="im-set-input" data-im-set="imagePromptPrefix" rows="2">${esc(settings.imagePromptPrefix || '')}</textarea>
        </label>
        <label class="im-set-field">
            <span>Суффикс</span>
            <textarea class="im-set-input" data-im-set="imagePromptSuffix" rows="2">${esc(settings.imagePromptSuffix || '')}</textarea>
        </label>
        <label class="im-set-field">
            <span>Negative</span>
            <textarea class="im-set-input" data-im-set="imageNegativePrompt" rows="2">${esc(settings.imageNegativePrompt || '')}</textarea>
        </label>
        <label class="im-set-field row">
            <input type="checkbox" data-im-set="useAvatarAsRef" ${settings.useAvatarAsRef !== false ? 'checked' : ''}>
            <span>Использовать аватарку как референс при генерации</span>
        </label>

        <h3 class="im-set-section">Автосообщения</h3>
        <label class="im-set-field row">
            <input type="checkbox" data-im-set="autoMessages" ${settings.autoMessages ? 'checked' : ''}>
            <span>Контакты могут писать сами через время</span>
        </label>
        <div class="im-set-hint">Бот напишет сам, если ты давно не отвечаешь или долго молчали.</div>
        <div class="im-set-row">
            <label class="im-set-field" style="flex:1">
                <span>мин минут</span>
                <input type="number" min="1" max="1440" class="im-set-input" data-im-set="autoMinMinutes" value="${settings.autoMinMinutes}">
            </label>
            <label class="im-set-field" style="flex:1">
                <span>макс минут</span>
                <input type="number" min="1" max="10080" class="im-set-input" data-im-set="autoMaxMinutes" value="${settings.autoMaxMinutes}">
            </label>
            <label class="im-set-field" style="flex:1">
                <span>вероятность</span>
                <input type="number" step="0.05" min="0" max="1" class="im-set-input" data-im-set="autoProbability" value="${settings.autoProbability}">
            </label>
        </div>

        <h3 class="im-set-section">Язык сообщений</h3>
        <label class="im-set-field">
            <span>Контакты пишут на</span>
            <select class="im-set-input" data-im-set="messageLanguage">
                <option value="russian" ${settings.messageLanguage === 'russian' ? 'selected' : ''}>Русский</option>
                <option value="english" ${settings.messageLanguage === 'english' ? 'selected' : ''}>English</option>
                <option value="japanese" ${settings.messageLanguage === 'japanese' ? 'selected' : ''}>日本語 (японский)</option>
                <option value="spanish" ${settings.messageLanguage === 'spanish' ? 'selected' : ''}>Español</option>
                <option value="french" ${settings.messageLanguage === 'french' ? 'selected' : ''}>Français</option>
                <option value="german" ${settings.messageLanguage === 'german' ? 'selected' : ''}>Deutsch</option>
                <option value="chinese" ${settings.messageLanguage === 'chinese' ? 'selected' : ''}>中文 (китайский)</option>
                <option value="korean" ${settings.messageLanguage === 'korean' ? 'selected' : ''}>한국어 (корейский)</option>
            </select>
        </label>
        <div class="im-set-hint">Если лорбук на английском, а ты хочешь переписку на русском — выбери «Русский». Иначе бот скатывается в язык лорбука.</div>

        <h3 class="im-set-section">Синхронизация с чатом ST</h3>
        <label class="im-set-field row">
            <input type="checkbox" data-im-set="injectIntoMain" ${settings.injectIntoMain ? 'checked' : ''}>
            <span>Подмешивать переписку iMessage в чат ST</span>
        </label>
        <div class="im-set-hint">Основной бот будет знать о переписке. А если в RP он напишет «Имя: "текст"» или «Имя написал: "текст"» — сообщение появится в iMessage автоматически.</div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set="useLLMParser" ${settings.useLLMParser !== false ? 'checked' : ''}>
            <span>Умный парсер через LLM (точнее, но тратит токены)</span>
        </label>
        <div class="im-set-hint">Для каждого RP-сообщения с признаками телефонного контекста делается отдельный LLM-вызов который выделяет iMessage-сообщения. Точнее regex. Отключи если нужна экономия.</div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set="useLLMSummaries" ${settings.useLLMSummaries !== false ? 'checked' : ''}>
            <span>Краткое саммари длинных переписок (экономит токены)</span>
        </label>
        <div class="im-set-hint">Когда переписка превышает лимит дословных сообщений — LLM делает краткое саммари старых сообщений. В инжект идёт: саммари + последние N сообщений. Сильно экономит токены на длинных переписках.</div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set="injectPhoneSummary" ${settings.injectPhoneSummary !== false ? 'checked' : ''}>
            <span>Сводка переписок телефона → в RP-чат</span>
        </label>
        <div class="im-set-hint">RP-бот будет видеть краткое саммари всех переписок из телефона (о чём общались, текущий статус). Персонаж при этом НЕ становится всеведущим — в промпте указано использовать информацию осторожно (случайно узнал, подслушал, кто-то рассказал).</div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set="autoRpSummary" ${settings.autoRpSummary !== false ? 'checked' : ''}>
            <span>Авто-обновление RP-саммари</span>
        </label>
        <div class="im-set-hint">Автоматически обновляет саммари событий RP-чата каждые N сообщений. Контакты в телефоне будут знать что происходит без ручного нажатия кнопки. Если ты отредактировал саммари вручную — авто-обновление не перезапишет его.</div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set-deep="summaryApi.enabled" ${settings.summaryApi?.enabled ? 'checked' : ''}>
            <span>Отдельный API для саммари (экономия)</span>
        </label>
        <div class="im-set-hint">По умолчанию саммари генерятся тем же API что и ответы iMessage. Включи чтоб использовать отдельный (напр. дешёвую модель — Haiku, Flash, GPT-5 nano). Применяется ко всем саммари: переписок и RP-событий.</div>

        ${settings.summaryApi?.enabled ? `
        <label class="im-set-field">
            <span>Endpoint (OpenAI-совместимый)</span>
            <input type="text" class="im-set-input" data-im-set-deep="summaryApi.endpoint" value="${esc(settings.summaryApi?.endpoint || '')}" placeholder="https://api.example.com">
        </label>
        <label class="im-set-field">
            <span>API Key</span>
            <input type="password" class="im-set-input" data-im-set-deep="summaryApi.apiKey" value="${esc(settings.summaryApi?.apiKey || '')}">
        </label>
        <label class="im-set-field">
            <span>Model</span>
            <input type="text" class="im-set-input" data-im-set-deep="summaryApi.model" value="${esc(settings.summaryApi?.model || '')}" placeholder="claude-haiku-4-5 / gpt-5-nano / …">
        </label>
        ` : ''}

        <div class="im-set-row">
            <label class="im-set-field" style="flex:1">
                <span>саммари переписки каждые (сообщ.)</span>
                <input type="number" min="5" max="100" class="im-set-input" data-im-set="summaryRefreshEvery" value="${settings.summaryRefreshEvery || 15}">
            </label>
            <label class="im-set-field" style="flex:1">
                <span>саммари RP каждые (сообщ.)</span>
                <input type="number" min="5" max="100" class="im-set-input" data-im-set="rpSummaryRefreshEvery" value="${settings.rpSummaryRefreshEvery || 20}">
            </label>
        </div>
        <div class="im-set-row">
            <label class="im-set-field" style="flex:1">
                <span>дословно активный</span>
                <input type="number" min="3" max="50" class="im-set-input" data-im-set="injectActiveLastN" value="${settings.injectActiveLastN || 10}">
            </label>
            <label class="im-set-field" style="flex:1">
                <span>дословно другие</span>
                <input type="number" min="3" max="20" class="im-set-input" data-im-set="injectOthersLastN" value="${settings.injectOthersLastN || 5}">
            </label>
        </div>

        <label class="im-set-field row">
            <input type="checkbox" data-im-set="includePersonaDescription" ${settings.includePersonaDescription !== false ? 'checked' : ''}>
            <span>Передавать описание моей персоны контактам</span>
        </label>
        <button class="im-set-btn small" data-im-action="show-injection">Показать инжект</button>
        <button class="im-set-btn small" data-im-action="refresh-summaries">Обновить саммари сейчас</button>
        <button class="im-set-btn" data-im-action="view-rp-events">События RP (что контакты знают о жизни ${esc(settings.profile?.name || 'тебя')})</button>

        <h3 class="im-set-section">Опасная зона</h3>
        <button class="im-set-btn danger" data-im-action="reset-state">Сбросить всё в этом чате</button>
    </div>
    `, 'settings', 'im-body-fill');
}

function viewMe() {
    const settings = getSettings();
    const profile = settings.profile || {};
    let personaName = 'User', personaDesc = '', avatarUrl = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        personaName = c.name1 || 'User';
        if (typeof c.substituteParams === 'function') {
            const sub = c.substituteParams('{{persona}}');
            if (sub && sub !== '{{persona}}') personaDesc = sub;
        }
        const avatarFile = (typeof user_avatar === 'string' && user_avatar) ? user_avatar : null;
        if (avatarFile) avatarUrl = getThumbnailUrl('persona', avatarFile);
    } catch {}

    const avatarBlock = avatarUrl
        ? `<div class="im-me-avatar" style="background:#000 center/cover no-repeat url('${esc(avatarUrl)}')"></div>`
        : `<div class="im-me-avatar im-me-avatar-fallback">${esc((personaName || '?')[0])}</div>`;

    return wrap(`
    <div class="im-header im-header-chat">
        <button class="im-header-btn im-back" data-im-action="back-to-list">${ICONS.back}</button>
        <div class="im-chat-header-body" style="pointer-events:none">
            <div class="im-chat-header-name">Моя анкета</div>
        </div>
        <span class="im-header-btn" data-im-action="close-app" title="Закрыть iMessage">${ICONS.close}</span>
    </div>
    <div class="im-settings">
        <div class="im-me-top">
            ${avatarBlock}
            <div class="im-me-top-info">
                <div class="im-me-name">${esc(personaName)}</div>
                <div class="im-set-hint" style="margin:0">из активной персоны ST</div>
            </div>
        </div>

        <h3 class="im-set-section">Описание персоны</h3>
        <div class="im-set-hint">Редактирует описание активной персоны SillyTavern.</div>
        <textarea class="im-set-input" data-im-persona-desc rows="6">${esc(personaDesc || '')}</textarea>

        <h3 class="im-set-section">Анкета для контактов</h3>
        <label class="im-set-field">
            <span>Как подписано имя</span>
            <input type="text" class="im-set-input" data-im-set-deep="profile.name" value="${esc(profile.name || '')}" placeholder="оставь пустым = имя персоны">
        </label>
        <label class="im-set-field">
            <span>Дополнительно о себе</span>
            <textarea class="im-set-input" data-im-set-deep="profile.extraBio" rows="3">${esc(profile.extraBio || '')}</textarea>
        </label>
    </div>
    `, 'me', 'im-body-fill');
}

// ══════════════════════════════════════════════════════════
// СТИКЕРЫ — панель
// ══════════════════════════════════════════════════════════

let _activeStickerPack = null;

function buildStickerPanel(contactId) {
    const packs = getPackOrder();
    const activePack = _activeStickerPack || packs[0];

    const tabs = packs.map(p => {
        const data = STICKER_PACKS[p];
        const cls = p === activePack ? 'im-sticker-tab active' : 'im-sticker-tab';
        return `<button class="${cls}" data-im-action="switch-sticker-pack" data-im-pack="${p}">${data.label}</button>`;
    }).join('');

    const stickers = (STICKER_PACKS[activePack]?.stickers || []).map(s => {
        const url = stickerUrl(s.file);
        return `<div class="im-sticker-thumb" data-im-action="send-sticker" data-im-contact="${contactId}" data-im-sticker-file="${esc(s.file)}">
            <img src="${url}" alt="" loading="lazy">
        </div>`;
    }).join('');

    return `<div class="im-sticker-tabs">${tabs}</div><div class="im-sticker-grid">${stickers}</div>`;
}

function wrap(bodyHTML, activeView = 'list', bodyClass = '') {
    return `<div class="im-app-body ${bodyClass}">${bodyHTML}</div>`;
}

// ══════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════

export function render() {
    const root = document.getElementById('imessage-modal-body');
    if (!root) return;
    const s = loadState();
    let html;
    if (s.view === 'settings') html = viewSettings();
    else if (s.view === 'rp-events') html = viewRpEvents();
    else if (s.view === 'me') html = viewMe();
    else if (s.view === 'contact-info' && s.openContactId) html = viewContactInfo(s.openContactId);
    else if (s.view === 'chat' && s.openContactId) html = viewChat(s.openContactId);
    else html = viewList();
    root.innerHTML = html;

    requestAnimationFrame(() => {
        const body = document.getElementById('im-chat-body');
        if (body) body.scrollTop = body.scrollHeight;
    });
}

export function updateFabBadge() {
    const fab = document.getElementById('imessage-fab');
    if (!fab) return;
    const n = totalUnread();
    let badge = fab.querySelector('.im-fab-badge');
    if (n > 0) {
        if (!badge) { badge = document.createElement('div'); badge.className = 'im-fab-badge'; fab.appendChild(badge); }
        badge.textContent = n > 99 ? '99+' : String(n);
    } else if (badge) badge.remove();
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

async function resizeImage(dataUrl, maxSize = 800) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
                else { width = Math.round(width * maxSize / height); height = maxSize; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

function openImageZoom(src) {
    const old = document.getElementById('im-fs-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'im-fs-overlay';
    overlay.className = 'im-fs-fit';
    overlay.innerHTML = `
        <div class="im-fs-scroll">
            <img src="${src}" class="im-fs-image" alt="zoomed">
        </div>
        <button class="im-fs-close" type="button">✕</button>
    `;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const img = overlay.querySelector('.im-fs-image');
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.classList.toggle('im-fs-fit');
        overlay.classList.toggle('im-fs-zoom');
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('im-fs-scroll')) close();
    });
    const closeBtn = overlay.querySelector('.im-fs-close');
    closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); close(); });
    closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); close(); });

    (document.documentElement || document.body).appendChild(overlay);
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

// ══════════════════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════════════════

export async function handleAction(action, contactId, evt) {
    const s = loadState();

    if (action === 'zoom-image') {
        const el = evt?.target?.closest?.('[data-im-src]');
        const src = el?.getAttribute('data-im-src');
        if (src) openImageZoom(src);
        return;
    }

    if (action === 'close-app') {
        const modal = document.getElementById('imessage-modal');
        if (modal) modal.classList.remove('open');
        document.body.style.overflow = '';
        return;
    }

    // ── Стикеры ──
    if (action === 'toggle-stickers') {
        const panel = document.getElementById('im-sticker-panel');
        if (panel) {
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'flex';
            if (!isVisible) {
                // Обновить содержимое при открытии
                _activeStickerPack = _activeStickerPack || getPackOrder()[0];
                panel.innerHTML = buildStickerPanel(contactId || loadState().openContactId);
            }
        }
        return;
    }
    if (action === 'switch-sticker-pack') {
        const packName = evt?.target?.closest?.('[data-im-pack]')?.getAttribute('data-im-pack');
        if (packName && STICKER_PACKS[packName]) {
            _activeStickerPack = packName;
            const panel = document.getElementById('im-sticker-panel');
            if (panel) {
                const cId = contactId || loadState().openContactId;
                panel.innerHTML = buildStickerPanel(cId);
            }
        }
        return;
    }
    if (action === 'send-sticker') {
        const el = evt?.target?.closest?.('[data-im-sticker-file]');
        const stickerFile = el?.getAttribute('data-im-sticker-file');
        const cId = contactId || loadState().openContactId;
        if (!stickerFile || !cId) return;
        // Закрыть панель
        const panel = document.getElementById('im-sticker-panel');
        if (panel) panel.style.display = 'none';
        // Отправить стикер
        pushMessage(cId, { from: 'user', sticker: stickerFile, text: '' });
        render();
        // Генерируем ответ контакта
        s.__typing = cId; save();
        render();
        try { await generateContactReply(cId); }
        catch (e) { console.error(e); }
        s.__typing = null; save();
        render();
        return;
    }

    if (action === 'open-chat') {
        if (!contactId) return;
        markRead(contactId);
        s.view = 'chat'; s.openContactId = contactId; save();
        render(); updateFabBadge(); syncToMainChat();
    }
    else if (action === 'back-to-list') {
        s.view = 'list'; s.openContactId = null; save();
        render();
    }
    else if (action === 'back-to-chat') {
        if (s.openContactId) { s.view = 'chat'; save(); render(); }
        else { s.view = 'list'; save(); render(); }
    }
    else if (action === 'view-settings') { s.view = 'settings'; save(); render(); }
    else if (action === 'view-me') { s.view = 'me'; save(); render(); }
    else if (action === 'view-contact-info') {
        if (!contactId) return;
        s.view = 'contact-info'; s.openContactId = contactId; save(); render();
    }
    else if (action === 'regen-image') {
        if (!contactId) return;
        const el = evt?.target?.closest?.('[data-im-msgts]');
        const ts = el?.getAttribute('data-im-msgts');
        if (!ts) return;
        try { await regenerateChatImage(contactId, ts); }
        catch (e) { console.error(e); }
    }
    else if (action === 'send-msg') {
        if (evt?.preventDefault) evt.preventDefault();
        if (!contactId) return;
        const form = evt?.target?.closest?.('form');
        const input = form?.querySelector('.im-chat-field');
        const text = input?.value?.trim();
        if (!text) return;
        input.value = '';
        pushMessage(contactId, { from: 'user', text });
        s.__typing = contactId; save();
        render();
        try { await generateContactReply(contactId); }
        catch (e) { console.error(e); }
        s.__typing = null; save();
        render();
    }
    else if (action === 'close-app') {
        const modal = document.getElementById('imessage-modal');
        if (modal) modal.classList.remove('open');
    }
    else if (action === 'reload-roster') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }
        try {
            const n = await reloadRoster();
            alert(`Загружено контактов: ${n}`);
        } catch (e) { alert('Ошибка: ' + e.message); }
        render();
    }
    else if (action === 'fetch-llm-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const settings = getSettings();
            const models = await fetchModels(settings.extraApi.endpoint, settings.extraApi.apiKey);
            window.__imLlmModels = models;
            render();
        } catch (e) { alert('Не удалось: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; } }
    }
    else if (action === 'fetch-img-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const settings = getSettings();
            const models = await fetchModels(settings.imageApi.endpoint, settings.imageApi.apiKey);
            window.__imImgModels = models;
            render();
        } catch (e) { alert('Не удалось: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; } }
    }
    else if (action === 'refresh-contact-summary') {
        if (!contactId) return;
        const btn = evt?.target?.closest?.('button');
        const orig = btn?.querySelector('span')?.textContent || '';
        if (btn) { btn.disabled = true; if (btn.querySelector('span')) btn.querySelector('span').textContent = 'Генерирую…'; }
        try {
            const summary = await forceRefreshContactSummary(contactId);
            render();
            alert('Саммари обновлено!');
        } catch (e) {
            alert('Не удалось: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; if (btn.querySelector('span')) btn.querySelector('span').textContent = orig; }
        }
    }
    else if (action === 'gen-avatar') {
        if (!contactId) return;
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; }
        try {
            const url = await generateAvatar(contactId);
            setCustomAvatar(contactId, url);
            saveSettings();
            render();
        } catch (e) { alert('Не удалось: ' + e.message); if (btn) btn.disabled = false; }
    }
    else if (action === 'regen-card') {
        if (!contactId) return;
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; }
        try { await regenerateContactMeta(contactId); render(); }
        catch (e) { alert('Ошибка: ' + e.message); if (btn) btn.disabled = false; }
    }
    else if (action === 'clear-avatar') {
        if (!contactId) return;
        clearCustomAvatar(contactId); saveSettings(); render();
    }
    else if (action === 'clear-chat') {
        if (!contactId) return;
        const ROSTER = getRoster();
        if (!confirm(`Очистить всю переписку с ${ROSTER[contactId]?.name}?`)) return;
        if (s.messages?.[contactId]) s.messages[contactId] = [];
        if (s.unread?.[contactId]) s.unread[contactId] = 0;
        save();
        s.view = 'chat'; save();
        render(); updateFabBadge(); syncToMainChat();
    }
    else if (action === 'hide-contact') {
        if (!contactId) return;
        const ROSTER = getRoster();
        const name = ROSTER[contactId]?.name || contactId;
        if (!confirm(`Скрыть ${name}? Запись лорбука останется, но контакт исчезнет. Переписка будет удалена.`)) return;
        hideContact(contactId);
        delete s.messages?.[contactId];
        delete s.unread?.[contactId];
        if (s.openContactId === contactId) { s.openContactId = null; s.view = 'list'; }
        save();
        saveSettings();
        updateFabBadge(); render(); syncToMainChat();
    }
    else if (action === 'show-injection') {
        const data = debugInjection();
        alert('Что идёт в чат ST:\n\n' + (data.currentText || '(пусто)'));
    }
    else if (action === 'refresh-summaries') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = 'Обновляю…'; }
        try {
            refreshAllSummaries();
            setTimeout(() => {
                if (btn) { btn.disabled = false; btn.textContent = 'Обновить саммари сейчас'; }
                alert('Запрошено обновление саммари всех активных переписок. Процесс идёт в фоне, проверь консоль F12 чтобы увидеть прогресс.');
            }, 500);
        } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Обновить саммари сейчас'; } alert('Ошибка: ' + e.message); }
    }
    else if (action === 'view-rp-events') {
        const st = loadState();
        st.view = 'rp-events';
        save();
        render();
    }
    else if (action === 'back-to-settings') {
        const st = loadState();
        st.view = 'settings';
        save();
        render();
    }
    else if (action === 'gen-rp-summary') {
        const btn = evt?.target?.closest?.('button');
        const orig = btn?.textContent || '';
        if (btn) { btn.disabled = true; btn.textContent = '🧠 Генерирую…'; }
        try {
            const summary = await generateRpSummary();
            // Обновляем textarea если она на экране
            const ta = document.getElementById('im-rp-summary-text');
            if (ta) ta.value = summary;
            render();
            alert('Саммари сгенерировано и сохранено.');
        } catch (e) {
            console.error('[iMessage] gen RP summary failed:', e);
            alert('Не удалось сгенерировать: ' + (e.message || e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
    }
    else if (action === 'save-rp-summary') {
        const ta = document.getElementById('im-rp-summary-text');
        if (!ta) return;
        const text = ta.value.trim();
        if (!text) { alert('Текст пуст. Сначала напиши или сгенерируй саммари.'); return; }
        saveManualRpSummary(text);
        render();
        alert('Сохранено. Теперь это увидят все контакты при ответах в iMessage.');
    }
    else if (action === 'clear-rp-summary') {
        if (!confirm('Удалить текущее саммари событий RP?')) return;
        clearRpSummary();
        render();
    }
    else if (action === 'reset-state') {
        if (!confirm('Сбросить все переписки в этом чате?')) return;
        resetState(); syncToMainChat(); render(); updateFabBadge();
    }
}

export async function handleFileInput(input) {
    const s = loadState();
    if (input.dataset.imImageInput) {
        const contactId = input.dataset.imImageInput;
        const file = input.files?.[0]; if (!file) return;
        const dataUrl = await fileToDataURL(file);
        const small = await resizeImage(dataUrl);
        const ts = Date.now();
        pushMessage(contactId, { from: 'user', image: small, text: '', ts });
        s.__typing = contactId; save();
        render();
        captionUserImage(contactId, ts, small).catch(() => {});
        try { await generateContactReply(contactId); } catch (e) { console.error(e); }
        s.__typing = null; save();
        render();
    }
    else if (input.dataset.imAvatarUpload) {
        const contactId = input.dataset.imAvatarUpload;
        const file = input.files?.[0]; if (!file) return;
        const dataUrl = await fileToDataURL(file);
        const small = await resizeImage(dataUrl, 1024);
        setCustomAvatar(contactId, small); saveSettings(); render();
    }
}

export function handleSettingChange(input) {
    const settings = getSettings();
    if (input.dataset.imSet) {
        const k = input.dataset.imSet;
        if (input.type === 'checkbox') settings[k] = input.checked;
        else if (input.type === 'number') settings[k] = Number(input.value) || 0;
        else settings[k] = input.value;
        saveSettings();
        if (k === 'injectIntoMain' || k === 'injectPhoneSummary') syncToMainChat();
        if (k === 'rosterSource') render();
    } else if (input.dataset.imSetDeep) {
        const path = input.dataset.imSetDeep;
        const val = input.type === 'checkbox' ? input.checked
                  : input.type === 'number' ? (Number(input.value) || 0)
                  : input.value;
        setDeep(settings, path, val);
        saveSettings();
        // При переключении чекбокса «другой API для саммари» — рендерим чтобы
        // показать/скрыть поля endpoint/key/model
        if (path === 'summaryApi.enabled') render();
    }
}
