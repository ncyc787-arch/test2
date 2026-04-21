// engine.js — логика генерации НПС для PhoneMSG
// Картинки: НПС пишет [IMG:english photo description], генерация идёт в фоне как в Spark

import { chat_metadata } from '../../../../script.js';
import {
    addMessage, getConversation, getContacts, getNpcMeta, updateNpcMeta,
    getSettings, getDynamicContacts, saveState
} from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImageWithFallback } from './api.js';

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

// ── Очистка <think>-тегов, служебных тегов и РП-нарратива ───────────────────
function cleanLLMOutput(text) {
    if (!text) return '';
    let t = String(text);

    // Убираем think-теги reasoning-моделей
    t = t.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?(?=\n\n|$)/gi, '');
    t = t.replace(/```(?:think|thinking|reasoning)[\s\S]*?```/gi, '');

    // Убираем horae/horaeevent
    t = t.replace(/<horae>\s*<\/horae>/gi, '');
    t = t.replace(/<horaeevent>\s*<\/horaeevent>/gi, '');
    t = t.replace(/<horae>[\s\S]*?<\/horae>/gi, '');
    t = t.replace(/<horaeevent>[\s\S]*?<\/horaeevent>/gi, '');

    // Убираем теги-мосты если НПС их использует
    t = t.replace(/\[телефон:[^\]]+\]\s*/gi, '');
    t = t.replace(/\[контакт:[^\]]+\]\s*/gi, '');

    // Убираем «Имя:» в начале если модель дублирует имя
    t = t.replace(/^[А-ЯЁA-Z][а-яёa-zA-Z]+\s*:\s*/, '');

    // Убираем DESC-теги (иногда модель пишет [DESC:...] вместо [IMG:...])
    t = t.replace(/\[DESC\s*\]/gi, '');

    // Убираем РП-нарратив — строки целиком в *звёздочках* или _подчёркиваниях_
    // (это действия, а не SMS-текст: *Аякс уставился в экран*)
    t = t.split('\n').filter(line => {
        const l = line.trim();
        if (!l) return true; // пустые строки сохраняем для разделения пузырьков
        // Строка полностью заключена в *...* или _..._ — РП-действие, убираем
        if (/^\*[^*]+\*$/.test(l)) return false;
        if (/^_[^_]+_$/.test(l)) return false;
        // Строка начинается с «Он», «Она», «Аякс» + глагол — нарратив, убираем
        // Слишком агрессивно не делаем, только явные случаи вида "Он увеличил фото."
        return true;
    }).join('\n');

    // Убираем строки вида *действие* внутри текста (inline RP)
    // Оставляем только если это единственное содержимое сообщения
    t = t.replace(/\*[^*\n]{3,80}\*/g, (match, offset, str) => {
        // Если вся строка это *...* — уже убрали выше, здесь убираем только inline
        const lineStart = str.lastIndexOf('\n', offset) + 1;
        const lineEnd = str.indexOf('\n', offset);
        const line = str.slice(lineStart, lineEnd === -1 ? str.length : lineEnd).trim();
        // Если весь текст строки = этот match — уже обработано выше
        if (line === match.trim()) return match;
        // Иначе убираем inline РП
        return '';
    });

    return t.trim();
}

// ── Обновить сообщение по _genId (для async-генерации картинки) ──────────────
function updateGeneratedImage(contactId, genId, patch) {
    const state_mod = (typeof SillyTavern?.getContext === 'function')
        ? SillyTavern.getContext()?.chatMetadata?.PhoneMSG
        : null;

    // Импортируем getState через динамический импорт чтобы избежать circular
    import('./state.js').then(({ getState, saveState }) => {
        const state = getState();
        const list = state.conversations?.[contactId];
        if (!list) return;
        const msg = list.find(m => m && m._genId === genId);
        if (!msg) return;
        Object.assign(msg, patch);
        saveState();
        // Сигнализируем UI о перерендере
        window.dispatchEvent(new CustomEvent('phonemsg:rerender', { detail: { contactId } }));
    });
}

// ── Основная генерация ответа НПС ─────────────────────────────────────────────
// Возвращает массив { type, text, _genId?, _generating? } — каждый элемент = пузырёк
export async function generateNPCReply(contact, userMessage, attachedImageDataUrl = null) {
    const c = ctx();
    if (!c) return [{ type: 'text', text: '...' }];

    const s = getSettings();
    const userName = c.name1 || 'User';

    // История основного чата (последние 30 без phonemsg-маркеров)
    const chatHistory = (c.chat || [])
        .slice(-30)
        .filter(m => !m.extra?.phonemsg_marker)
        .map(m => `${m.is_user ? userName : (m.name || contact.name)}: ${String(m.mes || '').replace(/<[^>]+>/g, '').trim()}`)
        .join('\n');

    const authorNote = c.chatMetadata?.note_prompt ||
        c.extensionSettings?.note?.prompts?.find(p => p.active)?.content || '';

    // История переписки в телефоне
    const phoneHistory = getConversation(contact.id)
        .slice(-20)
        .map(m => {
            let line = '';
            if (m.type === 'image') {
                const desc = m._imgCaption || m.injectText || m.caption || 'фото';
                if (m.from === 'user' || m.sender !== contact.name) {
                    line = `${userName}: [прислал(а) фото: ${desc}]`;
                } else {
                    line = `${contact.name}: [прислал(а) фото: ${m._imgPrompt || desc}]`;
                }
            } else {
                const who = m.sender === userName ? userName : contact.name;
                line = `${who}: ${m.text || ''}`;
            }
            return line;
        })
        .join('\n');

    const meta = getNpcMeta(contact.id);

    const attachHint = attachedImageDataUrl
        ? `\n[${userName} прикрепил(а) фото к этому сообщению]`
        : '';

    const systemPrompt = `Ты — ${contact.name}. Оставайся в образе ВСЕГДА.

ОПИСАНИЕ ПЕРСОНАЖА:
${contact.description}

${authorNote ? `АВТОРСКИЕ ЗАМЕТКИ:\n${authorNote}\n` : ''}
ТЕКУЩИЙ КОНТЕКСТ (основной чат):
${chatHistory || 'Контекст отсутствует.'}

СОСТОЯНИЕ:
- Привязанность к ${userName}: ${meta.affection}/100

ИСТОРИЯ ПЕРЕПИСКИ В ТЕЛЕФОНЕ:
${phoneHistory || '(пока ничего)'}

ЗАДАЧА: Напиши следующее сообщение(я) от лица ${contact.name}. Одно-два коротких смс.
Если несколько — раздели ДВОЙНЫМ переносом строки.

ФОТО: если уместно прислать фото — добавь ОТДЕЛЬНЫМ сообщением тег:
[IMG:english photo description, 10-20 words, what's in the photo, pose, setting]
Используй РЕДКО (примерно 1 раз на 8-12 сообщений), только когда органично.
Описание НА АНГЛИЙСКОМ, в стиле dating-app/phone selfie.

ЗАПРЕЩЕНО КАТЕГОРИЧЕСКИ:
- Писать от третьего лица (он/она/Аякс сделал...)
- Писать действия в *звёздочках* (*поднял трубку*, *усмехнулся*)
- Писать нарратив, описания, РП-сцены
- Добавлять «${contact.name}:» перед текстом
- Комментировать что ты делаешь

ТОЛЬКО сам текст SMS-сообщения, как настоящий живой человек пишет в мессенджере.`;

    // Vision — если последнее сообщение от юзера содержит фото
    const visionImages = attachedImageDataUrl ? [attachedImageDataUrl] : [];

    let raw = '';
    try {
        if (!s.useMainApi && isExtraLLMConfigured()) {
            raw = await callExtraLLM(systemPrompt, visionImages.length ? { images: visionImages } : {});
        } else {
            // Основной API — системный промпт как context, userPrompt как финальное сообщение
            const userPrompt = phoneHistory
                ? `[Переписка]\n${phoneHistory}\n\n[Новое от ${userName}]: ${userMessage}${attachHint}\n\nОтветь как ${contact.name}:`
                : `[Первое сообщение от ${userName}]: ${userMessage}${attachHint}\n\nОтветь как ${contact.name}:`;
            raw = await c.generateRaw({
                prompt: userPrompt.replace(/\{\{user\}\}/g, userName),
                systemPrompt: systemPrompt.replace(/\{\{user\}\}/g, userName),
            });
        }
    } catch (err) {
        console.error(LOG, 'Генерация не удалась:', err);
        return [{ type: 'text', text: '...' }];
    }

    const result = cleanLLMOutput(raw);
    if (!result) {
        console.warn(LOG, 'LLM вернул пусто');
        return [{ type: 'text', text: '...' }];
    }

    // ── Парсим ответ: разбиваем на части по \n\n ──────────────────────────────
    // Как в Spark: каждая часть = отдельный пузырёк
    const parts = result.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

    const results = [];
    // Аватар для ref
    const { getCustomAvatar } = await import('./state.js');
    const refAvatar = (getSettings().useAvatarAsRef !== false)
        ? (getCustomAvatar(contact.id) || contact.avatar || null)
        : null;

    for (const part of parts) {
        // Извлекаем все [IMG:...] теги — как в Spark
        const imgRegex = /\[IMG:([^\]]+)\]/gi;
        const imgMatches = [...part.matchAll(imgRegex)];
        const cleanText = part.replace(imgRegex, '').trim();

        // Текстовая часть (до/вокруг фото)
        if (cleanText) {
            results.push({ type: 'text', text: cleanText });
        }

        // Фото-части — каждый [IMG:...] = отдельный пузырёк, генерация в фоне
        for (const m of imgMatches) {
            const imgPrompt = m[1].trim();
            const genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            // Сразу добавляем пузырёк с состоянием «генерируется»
            results.push({
                type: 'image',
                text: '',
                imageUrl: '',
                _generating: true,
                _imgPrompt: imgPrompt,
                _genId: genId,
            });

            // Запускаем генерацию асинхронно (не блокируем UI)
            const capturedContactId = contact.id;
            const capturedGenId = genId;
            (async () => {
                try {
                    const s = getSettings();
                    const prefix = (s.imagePromptPrefix || '').trim();
                    const suffix = (s.imagePromptSuffix || '').trim();
                    const fullPrompt = [prefix, imgPrompt, suffix].filter(Boolean).join(', ');
                    const dataUrl = await generateImageWithFallback(fullPrompt, refAvatar);
                    updateGeneratedImage(capturedContactId, capturedGenId, {
                        imageUrl: dataUrl,
                        image: dataUrl,
                        _generating: false,
                    });
                } catch (err) {
                    console.warn(LOG, 'inline image failed:', err);
                    updateGeneratedImage(capturedContactId, capturedGenId, {
                        imageUrl: '',
                        image: '',
                        text: `[фото не загрузилось: ${String(err?.message || err).slice(0, 80)}]`,
                        _generating: false,
                    });
                }
            })();
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
