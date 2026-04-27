import * as cheerio from 'cheerio';

const MAX_CHARS = 10000;
const FETCH_TIMEOUT_MS = 10000;

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer',
  'aside', 'form', 'iframe', '.advertisement', '.ad', '.ads',
  '.share', '.social', '.comments', '.related', '.newsletter',
  '.cookie', '.subscribe', '.paywall',
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
  const paragraphs: string[] = [];
  node.find('p').each((_, p) => {
    const t = $(p).text().replace(/\s+/g, ' ').trim();
    if (t) paragraphs.push(t);
  });
  if (paragraphs.length) return paragraphs.join('\n\n');
  return node.text().replace(/\s+/g, ' ').trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
}
