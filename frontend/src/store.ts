import type { Article } from './types';

const KEY_SELECTED = 'sma.selectedArticles.v1';
const KEY_DRAFTS = 'sma.drafts.v1';

export interface SelectedArticle {
  article: Article;
  angle: string;
  selectedAt: string;
}

export interface DraftRecord {
  articleId: string;
  html: string;
  generatedAt: string;
}

export function getSelected(): SelectedArticle[] {
  return readJson<SelectedArticle[]>(KEY_SELECTED, []);
}

export function isSelected(id: string): boolean {
  return getSelected().some((s) => s.article.id === id);
}

export function addSelected(article: Article, angle: string): void {
  const list = getSelected();
  if (list.some((s) => s.article.id === article.id)) return;
  list.unshift({ article, angle, selectedAt: new Date().toISOString() });
  writeJson(KEY_SELECTED, list);
}

export function removeSelected(id: string): void {
  const list = getSelected().filter((s) => s.article.id !== id);
  writeJson(KEY_SELECTED, list);
  removeDraft(id);
}

export function getDraft(id: string): DraftRecord | null {
  const drafts = readJson<DraftRecord[]>(KEY_DRAFTS, []);
  return drafts.find((d) => d.articleId === id) ?? null;
}

export function saveDraft(articleId: string, html: string): DraftRecord {
  const drafts = readJson<DraftRecord[]>(KEY_DRAFTS, []);
  const filtered = drafts.filter((d) => d.articleId !== articleId);
  const record: DraftRecord = {
    articleId,
    html,
    generatedAt: new Date().toISOString(),
  };
  filtered.unshift(record);
  writeJson(KEY_DRAFTS, filtered);
  return record;
}

export function removeDraft(articleId: string): void {
  const drafts = readJson<DraftRecord[]>(KEY_DRAFTS, []);
  writeJson(
    KEY_DRAFTS,
    drafts.filter((d) => d.articleId !== articleId)
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Kunne ikke skrive til localStorage:', err);
  }
}
