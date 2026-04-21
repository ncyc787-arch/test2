// ═══════════════════════════════════════════
// ENGINE — генерация ответов + синк с основным чатом ST
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { loadState, pushMessage, updateMessage, getSettings, save } from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImageWithFallback, isImageApiConfigured, generateImageViaSD } from './api.js';

const PROMPT_KEY = 'IMESSAGE_EXT';

// ── Парсинг РП-действий бота: извлечь ТОЛЬКО текст сообщений ──
// Удаляет: «Написал в телефон:», «*отправил*», «[action]», кавычки-обёртки и т.п.
// Возвращает массив { text?, image?, deleted? }
export function parseRpMessage(raw) {
    if (!raw) return [];
    let text = String(raw);

    // Убираем <think>
    text = text.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/```(?:think|thinking)[\s\S]*?```/gi, '');

    // Детектим паттерны «написал/напечатал/отправил ... в телефон/сообщение»
    // Если такая фраза есть — пытаемся вычленить только ТЕКСТ сообщения
    const phonePatterns = [
        // «написал(а) в телефон: "текст"»
        /(?:написал[аи]?|напечатал[аи]?|отправил[аи]?|прислал[аи]?|скинул[аи]?)[\s\S]{0,80}(?:в телефон|сообщение|смс|мессенджер)[^\n:]*[:\n]\s*[«""]?([\s\S]+?)[»""']?\s*$/im,
        // «*написал в телефон* "текст"»
        /\*(?:написал[аи]?|отправил[аи]?|напечатал[аи]?)[\s\S]{0,60}?\*[:\s]*[«""]?([\s\S]+?)[»""']?\s*$/im,
        // «[отправил сообщение]: текст»
        /\[(?:написал[аи]?|отправил[аи]?|напечатал[аи]?|прислал[аи]?)[^\]]*\][:\s]*[«""]?([\s\S]+?)[»""']?\s*$/im,
    ];
    for (const re of phonePatterns) {
        const m = text.match(re);
        if (m && m[1]) {
            text = m[1].trim();
            break;
        }
    }

    // Убираем ролевые обёртки *действия* в начале/конце если они НЕ содержат текст сообщения
    // Но оставляем если это просто эмодзи или короткое слово
    text = text.replace(/^\*[^*]{1,120}\*\s*/gm, (match) => {
        // если внутри звёздочек нет букв алфавита (только действие) — убираем
        const inner = match.replace(/\*/g, '').trim();
        if (/^[а-яёa-z\s,.!?…]{3,}$/i.test(inner) && inner.length > 30) return '';
        return match;
    });

    // Убираем «имя персонажа: » в начале
    text = text.replace(/^[А-ЯЁA-Z][а-яёa-zA-Z\s-]{1,30}:\s*/m, '');

    // Убираем служебные строки о действиях (одиночные строки без текста сообщения)
    const lines = text.split('\n');
    const cleanLines = lines.filter(line => {
        const l = line.trim();
        if (!l) return false;
        // Строка — чистое действие-описание (нет ничего кроме *...*  или [...])
        if (/^\*[^*]+\*$/.test(l) && l.length > 10) return false;
        if (/^\[[^\]]+\]$/.test(l) && l.length > 10) return false;
        // Строки типа «(удалил сообщение)», «(напечатал и стёр)»
        if (/^\([^)]+\)$/.test(l) && /удал|стёр|написал|отправил|прочитал/i.test(l)) return false;
        return true;
    });
    text = cleanLines.join('\n').trim();

    if (!text) return [];

    // Разбиваем на части по двойному переносу
    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const result = [];

    for (const part of parts) {
        // [DELETED]текст[/DELETED] → удалённое сообщение
        const del = part.match(/^\[DELETED\]([\s\S]+?)\[\/DELETED\]$/i);
        if (del) {
            result.push({ text: del[1].trim(), deleted: true });
            continue;
        }
        // [IMG:...] → картинка
        const imgRe = /\[IMG:(GEN:)?([^\]]+)\]/gi;
        const imgs = [...part.matchAll(imgRe)];
        const cleanText = part.replace(imgRe, '').trim();
        if (cleanText) result.push({ text: cleanText });
        for (const m of imgs) {
            let imgPrompt = m[2].trim();
            if (m[1]) { try { const j = JSON.parse(m[2]); imgPrompt = [j.style, j.prompt].filter(Boolean).join(' ') || imgPrompt; } catch {} }
            result.push({ image: true, _imgPrompt: imgPrompt });
        }
    }

    return result;
}

function cleanLLMOutput(text) {
    if (!text) return '';
    let t = String(text);
    t = t.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/```(?:think|thinking)[\s\S]*?```/gi, '');
    t = t.replace(/^[А-ЯЁA-Z][а-яёa-zA-Z\s-]{1,30}:\s*/m, '');
    return t.trim();
}

// ── Персона пользователя ──
function getUserPersona() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const name = c.name1 || 'User';
        let description = '';
        if (typeof c.substituteParams === 'function') {
            const sub = c.substituteParams('{{persona}}');
            if (sub && sub !== '{{persona}}') description = sub;
        }
        if (!description) {
            const pu = c.powerUserSettings || {};
            const { user_avatar } = /** @type {any} */(window);
            if (pu.personas && pu.persona_descriptions && user_avatar) {
                description = pu.persona_descriptions[user_avatar]?.description || '';
            }
        }
        return { name, description: (description || '').trim() };
    } catch { return { name: 'User', description: '' }; }
}


// ── Загрузка описания из лорбука (активного в чате или персонажа) ──
async function getLorebookDescription() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        // Имя лорбука: сначала chat_metadata.world_info, потом поле World персонажа
        const { chat_metadata } = await import('../../../../script.js');
        let lbName = chat_metadata?.['world_info'];
        if (!lbName) {
            const charIdx = c.characterId;
            const chars = c.characters;
            if (chars && charIdx != null) {
                lbName = chars[charIdx]?.data?.extensions?.world;
            }
        }
        if (!lbName) return '';
        // Загружаем лорбук
        const wi = await import('../../../world-info.js');
        const data = await wi.loadWorldInfo(lbName);
        if (!data?.entries) return '';
        // Берём ВСЕ активные записи и склеиваем в один блок
        const entries = Object.values(data.entries).filter(e => !e.disable);
        if (!entries.length) return '';
        const blocks = entries.map(e => {
            const title = (e.comment || '').trim();
            const body = String(e.content || '').trim();
            return title ? `[${title}]
${body}` : body;
        }).filter(Boolean);
        let result = blocks.join('

');
        // Подставляем макросы ST
        if (result && typeof c.substituteParams === 'function') {
            result = c.substituteParams(result);
        }
        return result.slice(0, 4000);
    } catch (e) {
        console.warn('[iMsg] getLorebookDescription failed:', e);
        return '';
    }
}

// ── Основная генерация ответа персонажа ──
export async function generateCharReply(opts = {}) {
    if (!isExtraLLMConfigured()) {
        console.warn('[iMsg] Extra API не настроен');
        return 0;
    }
    const s = loadState();
    const settings = getSettings();
    const charName = s.charName || 'Персонаж';
    const persona = getUserPersona();
    const userLabel = persona.name || 'User';

    // История переписки
    const messages = (s.messages || []).slice(-60);
    const historyText = messages.map((m, idx) => {
        const who = m.from === 'user' ? userLabel : charName;
        const flag = m.deleted ? ' [позже удалил(а)]' : '';
        let img = '';
        if (m.image || m._imgPrompt) {
            img = m.from === 'user'
                ? (m._imgCaption ? ` [прислала фото: ${m._imgCaption}]` : ' [прислала фото]')
                : (m._imgPrompt ? ` [прислал фото: ${m._imgPrompt}]` : ' [прислал фото]');
        }
        // Временной маркер если прошло > 1 часа
        const prev = idx > 0 ? messages[idx - 1] : null;
        let gap = '';
        if (prev?.ts && m.ts) {
            const h = Math.floor((m.ts - prev.ts) / 3600000);
            if (h >= 24) { const d = Math.floor(h / 24); gap = `--- прошло ${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'} ---\n`; }
            else if (h >= 1) gap = `--- прошло ${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'} ---\n`;
        }
        return `${gap}${who}: ${m.text || ''}${img}${flag}`;
    }).join('\n');

    // Последние реплики основного чата ST
    const stExcerpt = getMainChatExcerpt(charName, 8);
    const stBlock = stExcerpt
        ? `\n\nПАРАЛЛЕЛЬНЫЙ РП-ЧАТ (вы с ${userLabel} общаетесь ещё и напрямую — встреча/звонок/видеозвонок и т.п.; используй как контекст, не придумывай лишнего):\n${stExcerpt}\n`
        : '';

    const personaBlock = (settings.includePersonaDescription && persona.description)
        ? `\nО СОБЕСЕДНИЦЕ (${userLabel}):\n${persona.description}\n`
        : '';

    // Получаем описание персонажа из основного чата ST
    let charDescription = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const charIdx = c.characterId;
        const chars = c.characters;
        if (chars && charIdx != null) {
            const char = chars[charIdx];
            charDescription = [char?.description, char?.personality, char?.mes_example]
                .filter(Boolean).join('\n').slice(0, 2000);
        }
        // Подставляем макросы
        if (charDescription && typeof c.substituteParams === 'function') {
            charDescription = c.substituteParams(charDescription);
        }
    } catch {}

    const charBlock = charDescription
        ? `\nОПИСАНИЕ ПЕРСОНАЖА (ты — ${charName}):\n${charDescription}\n`
        : '';

    // Лорбук текущего чата/персонажа (дополнительный контекст — backstory, факты мира, отношения)
    const lorebookText = await getLorebookDescription();
    const lorebookBlock = lorebookText
        ? `\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИЗ ЛОРБУКА:\n${lorebookText}\n`
        : '';

    const imgEnabled = settings.allowCharImages !== false;
    const isAutoReply = opts.auto === true;
    const prompt = `Ты — ${charName}, пишешь ${userLabel} в iMessage. Ты ОДИН и тот же человек что и в основном чате.
${charBlock}${lorebookBlock}${personaBlock}${stBlock}
ПЕРЕПИСКА В ТЕЛЕФОНЕ (ты = ${charName}, от старых к новым):
${historyText || '(сообщений ещё нет — это будет первое сообщение)'}

ЗАДАЧА: Напиши следующее сообщение(я) от ${charName} в iMessage.${isAutoReply ? ' Ты сам решил написать спустя какое-то время — может поделиться мыслью, спросить как дела, прислать что-то интересное.' : ' Ответь на последнее сообщение.'}

ФОРМАТ:
- Пиши КАК В РЕАЛЬНОЙ ПЕРЕПИСКЕ: кратко, живо, без пафоса.
- Несколько коротких сообщений — разделяй двойным переносом строки.
- Если удаляешь сообщение — [DELETED]текст[/DELETED]
${imgEnabled ? `- Фото: когда ОРГАНИЧНО (показать где находишься, что делаешь, скинуть мем/скрин, или если тебя попросили) — добавь [IMG:English photo description 10-20 words]. НЕ ЧАЩЕ раза на 8-12 сообщений. Описание должно точно отражать персонажа и ситуацию.` : ''}
- Ответ ТОЛЬКО текст сообщений. Никаких *действий*, никаких пояснений, никакого «${charName}:».`;

    // Vision: последнее фото от юзера
    const lastMsg = messages[messages.length - 1];
    const visionImages = (lastMsg?.from === 'user' && lastMsg?.image) ? [lastMsg.image] : [];

    let raw;
    try {
        raw = await callExtraLLM(prompt, visionImages.length ? { images: visionImages } : {});
    } catch (e) {
        console.error('[iMsg] LLM failed:', e);
        return 0;
    }

    const result = cleanLLMOutput(raw);
    if (!result) return 0;

    const parts = parseRpMessage(result);
    let pushed = 0;

    for (const part of parts) {
        if (part.image) {
            const genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            pushMessage({ from: 'char', text: '', image: '', _generating: true, _imgPrompt: part._imgPrompt, _genId: genId });
            pushed++;
            // Async генерация
            (async () => {
                try {
                    const charAvatar = settings.charAvatar || null;
                    const ref = (settings.useAvatarAsRef !== false) ? charAvatar : null;
                    const dataUrl = await generateImageWithFallback(part._imgPrompt, ref);
                    updateMessage(genId, { image: dataUrl, _generating: false });
                } catch (err) {
                    console.warn('[iMsg] inline image failed:', err);
                    updateMessage(genId, { image: '', text: `[фото не загрузилось]`, _generating: false });
                }
                window.dispatchEvent(new CustomEvent('imsg:rerender'));
            })();
        } else {
            pushMessage({ from: 'char', text: part.text || '', deleted: part.deleted || false });
            pushed++;
        }
    }

    if (pushed > 0) {
        syncToMainChat();
        window.dispatchEvent(new CustomEvent('imsg:rerender'));
        scheduleNextAutoReply();
    }
    return pushed;
}

// Перегенерация картинки
export async function regenerateChatImage(msgTs) {
    const s = loadState();
    const msg = (s.messages || []).find(m => m && m.ts === Number(msgTs));
    if (!msg || !msg._imgPrompt) return;
    const settings = getSettings();
    msg._generating = true;
    msg.image = '';
    save();
    window.dispatchEvent(new CustomEvent('imsg:rerender'));
    try {
        const ref = (settings.useAvatarAsRef !== false) ? (settings.charAvatar || null) : null;
        const dataUrl = await generateImageWithFallback(msg._imgPrompt, ref);
        msg.image = dataUrl;
        msg._generating = false;
        save();
    } catch (err) {
        console.warn('[iMsg] regen failed:', err);
        msg.image = '';
        msg.text = '[фото не загрузилось]';
        msg._generating = false;
        save();
    }
    window.dispatchEvent(new CustomEvent('imsg:rerender'));
}

// Caption фото юзера через vision
export async function captionUserImage(msgTs, dataUrl) {
    if (!dataUrl || !isExtraLLMConfigured()) return;
    try {
        const raw = await callExtraLLM(
            'Опиши это фото ОДНИМ коротким предложением на русском (макс 20 слов): что/кто, поза, одежда, обстановка. Без вступлений.',
            { images: [dataUrl], maxTokens: 120, temperature: 0.4 }
        );
        const caption = cleanLLMOutput(raw).replace(/^["«]|["»]$/g, '').trim().slice(0, 200);
        if (caption) {
            const s = loadState();
            const msg = (s.messages || []).find(m => m && m.ts === Number(msgTs));
            if (msg) { msg._imgCaption = caption; save(); }
        }
    } catch (e) { console.warn('[iMsg] caption failed:', e); }
}

// ── Парсинг ответа бота из основного чата ST → инжект в телефон ──
// Смотрит новые сообщения персонажа в основном чате и переносит их в переписку телефона.
let _lastSyncedMsgId = null;

export function syncFromMainChat() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return;
        const s = loadState();
        const charName = s.charName || c.name2 || '';

        // Находим новые сообщения от персонажа которые ещё не в телефоне
        const charMsgs = chat.filter(m => !m.is_user && m.mes);
        if (!charMsgs.length) return;

        const lastMain = charMsgs[charMsgs.length - 1];
        // Проверяем по хэшу контента — уже обработали?
        const msgKey = `${lastMain.send_date || ''}::${String(lastMain.mes || '').slice(0, 50)}`;
        if (_lastSyncedMsgId === msgKey) return;

        // Парсим текст РП — есть ли в нём действие написания телефону?
        const raw = String(lastMain.mes || '');
        const hasPhoneAction = /написал[аи]?|напечатал[аи]?|отправил[аи]?|прислал[аи]?|скинул[аи]?/i.test(raw) &&
            /телефон|сообщение|смс|мессенджер|написал в|текст/i.test(raw);

        if (!hasPhoneAction) return;

        const parts = parseRpMessage(raw);
        if (!parts.length) return;

        // Не добавляем дубликаты: проверяем есть ли уже такой текст в последних 3 сообщениях
        const recentTexts = (s.messages || []).slice(-3).map(m => (m.text || '').trim());

        _lastSyncedMsgId = msgKey;
        let added = 0;
        for (const part of parts) {
            if (!part.text && !part.image) continue;
            if (part.text && recentTexts.includes(part.text.trim())) continue;
            pushMessage({ from: 'char', text: part.text || '', deleted: part.deleted || false, _fromMain: true });
            added++;
        }
        if (added > 0) {
            console.log(`[iMsg] syncFromMainChat: добавлено ${added} сообщений из РП`);
            window.dispatchEvent(new CustomEvent('imsg:rerender'));
        }
    } catch (e) {
        console.warn('[iMsg] syncFromMainChat failed:', e);
    }
}

// ── Инжект контекста телефона в основной чат ST ──
export function syncToMainChat() {
    const settings = getSettings();
    if (!settings.injectIntoMain) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }
    const s = loadState();
    const charName = s.charName || 'Персонаж';
    const persona = getUserPersona();
    const userLabel = persona.name || 'User';

    const msgs = (s.messages || []).slice(-20);
    if (!msgs.length) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }

    const lines = [];
    lines.push(`[IMESSAGE — переписка ${charName} и ${userLabel} в телефоне. Ты (${charName}) — ОДИН и тот же человек что и здесь.]`);
    lines.push(`КРИТИЧЕСКИ ВАЖНО: НЕ выдумывай сообщений которых нет ниже. Если хочешь сослаться на переписку — цитируй ТОЛЬКО то что есть.`);
    lines.push('');
    lines.push(`=== ПЕРЕПИСКА В ТЕЛЕФОНЕ (${msgs.length} посл. сообщений) ===`);
    for (const m of msgs) {
        const who = m.from === 'user' ? userLabel : charName;
        const flag = m.deleted ? ' [удалил(а)]' : '';
        const img = m.image ? ' [фото]' : '';
        lines.push(`${who}: ${(m.text || '').slice(0, 300)}${img}${flag}`);
    }
    lines.push('=== КОНЕЦ ===');

    const text = lines.join('\n');
    setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_PROMPT, settings.injectDepth || 4);
    return text;
}

export function clearMainChatInjection() {
    setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
}

export function injectIntoChatCompletion(eventData) {
    try {
        const settings = getSettings();
        if (!settings.injectIntoMain) return;
        const chat = eventData?.chat;
        if (!Array.isArray(chat)) return;
        const text = syncToMainChat();
        if (!text) return;
        const marker = '[IMESSAGE —';
        const already = chat.some(m => typeof m?.content === 'string' && m.content.includes(marker));
        if (already) return;
        const sysMsg = { role: 'system', content: text };
        let insertAt = chat.length;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i]?.role === 'user') { insertAt = i; break; }
        }
        chat.splice(insertAt, 0, sysMsg);
    } catch (e) { console.warn('[iMsg] injectIntoChatCompletion failed:', e); }
}

// ── Авто-ответ по таймеру ──
let _autoTimer = null;

export function scheduleNextAutoReply() {
    const settings = getSettings();
    if (!settings.autoReply?.enabled) return;
    clearAutoReplyTimer();
    const min = (settings.autoReply.minMinutes || 15) * 60 * 1000;
    const max = (settings.autoReply.maxMinutes || 120) * 60 * 1000;
    const delay = min + Math.random() * (max - min);
    const s = loadState();
    s.nextAutoTs = Date.now() + delay;
    save();
    console.log(`[iMsg] Следующий авто-ответ через ${Math.round(delay / 60000)} мин`);
    _autoTimer = setTimeout(async () => {
        try {
            const n = await generateCharReply({ auto: true });
            if (n > 0) window.dispatchEvent(new CustomEvent('imsg:rerender'));
        } catch (e) { console.error('[iMsg] auto-reply failed:', e); }
    }, delay);
}

export function clearAutoReplyTimer() {
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
}

export function resetAutoReplyTimer() {
    clearAutoReplyTimer();
    scheduleNextAutoReply();
}

// ── Достать последние реплики из основного чата ST ──
function getMainChatExcerpt(charName, n = 8) {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return '';
        const tail = chat.slice(-n);
        return tail.map(m => {
            const who = m.is_user ? (c.name1 || 'Я') : (m.name || charName);
            const t = String(m.mes || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
            return `${who}: ${t}`;
        }).filter(l => l.length > 5).join('\n');
    } catch { return ''; }
}
