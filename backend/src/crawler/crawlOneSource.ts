import * as cheerio from 'cheerio';
import { SourceConfig, Selectors, Article } from '../types';

export async function crawlOneSource(source: SourceConfig): Promise<Article[]> {
  if (!source.selectors) {
    console.error(`HTML source ${source.sourceId} mangler selectors`);
    return [];
  }
  const selectors = source.selectors;
  try {
    const html = await fetchHtml(source.startUrl);
    const $ = cheerio.load(html);
    const itemNodes = $(selectors.item);
    const items: Article[] = [];
    const maxItems = Math.min(itemNodes.length, source.maxItems);

    for (let i = 0; i < maxItems; i++) {
      const item = extractItemData(itemNodes.eq(i), selectors, source);
      if (item) items.push(item);
    }

    return items;
  } catch (error) {
    console.error(`Error crawling source ${source.sourceId}:`, error);
    return [];
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Videnskabsmaskinen/1.0)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractItemData(
  node: cheerio.Cheerio<any>,
  selectors: Selectors,
  source: SourceConfig
): Article | null {
  try {
    const title = node.find(selectors.title).first().text().trim();
    if (!title) return null;

    const urlAttr = selectors.urlAttribute || 'href';
    let url = node.find(selectors.url).first().attr(urlAttr) || '';
    if (!url) return null;

    try {
      url = new URL(url, source.startUrl).href;
    } catch {
      return null;
    }

    const teaser = selectors.teaser ? node.find(selectors.teaser).first().text().trim() : '';

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
    };
  } catch {
    return null;
  }
}
