import { GoogleGenAI, Type } from '../../lib/vendor/google-genai-edge.mjs';
import { ActiveReviewError, createActiveReviewGenerator } from '../../lib/generate-quiz-core.mjs';

const { generateActiveReview } = createActiveReviewGenerator({ GoogleGenAI, Type });

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store'
    }
  });
}

function buildCacheRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const hasAvoid = Array.isArray(body.avoidQuestions) && body.avoidQuestions.length > 0;
  const hasNotes = String(body.notes || '').trim().length > 0;
  if (hasAvoid || hasNotes) return null;

  const mode = String(body.mode || 'review').trim().toLowerCase();
  const subject = String(body.subject || '').trim().toLowerCase().slice(0, 80);
  const title = String(body.title || '').trim().toLowerCase().slice(0, 180);
  if (!title) return null;

  const url = `https://studyblox-cache.internal/v1/generate-quiz?mode=${encodeURIComponent(mode)}&subject=${encodeURIComponent(subject)}&title=${encodeURIComponent(title)}`;
  return new Request(url, { method: 'GET' });
}

export async function onRequestPost(context) {
  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse(
        { error: 'Corpo JSON inválido.', code: 'INVALID_JSON' },
        400
      );
    }

    const cache = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
    const cacheReq = cache ? buildCacheRequest(body) : null;

    if (cache && cacheReq) {
      try {
        const cached = await cache.match(cacheReq);
        if (cached) {
          const cachedPayload = await cached.text();
          return new Response(cachedPayload, {
            status: 200,
            headers: {
              ...JSON_HEADERS,
              'X-Quiz-Cache': 'HIT'
            }
          });
        }
      } catch {
        // Ignora erro de leitura de cache e segue normalmente
      }
    }

    // Lê a GEMINI_API_KEY estritamente das variáveis de ambiente do servidor (Cloudflare Pages Secrets)
    const apiKey = context.env?.GEMINI_API_KEY;
    const model = context.env?.GEMINI_MODEL;

    const result = await generateActiveReview({ body, apiKey, model });

    if (cache && cacheReq && result && !result.fallback && Array.isArray(result.quiz) && result.quiz.length > 0) {
      const toCache = new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400'
        }
      });
      const putPromise = cache.put(cacheReq, toCache).catch(() => {});
      if (typeof context.waitUntil === 'function') {
        context.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'X-Quiz-Cache': result?.fallback ? 'RESERVE' : 'MISS'
      }
    });
  } catch (err) {
    if (err instanceof ActiveReviewError) {
      return jsonResponse({ error: err.message, code: err.code }, err.status);
    }
    return jsonResponse(
      { error: 'Erro interno ao gerar a revisão ativa.', code: 'INTERNAL_ERROR' },
      500
    );
  }
}
