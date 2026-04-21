import type { Article } from '../types';
import { patchArticle } from '../api';

const STATUS_LABELS: Record<string, string> = {
  ignored: 'Ignoreret',
  processing: 'Behandler…',
  published: 'Publiceret',
  new: 'Ny',
};

const STATUS_CLASS: Record<string, string> = {
  ignored: 'ignored',
  published: 'kept',
  processing: 'processing',
  new: 'ignored',
};

export function buildArchiveCard(article: Article, onReturned: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'archive-card';
  card.id = `archive-card-${article.id}`;

  const label = STATUS_LABELS[article.status] ?? article.status;
  const cls = STATUS_CLASS[article.status] ?? 'ignored';
  const angleHtml =
    article.status === 'published' && article.angle
      ? `<div class="archive-angle">«${article.angle}»</div>`
      : '';

  card.innerHTML = `
    <span class="archive-badge ${cls}">${label}</span>
    <div class="archive-body">
      <div class="archive-title">${article.title}</div>
      ${angleHtml}
    </div>
    <button class="btn-return">Returner</button>`;

  card.querySelector('.btn-return')!.addEventListener('click', async () => {
    await patchArticle(article.id, { status: 'new' });
    card.remove();
    onReturned();
  });

  return card;
}
