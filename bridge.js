// bridge.js — двунаправленный мост между телефоном и основным чатом
//
// ЧТО ОН ДЕЛАЕТ:
//
// 1) ПОЛНЫЙ ИНЖЕКТ ВСЕЙ ПЕРЕПИСКИ через setExtensionPrompt:
//    Формат: [📱 Юзер → Аякс]: ... / [📱 Аякс → Юзер]: ...
//    LLM видит полную картину всех смс (твоих И ответов НПС).
//    Обновляется после КАЖДОГО сообщения (и твоего, и НПС).
//    В UI чата НЕ ВИДНО — это просто system prompt для модели.
//
// 2) МАРКЕРЫ ОТПРАВКИ в c.chat[] (скрытые через CSS):
//    При отправке юзером → добавляется system msg с extra.phonemsg_marker
//    Это важно чтобы бот понимал "вот прямо сейчас юзер нажал send".
//    Скрываются через CSS-класс .phonemsg-hidden.
//
// 3) ПАРСИНГ ВХОДЯЩИХ тегов [телефон:Имя] и [контакт:Имя:ID]:
//    Сохраняет сообщение в переписку, заменяет тег на заметку в видимом тексте.

import {
    getSettings, addMessage, addDynamicContact, getDynamicContacts,
    getContacts, getNpcMeta, updateNpcMeta, getConversation
} from './state.js';

const LOG = '[PhoneMSG-Bridge]';
const INJECT_KEY = 'PhoneMSG_conversations';
const INJECT_DEPTH = 1;

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null);

// ═══════════════════════════════════════════════
// 1. ИНЖЕКТ ВСЕЙ ПЕРЕПИСКИ (для LLM, не видно в чате)
// ═══════════════════════════════════════════════

/**
 * Собирает полную историю всех переписок телефона и кладёт в extensionPrompt.
 * Вызывается ПОСЛЕ каждого сообщения (и юзера, и НПС) и при загрузке чата.
 */
export function rebuildConversationsInject() {
    const s = getSettings();
    const c = ctx();
    if (!c) return;

    if (!s.bridgeEnabled) {
        c.setExtensionPrompt(INJECT_KEY, '', 1, INJECT_DEPTH, false);
        return;
    }

    const userName = c.name1 || 'User';
    const allContacts = [...getContacts(), ...getDynamicContacts()];
    if (!allContacts.length) {
        c.setExtensionPrompt(INJECT_KEY, '', 1, INJECT_DEPTH, false);
        return;
    }

    const lines = [];
    let hasAnyMessages = false;

    for (const contact of allContacts) {
        const conv = getConversation(contact.id);
        if (!conv.length) continue;
        hasAnyMessages = true;

        for (const m of conv.slice(-25)) {
            // Определяем направление:
            //   - от юзера → контакту
            //   - от контакта (НПС) → юзеру
            const isFromUser = m.sender === userName;
            const fromLabel = isFromUser ? userName : contact.name;
            const toLabel = isFromUser ? contact.name : userName;
            const timeStr = m.time || '';
            lines.push(`[📱 ${fromLabel} → ${toLabel} в смс${timeStr ? ', ' + timeStr : ''}]: ${m.text}`);
        }
        lines.push(''); // разделитель между контактами
    }

    if (!hasAnyMessages) {
        c.setExtensionPrompt(INJECT_KEY, '', 1, INJECT_DEPTH, false);
        return;
    }

    const text = [
        '[PHONEMSG — ПАРАЛЛЕЛЬНАЯ ПЕРЕПИСКА В ТЕЛЕФОНЕ]',
        `${userName} параллельно с основным чатом переписывается в телефоне с НПС.`,
        `Эти НПС — реальные персонажи из лорбука/чата. Ниже ВСЯ переписка:`,
        '',
        ...lines,
        '[END PHONEMSG]',
    ].join('\n');

    c.setExtensionPrompt(INJECT_KEY, text, 1, INJECT_DEPTH, false);
    console.log(LOG, `инжект обновлён: ${lines.filter(l => l).length} строк`);
}

// ═══════════════════════════════════════════════
// 2. МАРКЕР ОТПРАВКИ (скрытый system msg в c.chat[])
// ═══════════════════════════════════════════════

/**
 * Добавляет невидимое system-сообщение в c.chat[] при отправке смс юзером.
 * Бот получает свежий сигнал "юзер прямо сейчас отправил смс".
 * В UI не видно благодаря CSS-классу .phonemsg-hidden.
 */
export async function pushOutgoingSystemMarker(contact, text) {
    const s = getSettings();
    if (!s.bridgeEnabled) return;

    const c = ctx();
    if (!c) return;

    const userName = c.name1 || 'User';
    const markerText = `[📱 ${userName} отправил(а) ${contact.name} в смс]: ${text}`;

    try {
        const msg = {
            name: 'PhoneMSG',
            is_user: false,
            is_system: true,
            send_date: new Date().toISOString(),
            mes: markerText,
            extra: {
                isSmallSys: true,
                phonemsg_marker: 'outgoing',
            },
        };

        if (typeof c.addOneMessage === 'function') {
            c.chat.push(msg);
            c.addOneMessage(msg, { scroll: false });
        } else {
            c.chat.push(msg);
        }

        hideMarkersInDOM();

        if (typeof c.saveChatConditional === 'function') {
            await c.saveChatConditional();
        } else if (typeof c.saveChat === 'function') {
            await c.saveChat();
        }

        console.log(LOG, `маркер отправки → ${contact.name}:`, text.slice(0, 50));
    } catch (e) {
        console.error(LOG, 'pushOutgoingSystemMarker failed:', e);
    }
}

// ═══════════════════════════════════════════════
// 3. ПАРСИНГ ВХОДЯЩИХ ТЕГОВ
// ═══════════════════════════════════════════════

export function parseBotMessage(originalText) {
    const s = getSettings();
    if (!s.bridgeEnabled || !originalText) {
        return { modified: false, newText: originalText, phoneMessages: [], newContacts: [] };
    }

    const phoneTag = escapeRegex(s.bridgeIncomingTag || 'телефон');
    const contactTag = escapeRegex(s.bridgeContactTag || 'контакт');
    const replaceNote = s.bridgeReplaceNote || '✉️ сообщение в телефоне';

    const phoneMessages = [];
    const newContacts = [];
    let newText = originalText;

    // Паттерн: [контакт:Имя:ID] или [контакт:Имя]
    const contactRe = new RegExp(`\\[${contactTag}:([^:\\]]+?)(?::([^\\]]+?))?\\]`, 'gi');
    newText = newText.replace(contactRe, (match, name, id) => {
        const cleanName = (name || '').trim();
        if (!cleanName) return '';
        const cleanId = (id || '').trim() || makeIdFromName(cleanName);
        newContacts.push({ id: cleanId, name: cleanName });
        return '';
    });

    // Паттерн: [телефон:Имя] текст до следующего тега или конца
    const phoneRe = new RegExp(
        `\\[${phoneTag}:\\s*([^\\]]+?)\\]\\s*([\\s\\S]*?)(?=\\n\\s*\\[${phoneTag}:|\\n\\s*\\[${contactTag}:|$)`,
        'gi'
    );

    newText = newText.replace(phoneRe, (match, name, text) => {
        const cleanName = (name || '').trim();
        const cleanText = (text || '').trim();
        if (!cleanName || !cleanText) return '';

        const contact = findContactByName(cleanName);
        const contactId = contact?.id || makeIdFromName(cleanName);

        phoneMessages.push({ contactId, contactName: cleanName, text: cleanText });
        return `*${replaceNote}: ${cleanName}*`;
    });

    newText = newText.replace(/\n{3,}/g, '\n\n').trim();
    const modified = newText !== originalText;
    return { modified, newText, phoneMessages, newContacts };
}

export async function processBotMessage(messageIndex) {
    const c = ctx();
    if (!c || !c.chat || messageIndex == null) return false;

    const msg = c.chat[messageIndex];
    if (!msg || msg.is_user || msg.is_system) return false;
    if (!msg.mes) return false;
    if (msg.extra?.phonemsg_processed) return false;

    const parsed = parseBotMessage(msg.mes);
    if (!parsed.modified) return false;

    for (const nc of parsed.newContacts) {
        addDynamicContact({
            id: nc.id,
            name: nc.name,
            description: `Контакт, упомянутый в основном чате.`,
            avatar: null,
            color: randomColor(nc.name),
            source: 'chat',
        });
        console.log(LOG, `новый контакт из чата: ${nc.name} (${nc.id})`);
    }

    for (const pm of parsed.phoneMessages) {
        addMessage(pm.contactId, pm.contactName, pm.text);
        updateNpcMeta(pm.contactId, { lastSeen: Date.now() });
        console.log(LOG, `входящее смс от ${pm.contactName}:`, pm.text.slice(0, 50));
    }

    msg.mes = parsed.newText;
    if (!msg.extra) msg.extra = {};
    msg.extra.phonemsg_processed = true;

    try {
        if (typeof c.updateMessageBlock === 'function') {
            c.updateMessageBlock(messageIndex, msg);
        } else {
            const mesBlock = document.querySelector(`.mes[mesid="${messageIndex}"] .mes_text`);
            if (mesBlock) {
                mesBlock.innerHTML = c.messageFormatting
                    ? c.messageFormatting(msg.mes, msg.name, false, false, messageIndex)
                    : msg.mes;
            }
        }
    } catch (e) {
        console.warn(LOG, 'updateMessageBlock failed:', e);
    }

    try {
        if (typeof c.saveChatConditional === 'function') await c.saveChatConditional();
    } catch { /* ignore */ }

    return parsed.phoneMessages.length > 0 || parsed.newContacts.length > 0;
}

export async function processExistingChat() {
    const c = ctx();
    if (!c || !c.chat) return;

    for (let i = 0; i < c.chat.length; i++) {
        const msg = c.chat[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        if (msg.extra?.phonemsg_processed) continue;
        await processBotMessage(i);
    }
    hideMarkersInDOM();
}

// ═══════════════════════════════════════════════
// 4. СКРЫТИЕ МАРКЕРОВ В DOM
// ═══════════════════════════════════════════════

export function hideMarkersInDOM() {
    const c = ctx();
    if (!c || !c.chat) return;

    c.chat.forEach((msg, idx) => {
        if (msg?.extra?.phonemsg_marker === 'outgoing') {
            const el = document.querySelector(`.mes[mesid="${idx}"]`);
            if (el && !el.classList.contains('phonemsg-hidden')) {
                el.classList.add('phonemsg-hidden');
            }
        }
    });
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════
function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeIdFromName(name) {
    const base = String(name).toLowerCase()
        .replace(/[^a-zа-я0-9]/gi, '')
        .slice(0, 16);
    return `dyn_${base || Math.random().toString(36).slice(2, 8)}`;
}

function findContactByName(name) {
    const lname = name.toLowerCase().trim();
    const all = [...getContacts(), ...getDynamicContacts()];
    return all.find(c => c.name?.toLowerCase().trim() === lname);
}

function randomColor(seed) {
    const colors = ['#007AFF', '#FF3B30', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#FF2D55', '#5AC8FA'];
    let h = 0;
    for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return colors[h % colors.length];
}
