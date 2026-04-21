// ═══════════════════════════════════════════
// STATE — per-chat через chat_metadata + глобальные настройки
// ═══════════════════════════════════════════

import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../script.js';

export const EXT_NAME = 'imessage-ext';
const META_KEY = 'imessage';

// ── Глобальные настройки расширения ──
const defaultSettings = () => ({
    // Extra LLM API — все запросы идут сюда
    extraApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        temperature: 0.9,
        maxTokens: 800,
    },

    // Image API
    imageApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        size: '1024x1024',
        apiType: 'openai',  // 'openai' | 'gemini'
    },
    useSillyImagesConfig: true,

    // Промпты для картинок
    imagePromptPrefix: '',
    imagePromptSuffix: '',
    imageNegativePrompt: '',
    useAvatarAsRef: true,

    // Синк с основным чатом
    injectIntoMain: true,
    injectDepth: 4,

    // Передавать описание персоны боту
    includePersonaDescription: true,

    // Авто-сообщения бота — сам пишет спустя время
    autoReply: {
        enabled: false,
        minMinutes: 15,   // минимум минут до авто-сообщения
        maxMinutes: 120,  // максимум
    },

    // Разрешить персонажу отправлять фото [IMG:...] в переписке
    allowCharImages: true,

    // Аватар персонажа (глобальный, не per-chat)
    charAvatar: null,   // dataURL

    fabPosition: { right: 20, top: null },
});

export function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = defaultSettings();
    } else {
        const def = defaultSettings();
        for (const k in def) {
            if (extension_settings[EXT_NAME][k] === undefined) {
                extension_settings[EXT_NAME][k] = def[k];
            } else if (typeof def[k] === 'object' && def[k] && !Array.isArray(def[k])) {
                for (const k2 in def[k]) {
                    if (extension_settings[EXT_NAME][k][k2] === undefined) {
                        extension_settings[EXT_NAME][k][k2] = def[k][k2];
                    }
                }
            }
        }
    }
    return extension_settings[EXT_NAME];
}

export const saveSettings = () => saveSettingsDebounced();

// ── Per-chat состояние ──
const defaultChatState = () => ({
    messages: [],        // [{ts, from, text, image, deleted, _imgPrompt, _genId, _generating, _fromMain}]
    charName: '',        // имя персонажа (name2 из ST)
    userName: '',        // имя пользователя (name1)
    view: 'chat',
    // Авто-таймер: когда следующее авто-сообщение
    nextAutoTs: null,
});

export function loadState() {
    if (!chat_metadata[META_KEY]) {
        chat_metadata[META_KEY] = defaultChatState();
    } else {
        const def = defaultChatState();
        for (const k in def) {
            if (chat_metadata[META_KEY][k] === undefined) {
                chat_metadata[META_KEY][k] = def[k];
            }
        }
    }
    return chat_metadata[META_KEY];
}

export const save = () => saveMetadataDebounced();

export function pushMessage(msg) {
    const s = loadState();
    if (!Array.isArray(s.messages)) s.messages = [];
    const full = { ts: Date.now(), ...msg };
    s.messages.push(full);
    save();
    return full;
}

export function updateMessage(tsOrGenId, patch) {
    const s = loadState();
    // Ищем сначала по _genId (для async-генерированных картинок), потом по ts
    const msg = (s.messages || []).find(m => m && (m._genId === tsOrGenId || m.ts === Number(tsOrGenId)));
    if (!msg) return;
    Object.assign(msg, patch);
    save();
}

export function deleteMessage(ts) {
    const s = loadState();
    const msg = (s.messages || []).find(m => m && m.ts === Number(ts));
    if (!msg) return;
    msg.deleted = true;
    save();
}

export function resetState() {
    chat_metadata[META_KEY] = defaultChatState();
    save();
}

// Счётчик непрочитанных от бота
export function getUnreadCount() {
    const s = loadState();
    const msgs = s.messages || [];
    // Считаем сообщения от персонажа после последнего сообщения юзера
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].from === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return msgs.filter(m => m.from === 'char' && !m.deleted).length;
    return msgs.slice(lastUserIdx + 1).filter(m => m.from === 'char' && !m.deleted).length;
}
