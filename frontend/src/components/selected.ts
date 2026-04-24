import type { SelectedArticle } from '../store';
import { removeSelected, getDraft } from '../store';

const ARROW_SVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M2 10L10 2M5 2h5v5"/>
</svg>`;

export function buildSelectedCard(
  selected: SelectedArticle,
  onGenerate: (id: string) => void,
  onReturn: () => void
): HTMLElement {
  const { article, angle } = selected;
  const card = document.createElement('div');
  card.className = 'selected-card';
  card.id = `selected-${article.id}`;

  const hostname = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return article.url; }
  })();

  const draft = getDraft(article.id);
  const draftBadge = draft
    ? `<span class="draft-badge has-draft">Udkast klar</span>`
    : `<span class="draft-badge">Intet udkast</span>`;

  const generateLabel = draft ? 'Åbn udkast' : 'Generer udkast';

  card.innerHTML = `
    <div class="selected-head">
      <div class="selected-title-block">
        <div class="selected-title">${escape(article.title)}</div>
        <a href="${article.url}" target="_blank" rel="noopener" class="card-source-link">
          Læs original på ${escape(hostname)} ${ARROW_SVG}
        </a>
      </div>
      ${draftBadge}
    </div>
    <div class="selected-angle">
      <div class="selected-angle-label">Vinkel</div>
      <div class="selected-angle-text">${angle ? escape(angle) : '<em>Ingen vinkel angivet</em>'}</div>
    </div>
    <div class="selected-actions">
      <button class="btn-keep" data-action="generate">${generateLabel}</button>
      <button class="btn-ignore" data-action="return">Returner til inbox</button>
    </div>`;

  card.querySelector<HTMLButtonElement>('[data-action="generate"]')!
    .addEventListener('click', () => onGenerate(article.id));

  card.querySelector<HTMLButtonElement>('[data-action="return"]')!
    .addEventListener('click', () => {
      removeSelected(article.id);
      card.remove();
      onReturn();
    });

  return card;
}

function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
