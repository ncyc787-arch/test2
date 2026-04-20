// engine.js — логика генерации НПС и разбор img-тегов для PhoneMSG

import { chat_metadata } from '../../../../script.js';
import {
    addMessage, getConversation, getContacts, getNpcMeta, updateNpcMeta,
    getSettings, getDynamicContacts
} from './state.js';
import { callExtraLLM, isExtraLLMConfigured, extractImagesFromMessage } from './api.js';

const LOG = '[PhoneMSG-Engine]';
const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null);

export function getActiveLorebookName() {
    const s = getSettings();
    if (s.lorebookSource === 'named' && s.lorebookName) return s.lorebookName;

    const chatLb = chat_metadata?.['world_info'];
    if (chatLb) return chatLb;

    try {
        const c = ctx();
        const charId = c?.characterId;
        const chars = c?.characters;
        if (chars && charId != null) {
            const charLb = chars[charId]?.data?.extensions?.world;
            if (charLb) return charLb;
        }
    } catch {}

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
        } catch {}

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

function stripServiceLines(text) {
    if (!text) return '';
    return String(text)
        .replace(/<horae>\s*<\/horae>/gi, '')
        .replace(/<horaeevent>\s*<\/horaeevent>/gi, '')
        .replace(/<horae>[\s\S]*?<\/horae>/gi, '')
        .replace(/<horaeevent>[\s\S]*?<\/horaeevent>/gi, '')
        .trim();
}

// Разбор ответа модели: вытаскиваем обычный текст и <img ...> c data-iig-instruction
export function parseModelReply(rawText) {
    const text = String(rawText || '');
    const imgPattern = /<img\s+([^>]*data-iig-instruction=['"][^'"]*['"][^>]*)>/gi;

    const images = [];
    let cleaned = '';
    let lastIndex = 0;
    let m;

    while ((m = imgPattern.exec(text)) !== null) {
        const fullTag = m[0];
        const attrs = m[1];

        cleaned += text.slice(lastIndex, m.index);
        lastIndex = m.index + fullTag.length;

        const instrMatch = attrs.match(/data-iig-instruction=['"]([^'"]+)['"]/i);
        const srcMatch = attrs.match(/\ssrc=['"]([^'"]+)['"]/i);
        if (!instrMatch) continue;

        try {
            const json = JSON.parse(instrMatch[1]);
            images.push({
                rawTag: fullTag,
                instruction: json,
                src: srcMatch ? srcMatch[1] : null,
            });
        } catch (e) {
            console.warn(LOG, 'bad data-iig-instruction JSON:', e);
        }
    }
    cleaned += text.slice(lastIndex);

    return {
        text: stripServiceLines(cleaned).trim(),
        images,
    };
}

export async function generateNPCReply(contact, userMessage) {
    const c = ctx();
    if (!c) return { type: 'text', text: '...' };

    const s = getSettings();
    const userName = c.name1 || 'User';

    const chatHistory = (c.chat || [])
        .slice(-30)
        .filter(m => !m.extra?.phonemsg_marker)
        .map(m => `${m.is_user ? userName : (m.name || contact.name)}: ${String(m.mes || '').replace(/<[^>]+>/g, '').trim()}`)
        .join('\n');

    const authorNote = c.chatMetadata?.note_prompt ||
        c.extensionSettings?.note?.prompts?.find(p => p.active)?.content || '';

    const phoneHistory = getConversation(contact.id)
        .slice(-20)
        .map(m => {
            if (m.type === 'image') {
                const desc = m.injectText || m.caption || 'фото';
                return `${m.sender === userName ? userName : contact.name}: [отправил(а) фото: ${desc}]`;
            }
            return `${m.sender === userName ? userName : contact.name}: ${m.text}`;
        })
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

ФОРМАТ ОТВЕТА:
- Сначала обычный текст смс-сообщения БЕЗ html-разметки.
- Сразу после текста добавь один или несколько img-тегов на отдельных строках:

  <img data-iig-instruction='{"style":"[STYLE]","prompt":"[DESC]","aspect_ratio":"[RATIO]","image_size":"[SIZE]"}' src="[IMG:GEN]">

- Заполняй плейсхолдеры:
  - [STYLE] — стиль изображения (например: "photorealistic portrait", "anime style", "cinematic still")
  - [DESC] — конкретное описание сцены, внешности, обстановки
  - [RATIO] — соотношение сторон: "1:1", "9:16", "16:9", "3:2"
  - [SIZE] — размер: "1K" (1024px) или "2K" (1536px)
- src ВСЕГДА строго "[IMG:GEN]" для новых картинок
- В каждом ответе ДОЛЖНА быть хотя бы одна картинка
- data-iig-instruction — валидный JSON в одинарных кавычках

ЗАПРЕЩЕНО:
- Писать что-либо кроме текста + img-тегов
- Использовать слова "erotic", "explicit", "nsfw" в тегах`;

    const userPrompt = phoneHistory
        ? `[Переписка]\n${phoneHistory}\n\n[Новое от ${userName}]: ${userMessage}\n\nОтветь как ${contact.name}:`
        : `[Первое сообщение от ${userName}]: ${userMessage}\n\nОтветь как ${contact.name}:`;

    const finalSystem = systemPrompt.replace(/\{\{user\}\}/g, userName);
    const finalUser = userPrompt.replace(/\{\{user\}\}/g, userName);

    let replyText = '';
    try {
        if (!s.useMainApi && isExtraLLMConfigured()) {
            replyText = await callExtraLLM(finalUser, { system: finalSystem });
        } else {
            replyText = await c.generateRaw({ prompt: finalUser, systemPrompt: finalSystem });
        }
    } catch (err) {
        console.error(LOG, 'Генерация не удалась:', err);
        return { type: 'text', text: '...' };
    }

    const parsed = parseModelReply(replyText);

    if (parsed.images.length > 0) {
        const first = parsed.images[0];
        const instr = first.instruction || {};

        const caption = parsed.text || instr.caption || '';
        const inject = instr.inject ||
            (caption ? caption.slice(0, 120) : 'фото');

        return {
            type: 'image',
            text: parsed.text,
            imageInstruction: instr,
            imageTag: first.rawTag,
            caption,
            injectText: inject,
        };
    }

    // fallback — чистый текст
    const cleanText = stripServiceLines(parsed.text);
    updateNpcMeta(contact.id, { lastSeen: Date.now() });

    return {
        type: 'text',
        text: cleanText || '...',
    };
}

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
