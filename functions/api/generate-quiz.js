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

    // Lê a GEMINI_API_KEY estritamente das variáveis de ambiente do servidor (Cloudflare Pages Secrets)
    const apiKey = context.env?.GEMINI_API_KEY;
    const model = context.env?.GEMINI_MODEL;

    const result = await generateActiveReview({ body, apiKey, model });
    return jsonResponse(result, 200);
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
