// ═══════════════════════════════════════════
// STATE — per-chat через chat_metadata + глобальные настройки
// ═══════════════════════════════════════════

import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../script.js';

export const EXT_NAME = 'imessage-ext';
const META_KEY = 'imessage';

// ── Глобальные настройки расширения ──
const defaultSettings = () => ({
    // Источник контактов
    rosterSource: 'chat-lorebook',  // 'chat-lorebook' | 'named-lorebook'
    lorebookName: '',

    // Extra LLM API (независимый, ВСЕ запросы iMessage идут сюда)
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
        apiType: 'openai',
    },
    useSillyImagesConfig: true,

    imagePromptPrefix: '',
    imagePromptSuffix: '',
    imageNegativePrompt: '',

    // Синк с основным чатом ST
    injectIntoMain: true,
    injectDepth: 4,

    // Сколько последних сообщений показывать дословно в инжекте
    injectActiveLastN: 10,      // для активного (того с кем RP сейчас)
    injectOthersLastN: 5,       // для остальных переписок

    // LLM-классификатор парсинга RP-чата (точнее regex, но жрёт токены)
    useLLMParser: true,

    // LLM-саммари длинных переписок (обновляется раз в N сообщений)
    useLLMSummaries: true,
    summaryRefreshEvery: 15,    // каждые столько новых сообщений перегенерировать саммари переписки

    // Авто-саммари RP-чата (события реальной жизни → контакты знают)
    autoRpSummary: true,
    rpSummaryRefreshEvery: 20,  // каждые столько новых RP-сообщений перегенерировать

    // Инжектить сводку переписок телефона в RP-чат (чтобы RP-бот знал контекст)
    injectPhoneSummary: true,

    // Отдельный API для саммари (опционально — экономия если основной дорогой).
    // Если enabled=false — используется extraApi (как раньше).
    summaryApi: {
        enabled: false,
        endpoint: '',
        apiKey: '',
        model: '',
    },

    // Передавать описание персоны парням
    includePersonaDescription: true,

    // Язык сообщений в iMessage — чтобы не скатывалось в английский из-за
    // лорбуков на английском. 'russian' | 'english' | 'japanese' | ...
    messageLanguage: 'russian',

    // Использовать аватарку как референс при генерации фото в чате
    useAvatarAsRef: true,

    // Автоматические сообщения от бота (пишет сам через время)
    autoMessages: true,
    autoMinMinutes: 5,      // мин через сколько минут может написать сам
    autoMaxMinutes: 180,    // макс через сколько
    autoProbability: 0.4,   // вероятность что вообще напишет (0..1)

    avatars: {},            // {contactId: dataURL}
    fabPosition: { right: 20, top: null },

    hiddenContacts: [],
    contactMetaCache: {},

    // Моя анкета
    profile: {
        name: '',
        extraBio: '',
    },
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
    messages: {},          // { contactId: [ {ts, from, text, image, deleted, _imgPrompt, _imgCaption, _generating, _genId} ] }
    openContactId: null,   // открытый чат
    view: 'list',          // 'list' | 'chat' | 'contact-info' | 'settings' | 'me'
    unread: {},            // { contactId: count }
    contactMeta: {},       // legacy per-chat cache
    lastSyncedMainMsgIdx: -1,  // индекс последнего прочитанного сообщения из основного чата ST (для синхронизации)
    autoSchedule: {},      // { contactId: { nextAt: ts, lastChecked: ts } } — расписание автосообщений
    summaries: {},         // { contactId: { text: string, msgCountAtGen: number, ts: number } } — LLM-саммари переписки
    rpSummary: {           // Саммари событий основного RP-чата — ОДНО на весь чат, видят все контакты
        text: '',          // текст саммари (можно редактировать вручную)
        msgCountAtGen: 0,  // на каком индексе RP-сообщения было сгенерировано
        ts: 0,             // timestamp генерации
        manualEdit: false, // был ли текст отредактирован вручную (тогда auto-regen не перезаписывает)
    },
});

export function loadState() {
    if (!chat_metadata[META_KEY]) {
        chat_metadata[META_KEY] = defaultChatState();
    } else {
        const def = defaultChatState();
        for (const k in def) if (chat_metadata[META_KEY][k] === undefined) chat_metadata[META_KEY][k] = def[k];
    }
    return chat_metadata[META_KEY];
}

export const save = () => saveMetadataDebounced();

export function pushMessage(contactId, msg) {
    const s = loadState();
    if (!s.messages[contactId]) s.messages[contactId] = [];
    const full = { ts: Date.now(), ...msg };
    s.messages[contactId].push(full);
    save();
    return full;
}

export function markRead(contactId) {
    const s = loadState();
    if (s.unread?.[contactId]) {
        s.unread[contactId] = 0;
        save();
    }
}

export function bumpUnread(contactId) {
    const s = loadState();
    if (!s.unread) s.unread = {};
    s.unread[contactId] = (s.unread[contactId] || 0) + 1;
    save();
}

export function resetState() {
    chat_metadata[META_KEY] = defaultChatState();
    save();
}

export function setContactMeta(contactId, meta) {
    const s = loadState();
    if (!s.contactMeta) s.contactMeta = {};
    s.contactMeta[contactId] = { ...(s.contactMeta[contactId] || {}), ...meta };
    save();
}

export function getContactMeta(contactId) {
    const s = loadState();
    return s.contactMeta?.[contactId] || null;
}

// ── Глобальный кэш распарсенных карточек ──
function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h.toString(36);
}

export function getCachedContactMeta(lorebookName, contactId, rawDescription) {
    const settings = getSettings();
    if (!settings.contactMetaCache) settings.contactMetaCache = {};
    const key = `${lorebookName || '_'}::${contactId}`;
    const entry = settings.contactMetaCache[key];
    if (!entry) return null;
    const expectedHash = hashStr(String(rawDescription || ''));
    if (entry._hash !== expectedHash) return null;
    return entry;
}

export function setCachedContactMeta(lorebookName, contactId, rawDescription, meta) {
    const settings = getSettings();
    if (!settings.contactMetaCache) settings.contactMetaCache = {};
    const key = `${lorebookName || '_'}::${contactId}`;
    settings.contactMetaCache[key] = { ...meta, _hash: hashStr(String(rawDescription || '')) };
    saveSettingsDebounced();
}
