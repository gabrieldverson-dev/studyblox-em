export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const FALLBACK_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash'
];
export const MAX_CONTENT_LENGTH = 12000;

export function createActiveReviewSchema(Type, questionCount = 3) {
  const qCount = questionCount === 5 ? 5 : 3;
  const qCountStr = String(qCount);
  return {
    type: Type.OBJECT,
    description: `Conteúdo estruturado de Revisão Ativa com exatamente ${qCount} questões de múltipla escolha e 3 flashcards.`,
    properties: {
      quiz: {
        type: Type.ARRAY,
        description: `Exatamente ${qCount} questões objetivas de múltipla escolha sobre o tema e conteúdo da aula.`,
        minItems: qCountStr,
        maxItems: qCountStr,
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
}

function buildSystemInstruction(mode, questionCount) {
  if (mode === 'simulado') {
    return [
      'Você é um elaborador sênior de provas, vestibulares, concursos e avaliações acadêmicas no Brasil.',
      `A partir do escopo do simulado fornecido, gere em português do Brasil:`,
      `1) Exatamente ${questionCount} questões inéditas de múltipla escolha no estilo de prova real (do nível fundamental ao desafiador), com 4 alternativas plausíveis sem prefixos como "A)" ou "1.", informando correctIndex (0 a 3) e uma explicação curta e direta do gabarito.`,
      '2) Exatamente 3 flashcards estratégicos de revisão rápida (conceitos/fórmulas-chave que mais caem nesse bloco).',
      'Varie a posição da alternativa correta entre as questões e evite pegadinhas ambíguas. Retorne estritamente o JSON válido no schema solicitado.'
    ].join('\n');
  }
  return [
    'Você é um tutor especialista em aprendizagem ativa e preparação acadêmica no Brasil.',
    'A partir do conteúdo da aula fornecido, gere material de Revisão Ativa em português do Brasil:',
    `1) Exatamente ${questionCount} questões de múltipla escolha com níveis progressivos (compreensão, aplicação e análise), cada uma com exatamente 4 alternativas plausíveis, sem prefixos como "A)" ou "1.", informando o correctIndex (0 a 3) e uma explicação curta e pedagógica do porquê ela está correta.`,
    '2) Exatamente 3 flashcards objetivos (frente com pergunta/conceito-chave e verso com resposta clara e memorável).',
    'Varie a posição da alternativa correta entre as questões e evite pegadinhas ambíguas. Retorne estritamente o JSON válido no schema solicitado.'
  ].join('\n');
}

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

export function buildLessonPromptPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new ActiveReviewError('Corpo da requisição inválido. Envie um JSON com o conteúdo da aula.', 400, 'INVALID_BODY');
  }

  const mode = body.mode === 'simulado' ? 'simulado' : 'review';
  const questionCount = mode === 'simulado' ? 5 : 3;

  const lessonTitle = cleanText(body.lessonTitle || body.topic || body.title, 240);
  const subject = cleanText(body.subject, 120);
  const cycle = cleanText(body.cycle, 120);
  const focus = cleanText(body.focus, 800);
  const notes = cleanMultilineText(body.notes, 4000);
  const content = cleanMultilineText(body.content, MAX_CONTENT_LENGTH);
  const avoidQuestions = Array.isArray(body.avoidQuestions)
    ? body.avoidQuestions.map((q) => cleanText(q, 180)).filter(Boolean).slice(0, 10)
    : [];

  const sections = [];
  if (subject) sections.push(`Disciplina: ${subject}`);
  if (cycle) sections.push(`Etapa / Ciclo: ${cycle}`);
  if (lessonTitle) sections.push(`Tema da Aula: ${lessonTitle}`);
  if (focus) sections.push(`Objetivo Pedagógico: ${focus}`);
  if (content) sections.push(`Conteúdo da Aula:\n${content}`);
  if (notes) sections.push(`Anotações do Estudante:\n${notes}`);
  if (avoidQuestions.length) {
    sections.push(
      `Questões já respondidas pelo estudante (crie questões inéditas com ângulos diferentes, sem repetir estas):\n- ${avoidQuestions.join('\n- ')}`
    );
  }

  const combined = sections.join('\n\n').trim().slice(0, MAX_CONTENT_LENGTH);
  if (combined.length < 10) {
    throw new ActiveReviewError(
      'Conteúdo da aula insuficiente para gerar a revisão ativa. Envie o tema ou o texto da aula.',
      400,
      'EMPTY_CONTENT'
    );
  }

  return { combined, lessonTitle, subject, mode, questionCount };
}

export function validateActiveReviewPayload(raw, expectedQuizCount = 3) {
  const qCount = expectedQuizCount === 5 ? 5 : 3;
  if (!raw || typeof raw !== 'object') {
    throw new ActiveReviewError('A IA retornou uma resposta inválida.', 502, 'INVALID_AI_RESPONSE');
  }

  if (!Array.isArray(raw.quiz) || raw.quiz.length !== qCount) {
    throw new ActiveReviewError(`A resposta da IA não retornou exatamente ${qCount} questões.`, 502, 'INVALID_QUIZ_COUNT');
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

function sanitizeUpstreamReason(err) {
  const raw = String(err?.message || '').replace(/\s+/g, ' ').trim();
  const redacted = raw.replace(/(AIza[A-Za-z0-9_\-]{10,}|AQ\.[A-Za-z0-9_\-.]{10,})/g, '[REDACTED]');
  return redacted.slice(0, 180);
}

function isModelFallbackError(err) {
  const status = Number(err?.status || err?.code || 0);
  const msg = String(err?.message || '');
  return (
    status === 404 ||
    /NOT_FOUND|not found|is not supported|deprecated|no longer available|not available/i.test(msg)
  );
}

function isTransientUpstreamError(err) {
  const status = Number(err?.status || err?.code || 0);
  const msg = String(err?.message || '');
  return status === 503 || status === 500 || /UNAVAILABLE|overloaded|INTERNAL/i.test(msg);
}

export function createActiveReviewGenerator({ GoogleGenAI, Type }) {
  const reviewSchema = createActiveReviewSchema(Type, 3);
  const simuladoSchema = createActiveReviewSchema(Type, 5);

  async function generateActiveReview({ body, apiKey, model, clientFactory }) {
    const cleanKey = String(apiKey ?? '').trim();
    if (!cleanKey) {
      throw new ActiveReviewError(
        'GEMINI_API_KEY não configurada no servidor. Defina a variável de ambiente GEMINI_API_KEY para ativar a Revisão Ativa.',
        500,
        'MISSING_API_KEY'
      );
    }

    const { combined, mode, questionCount } = buildLessonPromptPayload(body);
    const activeSchema = mode === 'simulado' ? simuladoSchema : reviewSchema;
    const systemInstruction = buildSystemInstruction(mode, questionCount);
    const requestedModel = String(model || '').trim();
    const candidateModels = requestedModel
      ? [requestedModel]
      : [...FALLBACK_GEMINI_MODELS];

    const ai = typeof clientFactory === 'function'
      ? clientFactory(cleanKey)
      : new GoogleGenAI({ apiKey: cleanKey, httpOptions: { apiVersion: 'v1beta' } });

    const promptText = mode === 'simulado'
      ? `Gere um Simulado Interativo com exatamente ${questionCount} questões de múltipla escolha e 3 flashcards de estratégia para o módulo abaixo:\n\n${combined}`
      : `Gere a Revisão Ativa (${questionCount} questões de múltipla escolha e 3 flashcards) para a aula abaixo:\n\n${combined}`;

    let response = null;
    let usedModel = candidateModels[0];
    let lastError = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const candidate = candidateModels[i];
      const config = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: activeSchema,
        maxOutputTokens: mode === 'simulado' ? 6144 : 4096
      };

      if (/^gemini-2\.5-flash$/i.test(candidate)) {
        config.thinkingConfig = { thinkingBudget: 0 };
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await ai.models.generateContent({
            model: candidate,
            contents: promptText,
            config
          });
          usedModel = candidate;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const status = Number(err?.status || err?.code || 0);
          const msg = String(err?.message || '');
          if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
            throw new ActiveReviewError(
              'Limite temporário de requisições da API Gemini atingido. Aguarde alguns segundos e tente novamente.',
              429,
              'RATE_LIMITED'
            );
          }
          if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
            throw new ActiveReviewError(
              'A chave GEMINI_API_KEY configurada no servidor foi recusada pela API do Google Gemini. Verifique a chave no Cloudflare Pages.',
              502,
              'INVALID_API_KEY'
            );
          }
          if (attempt === 0 && isTransientUpstreamError(err)) {
            await new Promise((r) => setTimeout(r, 350));
            continue;
          }
          break;
        }
      }

      if (response) break;
      if (i < candidateModels.length - 1 && isModelFallbackError(lastError)) {
        continue;
      }
      const status = Number(lastError?.status || lastError?.code || 0);
      const statusTag = status ? ` (HTTP ${status})` : '';
      const detail = sanitizeUpstreamReason(lastError);
      throw new ActiveReviewError(
        `Não foi possível gerar a revisão ativa${statusTag}.${detail ? ' Detalhe: ' + detail : ''}`,
        502,
        'UPSTREAM_AI_ERROR'
      );
    }

    if (!response && lastError) {
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

    const validated = validateActiveReviewPayload(parsed, questionCount);
    return {
      ...validated,
      mode,
      model: usedModel,
      generatedAt: new Date().toISOString()
    };
  }

  return { responseSchema: reviewSchema, simuladoSchema, generateActiveReview };
}
