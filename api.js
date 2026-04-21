// api.js — Extra LLM + Image API для PhoneMSG
// Логика картинок полностью взята из Spark (многоуровневый fallback, Gemini/OpenAI/SD)

import { getSettings } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

// ───────────────────────── fetchModels ──────────────────────────────────────

export async function fetchModels(endpoint, apiKey) {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('Endpoint и API Key обязательны');

    const resp = await fetch(`${ep}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
}

// ───────────────────────── Extra LLM (с vision) ─────────────────────────────

export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;

    if (!ep || !key || !model) throw new Error('Extra API не настроен');

    // Vision: если переданы opts.images — multimodal content
    let userContent;
    if (Array.isArray(opts.images) && opts.images.length) {
        userContent = [
            { type: 'text', text: prompt },
            ...opts.images.map(u => ({ type: 'image_url', image_url: { url: u } })),
        ];
        console.log(`[PhoneMSG-API] callExtraLLM with vision: ${opts.images.length} image(s)`);
    } else {
        userContent = prompt;
    }

    const body = {
        model,
        messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: userContent },
        ],
        temperature: opts.temperature ?? s.extraApi?.temperature ?? 0.9,
        max_tokens: opts.maxTokens ?? s.extraApi?.maxTokens ?? 800,
    };

    const resp = await fetch(`${ep}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

export function isExtraLLMConfigured() {
    const s = getSettings();
    return !!(cleanEndpoint(s.extraApi?.endpoint) && s.extraApi?.apiKey && s.extraApi?.model);
}

// ───────────────────────── Image config ─────────────────────────────────────

function getImageConfig() {
    const s = getSettings();
    const own = s.imageApi || {};

    if (cleanEndpoint(own.endpoint) && own.apiKey && own.model) {
        return {
            endpoint: cleanEndpoint(own.endpoint),
            apiKey: own.apiKey,
            model: own.model,
            size: own.size || '1024x1024',
            apiType: own.apiType || 'openai',
            aspectRatio: own.aspectRatio || '1:1',
            source: 'phonemsg',
        };
    }

    if (s.useSillyImagesConfig) {
        const c = ctx();
        const iig = c.extensionSettings?.inline_image_gen;
        if (iig && cleanEndpoint(iig.endpoint) && iig.apiKey && iig.model) {
            return {
                endpoint: cleanEndpoint(iig.endpoint),
                apiKey: iig.apiKey,
                model: iig.model,
                size: iig.size || '1024x1024',
                apiType: iig.apiType || 'openai',
                aspectRatio: iig.aspectRatio || '1:1',
                source: 'sillyimages',
            };
        }
    }

    return null;
}

export function isImageApiConfigured() {
    return !!getImageConfig();
}

// ───────────────────────── generateImage (основная) ─────────────────────────
// refImage — dataURL или массив dataURL (как в Spark)

export async function generateImage(prompt, refImage = null) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен (ни свой, ни sillyimages)');

    if (cfg.apiType === 'gemini') {
        return await generateImageGemini(prompt, cfg, refImage);
    }
    // OpenAI-compatible — первый реф
    const firstRef = Array.isArray(refImage) ? refImage[0] : refImage;
    return await generateImageOpenAI(prompt, cfg, firstRef);
}

// ───────────────────────── Многоуровневый fallback (как в Spark) ─────────────
// Цепочка: с рефом → без рефа → санитайзенный → SD slash

function sanitizeImagePrompt(p) {
    if (!p) return p;
    let s = String(p);
    const map = [
        [/\b(nsfw|explicit|nude|naked|topless)\b/gi, ''],
        [/\b(sex|sexual|sexy|erotic|porn|hentai)\b/gi, ''],
        [/\b(penis|cock|vagina|pussy|breasts?|boobs?|nipples?)\b/gi, ''],
        [/\b(ass|butt|anus)\b/gi, ''],
        [/\b(cum|semen|orgasm|horny)\b/gi, ''],
        [/\b(bdsm|bondage|loli|underage|teen)\b/gi, 'adult'],
        [/\b(голый|голая|обнажённ\w*|секс\w*|порн\w*|грудь|сиськ\w*)\b/gi, ''],
    ];
    for (const [re, rep] of map) s = s.replace(re, rep);
    s = s.replace(/[,\s]{2,}/g, ' ').trim();
    if (s.length > 400) s = s.slice(0, 400);
    return `Tasteful artistic portrait photograph, romantic atmosphere, fully clothed. ${s}`;
}

export async function generateImageWithFallback(prompt, refAvatar) {
    const isRefusal = (err) => {
        const code = (err && err.code) || '';
        const msg = String((err && err.message) || err || '');
        return code === 'IMAGE_REFUSED' || /refus|safety|blocked|prohibit/i.test(msg);
    };
    const isHttp = (err) => /http\s*\d{3}|\b\d{3}:/i.test(String((err && err.message) || err || ''));

    // 1) С рефом
    if (refAvatar) {
        console.log('[PhoneMSG-API] step1: with ref avatar');
        try { return await generateImage(prompt, refAvatar); }
        catch (e) {
            console.warn('[PhoneMSG-API] step1 failed:', e?.message || e);
            if (!isRefusal(e) && !isHttp(e)) throw e;
        }
    }
    // 2) Без рефа, оригинальный промпт
    try { return await generateImage(prompt, null); }
    catch (e) {
        console.warn('[PhoneMSG-API] step2 no-ref failed:', e?.message || e);
        if (!isRefusal(e)) {
            try { return await generateImageViaSD(prompt); } catch { throw e; }
        }
    }
    // 3) Санитайзенный промпт без рефа
    const safe = sanitizeImagePrompt(prompt);
    if (safe) {
        try {
            console.log('[PhoneMSG-API] step3 sanitized');
            return await generateImage(safe, null);
        } catch (e) {
            console.warn('[PhoneMSG-API] step3 sanitized failed:', e?.message || e);
        }
    }
    // 4) SD slash
    console.log('[PhoneMSG-API] step4 SD slash fallback');
    return await generateImageViaSD(safe || prompt);
}

// ───────────────────────── OpenAI-compatible ────────────────────────────────

async function generateImageOpenAI(prompt, cfg, refImage = null) {
    const url = `${cfg.endpoint}/v1/images/generations`;
    const body = {
        model: cfg.model,
        prompt,
        n: 1,
        size: cfg.size || '1024x1024',
        response_format: 'b64_json',
    };
    const s = getSettings();
    const neg = (s.imageNegativePrompt || '').trim();
    if (neg) body.negative_prompt = neg;
    if (refImage) {
        body.image = refImage;
        body.image_url = refImage;
        body.init_image = refImage;
    }

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Image API ${resp.status}: ${t.slice(0, 300)}`);
    }
    const data = await resp.json();
    const item = data.data?.[0];
    if (!item) throw new Error('Пустой ответ от Image API');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    throw new Error('Нет b64_json или url в ответе');
}

// ───────────────────────── Gemini (взято из Spark) ──────────────────────────

async function generateImageGemini(prompt, cfg, refImage = null) {
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;

    const refsRaw = Array.isArray(refImage) ? refImage : (refImage ? [refImage] : []);
    const labels = ['char_ref', 'user_ref'];
    const refs = [];
    for (let i = 0; i < refsRaw.length && i < 2; i++) {
        try {
            const r = await dataUrlToBase64(refsRaw[i]);
            refs.push({ ...r, label: labels[i] });
        } catch (e) {
            console.warn('[PhoneMSG-API] ref conversion failed:', e);
        }
    }

    const parts = [];
    if (refs.length) {
        const labelMap = {
            'char_ref': "⬇️ CHARACTER REFERENCE — copy this character's appearance exactly:",
            'user_ref': "⬇️ USER REFERENCE — copy this person's appearance exactly:",
        };
        for (const r of refs) {
            parts.push({ text: labelMap[r.label] || '⬇️ REFERENCE IMAGE:' });
            parts.push({ inlineData: { mimeType: 'image/png', data: r.data } });
        }
        const rules = `[STRICT RULES]\nCHARACTER CONSISTENCY: Precisely replicate facial features from REFERENCE images.\n[END RULES]\n\n`;
        parts.push({ text: rules + prompt });
    } else {
        parts.push({ text: prompt });
    }

    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: cfg.aspectRatio || '1:1', imageSize: '1K' },
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Gemini ${resp.status}: ${t.slice(0, 400)}`);
    }
    const data = await resp.json();
    const responseParts = data.candidates?.[0]?.content?.parts || [];

    for (const p of responseParts) {
        if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
        if (p.inline_data?.data) return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
        if (p.fileData?.fileUri) return p.fileData.fileUri;
        if (p.file_data?.file_uri) return p.file_data.file_uri;
    }

    const finishReason = data.candidates?.[0]?.finishReason;
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'IMAGE_OTHER', 'IMAGE_REFUSED'].includes(finishReason)) {
        const err = new Error(`Gemini отказался (${blockReason || finishReason})`);
        err.code = 'IMAGE_REFUSED';
        throw err;
    }

    // Fallback: ищем base64 в сыром JSON
    const txt = JSON.stringify(data);
    const m = txt.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/);
    if (m) return m[0];

    throw new Error('Gemini не вернул картинку');
}

// ───────────────────────── SD slash fallback ────────────────────────────────

export async function generateImageViaSD(prompt) {
    const c = ctx();
    if (typeof c.executeSlashCommandsWithOptions !== 'function') throw new Error('slash API недоступен');
    const safe = String(prompt).replace(/"/g, '\\"');
    const r = await c.executeSlashCommandsWithOptions(`/sd quiet=true "${safe}"`);
    const url = (r?.pipe || '').trim();
    if (!url) throw new Error('/sd вернул пусто');
    return url;
}

// ───────────────────────── helpers ─────────────────────────────────────────

function dataUrlToBase64(dataUrl) {
    return new Promise((resolve, reject) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            reject(new Error('not a dataURL'));
            return;
        }
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) { reject(new Error('bad dataURL')); return; }
        resolve({ mime: m[1], data: m[2] });
    });
}
