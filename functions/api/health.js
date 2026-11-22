import { DEFAULT_GEMINI_MODEL } from '../../lib/generate-quiz-core.mjs';

export async function onRequestGet(context) {
  const configured = Boolean(String(context.env?.GEMINI_API_KEY || '').trim());
  const model = String(context.env?.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'aprova-estudos-api',
      aiConfigured: configured,
      defaultModel: model
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}
