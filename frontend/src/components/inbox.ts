import type { Article } from '../types';
import { patchArticle } from '../api';
import { addSelected, isSelected } from '../store';
import { cleanTeaser } from '../utils/text';
import {
  brugbarhedScore,
  brugbarhedBucket,
  brugbarhedLabel,
  relevanceLabel,
  accessBucket,
  abstractLength,
  abstractQuality,
} from '../utils/scoring';

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

  const relevanceHtml = buildRelevanceBadge(article);
  const brugbarhedHtml = buildBrugbarhedBadge(article);
  const accessInfoHtml = buildAccessInfo(article);
  const summaryHtml = article.relevanceSummary
    ? `<div class="card-summary"><strong>Hvad handler det om:</strong> ${escapeHtml(article.relevanceSummary)}</div>`
    : '';
  const angleHtml = article.relevanceAngle
    ? `<div class="card-angle"><strong>Vinkel:</strong> ${escapeHtml(article.relevanceAngle)}</div>`
    : '';
  const breakdownHtml = buildBreakdown(article);
  const linksHtml = buildSourceLinks(article);

  card.innerHTML = `
    <div class="card-inner">
      <div class="card-content">
        <div class="card-badges">${relevanceHtml}${brugbarhedHtml}</div>
        <div class="card-title">${article.title}</div>
        <div class="card-description">${escapeHtml(cleanTeaser(article.teaser))}</div>
        ${summaryHtml}
        ${angleHtml}
        ${accessInfoHtml}
        ${breakdownHtml}
        ${linksHtml}
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
          <button class="btn-send" id="btn-send-${id}">Føj til behandling</button>
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

  btnSend.addEventListener('click', () => {
    const angle = angleInput.value.trim();
    if (isSelected(id)) {
      animateOut(card, () => onRemoved());
      return;
    }
    addSelected(article, angle);
    animateOut(card, () => onRemoved());
  });

  return card;
}

function animateOut(card: HTMLElement, callback: () => void): void {
  card.classList.add('removing');
  setTimeout(callback, 360);
}

function buildAccessInfo(article: Article): string {
  const oa = article.openAccess;
  const sourceHost = oa?.contentSourceHost || hostnameOf(oa?.contentSourceUrl) || hostnameOf(article.url);
  const sourceType = oa?.contentSourceType;

  if (oa?.canGenerate === false) {
    return `
      <div class="access-info access-unusable">
        <span class="access-info-dot"></span>
        <div class="access-info-body">
          <div class="access-info-title">Ingen brugbar adgang</div>
          <div class="access-info-detail">
            Vi fandt hverken fuldtekst eller et tilstrækkeligt abstract, som kan bruges sikkert til generering.
          </div>
        </div>
      </div>`;
  }

  if (accessBucket(article) === 'full') {
    const len = article.openAccess?.contentTextLength || 0;
    const isTruncated = len > 10000;
    const label = sourceType === 'original_fulltext'
      ? (isTruncated ? 'Uddrag af fuldtekst fra originalkilden' : 'Fuldtekst fra originalkilden')
      : (isTruncated ? 'Uddrag af fuldtekst fra Open Access-kilde' : 'Fuldtekst fra Open Access-kilde');
    const detail = isTruncated
      ? `Artiklen er ca. <strong>${formatNumber(len)} tegn</strong>. Et renset og prioriteret uddrag på ca. <strong>10.000 tegn</strong> bruges til generering${sourceHost ? ` (${escapeHtml(sourceHost)})` : ''}.`
      : `Hele tekstgrundlaget på ca. <strong>${formatNumber(len)} tegn</strong> bruges til generering${sourceHost ? ` (${escapeHtml(sourceHost)})` : ''}.`;
    return `
      <div class="access-info access-full">
        <span class="access-info-dot"></span>
        <div class="access-info-body">
          <div class="access-info-title">${label}</div>
          <div class="access-info-detail">${detail}</div>
        </div>
      </div>`;
  }

  const len = abstractLength(article);
  const quality = abstractQuality(len);
  const sourceLabel = abstractSourceLabel(sourceType);

  let detail: string;
  switch (quality) {
    case 'rich':
      detail = `${sourceLabel} på <strong>${formatNumber(len)} tegn</strong>${sourceHost ? ` (${escapeHtml(sourceHost)})` : ''}. Det er tekstgrundlaget for generering, ikke fuldtekst.`;
      break;
    case 'standard':
      detail = `${sourceLabel} på <strong>${formatNumber(len)} tegn</strong>${sourceHost ? ` (${escapeHtml(sourceHost)})` : ''}. Basis-grundlag, verificer mod originalen.`;
      break;
    case 'thin':
      detail = `${sourceLabel} — kun <strong>${formatNumber(len)} tegn</strong>. Begrænset materiale.`;
      break;
    case 'none':
    default:
      detail = `Ingen brugbar tekst fundet til generering.`;
      break;
  }

  return `
    <div class="access-info access-abstract">
      <span class="access-info-dot"></span>
      <div class="access-info-body">
        <div class="access-info-title">Abstract tilgængeligt</div>
        <div class="access-info-detail">${detail}</div>
      </div>
    </div>`;
}

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return null; }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('da-DK').format(value);
}

function buildSourceLinks(article: Article): string {
  const originalHost = hostnameOf(article.url) || article.url;
  const oaUrl = article.openAccess?.oaUrl;
  const oaHost = hostnameOf(oaUrl);
  const showOa = oaUrl && oaUrl !== article.url && oaHost !== originalHost;
  const contentUrl = article.openAccess?.contentSourceUrl;
  const contentSourceIsOriginal = contentUrl === article.url;
  const contentSourceIsOa = !!oaUrl && contentUrl === oaUrl;
  const sourceType = article.openAccess?.contentSourceType;
  const sourceIsFulltext = sourceType === 'original_fulltext' || sourceType === 'oa_fulltext';

  const originalLink = `
    <a href="${article.url}" target="_blank" rel="noopener" class="card-source-link source-original${contentSourceIsOriginal && sourceIsFulltext ? ' source-used' : ''}">
      <span class="source-link-label">Original</span>
      <span class="source-link-host">${escapeHtml(originalHost)}</span>
      ${contentSourceIsOriginal && sourceIsFulltext ? '<span class="source-link-badge source-link-badge-full">Fuldtekst bruges</span>' : ''}
      ${ARROW_SVG}
    </a>`;

  if (!showOa) return `<div class="source-links">${originalLink}</div>`;

  const oaTooltipMarker = article.openAccess?.hasUsableFulltext
    ? '<span class="source-link-badge source-link-badge-full">Fuldtekst</span>'
    : '<span class="source-link-badge source-link-badge-oa">Open Access</span>';

  const oaLink = `
    <a href="${oaUrl}" target="_blank" rel="noopener" class="card-source-link source-oa${contentSourceIsOa ? ' source-used' : ''}">
      <span class="source-link-label">Open Access</span>
      <span class="source-link-host">${escapeHtml(oaHost!)}</span>
      ${contentSourceIsOa ? '<span class="source-link-badge source-link-badge-full">Fuldtekst bruges</span>' : oaTooltipMarker}
      ${ARROW_SVG}
    </a>`;

  return `<div class="source-links">${originalLink}${oaLink}</div>`;
}

function abstractSourceLabel(sourceType: string | null | undefined): string {
  switch (sourceType) {
    case 'original_abstract':
      return 'Abstract fra originalkilden';
    case 'openalex_abstract':
      return 'Abstract fra OpenAlex-metadata';
    case 'crossref_abstract':
      return 'Abstract fra Crossref-metadata';
    default:
      return 'Abstract';
  }
}

function buildRelevanceBadge(article: Article): string {
  if (article.relevanceScore == null || article.relevanceBucket == null) {
    return `<div class="rank-badge rank-pending">Ikke rangeret</div>`;
  }
  const label = relevanceLabel(article.relevanceBucket);
  return `
    <div class="rank-badge rank-relevance rank-${article.relevanceBucket}">
      <span class="rank-score">${article.relevanceScore}</span>
      <span class="rank-label">${label}</span>
    </div>`;
}

function buildBrugbarhedBadge(article: Article): string {
  if (article.relevanceScore == null) return '';
  const score = brugbarhedScore(article);
  const bucket = brugbarhedBucket(score);
  const label = brugbarhedLabel(bucket);
  return `
    <div class="rank-badge rank-brugbarhed rank-${bucket}">
      <span class="rank-score">${score}</span>
      <span class="rank-label">${label}</span>
    </div>`;
}

const PARAM_LABELS: Record<string, string> = {
  kontraintuitiv_faktor: 'Kontraintuitiv',
  universalitet: 'Universalitet',
  forklarbarhed: 'Forklarbarhed',
  nyhedsgrad: 'Nyhedsgrad',
  konkret_konsekvens: 'Konsekvens',
  kildernes_trovaerdighed: 'Troværdighed',
};

function buildBreakdown(article: Article): string {
  if (!article.relevanceBreakdown) return '';
  const items = Object.entries(article.relevanceBreakdown)
    .map(([key, value]) => {
      const label = PARAM_LABELS[key] ?? key;
      return `<span class="breakdown-item"><span class="breakdown-label">${label}</span><span class="breakdown-value">${value}/5</span></span>`;
    })
    .join('');
  return `<div class="card-breakdown">${items}</div>`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
