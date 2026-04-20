// api.js — Extra LLM + image API под img-теги и banana/gemini

import { getSettings, getCustomAvatar } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function directFetch(url, init) {
    return await fetch(url, init);
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

// ───────────────────────── Image config

function getImageConfig() {
    const s = getSettings();
    const own = s.imageApi || {};

    if (cleanEndpoint(own.endpoint) && own.apiKey && own.model) {
        return {
            endpoint: cleanEndpoint(own.endpoint),
            apiKey: own.apiKey,
            model: own.model,
            apiType: own.apiType || 'openai',   // 'openai' | 'gemini' | 'naistera'
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

// ───────────────────────── img-теги из ответа

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
            result.push({
                rawTag: fullTag,
                instruction: json,
                src: srcMatch ? srcMatch[1] : null,
            });
        } catch (e) {
            console.warn('[PhoneMSG-API] bad data-iig-instruction JSON:', e);
        }
    }

    return result;
}

// ───────────────────────── generateImage для banana/openai с ОБЯЗАТЕЛЬНЫМ refImage

// refImage — dataURL (аватар контакта), обязателен
export async function generateImageFromInstruction(instruction, refImage) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен');
    if (!refImage) throw new Error('refImage обязателен для генерации (аватар контакта)');

    const prompt = String(instruction.prompt || '').trim();
    if (!prompt) throw new Error('instruction.prompt пустой');

    const apiType = cfg.apiType || 'openai';

    if (apiType === 'gemini') {
        return await generateImageGemini(prompt, instruction, cfg, refImage);
    } else if (apiType === 'naistera') {
        return await generateImageNaistera(prompt, instruction, cfg);
    } else {
        return await generateImageOpenAI(prompt, instruction, cfg, refImage);
    }
}

// OpenAI-compatible /v1/images/generations
async function generateImageOpenAI(prompt, instruction, cfg, refImage) {
    const url = `${cfg.endpoint}/v1/images/generations`;

    const body = {
        model: cfg.model,
        prompt,
        n: 1,
        size: instruction.image_size ? mapSize(instruction.image_size) : '1024x1024',
        response_format: 'b64_json',
    };

    if (instruction.negative_prompt) body.negative_prompt = instruction.negative_prompt;

    // ref image
    body.image = refImage;
    body.image_url = refImage;
    body.init_image = refImage;

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
    if (!item) throw new Error('Пустой ответ');

    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;

    throw new Error('Нет b64_json или url');
}

// Gemini / banana
async function generateImageGemini(prompt, instruction, cfg, refImage) {
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;

    const ref = await dataUrlToInline(refImage);

    const parts = [
        {
            inlineData: {
                mimeType: ref.mime,
                data: ref.data,
            },
        },
        {
            text: prompt,
        },
    ];

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
                aspectRatio: instruction.aspect_ratio || '1:1',
                imageSize: instruction.image_size || '1K',
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
        throw new Error(`Gemini ${resp.status}: ${t.slice(0, 400)}`);
    }

    const data = await resp.json();
    const candidates = data.candidates || [];
    const partsResp = candidates[0]?.content?.parts || [];

    for (const p of partsResp) {
        if (p.inlineData?.data) {
            return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
        }
        if (p.inline_data?.data) {
            return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
        }
        if (p.fileData?.fileUri) return p.fileData.fileUri;
        if (p.file_data?.file_uri) return p.file_data.file_uri;
    }

    throw new Error('Gemini не вернул картинку');
}

// Naistera (если надо)
async function generateImageNaistera(prompt, instruction, cfg) {
    const base = String(cfg.endpoint || '').trim().replace(/\/+$/, '');
    const url = /\/api\/generate$/i.test(base) ? base : `${base}/api/generate`;

    const body = {
        prompt,
        model: cfg.model,
        aspect_ratio: instruction.aspect_ratio || '3:2',
        preset: instruction.preset || 'digital',
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
    throw new Error('Naistera не вернул url');
}

// ───────────────────────── helpers

function mapSize(imageSize) {
    const v = String(imageSize || '').toUpperCase();
    if (v === '1K') return '1024x1024';
    if (v === '2K') return '1536x1536';
    return '1024x1024';
}

async function dataUrlToInline(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new Error('refImage не dataURL');
    }
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('bad dataURL');
    return { mime: m[1], data: m[2] };
}
