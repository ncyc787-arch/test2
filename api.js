// api.js — extra LLM и image API независимо от основного ST

import { getSettings } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export async function fetchModels(endpoint, apiKey) {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('endpoint и apiKey обязательны');
    const url = `${ep}/v1/models`;
    const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
}

export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;
    if (!ep || !key || !model) throw new Error('Extra API не настроен');
    const url = `${ep}/v1/chat/completions`;

    let userContent;
    if (Array.isArray(opts.images) && opts.images.length) {
        userContent = [
            { type: 'text', text: prompt },
            ...opts.images.map(u => ({ type: 'image_url', image_url: { url: u } })),
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

    const resp = await fetch(url, {
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
                aspectRatio: iig.aspectRatio,
                source: 'sillyimages',
            };
        }
    }
    return null;
}

export function isImageApiConfigured() {
    return !!getImageConfig();
}

export async function generateImage(prompt) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен');

    const s = getSettings();
    const prefix = (s.imagePromptPrefix || '').trim();
    const suffix = (s.imagePromptSuffix || '').trim();
    const negative = (s.imageNegativePrompt || '').trim();
    const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');

    const url = `${cfg.endpoint}/v1/images/generations`;
    const body = {
        model: cfg.model,
        prompt: fullPrompt,
        n: 1,
        size: cfg.size,
        response_format: 'b64_json',
    };
    if (negative) body.negative_prompt = negative;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Image API ${resp.status}: ${t.slice(0, 200)}`);
    }

    const data = await resp.json();
    const item = data.data?.[0];
    if (!item) throw new Error('Пустой ответ');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    throw new Error('В ответе нет картинки');
}

export async function generateImageViaSD(prompt) {
    const c = ctx();
    if (typeof c.executeSlashCommandsWithOptions !== 'function') throw new Error('slash API недоступен');
    const safe = String(prompt).replace(/"/g, '\\"');
    const r = await c.executeSlashCommandsWithOptions(`/sd quiet=true "${safe}"`);
    const url = (r?.pipe || '').trim();
    if (!url) throw new Error('/sd вернул пусто');
    return url;
}
