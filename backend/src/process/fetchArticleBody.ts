import * as cheerio from 'cheerio';

const MAX_CHARS = 10000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REFERENCES = 5;
const MAX_REFERENCE_CHARS = 420;

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer',
  'aside', 'form', 'iframe', '.advertisement', '.ad', '.ads',
  '.share', '.social', '.comments', '.related', '.newsletter',
  '.cookie', '.subscribe', '.paywall', '.metrics', '.article-tools',
  '.article__share', '.article__metrics', '.c-article-share', '.c-article-metrics',
  '.sign-in', '.login', '.institutional-access', '.recommended', '.table-of-contents',
].join(',');

const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.abstract',
  '.article-body',
  '.entry-content',
  '.post-content',
];

const REFERENCE_HEADING_RE = /^(references|reference list|bibliography|works cited|litteratur|kilder)$/i;
const OMIT_HEADING_RE = /^(acknowledg(e)?ments?|funding|conflicts? of interest|competing interests?|declarations?|ethics declarations?|author contributions?|data availability|supplementary information|supplementary material|additional information|peer review|rights and permissions|about this article)$/i;
const BOILERPLATE_LINE_RE = /^(read the full text|pdf|cite|tools|share|view metrics|download pdf|sign in|subscribe|access through your institution|get access|view article|article metrics)$/i;

export async function fetchArticleBody(url: string): Promise<string> {
  const html = await fetchHtml(url);
  return extractBody(html);
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Videnskabsmaskinen/1.0)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractBody(html: string): string {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS).remove();

  for (const selector of CONTENT_SELECTORS) {
    const node = $(selector).first();
    if (node.length) {
      const text = collectText($, node);
      if (text.length > 200) return truncate(text);
    }
  }

  return truncate(collectText($, $('body')));
}

function collectText($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const bodyChunks: string[] = [];
  const references: string[] = [];
  let section: 'body' | 'references' | 'omit' = 'body';

  node.find('h1,h2,h3,h4,h5,h6,p,li').each((_, element) => {
    const tagName = ((element as any).tagName || '').toLowerCase();
    const text = cleanText($(element).text());
    if (!text || BOILERPLATE_LINE_RE.test(text)) return;

    if (/^h[1-6]$/.test(tagName)) {
      const heading = normalizeHeading(text);
      if (REFERENCE_HEADING_RE.test(heading)) section = 'references';
      else if (OMIT_HEADING_RE.test(heading)) section = 'omit';
      else section = 'body';
      return;
    }

    if (section === 'references') {
      if (references.length < MAX_REFERENCES && looksLikeReference(text)) {
        const reference = truncateReference(cleanReferenceText(text));
        if (reference && !references.some((existing) => uniqueKey(existing) === uniqueKey(reference))) {
          references.push(reference);
        }
      }
      return;
    }

    if (section === 'omit' || isLowValueText(text)) return;
    bodyChunks.push(text);
  });

  const body = unique(bodyChunks).join('\n\n');
  if (body) return truncateWithReferences(body, unique(references));

  return truncate(cleanText(node.text()));
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
}

function truncateWithReferences(body: string, references: string[]): string {
  if (!references.length) return truncate(body);

  const referenceSection = [
    `Udvalgte referencepunkter fra kildeartiklen (maks. ${MAX_REFERENCES}, ikke fuld kildeliste):`,
    ...references.map((reference, index) => `${index + 1}. ${reference}`),
  ].join('\n');

  const bodyLimit = MAX_CHARS - referenceSection.length - 2;
  if (bodyLimit < 3000) return truncate(body);

  const trimmedBody = body.length > bodyLimit
    ? body.slice(0, bodyLimit).replace(/\s+\S*$/, '') + '…'
    : body;
  return `${trimmedBody}\n\n${referenceSection}`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeHeading(text: string): string {
  return text.replace(/[:.]+$/, '').toLowerCase();
}

function isLowValueText(text: string): boolean {
  if (text.length < 35) return true;
  return /^(copyright|©|creative commons|this article is licensed|springer nature remains neutral|publisher's note)/i.test(text);
}

function looksLikeReference(text: string): boolean {
  if (text.length < 45) return false;
  return /\b(19|20)\d{2}\b/.test(text) || /\bdoi\b|https?:\/\/|et al\./i.test(text);
}

function truncateReference(text: string): string {
  if (text.length <= MAX_REFERENCE_CHARS) return text;
  return text.slice(0, MAX_REFERENCE_CHARS).replace(/\s+\S*$/, '') + '…';
}

function cleanReferenceText(text: string): string {
  return cleanText(
    text
      .replace(/\.?\s*Article\s+(CAS|PubMed|PubMed Central|Google Scholar).*$/i, '.')
      .replace(/\s+(PubMed|PubMed Central|Google Scholar)\s*$/i, '')
  );
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = uniqueKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueKey(value: string): string {
  return cleanReferenceText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
