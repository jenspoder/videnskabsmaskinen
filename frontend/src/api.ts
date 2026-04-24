import type { Article } from './types';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
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
