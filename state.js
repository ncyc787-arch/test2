// state.js — хранилище переписок и настроек
// chat_metadata = per-chat (переписки, динамические контакты)
// extension_settings = глобальные (API, аватары, мост, отображение)

import { extension_settings } from '../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../script.js';

export const EXT_NAME = 'PhoneMSG';
const MODULE = 'PhoneMSG';

const DEFAULT_SETTINGS = {
    lorebookSource: 'chat',
    lorebookName: '',
    displayMode: 'floating',
    fabPosition: { right: 20, top: null },
    autoMessagesEnabled: true,
    autoMessageSilenceMin: 30,
    autoMessageCooldownMin: 60,
    useMainApi: true,
    extraApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        temperature: 0.9,
        maxTokens: 800,
    },
    imageApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        size: '1024x1024',
        apiType: 'openai',
    },
    useSillyImagesConfig: true,
    imagePromptPrefix: 'photorealistic portrait, natural lighting, sharp focus',
    imagePromptSuffix: '',
    imageNegativePrompt: 'cartoon, anime, deformed, blurry, low quality, watermark',
    avatars: {},
    bridgeEnabled: true,
    bridgeIncomingTag: 'телефон',
    bridgeContactTag: 'контакт',
    bridgeReplaceNote: '✉️ сообщение в телефоне',
};

export function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    const s = extension_settings[EXT_NAME];
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k]));
    }
    if (!s.extraApi) s.extraApi = { ...DEFAULT_SETTINGS.extraApi };
    if (!s.imageApi) s.imageApi = { ...DEFAULT_SETTINGS.imageApi };
    if (!s.avatars) s.avatars = {};
    return s;
}

export function saveSettings() {
    try { saveSettingsDebounced(); } catch (e) { console.warn('[PhoneMSG] saveSettings:', e); }
}

function ctx() {
    try { return typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null; }
    catch { return null; }
}

export function getState() {
    const c = ctx();
    const meta = c?.chatMetadata || chat_metadata;
    if (!meta[MODULE]) {
        meta[MODULE] = {
            conversations: {},
            npcMeta: {},
            dynamicContacts: {},
        };
    }
    if (!meta[MODULE].dynamicContacts) meta[MODULE].dynamicContacts = {};
    if (!meta[MODULE].npcMeta) meta[MODULE].npcMeta = {};
    if (!meta[MODULE].conversations) meta[MODULE].conversations = {};
    return meta[MODULE];
}

export function saveState() {
    const c = ctx();
    if (c?.saveMetadata) c.saveMetadata();
}

function stripPhoneServiceTags(text) {
    if (!text) return '';
    return String(text)
        .replace(/<horae>\s*<\/horae>/gi, '')
        .replace(/<horaeevent>\s*<\/horaeevent>/gi, '')
        .replace(/<horae>[\s\S]*?<\/horae>/gi, '')
        .replace(/<horaeevent>[\s\S]*?<\/horaeevent>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function addMessage(npcId, sender, text, extra = {}) {
    const state = getState();
    if (!state.conversations[npcId]) state.conversations[npcId] = [];
    const now = Date.now();

    const type = extra.type || 'text';
    const cleanText = stripPhoneServiceTags(text);

    const msg = {
        sender,
        text: cleanText,
        ts: now,
        time: new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        type,
        imageUrl: extra.imageUrl || null,
        caption: stripPhoneServiceTags(extra.caption || ''),
        injectText: stripPhoneServiceTags(extra.injectText || ''),
    };

    state.conversations[npcId].push(msg);
    saveState();
    return msg;
}

export function getConversation(npcId) {
    return getState().conversations[npcId] || [];
}

let CONTACTS = [];

export function setContacts(contacts) {
    CONTACTS = Array.isArray(contacts) ? contacts : [];
}

export function getContacts() {
    return CONTACTS;
}

export function addDynamicContact(contact) {
    const state = getState();
    if (!state.dynamicContacts) state.dynamicContacts = {};
    state.dynamicContacts[contact.id] = contact;
    saveState();
}

export function getDynamicContacts() {
    const state = getState();
    return Object.values(state.dynamicContacts || {});
}

export function getNpcMeta(npcId) {
    const state = getState();
    if (!state.npcMeta) state.npcMeta = {};
    if (!state.npcMeta[npcId]) state.npcMeta[npcId] = { affection: 50, lastSeen: null, cooldown: null };
    return state.npcMeta[npcId];
}

export function updateNpcMeta(npcId, patch) {
    const meta = getNpcMeta(npcId);
    Object.assign(meta, patch);
    saveState();
}

export function getCustomAvatar(contactId) {
    return getSettings().avatars?.[contactId] || null;
}

export function setCustomAvatar(contactId, dataUrl) {
    const s = getSettings();
    if (!s.avatars) s.avatars = {};
    s.avatars[contactId] = dataUrl;
    saveSettings();
}

export function clearCustomAvatar(contactId) {
    const s = getSettings();
    if (s.avatars) delete s.avatars[contactId];
    saveSettings();
}
