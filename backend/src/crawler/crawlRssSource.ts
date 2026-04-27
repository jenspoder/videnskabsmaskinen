import { SourceConfig, Article } from '../types';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function crawlRssSource(source: SourceConfig): Promise<Article[]> {
  try {
    const xml = await fetchFeed(source.startUrl);
    const rawItems = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
    const items: Article[] = [];
    const maxItems = Math.min(rawItems.length, source.maxItems);

    for (let i = 0; i < maxItems; i++) {
      const parsed = parseItem(rawItems[i], source);
      if (parsed) items.push(parsed);
    }

    return items;
  } catch (error) {
    console.error(`Error crawling RSS source ${source.sourceId}:`, error);
    return [];
  }
}

async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function parseItem(itemXml: string, source: SourceConfig): Article | null {
  const title = extractTag(itemXml, 'title');
  if (!title) return null;

  const url = extractLink(itemXml);
  if (!url) return null;

  const description = extractTag(itemXml, 'description');
  const teaser = cleanTeaser(stripHtml(description)).slice(0, 5000);

  return {
    id: '',
    customerId: source.customerId,
    sourceId: source.sourceId,
    title,
    url,
    teaser,
    discoveredAt: '',
    status: 'new',
    angle: '',
    reviewedAt: null,
    publishedAt: null,
    wordpressPostId: null,
    relevanceScore: null,
    relevanceBucket: null,
    relevanceRationale: null,
    rankedAt: null,
  };
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(re);
  if (!match) return '';
  return decodeContent(match[1]);
}

function extractLink(itemXml: string): string {
  const textMatch = itemXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  const textUrl = textMatch ? decodeContent(textMatch[1]).trim() : '';
  if (textUrl) return textUrl;

  const hrefMatch = itemXml.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1].trim() : '';
}

function decodeContent(raw: string): string {
  let content = raw.trim();
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) content = cdata[1].trim();
  return content
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const META_PREFIXES = ['Publication date', 'Source', 'Author(s)', 'Authors', 'DOI'];

function cleanTeaser(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\s+/g, ' ').trim();
  for (const prefix of META_PREFIXES) {
    const re = new RegExp(
      `${prefix}\\s*:\\s*[^]*?(?=\\s+(?:${META_PREFIXES.join('|')})\\s*:|$)`,
      'gi'
    );
    text = text.replace(re, ' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[—–\-:•·,;\s]+/, '').trim();
  return text;
}
