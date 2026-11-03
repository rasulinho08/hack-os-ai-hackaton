/**
 * @file metaAi.js
 * @description Calls Meta's Model API (OpenAI-compatible Chat Completions)
 * and reads the answer back as JSON.
 *
 * Env:
 *   MODEL_API_KEY        the API key from dev.meta.ai (unset: AI is off)
 *   META_AI_BASE_URL     default https://api.meta.ai/v1 (tests point it at tests/fakeMetaAi.js)
 *   META_AI_MODEL        default muse-spark-1.2
 *   META_AI_TIMEOUT_MS   default 60000
 */

const { httpError } = require('../utils/responseFormat');

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-spark-1.2';

const apiKey = () => String(process.env.MODEL_API_KEY || '').trim();
const baseUrl = () => String(process.env.META_AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
const model = () => String(process.env.META_AI_MODEL || DEFAULT_MODEL).trim();
const timeoutMs = () => {
  const n = Number(process.env.META_AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60000;
};

const isEnabled = () => Boolean(apiKey());

/**
 * The first JSON object in a model's answer: the whole text, or the inside of
 * a ```json fence, or the span from the first `{` to the last `}`.
 * @returns {object|null}
 */
function extractJson(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const candidates = [s];
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * One chat turn whose answer must be a JSON object.
 * @param {{ system: string, user: string, maxTokens?: number, temperature?: number }} opts
 * @returns {Promise<{ data: object, usage: object|null, model: string }>}
 */
async function chatJson({ system, user, maxTokens = 2500, temperature = 0.4 }) {
  if (!isEnabled()) {
    throw httpError(503, 'AI features are not configured on this server.', 'AI_NOT_CONFIGURED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let res;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'The AI took too long to answer. Try again.', 'AI_TIMEOUT');
    console.error('[metaAi] request failed:', err.message);
    throw httpError(502, 'The AI service could not be reached. Try again.', 'AI_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // The body may echo the request; log only its start, never the key.
    console.error(`[metaAi] HTTP ${res.status}:`, text.slice(0, 500));
    if (res.status === 429) throw httpError(429, 'The AI service is busy. Try again in a minute.', 'AI_RATE_LIMITED');
    throw httpError(502, 'The AI service answered with an error. Try again.', 'AI_UPSTREAM_ERROR');
  }
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const content = body?.choices?.[0]?.message?.content;
  const data = extractJson(typeof content === 'string' ? content : '');
  if (!data) {
    console.error('[metaAi] answer was not JSON:', String(content || text).slice(0, 500));
    throw httpError(502, 'The AI answer could not be read. Try again or rephrase.', 'AI_BAD_OUTPUT');
  }
  return { data, usage: body.usage || null, model: body.model || model() };
}

module.exports = { isEnabled, chatJson, extractJson };
