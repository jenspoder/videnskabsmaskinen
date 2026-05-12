import type { Article } from './types';
import { listArticles, triggerCrawl } from './api';
import { buildInboxCard } from './components/inbox';
import { buildArchiveCard } from './components/archive';
import { buildSelectedCard } from './components/selected';
import { renderDraftView } from './components/draft';
import { mockRankArticle } from './mockRank';
import { getSelected, isSelected } from './store';
import { accessBucket, brugbarhedScore, isGeneratable, type AccessBucket } from './utils/scoring';

let inboxArticles: Article[] = [];
let openAngleId: string | null = null;
const activeBuckets: Set<AccessBucket> = new Set(['full', 'abstract']);
type SortMode = 'relevance' | 'brugbarhed';
let sortMode: SortMode = 'relevance';
let showUnusable = false;

const PAGE_SIZE = 25;
let currentPage = 1;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const inboxBadge = document.getElementById('inbox-badge')!;
const arkivBadge = document.getElementById('arkiv-badge')!;
const tilBehandlingBadge = document.getElementById('til-behandling-badge')!;
const articleList = document.getElementById('article-list')!;
const archiveList = document.getElementById('archive-list')!;
const selectedList = document.getElementById('selected-list')!;
const draftContainer = document.getElementById('draft-container')!;
const doneMessage = document.getElementById('done-message')!;
const inboxLoading = document.getElementById('inbox-loading')!;

// ── Badges ────────────────────────────────────────────────────────────────────
async function refreshBadges(): Promise<void> {
  const [inbox, reviewed] = await Promise.all([
    listArticles('inbox'),
    listArticles('reviewed'),
  ]);
  const selectedIds = new Set(getSelected().map((s) => s.article.id));
  const inboxRemaining = inbox.filter((a) => !selectedIds.has(a.id) && isGeneratable(a)).length;
  inboxBadge.textContent = String(inboxRemaining);
  arkivBadge.textContent = String(reviewed.length);
  tilBehandlingBadge.textContent = String(selectedIds.size);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
function visibleInboxArticles(): Article[] {
  return inboxArticles.filter((a) => {
    if (!isGeneratable(a)) return showUnusable;
    return activeBuckets.has(accessBucket(a));
  });
}

function updateFilterCounts(): void {
  const counts: Record<AccessBucket, number> = { full: 0, abstract: 0 };
  let unusable = 0;
  for (const a of inboxArticles) {
    if (!isGeneratable(a)) {
      unusable++;
      continue;
    }
    counts[accessBucket(a)]++;
  }
  for (const bucket of ['full', 'abstract'] as const) {
    const el = document.querySelector(`[data-count="${bucket}"]`);
    if (el) el.textContent = String(counts[bucket]);
  }
  const unusableEl = document.querySelector('[data-count="unusable"]');
  if (unusableEl) unusableEl.textContent = String(unusable);
}

async function renderInbox(): Promise<void> {
  inboxLoading.style.display = 'block';
  articleList.innerHTML = '';
  doneMessage.classList.remove('visible');

  try {
    const all = await listArticles('inbox');
    inboxArticles = all.filter((a) => !isSelected(a.id));
  } catch (err) {
    inboxLoading.style.display = 'none';
    articleList.innerHTML = `<div class="archive-empty">Kunne ikke hente artikler. Tjek API-forbindelsen.</div>`;
    return;
  }

  inboxLoading.style.display = 'none';

  applyMockRankToUnranked(inboxArticles);

  if (inboxArticles.length === 0) {
    doneMessage.classList.add('visible');
    renderPagination(0);
    await refreshBadges();
    return;
  }

  currentPage = 1;
  renderInboxFromState();
  await refreshBadges();
}

// ── Archive ───────────────────────────────────────────────────────────────────
async function renderArchive(): Promise<void> {
  archiveList.innerHTML = '<div class="archive-empty">Henter arkiv…</div>';

  let articles: Article[];
  try {
    articles = await listArticles('reviewed');
  } catch {
    archiveList.innerHTML = '<div class="archive-empty">Kunne ikke hente arkiv.</div>';
    return;
  }

  archiveList.innerHTML = '';

  if (articles.length === 0) {
    archiveList.innerHTML = '<div class="archive-empty">Ingen arkiverede artikler endnu.</div>';
    return;
  }

  for (const article of articles) {
    archiveList.appendChild(
      buildArchiveCard(article, () => {
        refreshBadges();
        renderInbox();
      })
    );
  }

  await refreshBadges();
}

// ── View switching ────────────────────────────────────────────────────────────
function showView(name: string): void {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  document.getElementById(`nav-${name}`)?.classList.add('active');
  if (name === 'arkiv') renderArchive();
  if (name === 'til-behandling') renderSelected();
  if (name === 'inbox') renderInbox();
}

// ── Til behandling ───────────────────────────────────────────────────────────
function renderSelected(): void {
  const items = getSelected();
  selectedList.innerHTML = '';

  if (items.length === 0) {
    selectedList.innerHTML = `<div class="archive-empty">Ingen artikler valgt endnu. Gå til Inbox og tryk «Behold».</div>`;
    refreshBadges();
    return;
  }

  for (const sel of items) {
    selectedList.appendChild(
      buildSelectedCard(
        sel,
        (id) => openDraft(id),
        () => {
          renderSelected();
          refreshBadges();
        }
      )
    );
  }

  refreshBadges();
}

function openDraft(id: string): void {
  const sel = getSelected().find((s) => s.article.id === id);
  if (!sel) return;
  renderDraftView(draftContainer, sel, {
    onBack: () => {
      showView('til-behandling');
    },
  });

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
  document.getElementById('view-udkast')?.classList.add('active');
  document.getElementById('nav-til-behandling')?.classList.add('active');
}

// ── Crawl-knap ────────────────────────────────────────────────────────────────
async function handleCrawl(btn: HTMLButtonElement): Promise<void> {
  btn.textContent = 'Crawler…';
  btn.disabled = true;
  try {
    await triggerCrawl();
    await renderInbox();
  } catch (err) {
    alert(`Crawl fejlede: ${err instanceof Error ? err.message : 'Ukendt fejl'}`);
  } finally {
    btn.textContent = 'Crawl nu';
    btn.disabled = false;
  }
}

// ── Ranger-knap (frontend-demo, ingen API) ───────────────────────────────────
// Når Bonzai er sat op i Lambda, kan dette skiftes til rankInbox() fra api.ts.
async function handleRank(btn: HTMLButtonElement): Promise<void> {
  const original = btn.textContent;
  btn.textContent = 'Rangerer…';
  btn.disabled = true;
  try {
    for (const article of inboxArticles) {
      const result = mockRankArticle(article);
      article.relevanceScore = result.score;
      article.relevanceBucket = result.bucket;
      article.relevanceAngle = result.angle;
      article.rankedAt = new Date().toISOString();
    }
    renderInboxFromState();
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function applyMockRankToUnranked(articles: Article[]): void {
  for (const article of articles) {
    if (article.relevanceScore == null) {
      const result = mockRankArticle(article);
      article.relevanceScore = result.score;
      article.relevanceBucket = result.bucket;
      article.relevanceAngle = result.angle;
      article.rankedAt = new Date().toISOString();
    }
  }
}

function renderInboxFromState(): void {
  articleList.innerHTML = '';
  inboxArticles.sort(compareArticles);
  updateFilterCounts();

  const visible = visibleInboxArticles();
  if (visible.length === 0 && inboxArticles.length > 0) {
    articleList.innerHTML = `<div class="archive-empty">Ingen artikler matcher de aktive filtre. Aktivér flere filtre ovenfor.</div>`;
    renderPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = visible.slice(start, start + PAGE_SIZE);

  for (const article of pageItems) {
    const card = buildInboxCard(
      article,
      () => {
        refreshBadges();
        updateFilterCounts();
        if (articleList.querySelectorAll('.article-card:not(.removing)').length === 0) {
          doneMessage.classList.add('visible');
        }
      },
      () => openAngleId,
      (id) => { openAngleId = id; }
    );
    articleList.appendChild(card);
  }

  renderPagination(visible.length);
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(totalItems: number): void {
  const container = document.getElementById('pagination');
  if (!container) return;

  if (totalItems <= PAGE_SIZE) {
    container.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalItems);

  // Beregn hvilke sidetal der vises (med ellipsis for store mængder)
  const pages: (number | 'ellipsis')[] = [];
  const maxButtons = 7;
  if (totalPages <= maxButtons) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('ellipsis');
    const from = Math.max(2, currentPage - 1);
    const to = Math.min(totalPages - 1, currentPage + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  const pageBtns = pages.map((p) => {
    if (p === 'ellipsis') return `<span class="page-ellipsis">…</span>`;
    const active = p === currentPage ? ' active' : '';
    return `<button class="page-btn${active}" data-page="${p}">${p}</button>`;
  }).join('');

  container.innerHTML = `
    <div class="pagination-info">Viser ${start}-${end} af ${totalItems}</div>
    <div class="pagination-controls">
      <button class="page-btn page-nav" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹ Forrige</button>
      ${pageBtns}
      <button class="page-btn page-nav" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Næste ›</button>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('.page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = parseInt(btn.dataset.page || '1', 10);
      if (target < 1 || target > totalPages || target === currentPage) return;
      currentPage = target;
      renderInboxFromState();
      articleList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── Sortering ─────────────────────────────────────────────────────────────────
function compareArticles(a: Article, b: Article): number {
  const aUsable = isGeneratable(a);
  const bUsable = isGeneratable(b);
  if (aUsable && !bUsable) return -1;
  if (!aUsable && bUsable) return 1;

  const aRanked = a.relevanceScore != null;
  const bRanked = b.relevanceScore != null;
  if (!aRanked && !bRanked) return 0;
  if (!aRanked) return 1;
  if (!bRanked) return -1;
  if (sortMode === 'relevance') {
    return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
  }
  return brugbarhedScore(b) - brugbarhedScore(a);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(window as any).showView = showView;

document.getElementById('btn-crawl')?.addEventListener('click', (e) => {
  handleCrawl(e.currentTarget as HTMLButtonElement);
});

document.getElementById('btn-rank')?.addEventListener('click', (e) => {
  handleRank(e.currentTarget as HTMLButtonElement);
});

document.querySelectorAll<HTMLButtonElement>('.filter-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const bucket = btn.dataset.bucket as AccessBucket | undefined;
    if (!bucket) return;
    if (activeBuckets.has(bucket)) {
      activeBuckets.delete(bucket);
      btn.classList.remove('active');
    } else {
      activeBuckets.add(bucket);
      btn.classList.add('active');
    }
    currentPage = 1;
    renderInboxFromState();
  });
});

const unusableToggle = document.getElementById('toggle-unusable') as HTMLButtonElement | null;
unusableToggle?.addEventListener('click', () => {
  showUnusable = !showUnusable;
  unusableToggle.classList.toggle('active', showUnusable);
  currentPage = 1;
  renderInboxFromState();
});

const sortSelect = document.getElementById('sort-select') as HTMLSelectElement | null;
sortSelect?.addEventListener('change', () => {
  const value = sortSelect.value;
  if (value !== 'relevance' && value !== 'brugbarhed') return;
  sortMode = value;
  currentPage = 1;
  renderInboxFromState();
});

renderInbox();
