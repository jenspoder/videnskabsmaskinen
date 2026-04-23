import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as crypto from 'crypto';
import { loadJsonOrDefault, saveArticle, loadArticle, listArticlesInFolder, moveArticle, SOURCES_KEY } from './s3Store';
import { crawlOneSource } from './crawler/crawlOneSource';
import { crawlRssSource } from './crawler/crawlRssSource';
import { generateArticle } from './process/bonzai';
import { createWordPressDraft } from './process/wordpress';
import { Article, SourcesStore, CrawlResult } from './types';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: any): Promise<any> {
  // EventBridge scheduled trigger
  if (event.source === 'aws.events') {
    const result = await runCrawl();
    console.log('Scheduled crawl result:', result);
    return result;
  }

  const e = event as APIGatewayProxyEventV2;
  const method = e.requestContext.http.method;
  const stage = e.requestContext.stage ?? '';
  const rawPath = e.rawPath;
  const path = stage && rawPath.startsWith(`/${stage}`) ? rawPath.slice(stage.length + 1) : rawPath;

  try {
    if (method === 'OPTIONS') return json(200, {});

    if (method === 'GET' && path === '/articles') return handleGetArticles(e);
    if (method === 'PATCH' && path.match(/^\/articles\/[^/]+$/)) return handlePatchArticle(e);
    if (method === 'POST' && path.match(/^\/articles\/[^/]+\/process$/)) return handleProcessArticle(e);
    if (method === 'POST' && path === '/crawl') return handlePostCrawl();

    return json(404, { error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleGetArticles(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const status = event.queryStringParameters?.status;
  const folder = status === 'reviewed' ? 'reviewed' : 'inbox';
  const articles = await listArticlesInFolder(folder);
  return json(200, { articles, count: articles.length });
}

async function handlePatchArticle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.rawPath.split('/')[2];
  const body = event.body ? JSON.parse(event.body) : {};
  const { status, angle } = body as { status?: string; angle?: string };

  // Find artikel i inbox eller reviewed
  let article = await loadArticle(id, 'inbox');
  let from: 'inbox' | 'reviewed' = 'inbox';
  if (!article) {
    article = await loadArticle(id, 'reviewed');
    from = 'reviewed';
  }
  if (!article) return json(404, { error: 'Artikel ikke fundet' });

  if (status) article.status = status as Article['status'];
  if (angle !== undefined) article.angle = angle;
  if (status && status !== 'new') article.reviewedAt = new Date().toISOString();

  await moveArticle(id, from, article);
  return json(200, article);
}

async function handleProcessArticle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.rawPath.split('/')[2];
  const body = event.body ? JSON.parse(event.body) : {};
  const angle: string = body.angle || '';

  let article = await loadArticle(id, 'inbox');
  const from: 'inbox' | 'reviewed' = article ? 'inbox' : 'reviewed';
  if (!article) article = await loadArticle(id, 'reviewed');
  if (!article) return json(404, { error: 'Artikel ikke fundet' });

  article.status = 'processing';
  article.angle = angle;
  await moveArticle(id, from, article);

  const htmlContent = await generateArticle(article.title, article.teaser, article.url, angle);
  const wpId = await createWordPressDraft(article.title, htmlContent);

  article.status = 'published';
  article.publishedAt = new Date().toISOString();
  article.wordpressPostId = wpId;
  await moveArticle(id, 'reviewed', article);

  return json(200, { article, wordpressPostId: wpId });
}

async function handlePostCrawl(): Promise<APIGatewayProxyResultV2> {
  const result = await runCrawl();
  return json(200, result);
}

async function runCrawl(): Promise<CrawlResult> {
  const sourcesStore = await loadJsonOrDefault<SourcesStore>(SOURCES_KEY, {
    updatedAt: null,
    customers: [],
    sources: [],
  });

  const enabledSources = sourcesStore.sources.filter((s) => s.enabled);
  const errors: CrawlResult['errors'] = [];
  let addedCount = 0;
  const now = new Date().toISOString();

  // Byg et set af kendte IDs fra begge mapper til deduplication
  const [inboxArticles, reviewedArticles] = await Promise.all([
    listArticlesInFolder('inbox'),
    listArticlesInFolder('reviewed'),
  ]);
  const knownIds = new Set([
    ...inboxArticles.map((a) => a.id),
    ...reviewedArticles.map((a) => a.id),
  ]);

  for (const source of enabledSources) {
    try {
      const crawled = source.type === 'rss'
        ? await crawlRssSource(source)
        : await crawlOneSource(source);
      for (const item of crawled) {
        const id = crypto.createHash('sha1').update(item.url).digest('hex');
        if (!knownIds.has(id)) {
          await saveArticle({ ...item, id, discoveredAt: now, status: 'new' });
          knownIds.add(id);
          addedCount++;
        }
      }
    } catch (error) {
      errors.push({
        sourceId: source.sourceId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { ok: true, added: addedCount, errors, updatedAt: now };
}
