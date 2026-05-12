import OpenAI from 'openai';
import { Article, RelevanceBreakdown, RelevanceBucket } from '../types';
import { fetchArticleBody } from './fetchArticleBody';

const client = new OpenAI({
  baseURL: process.env.BONZAI_BASE_URL,
  apiKey: process.env.BONZAI_API_KEY || 'placeholder',
});

const MODEL = process.env.BONZAI_MODEL || 'gpt-4o';
const MAX_RANK_TEXT_CHARS = 12000;

export interface RankResult {
  score: number;
  bucket: RelevanceBucket;
  breakdown: RelevanceBreakdown;
  summary: string;
  angle: string;
  suggestedTitle: string;
  suggestedExcerpt: string;
}

export async function rankArticle(article: Article): Promise<RankResult> {
  const body = article.openAccess?.contentSourceType === 'uploaded_document'
    ? article.openAccess?.contentText?.trim() || ''
    : article.openAccess?.contentSourceType === 'original_abstract' || article.openAccess?.contentSourceType === 'openalex_abstract' || article.openAccess?.contentSourceType === 'crossref_abstract'
    ? ''
    : await safeFetchBody(pickBestSourceUrl(article));
  const prompt = buildPrompt(article, body);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';
  return parseResponse(raw);
}

const SYSTEM_PROMPT = `
Du er redaktør på et populærvidenskabeligt medie. Du får en
videnskabelig artikels titel og abstract. Din opgave er at score
artiklen på 6 parametre fra 1-5 og returnere resultatet som JSON.

PARAMETRE:

1. kontraintuitiv_faktor — Overrasker fundet eller modsiger det common sense?
   1 = Bekræfter hvad alle ved
   3 = Nuancerer noget kendt
   5 = Modsiger direkte en udbredt antagelse

2. universalitet — Handler fundet om noget bredere end det specifikke case?
   1 = Kun relevant for det specifikke sted/emne
   3 = Kan oversættes til andre kontekster
   5 = Universelt princip med bred relevans

3. forklarbarhed — Kan kernebudskabet forklares i én sætning til en ikke-faglig læser?
   1 = Kræver faglig baggrund at forstå
   3 = Kan forklares med lidt kontekst
   5 = Umiddelbart forståeligt og konkret

4. nyhedsgrad — Er dette et nyt fund, eller bekræfter det noget vi vidste?
   1 = Replikationsstudie eller inkrementel opdatering
   3 = Ny vinkel på et kendt fænomen
   5 = Genuint nyt fund eller metode

5. konkret_konsekvens — Er der en "så hvad nu?"-pointe med praktisk betydning?
   1 = Rent teoretisk bidrag
   3 = Implikationer antydes
   5 = Klare handlingsanvisninger eller politiske konsekvenser

6. kildernes_trovaerdighed — Hvor stærk er tidsskriftet, metoden og datamaterialet?
   1 = Svagt tidsskrift, lille datasæt, tvivlsom metode
   3 = Solid peer review, rimeligt datasæt
   5 = Topciteret tidsskrift, stort datasæt, anerkendt metode

Hvis abstract mangler eller er meget kort, score forsigtigt
(typisk 2-3 på de fleste parametre) og nævn det i resumeet.

Returner KUN dette JSON-format uden forklaring og uden markdown:
{
  "kontraintuitiv_faktor": <1-5>,
  "universalitet": <1-5>,
  "forklarbarhed": <1-5>,
  "nyhedsgrad": <1-5>,
  "konkret_konsekvens": <1-5>,
  "kildernes_trovaerdighed": <1-5>,
  "total": <sum>,
  "resume": "<2-3 sætninger om hvad artiklen handler om, til en redaktør>",
  "anbefaling": "<én sætning om den bedste populærvidenskabelige vinkel>",
  "foreslaaet_titel": "<kort, dansk, journalistisk arbejdstitel. Skriv den som en mulig artikeloverskrift, ikke som en oversættelse af kildens titel. Må ikke være på engelsk>",
  "excerpt": "<1-2 korte danske sætninger som kunne bruges som teaser/underrubrik på den færdige artikel. Skriv læserrettet, ikke som analyse til redaktøren>"
}
`.trim();

function buildPrompt(article: Article, body: string): string {
  const sourceText = body || bestGenerationTeaser(article) || '(intet abstract tilgængeligt)';
  const abstract = limitRankText(sourceText);
  return `Artikel:
- Titel: ${article.title}
- Abstract: ${abstract}
- Kilde-URL: ${article.url}

Score artiklen og returner kun JSON.`;
}

function limitRankText(text: string): string {
  if (text.length <= MAX_RANK_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_RANK_TEXT_CHARS).trim()}\n\n[Uddraget er afkortet til ranking. Hele dokumentet kan stadig bruges som genereringsgrundlag.]`;
}

function bestGenerationTeaser(article: Article): string {
  const sourceType = article.openAccess?.contentSourceType;
  if (
    (sourceType === 'uploaded_document' || sourceType === 'original_abstract' || sourceType === 'openalex_abstract' || sourceType === 'crossref_abstract') &&
    article.openAccess?.contentText?.trim()
  ) {
    return article.openAccess.contentText.trim();
  }
  return article.teaser || '';
}

function pickBestSourceUrl(article: Article): string {
  const oa = article.openAccess;
  if (oa?.canGenerate && oa?.contentSourceUrl) return oa.contentSourceUrl;
  return article.url;
}

async function safeFetchBody(url: string): Promise<string> {
  try {
    return await fetchArticleBody(url);
  } catch (error) {
    console.warn(`Kunne ikke hente brødtekst fra ${url}:`, error);
    return '';
  }
}

function parseResponse(raw: string): RankResult {
  const cleaned = stripCodeFence(raw);
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Kunne ikke parse rank-svar som JSON: ${raw.slice(0, 200)}`);
  }

  const breakdown: RelevanceBreakdown = {
    kontraintuitiv_faktor: clampParam(parsed.kontraintuitiv_faktor),
    universalitet: clampParam(parsed.universalitet),
    forklarbarhed: clampParam(parsed.forklarbarhed),
    nyhedsgrad: clampParam(parsed.nyhedsgrad),
    konkret_konsekvens: clampParam(parsed.konkret_konsekvens),
    kildernes_trovaerdighed: clampParam(parsed.kildernes_trovaerdighed),
  };

  const total =
    breakdown.kontraintuitiv_faktor +
    breakdown.universalitet +
    breakdown.forklarbarhed +
    breakdown.nyhedsgrad +
    breakdown.konkret_konsekvens +
    breakdown.kildernes_trovaerdighed;

  const score = Math.round(((total - 6) * 100) / 24);
  const bucket: RelevanceBucket = total >= 23 ? 'high' : total >= 16 ? 'medium' : 'low';

  return {
    score: Math.max(0, Math.min(100, score)),
    bucket,
    breakdown,
    summary: typeof parsed.resume === 'string' ? parsed.resume.trim() : '',
    angle: typeof parsed.anbefaling === 'string' ? parsed.anbefaling.trim() : '',
    suggestedTitle: typeof parsed.foreslaaet_titel === 'string' ? parsed.foreslaaet_titel.trim() : '',
    suggestedExcerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt.trim() : '',
  };
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function clampParam(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}
