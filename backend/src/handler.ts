import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as crypto from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { loadJsonOrDefault, saveJson, saveArticle, loadArticle, listArticlesInFolder, moveArticle, SOURCES_KEY } from './s3Store';
import { crawlOneSource } from './crawler/crawlOneSource';
import { crawlRssSource } from './crawler/crawlRssSource';
import { generateArticle } from './process/bonzai';
import { createWordPressDraft } from './process/wordpress';
import { rankArticle } from './process/rankArticle';
import { fetchArticleBody } from './process/fetchArticleBody';
import { Article, SourcesStore, CrawlResult } from './types';

const lambdaClient = new LambdaClient({});

interface GenerateJobEvent {
  source: 'self.async-job';
  job: 'generate-draft';
  jobId: string;
  articleId: string;
  angle: string;
}

interface GenerateJobState {
  jobId: string;
  articleId: string;
  status: 'pending' | 'completed' | 'failed';
  title?: string;
  sourceUrl?: string;
  angle?: string;
  html?: string;
  bodyFetched?: boolean;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

function jobKey(jobId: string): string {
  return `jobs/${jobId}.json`;
}

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function strippedPath(event: APIGatewayProxyEventV2): string {
  const stage = event.requestContext.stage ?? '';
  const rawPath = event.rawPath;
  return stage && rawPath.startsWith(`/${stage}`) ? rawPath.slice(stage.length + 1) : rawPath;
}

export async function handler(event: any): Promise<any> {
  // EventBridge scheduled trigger
  if (event.source === 'aws.events') {
    const result = await runCrawl();
    console.log('Scheduled crawl result:', result);
    return result;
  }

  // Self-async-invoke: kør tunge generate-draft jobs uden for API Gateway's
  // 30s timeout. Resultatet skrives til S3 under jobs/{jobId}.json og
  // klienten henter det via GET /jobs/{jobId}.
  if (event.source === 'self.async-job' && event.job === 'generate-draft') {
    await runGenerateDraftJob(event as GenerateJobEvent);
    return { ok: true };
  }

  const e = event as APIGatewayProxyEventV2;
  const method = e.requestContext.http.method;
  const path = strippedPath(e);

  try {
    if (method === 'OPTIONS') return json(200, {});

    if (method === 'GET' && path === '/articles') return handleGetArticles(e);

    const jobIdMatch = path.match(/^\/jobs\/([^/]+)$/);
    if (method === 'GET' && jobIdMatch) return handleGetJob(jobIdMatch[1]);

    const articleIdMatch = path.match(/^\/articles\/([^/]+)(\/.*)?$/);
    const id = articleIdMatch?.[1] ?? '';
    const subPath = articleIdMatch?.[2] ?? '';

    if (method === 'PATCH' && id && !subPath) return handlePatchArticle(e, id);
    if (method === 'POST' && id && subPath === '/process') return handleProcessArticle(e, id);
    if (method === 'POST' && id && subPath === '/generate-draft') return handleGenerateDraft(e, id);
    if (method === 'POST' && id && subPath === '/rank') return handleRankArticle(id);

    if (method === 'POST' && path === '/articles/rank') return handleRankInbox(e);
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

async function handlePatchArticle(event: APIGatewayProxyEventV2, id: string): Promise<APIGatewayProxyResultV2> {
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

async function handleProcessArticle(event: APIGatewayProxyEventV2, id: string): Promise<APIGatewayProxyResultV2> {
  const body = event.body ? JSON.parse(event.body) : {};
  const angle: string = body.angle || '';

  let article = await loadArticle(id, 'inbox');
  const from: 'inbox' | 'reviewed' = article ? 'inbox' : 'reviewed';
  if (!article) article = await loadArticle(id, 'reviewed');
  if (!article) return json(404, { error: 'Artikel ikke fundet' });

  article.status = 'processing';
  article.angle = angle;
  await moveArticle(id, from, article);

  const { body: articleBody, sourceUrl } = await safeFetchBody(article);
  const htmlContent = await generateArticle({
    title: article.title,
    teaser: article.teaser,
    url: sourceUrl,
    angle,
    sourceDescription: describeGenerationSource(article, articleBody.length),
    body: articleBody,
  });
  const wpId = await createWordPressDraft(article.title, htmlContent);

  article.status = 'published';
  article.publishedAt = new Date().toISOString();
  article.wordpressPostId = wpId;
  await moveArticle(id, 'reviewed', article);

  return json(200, { article, wordpressPostId: wpId });
}

/**
 * Starter en asynkron generering af udkast.
 *
 * Bonzai-assistenten kan tage 30-60s at svare, hvilket overskrider API
 * Gateway HTTP API's 30s-timeout. I stedet:
 *   1. Returnér 202 + jobId med det samme.
 *   2. Self-invoke Lambda asynkront (InvocationType=Event) til at køre
 *      det tunge Bonzai-kald uden HTTP-timeout.
 *   3. Frontend poller GET /jobs/{jobId} indtil status='completed'.
 *
 * Den tidligere blokerende synkrone variant er bevaret som
 * runGenerateDraftSync() længere nede - kun til lokal test og som
 * fallback hvis self-invoke fejler.
 */
async function handleGenerateDraft(event: APIGatewayProxyEventV2, id: string): Promise<APIGatewayProxyResultV2> {
  const body = event.body ? JSON.parse(event.body) : {};
  const angle: string = typeof body.angle === 'string' ? body.angle : '';

  let article = await loadArticle(id, 'inbox');
  if (!article) article = await loadArticle(id, 'reviewed');
  if (!article) return json(404, { error: 'Artikel ikke fundet' });

  const jobId = crypto.randomUUID();
  const initialState: GenerateJobState = {
    jobId,
    articleId: id,
    status: 'pending',
    title: article.title,
    sourceUrl: article.url,
    angle,
    createdAt: new Date().toISOString(),
  };
  await saveJson(jobKey(jobId), initialState);

  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    return json(500, { error: 'Lambda-navnet ikke tilgængeligt - kan ikke starte async job' });
  }

  const payload: GenerateJobEvent = {
    source: 'self.async-job',
    job: 'generate-draft',
    jobId,
    articleId: id,
    angle,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  return json(202, { jobId, status: 'pending' });
}

async function handleGetJob(jobId: string): Promise<APIGatewayProxyResultV2> {
  const job = await loadJsonOrDefault<GenerateJobState | null>(jobKey(jobId), null);
  if (!job) return json(404, { error: 'Job ikke fundet' });
  return json(200, job);
}

async function runGenerateDraftJob(payload: GenerateJobEvent): Promise<void> {
  const { jobId, articleId, angle } = payload;
  const baseState = (await loadJsonOrDefault<GenerateJobState | null>(jobKey(jobId), null)) ?? {
    jobId,
    articleId,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  };

  let article = await loadArticle(articleId, 'inbox');
  if (!article) article = await loadArticle(articleId, 'reviewed');
  if (!article) {
    await saveJson(jobKey(jobId), {
      ...baseState,
      status: 'failed',
      error: 'Artikel ikke fundet',
      finishedAt: new Date().toISOString(),
    } satisfies GenerateJobState);
    return;
  }

  try {
    const { body: articleBody, sourceUrl } = await safeFetchBody(article);
    const html = await generateArticle({
      title: article.title,
      teaser: article.teaser,
      url: sourceUrl,
      angle,
      sourceDescription: describeGenerationSource(article, articleBody.length),
      body: articleBody,
    });

    await saveJson(jobKey(jobId), {
      ...baseState,
      status: 'completed',
      title: article.title,
      sourceUrl,
      angle,
      html,
      bodyFetched: articleBody.length > 0,
      finishedAt: new Date().toISOString(),
    } satisfies GenerateJobState);
  } catch (error) {
    console.error(`Job ${jobId} fejlede:`, error);
    await saveJson(jobKey(jobId), {
      ...baseState,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      finishedAt: new Date().toISOString(),
    } satisfies GenerateJobState);
  }
}

/**
 * Vælger den bedste URL at hente brødtekst fra.
 *
 * Prioritet:
 *   1. Verificeret Open Access-fuldtekst (oaUrl + hasUsableFulltext) —
 *      typisk PMC, arXiv, eller forlagets free version som vi har
 *      bekræftet returnerer brugbart HTML-indhold.
 *   2. Original RSS-URL (publisher) — ofte paywallet, men værd at
 *      forsøge når vi ikke har et bedre alternativ.
 */
function pickBestSourceUrl(article: { url: string; openAccess?: any }): string {
  const oa = article.openAccess;
  if (oa?.canGenerate && oa?.contentSourceUrl) {
    return oa.contentSourceUrl;
  }
  return article.url;
}

/**
 * Henter brødtekst gracefully fra den bedst tilgængelige kilde.
 * Hvis OA-URL'en findes og er verificeret prioriteres den. Falder
 * tilbage til original-URL ellers, og til tom streng hvis alt
 * blokerer — Bonzai bruger så kun titel + (beriget) teaser.
 */
async function safeFetchBody(article: { url: string; openAccess?: any }): Promise<{ body: string; sourceUrl: string }> {
  const primaryUrl = pickBestSourceUrl(article);
  const sourceType = article.openAccess?.contentSourceType;

  // Hvis genereringsgrundlaget kun er et abstract, ligger teksten allerede
  // i article.teaser. Vi skal ikke forsøge at hente en paywall/Cloudflare-side
  // og risikere støj som brødtekst.
  if (sourceType === 'original_abstract' || sourceType === 'openalex_abstract' || sourceType === 'crossref_abstract') {
    return { body: '', sourceUrl: article.url };
  }

  try {
    const body = await fetchArticleBody(primaryUrl);
    return { body, sourceUrl: primaryUrl };
  } catch (error) {
    console.warn(`Kunne ikke hente brødtekst fra ${primaryUrl}:`, error);
  }

  // Hvis vi prøvede OA-URL og fejlede, prøv original som fallback
  if (primaryUrl !== article.url) {
    try {
      const body = await fetchArticleBody(article.url);
      return { body, sourceUrl: article.url };
    } catch (error) {
      console.warn(`Fallback til original-URL fejlede også:`, error);
    }
  }
  return { body: '', sourceUrl: primaryUrl };
}

function describeGenerationSource(article: { url: string; openAccess?: any }, fetchedBodyLength: number): string {
  const oa = article.openAccess;
  const host = oa?.contentSourceHost || (oa?.contentSourceUrl ? hostOf(oa.contentSourceUrl) : null);
  const sourceType = oa?.contentSourceType;
  const textLength = oa?.contentTextLength || fetchedBodyLength || 0;

  switch (sourceType) {
    case 'original_fulltext':
      return `Renset fuldtekstuddrag hentet fra originalkilden${host ? ` (${host})` : ''}. Støj som navigation, metadata, interessekonflikter, funding og størstedelen af referencesektionen er filtreret fra. Hvis artiklen er længere end ca. 10.000 tegn, er uddraget prioriteret ned til ca. 10.000 tegn og kan indeholde få udvalgte referencepunkter, ikke den fulde kildeliste.`;
    case 'oa_fulltext':
      return `Renset fuldtekstuddrag hentet fra verificeret Open Access-kilde${host ? ` (${host})` : ''}. Støj som navigation, metadata, interessekonflikter, funding og størstedelen af referencesektionen er filtreret fra. Hvis artiklen er længere end ca. 10.000 tegn, er uddraget prioriteret ned til ca. 10.000 tegn og kan indeholde få udvalgte referencepunkter, ikke den fulde kildeliste.`;
    case 'original_abstract':
      return `Kun offentligt abstract fra originalkilden${host ? ` (${host})` : ''} er tilgængeligt (${textLength} tegn). Skriv kun ud fra abstractet.`;
    case 'openalex_abstract':
      return `Kun abstract fra OpenAlex-metadata er tilgængeligt (${textLength} tegn). Skriv kun ud fra abstractet.`;
    case 'crossref_abstract':
      return `Kun abstract fra Crossref-metadata er tilgængeligt (${textLength} tegn). Skriv kun ud fra abstractet.`;
    default:
      return fetchedBodyLength > 0
        ? 'Fuldtekst hentet fra kilden. Brug denne som primært grundlag.'
        : 'Der er ikke fundet brugbart tekstgrundlag ud over titel og teaser/abstract. Skriv meget forsigtigt.';
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function handleRankArticle(id: string): Promise<APIGatewayProxyResultV2> {
  const article = await loadArticle(id, 'inbox');
  if (!article) return json(404, { error: 'Artikel ikke fundet i inbox' });

  const updated = await rankAndPersist(article);
  return json(200, updated);
}

async function handleRankInbox(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const force = event.queryStringParameters?.force === 'true';
  const articles = await listArticlesInFolder('inbox');
  const targets = force
    ? articles
    : articles.filter((a) => a.relevanceScore === null || !a.relevanceBreakdown);

  let ranked = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (const article of targets) {
    try {
      await rankAndPersist(article);
      ranked++;
    } catch (error) {
      errors.push({
        id: article.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return json(200, { ok: true, ranked, skipped: articles.length - targets.length, errors });
}

async function rankAndPersist(article: Article): Promise<Article> {
  const result = await rankArticle(article);
  const { relevanceRationale: _ignored, ...rest } = article as any;
  const updated: Article = {
    ...rest,
    relevanceScore: result.score,
    relevanceBucket: result.bucket,
    relevanceBreakdown: result.breakdown,
    relevanceSummary: result.summary,
    relevanceAngle: result.angle,
    rankedAt: new Date().toISOString(),
  };
  await saveArticle(updated);
  return updated;
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
