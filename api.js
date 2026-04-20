// api.js — Extra LLM + Image API для PhoneMSG
// Шаблон img-тега:
//   <img data-iig-instruction='{"style":"[STYLE]","prompt":"[DESC]","aspect_ratio":"[RATIO]","image_size":"[SIZE]"}' src="[IMG:GEN]">

import { getSettings, getCustomAvatar } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function directFetch(url, init) {
    return await fetch(url, init);
}

// ───────────────────────── fetchModels

export async function fetchModels(endpoint, apiKey) {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('Endpoint и API Key обязательны');

    const url = `${ep}/v1/models`;
    const resp = await directFetch(url, {
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
    if (Array.isArray(data.data)) return data.data.map(m => m.id || m.name || String(m)).filter(Boolean);
    if (Array.isArray(data.models)) return data.models.map(m => m.name || m.id || String(m)).filter(Boolean);
    if (Array.isArray(data)) return data.map(m => m.id || m.name || String(m)).filter(Boolean);
    return [];
}

// ───────────────────────── Extra LLM

export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;

    if (!ep || !key || !model) throw new Error('Extra API не настроен');

    const url = `${ep}/v1/chat/completions`;
    const body = {
        model,
        messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
        ],
        temperature: opts.temperature ?? s.extraApi?.temperature ?? 0.9,
        max_tokens: opts.maxTokens ?? s.extraApi?.maxTokens ?? 800,
    };

    const resp = await directFetch(url, {
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

// ───────────────────────── Image config

function getImageConfig() {
    const s = getSettings();
    const own = s.imageApi || {};

    if (cleanEndpoint(own.endpoint) && own.apiKey && own.model) {
        return {
            endpoint: cleanEndpoint(own.endpoint),
            apiKey: own.apiKey,
            model: own.model,
            apiType: own.apiType || 'openai',
            size: own.size || '1024x1024',
            quality: own.quality || 'standard',
            aspectRatio: own.aspectRatio || '1:1',
            imageSize: own.imageSize || '1K',
            preset: own.preset || 'digital',
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
                apiType: iig.apiType || 'openai',
                size: iig.size || '1024x1024',
                quality: iig.quality || 'standard',
                aspectRatio: iig.aspectRatio || '1:1',
                imageSize: iig.imageSize || '1K',
                preset: iig.preset || 'digital',
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

// ───────────────────────── Парсинг img-тегов из ответа модели
// Шаблон: <img data-iig-instruction='{"style":"[STYLE]","prompt":"[DESC]","aspect_ratio":"[RATIO]","image_size":"[SIZE]"}' src="[IMG:GEN]">

export function extractImagesFromMessage(rawText) {
    const text = String(rawText || '');
    const imgPattern = /<img\s+([^>]*data-iig-instruction=['"][^'"]*['"][^>]*)>/gi;

    const result = [];
    let m;
    while ((m = imgPattern.exec(text)) !== null) {
        const fullTag = m[0];
        const attrs = m[1];
        const instrMatch = attrs.match(/data-iig-instruction=['"]([^'"]+)['"]/i);
        const srcMatch = attrs.match(/\ssrc=['"]([^'"]+)['"]/i);
        if (!instrMatch) continue;
        try {
            const json = JSON.parse(instrMatch[1]);
            result.push({ rawTag: fullTag, instruction: json, src: srcMatch ? srcMatch[1] : null });
        } catch (e) {
            console.warn('[PhoneMSG-API] bad data-iig-instruction JSON:', e);
        }
    }

    return result;
}

// ───────────────────────── Построить промпт из instruction + глобальных настроек

function buildFinalPrompt(instruction) {
    const s = getSettings();
    const parts = [];

    // style — если не плейсхолдер
    const style = String(instruction.style || '').trim();
    if (style && style !== '[STYLE]') parts.push(style);

    // глобальный префикс
    if (s.imagePromptPrefix) parts.push(s.imagePromptPrefix);

    // основное описание
    const desc = String(instruction.prompt || '').trim();
    if (desc && desc !== '[DESC]') parts.push(desc);

    // глобальный суффикс
    if (s.imagePromptSuffix) parts.push(s.imagePromptSuffix);

    return parts.filter(Boolean).join(', ');
}

function buildNegativePrompt(instruction) {
    const s = getSettings();
    const parts = [];
    if (instruction.negative_prompt) parts.push(instruction.negative_prompt);
    if (s.imageNegativePrompt) parts.push(s.imageNegativePrompt);
    return parts.filter(Boolean).join(', ');
}

// ───────────────────────── generateImage — главная точка входа

export async function generateImageFromInstruction(instruction, refImage) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен (ни свой, ни sillyimages)');

    const prompt = buildFinalPrompt(instruction);
    if (!prompt) throw new Error('Нет промпта для генерации картинки');

    const negPrompt = buildNegativePrompt(instruction);
    const apiType = cfg.apiType || 'openai';

    // aspect_ratio и image_size из instruction или из настроек
    const aspectRatio = (instruction.aspect_ratio && instruction.aspect_ratio !== '[RATIO]')
        ? instruction.aspect_ratio
        : cfg.aspectRatio || '1:1';

    const imageSize = (instruction.image_size && instruction.image_size !== '[SIZE]')
        ? instruction.image_size
        : cfg.imageSize || '1K';

    const instr = { ...instruction, aspect_ratio: aspectRatio, image_size: imageSize };

    if (apiType === 'gemini') {
        return await generateImageGemini(prompt, instr, cfg, refImage);
    } else if (apiType === 'naistera') {
        return await generateImageNaistera(prompt, instr, cfg);
    } else {
        return await generateImageOpenAI(prompt, negPrompt, instr, cfg, refImage);
    }
}

// ───────────────────────── OpenAI-compatible

async function generateImageOpenAI(prompt, negPrompt, instruction, cfg, refImage) {
    const url = `${cfg.endpoint}/v1/images/generations`;
    const size = mapSize(instruction.image_size) || cfg.size || '1024x1024';

    const body = {
        model: cfg.model,
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
    };

    if (cfg.quality && cfg.quality !== 'standard') body.quality = cfg.quality;
    if (negPrompt) body.negative_prompt = negPrompt;
    if (refImage) {
        body.image = refImage;
        body.image_url = refImage;
        body.init_image = refImage;
    }

    const resp = await directFetch(url, {
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

// ───────────────────────── Gemini

async function generateImageGemini(prompt, instruction, cfg, refImage) {
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;

    const parts = [];
    if (refImage) {
        try {
            const ref = await dataUrlToInline(refImage);
            parts.push({ inlineData: { mimeType: ref.mime, data: ref.data } });
        } catch (e) {
            console.warn('[PhoneMSG-API] refImage для Gemini не удалось разобрать:', e);
        }
    }
    parts.push({ text: prompt });

    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: instruction.aspect_ratio || '1:1',
                imageSize: instruction.image_size || '1K',
            },
        },
    };

    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Gemini ${resp.status}: ${t.slice(0, 400)}`);
    }

    const data = await resp.json();
    const partsResp = data.candidates?.[0]?.content?.parts || [];

    for (const p of partsResp) {
        if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
        if (p.inline_data?.data) return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
        if (p.fileData?.fileUri) return p.fileData.fileUri;
        if (p.file_data?.file_uri) return p.file_data.file_uri;
    }

    throw new Error('Gemini не вернул картинку в ответе');
}

// ───────────────────────── Naistera

async function generateImageNaistera(prompt, instruction, cfg) {
    const base = String(cfg.endpoint || '').trim().replace(/\/+$/, '');
    const url = /\/api\/generate$/i.test(base) ? base : `${base}/api/generate`;

    const body = {
        prompt,
        model: cfg.model,
        aspect_ratio: instruction.aspect_ratio || cfg.aspectRatio || '3:2',
        preset: instruction.preset || cfg.preset || 'digital',
    };

    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Naistera ${resp.status}: ${t.slice(0, 300)}`);
    }

    const data = await resp.json();
    if (data.data_url) return data.data_url;
    if (data.url) return data.url;
    throw new Error('Naistera не вернул url');
}

// ───────────────────────── helpers

function mapSize(imageSize) {
    const v = String(imageSize || '').toUpperCase();
    if (v === '1K') return '1024x1024';
    if (v === '2K') return '1536x1536';
    return null;
}

async function dataUrlToInline(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) throw new Error('refImage не dataURL');
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('bad dataURL');
    return { mime: m[1], data: m[2] };
}
