import type { Article } from '../types';
import { patchArticle, processArticle } from '../api';

const PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
  <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-6-6z"/>
  <polyline points="9 3 9 9 15 9"/>
  <line x1="12" y1="13" x2="12" y2="17"/>
  <line x1="10" y1="15" x2="14" y2="15"/>
</svg>`;

const ARROW_SVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M2 10L10 2M5 2h5v5"/>
</svg>`;

export function buildInboxCard(
  article: Article,
  onRemoved: () => void,
  getOpenId: () => string | null,
  setOpenId: (id: string | null) => void
): HTMLElement {
  const id = article.id;
  const card = document.createElement('div');
  card.className = 'article-card';
  card.id = `card-${id}`;

  const hostname = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return article.url; }
  })();

  card.innerHTML = `
    <div class="card-inner">
      <div class="card-image">${PLACEHOLDER_SVG}</div>
      <div class="card-content">
        <div class="card-title">${article.title}</div>
        <div class="card-description">${article.teaser || ''}</div>
        <a href="${article.url}" target="_blank" rel="noopener" class="card-source-link">
          Læs original på ${hostname} ${ARROW_SVG}
        </a>
      </div>
    </div>
    <div class="card-actions" id="actions-${id}">
      <button class="btn-keep" id="btn-keep-${id}">Behold</button>
      <button class="btn-ignore" id="btn-ignore-${id}">Ignorer</button>
    </div>
    <div class="angle-zone" id="angle-${id}">
      <div class="angle-zone-inner">
        <div class="angle-wrapper">
          <label for="angle-input-${id}">Din vinkel</label>
          <textarea class="angle-input" id="angle-input-${id}" rows="4"
            placeholder="Hvad er vinklen på denne artikel?"></textarea>
        </div>
        <div class="angle-buttons">
          <button class="btn-send" id="btn-send-${id}">Send</button>
          <button class="btn-cancel" id="btn-cancel-${id}">Annuller</button>
        </div>
      </div>
    </div>`;

  const actionsEl = card.querySelector<HTMLElement>(`#actions-${id}`)!;
  const angleZone = card.querySelector<HTMLElement>(`#angle-${id}`)!;
  const angleInput = card.querySelector<HTMLTextAreaElement>(`#angle-input-${id}`)!;
  const btnSend = card.querySelector<HTMLButtonElement>(`#btn-send-${id}`)!;

  card.querySelector(`#btn-keep-${id}`)!.addEventListener('click', () => {
    // Luk evt. anden åben zone
    const currentOpen = getOpenId();
    if (currentOpen && currentOpen !== id) {
      const otherZone = document.getElementById(`angle-${currentOpen}`);
      const otherActions = document.getElementById(`actions-${currentOpen}`);
      otherZone?.classList.remove('open');
      if (otherActions) otherActions.style.display = '';
    }
    setOpenId(id);
    actionsEl.style.display = 'none';
    angleZone.classList.add('open');
    setTimeout(() => angleInput.focus(), 320);
  });

  card.querySelector(`#btn-cancel-${id}`)!.addEventListener('click', () => {
    angleZone.classList.remove('open');
    angleInput.value = '';
    actionsEl.style.display = '';
    setOpenId(null);
  });

  card.querySelector(`#btn-ignore-${id}`)!.addEventListener('click', async () => {
    animateOut(card, async () => {
      await patchArticle(id, { status: 'ignored' });
      onRemoved();
    });
  });

  btnSend.addEventListener('click', async () => {
    const angle = angleInput.value.trim();
    btnSend.textContent = 'Behandler…';
    btnSend.disabled = true;

    try {
      await processArticle(id, angle);
      animateOut(card, () => onRemoved());
    } catch (err) {
      console.error(err);
      alert(`Fejl ved behandling: ${err instanceof Error ? err.message : 'Ukendt fejl'}`);
      btnSend.textContent = 'Send';
      btnSend.disabled = false;
    }
  });

  return card;
}

function animateOut(card: HTMLElement, callback: () => void): void {
  card.classList.add('removing');
  setTimeout(callback, 360);
}
