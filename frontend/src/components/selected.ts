import type { SelectedArticle } from '../store';
import { removeSelected, getDraft, updateAngle } from '../store';

const ARROW_SVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M2 10L10 2M5 2h5v5"/>
</svg>`;

export function buildSelectedCard(
  selected: SelectedArticle,
  onGenerate: (id: string) => void,
  onCancelGeneration: (id: string) => void,
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
    const generation = state.generation;
    const ideaTitle = state.article.suggestedTitle?.trim() || state.article.title;
    const ideaExcerpt = state.article.suggestedExcerpt?.trim();
    const isQueued = !draft && generation?.status === 'queued';
    const isGenerating = !draft && generation?.status === 'generating';
    const isFailed = !draft && generation?.status === 'failed';
    const isCanceled = !draft && generation?.status === 'canceled';
    const draftBadge = draft
      ? `<span class="draft-badge has-draft">Udkast klar</span>`
      : isQueued
        ? `<span class="draft-badge is-queued">I kø</span>`
        : isGenerating
        ? `<span class="draft-badge is-generating">Genererer…</span>`
        : isFailed
          ? `<span class="draft-badge is-failed">Fejlet</span>`
          : isCanceled
            ? `<span class="draft-badge is-queued">Stoppet</span>`
          : `<span class="draft-badge">Afventer</span>`;
    const generateLabel = draft ? 'Åbn udkast' : (isFailed || isCanceled) ? 'Prøv igen' : isQueued ? 'I kø' : 'Genererer…';
    const disabled = isQueued || isGenerating ? ' disabled' : '';

    card.innerHTML = `
      <div class="selected-head">
        <div class="selected-title-block">
          <a href="${escape(article.url)}" target="_blank" rel="noopener" class="selected-title-link">
            <div class="selected-title">${escape(ideaTitle)}</div>
          </a>
          ${ideaExcerpt ? `<div class="selected-excerpt">${escape(ideaExcerpt)}</div>` : ''}
          <a href="${escape(article.url)}" target="_blank" rel="noopener" class="card-source-link">
            Originalkilde: ${escape(hostname)} ${ARROW_SVG}
          </a>
        </div>
        ${draftBadge}
      </div>
      ${isQueued || isGenerating ? `
        <div class="selected-generation-status">
          <span class="loader-dot-pulse"></span>
          <span>${isQueued
            ? 'Artiklen står i kø og starter automatisk, når den aktuelle generering er færdig.'
            : 'Artiklen genereres i baggrunden. Du kan blive på siden eller arbejde videre imens.'}</span>
        </div>
      ` : ''}
      ${isFailed ? `
        <div class="selected-generation-status selected-generation-error">
          Generering fejlede${generation?.error ? `: ${escape(generation.error)}` : ''}.
        </div>
      ` : ''}
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
        <button class="btn-keep" type="button" data-action="generate"${disabled}>${generateLabel}</button>
        ${isQueued || isGenerating ? '<button class="btn-cancel" type="button" data-action="stop">Stop</button>' : ''}
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
      .addEventListener('click', () => {
        if (state.generation?.status === 'queued' || state.generation?.status === 'generating') return;
        onGenerate(state.article.id);
      });

    card.querySelector<HTMLButtonElement>('[data-action="stop"]')
      ?.addEventListener('click', () => onCancelGeneration(state.article.id));

    card.querySelector<HTMLButtonElement>('[data-action="return"]')!
      .addEventListener('click', () => {
        if (state.generation?.status === 'queued' || state.generation?.status === 'generating') {
          onCancelGeneration(state.article.id);
        }
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
