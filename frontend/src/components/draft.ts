import type { SelectedArticle } from '../store';
import { saveDraft, getDraft } from '../store';
import { generateMockDraft } from '../mockGenerate';
import { generateDraft as generateDraftViaApi } from '../api';
import type { GenerateDraftJob } from '../api';

export interface DraftViewCallbacks {
  onBack: () => void;
}

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND_GENERATION === 'true';

type LoaderStage = 'fetching' | 'generating' | 'rendering';

const STATUS_MESSAGES: ReadonlyArray<{ atSeconds: number; text: string }> = [
  { atSeconds: 0,   text: 'Forbinder til Bonzai…' },
  { atSeconds: 3,   text: 'Henter brødtekst fra kilden…' },
  { atSeconds: 8,   text: 'Bonzai-assistenten læser artiklen…' },
  { atSeconds: 16,  text: 'Komponerer overskrift og lede…' },
  { atSeconds: 28,  text: 'Skriver brødtekst…' },
  { atSeconds: 42,  text: 'Tilføjer kildehenvisninger…' },
  { atSeconds: 55,  text: 'Finsliber tekst…' },
  { atSeconds: 75,  text: 'Næsten færdig…' },
  { atSeconds: 110, text: 'Det varer længere end normalt – afvent endnu lidt…' },
];

function pickStatus(elapsedSec: number): string {
  let chosen = STATUS_MESSAGES[0].text;
  for (const m of STATUS_MESSAGES) {
    if (elapsedSec >= m.atSeconds) chosen = m.text;
    else break;
  }
  return chosen;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface TypewriterOptions {
  charsPerTick?: number;
  tickMs?: number;
  signal?: AbortSignal;
}

async function typewriterRender(
  target: HTMLElement,
  html: string,
  opts: TypewriterOptions = {}
): Promise<void> {
  const charsPerTick = opts.charsPerTick ?? 6;
  const tickMs = opts.tickMs ?? 14;

  target.innerHTML = '';

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const typeChildren = async (
    sourceNodes: ChildNode[],
    destParent: Node
  ): Promise<void> => {
    for (const node of sourceNodes) {
      if (opts.signal?.aborted) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        const textNode = document.createTextNode('');
        destParent.appendChild(textNode);
        for (let i = 0; i < text.length; i += charsPerTick) {
          if (opts.signal?.aborted) {
            textNode.textContent = text;
            return;
          }
          textNode.textContent = text.slice(0, Math.min(i + charsPerTick, text.length));
          if (i + charsPerTick < text.length) {
            await sleep(tickMs);
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const src = node as Element;
        const clone = document.createElement(src.tagName.toLowerCase());
        for (const attr of Array.from(src.attributes)) {
          clone.setAttribute(attr.name, attr.value);
        }
        destParent.appendChild(clone);
        await typeChildren(Array.from(src.childNodes), clone);
      }
    }
  };

  await typeChildren(Array.from(tmp.childNodes), target);
}

interface LoaderHandle {
  update: (sec: number, stage?: LoaderStage) => void;
}

function showLoader(body: HTMLElement): LoaderHandle {
  body.innerHTML = `
    <div class="generation-loader">
      <div class="loader-status">
        <span class="loader-dot-pulse"></span>
        <span class="loader-status-text" data-loader="text">${pickStatus(0)}</span>
      </div>
      <div class="loader-bar"><div class="loader-bar-fill"></div></div>
      <div class="loader-meta">
        <span data-loader="elapsed">0s</span>
        <span class="loader-divider">·</span>
        <span>forventet 30–60s</span>
      </div>
      <ul class="loader-steps">
        <li class="loader-step done"   data-loader-step="fetching">Henter kildens brødtekst</li>
        <li class="loader-step active" data-loader-step="generating">Bonzai genererer artikel</li>
        <li class="loader-step"        data-loader-step="rendering">Renderer udkast</li>
      </ul>
    </div>
  `;

  const textEl = body.querySelector<HTMLElement>('[data-loader="text"]')!;
  const elapsedEl = body.querySelector<HTMLElement>('[data-loader="elapsed"]')!;
  const stepFetch = body.querySelector<HTMLElement>('[data-loader-step="fetching"]')!;
  const stepGen = body.querySelector<HTMLElement>('[data-loader-step="generating"]')!;
  const stepRend = body.querySelector<HTMLElement>('[data-loader-step="rendering"]')!;

  let lastText = textEl.textContent ?? '';

  const setStep = (el: HTMLElement, state: 'pending' | 'active' | 'done'): void => {
    el.classList.toggle('active', state === 'active');
    el.classList.toggle('done', state === 'done');
  };

  return {
    update: (sec: number, stage: LoaderStage = 'generating') => {
      elapsedEl.textContent = `${sec}s`;

      const newText = pickStatus(sec);
      if (newText !== lastText) {
        textEl.classList.add('fade');
        window.setTimeout(() => {
          textEl.textContent = newText;
          textEl.classList.remove('fade');
        }, 250);
        lastText = newText;
      }

      if (stage === 'fetching') {
        setStep(stepFetch, 'active');
        setStep(stepGen, 'pending');
        setStep(stepRend, 'pending');
      } else if (stage === 'generating') {
        setStep(stepFetch, 'done');
        setStep(stepGen, 'active');
        setStep(stepRend, 'pending');
      } else {
        setStep(stepFetch, 'done');
        setStep(stepGen, 'done');
        setStep(stepRend, 'active');
      }
    },
  };
}

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

  let typewriterAbort: AbortController | null = null;

  const renderHtmlInstant = (html: string): void => {
    body.innerHTML = html;
  };

  const renderHtmlAnimated = async (html: string): Promise<void> => {
    if (prefersReducedMotion()) {
      renderHtmlInstant(html);
      return;
    }
    if (typewriterAbort) typewriterAbort.abort();
    typewriterAbort = new AbortController();
    await typewriterRender(body, html, { signal: typewriterAbort.signal });
    typewriterAbort = null;
  };

  const showError = (message: string): void => {
    body.innerHTML = `<p><em>Kunne ikke generere via Bonzai: ${escape(message)}.</em></p><p><em>Falder tilbage til mock-udkastet:</em></p>${generateMockDraft(article, angle)}`;
  };

  const generate = async (force: boolean): Promise<void> => {
    if (!force) {
      const existing = getDraft(article.id);
      if (existing) {
        renderHtmlInstant(existing.html);
        return;
      }
    }

    if (!USE_BACKEND) {
      const mock = generateMockDraft(article, angle);
      saveDraft(article.id, mock);
      await renderHtmlAnimated(mock);
      return;
    }

    regenerateBtn.disabled = true;
    const startedAt = Date.now();
    const loader = showLoader(body);
    const tick = window.setInterval(() => {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      loader.update(sec, 'generating');
    }, 1000);

    try {
      const onProgress = (_job: GenerateDraftJob): void => {
        const sec = Math.round((Date.now() - startedAt) / 1000);
        loader.update(sec, 'generating');
      };
      const result = await generateDraftViaApi(article.id, angle, onProgress);
      const html = result.html ?? '';
      saveDraft(article.id, html);

      window.clearInterval(tick);
      const sec = Math.round((Date.now() - startedAt) / 1000);
      loader.update(sec, 'rendering');
      await sleep(350);

      await renderHtmlAnimated(html);
    } catch (error) {
      window.clearInterval(tick);
      const message = error instanceof Error ? error.message : 'Ukendt fejl';
      showError(message);
    } finally {
      window.clearInterval(tick);
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
