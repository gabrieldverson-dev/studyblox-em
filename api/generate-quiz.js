import { ActiveReviewError, generateActiveReview } from '../lib/generate-quiz-service.mjs';

/**
 * Adaptador Serverless padrão (Vercel / Node Functions) para POST /api/generate-quiz.
 * Lê GEMINI_API_KEY exclusivamente de process.env no servidor.
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Método não permitido. Use POST.', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await generateActiveReview({
      body,
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: 'Corpo JSON inválido.', code: 'INVALID_JSON' });
    }
    if (err instanceof ActiveReviewError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: 'Erro interno ao gerar a revisão ativa.', code: 'INTERNAL_ERROR' });
  }
}
