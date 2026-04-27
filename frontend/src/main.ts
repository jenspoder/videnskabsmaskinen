import type { Article } from './types';
import { listArticles, triggerCrawl } from './api';
import { buildInboxCard } from './components/inbox';
import { buildArchiveCard } from './components/archive';
import { buildSelectedCard } from './components/selected';
import { renderDraftView } from './components/draft';
import { mockRankArticle } from './mockRank';
import { getSelected, isSelected } from './store';

let inboxArticles: Article[] = [];
let openAngleId: string | null = null;

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
  const inboxRemaining = inbox.filter((a) => !selectedIds.has(a.id)).length;
  inboxBadge.textContent = String(inboxRemaining);
  arkivBadge.textContent = String(reviewed.length);
  tilBehandlingBadge.textContent = String(selectedIds.size);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
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

  if (inboxArticles.length === 0) {
    doneMessage.classList.add('visible');
    await refreshBadges();
    return;
  }

  applyMockRankToUnranked(inboxArticles);
  inboxArticles.sort(byRelevance);

  for (const article of inboxArticles) {
    const card = buildInboxCard(
      article,
      () => {
        refreshBadges();
        if (articleList.querySelectorAll('.article-card:not(.removing)').length === 0) {
          doneMessage.classList.add('visible');
        }
      },
      () => openAngleId,
      (id) => { openAngleId = id; }
    );
    articleList.appendChild(card);
  }

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
  inboxArticles.sort(byRelevance);
  for (const article of inboxArticles) {
    const card = buildInboxCard(
      article,
      () => {
        refreshBadges();
        if (articleList.querySelectorAll('.article-card:not(.removing)').length === 0) {
          doneMessage.classList.add('visible');
        }
      },
      () => openAngleId,
      (id) => { openAngleId = id; }
    );
    articleList.appendChild(card);
  }
}

// ── Sortering ─────────────────────────────────────────────────────────────────
function byRelevance(a: Article, b: Article): number {
  const aScore = a.relevanceScore;
  const bScore = b.relevanceScore;
  const aMissing = aScore == null;
  const bMissing = bScore == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (bScore as number) - (aScore as number);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(window as any).showView = showView;

document.getElementById('btn-crawl')?.addEventListener('click', (e) => {
  handleCrawl(e.currentTarget as HTMLButtonElement);
});

document.getElementById('btn-rank')?.addEventListener('click', (e) => {
  handleRank(e.currentTarget as HTMLButtonElement);
});

renderInbox();
