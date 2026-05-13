import type { Article } from '../types';

const WP_URL = (process.env.WORDPRESS_URL || '').replace(/\/$/, '');
const WP_USER = process.env.WORDPRESS_USER || '';
const WP_APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD || '';

const DEFAULT_CATEGORY_SLUG = 'ny-viden';

function authHeader(): string {
  return `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64')}`;
}

export function isWordPressConfigured(): boolean {
  return Boolean(WP_URL && WP_USER && WP_APP_PASSWORD);
}

interface WpPostResponse {
  id: number;
  link?: string;
}

async function wpJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${WP_URL}/wp-json/wp/v2${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WordPress API fejl ${res.status}: ${text.slice(0, 800)}`);
  }
  return JSON.parse(text) as T;
}

/**
 * Slug matcher kategorisiden Ny viden (fx /category/ny-viden/).
 * Overstyr med WORDPRESS_CATEGORY_ID (tal) eller WORDPRESS_CATEGORY_SLUG.
 */
export async function resolvePublishCategoryId(): Promise<number | null> {
  const fromEnv = process.env.WORDPRESS_CATEGORY_ID?.trim();
  if (fromEnv) {
    const n = parseInt(fromEnv, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }

  const slug = (process.env.WORDPRESS_CATEGORY_SLUG || DEFAULT_CATEGORY_SLUG).trim() || DEFAULT_CATEGORY_SLUG;
  const rows = await wpJson<Array<{ id: number }>>(`/categories?slug=${encodeURIComponent(slug)}`, { method: 'GET' });
  const id = rows[0]?.id;
  return typeof id === 'number' ? id : null;
}

export async function createWordPressDraft(title: string, content: string): Promise<number> {
  const post = await wpJson<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify({ title, content, status: 'draft' }),
  });
  return post.id;
}

export async function publishWordPressPost(
  title: string,
  content: string,
  categoryIds: number[]
): Promise<{ id: number; link: string }> {
  const post = await wpJson<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify({
      title,
      content,
      status: 'publish',
      categories: categoryIds,
    }),
  });
  const link =
    post.link && post.link.startsWith('http')
      ? post.link
      : `${WP_URL}/?p=${post.id}`;
  return { id: post.id, link };
}
