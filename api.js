// api.js — независимый клиент для extra LLM и image API
// Поддержка:
// - Extra LLM: OpenAI-compatible /v1/chat/completions
// - Image API: OpenAI-compatible /v1/images/generations
// - Gemini image models (nano-banana / nano-banana pro / image preview proxies)
// - автоподхват конфига из sillyimages (inline_image_gen)
// - fallback через /sd quiet=true

import { getSettings } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function directFetch(targetUrl, init) {
    return await fetch(targetUrl, init);
}

// ─────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────
export async function fetchModels(endpoint, apiKey, apiType = 'openai') {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('endpoint и apiKey обязательны');

    if (apiType === 'gemini') {
        // У gemini через прокси список моделей часто нестандартизирован,
        // но многие совместимые прокси всё равно поддерживают /v1/models.
        const tryUrls = [
            `${ep}/v1/models`,
            `${ep}/models`,
        ];

        let lastErr = null;
        for (const url of tryUrls) {
            try {
                const resp = await directFetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                });
                if (!resp.ok) {
                    lastErr = new Error(`HTTP ${resp.status}`);
                    continue;
                }
                const data = await resp.json();
                const list = (data.data || data.models || data.items || [])
                    .map(m => m.id || m.name || m.model || m.display_name)
                    .filter(Boolean);
                if (list.length) return list;
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('Не удалось получить список Gemini-моделей');
    }

    const url = `${ep}/v1/models`;
    const resp = await directFetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }

    const data = await resp.json();
    return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
}

// ─────────────────────────────────────────────
// Extra LLM
// ─────────────────────────────────────────────
export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;

    if (!ep || !key || !model) {
        throw new Error('Extra API не настроен (endpoint/apiKey/model)');
    }

    const url = `${ep}/v1/chat/completions`;

    let userContent;
    if (Array.isArray(opts.images) && opts.images.length) {
        userContent = [
            { type: 'text', text: prompt },
            ...opts.images.map(url => ({ type: 'image_url', image_url: { url } })),
        ];
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

    const resp = await directFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
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

// ─────────────────────────────────────────────
// Image config
// ─────────────────────────────────────────────
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
            imageSize: own.imageSize || '1K',
            quality: own.quality || 'standard',
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
                imageSize: iig.imageSize || iig.image_size || '1K',
                quality: iig.quality || 'standard',
                source: 'sillyimages',
            };
        }
    }

    return null;
}

export function isImageApiConfigured() {
    return !!getImageConfig();
}

export function getResolvedImageConfig() {
    return getImageConfig();
}

// ─────────────────────────────────────────────
// Main image generation
// ─────────────────────────────────────────────
// refImage:
// - null
// - dataURL string
// - array of dataURL strings [charRef, userRef, npcRef]
export async function generateImage(prompt, refImage = null) {
    const cfg = getImageConfig();
    if (!cfg) {
        throw new Error('Image API не настроен (ни в расширении, ни в sillyimages)');
    }

    const s = getSettings();
    const prefix = (s.imagePromptPrefix || '').trim();
    const suffix = (s.imagePromptSuffix || '').trim();
    const negative = (s.imageNegativePrompt || '').trim();
    const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');

    if (cfg.apiType === 'gemini') {
        return await generateImageGemini(fullPrompt, cfg, refImage);
    }

    if (cfg.apiType === 'naistera') {
        return await generateImageNaistera(fullPrompt, cfg);
    }

    const firstRef = Array.isArray(refImage) ? refImage[0] : refImage;
    return await generateImageOpenAI(fullPrompt, cfg, negative, firstRef);
}

// ─────────────────────────────────────────────
// OpenAI-compatible image generation
// ─────────────────────────────────────────────
async function generateImageOpenAI(prompt, cfg, negativePrompt = '', refImage = null) {
    const url = `${cfg.endpoint}/v1/images/generations`;

    const body = {
        model: cfg.model,
        prompt,
        n: 1,
        size: cfg.size || '1024x1024',
        response_format: 'b64_json',
    };

    if (cfg.quality) body.quality = cfg.quality;
    if (negativePrompt) body.negative_prompt = negativePrompt;

    // Best effort для совместимых прокси / форков
    if (refImage) {
        body.image = refImage;
        body.image_url = refImage;
        body.init_image = refImage;
    }

    const resp = await directFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Image API ${resp.status}: ${t.slice(0, 300)}`);
    }

    const data = await resp.json();
    const item = data.data?.[0];

    if (!item) throw new Error('Пустой ответ от image API');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;

    throw new Error('В ответе нет b64_json или url');
}

// ─────────────────────────────────────────────
// Gemini / nano-banana generation
// ─────────────────────────────────────────────
async function generateImageGemini(prompt, cfg, refImage = null) {
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;

    const refsRaw = Array.isArray(refImage) ? refImage : (refImage ? [refImage] : []);
    const labels = ['char_ref', 'user_ref', 'npc_ref'];
    const refs = [];

    for (let i = 0; i < refsRaw.length && i < 3; i++) {
        try {
            const r = await dataUrlToBase64(refsRaw[i]);
            refs.push({ ...r, label: labels[i] });
        } catch (e) {
            console.warn('[PhoneMSG] ref image conversion failed:', e);
        }
    }

    const parts = [];

    if (refs.length) {
        const labelMap = {
            char_ref: '⬇️ CHARACTER REFERENCE — copy this character\'s appearance exactly:',
            user_ref: '⬇️ USER REFERENCE — copy this person\'s appearance exactly:',
            npc_ref: '⬇️ NPC REFERENCE — copy this character\'s appearance exactly:',
        };

        for (const r of refs) {
            parts.push({ text: labelMap[r.label] || '⬇️ REFERENCE IMAGE:' });
            // В ряде прокси image/png стабильнее для inlineData
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: r.data,
                },
            });
        }

        const strictRules = `[STRICT IMAGE GENERATION RULES]
CHARACTER CONSISTENCY: You MUST precisely replicate the facial features (face structure, eye color/shape, hair color/style/length, skin tone, facial hair, age) and overall appearance from the CHARACTER/USER/NPC REFERENCE images. These characters must be recognizable as the same people across all generated images. This is the HIGHEST priority.
[END RULES]

`;

        parts.push({ text: strictRules + prompt });
    } else {
        parts.push({ text: prompt });
    }

    const body = {
        contents: [
            {
                role: 'user',
                parts,
            },
        ],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: cfg.aspectRatio || '1:1',
                imageSize: cfg.imageSize || '1K',
            },
        },
    };

    const resp = await directFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Gemini image ${resp.status}: ${t.slice(0, 400)}`);
    }

    const data = await resp.json();

    // 1. Нативный формат Gemini: content.parts[].inlineData
    const candidates = data.candidates || [];
    const responseParts = candidates[0]?.content?.parts || [];

    for (const p of responseParts) {
        if (p.inlineData?.data) {
            return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
        }
        if (p.inline_data?.data) {
            return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
        }
        if (p.fileData?.fileUri) {
            return p.fileData.fileUri;
        }
        if (p.file_data?.file_uri) {
            return p.file_data.file_uri;
        }
    }

    // 2. Иногда картинка лежит прямо в content
    const cont = candidates[0]?.content;
    if (cont?.inlineData?.data) {
        return `data:${cont.inlineData.mimeType || 'image/png'};base64,${cont.inlineData.data}`;
    }
    if (cont?.inline_data?.data) {
        return `data:${cont.inline_data.mime_type || 'image/png'};base64,${cont.inline_data.data}`;
    }

    // 3. Safety / refusal
    const finishReason = candidates[0]?.finishReason;
    const finishMessage = candidates[0]?.finishMessage || '';
    const blockReason = data.promptFeedback?.blockReason;

    if (
        blockReason ||
        ['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'IMAGE_OTHER', 'IMAGE_PROHIBITED', 'RECITATION'].includes(finishReason)
    ) {
        const err = new Error(`Gemini отказался генерить (${blockReason || finishReason}). ${finishMessage}`.trim());
        err.code = 'IMAGE_REFUSED';
        throw err;
    }

    // 4. Модель вернула текст вместо картинки
    const textOnly = responseParts.map(p => p.text).filter(Boolean).join(' ').slice(0, 300);
    if (textOnly) {
        throw new Error(`Gemini вернул ТЕКСТ вместо картинки — проверь image-модель. Ответ: "${textOnly}"`);
    }

    // 5. Fallback: поиск data:image в сыром JSON
    const raw = JSON.stringify(data);
    const dataUrlMatch = raw.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) return dataUrlMatch[0];

    // 6. Fallback: поиск длинной base64 строки
    const bareB64 = findBase64Image(data);
    if (bareB64) return `data:image/png;base64,${bareB64}`;

    // 7. Fallback: поиск прямой ссылки
    const urlMatch = raw.match(/https?:\/\/[^"'\s]+(?:png|jpg|jpeg|webp|gif)(?:\?[^"'\s]*)?/i);
    if (urlMatch) return urlMatch[0];

    throw new Error('Gemini не вернул картинку');
}

// ─────────────────────────────────────────────
// Naistera support
// ─────────────────────────────────────────────
async function generateImageNaistera(prompt, cfg) {
    const rawBase = String(cfg.endpoint || '').trim().replace(/\/+$/, '');
    const url = /\/api\/generate$/i.test(rawBase) ? rawBase : `${rawBase}/api/generate`;

    const body = {
        prompt,
        model: cfg.model,
        aspect_ratio: cfg.aspectRatio || '3:2',
        preset: cfg.preset || 'digital',
    };

    const resp = await directFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Naistera ${resp.status}: ${t.slice(0, 300)}`);
    }

    const data = await resp.json();
    if (data.data_url) return data.data_url;
    if (data.url) return data.url;

    throw new Error('Naistera не вернул data_url или url');
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function findBase64Image(obj, depth = 0) {
    if (!obj || depth > 8) return null;

    if (typeof obj === 'string') {
        if (obj.length > 500 && /^(iVBOR|\/9j\/|R0lGOD|UklGR)/.test(obj)) {
            return obj;
        }
        return null;
    }

    if (Array.isArray(obj)) {
        for (const v of obj) {
            const r = findBase64Image(v, depth + 1);
            if (r) return r;
        }
        return null;
    }

    if (typeof obj === 'object') {
        for (const v of Object.values(obj)) {
            const r = findBase64Image(v, depth + 1);
            if (r) return r;
        }
    }

    return null;
}

function dataUrlToBase64(dataUrl) {
    return new Promise((resolve, reject) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            reject(new Error('not a dataURL'));
            return;
        }

        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) {
            reject(new Error('bad dataURL'));
            return;
        }

        resolve({
            mime: m[1],
            data: m[2],
        });
    });
}

// ─────────────────────────────────────────────
// /sd fallback
// ─────────────────────────────────────────────
export async function generateImageViaSD(prompt) {
    const c = ctx();
    if (typeof c.executeSlashCommandsWithOptions !== 'function') {
        throw new Error('slash API недоступен');
    }

    const safe = String(prompt || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n+/g, ' ')
        .trim();

    const r = await c.executeSlashCommandsWithOptions(`/sd quiet=true "${safe}"`);
    const url = (r?.pipe || '').trim();

    if (!url) {
        throw new Error('/sd вернул пусто (image generation не включён?)');
    }

    return url;
}
