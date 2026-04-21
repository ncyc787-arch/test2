// engine.js — логика генерации НПС и разбор img-тегов для PhoneMSG

import { chat_metadata } from '../../../../script.js';
import {
    addMessage, getConversation, getContacts, getNpcMeta, updateNpcMeta,
    getSettings, getDynamicContacts
} from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImageFromInstruction } from './api.js';

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

// ─── Убирает из текста теги [телефон:Имя] и [контакт:Имя:ID] ───────────────
function stripPhoneTags(text, bridgeIncomingTag = 'телефон', bridgeContactTag = 'контакт') {
    return String(text || '')
        .replace(new RegExp(`\\[${escapeRegex(bridgeIncomingTag)}:[^\\]]+?\\]\\s*`, 'gi'), '')
        .replace(new RegExp(`\\[${escapeRegex(bridgeContactTag)}:[^\\]]+?\\]\\s*`, 'gi'), '')
        .replace(/\[IMG:GEN\]/g, '')
        .trim();
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Парсинг img-тегов НПС-ответа ───────────────────────────────────────────
// Формат: <img data-iig-instruction='{"style":"...","prompt":"...","aspect_ratio":"...","image_size":"..."}' src="[IMG:GEN]">
export function parseModelReply(rawText) {
    const text = String(rawText || '');
    // Более гибкий паттерн — ловит одинарные И двойные кавычки вокруг JSON
    const imgPattern = /<img\s[^>]*data-iig-instruction=(['"])(\{[^'"]*\})\1[^>]*>/gi;

    const images = [];
    let cleaned = '';
    let lastIndex = 0;
    let m;

    while ((m = imgPattern.exec(text)) !== null) {
        cleaned += text.slice(lastIndex, m.index);
        lastIndex = m.index + m[0].length;

        try {
            const json = JSON.parse(m[2]);
            images.push({ rawTag: m[0], instruction: json });
        } catch (e) {
            // Попробуем заменить плейсхолдеры и распарсить снова
            try {
                const fixed = m[2]
                    .replace(/"\[STYLE\]"/g, '"photorealistic portrait"')
                    .replace(/"\[DESC\]"/g, '"a photo"')
                    .replace(/"\[RATIO\]"/g, '"1:1"')
                    .replace(/"\[SIZE\]"/g, '"1K"');
                const json = JSON.parse(fixed);
                images.push({ rawTag: m[0], instruction: json });
            } catch {
                console.warn(LOG, 'bad data-iig-instruction JSON:', m[2]);
            }
        }
    }
    cleaned += text.slice(lastIndex);

    const s = getSettings();
    const finalText = stripPhoneTags(
        stripServiceLines(cleaned).trim(),
        s.bridgeIncomingTag || 'телефон',
        s.bridgeContactTag || 'контакт'
    );

    return { text: finalText, images };
}

// ─── Разбить ответ НПС на отдельные реплики (по \n\n или [телефон:] блокам) ─
// Возвращает массив { text, images[] }
export function splitNPCReply(rawText) {
    const s = getSettings();
    const phoneTag = escapeRegex(s.bridgeIncomingTag || 'телефон');

    // Если НПС использует [телефон:Имя] теги — разбиваем по ним
    const tagRe = new RegExp(`\\[${phoneTag}:[^\\]]+?\\]\\s*([\\s\\S]*?)(?=\\[${phoneTag}:|$)`, 'gi');
    const tagMatches = [...rawText.matchAll(tagRe)];

    if (tagMatches.length > 1) {
        return tagMatches.map(tm => parseModelReply(tm[1].trim())).filter(r => r.text || r.images.length);
    }

    // Иначе разбиваем по двойному переносу строки
    const parts = rawText.split(/\n{2,}/);
    if (parts.length > 1) {
        return parts.map(p => parseModelReply(p.trim())).filter(r => r.text || r.images.length);
    }

    // Одна реплика
    return [parseModelReply(rawText)];
}

// ─── Генерация ответа НПС ────────────────────────────────────────────────────
export async function generateNPCReply(contact, userMessage, attachedImageDataUrl = null) {
    const c = ctx();
    if (!c) return [{ type: 'text', text: '...' }];

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

    // Подсказка по вложению
    const attachHint = attachedImageDataUrl
        ? `\n\n[${userName} прикрепил(а) фото к этому сообщению. Опиши реакцию на него.]`
        : '';

    const systemPrompt = `Ты — ${contact.name}. Оставайся в образе ВСЕГДА.

ОПИСАНИЕ ПЕРСОНАЖА:
${contact.description}

${authorNote ? `АВТОРСКИЕ ЗАМЕТКИ:\n${authorNote}\n` : ''}
ТЕКУЩИЙ КОНТЕКСТ РП:
${chatHistory || 'Контекст ещё отсутствует.'}

СОСТОЯНИЕ:
- Привязанность к ${userName}: ${meta.affection}/100

ФОРМАТ ОТВЕТА — СТРОГО СОБЛЮДАЙ:
1. Напиши текст смс (одно-два предложения, без html и скобок).
2. Сразу после текста, на новой строке, добавь img-тег для фотографии:

<img data-iig-instruction='{"style":"СТИЛЬ","prompt":"ОПИСАНИЕ","aspect_ratio":"СООТНОШЕНИЕ","image_size":"РАЗМЕР"}' src="[IMG:GEN]">

Заполняй поля:
- "style": стиль фото (например: "photorealistic portrait, selfie", "cinematic photo")
- "prompt": конкретное описание того что на фото (внешность, одежда, поза, обстановка)
- "aspect_ratio": "1:1" или "9:16" или "16:9"
- "image_size": "1K"

ВАЖНО: src ВСЕГДА строго "[IMG:GEN]". JSON — валидный. Кавычки внутри JSON только двойные.
ЗАПРЕЩЕНО: плейсхолдеры вида [DESC], [STYLE] и т.п. — заполняй реальным текстом.`;

    const userPrompt = phoneHistory
        ? `[Переписка]\n${phoneHistory}\n\n[Новое от ${userName}]: ${userMessage}${attachHint}\n\nОтветь как ${contact.name}:`
        : `[Первое сообщение от ${userName}]: ${userMessage}${attachHint}\n\nОтветь как ${contact.name}:`;

    const finalSystem = systemPrompt.replace(/\{\{user\}\}/g, userName);
    const finalUser = userPrompt.replace(/\{\{user\}\}/g, userName);

    let replyText = '';
    try {
        if (!s.useMainApi && isExtraLLMConfigured()) {
            // Vision: если есть вложение — передаём картинку
            if (attachedImageDataUrl) {
                replyText = await callExtraLLM(finalUser, {
                    system: finalSystem,
                    images: [attachedImageDataUrl],
                });
            } else {
                replyText = await callExtraLLM(finalUser, { system: finalSystem });
            }
        } else {
            replyText = await c.generateRaw({ prompt: finalUser, systemPrompt: finalSystem });
        }
    } catch (err) {
        console.error(LOG, 'Генерация не удалась:', err);
        return [{ type: 'text', text: '...' }];
    }

    // Разбиваем ответ на несколько реплик
    const replies = splitNPCReply(replyText);
    const results = [];

    // Аватар для refImage
    const { getCustomAvatar } = await import('./state.js');
    const refImage = getCustomAvatar(contact.id) || contact.avatar || null;

    for (const reply of replies) {
        if (reply.images.length > 0) {
            const instr = reply.images[0].instruction;
            const caption = reply.text || '';
            const injectText = caption.slice(0, 120) || 'фото';

            // Пробуем сгенерировать картинку
            let imageUrl = null;
            try {
                imageUrl = await generateImageFromInstruction(instr, refImage);
            } catch (e) {
                console.error(LOG, 'generateImage failed:', e);
            }

            if (imageUrl) {
                results.push({ type: 'image', text: caption, imageUrl, caption, injectText });
            } else if (caption) {
                results.push({ type: 'text', text: caption });
            }
        } else if (reply.text) {
            results.push({ type: 'text', text: reply.text });
        }
    }

    updateNpcMeta(contact.id, { lastSeen: Date.now() });
    return results.length ? results : [{ type: 'text', text: '...' }];
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
