// engine.js — генерация ответов НПС, загрузка лорбука, автосообщения

import { chat_metadata } from '../../../../script.js';
import {
    addMessage, getConversation, getContacts, getNpcMeta, updateNpcMeta,
    getSettings, getDynamicContacts
} from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImage, isImageApiConfigured } from './api.js';

const LOG = '[PhoneMSG-Engine]';
const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null);

// ═══════════════════════════════════════════════
// АВТООПРЕДЕЛЕНИЕ ЛОРБУКА
// ═══════════════════════════════════════════════
export function getActiveLorebookName() {
    const s = getSettings();
    if (s.lorebookSource === 'named' && s.lorebookName) return s.lorebookName;

    // 1) привязанный к чату
    const chatLb = chat_metadata?.['world_info'];
    if (chatLb) return chatLb;

    // 2) primary из карточки персонажа
    try {
        const c = ctx();
        const charId = c?.characterId;
        const chars = c?.characters;
        if (chars && charId != null) {
            const charLb = chars[charId]?.data?.extensions?.world;
            if (charLb) return charLb;
        }
    } catch { /* ignore */ }

    if (s.lorebookName) return s.lorebookName;
    return null;
}

async function loadWorldInfoSafe(name) {
    if (!name) return null;
    try {
        const wi = await import('../../../world-info.js');
        return await wi.loadWorldInfo(name);
    } catch (e) {
        console.error(LOG, 'loadWorldInfo failed:', e);
        return null;
    }
}

// ═══════════════════════════════════════════════
// ЗАГРУЗКА КОНТАКТОВ (лорбук + динамические из чата)
// ═══════════════════════════════════════════════
export async function loadAllContacts() {
    const lbContacts = await loadContactsFromLorebook();
    const dynamicContacts = getDynamicContacts();

    const byId = new Map();
    for (const c of lbContacts) byId.set(c.id, c);
    for (const c of dynamicContacts) {
        if (!byId.has(c.id)) byId.set(c.id, c);
    }

    return Array.from(byId.values());
}

async function loadContactsFromLorebook() {
    const lbName = getActiveLorebookName();
    if (!lbName) {
        console.warn(LOG, 'Лорбук не найден');
        return [];
    }

    const data = await loadWorldInfoSafe(lbName);
    if (!data || !data.entries) {
        console.warn(LOG, 'Лорбук пуст:', lbName);
        return [];
    }

    const entries = Object.values(data.entries).filter(e => !e.disable);
    const contacts = [];

    for (const entry of entries) {
        const comment = (entry.comment || '').toLowerCase();
        const keys = Array.isArray(entry.key) ? entry.key.join(' ').toLowerCase() : '';
        const contentLower = String(entry.content || '').toLowerCase();

        const isContact =
            comment.includes('phone_contact') ||
            comment.includes('phone:') ||
            keys.includes('phone_contact') ||
            /phone_contact\b/i.test(contentLower);

        if (!isContact) continue;

        let data2 = null;
        try {
            const trimmed = String(entry.content || '').trim();
            if (trimmed.startsWith('{')) data2 = JSON.parse(trimmed);
        } catch { /* не JSON */ }

        let name, description, avatar = null, color = '#007AFF', id;
        if (data2) {
            id = data2.id || `lb_${entry.uid}`;
            name = data2.name || (entry.comment || '').replace(/phone_contact/i, '').trim() || 'Unknown';
            description = data2.description || entry.content;
            avatar = data2.avatar || null;
            color = data2.color || '#007AFF';
        } else {
            name = (entry.comment || '').replace(/phone_contact/i, '').trim() || 'Contact';
            description = entry.content;
            id = `lb_${entry.uid}_${name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').slice(0, 12)}`;
        }

        contacts.push({ id, name, description, avatar, color, source: 'lorebook' });
    }

    console.log(LOG, `Из лорбука: ${contacts.length} контактов`);
    return contacts;
}

// ═══════════════════════════════════════════════
// ФИЛЬТРАЦИЯ служебных строк в ответах НПС
// ═══════════════════════════════════════════════
function stripServiceLines(text) {
    if (!text) return '';
    return text.split('\n').filter(line => {
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

// ═══════════════════════════════════════════════
// ГЕНЕРАЦИЯ ОТВЕТА НПС
// ═══════════════════════════════════════════════
export async function generateNPCReply(contact, userMessage) {
    const c = ctx();
    if (!c) return '...';
    const s = getSettings();
    const userName = c.name1 || 'User';

    // Фильтруем маркеры нашего моста из контекста — чтобы НПС не видел "ты отправил смс"
    const chatHistory = (c.chat || [])
        .slice(-30)
        .filter(m => !m.extra?.phonemsg_marker)
        .map(m => `${m.is_user ? userName : (m.name || contact.name)}: ${String(m.mes || '').replace(/<[^>]+>/g, '').trim()}`)
        .join('\n');

    const authorNote = c.chatMetadata?.note_prompt ||
        c.extensionSettings?.note?.prompts?.find(p => p.active)?.content || '';

    const phoneHistory = getConversation(contact.id)
        .slice(-20)
        .map(m => `${m.sender === userName ? userName : contact.name}: ${m.text}`)
        .join('\n');

    const meta = getNpcMeta(contact.id);

    const systemPrompt = `Ты — ${contact.name}. Оставайся в образе ВСЕГДА.

ОПИСАНИЕ ПЕРСОНАЖА:
${contact.description}

${authorNote ? `АВТОРСКИЕ ЗАМЕТКИ:\n${authorNote}\n` : ''}
ТЕКУЩИЙ КОНТЕКСТ РП:
${chatHistory || 'Контекст ещё отсутствует.'}

СОСТОЯНИЕ:
- Привязанность к ${userName}: ${meta.affection}/100

ПРАВИЛА:
- Пиши ТОЛЬКО текст смс
- Без звёздочек, нарратива, метакомментариев
- НИКОГДА не пиши служебные строки "event:", "time:", "npc:", "location:"
- Язык и стиль соответствуют сеттингу`;

    const userPrompt = phoneHistory
        ? `[Переписка]\n${phoneHistory}\n\n[Новое от ${userName}]: ${userMessage}\n\nОтветь как ${contact.name}:`
        : `[Первое сообщение от ${userName}]: ${userMessage}\n\nОтветь как ${contact.name}:`;

    const finalSystem = systemPrompt.replace(/\{\{user\}\}/g, userName);
    const finalUser = userPrompt.replace(/\{\{user\}\}/g, userName);

    let reply = '';
    try {
        if (!s.useMainApi && isExtraLLMConfigured()) {
            reply = await callExtraLLM(finalUser, { system: finalSystem });
        } else {
            reply = await c.generateRaw({ prompt: finalUser, system: finalSystem });
        }
    } catch (err) {
        console.error(LOG, 'Генерация не удалась:', err);
        return '...';
    }

    let clean = String(reply || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/^[А-ЯЁA-Z][а-яёa-zA-Z]+\s*:\s*/, '')
        .trim();

    clean = stripServiceLines(clean);
    updateNpcMeta(contact.id, { lastSeen: Date.now() });
    return clean || '...';
}

// ═══════════════════════════════════════════════
// АВТОСООБЩЕНИЯ
// ═══════════════════════════════════════════════
let _autoMessageCallback = null;
let _schedulerInterval = null;

export function setAutoMessageCallback(fn) {
    _autoMessageCallback = fn;
}

export function startAutoMessageScheduler(getContactsFn) {
    if (_schedulerInterval) clearInterval(_schedulerInterval);
    _schedulerInterval = setInterval(() => {
        const s = getSettings();
        if (!s.autoMessagesEnabled) return;

        const contacts = getContactsFn();
        if (!contacts.length) return;

        const now = Date.now();
        const silenceThreshold = (s.autoMessageSilenceMin || 30) * 60 * 1000;
        const cooldown = (s.autoMessageCooldownMin || 60) * 60 * 1000;

        for (const contact of contacts) {
            const meta = getNpcMeta(contact.id);
            const lastSeen = meta.lastSeen || 0;
            const lastCooldown = meta.cooldown || 0;

            if (lastSeen > 0 &&
                now - lastSeen > silenceThreshold &&
                now - lastCooldown > cooldown) {
                updateNpcMeta(contact.id, { cooldown: now });
                if (_autoMessageCallback) {
                    _autoMessageCallback(contact).catch(e =>
                        console.error(LOG, 'Автосообщение failed:', e)
                    );
                }
            }
        }
    }, 60 * 1000);
}

export async function generateContactAvatar(contact) {
    if (!isImageApiConfigured()) throw new Error('Image API не настроен');
    const imgPrompt = `portrait photo of ${contact.name}, ${String(contact.description || '').slice(0, 200)}, dating app selfie, natural lighting`;
    return await generateImage(imgPrompt);
}
