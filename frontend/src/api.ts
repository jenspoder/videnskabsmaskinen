import type { Article } from './types';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  // 202 (Accepted) er en gyldig succes-status for asynkrone jobs.
  if (!res.ok && res.status !== 202) {
    const text = await res.text().catch(() => '');
    throw new Error(`API fejl ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function listArticles(status: 'inbox' | 'reviewed'): Promise<Article[]> {
  const data = await request<{ articles: Article[] }>(`/articles?status=${status}`);
  return data.articles;
}

export async function patchArticle(
  id: string,
  patch: { status?: string; angle?: string }
): Promise<Article> {
  return request<Article>(`/articles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function processArticle(
  id: string,
  angle: string
): Promise<{ article: Article; wordpressPostId: number }> {
  return request(`/articles/${id}/process`, {
    method: 'POST',
    body: JSON.stringify({ angle }),
  });
}

export interface GenerateDraftJob {
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

/**
 * Starter en asynkron Bonzai-generering. Returnerer et jobId straks.
 * Brug pollGenerateDraft() til at hente det færdige resultat.
 */
export async function startGenerateDraft(id: string, angle: string): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(`/articles/${id}/generate-draft`, {
    method: 'POST',
    body: JSON.stringify({ angle }),
  });
}

export async function getDraftJob(jobId: string): Promise<GenerateDraftJob> {
  return request<GenerateDraftJob>(`/jobs/${jobId}`);
}

/**
 * Poller et generation-job til det er completed eller failed. Default
 * timeout er 90s med poll-interval på 2.5s. onProgress kaldes på hvert
 * tjek - brug det til at vise en spinner i UI'en.
 */
export async function pollGenerateDraft(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number; onProgress?: (job: GenerateDraftJob) => void } = {}
): Promise<GenerateDraftJob> {
  const interval = options.intervalMs ?? 2500;
  const timeout = options.timeoutMs ?? 180_000;
  const start = Date.now();

  while (true) {
    const job = await getDraftJob(jobId);
    options.onProgress?.(job);

    if (job.status === 'completed' || job.status === 'failed') return job;

    if (Date.now() - start > timeout) {
      throw new Error(`Timeout efter ${Math.round(timeout / 1000)}s - jobbet kører stadig`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Convenience wrapper: start + poll til færdig. Bruges fra draft-viewet
 * når man bare vil have HTML'en.
 */
export async function generateDraft(
  id: string,
  angle: string,
  onProgress?: (job: GenerateDraftJob) => void
): Promise<GenerateDraftJob> {
  const { jobId } = await startGenerateDraft(id, angle);
  const job = await pollGenerateDraft(jobId, { onProgress });
  if (job.status === 'failed') {
    throw new Error(job.error ?? 'Generering fejlede uden fejlmeddelelse');
  }
  return job;
}

export async function triggerCrawl(): Promise<void> {
  await request('/crawl', { method: 'POST' });
}

export async function rankArticle(id: string): Promise<Article> {
  return request<Article>(`/articles/${id}/rank`, { method: 'POST' });
}

export interface RankInboxResult {
  ok: boolean;
  ranked: number;
  skipped: number;
  errors: Array<{ id: string; message: string }>;
}

export async function rankInbox(force = false): Promise<RankInboxResult> {
  const qs = force ? '?force=true' : '';
  return request<RankInboxResult>(`/articles/rank${qs}`, { method: 'POST' });
}
