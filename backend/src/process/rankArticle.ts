import OpenAI from 'openai';
import { Article, RelevanceBucket } from '../types';
import { EDITORIAL_PROFILE } from './editorialProfile';

const client = new OpenAI({
  baseURL: process.env.BONZAI_BASE_URL,
  apiKey: process.env.BONZAI_API_KEY || 'placeholder',
});

const MODEL = process.env.BONZAI_MODEL || 'gpt-4o';

export interface RankResult {
  score: number;
  bucket: RelevanceBucket;
  rationale: string;
}

export async function rankArticle(article: Article): Promise<RankResult> {
  const prompt = buildPrompt(article);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';
  return parseResponse(raw);
}

const SYSTEM_PROMPT = `
Du er redaktionel assistent for et dansk medie om psykologi og
psykiatri. Du vurderer, hvor relevant en kildeartikel er for
redaktionen at dække, baseret på en redaktionsprofil.

Du svarer ALTID med valid JSON i dette format:
{
  "score": <heltal mellem 0 og 100>,
  "bucket": "high" | "medium" | "low",
  "rationale": "<én til to korte sætninger på dansk>"
}

Brug følgende grænser:
- 70-100 = "high"
- 40-69  = "medium"
- 0-39   = "low"

Vær kritisk og konsistent. Hvis der mangler information (fx tom
teaser), sænk scoren og nævn det i begrundelsen.
`.trim();

function buildPrompt(article: Article): string {
  return `Redaktionsprofil:
${EDITORIAL_PROFILE}

Artikel:
- Titel: ${article.title}
- Teaser: ${article.teaser || '(ingen teaser)'}
- Kilde-URL: ${article.url}

Vurder relevansen og returner kun JSON.`;
}

function parseResponse(raw: string): RankResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Kunne ikke parse rank-svar som JSON: ${raw.slice(0, 200)}`);
  }

  const obj = parsed as Partial<RankResult> & Record<string, unknown>;
  const score = clampScore(obj.score);
  const bucket = normalizeBucket(obj.bucket, score);
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';

  return { score, bucket, rationale };
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeBucket(value: unknown, score: number): RelevanceBucket {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
