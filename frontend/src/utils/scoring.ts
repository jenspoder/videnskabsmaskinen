import type { Article, RelevanceBucket } from '../types';

/**
 * Vi skelner kun mellem to slags adgang:
 *   - 'full'     = vi har verificeret fuldtekst (via OpenAlex OA-version)
 *   - 'abstract' = alt andet — vi har kun abstract/teaser, og kvaliteten
 *                  afhænger af længden af det
 */
export type AccessBucket = 'full' | 'abstract';

export function isGeneratable(article: Article): boolean {
  const oa = article.openAccess;
  if (oa?.canGenerate === true) return true;
  if (oa?.canGenerate === false) return false;
  // Backwards compatible fallback for data enriched before canGenerate existed.
  return oa?.hasUsableFulltext === true || abstractLength(article) >= 200;
}

export function accessBucket(article: Article): AccessBucket {
  const source = article.openAccess?.contentSourceType;
  return source === 'original_fulltext' || source === 'oa_fulltext' || article.openAccess?.hasUsableFulltext === true
    ? 'full'
    : 'abstract';
}

export function abstractLength(article: Article): number {
  const source = article.openAccess?.contentSourceType;
  if ((source === 'original_abstract' || source === 'openalex_abstract' || source === 'crossref_abstract') && article.openAccess?.contentTextLength) {
    return article.openAccess.contentTextLength;
  }
  return (article.teaser || '').replace(/\s+/g, ' ').trim().length;
}

export type AbstractQuality = 'rich' | 'standard' | 'thin' | 'none';

/**
 * Klassificerer abstract-længde i fire kvalitets-tiere:
 *   - rich     ≥ 1500 tegn — substantielt, Bonzai har god kontekst
 *   - standard 600-1499 tegn — typisk videnskabsabstract
 *   - thin     200-599 tegn — kort, begrænset materiale
 *   - none     < 200 tegn — næsten intet at arbejde med
 */
export function abstractQuality(len: number): AbstractQuality {
  if (len >= 1500) return 'rich';
  if (len >= 600) return 'standard';
  if (len >= 200) return 'thin';
  return 'none';
}

/**
 * Brugbarheds-score (0..100):
 *
 *   Fuldtekst:
 *     score = relevans + 15 (bonus, capped 100)
 *
 *   Kun abstract:
 *     score = relevans × abstract-faktor + substans-bonus
 *     hvor abstract-faktor og substans-bonus skalerer med længden:
 *
 *     Længde     | faktor | substans-bonus | typisk score (relevans 80)
 *     ─────────────────────────────────────────────────────────────────
 *     ≥4000      | 0.95   | +30            | 76 + 30 = 106 → 100
 *     ≥2500      | 0.85   | +25            | 68 + 25 = 93
 *     ≥1500      | 0.70   | +18            | 56 + 18 = 74
 *     ≥600       | 0.45   | +10            | 36 + 10 = 46
 *     ≥200       | 0.20   | +3             | 16 + 3  = 19
 *     <200       | 0.05   | 0              | 4
 */
const FULLTEXT_BONUS = 15;

function abstractCurve(len: number): { factor: number; bonus: number } {
  if (len >= 4000) return { factor: 0.95, bonus: 30 };
  if (len >= 2500) return { factor: 0.85, bonus: 25 };
  if (len >= 1500) return { factor: 0.70, bonus: 18 };
  if (len >= 600)  return { factor: 0.45, bonus: 10 };
  if (len >= 200)  return { factor: 0.20, bonus: 3 };
  return { factor: 0.05, bonus: 0 };
}

export function brugbarhedScore(article: Article): number {
  if (!isGeneratable(article)) return 0;
  const r = article.relevanceScore ?? 0;
  if (accessBucket(article) === 'full') {
    return Math.min(100, r + FULLTEXT_BONUS);
  }
  const { factor, bonus } = abstractCurve(abstractLength(article));
  return Math.min(100, Math.round(r * factor + bonus));
}

export function brugbarhedBucket(score: number): RelevanceBucket {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function brugbarhedLabel(_bucket: RelevanceBucket): string {
  return 'Brugbarhed';
}

export function relevanceLabel(_bucket: RelevanceBucket): string {
  return 'Indholdsrelevans';
}
