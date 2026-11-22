import { GoogleGenAI, Type } from '@google/genai';
import {
  ActiveReviewError,
  DEFAULT_GEMINI_MODEL,
  MAX_CONTENT_LENGTH,
  buildLessonPromptPayload,
  createActiveReviewGenerator,
  createActiveReviewSchema,
  validateActiveReviewPayload
} from './generate-quiz-core.mjs';

const { responseSchema: ACTIVE_REVIEW_SCHEMA, generateActiveReview } = createActiveReviewGenerator({
  GoogleGenAI,
  Type
});

export {
  ACTIVE_REVIEW_SCHEMA,
  ActiveReviewError,
  DEFAULT_GEMINI_MODEL,
  MAX_CONTENT_LENGTH,
  buildLessonPromptPayload,
  createActiveReviewGenerator,
  createActiveReviewSchema,
  generateActiveReview,
  validateActiveReviewPayload
};
