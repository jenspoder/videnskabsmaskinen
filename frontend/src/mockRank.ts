import type { Article, RelevanceBucket } from './types';

export interface MockRankResult {
  score: number;
  bucket: RelevanceBucket;
  angle: string;
}

const POSITIVE_KEYWORDS: Array<{ words: string[]; weight: number; tag: string }> = [
  { words: ['depression', 'depressiv', 'depressive'], weight: 18, tag: 'depression' },
  { words: ['angst', 'anxiety'], weight: 16, tag: 'angst' },
  { words: ['skizofren', 'schizophren'], weight: 18, tag: 'skizofreni' },
  { words: ['bipolar'], weight: 16, tag: 'bipolar lidelse' },
  { words: ['ptsd', 'posttraumatic', 'post-traumatic'], weight: 16, tag: 'PTSD' },
  { words: ['adhd'], weight: 14, tag: 'ADHD' },
  { words: ['autism', 'autisme'], weight: 14, tag: 'autisme' },
  { words: ['demens', 'dementia', 'alzheimer'], weight: 14, tag: 'demens' },
  { words: ['psykiatr', 'psychiatr'], weight: 12, tag: 'psykiatri' },
  { words: ['psykolog', 'psycholog'], weight: 10, tag: 'psykologi' },
  { words: ['suicide', 'selvmord'], weight: 14, tag: 'selvmordsforskning' },
  { words: ['rct', 'randomized', 'randomised', 'randomiseret'], weight: 14, tag: 'RCT' },
  { words: ['meta-analys', 'metaanalys', 'meta analysis'], weight: 14, tag: 'metaanalyse' },
  { words: ['cohort', 'kohorte'], weight: 8, tag: 'kohortestudie' },
  { words: ['clinical', 'klinisk'], weight: 6, tag: 'klinisk relevans' },
  { words: ['treatment', 'therapy', 'behandling', 'terapi'], weight: 6, tag: 'behandling' },
];

const NEGATIVE_KEYWORDS: Array<{ words: string[]; weight: number; tag: string }> = [
  { words: ['press release', 'pressemeddelelse'], weight: -25, tag: 'pressemeddelelse' },
  { words: ['opinion', 'debatindlæg', 'debate'], weight: -15, tag: 'debat' },
  { words: ['mouse model', 'mice', 'rotter', 'in mice', 'in rats'], weight: -12, tag: 'dyrestudie' },
  { words: ['business', 'erhverv', 'company news'], weight: -15, tag: 'branchenyt' },
];

/**
 * Mock-rangering — KUN til demo, ikke ægte relevansvurdering.
 *
 * Vi vægter title-træf fuldt og teaser-træf halvt for at undgå at
 * lange abstracts får urealistisk høje scores bare på grund af
 * keyword-masse. I produktion vil Bonzai score semantisk.
 */
export function mockRankArticle(article: Article): MockRankResult {
  const titleText = (article.title || '').toLowerCase();
  const teaserText = (article.teaser || '').toLowerCase();
  const matched: string[] = [];
  const negatives: string[] = [];

  let titleBoost = 0;
  let teaserBoost = 0;

  for (const { words, weight, tag } of POSITIVE_KEYWORDS) {
    const inTitle = words.some((w) => titleText.includes(w));
    const inTeaser = words.some((w) => teaserText.includes(w));
    if (inTitle) {
      titleBoost += weight;
      matched.push(tag);
    } else if (inTeaser) {
      teaserBoost += weight * 0.5;
      matched.push(tag);
    }
  }

  // Loft på keyword-bonus så vi ikke automatisk rammer 100
  // bare fordi abstractet er langt.
  const KEYWORD_CAP = 45;
  const positiveBoost = Math.min(KEYWORD_CAP, titleBoost + teaserBoost);

  let score = 35 + positiveBoost;

  for (const { words, weight, tag } of NEGATIVE_KEYWORDS) {
    const text = `${titleText} ${teaserText}`;
    if (words.some((w) => text.includes(w))) {
      score += weight;
      negatives.push(tag);
    }
  }

  const jitter = hashJitter(article.id) - 5;
  score += jitter;

  if (!article.teaser || article.teaser.length < 30) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const bucket: RelevanceBucket = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const angle = buildAngle(matched, negatives, article);

  return { score, bucket, angle };
}

function buildAngle(matched: string[], negatives: string[], article: Article): string {
  const parts: string[] = [];

  if (matched.length > 0) {
    const top = matched.slice(0, 3).join(', ');
    parts.push(`Nævner ${top}.`);
  } else {
    parts.push('Ingen tydelige kliniske termer i titel/teaser.');
  }

  if (negatives.length > 0) {
    parts.push(`Trækkes ned af ${negatives.join(', ')}.`);
  }

  if (!article.teaser || article.teaser.length < 30) {
    parts.push('Kort eller manglende teaser gør vurderingen usikker.');
  }

  return parts.join(' ');
}

function hashJitter(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 11;
}
