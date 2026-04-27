import type { SelectedArticle } from '../store';
import { saveDraft, getDraft } from '../store';
import { generateMockDraft } from '../mockGenerate';

export interface DraftViewCallbacks {
  onBack: () => void;
}

export function renderDraftView(
  container: HTMLElement,
  selected: SelectedArticle,
  callbacks: DraftViewCallbacks
): void {
  const { article, angle } = selected;
  const existing = getDraft(article.id);
  const html = existing?.html ?? saveDraft(article.id, generateMockDraft(article, angle)).html;

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'draft-view';
  wrapper.innerHTML = `
    <div class="draft-toolbar">
      <button class="btn-cancel" data-action="back">← Tilbage</button>
      <div class="draft-toolbar-right">
        <button class="btn-cancel" data-action="regenerate">Generer igen</button>
        <span class="wp-button-wrapper" data-tooltip="Sender til WordPress kræver Bonzai- og WordPress-credentials i Lambda. Ikke opsat endnu.">
          <button class="btn-keep" data-action="publish" disabled>Send til WordPress</button>
        </span>
      </div>
    </div>

    <div class="draft-meta">
      <div class="draft-meta-row">
        <span class="draft-meta-label">Kilde</span>
        <span class="draft-meta-value">
          <a href="${escape(article.url)}" target="_blank" rel="noopener" class="draft-source-link">
            ${escape(article.title)}
          </a>
        </span>
      </div>
      <div class="draft-meta-row">
        <span class="draft-meta-label">Vinkel</span>
        <span class="draft-meta-value">${angle ? escape(angle) : '<em>Ingen vinkel angivet</em>'}</span>
      </div>
      <div class="draft-meta-row">
        <span class="draft-meta-label">Status</span>
        <span class="draft-meta-value"><span class="demo-tag">Demo-udkast</span></span>
      </div>
    </div>

    <article class="draft-body" id="draft-body"></article>
  `;

  container.appendChild(wrapper);
  const body = wrapper.querySelector<HTMLElement>('#draft-body')!;
  body.innerHTML = html;

  wrapper.querySelector<HTMLButtonElement>('[data-action="back"]')!
    .addEventListener('click', () => callbacks.onBack());

  wrapper.querySelector<HTMLButtonElement>('[data-action="regenerate"]')!
    .addEventListener('click', () => {
      const fresh = generateMockDraft(article, angle);
      saveDraft(article.id, fresh);
      body.innerHTML = fresh;
    });
}

function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
