// ═══════════════════════════════════════════
// API — независимый клиент для LLM и картинок
// ═══════════════════════════════════════════

import { getSettings } from './state.js';

function cleanEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function directFetch(targetUrl, init) {
    return await fetch(targetUrl, init);
}

export async function fetchModels(endpoint, apiKey) {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('endpoint и apiKey обязательны');
    const resp = await directFetch(`${ep}/v1/models`, {
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

// ── LLM ──
export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;
    if (!ep || !key || !model) throw new Error('Extra API не настроен');

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

    const resp = await directFetch(`${ep}/v1/chat/completions`, {
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

// ── Image generation ──
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
        };
    }
    if (s.useSillyImagesConfig) {
        try {
            const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
            const iig = c.extensionSettings?.inline_image_gen;
            if (iig && cleanEndpoint(iig.endpoint) && iig.apiKey && iig.model) {
                return {
                    endpoint: cleanEndpoint(iig.endpoint),
                    apiKey: iig.apiKey,
                    model: iig.model,
                    size: iig.size || '1024x1024',
                    apiType: iig.apiType || 'openai',
                    aspectRatio: iig.aspectRatio,
                };
            }
        } catch {}
    }
    return null;
}

export function isImageApiConfigured() {
    return !!getImageConfig();
}

export async function generateImage(prompt, refImage = null) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен');
    const s = getSettings();
    const prefix = (s.imagePromptPrefix || '').trim();
    const suffix = (s.imagePromptSuffix || '').trim();
    const negative = (s.imageNegativePrompt || '').trim();
    const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');
    if (cfg.apiType === 'gemini') return await _generateGemini(fullPrompt, cfg, refImage);
    const firstRef = Array.isArray(refImage) ? refImage[0] : refImage;
    return await _generateOpenAI(fullPrompt, cfg, negative, firstRef);
}

async function _generateOpenAI(prompt, cfg, negativePrompt = '', refImage = null) {
    const body = { model: cfg.model, prompt, n: 1, size: cfg.size, response_format: 'b64_json' };
    if (negativePrompt) body.negative_prompt = negativePrompt;
    if (refImage) { body.image = refImage; body.image_url = refImage; body.init_image = refImage; }
    const resp = await directFetch(`${cfg.endpoint}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`Image API ${resp.status}: ${t.slice(0, 200)}`); }
    const data = await resp.json();
    const item = data.data?.[0];
    if (!item) throw new Error('Пустой ответ от image API');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    throw new Error('Нет b64_json или url');
}

async function _generateGemini(prompt, cfg, refImage = null) {
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;
    const refsRaw = Array.isArray(refImage) ? refImage : (refImage ? [refImage] : []);
    const refs = [];
    for (let i = 0; i < refsRaw.length && i < 2; i++) {
        try {
            const m = String(refsRaw[i]).match(/^data:([^;]+);base64,(.+)$/);
            if (m) refs.push({ mime: m[1], data: m[2] });
        } catch {}
    }
    const parts = [];
    if (refs.length) {
        parts.push({ text: '⬇️ CHARACTER REFERENCE — copy appearance exactly:' });
        parts.push({ inlineData: { mimeType: 'image/png', data: refs[0].data } });
    }
    parts.push({ text: prompt });
    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: cfg.aspectRatio || '1:1' } },
    };
    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`Gemini ${resp.status}: ${t.slice(0, 300)}`); }
    const data = await resp.json();
    const parts2 = data.candidates?.[0]?.content?.parts || [];
    for (const p of parts2) {
        if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
    }
    const finishReason = data.candidates?.[0]?.finishReason;
    if (['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'IMAGE_OTHER'].includes(finishReason)) {
        const err = new Error(`Gemini отказал (${finishReason})`);
        err.code = 'IMAGE_REFUSED';
        throw err;
    }
    throw new Error('Gemini не вернул картинку');
}

export async function generateImageViaSD(prompt) {
    const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    if (typeof c.executeSlashCommandsWithOptions !== 'function') throw new Error('/sd недоступен');
    const safe = String(prompt).replace(/"/g, '\\"');
    const r = await c.executeSlashCommandsWithOptions(`/sd quiet=true "${safe}"`);
    const url = (r?.pipe || '').trim();
    if (!url) throw new Error('/sd вернул пусто');
    return url;
}

// ── Многоуровневый фоллбэк генерации картинки ──
export async function generateImageWithFallback(prompt, refAvatar) {
    const isRefusal = (err) => {
        const code = (err && err.code) || '';
        const msg = String((err && err.message) || err || '');
        return code === 'IMAGE_REFUSED' || /refus|safety|blocked|prohibit/i.test(msg);
    };
    if (refAvatar) {
        try { return await generateImage(prompt, refAvatar); }
        catch (e) { console.warn('[iMsg] step1 with ref failed:', e?.message); if (!isRefusal(e)) throw e; }
    }
    try { return await generateImage(prompt, null); }
    catch (e) {
        console.warn('[iMsg] step2 no-ref failed:', e?.message);
        if (!isRefusal(e)) { try { return await generateImageViaSD(prompt); } catch { throw e; } }
    }
    return await generateImageViaSD(prompt);
}
