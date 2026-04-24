// ═══════════════════════════════════════════
// ENGINE — генерация ответов, синхронизация с основным чатом, автосообщения
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, user_avatar, getThumbnailUrl } from '../../../../script.js';
import { getRoster, getCustomAvatar, ensureContactCard, getAllRawDescriptions, findContactIdByName, ensureContactForName } from './roster.js';
import { loadState, pushMessage, getSettings, save, bumpUnread } from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImage, generateImageViaSD, isImageApiConfigured } from './api.js';
import { stickerCatalogForPrompt, findStickerById } from './stickers.js';

const PROMPT_KEY = 'IMESSAGE_EXT';

// ══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ══════════════════════════════════════════════════════════

async function getUserAvatarDataUrl() {
    try {
        const file = (typeof user_avatar === 'string' && user_avatar) ? user_avatar : null;
        if (!file) return null;
        const url = getThumbnailUrl('persona', file);
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

function getUserPersona() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const pu = c.powerUserSettings || {};
        const name = c.name1 || 'User';
        let description = '';
        if (typeof c.substituteParams === 'function') {
            const sub = c.substituteParams('{{persona}}');
            if (sub && sub !== '{{persona}}') description = sub;
        }
        if (!description && pu.personas && pu.persona_descriptions) {
            const avatarId = Object.keys(pu.personas).find(a => pu.personas[a] === name);
            if (avatarId) description = pu.persona_descriptions[avatarId]?.description || '';
        }
        return { name, description: (description || '').trim() };
    } catch (e) {
        return { name: 'User', description: '' };
    }
}

function cleanLLMOutput(text) {
    if (!text) return '';
    let t = String(text);
    t = t.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?(?=\n\n|$)/gi, '');
    t = t.replace(/```(?:think|thinking|reasoning)[\s\S]*?```/gi, '');
    t = t.replace(/\[(?:THINK|THINKING|REASONING)\][\s\S]*?\[\/(?:THINK|THINKING|REASONING)\]/gi, '');
    t = t.replace(/^[А-ЯЁA-Z][а-яёa-zA-Z]+\s*:\s*/, '');
    return t.trim();
}

function sanitizeImagePrompt(p) {
    if (!p) return p;
    let s = String(p);
    const map = [
        [/\b(nsfw|explicit|nude|naked|topless|bottomless)\b/gi, ''],
        [/\b(sex|sexual|sexy|erotic|erotica|porn|hentai)\b/gi, ''],
        [/\b(penis|cock|dick|testicles|balls)\b/gi, ''],
        [/\b(vagina|pussy|clit|labia)\b/gi, ''],
        [/\b(breasts?|boobs?|tits|nipples?)\b/gi, ''],
        [/\b(cum|cumshot|ejaculat\w*)\b/gi, ''],
        [/\b(fucking|fuck|fucked|hardcore)\b/gi, ''],
        [/\b(голый|голая|обнажённ\w*|раздет\w*)\b/gi, ''],
        [/\b(секс\w*|эротик\w*|порн\w*)\b/gi, ''],
        [/\b(член|хуй|пенис)\b/gi, ''],
        [/\b(трах\w*|еба\w*|ёба\w*|ебл\w*)\b/gi, ''],
    ];
    for (const [re, rep] of map) s = s.replace(re, rep);
    s = s.replace(/[,\s]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
    if (s.length > 400) s = s.slice(0, 400);
    return `Tasteful portrait photograph, fully clothed, safe-for-work. ${s}`;
}

async function generateImageWithFallback(prompt, refAvatar) {
    const isRefusal = (err) => {
        const code = (err && err.code) || '';
        const msg = String((err && err.message) || err || '');
        return code === 'IMAGE_REFUSED' || /refus|safety|blocked|prohibit/i.test(msg);
    };

    if (refAvatar) {
        const userRef = await getUserAvatarDataUrl();
        const refs = userRef ? [refAvatar, userRef] : [refAvatar];
        try { return await generateImage(prompt, refs); }
        catch (e) {
            console.warn('[iMessage] step1 refs failed:', e?.message);
            if (!isRefusal(e)) { /* try next */ }
        }
    }

    try { return await generateImage(prompt, null); }
    catch (e) {
        console.warn('[iMessage] step2 no-ref failed:', e?.message);
        if (!isRefusal(e)) {
            try { return await generateImageViaSD(prompt); } catch { throw e; }
        }
    }

    const safe = sanitizeImagePrompt(prompt);
    if (safe) {
        try { return await generateImage(safe, null); }
        catch (e) { console.warn('[iMessage] step3 sanitized failed:', e?.message); }
    }

    return await generateImageViaSD(safe || prompt);
}

function updateMessageByTs(contactId, ts, patch) {
    const s = loadState();
    const list = s.messages?.[contactId];
    if (!list) return;
    const msg = list.find(m => m && m.ts === Number(ts));
    if (!msg) return;
    Object.assign(msg, patch);
    save();
    window.dispatchEvent(new CustomEvent('imessage:rerender', { detail: { contactId } }));
}

function updateGeneratedImage(contactId, genId, patch) {
    const s = loadState();
    const list = s.messages?.[contactId];
    if (!list) return;
    const msg = list.find(m => m && m._genId === genId);
    if (!msg) return;
    Object.assign(msg, patch);
    save();
    window.dispatchEvent(new CustomEvent('imessage:rerender', { detail: { contactId } }));
}

export async function captionUserImage(contactId, msgTs, dataUrl) {
    if (!dataUrl || !isExtraLLMConfigured()) return;
    const prompt = 'Опиши это фото ОДНИМ коротким предложением на русском (макс 20 слов): что/кто на фото, поза, одежда, обстановка. Сразу описание, без вступлений.';
    try {
        const raw = await callExtraLLM(prompt, { images: [dataUrl], maxTokens: 120, temperature: 0.4 });
        const caption = cleanLLMOutput(raw).replace(/^["«]|["»]$/g, '').trim().slice(0, 200);
        if (caption) updateMessageByTs(contactId, msgTs, { _imgCaption: caption });
    } catch (e) {
        console.warn('[iMessage] captionUserImage failed:', e);
    }
}

// ══════════════════════════════════════════════════════════
// КОНТЕКСТ ДЛЯ LLM
// ══════════════════════════════════════════════════════════

// Возвращает блок с сырым описанием ВСЕХ контактов из лорбука
// (кроме активного) — чтобы бот знал отношения между ними.
function buildRelationshipContext(activeContactId, maxOtherChars = 2000) {
    const allDescs = getAllRawDescriptions();
    const lines = [];
    let totalLen = 0;
    for (const [id, info] of Object.entries(allDescs)) {
        if (id === activeContactId) continue;
        if (!info?.description) continue;
        const snippet = info.description.slice(0, 400);
        if (totalLen + snippet.length > maxOtherChars) {
            lines.push(`• ${info.name}: [описание обрезано]`);
            break;
        }
        lines.push(`• ${info.name}:\n${snippet}`);
        totalLen += snippet.length;
    }
    return lines.length ? lines.join('\n\n') : '';
}

// ══════════════════════════════════════════════════════════
// ИЗВЛЕЧЕНИЕ СООБЩЕНИЙ ИЗ ОСНОВНОГО ЧАТА
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// ДЕТЕКТОР RP-АБЗАЦА
// ══════════════════════════════════════════════════════════

// Проверяет, похож ли текст на RP-прозу/нарратив/инструкцию вместо живого SMS.
// Если да — такое НЕ добавляем в iMessage.
// Возвращает причину отказа (строку) или null если ок.
// ВАЖНО: для русских слов нельзя использовать \b — в JS RegExp \b работает только
// для ASCII. Используем явные границы: (?:^|[^а-яёa-z]) и (?=[^а-яёa-z]|$).
function detectRpParagraph(text) {
    if (!text) return 'empty';
    const t = String(text).trim();
    const lower = t.toLowerCase();

    // 1) Слишком длинное — SMS не бывают по 600+ символов сплошняком
    if (t.length > 600) return `too_long(${t.length})`;

    // 2) Инструкции-директивы (assistant-style из RP-бота)
    const directivePatterns = [
        /^(?:respond|reply|answer|write|send|message)\s+(?:to|as|her|him|them|back)/i,
        /^(?:please|давай|напиши|ответь|отправь)\s+(?:respond|reply|answer|ей|ему)/i,
        /\bwe\s+(?:should|must|need\s+to)\b/i,
        /(?:^|[^а-яёa-z])(?:мы|нам)\s+(?:должн[ыа]|нужно|следует)\s+(?:ответить|написать|отправить)/i,
        /^(?:user|пользовател|юзер)\s+(?:asks?|wants?|просит|хочет)/i,
        /\b(?:let'?s|let\s+us)\s+(?:respond|reply|answer)\b/i,
        /(?:^|[^а-яёa-z])давай(?:те)?\s+(?:ответим|напишем)/i,
    ];
    for (const re of directivePatterns) {
        if (re.test(t)) return 'directive';
    }

    // 3) Третье лицо про юзера/контакт — прозаический пересказ событий
    const thirdPersonMarkers = [
        /\b(?:she|he)\s+(?:shared|told|explained|revealed|confessed|mentioned|asked|said|replied|sent|wrote)\b/i,
        /(?:^|[^а-яёa-z])(?:она|он)\s+(?:поделилась?|рассказала?|объяснила?|призналась?|упомянула?|спросила?|сказала?|ответила?|отправила?|написала?|прислала?)/i,
        /\b(?:the\s+user|user\s+(?:is|asks?|wants?|sent))/i,
        /(?:^|[^а-яёa-z])пользовател[ья]\s+(?:пишет|просит|хочет|отправил|спрашивает)/i,
        /\bduring\s+(?:the\s+)?(?:conversation|chat)/i,
        /(?:^|[^а-яёa-z])во\s+время\s+(?:этого\s+)?разговора/i,
        /\b(?:several|multiple|many)\s+times\b/i,
        /(?:^|[^а-яёa-z])(?:несколько|много)\s+раз(?=[^а-яёa-z]|$)/i,
    ];
    let thirdPersonHits = 0;
    for (const re of thirdPersonMarkers) {
        if (re.test(t)) thirdPersonHits++;
    }
    if (thirdPersonHits >= 2) return `third_person(${thirdPersonHits})`;
    // Даже одного хита достаточно если текст длинный
    if (thirdPersonHits >= 1 && t.length > 200) return 'third_person_long';

    // 4) Множество повествовательных предложений подряд (абзац)
    const sentences = t.split(/[.!?]+\s+/).filter(s => s.trim().length > 10);
    if (sentences.length >= 4 && t.length > 300) {
        // 4+ полноценных предложения в длинном тексте — это проза, не SMS
        return `narrative(${sentences.length} sentences)`;
    }

    // 5) Звёздочки-действия (*улыбнулся* etc.) — RP-ремарка
    if (/\*[^*\n]{4,}\*/.test(t)) return 'rp_action_asterisks';

    return null;
}

// ══════════════════════════════════════════════════════════
// ИЗВЛЕЧЕНИЕ СООБЩЕНИЙ ИЗ ОСНОВНОГО ЧАТА
// ══════════════════════════════════════════════════════════

// Парсит ОДНО извлечённое из кавычек сообщение. Если внутри есть теги фото
// ([фото: ...], [photo: ...], [IMG:...], [selfie: ...], [прислал фото: ...])
// — разбивает на последовательность {type: 'text'|'photo', ...}.
// Возвращает массив item'ов. Пустые text-item'ы отфильтровываются.
function splitTextAndPhotos(rawMsg) {
    // Ищем теги фото. Универсальный паттерн — квадратные скобки + ключевое слово.
    // Поддерживаем:
    //   [фото: описание] / [фото "описание"]
    //   [прислал(а) фото: ...]
    //   [photo: ...] / [selfie: ...] / [pic: ...] / [picture: ...]
    //   [IMG:prompt] / [IMG: prompt]
    const photoRegex = /\[(?:фото|селфи|прислал[аи]?\s+(?:фото|селфи|картинку|снимок)|отправил[аи]?\s+(?:фото|селфи|картинку|снимок)|photo|selfie|pic(?:ture)?|image|img|IMG)\s*[:\-–—]?\s*["«"„]?([^\]"»"]*?)["»"]?\]/gi;

    const items = [];
    let lastIdx = 0;
    let m;
    while ((m = photoRegex.exec(rawMsg)) !== null) {
        const before = rawMsg.slice(lastIdx, m.index).trim();
        if (before) items.push({ type: 'text', text: before });
        const prompt = (m[1] || '').trim();
        if (prompt && prompt.length >= 3) {
            items.push({ type: 'photo', prompt });
        }
        lastIdx = m.index + m[0].length;
    }
    const tail = rawMsg.slice(lastIdx).trim();
    if (tail) items.push({ type: 'text', text: tail });

    // Если вообще не нашли тегов — возвращаем исходный текст одним item'ом
    if (!items.length) items.push({ type: 'text', text: rawMsg.trim() });

    return items;
}

// Все варианты открывающих/закрывающих кавычек + их пары.
// Важно: японские 「」 『』 и CJK 【】〈〉《》 часто используются LLM'ами.
// Пары сохраняем строго — нельзя смешивать например " и 」.
const QUOTE_PAIRS = [
    ['"', '"'],
    ['“', '”'],
    ['«', '»'],
    ['„', '"'],
    ['„', '“'],
    ["'", "'"],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['【', '】'],
    ['〈', '〉'],
    ['《', '》'],
];
const OPEN_QUOTES = [...new Set(QUOTE_PAIRS.map(p => p[0]))];
const CLOSE_QUOTES = [...new Set(QUOTE_PAIRS.map(p => p[1]))];
// Escaped для regex character class
const OPEN_Q_RE = OPEN_QUOTES.map(q => q.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')).join('');
const CLOSE_Q_RE = CLOSE_QUOTES.map(q => q.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')).join('');
// Символы, которые НЕ могут быть внутри цитаты (перенос строки или закрывающая кавычка)
const NOT_CLOSE_Q = `[^\\n${CLOSE_Q_RE}]`;

// Проверяет пару кавычек: открывающая→закрывающая допустимая?
function isValidQuotePair(open, close) {
    return QUOTE_PAIRS.some(p => p[0] === open && p[1] === close);
}

// Парсит одну цитату из позиции startIdx. Возвращает { content, endIdx } или null.
function parseQuoteAt(text, startIdx) {
    const ch = text[startIdx];
    if (!OPEN_QUOTES.includes(ch)) return null;
    const validCloses = QUOTE_PAIRS.filter(p => p[0] === ch).map(p => p[1]);
    for (let i = startIdx + 1; i < text.length; i++) {
        if (text[i] === '\n' && i - startIdx > 300) return null; // слишком длинно без закрытия
        if (validCloses.includes(text[i])) {
            return { content: text.slice(startIdx + 1, i), endIdx: i + 1 };
        }
    }
    return null;
}
// Парсит текст из основного чата ST и ищет "виртуальные сообщения".
// Поддерживает три источника цитат:
//   1) "Имя [глагол]: цитата" — явное приписывание
//   2) "Имя прислал фото: цитата" — фото-глагол
//   3) ОРФАННЫЕ цитаты — строки типа 「текст」 или "текст", идущие рядом
//      с упоминанием имени контакта без явного глагола (частый стиль RP)
// Возвращает массив { contactName, items } где items — {type: 'text'|'photo', ...}.
function extractVirtualMessagesFromText(rpText) {
    if (!rpText || typeof rpText !== 'string') return [];

    const ROSTER = getRoster();
    // Мапа всех имён контактов → их name (для нормализации)
    const contactNames = new Set();
    for (const contact of Object.values(ROSTER)) {
        const n = String(contact.name || '').trim();
        if (!n) continue;
        contactNames.add(n.toLowerCase());
        const first = n.split(/\s+/)[0];
        if (first && first.length >= 3) contactNames.add(first.toLowerCase());
    }

    const results = [];
    let text = rpText.replace(/<[^>]+>/g, '');

    // Универсальная цитата в регексе — любая из пар кавычек.
    // ВАЖНО: используем non-greedy + fallback на одну из допустимых закрывающих.
    const Q = `[${OPEN_Q_RE}](${NOT_CLOSE_Q}+?)[${CLOSE_Q_RE}]`;

    // Паттерны — все поддерживают любые кавычки
    const patterns = [
        // RU: Имя [глагол]: «текст»
        new RegExp(
            `([А-ЯЁA-Z][а-яёa-z]+)\\s+(?:написал|написала|пишет|отправил|отправила|печатает|напечатал|напечатала|прислал|прислала|скинул|скинула|шлёт|шлет)(?:\\s+(?:тебе|ей|ему|в\\s+телефон|в\\s+мессенджер|в\\s+(?:i?message|ватсап|whatsapp|телеграм|telegram)|сообщение|фото|селфи|картинку|снимок))*\\s*[:\\-—]\\s*${Q}`,
            'gi'
        ),
        // EN: Name texts/sends/writes/types: "text"
        new RegExp(
            `([A-ZА-ЯЁ][a-zа-яё]+)\\s+(?:texts?|sends?\\s+(?:a\\s+)?(?:text|message|photo|selfie|pic(?:ture)?|image)|writes?|types?|messages?)\\s*[:\\-—]\\s*${Q}`,
            'gi'
        ),
    ];

    // Фото-глаголы: Имя прислал фото: "..."
    const photoVerbRegex = new RegExp(
        `([А-ЯЁA-Z][а-яёa-z]+|[A-ZА-ЯЁ][a-zа-яё]+)\\s+(?:прислал[аи]?|отправил[аи]?|скинул[аи]?|шл[её]т|sends?)(?:\\s+(?:мне|тебе|ей|ему|me|him|her))?\\s+(?:фото|селфи|картинку|снимок|photo|selfie|pic(?:ture)?|image|a\\s+photo|a\\s+selfie|a\\s+pic(?:ture)?)\\s*[:\\-—]?\\s*${Q}`,
        'gi'
    );

    // 1) Чистые фото-реплики
    const photoOnlyMatches = [];
    let pm;
    while ((pm = photoVerbRegex.exec(text)) !== null) {
        photoOnlyMatches.push({
            name: pm[1].trim(),
            prompt: pm[2].trim(),
            start: pm.index,
            end: pm.index + pm[0].length,
        });
    }
    for (const p of photoOnlyMatches) {
        if (p.prompt.length < 3) continue;
        const cleanPrompt = p.prompt.replace(/^\[(?:фото|selfie|photo|pic(?:ture)?|image|IMG)\s*[:\-]?\s*/i, '').replace(/\]$/, '').trim();
        results.push({
            contactName: p.name,
            items: [{ type: 'photo', prompt: cleanPrompt }],
            _explicit: true,  // явный формат «Имя прислал фото: "..."» — можно создавать контакт
        });
    }
    const inPhotoRange = (pos) => photoOnlyMatches.some(p => pos >= p.start && pos < p.end);

    // 2) Обычные text-реплики (Имя глагол: "...")
    const coveredRanges = photoOnlyMatches.map(p => [p.start, p.end]);
    for (const re of patterns) {
        let m;
        while ((m = re.exec(text)) !== null) {
            if (inPhotoRange(m.index)) continue;
            const name = m[1].trim();
            const msg = m[2].trim();
            if (msg.length < 2) continue;

            const items = splitTextAndPhotos(msg);
            const cleanItems = filterItems(items, name);
            if (!cleanItems.length) continue;
            results.push({
                contactName: name,
                items: cleanItems,
                _explicit: true,  // явный формат «Имя texts: "..."» — можно создавать контакт
            });
            coveredRanges.push([m.index, m.index + m[0].length]);
        }
    }

    // 3) ОРФАННЫЕ цитаты — структурный анализ параграфов.
    //
    //    Проходим сверху вниз с «активным контактом»:
    //    — когда встречаем phone-context параграф с именем контакта X →
    //      X становится активным.
    //    — пока идут quote-only параграфы (одна цитата, больше ничего) —
    //      они считаются сообщениями от активного контакта.
    //    — «Второе сообщение прилетело:» и другие phone-маркеры тоже
    //      оставляют X активным.
    //    — первый параграф без phone-context и не quote-only сбрасывает контакт.
    //    — 「」 цитаты всегда считаем сообщениями (ищем ближайшее имя).
    //
    //    В смешанных параграфах (phone-context + текст + цитата) — отдельно
    //    фильтруем цитаты по близости к speech/action-глаголам.
    const inCoveredRange = (pos) => coveredRanges.some(([s, e]) => pos >= s && pos < e);

    const phoneContextRe = /(?:^|[^а-яёa-z])(?:сообщени|уведомлени|экран|телефон|дисплей|мессенджер|i?message|whatsapp|ватсап|telegram|телеграм|чат[ае]?|написал|отправил|прислал|набрал|пишет|набранн|[пП]рилетел)/i;
    const phoneContextReEn = /\b(?:notification|screen|phone|message|text(?:ing)?|texted|texts|messaged|typed|typing|sent|replied|chat|i?message|whatsapp|telegram)\b/i;
    const speechContextRe = /(?:^|[^а-яёa-z])(?:сказал|сказала|ответил|ответила|произнёс|произнес|произнесла|буркнул|буркнула|фыркнул|фыркнула|хмыкнул|хмыкнула|крикнул|крикнула|прошептал|прошептала|проворчал|проворчала|рявкнул|рявкнула)(?=[^а-яёa-z]|$)/i;
    const speechContextReEn = /\b(?:said|whispered|muttered|snapped|shouted|replied)\b/i;
    const actionVerbRe = /(?:^|[^а-яёa-z])(?:вытянул|вытянула|повернул|повернула|повернулся|повернулась|разбло|заглянул|заглянула|перехватил|перехватила|наклонил|наклонила|подошёл|подошла|поднял|подняла|опустил|опустила|посмотрел|посмотрела|взглянул|взглянула|кивнул|кивнула|пожал|пожала|ударил|ударила|схватил|схватила|бубнил|бубнила|глянул|глянула|фыркнул|фыркнула)/i;

    const testPhone = (s) => phoneContextRe.test(s) || phoneContextReEn.test(s);
    const testSpeech = (s) => speechContextRe.test(s) || speechContextReEn.test(s);
    const testAction = (s) => actionVerbRe.test(s);

    const messengerQuoteChars = new Set(['\u300C', '\u300E', '\u3010', '\u3008', '\u300A']);

    // Находит ПОСЛЕДНЕЕ упоминание контакта в строке. Возвращает имя или null.
    // Учитывает русские склонения: «Аякса», «Аяксу», «Аяксом» → все это «Аякс».
    // Проверяет: слово начинается с имени контакта + имеет согласные окончания.
    const findLastMentionedContact = (s) => {
        let last = null;
        let lastPos = -1;
        // Проходим по всем известным именам и ищем их как prefix в словах
        const wordRe = /[А-ЯЁA-Z][а-яёa-zA-Z]+/g;
        let wm;
        while ((wm = wordRe.exec(s)) !== null) {
            const word = wm[0].toLowerCase();
            // Точное совпадение
            if (contactNames.has(word)) {
                if (wm.index > lastPos) {
                    last = wm[0];
                    lastPos = wm.index;
                }
                continue;
            }
            // Проверяем: слово начинается с какого-то имени контакта + имеет короткое
            // русское окончание склонения (до 3 символов). «Аякса», «Аяксу», «Аяксом».
            for (const name of contactNames) {
                if (name.length < 3) continue;
                if (word.startsWith(name) && word.length - name.length <= 3) {
                    // Убедимся что дальше русские буквы, не случайное слияние
                    const suffix = word.slice(name.length);
                    if (/^[а-яё]*$/.test(suffix) && suffix.length <= 3) {
                        if (wm.index > lastPos) {
                            // Возвращаем именно базовое имя (без склонения)
                            // ищем его в оригинальном регистре
                            const capName = name.charAt(0).toUpperCase() + name.slice(1);
                            last = capName;
                            lastPos = wm.index;
                        }
                        break;
                    }
                }
            }
        }
        return last;
    };

    const paragraphs = text.split(/\n\s*\n/);
    let globalOffset = 0;

    // «Активный контакт» — последнее имя которое упомянули в phone-context параграфе
    let activeContact = null;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const para = paragraphs[pIdx];
        const paraStart = globalOffset;
        globalOffset += para.length + 2;
        const paraTrimmed = para.trim();

        // Собираем все цитаты в параграфе
        const quoteRanges = [];
        let quoteBytes = 0;
        {
            let p = 0;
            while (p < para.length) {
                if (OPEN_QUOTES.includes(para[p])) {
                    const parsed = parseQuoteAt(para, p);
                    if (parsed) {
                        quoteBytes += parsed.endIdx - p;
                        quoteRanges.push({ start: p, endIdx: parsed.endIdx, ch: para[p], content: parsed.content });
                        p = parsed.endIdx;
                        continue;
                    }
                }
                p++;
            }
        }

        const hasMessengerQuote = quoteRanges.some(q => messengerQuoteChars.has(q.ch));
        const nonQuoteLen = paraTrimmed.length - quoteBytes;
        const isQuoteOnly = quoteBytes > 0 && nonQuoteLen < Math.max(30, paraTrimmed.length * 0.25);
        const hasPhoneCtx = testPhone(para);

        // ── Обновляем активный контакт ──
        if (hasPhoneCtx) {
            // Параграф с phone-маркером — обновляем активного на последнее упомянутое имя
            const nm = findLastMentionedContact(para);
            if (nm) activeContact = nm;
        } else if (isQuoteOnly && quoteRanges.length > 0) {
            // Quote-only параграф — контакт остаётся активным, не меняем
        } else if (!hasMessengerQuote && !isQuoteOnly) {
            // Параграф с нарративом без phone-context — сбрасываем активного
            // (кроме случая когда он 「」-only — их ловим в любом случае)
            activeContact = null;
        }

        if (!quoteRanges.length) continue;

        // ── Решаем какому контакту принадлежат цитаты ──
        let contactForQuotes = activeContact;

        // Если в параграфе 「」-цитаты, а активного контакта нет — ищем в параграфе
        if (!contactForQuotes && hasMessengerQuote) {
            contactForQuotes = findLastMentionedContact(para)
                || findLastMentionedContact(pIdx > 0 ? paragraphs[pIdx - 1] : '')
                || findLastMentionedContact(pIdx > 1 ? paragraphs[pIdx - 2] : '');
        }
        if (!contactForQuotes) continue;

        // ── Обрабатываем каждую цитату ──
        for (const qr of quoteRanges) {
            const globalPos = paraStart + qr.start;
            if (inCoveredRange(globalPos)) continue;
            const content = qr.content.trim();
            if (content.length < 2) continue;
            const isMsgQ = messengerQuoteChars.has(qr.ch);

            let shouldAdd = false;
            let reason = '';

            if (isMsgQ) {
                // 「」 цитаты — всегда сообщения мессенджера
                shouldAdd = true;
                reason = 'messenger_quote';
            } else if (isQuoteOnly) {
                // Параграф из одних цитат — все цитаты это сообщения
                shouldAdd = true;
                reason = 'quote_only_para';
            } else if (hasPhoneCtx) {
                // Смешанный phone-context параграф — проверяем окрестность
                const before = para.slice(Math.max(0, qr.start - 100), qr.start);
                const after = para.slice(qr.endIdx, Math.min(para.length, qr.endIdx + 100));
                const hasBadNear = testSpeech(before) || testSpeech(after) || testAction(before) || testAction(after);
                if (!hasBadNear) {
                    shouldAdd = true;
                    reason = 'phone_para_clean_quote';
                }
            }
            // Иначе не добавляем

            if (!shouldAdd) continue;

            const items = splitTextAndPhotos(content);
            const cleanItems = filterItems(items, contactForQuotes);
            if (cleanItems.length) {
                results.push({ contactName: contactForQuotes, items: cleanItems });
                coveredRanges.push([globalPos, paraStart + qr.endIdx]);
            }
        }
    }

    return results;
}

// Фильтрует items через detectRpParagraph. Text проверяется, photo пропускаются.
function filterItems(items, contactName) {
    const cleanItems = [];
    for (const it of items) {
        if (it.type === 'text') {
            if (!it.text || it.text.length < 2) continue;
            const reason = detectRpParagraph(it.text);
            if (reason) {
                console.warn(`[iMessage] парсер отбросил текст от ${contactName}: ${reason}. Текст: "${it.text.slice(0, 80)}..."`);
                continue;
            }
            cleanItems.push(it);
        } else {
            cleanItems.push(it);
        }
    }
    return cleanItems;
}

// ══════════════════════════════════════════════════════════
// LLM-КЛАССИФИКАТОР RP-СООБЩЕНИЯ
// ══════════════════════════════════════════════════════════

// Быстрая эвристика: стоит ли вообще запускать LLM на этом тексте?
// Если нет ни цитат, ни phone-маркеров, ни упоминаний контактов — пропускаем.
function rpTextWorthAnalyzing(text) {
    if (!text || text.length < 20) return false;
    // Есть цитаты?
    const hasQuotes = /["\u201C\u201D«»\u300C\u300D\u300E\u300F„"'‘’]/.test(text);
    if (!hasQuotes) return false;
    // Хотя бы один phone-маркер ИЛИ имя контакта?
    const phoneOrName = /(?:сообщени|уведомлени|экран|телефон|мессенджер|i?message|telegram|телеграм|whatsapp|ватсап|написал|отправил|прислал|пишет|набрал|texts?|messaged|typed|phone|screen|notification)/i;
    if (phoneOrName.test(text)) return true;
    // Или упоминание любого известного контакта
    const ROSTER = getRoster();
    for (const contact of Object.values(ROSTER)) {
        const n = String(contact.name || '').trim();
        if (!n || n.length < 3) continue;
        // Простое substring-совпадение (без regex чтобы не зависеть от word boundaries)
        if (text.includes(n)) return true;
    }
    return false;
}

// LLM-классификатор: извлекает iMessage-сообщения из RP-текста.
// Возвращает массив { contactName, items } в том же формате что regex-парсер.
// Возвращает null если LLM не настроен или произошла ошибка.
async function extractViaLLM(rpText, botName = '', prevText = '') {
    if (!isExtraLLMConfigured()) return null;
    if (!rpText || typeof rpText !== 'string') return null;

    // Имена известных контактов для подсказки LLM
    const ROSTER = getRoster();
    const knownNames = Object.values(ROSTER).map(c => c.name).filter(Boolean);

    const persona = getUserPersona();
    const userLabel = persona.name || 'user';

    // Обрезаем слишком длинные RP-тексты (>3000 симв) чтобы не жрать токены
    const textForAnalysis = rpText.length > 3000 ? rpText.slice(0, 3000) : rpText;
    const prevContext = prevText ? prevText.slice(-500) : '';

    const prompt = `You are a precise classifier. Your ONLY job: determine if a character sent a PHONE MESSAGE (iMessage/SMS/Telegram/WhatsApp) to the user "${userLabel}" in this RP text.

CONTEXT:
- The narrator/bot currently playing is: "${botName || 'unknown'}"
- Known characters in ${userLabel}'s address book: ${knownNames.length ? knownNames.join(', ') : '(none)'}
- ${userLabel} is the player/user. Messages must be addressed TO them personally.

${prevContext ? `═══ PREVIOUS RP MESSAGE (for context only, do NOT extract from here) ═══
${prevContext}
═══════════════════════════════════════════════════════════════════════

` : ''}═══ CURRENT RP MESSAGE (extract ONLY from this) ═══
${textForAnalysis}
════════════════════════════════════════════════════

STEP-BY-STEP ANALYSIS (do this mentally, do not output):
1. Is there any mention of a phone, messenger, texting, notification, or screen in the current message?
   → If NO: return {"messages":[]}
2. Does a character physically type/send a message via phone TO ${userLabel}?
   → Face-to-face speech ("said", "whispered", "сказал") is NOT a phone message.
   → Reading someone else's old message aloud is NOT a new phone message.
   → A character THINKING about texting but not doing it is NOT a phone message.
3. WHO is the actual sender? Be very careful:
   → If the narrator (${botName || 'bot'}) describes "${botName} написал в телефон: ..." → sender is ${botName}.
   → If the narrator writes "Ajax texted: ..." inside ${botName}'s narration → sender is Ajax, NOT ${botName}.
   → If ${botName} QUOTES or READS ALOUD a message from Ajax → this is NOT a new message. SKIP.
   → If ${botName} FORWARDS or SHOWS ${userLabel} a message from someone → SKIP (it's not sent via messenger to ${userLabel}).
4. WHO is the recipient?
   → ONLY extract if the message is sent TO ${userLabel}'s phone.
   → If NPC_A texts NPC_B → SKIP entirely.
   → If the narrator describes "Ajax texted Cole: ..." → SKIP (not to ${userLabel}).
5. Is there ACTUAL quoted content (the literal text typed)?
   → If narrator only paraphrases ("he sent something mean") with no quote → SKIP.
   → Extract the EXACT text inside quotes, not the narrator's description.

Return STRICT JSON (no markdown, no \`\`\`, no comments):
{
  "messages": [
    { "from": "SenderName", "type": "text", "text": "exact message content" },
    { "from": "SenderName", "type": "photo", "prompt": "english photo description for image gen, 10-25 words" }
  ]
}

FINAL RULES:
- Return { "messages": [] } if nothing qualifies. When in doubt — SKIP. False negatives are better than false positives.
- "from" = the person who TYPED the message (base form, no case suffixes: «Аяксу» → "Аякс").
- Preserve original language and punctuation of the message text.
- For photos/selfies sent via messenger: use type="photo" with English description.
- Multiple messages from same sender → separate entries in order.`;

    let raw;
    try {
        raw = await callExtraLLM(prompt, { temperature: 0.2, maxTokens: 800 });
    } catch (e) {
        console.warn('[iMessage] LLM parser failed:', e);
        return null;
    }

    // Очистка + парс JSON
    let txt = cleanLLMOutput(raw);
    txt = txt.replace(/```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const jsonMatch = txt.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.warn('[iMessage] LLM парсер не вернул JSON. Ответ:', txt.slice(0, 200));
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.warn('[iMessage] LLM парсер вернул невалидный JSON:', e.message);
        return null;
    }

    if (!parsed || !Array.isArray(parsed.messages)) return [];

    // Группируем по contactName для совместимости с regex-форматом
    const grouped = {};
    for (const msg of parsed.messages) {
        const name = String(msg.from || '').trim();
        if (!name || name.length < 2) continue;
        if (!grouped[name]) grouped[name] = [];

        if (msg.type === 'photo') {
            const prompt = String(msg.prompt || '').trim();
            if (prompt && prompt.length >= 3) {
                grouped[name].push({ type: 'photo', prompt });
            }
        } else {
            const text = String(msg.text || '').trim();
            if (text && text.length >= 2) {
                // RP-фильтр — отбросим сгенерённую модель-прозу на всякий случай
                const reason = detectRpParagraph(text);
                if (reason) {
                    console.warn(`[iMessage] LLM-парсер вернул подозрительное: ${reason}. Текст: "${text.slice(0, 80)}"`);
                    continue;
                }
                grouped[name].push({ type: 'text', text });
            }
        }
    }

    const results = [];
    for (const [name, items] of Object.entries(grouped)) {
        if (items.length) results.push({ contactName: name, items, _explicit: true });
    }
    return results;
}

// ══════════════════════════════════════════════════════════
// LLM-САММАРИ ПЕРЕПИСКИ
// ══════════════════════════════════════════════════════════

// Вызывает LLM через API выбранный для саммари. Если summaryApi.enabled=false —
// используется общий extraApi через callExtraLLM. Иначе — отдельный endpoint.
async function callSummaryLLM(prompt, opts = {}) {
    const s = getSettings();
    const sa = s.summaryApi || {};
    if (!sa.enabled) {
        // Общий API
        return await callExtraLLM(prompt, opts);
    }
    // Отдельный API — нужно проверить что он настроен
    const ep = String(sa.endpoint || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
    if (!ep || !sa.apiKey || !sa.model) {
        // Отдельный API включён но не настроен — fallback на общий
        console.warn('[iMessage] summaryApi enabled но не настроен, fallback на extraApi');
        return await callExtraLLM(prompt, opts);
    }
    // Прямой fetch (такой же как в api.js но для отдельного endpoint)
    const url = `${ep}/v1/chat/completions`;
    const body = {
        model: sa.model,
        messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
        ],
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 500,
    };
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sa.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Summary API HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

// Проверяет сконфигурирован ли какой-то LLM для саммари
function isSummaryLLMAvailable() {
    const s = getSettings();
    const sa = s.summaryApi || {};
    if (sa.enabled) {
        const ep = String(sa.endpoint || '').trim().replace(/\/+$/, '');
        if (ep && sa.apiKey && sa.model) return true;
    }
    return isExtraLLMConfigured();
}

// Генерирует саммари переписки для контакта. Вызывается когда переписка
// превысила порог обновления (summaryRefreshEvery).
async function generateConversationSummary(contactId) {
    if (!isSummaryLLMAvailable()) return null;
    const ROSTER = getRoster();
    const contact = ROSTER[contactId];
    if (!contact) return null;
    const s = loadState();
    const msgs = s.messages?.[contactId] || [];
    if (msgs.length < 10) return null; // слишком короткая — не нужно саммари

    const persona = getUserPersona();
    const userLabel = persona.name || 'user';

    // Собираем текст переписки — с датами для хронологии
    const convText = msgs.map(m => {
        const who = m.from === 'user' ? userLabel : contact.name;
        const flag = m.deleted ? ' [потом удалено]' : '';
        const img = m.image ? ' [фото]' : (m._imgPrompt ? ` [фото: ${m._imgPrompt.slice(0, 60)}]` : '');
        const stk = m.sticker
            ? ` [стикер: ${m.sticker.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ')}]`
            : '';
        const time = m.ts ? new Date(m.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return `[${time}] ${who}: ${(m.text || '').slice(0, 200)}${img}${stk}${flag}`;
    }).join('\n');

    // Предыдущее саммари — для итеративного дополнения
    const prevSummary = (s.summaries?.[contactId]?.text || '').trim();

    const prompt = `Ты ведёшь хронологический дневник переписки между ${userLabel} и ${contact.name} в iMessage.

${prevSummary ? `ПРЕДЫДУЩЕЕ САММАРИ (покрывает более ранние сообщения):
${prevSummary}

ЗАДАЧА: дополни/обнови саммари с учётом НОВЫХ сообщений ниже. Если что-то изменилось (помирились, поссорились, тема сменилась) — обнови соответствующий пункт и добавь новый. Не удаляй старые пункты если они всё ещё релевантны.

` : ''}ПЕРЕПИСКА:
${convText}

Напиши саммари ПО-РУССКИ в хронологическом формате. Каждый пункт — отдельное событие/этап переписки с примерной датой:

Формат:
[ДД.ММ] Краткое описание что произошло
[ДД.ММ] Следующее событие
...
→ Текущий статус: (одно предложение — какие сейчас отношения, что ожидает ответа)

ПРАВИЛА:
— 5-15 пунктов максимум. Группируй мелочи, оставляй важное.
— Важное: ссоры, примирения, признания, смена тона, важные решения, фото, игнор.
— Неважное (можно пропустить): "привет-привет", мелкие реплики без значения.
— Если юзер игнорировал контакт — отметь это ("${userLabel} не отвечает с ДД.ММ").
— Если отношения менялись — покажи динамику: "поссорились → молчали 2 дня → ${contact.name} написал первым → помирились".
— Последняя строка (→ Текущий статус) — самое важное, это то что видят другие системы.
— Без markdown, без вступлений, сразу пункты.`;

    try {
        const raw = await callSummaryLLM(prompt, { temperature: 0.5, maxTokens: 700 });
        const summary = cleanLLMOutput(raw).replace(/^["«»\s]+|["«»\s]+$/g, '').trim();
        if (summary && summary.length >= 20) return summary;
        return null;
    } catch (e) {
        console.warn('[iMessage] summary gen failed:', e);
        return null;
    }
}

// Возвращает актуальное саммари переписки (из кэша или генерит новое).
// Обновление в фоне если устарело.
async function getOrRefreshSummary(contactId) {
    const s = loadState();
    const contact = getRoster()[contactId];
    if (!contact) return null;
    const msgs = s.messages?.[contactId] || [];
    if (msgs.length < 10) return null;

    if (!s.summaries) s.summaries = {};
    const cached = s.summaries[contactId];
    const settings = getSettings();
    const refreshEvery = settings.summaryRefreshEvery || 15;

    // Свежее саммари есть? (прошло меньше N сообщений с последней генерации)
    if (cached && msgs.length - (cached.msgCountAtGen || 0) < refreshEvery) {
        return cached.text;
    }

    // Устарело или нет — генерим в фоне. Возвращаем пока старое (если есть).
    if (!_summaryGenRunning[contactId]) {
        _summaryGenRunning[contactId] = true;
        generateConversationSummary(contactId)
            .then(newSummary => {
                if (newSummary) {
                    const state = loadState();
                    if (!state.summaries) state.summaries = {};
                    state.summaries[contactId] = {
                        text: newSummary,
                        msgCountAtGen: msgs.length,
                        ts: Date.now(),
                    };
                    save();
                    console.log(`[iMessage] саммари обновлено для ${contact.name} (${msgs.length} сообщ.)`);
                }
            })
            .catch(e => console.warn('[iMessage] summary refresh failed:', e))
            .finally(() => { _summaryGenRunning[contactId] = false; });
    }

    return cached?.text || null;
}
const _summaryGenRunning = {};

// Запускает обновление саммари всех активных переписок. Вызывается периодически.
export function refreshAllSummaries() {
    const s = loadState();
    const ROSTER = getRoster();
    for (const [contactId, msgs] of Object.entries(s.messages || {})) {
        if (!ROSTER[contactId] || !Array.isArray(msgs) || msgs.length < 10) continue;
        getOrRefreshSummary(contactId).catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════
// RP-СОБЫТИЯ — отдельное саммари всего основного чата.
// Видно всем контактам (они «в курсе» что происходит в реальной жизни).
// ══════════════════════════════════════════════════════════

// Генерирует саммари событий из основного RP-чата.
// Принимает весь chat (или его хвост) и возвращает сжатое описание.
export async function generateRpSummary() {
    if (!isSummaryLLMAvailable()) {
        throw new Error('LLM не настроен (ни для саммари, ни основной extraApi)');
    }
    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    const chat = c.chat || [];
    if (!chat.length) throw new Error('RP-чат пуст');

    const persona = getUserPersona();
    const userLabel = persona.name || c.name1 || 'user';
    const botName = c.name2 || 'Narrator';

    // Берём последние 100 сообщений (или всё если меньше) — не делаем саммари всего
    // огромного чата, это дорого. Предыдущее саммари можно использовать как основу
    // (iterative summarization), но пока простой вариант.
    const maxMsgs = 100;
    const tail = chat.slice(-maxMsgs);
    const olderCount = Math.max(0, chat.length - tail.length);

    const state = loadState();
    const prevSummary = (state.rpSummary?.text || '').trim();

    // Собираем текст
    const chatText = tail.map(m => {
        const who = m.is_user ? userLabel : (m.name || botName);
        const t = String(m.mes || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        // Ограничиваем длину одного сообщения чтобы не раздуть промпт
        return `${who}: ${t.slice(0, 500)}`;
    }).filter(l => l.length > 10).join('\n');

    const prompt = `Сделай краткое саммари СОБЫТИЙ из ролевой игры. Это нужно чтобы персонажи-контакты в мессенджере ${userLabel} были в курсе что происходит в её реальной жизни.

${prevSummary ? `Предыдущее саммари (на момент когда было ${state.rpSummary?.msgCountAtGen || 0} сообщ. в чате):
${prevSummary}

` : ''}${olderCount > 0 ? `(В чате ещё ${olderCount} более старых сообщений до этого фрагмента — они не показаны. Учти их только через предыдущее саммари выше.)\n\n` : ''}СВЕЖИЙ КУСОК RP (от старых к новым):
${chatText}

Напиши обновлённое саммари на русском: 5-15 строк. Формат — список фактов/событий, по хронологии.
— Где находится ${userLabel} и с кем
— Что произошло недавно (встречи, свидания, ссоры, решения)
— Эмоциональное состояние ${userLabel}
— Открытые сюжетные линии / ожидаемые события
— Важные люди/места которые упоминались

Только саммари фактов. Без оценок, без «вот саммари», без markdown. Если в тексте мат — не цензурь, сохраняй атмосферу.`;

    const raw = await callSummaryLLM(prompt, { temperature: 0.4, maxTokens: 700 });
    const summary = cleanLLMOutput(raw).replace(/^["«»\s]+|["«»\s]+$/g, '').trim();
    if (!summary || summary.length < 20) {
        throw new Error('LLM вернул слишком короткий текст');
    }

    // Сохраняем
    const st = loadState();
    st.rpSummary = {
        text: summary,
        msgCountAtGen: chat.length,
        ts: Date.now(),
        manualEdit: false,
    };
    save();
    console.log(`[iMessage] RP-саммари сгенерировано (${summary.length} симв, для ${chat.length} сообщ.)`);
    try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}
    return summary;
}

// Ручное сохранение отредактированного RP-саммари
export function saveManualRpSummary(text) {
    const st = loadState();
    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    st.rpSummary = {
        text: String(text || '').trim(),
        msgCountAtGen: (c.chat || []).length,
        ts: Date.now(),
        manualEdit: true,
    };
    save();
    console.log('[iMessage] RP-саммари сохранено вручную');
    try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}
}

// Очистка RP-саммари
export function clearRpSummary() {
    const st = loadState();
    st.rpSummary = { text: '', msgCountAtGen: 0, ts: 0, manualEdit: false };
    save();
    try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}
}

// Возвращает текущий текст RP-саммари (для инжекта в промпт контакта)
export function getRpSummary() {
    const st = loadState();
    return (st.rpSummary?.text || '').trim();
}

// Авто-обновление RP-саммари — вызывается периодически (из syncFromMainChat).
// Генерит в фоне если прошло достаточно новых RP-сообщений.
let _rpSummaryGenRunning = false;
export async function autoRefreshRpSummary() {
    const settings = getSettings();
    if (!settings.autoRpSummary) return;
    if (!isSummaryLLMAvailable()) return;
    if (_rpSummaryGenRunning) return;

    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    const chat = c.chat || [];
    if (chat.length < 10) return;

    const st = loadState();
    const rp = st.rpSummary || {};
    const refreshEvery = settings.rpSummaryRefreshEvery || 20;

    // Если ручная правка — не перезаписываем автоматом
    if (rp.manualEdit && rp.text) return;

    // Достаточно ли новых сообщений?
    const msgsSinceLast = chat.length - (rp.msgCountAtGen || 0);
    if (msgsSinceLast < refreshEvery) return;

    _rpSummaryGenRunning = true;
    console.log(`[iMessage] авто-RP-саммари: ${msgsSinceLast} новых сообщений, генерирую...`);

    generateRpSummary()
        .then(text => {
            console.log(`[iMessage] авто-RP-саммари обновлено (${(text || '').length} симв)`);
        })
        .catch(e => {
            console.warn('[iMessage] авто-RP-саммари failed:', e);
        })
        .finally(() => {
            _rpSummaryGenRunning = false;
        });
}

// Принудительное обновление саммари одного контакта (ручное)
export async function forceRefreshContactSummary(contactId) {
    if (!isSummaryLLMAvailable()) throw new Error('LLM для саммари не настроен');
    const summary = await generateConversationSummary(contactId);
    if (summary) {
        const state = loadState();
        if (!state.summaries) state.summaries = {};
        const msgs = state.messages?.[contactId] || [];
        state.summaries[contactId] = {
            text: summary,
            msgCountAtGen: msgs.length,
            ts: Date.now(),
        };
        save();
        try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}
        return summary;
    }
    throw new Error('LLM вернул пустое саммари');
}


// Ищет в основном чате ST новые сообщения-триггеры и добавляет их
// как реальные сообщения в iMessage от имени соответствующего контакта.
// Если контакта с таким именем ещё нет — создаёт его автоматически.
// Использует LLM-классификатор (если useLLMParser=true) — дорого по токенам,
// но точно. Regex остаётся как fallback.
export async function syncFromMainChat() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return 0;

        const state = loadState();
        const lastIdx = state.lastSyncedMainMsgIdx ?? -1;
        const settings = getSettings();

        let pushed = 0;
        for (let i = lastIdx + 1; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            const text = String(msg.mes || '');

            // Выбор парсера: LLM (если включён и стоит тратить токены) либо regex
            let extracted = [];
            const botName = msg.name || c.name2 || '';
            const prevText = i > 0 ? String(chat[i - 1]?.mes || '').slice(-500) : '';
            if (settings.useLLMParser !== false && isExtraLLMConfigured() && rpTextWorthAnalyzing(text)) {
                const llmResult = await extractViaLLM(text, botName, prevText);
                if (llmResult !== null) {
                    extracted = llmResult;
                    if (extracted.length) console.log(`[iMessage] LLM-парсер: ${extracted.length} групп сообщений`);
                } else {
                    // LLM упал — fallback на regex
                    extracted = extractVirtualMessagesFromText(text);
                    if (extracted.length) console.log(`[iMessage] regex-fallback: ${extracted.length} групп`);
                }
            } else {
                extracted = extractVirtualMessagesFromText(text);
                if (extracted.length) console.log(`[iMessage] regex-парсер: ${extracted.length} групп`);
            }
            for (const rec of extracted) {
                // Ищем существующего ИЛИ создаём нового контакта автоматом
                let contactId = findContactIdByName(rec.contactName);
                if (!contactId) {
                    // Только для явных сообщений (rec._explicit) создаём контакт.
                    // Для orphan-режима (где имя угадано по контексту) — только существующие.
                    if (rec._explicit) {
                        contactId = ensureContactForName(rec.contactName);
                    } else {
                        continue;
                    }
                }
                if (!contactId) continue;

                const msgs = state.messages?.[contactId] || [];
                const recent = msgs.slice(-6);

                for (const item of rec.items) {
                    if (item.type === 'text') {
                        // Дедуп по тексту в последних 6 сообщениях
                        const dup = recent.some(m => m.from === 'contact' && m.text === item.text);
                        if (dup) continue;
                        pushMessage(contactId, { from: 'contact', text: item.text, _fromMainChat: true });
                        if (state.openContactId !== contactId) bumpUnread(contactId);
                        pushed++;
                        console.log(`[iMessage] синк из RP (text): ${rec.contactName} → "${item.text.slice(0, 40)}"`);
                    } else if (item.type === 'photo') {
                        // Дедуп по _imgPrompt (если такой же промпт уже был в последних сообщениях — пропускаем)
                        const dupPhoto = recent.some(m => m.from === 'contact' && m._imgPrompt === item.prompt);
                        if (dupPhoto) continue;

                        const genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                        pushMessage(contactId, {
                            from: 'contact',
                            text: '',
                            image: '',
                            _generating: true,
                            _imgPrompt: item.prompt,
                            _genId: genId,
                            _fromMainChat: true,
                        });
                        if (state.openContactId !== contactId) bumpUnread(contactId);
                        pushed++;
                        console.log(`[iMessage] синк из RP (photo): ${rec.contactName} → генерю "${item.prompt.slice(0, 60)}..."`);

                        // Асинхронная генерация картинки — точно такая же логика как
                        // в generateContactReply. Если image API не настроен — fallback /sd.
                        (async (cId, gId, prompt) => {
                            try {
                                const useRef = getSettings().useAvatarAsRef !== false;
                                const refAvatar = useRef ? (getCustomAvatar(cId) || null) : null;
                                const dataUrl = await generateImageWithFallback(prompt, refAvatar);
                                updateGeneratedImage(cId, gId, { image: dataUrl, _generating: false });
                            } catch (err) {
                                console.warn('[iMessage] photo from RP failed:', err);
                                updateGeneratedImage(cId, gId, {
                                    image: '',
                                    text: `[фото не загрузилось: ${String(err.message || err).slice(0, 60)}]`,
                                    _generating: false,
                                });
                            }
                        })(contactId, genId, item.prompt);
                    }
                }
            }
        }

        state.lastSyncedMainMsgIdx = chat.length - 1;
        save();
        if (pushed > 0) {
            window.dispatchEvent(new CustomEvent('imessage:rerender'));
        }

        // Авто-обновление RP-саммари (в фоне, не блокирует)
        try { autoRefreshRpSummary(); } catch {}

        return pushed;
    } catch (e) {
        console.warn('[iMessage] syncFromMainChat failed:', e);
        return 0;
    }
}

// ══════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ОТВЕТА КОНТАКТА
// ══════════════════════════════════════════════════════════

export async function generateContactReply(contactId, opts = {}) {
    if (!isExtraLLMConfigured()) {
        console.warn('[iMessage] Extra API не настроен');
        return 0;
    }
    const ROSTER = getRoster();
    const contact = ROSTER[contactId];
    if (!contact) return 0;

    try { await ensureContactCard(contactId); } catch {}

    const s = loadState();
    const history = (s.messages[contactId] || []).slice(-40);
    const persona = getUserPersona();
    const userLabel = persona.name || 'Я';

    const historyText = history.map((m, idx) => {
        const who = m.from === 'user' ? userLabel : contact.name;
        const flag = m.deleted ? ' [удалил потом]' : '';
        const stickerMark = m.sticker
            ? ` [стикер: ${m.sticker.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ')}]`
            : '';
        let img = '';
        if (m.image || m._imgPrompt) {
            if (m.from === 'user') {
                img = m._imgCaption ? ` [прислал фото: ${m._imgCaption}]` : ' [прислал фото]';
            } else {
                img = m._imgPrompt ? ` [прислал фото: ${m._imgPrompt}]` : ' [прислал фото]';
            }
        }
        let gap = '';
        const prev = idx > 0 ? history[idx - 1] : null;
        if (prev?.ts && m.ts) {
            const diffMs = m.ts - prev.ts;
            const hours = Math.floor(diffMs / 3600000);
            if (hours >= 24) {
                const days = Math.floor(hours / 24);
                gap = `--- прошло ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} ---\n`;
            } else if (hours >= 1) {
                gap = `--- прошло ${hours} ${hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'} ---\n`;
            }
        }
        return `${gap}${who}: ${m.text || ''}${img}${stickerMark}${flag}`;
    }).join('\n');

    const settings = getSettings();
    const includePersonaDesc = settings.includePersonaDescription !== false;
    const profile = settings.profile || {};
    const profileLines = [];
    if (profile.name) profileLines.push(`имя: ${profile.name}`);
    if (profile.extraBio) profileLines.push(`о себе: ${profile.extraBio}`);
    const profileBlock = profileLines.length ? `Анкета:\n${profileLines.join('\n')}\n` : '';
    const personaBlock = ((includePersonaDesc && persona.description) || profileBlock)
        ? `\nО СОБЕСЕДНИКЕ (${userLabel}):\n${profileBlock}${(includePersonaDesc && persona.description) ? persona.description : ''}\n`
        : '';

    // Контекст из основного чата ST — недавние сообщения
    const stExcerpt = getMainChatExcerpt(contact.name, 8);
    const encounterBlock = stExcerpt
        ? `\nПАРАЛЛЕЛЬНО ВЫ ОБЩАЕТЕСЬ ВНЕ МЕССЕНДЖЕРА (например, лично, по видеосвязи, в другом месте — понимай из текста). Это ТЫ (${contact.name}) и ${userLabel}, та же пара:\n${stExcerpt}\n`
        : '';

    // Сырое описание — ПЕРВОИСТОЧНИК
    let rawDesc = contact._rawDescription || '';
    if (rawDesc) {
        try {
            const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
            if (typeof c.substituteParams === 'function') rawDesc = c.substituteParams(rawDesc);
        } catch {}
    }
    const lorebookBlock = rawDesc
        ? `\nПОЛНОЕ ОПИСАНИЕ ${contact.name.toUpperCase()} (из лорбука — твоя биография, характер, факты. Это ТЫ.):\n${rawDesc}\n`
        : '';

    // Отношения с другими персонажами лорбука
    const relationsBlock = buildRelationshipContext(contactId);
    const relationsSection = relationsBlock
        ? `\nДРУГИЕ ЛЮДИ, КОТОРЫХ ТЫ ЗНАЕШЬ (друзья, враги, коллеги, родня — из того же лорбука). Ты в курсе кто это и как к ним относишься:\n${relationsBlock}\n`
        : '';

    // RP-саммари — что происходит в реальной жизни юзера. Все контакты в курсе.
    const rpSum = getRpSummary();
    const rpSummarySection = rpSum
        ? `\nЧТО ПРОИСХОДИТ В ЖИЗНИ ${userLabel.toUpperCase()} (ты в курсе этих событий — услышал, увидел, узнал, или ${userLabel} тебе рассказывала):\n${rpSum}\n`
        : '';

    const isAutoInitiated = opts.autoInitiated === true;
    const autoHint = isAutoInitiated
        ? `\n\nКОНТЕКСТ: Ты пишешь ${userLabel} САМ, по своей инициативе. С последнего сообщения прошло какое-то время. Напиши то, что ЕСТЕСТВЕННО для тебя в таком случае — может вспомнил о чём-то, что-то произошло, или просто захотел написать. Не начинай с "привет", если вы и так в переписке — просто продолжай как в реальности.`
        : '';

    // Если это повторная попытка после того как все части были отфильтрованы —
    // усиливаем требование в промпте.
    const retryHint = opts._isRetry
        ? `\n\n⚠ ПОВТОРНАЯ ПОПЫТКА: предыдущий твой ответ был в формате RP-абзаца/прозы и был ОТКЛОНЁН. Сейчас пиши МАКСИМАЛЬНО КОРОТКО — 1-3 коротких предложения как в реальном SMS. Только от первого лица. Никакого пересказа событий, никакого третьего лица, никаких действий в звёздочках.`
        : '';

    // Язык, на котором бот ДОЛЖЕН писать в мессенджере. По умолчанию русский.
    // Нужен потому что лорбуки часто на английском и модель без явного указания
    // начинает отвечать на английском.
    const langRaw = (settings.messageLanguage || 'russian').toLowerCase();
    const langMap = {
        russian: { name: 'русском', instr: 'ПИШИ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ, даже если описание персонажа на английском.' },
        english: { name: 'английском', instr: 'Write ONLY in English.' },
        japanese: { name: 'японском', instr: '日本語でのみ書いてください。' },
        spanish: { name: 'испанском', instr: 'Escribe SOLO en español.' },
        french: { name: 'французском', instr: 'Écris UNIQUEMENT en français.' },
        german: { name: 'немецком', instr: 'Schreibe NUR auf Deutsch.' },
        chinese: { name: 'китайском', instr: '只用中文写。' },
        korean: { name: 'корейском', instr: '한국어로만 쓰세요.' },
    };
    const langCfg = langMap[langRaw] || langMap.russian;
    const languageLine = `\n— ЯЗЫК СООБЩЕНИЙ: ${langCfg.instr}`;

    const prompt = `Ты ${contact.name} в мессенджере (iMessage). Переписка с ${userLabel}.

${lorebookBlock}${relationsSection}${rpSummarySection}
КАК ТЫ ПИШЕШЬ В МЕССЕНДЖЕРЕ: ${contact.styleNote || 'обычный темп'}${personaBlock}${encounterBlock}
ПЕРЕПИСКА В iMessage:
${historyText || '(переписки ещё не было — это твоё первое сообщение)'}${autoHint}${retryHint}

ЗАДАЧА: напиши следующее сообщение(я) от лица ${contact.name}.

═══ ЭТО МЕССЕНДЖЕР, А НЕ КНИГА И НЕ RP-СЦЕНА ═══
Ты набираешь текст пальцами в iMessage. Только то, что реально отправляют в SMS живые люди.

❌ НЕЛЬЗЯ (это RP, а не SMS):
— «Она поделилась своей историей о том, как отец-алкоголик критиковал её в детстве. Во время разговора она несколько раз повторила, что чувствует себя сломленной.»
— «*улыбается* рад тебя слышать *смотрит в окно*»
— «Пользователь просит меня ответить как Дэвид. Мы должны ответить ей сочувственно.»
— «Respond to her last message as David.»
— Длинные абзацы в третьем лице. Нарратив. Пересказ того что было. Инструкции самому себе.

✅ МОЖНО (это живой SMS):
— «ого… тяжело. держись»
— «я тут подумал о тебе»
— «не спишь?»
— «слушай ну это жесть конечно. мне жаль что у тебя так было»
— «можем созвониться?»

ПРАВИЛА:
— Пиши от ПЕРВОГО лица (я/мне), к собеседнику на «ты» (или как у тебя принято).
— НИКАКИХ описаний действий (*улыбнулся*, «он посмотрел»). Никаких звёздочек, скобок с ремарками.
— НИКАКОГО третьего лица про себя или собеседника («она сказала», «он чувствует»). Только прямая речь.
— НИКАКИХ инструкций/мета-комментариев («давай ответим», «мы должны», «respond as»).
— Если по стилю шлёшь несколько сообщений подряд — раздели ДВОЙНЫМ переносом строки (это будут отдельные пузыри в чате).
— Если одно сообщение хочешь удалить после отправки — оберни в [DELETED]текст[/DELETED].
— Если уместно прислать фото (редко, ~1 раз на 10-15 сообщений) — отдельным сообщением [IMG:английское описание, 10-20 слов].
— Никаких "${contact.name}:", без markdown, без <think>.${languageLine}

СТИКЕРЫ — можешь отправить стикер если уместно. НЕ ЧАЩЕ чем раз в 4-6 сообщений. Стикер вместо текста или после текста — отдельной строкой [STICKER:id].
Каталог стикеров (id: описание):
${stickerCatalogForPrompt()}`;

    const lastMsg = history[history.length - 1];
    const visionImages = (lastMsg && lastMsg.from === 'user' && lastMsg.image) ? [lastMsg.image] : [];

    let raw;
    try {
        raw = await callExtraLLM(prompt, visionImages.length ? { images: visionImages } : {});
    } catch (e) {
        console.error('[iMessage] LLM failed:', e);
        return 0;
    }
    const result = cleanLLMOutput(raw);
    if (!result) return 0;

    const parts = result.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    let pushed = 0;
    let rejected = 0;
    for (const part of parts) {
        const del = part.match(/^\[DELETED\]([\s\S]+?)\[\/DELETED\]$/i);
        if (del) {
            const delText = del[1].trim();
            const reason = detectRpParagraph(delText);
            if (reason) {
                console.warn(`[iMessage] отброшено [DELETED]-сообщение (${reason}): "${delText.slice(0, 80)}..."`);
                rejected++;
                continue;
            }
            pushMessage(contactId, { from: 'contact', text: delText, deleted: true });
            pushed++;
            continue;
        }

        // Стикеры: [STICKER:s42], [STICKER: s42], [s42], просто s42
        const stickerRegex = /\[STICKER:\s*(s\d+)\]|\[(s\d+)\]/gi;
        const stickerMatches = [...part.matchAll(stickerRegex)];
        for (const sm of stickerMatches) {
            const sId = (sm[1] || sm[2] || '').toLowerCase();
            const sticker = findStickerById(sId);
            if (sticker) {
                pushMessage(contactId, { from: 'contact', sticker: sticker.file, text: '' });
                pushed++;
                console.log(`[iMessage] стикер от ${contact.name}: ${sticker.file}`);
            }
        }
        // Если весь part — только голый id стикера (бот написал просто "s42")
        const bareStickerId = part.trim().match(/^(s\d+)$/i);
        if (bareStickerId) {
            const sticker = findStickerById(bareStickerId[1].toLowerCase());
            if (sticker) {
                pushMessage(contactId, { from: 'contact', sticker: sticker.file, text: '' });
                pushed++;
                console.log(`[iMessage] стикер (bare) от ${contact.name}: ${sticker.file}`);
                continue; // весь part был стикером, дальше не парсим
            }
        }

        const imgRegex = /\[IMG:(GEN:)?([^\]]+)\]/gi;
        const imgMatches = [...part.matchAll(imgRegex)];
        const cleanText = part.replace(imgRegex, '').replace(stickerRegex, '').replace(/\[(s\d+)\]/gi, '').trim();
        if (cleanText) {
            // Постфильтр: отбрасываем RP-абзацы вместо SMS
            const reason = detectRpParagraph(cleanText);
            if (reason) {
                console.warn(`[iMessage] отброшено сообщение (${reason}): "${cleanText.slice(0, 80)}..."`);
                rejected++;
            } else {
                pushMessage(contactId, { from: 'contact', text: cleanText });
                pushed++;
            }
        }
        for (const m of imgMatches) {
            let imgPrompt = m[2].trim();
            if (m[1]) {
                try {
                    const j = JSON.parse(m[2]);
                    imgPrompt = [j.style, j.prompt].filter(Boolean).join(' ') || imgPrompt;
                } catch {}
            }
            const genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            pushMessage(contactId, { from: 'contact', text: '', image: '', _generating: true, _imgPrompt: imgPrompt, _genId: genId });
            pushed++;
            (async () => {
                try {
                    const useRef = getSettings().useAvatarAsRef !== false;
                    const refAvatar = useRef ? (getCustomAvatar(contactId) || null) : null;
                    const dataUrl = await generateImageWithFallback(imgPrompt, refAvatar);
                    updateGeneratedImage(contactId, genId, { image: dataUrl, _generating: false });
                } catch (err) {
                    console.warn('[iMessage] inline image failed:', err);
                    updateGeneratedImage(contactId, genId, { image: '', text: `[фото не загрузилось]`, _generating: false });
                }
            })();
        }
    }

    if (rejected > 0) {
        console.warn(`[iMessage] фильтр отбросил ${rejected} RP-абзац(ев) из ответа, принято ${pushed}`);
    }

    // Если все части отфильтровались — пробуем один раз сгенерить заново с
    // ещё более жёсткой инструкцией. Не делаем больше попыток чтобы не зацикливаться.
    if (pushed === 0 && rejected > 0 && !opts._isRetry) {
        console.log(`[iMessage] все части отфильтрованы — повторная попытка с усиленным промптом`);
        return await generateContactReply(contactId, { ...opts, _isRetry: true });
    }

    // Если окно чата не открыто на этом контакте — считаем непрочитанное
    if (s.openContactId !== contactId && pushed > 0) {
        for (let i = 0; i < pushed; i++) bumpUnread(contactId);
    }

    syncToMainChat();
    return pushed;
}

// ══════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ АВАТАРА
// ══════════════════════════════════════════════════════════

export async function generateAvatar(contactId) {
    const ROSTER = getRoster();
    const contact = ROSTER[contactId];
    if (!contact?.imagePrompt) throw new Error('у контакта нет imagePrompt');
    if (isImageApiConfigured()) {
        return await generateImage(contact.imagePrompt);
    }
    return await generateImageViaSD(contact.imagePrompt);
}

export async function regenerateChatImage(contactId, msgTs) {
    const s = loadState();
    const list = s.messages?.[contactId];
    if (!list) return;
    const msg = list.find(m => m && m.ts === Number(msgTs));
    if (!msg) return;
    const prompt = msg._imgPrompt;
    if (!prompt) return;
    if (!msg._genId) msg._genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    msg._generating = true;
    msg.image = '';
    save();
    window.dispatchEvent(new CustomEvent('imessage:rerender', { detail: { contactId } }));
    try {
        const useRef = getSettings().useAvatarAsRef !== false;
        const refAvatar = useRef ? (getCustomAvatar(contactId) || null) : null;
        const dataUrl = await generateImageWithFallback(prompt, refAvatar);
        updateGeneratedImage(contactId, msg._genId, { image: dataUrl, _generating: false });
    } catch (err) {
        updateGeneratedImage(contactId, msg._genId, { image: '', text: `[фото не загрузилось]`, _generating: false });
    }
}

// ══════════════════════════════════════════════════════════
// ВЫДЕРЖКА ИЗ ОСНОВНОГО ЧАТА ST
// ══════════════════════════════════════════════════════════

function getMainChatExcerpt(contactName, n = 8) {
    if (!contactName) return '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return '';
        const name2 = (c.name2 || '').toLowerCase();
        const ROSTER = getRoster();
        if (name2 && name2 !== String(contactName).toLowerCase()) {
            for (const contact of Object.values(ROSTER)) {
                if ((contact.name || '').toLowerCase() === name2) return '';
            }
        }
        const tail = chat.slice(-n);
        if (!tail.length) return '';
        return tail.map(m => {
            const who = m.is_user ? (c.name1 || 'Я') : (m.name || contactName);
            const t = String(m.mes || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
            return `${who}: ${t}`;
        }).filter(l => l.length > 5).join('\n');
    } catch (e) {
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// ИНЖЕКТ В ОСНОВНОЙ ЧАТ
// ══════════════════════════════════════════════════════════

// Инжект в основной чат ST — на английском для экономии токенов.
// Обращается к ИИ-модели напрямую ("you are managing this roleplay"), а не
// к персонажу-боту. Это корректно работает и когда основной бот = контакт
// из лорбука (тогда ИИ играет его), и когда основной бот — рассказчик/другой
// NPC (тогда ИИ отыгрывает основного бота, а переписка с iMessage-контактом —
// параллельная ветка сюжета, о которой ИИ знает).
export function syncToMainChat() {
    const settings = getSettings();
    if (!settings.injectIntoMain) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }
    const ROSTER = getRoster();
    const s = loadState();

    // Имя основного бота из ST
    let mainBotName = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        mainBotName = c.name2 || '';
    } catch {}

    // Находим ID контакта, совпадающего с основным ботом (если такой есть)
    let mainBotContactId = null;
    if (mainBotName) {
        const low = mainBotName.toLowerCase();
        for (const [id, contact] of Object.entries(ROSTER)) {
            if ((contact.name || '').toLowerCase() === low) { mainBotContactId = id; break; }
        }
    }

    // Все активные переписки (с сообщениями)
    const activeConvs = [];
    for (const [id, arr] of Object.entries(s.messages || {})) {
        if (!ROSTER[id] || !Array.isArray(arr) || !arr.length) continue;
        const lastTs = arr[arr.length - 1]?.ts || 0;
        activeConvs.push({ id, lastTs });
    }
    activeConvs.sort((a, b) => b.lastTs - a.lastTs);

    // Если вообще нет активных переписок и окно закрыто — не инжектим
    const modal = document.getElementById('imessage-modal');
    const isOpen = modal?.classList.contains('open');
    if (!activeConvs.length && !isOpen) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }

    const persona = getUserPersona();
    const userLabel = persona.name || '{{user}}';
    const lines = [];

    // ── Заголовок (адресовано ИИ-модели, не персонажу) ──
    lines.push('[iMESSAGE STATE — auxiliary context for you, the AI narrating this roleplay.]');
    lines.push('');
    lines.push(`The user (${userLabel}) has an iMessage app where they exchange text messages with characters from the lorebook. You are running the whole roleplay and need to be aware of these parallel text-message threads even when the main chat focuses on other scenes.`);
    lines.push('');

    // ── Основной бот — контакт из лорбука ──
    // Если основной бот одновременно переписывается с юзером в iMessage,
    // он ДОЛЖЕН знать эту переписку в полном объёме и поведение должно быть согласованным.
    const mainBotConv = mainBotContactId ? activeConvs.find(c => c.id === mainBotContactId) : null;
    if (mainBotConv) {
        const contact = ROSTER[mainBotContactId];
        const msgs = s.messages[mainBotContactId] || [];
        const total = msgs.length;
        const recentN = settings.injectActiveLastN || 10;
        const recent = msgs.slice(-recentN);
        const olderCount = Math.max(0, total - recentN);

        // Саммари (если включено и есть)
        const summary = settings.useLLMSummaries !== false ? (s.summaries?.[mainBotContactId]?.text) : null;

        lines.push(`## CRITICAL: ${contact.name} (the current main-chat character) is ALSO texting ${userLabel} in iMessage RIGHT NOW.`);
        lines.push(`${contact.name} in the main chat and ${contact.name} in iMessage are the SAME person — stay consistent: same memories, same feelings, same stated facts. If ${userLabel} references something from the texts, ${contact.name} remembers it.`);
        lines.push('');
        lines.push(`If ${contact.name} wants to SEND a text message mid-reply, use this exact format anywhere in the reply:`);
        lines.push(`${contact.name} texts: "message text here"`);
        lines.push(`or: ${contact.name} sends a message: "text"`);
        lines.push(`(in Russian also valid: ${contact.name} написал: "текст" / пишет в телефон: "текст")`);
        lines.push(`The extension will auto-mirror any such line into the iMessage app as a real sent message. The format must be: Name + verb + colon + quoted text.`);
        lines.push('');
        lines.push(`If ${contact.name} wants to SEND A PHOTO/SELFIE in iMessage, use ONE of these formats — the extension auto-generates the actual image:`);
        lines.push(`  • ${contact.name} sends photo: "short english description, 10-20 words"`);
        lines.push(`  • ${contact.name} прислал фото: "короткое английское описание"`);
        lines.push(`  • ${contact.name} texts: "[фото: english description]"    ← tag inside quotes also works`);
        lines.push(`  • ${contact.name} texts: "текст сообщения [photo: english description] ещё текст"   ← mix text + photo in one reply`);
        lines.push(`Description should be concise English suitable for an image generator (e.g. "selfie in locker room, wet hair, towel on shoulders, smirk").`);
        lines.push('');
        lines.push(`⚠ The quoted text MUST be a real SMS — what a person actually types with their thumbs. NOT narrative, NOT a paragraph, NOT third-person prose, NOT a meta-instruction.`);
        lines.push(`❌ WRONG: ${contact.name} texts: "She shared her traumatic story. We should respond sympathetically."`);
        lines.push(`✅ CORRECT: ${contact.name} texts: "damn that's heavy. I'm here"`);
        lines.push(`✅ CORRECT: ${contact.name} sends photo: "selfie in locker room, wet hair"`);
        lines.push('');

        if (summary && olderCount > 0) {
            lines.push(`КРАТКОЕ САММАРИ ПЕРЕПИСКИ С ${contact.name.toUpperCase()} (покрывает всю историю, всего ${total} сообщ.):`);
            lines.push(summary);
            lines.push('');
        }

        lines.push(`=== iMESSAGE THREAD with ${contact.name} — last ${recent.length} message${recent.length === 1 ? '' : 's'} verbatim (oldest to newest) ===`);
        if (olderCount > 0 && !summary) {
            lines.push(`(There were ${olderCount} older messages before this excerpt — their content is not shown here. Don't invent what they said.)`);
        }
        for (const m of recent) {
            const who = m.from === 'user' ? userLabel : contact.name;
            const flag = m.deleted ? ' [deleted by sender]' : '';
            const img = m.image ? ' [photo]' : '';
            const stk = m.sticker
                ? ` [sticker: ${m.sticker.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ')}]`
                : '';
            lines.push(`${who}: ${(m.text || '').slice(0, 250)}${img}${stk}${flag}`);
        }
        lines.push(`=== END OF THREAD ===`);
        lines.push('');
    }

    // ── Остальные активные переписки (NPCs) — саммари + последние N ──
    const otherConvs = activeConvs.filter(c => c.id !== mainBotContactId).slice(0, 6);
    if (otherConvs.length) {
        lines.push(`## Other active iMessage threads (${userLabel} is texting these NPCs in parallel):`);
        lines.push(`These are NPCs — NOT the main-chat character. You don't play them directly in the main reply, but you know these threads exist and may let them influence the plot. An NPC can send a message by writing their line in the same format: \`NpcName texts: "..."\` — SMS format only (short, first-person, no prose).`);
        lines.push('');

        const othersN = settings.injectOthersLastN || 5;
        for (const { id } of otherConvs) {
            const contact = ROSTER[id];
            const msgs = s.messages[id] || [];
            const total = msgs.length;
            const tail = msgs.slice(-othersN);
            const olderCount = Math.max(0, total - othersN);
            const summary = settings.useLLMSummaries !== false ? (s.summaries?.[id]?.text) : null;

            lines.push(`### ${contact.name} (${total} message${total === 1 ? '' : 's'} total)`);
            if (summary && olderCount > 0) {
                lines.push(`Саммари: ${summary}`);
            }
            lines.push(`Last ${tail.length}:`);
            for (const m of tail) {
                const who = m.from === 'user' ? userLabel : contact.name;
                const flag = m.deleted ? ' [deleted]' : '';
                const img = m.image ? ' [photo]' : '';
                const stk = m.sticker
                ? ` [sticker: ${m.sticker.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ')}]`
                : '';
                lines.push(`${who}: ${(m.text || '').slice(0, 180)}${img}${stk}${flag}`);
            }
            lines.push('');
        }
    }

    // ── Сводка по всем перепискам для RP-бота (Телефон → RP) ──
    if (activeConvs.length && settings.useLLMSummaries !== false && settings.injectPhoneSummary !== false) {
        const summaryLines = [];
        for (const { id } of activeConvs) {
            const contact = ROSTER[id];
            if (!contact) continue;
            const summary = s.summaries?.[id]?.text;
            if (!summary) continue;
            summaryLines.push(`• ${contact.name}: ${summary}`);
        }
        if (summaryLines.length) {
            lines.push(`## PHONE CONVERSATIONS SUMMARY`);
            lines.push(`Below is a brief summary of what ${userLabel} has been discussing in iMessage with various contacts. This is BACKGROUND KNOWLEDGE for you as the narrator/AI.`);
            lines.push('');
            lines.push(`⚠ IMPORTANT — INFORMATION BOUNDARIES:`);
            lines.push(`The main RP character (${mainBotName || 'the character you play'}) does NOT automatically know everything from these conversations. They can only know about a phone thread if:`);
            lines.push(`— They are a participant in that thread (they texted ${userLabel} themselves)`);
            lines.push(`— ${userLabel} told them about it in the RP`);
            lines.push(`— They overheard, saw the phone screen, someone else mentioned it, etc.`);
            lines.push(`— They logically could guess or figure it out from context`);
            lines.push(`Do NOT make the character omniscient. If they learn something from a phone thread they shouldn't know about — find a NATURAL way for them to discover it (overhear, see a notification, someone gossips, etc). This creates interesting drama.`);
            lines.push('');
            lines.push(summaryLines.join('\n'));
            lines.push('');
        }
    }

    // ── Язык: напоминаем боту, что iMessage-сообщения пишутся на выбранном языке ──
    const lang = (settings.messageLanguage || 'russian').toLowerCase();
    if (mainBotConv || otherConvs.length) {
        const langHuman = {
            russian: 'Russian',
            english: 'English',
            japanese: 'Japanese',
            spanish: 'Spanish',
            french: 'French',
            german: 'German',
            chinese: 'Chinese',
            korean: 'Korean',
        }[lang] || lang;
        lines.push(`## Language: text messages in iMessage are written in ${langHuman}. When you produce \`Name texts: "..."\` lines, the quoted text must be in ${langHuman}.`);
    }

    if (lines.length <= 3) {
        // Только заголовок — пустой контент
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }

    const text = lines.join('\n');
    setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_PROMPT, settings.injectDepth || 4);
    return text;
}

export function injectIntoChatCompletion(eventData) {
    try {
        const settings = getSettings();
        if (!settings.injectIntoMain) return;
        const chat = eventData?.chat;
        if (!Array.isArray(chat)) return;
        const text = syncToMainChat();
        if (!text) return;
        const marker = '[iMESSAGE STATE';
        const already = chat.some(m => typeof m?.content === 'string' && m.content.includes(marker));
        if (already) return;
        const sysMsg = { role: 'system', content: text };
        let insertAt = chat.length;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i]?.role === 'user') { insertAt = i; break; }
        }
        chat.splice(insertAt, 0, sysMsg);
    } catch (e) {
        console.warn('[iMessage] injectIntoChatCompletion failed:', e);
    }
}

export function clearMainChatInjection() {
    setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
}

export function debugInjection() {
    const settings = getSettings();
    const ROSTER = getRoster();
    const s = loadState();
    const out = {
        injectionEnabled: settings.injectIntoMain,
        depth: settings.injectDepth,
        contacts: Object.keys(ROSTER).length,
        activeOpen: s.openContactId,
        currentText: syncToMainChat(),
    };
    console.log('[iMessage] inject state:', out);
    return out;
}

// ══════════════════════════════════════════════════════════
// АВТОСООБЩЕНИЯ (бот пишет сам)
// ══════════════════════════════════════════════════════════

// Случайная пауза до следующей попытки проверки — от 2 до 10 минут.
// Саму отправку решаем в checkAutoMessages().
let _autoTimer = null;
let _autoRunning = false;

export function startAutoMessageLoop() {
    if (_autoTimer) clearTimeout(_autoTimer);
    const schedule = () => {
        _autoTimer = setTimeout(async () => {
            try { await checkAutoMessages(); } catch (e) { console.warn('[iMessage] auto check failed:', e); }
            schedule();
        }, 60_000 + Math.random() * 120_000); // 1–3 минуты
    };
    schedule();
}

export function stopAutoMessageLoop() {
    if (_autoTimer) clearTimeout(_autoTimer);
    _autoTimer = null;
}

async function checkAutoMessages() {
    if (_autoRunning) return;
    const settings = getSettings();
    if (!settings.autoMessages) return;
    if (!isExtraLLMConfigured()) return;

    _autoRunning = true;
    try {
        const ROSTER = getRoster();
        const state = loadState();
        const now = Date.now();
        const contactIds = Object.keys(ROSTER);
        if (!contactIds.length) return;

        const minMs = (settings.autoMinMinutes || 5) * 60_000;
        const maxMs = (settings.autoMaxMinutes || 180) * 60_000;
        const probability = settings.autoProbability ?? 0.4;

        for (const contactId of contactIds) {
            const msgs = state.messages?.[contactId] || [];
            if (!msgs.length) continue; // не пишем "из ниоткуда" контакту, с которым ни разу не переписывались

            const lastMsg = msgs[msgs.length - 1];
            const lastTs = lastMsg?.ts || 0;
            const elapsed = now - lastTs;

            // Не слишком рано
            if (elapsed < minMs) continue;
            // И не слишком поздно — но в отличие от min, это мягкий предел:
            // после max просто не пишем больше (иначе будет заваливать сообщениями постфактум)
            if (elapsed > maxMs * 4) continue;

            // Пишем автоматически ТОЛЬКО если последнее сообщение было от ЮЗЕРА
            // ИЛИ если бот уже давно молчит после своих последних. Иначе будет спам.
            if (lastMsg.from === 'contact') {
                // бот уже написал — пишем ещё раз только если прошло много времени (≥ maxMs/2)
                if (elapsed < maxMs / 2) continue;
            }

            // Вероятностный выстрел — равномерно шансим на интервале [minMs, maxMs]
            // Чем ближе к max, тем выше шанс что мы вообще напишем.
            const scale = Math.min(1, (elapsed - minMs) / (maxMs - minMs));
            const roll = Math.random();
            if (roll > probability * scale) continue;

            // Пишем!
            console.log(`[iMessage] авто-инициатива: ${ROSTER[contactId].name} (прошло ${Math.round(elapsed / 60000)} мин)`);
            try {
                await generateContactReply(contactId, { autoInitiated: true });
            } catch (e) {
                console.warn('[iMessage] auto reply failed:', e);
            }

            // Даём перерыв между авто-сообщениями разным контактам
            await new Promise(r => setTimeout(r, 3000));
        }
    } finally {
        _autoRunning = false;
    }
}
