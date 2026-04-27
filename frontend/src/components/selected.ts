import type { SelectedArticle } from '../store';
import { removeSelected, getDraft, updateAngle } from '../store';

const ARROW_SVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M2 10L10 2M5 2h5v5"/>
</svg>`;

export function buildSelectedCard(
  selected: SelectedArticle,
  onGenerate: (id: string) => void,
  onChange: () => void
): HTMLElement {
  const { article } = selected;
  const card = document.createElement('div');
  card.className = 'selected-card';
  card.id = `selected-${article.id}`;

  const hostname = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return article.url; }
  })();

  render(selected);
  return card;

  function render(state: SelectedArticle): void {
    const draft = getDraft(state.article.id);
    const draftBadge = draft
      ? `<span class="draft-badge has-draft">Udkast klar</span>`
      : `<span class="draft-badge">Intet udkast</span>`;
    const generateLabel = draft ? 'Åbn udkast' : 'Generer udkast';

    card.innerHTML = `
      <div class="selected-head">
        <div class="selected-title-block">
          <a href="${escape(article.url)}" target="_blank" rel="noopener" class="selected-title-link">
            <div class="selected-title">${escape(article.title)}</div>
          </a>
          <a href="${escape(article.url)}" target="_blank" rel="noopener" class="card-source-link">
            Læs original på ${escape(hostname)} ${ARROW_SVG}
          </a>
        </div>
        ${draftBadge}
      </div>
      <div class="selected-angle" data-mode="view">
        <div class="selected-angle-header">
          <span class="selected-angle-label">Vinkel</span>
          <button class="selected-angle-edit" type="button" data-action="edit">Rediger</button>
        </div>
        <div class="selected-angle-text">${state.angle ? escape(state.angle) : '<em>Ingen vinkel angivet</em>'}</div>
        <div class="selected-angle-edit-zone">
          <textarea class="angle-input" rows="3" data-role="angle-input" placeholder="Hvad er vinklen på denne artikel?">${escape(state.angle)}</textarea>
          <div class="selected-angle-edit-buttons">
            <button class="btn-send" type="button" data-action="save">Gem vinkel</button>
            <button class="btn-cancel" type="button" data-action="cancel">Annuller</button>
          </div>
        </div>
      </div>
      <div class="selected-actions">
        <button class="btn-keep" type="button" data-action="generate">${generateLabel}</button>
        <button class="btn-ignore" type="button" data-action="return">Returner til inbox</button>
      </div>`;

    bindHandlers(state);
  }

  function bindHandlers(state: SelectedArticle): void {
    const angleZone = card.querySelector<HTMLElement>('.selected-angle')!;
    const textarea = card.querySelector<HTMLTextAreaElement>('[data-role="angle-input"]')!;

    card.querySelector<HTMLButtonElement>('[data-action="edit"]')!
      .addEventListener('click', () => {
        angleZone.dataset.mode = 'edit';
        textarea.value = state.angle;
        setTimeout(() => textarea.focus(), 0);
      });

    card.querySelector<HTMLButtonElement>('[data-action="cancel"]')!
      .addEventListener('click', () => {
        angleZone.dataset.mode = 'view';
        textarea.value = state.angle;
      });

    card.querySelector<HTMLButtonElement>('[data-action="save"]')!
      .addEventListener('click', () => {
        const newAngle = textarea.value.trim();
        if (newAngle === state.angle) {
          angleZone.dataset.mode = 'view';
          return;
        }
        const updated = updateAngle(state.article.id, newAngle);
        if (!updated) return;
        render(updated);
        onChange();
      });

    card.querySelector<HTMLButtonElement>('[data-action="generate"]')!
      .addEventListener('click', () => onGenerate(state.article.id));

    card.querySelector<HTMLButtonElement>('[data-action="return"]')!
      .addEventListener('click', () => {
        removeSelected(state.article.id);
        card.remove();
        onChange();
      });
  }
}

function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
