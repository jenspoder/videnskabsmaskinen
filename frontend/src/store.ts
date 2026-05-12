import type { Article } from './types';

const KEY_SELECTED = 'sma.selectedArticles.v1';
const KEY_DRAFTS = 'sma.drafts.v1';

export interface SelectedArticle {
  article: Article;
  angle: string;
  selectedAt: string;
  generation?: GenerationState;
}

export interface DraftRecord {
  articleId: string;
  html: string;
  generatedAt: string;
}

export interface GenerationState {
  status: 'queued' | 'generating' | 'completed' | 'failed' | 'canceled';
  jobId?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
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
  list.unshift({
    article,
    angle,
    selectedAt: new Date().toISOString(),
    generation: {
      status: 'queued',
      updatedAt: new Date().toISOString(),
    },
  });
  writeJson(KEY_SELECTED, list);
}

export function setGenerationState(id: string, generation: GenerationState): SelectedArticle | null {
  const list = getSelected();
  const idx = list.findIndex((s) => s.article.id === id);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    generation: {
      ...generation,
      updatedAt: new Date().toISOString(),
    },
  };
  writeJson(KEY_SELECTED, list);
  return list[idx];
}

export function removeSelected(id: string): void {
  const list = getSelected().filter((s) => s.article.id !== id);
  writeJson(KEY_SELECTED, list);
  removeDraft(id);
}

export function updateAngle(id: string, angle: string): SelectedArticle | null {
  const list = getSelected();
  const idx = list.findIndex((s) => s.article.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], angle };
  writeJson(KEY_SELECTED, list);
  removeDraft(id);
  return list[idx];
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
  const selected = getSelected().find((s) => s.article.id === articleId);
  if (selected) {
    setGenerationState(articleId, {
      ...(selected.generation ?? {}),
      status: 'completed',
    });
  }
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
