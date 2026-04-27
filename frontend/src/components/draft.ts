import type { SelectedArticle } from '../store';
import { saveDraft, getDraft } from '../store';
import { generateMockDraft } from '../mockGenerate';
import { generateDraft as generateDraftViaApi } from '../api';

export interface DraftViewCallbacks {
  onBack: () => void;
}

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND_GENERATION === 'true';

export function renderDraftView(
  container: HTMLElement,
  selected: SelectedArticle,
  callbacks: DraftViewCallbacks
): void {
  const { article, angle } = selected;

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
        <span class="draft-meta-value">
          <span class="demo-tag">${USE_BACKEND ? 'Bonzai-udkast' : 'Demo-udkast'}</span>
        </span>
      </div>
    </div>

    <article class="draft-body" id="draft-body"></article>
  `;

  container.appendChild(wrapper);
  const body = wrapper.querySelector<HTMLElement>('#draft-body')!;
  const regenerateBtn = wrapper.querySelector<HTMLButtonElement>('[data-action="regenerate"]')!;

  const renderHtml = (html: string): void => {
    body.innerHTML = html;
  };

  const showLoading = (): void => {
    body.innerHTML = `<p><em>Genererer artikel via Bonzai…</em></p>`;
  };

  const showError = (message: string): void => {
    body.innerHTML = `<p><em>Kunne ikke generere via Bonzai: ${escape(message)}.</em></p><p><em>Falder tilbage til mock-udkastet:</em></p>${generateMockDraft(article, angle)}`;
  };

  const generate = async (force: boolean): Promise<void> => {
    if (!force) {
      const existing = getDraft(article.id);
      if (existing) {
        renderHtml(existing.html);
        return;
      }
    }

    if (!USE_BACKEND) {
      const mock = generateMockDraft(article, angle);
      saveDraft(article.id, mock);
      renderHtml(mock);
      return;
    }

    regenerateBtn.disabled = true;
    showLoading();
    try {
      const result = await generateDraftViaApi(article.id, angle);
      saveDraft(article.id, result.html);
      renderHtml(result.html);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ukendt fejl';
      showError(message);
    } finally {
      regenerateBtn.disabled = false;
    }
  };

  void generate(false);

  wrapper.querySelector<HTMLButtonElement>('[data-action="back"]')!
    .addEventListener('click', () => callbacks.onBack());

  regenerateBtn.addEventListener('click', () => {
    void generate(true);
  });
}

function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
