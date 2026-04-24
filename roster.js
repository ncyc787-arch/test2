// ═══════════════════════════════════════════
// ROSTER — контакты из лорбука
// Каждая запись лорбука = один контакт в iMessage.
// Автоматически загружаются в список чатов.
// ═══════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { chat_metadata } from '../../../../script.js';
import { EXT_NAME, getSettings, getContactMeta, setContactMeta, getCachedContactMeta, setCachedContactMeta } from './state.js';
import { callExtraLLM, isExtraLLMConfigured } from './api.js';

const GRADIENTS = [
    'linear-gradient(135deg,#5ac8fa,#007aff)',
    'linear-gradient(135deg,#ff9500,#ff3b30)',
    'linear-gradient(135deg,#34c759,#30d158)',
    'linear-gradient(135deg,#af52de,#5856d6)',
    'linear-gradient(135deg,#ff2d55,#ff3b30)',
    'linear-gradient(135deg,#64d2ff,#0a84ff)',
    'linear-gradient(135deg,#ffcc00,#ff9500)',
    'linear-gradient(135deg,#bf5af2,#ff375f)',
    'linear-gradient(135deg,#30d158,#66d4cf)',
    'linear-gradient(135deg,#ff453a,#ff6482)',
];

const gradientFor = (id) => {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return GRADIENTS[h % GRADIENTS.length];
};

let CURRENT_ROSTER = {};
let CURRENT_ORDER = [];
// Сырые описания ВСЕХ контактов — чтобы бот знал отношения между ними.
// Не вычёркивается при скрытии, т.к. даже скрытые могут упоминаться.
let ALL_RAW_DESCRIPTIONS = {}; // { contactId: { name, description } }

export const getRoster = () => CURRENT_ROSTER;
export const getContactOrder = () => CURRENT_ORDER;
export const getAllRawDescriptions = () => ALL_RAW_DESCRIPTIONS;

async function loadWorldInfoSafe(name) {
    if (!name) return null;
    try {
        const wi = await import('../../../world-info.js');
        return await wi.loadWorldInfo(name);
    } catch (e) {
        console.error('[iMessage] loadWorldInfo failed:', e);
        return null;
    }
}

function getChatLorebookName() {
    const chatLb = chat_metadata?.['world_info'];
    if (chatLb) return chatLb;
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const charId = c.characterId;
        const chars = c.characters;
        if (chars && charId != null) {
            const charLb = chars[charId]?.data?.extensions?.world;
            if (charLb) return charLb;
        }
    } catch (e) { /* ignore */ }
    return null;
}

function entryToContact(entry, idx) {
    let name = (entry.comment || '').trim();
    const content = String(entry.content || '').trim();
    if (!name) {
        const firstLine = content.split('\n')[0].trim();
        name = firstLine.length < 50 ? firstLine : `Контакт ${idx + 1}`;
    }
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean) : [];
    const id = `c_${entry.uid ?? idx}_${name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').slice(0, 12)}`;
    return {
        id, name,
        rawDescription: content,
        rawKeys: keys,
        rawComment: (entry.comment || '').trim(),
        _gradient: gradientFor(id),
        _initial: (name[0] || '?').toUpperCase(),
    };
}

// ── Упрощённый парсинг через LLM: только writeStyle + imagePrompt ──
// Всё остальное (характер, возраст, отношения) — берётся из сырого описания при каждом ответе.
async function generateContactMeta(rawContact) {
    if (!isExtraLLMConfigured()) {
        return heuristicMeta(rawContact);
    }
    const desc = (rawContact.rawDescription || '').trim();
    if (!desc) {
        return heuristicMeta(rawContact);
    }

    const prompt = `Проанализируй персонажа из лорбука и извлеки ДВА поля для iMessage-симулятора.

ИМЯ: ${rawContact.name}

ОПИСАНИЕ:
${desc}

Верни ТОЛЬКО валидный JSON, без markdown, без \`\`\`:
{
  "styleNote": "1-2 предложения КАК ИМЕННО этот персонаж пишет в мессенджере — объём сообщений (короткие/длинные), темп (сразу отвечает/тянет), тон (грубо/нежно/формально/с матом), эмодзи (часто/редко/никогда), особенности (опечатки, caps, сокращения). Опирайся строго на его характер из описания.",
  "imagePrompt": "английский промпт для генерации его фото, 15-25 слов, реалистичное фото для мессенджера. Описывает внешность персонажа если она есть в описании, иначе по контексту (возраст/роль/стиль)."
}`;

    try {
        const raw = await callExtraLLM(prompt, { temperature: 0.8, maxTokens: 400 });
        let txt = String(raw).replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?<\/\1>/gi, '');
        txt = txt.replace(/```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('JSON не найден');
        const card = JSON.parse(m[0]);
        return {
            styleNote: String(card.styleNote || '').trim() || 'Пишет в обычном темпе.',
            imagePrompt: String(card.imagePrompt || '').trim() || `${rawContact.name}, photorealistic portrait, casual`,
        };
    } catch (e) {
        console.warn('[iMessage] LLM parse failed, heuristic:', e.message);
        return heuristicMeta(rawContact);
    }
}

function heuristicMeta(rawContact) {
    return {
        styleNote: 'Пишет в обычном темпе, без особенностей.',
        imagePrompt: `${rawContact.name}, photorealistic portrait, casual messenger photo`,
    };
}

// ── Главный загрузчик ──
export async function reloadRoster() {
    const settings = getSettings();
    const newRoster = {};
    const newOrder = [];
    const newAllDescs = {};

    const lbName = settings.rosterSource === 'chat-lorebook'
        ? getChatLorebookName()
        : settings.lorebookName;

    if (!lbName) {
        console.warn('[iMessage] Лорбук не найден (ни chat-bound, ни character primary).');
        CURRENT_ROSTER = {};
        CURRENT_ORDER = [];
        ALL_RAW_DESCRIPTIONS = {};
        return 0;
    }

    const data = await loadWorldInfoSafe(lbName);
    if (!data || !data.entries) {
        console.warn('[iMessage] Лорбук не найден:', lbName);
        CURRENT_ROSTER = {};
        CURRENT_ORDER = [];
        ALL_RAW_DESCRIPTIONS = {};
        return 0;
    }

    const entries = Object.values(data.entries).filter(e => !e.disable);
    console.log(`[iMessage] Лорбук "${lbName}": ${entries.length} записей`);

    for (let i = 0; i < entries.length; i++) {
        const raw = entryToContact(entries[i], i);

        // В ALL_RAW_DESCRIPTIONS идут ВСЕ записи — включая будущие скрытые.
        // Это нужно чтобы LLM знала про врагов/друзей/соперников даже если
        // юзер спрятал их из списка чатов.
        newAllDescs[raw.id] = { name: raw.name, description: raw.rawDescription };

        let meta = getCachedContactMeta(lbName, raw.id, raw.rawDescription) || getContactMeta(raw.id);
        let needsParse = false;
        if (!meta) {
            meta = heuristicMeta(raw);
            needsParse = true;
        }
        newRoster[raw.id] = {
            ...meta,
            name: raw.name,
            _gradient: raw._gradient,
            _initial: raw._initial,
            _rawDescription: raw.rawDescription,
            _rawKeys: raw.rawKeys,
            _lorebookName: lbName,
            _needsLLMParse: needsParse,
        };
        newOrder.push(raw.id);
    }

    CURRENT_ROSTER = newRoster;
    CURRENT_ORDER = newOrder;
    ALL_RAW_DESCRIPTIONS = newAllDescs;

    const hidden = new Set(getSettings().hiddenContacts || []);
    if (hidden.size) {
        for (const id of [...Object.keys(CURRENT_ROSTER)]) {
            if (hidden.has(id)) delete CURRENT_ROSTER[id];
        }
        CURRENT_ORDER = CURRENT_ORDER.filter(id => !hidden.has(id));
    }

    const pending = newOrder.filter(id => newRoster[id]?._needsLLMParse).length;
    console.log(`[iMessage] Ростер обновлён: ${CURRENT_ORDER.length} контактов (скрыто: ${hidden.size}, на парс: ${pending})`);
    if (pending > 0) parseAllPending();
    return newOrder.length;
}

let _parsingNow = new Map();
export async function ensureContactCard(contactId) {
    const contact = CURRENT_ROSTER[contactId];
    if (!contact || !contact._needsLLMParse) return;
    if (_parsingNow.has(contactId)) return _parsingNow.get(contactId);
    const p = (async () => {
        try {
            const meta = await generateContactMeta({
                name: contact.name,
                rawDescription: contact._rawDescription,
                rawKeys: contact._rawKeys,
            });
            setCachedContactMeta(contact._lorebookName, contactId, contact._rawDescription, meta);
            setContactMeta(contactId, meta);
            Object.assign(contact, meta);
            delete contact._needsLLMParse;
            try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}
        } catch (e) {
            console.warn('[iMessage] ensureContactCard failed for', contactId, e);
        } finally {
            _parsingNow.delete(contactId);
        }
    })();
    _parsingNow.set(contactId, p);
    return p;
}

let _bgRunning = false;
async function parseAllPending() {
    if (_bgRunning) return;
    _bgRunning = true;
    try {
        for (const id of CURRENT_ORDER) {
            if (CURRENT_ROSTER[id]?._needsLLMParse) {
                await ensureContactCard(id);
            }
        }
    } finally {
        _bgRunning = false;
    }
}

export function getCustomAvatar(contactId) {
    return extension_settings?.[EXT_NAME]?.avatars?.[contactId] || null;
}
export function setCustomAvatar(contactId, dataUrl) {
    if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
    if (!extension_settings[EXT_NAME].avatars) extension_settings[EXT_NAME].avatars = {};
    extension_settings[EXT_NAME].avatars[contactId] = dataUrl;
}
export function clearCustomAvatar(contactId) {
    if (extension_settings?.[EXT_NAME]?.avatars) delete extension_settings[EXT_NAME].avatars[contactId];
}

export function hideContact(contactId) {
    const s = extension_settings[EXT_NAME];
    if (!s) return;
    if (!Array.isArray(s.hiddenContacts)) s.hiddenContacts = [];
    if (!s.hiddenContacts.includes(contactId)) s.hiddenContacts.push(contactId);
    if (s.avatars) delete s.avatars[contactId];
    delete CURRENT_ROSTER[contactId];
    CURRENT_ORDER = CURRENT_ORDER.filter(id => id !== contactId);
}

export function unhideContact(contactId) {
    const s = extension_settings[EXT_NAME];
    if (!s || !Array.isArray(s.hiddenContacts)) return;
    s.hiddenContacts = s.hiddenContacts.filter(id => id !== contactId);
}

export async function regenerateContactMeta(contactId) {
    const contact = CURRENT_ROSTER[contactId];
    if (!contact) throw new Error('контакт не найден');

    let rawDescription = contact._rawDescription || '';
    let rawKeys = contact._rawKeys || [];
    if (contact._lorebookName) {
        const data = await loadWorldInfoSafe(contact._lorebookName);
        if (data?.entries) {
            const entries = Object.values(data.entries).filter(e => !e.disable);
            const match = entries.find(e => (e.comment || '').trim() === contact.name)
                || entries.find(e => String(e.content || '').split('\n')[0].trim() === contact.name);
            if (match) {
                rawDescription = String(match.content || '').trim();
                rawKeys = Array.isArray(match.key) ? match.key.filter(Boolean) : [];
            }
        }
    }

    const meta = await generateContactMeta({ name: contact.name, rawDescription, rawKeys });
    setCachedContactMeta(contact._lorebookName, contactId, rawDescription, meta);
    setContactMeta(contactId, meta);
    Object.assign(contact, meta);
    contact._rawDescription = rawDescription;
    contact._rawKeys = rawKeys;
    return meta;
}

// ══════════════════════════════════════════════════════════
// АВТО-СОЗДАНИЕ КОНТАКТА при первом упоминании в RP
// ══════════════════════════════════════════════════════════

// Нормализует имя для сравнения: нижний регистр + убирает склонения.
// «Аякса», «Аяксу», «Аяксом» → «аякс» (если ближе к какому-то известному).
function normalizeNameForLookup(name) {
    return String(name || '').trim().toLowerCase();
}

// Ищет contactId по имени (с учётом склонений). Возвращает id или null.
// Проверяет и существующие, и скрытые контакты.
export function findContactIdByName(name) {
    if (!name) return null;
    const target = normalizeNameForLookup(name);
    if (!target) return null;

    // 1) Точное совпадение по имени или первому слову имени
    for (const [id, contact] of Object.entries(CURRENT_ROSTER)) {
        const n = String(contact.name || '').toLowerCase();
        if (!n) continue;
        if (n === target) return id;
        const first = n.split(/\s+/)[0];
        if (first && first === target) return id;
    }

    // 2) Склонения: target начинается с имени контакта + 1-3 русских букв
    for (const [id, contact] of Object.entries(CURRENT_ROSTER)) {
        const n = String(contact.name || '').toLowerCase();
        if (!n || n.length < 3) continue;
        if (target.startsWith(n) && target.length - n.length <= 3) {
            const suffix = target.slice(n.length);
            if (/^[а-яё]*$/.test(suffix)) return id;
        }
        // Обратно: имя контакта длиннее, а target — его корень
        if (n.startsWith(target) && n.length - target.length <= 3) {
            const suffix = n.slice(target.length);
            if (/^[а-яё]*$/.test(suffix) && target.length >= 3) return id;
        }
    }

    // 3) Поиск среди ALL_RAW_DESCRIPTIONS (включая скрытые)
    for (const [id, info] of Object.entries(ALL_RAW_DESCRIPTIONS)) {
        const n = String(info.name || '').toLowerCase();
        if (!n) continue;
        if (n === target) return id;
        const first = n.split(/\s+/)[0];
        if (first && first === target) return id;
    }

    return null;
}

// Авто-создаёт новый контакт с указанным именем (если он ещё не существует).
// Возвращает contactId. Контакт помечается как _autoCreated: true.
export function ensureContactForName(rawName) {
    if (!rawName) return null;
    const name = String(rawName).trim();
    if (!name || name.length < 2) return null;

    // Уже есть?
    const existing = findContactIdByName(name);
    if (existing) {
        // Если контакт был скрыт — разблокируем, чтобы он показался в списке
        const s = extension_settings[EXT_NAME];
        if (s?.hiddenContacts?.includes(existing)) {
            unhideContact(existing);
            // Если его нет в CURRENT_ROSTER — подтянем из ALL_RAW_DESCRIPTIONS
            if (!CURRENT_ROSTER[existing] && ALL_RAW_DESCRIPTIONS[existing]) {
                const info = ALL_RAW_DESCRIPTIONS[existing];
                const initial = (info.name[0] || '?').toUpperCase();
                CURRENT_ROSTER[existing] = {
                    name: info.name,
                    styleNote: 'Пишет в обычном темпе.',
                    imagePrompt: `${info.name}, photorealistic portrait`,
                    _gradient: gradientFor(existing),
                    _initial: initial,
                    _rawDescription: info.description || '',
                    _rawKeys: [],
                    _lorebookName: null,
                };
                if (!CURRENT_ORDER.includes(existing)) CURRENT_ORDER.push(existing);
            }
        }
        return existing;
    }

    // Создаём новый контакт. Имя сохраняем «как было в RP» (например «Аякса» → делаем «Аякс»),
    // но если не получилось привести к базовой форме — оставим как есть.
    const displayName = name;
    const id = `auto_${Date.now().toString(36)}_${name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').slice(0, 16)}`;

    CURRENT_ROSTER[id] = {
        name: displayName,
        styleNote: 'Пишет обычным повседневным языком — коротко, без особенностей стиля. Характер и манера пока не заданы.',
        imagePrompt: `${displayName}, photorealistic portrait, casual photo`,
        _gradient: gradientFor(id),
        _initial: (displayName[0] || '?').toUpperCase(),
        _rawDescription: '',
        _rawKeys: [],
        _lorebookName: null,
        _autoCreated: true,  // маркер что контакт создан на лету — в UI можем показать подсказку
    };
    CURRENT_ORDER.push(id);
    ALL_RAW_DESCRIPTIONS[id] = { name: displayName, description: '' };

    console.log(`[iMessage] Авто-создан контакт "${displayName}" (id=${id}) — упомянут в RP-чате впервые`);

    // Триггерим перерисовку UI асинхронно
    try { window.dispatchEvent(new CustomEvent('imessage:rerender')); } catch {}

    return id;
}

// Нормализация склонений: для «Аяксом» возвращает базовое «Аякс» если есть такой
// контакт. Иначе — исходное имя как новое.
export function canonicalizeName(rawName) {
    if (!rawName) return rawName;
    const existingId = findContactIdByName(rawName);
    if (existingId) {
        return CURRENT_ROSTER[existingId]?.name
            || ALL_RAW_DESCRIPTIONS[existingId]?.name
            || rawName;
    }
    return rawName;
}

