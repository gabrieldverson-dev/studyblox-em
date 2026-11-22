import { GoogleGenAI, Type } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const MAX_CONTENT_LENGTH = 12000;

export const ACTIVE_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  description: 'Conteúdo estruturado de Revisão Ativa com exatamente 3 questões de múltipla escolha e 3 flashcards.',
  properties: {
    quiz: {
      type: Type.ARRAY,
      description: 'Exatamente 3 questões objetivas de múltipla escolha sobre o tema e conteúdo da aula.',
      minItems: '3',
      maxItems: '3',
      items: {
        type: Type.OBJECT,
        properties: {
          question: {
            type: Type.STRING,
            description: 'Enunciado claro, direto e didático em português do Brasil.'
          },
          options: {
            type: Type.ARRAY,
            description: 'Exatamente 4 alternativas distintas, plausíveis e sem letras prefixadas (ex: não incluir "A)", "B)").',
            minItems: '4',
            maxItems: '4',
            items: { type: Type.STRING }
          },
          correctIndex: {
            type: Type.INTEGER,
            description: 'Índice da alternativa correta baseado em zero (0, 1, 2 ou 3).',
            minimum: 0,
            maximum: 3
          },
          explanation: {
            type: Type.STRING,
            description: 'Explicação curta e clara (1 a 3 frases) do porquê a alternativa correta está certa.'
          }
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
        propertyOrdering: ['question', 'options', 'correctIndex', 'explanation']
      }
    },
    flashcards: {
      type: Type.ARRAY,
      description: 'Exatamente 3 flashcards concisos (frente e verso) focados nos conceitos mais importantes da aula.',
      minItems: '3',
      maxItems: '3',
      items: {
        type: Type.OBJECT,
        properties: {
          front: {
            type: Type.STRING,
            description: 'Pergunta curta, conceito-chave, termo ou fórmula na frente do cartão.'
          },
          back: {
            type: Type.STRING,
            description: 'Resposta objetiva, definição ou regra prática no verso do cartão.'
          }
        },
        required: ['front', 'back'],
        propertyOrdering: ['front', 'back']
      }
    }
  },
  required: ['quiz', 'flashcards'],
  propertyOrdering: ['quiz', 'flashcards']
};

const SYSTEM_INSTRUCTION = [
  'Você é um tutor especialista em aprendizagem ativa e preparação acadêmica no Brasil.',
  'A partir do conteúdo da aula fornecido, gere material de Revisão Ativa em português do Brasil:',
  '1) Exatamente 3 questões de múltipla escolha com níveis progressivos (compreensão, aplicação e análise), cada uma com exatamente 4 alternativas plausíveis, sem prefixos como "A)" ou "1.", informando o correctIndex (0 a 3) e uma explicação curta e pedagógica do porquê ela está correta.',
  '2) Exatamente 3 flashcards objetivos (frente com pergunta/conceito-chave e verso com resposta clara e memorável).',
  'Varie a posição da alternativa correta entre as questões e evite pegadinhas ambíguas. Retorne estritamente o JSON válido no schema solicitado.'
].join('\n');

export class ActiveReviewError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'ActiveReviewError';
    this.status = status;
    this.code = code;
  }
}

function cleanText(value, maxLen) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanMultilineText(value, maxLen) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
}

/**
 * Monta e valida o texto-base da aula enviado pelo cliente.
 */
export function buildLessonPromptPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new ActiveReviewError('Corpo da requisição inválido. Envie um JSON com o conteúdo da aula.', 400, 'INVALID_BODY');
  }

  const lessonTitle = cleanText(body.lessonTitle || body.topic || body.title, 240);
  const subject = cleanText(body.subject, 120);
  const cycle = cleanText(body.cycle, 120);
  const focus = cleanText(body.focus, 800);
  const notes = cleanMultilineText(body.notes, 4000);
  const content = cleanMultilineText(body.content, MAX_CONTENT_LENGTH);

  const sections = [];
  if (subject) sections.push(`Disciplina: ${subject}`);
  if (cycle) sections.push(`Etapa / Ciclo: ${cycle}`);
  if (lessonTitle) sections.push(`Tema da Aula: ${lessonTitle}`);
  if (focus) sections.push(`Objetivo Pedagógico: ${focus}`);
  if (content) sections.push(`Conteúdo da Aula:\n${content}`);
  if (notes) sections.push(`Anotações do Estudante:\n${notes}`);

  const combined = sections.join('\n\n').trim().slice(0, MAX_CONTENT_LENGTH);
  if (combined.length < 10) {
    throw new ActiveReviewError(
      'Conteúdo da aula insuficiente para gerar a revisão ativa. Envie o tema ou o texto da aula.',
      400,
      'EMPTY_CONTENT'
    );
  }

  return { combined, lessonTitle, subject };
}

/**
 * Valida e normaliza a estrutura retornada pelo Gemini garantindo exatamente
 * 3 questões (4 alternativas + índice 0..3 + explicação) e 3 flashcards.
 */
export function validateActiveReviewPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new ActiveReviewError('A IA retornou uma resposta inválida.', 502, 'INVALID_AI_RESPONSE');
  }

  if (!Array.isArray(raw.quiz) || raw.quiz.length !== 3) {
    throw new ActiveReviewError('A resposta da IA não retornou exatamente 3 questões.', 502, 'INVALID_QUIZ_COUNT');
  }
  if (!Array.isArray(raw.flashcards) || raw.flashcards.length !== 3) {
    throw new ActiveReviewError('A resposta da IA não retornou exatamente 3 flashcards.', 502, 'INVALID_FLASHCARDS_COUNT');
  }

  const stripOptionPrefix = (opt) =>
    String(opt ?? '')
      .trim()
      .replace(/^[A-Da-d]\s*[)\.\-:]\s+/, '')
      .trim();

  const quiz = raw.quiz.map((item, idx) => {
    const question = String(item?.question ?? '').trim();
    const rawOptions = Array.isArray(item?.options) ? item.options.map(stripOptionPrefix) : [];
    const correctIndex = Number(item?.correctIndex);
    const explanation = String(item?.explanation ?? '').trim();

    if (!question || rawOptions.length !== 4 || rawOptions.some((o) => !o)) {
      throw new ActiveReviewError(`Questão ${idx + 1} retornada em formato incompleto.`, 502, 'INVALID_QUIZ_ITEM');
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new ActiveReviewError(`Índice da resposta correta inválido na questão ${idx + 1}.`, 502, 'INVALID_CORRECT_INDEX');
    }
    if (!explanation) {
      throw new ActiveReviewError(`Explicação ausente na questão ${idx + 1}.`, 502, 'MISSING_EXPLANATION');
    }

    return {
      question,
      options: rawOptions,
      correctIndex,
      explanation
    };
  });

  const flashcards = raw.flashcards.map((card, idx) => {
    const front = String(card?.front ?? '').trim();
    const back = String(card?.back ?? '').trim();
    if (!front || !back) {
      throw new ActiveReviewError(`Flashcard ${idx + 1} retornado em formato incompleto.`, 502, 'INVALID_FLASHCARD_ITEM');
    }
    return { front, back };
  });

  return { quiz, flashcards };
}

function extractJsonText(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

/**
 * Gera 3 questões de múltipla escolha e 3 flashcards usando @google/genai com Structured Outputs.
 * A apiKey deve SEMPRE vir das variáveis de ambiente do servidor.
 */
export async function generateActiveReview({ body, apiKey, model, clientFactory }) {
  const cleanKey = String(apiKey ?? '').trim();
  if (!cleanKey) {
    throw new ActiveReviewError(
      'GEMINI_API_KEY não configurada no servidor. Defina a variável de ambiente GEMINI_API_KEY para ativar a Revisão Ativa.',
      500,
      'MISSING_API_KEY'
    );
  }

  const { combined } = buildLessonPromptPayload(body);
  const selectedModel = String(model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;

  const ai = typeof clientFactory === 'function'
    ? clientFactory(cleanKey)
    : new GoogleGenAI({ apiKey: cleanKey });

  const config = {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    responseSchema: ACTIVE_REVIEW_SCHEMA,
    temperature: 0.45,
    maxOutputTokens: 4096
  };

  // Desabilita thinking tokens no gemini-2.5-flash para latência baixa e evitar truncamento de JSON
  if (/^gemini-2\.5-flash/i.test(selectedModel)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: selectedModel,
      contents: `Gere a Revisão Ativa (3 questões de múltipla escolha e 3 flashcards) para a aula abaixo:\n\n${combined}`,
      config
    });
  } catch (err) {
    const status = Number(err?.status || err?.code || 0);
    const msg = String(err?.message || '');
    if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
      throw new ActiveReviewError(
        'Limite temporário de requisições da API Gemini atingido. Aguarde alguns segundos e tente novamente.',
        429,
        'RATE_LIMITED'
      );
    }
    if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(msg)) {
      throw new ActiveReviewError(
        'A chave GEMINI_API_KEY configurada no servidor foi recusada pela API do Google Gemini.',
        502,
        'INVALID_API_KEY'
      );
    }
    throw new ActiveReviewError(
      'Não foi possível gerar a revisão ativa no momento. Tente novamente em instantes.',
      502,
      'UPSTREAM_AI_ERROR'
    );
  }

  const jsonText = extractJsonText(response?.text);
  if (!jsonText) {
    throw new ActiveReviewError('A API Gemini retornou uma resposta vazia.', 502, 'EMPTY_AI_RESPONSE');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ActiveReviewError('Falha ao interpretar o JSON retornado pela IA.', 502, 'INVALID_AI_JSON');
  }

  const validated = validateActiveReviewPayload(parsed);
  return {
    ...validated,
    model: selectedModel,
    generatedAt: new Date().toISOString()
  };
}
