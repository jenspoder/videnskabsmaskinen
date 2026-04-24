import type { Article } from './types';
import { listArticles, triggerCrawl } from './api';
import { buildInboxCard } from './components/inbox';
import { buildArchiveCard } from './components/archive';
import { mockRankArticle } from './mockRank';

let inboxArticles: Article[] = [];
let openAngleId: string | null = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const inboxBadge = document.getElementById('inbox-badge')!;
const arkivBadge = document.getElementById('arkiv-badge')!;
const articleList = document.getElementById('article-list')!;
const archiveList = document.getElementById('archive-list')!;
const doneMessage = document.getElementById('done-message')!;
const inboxLoading = document.getElementById('inbox-loading')!;

// ── Badges ────────────────────────────────────────────────────────────────────
async function refreshBadges(): Promise<void> {
  const [inbox, reviewed] = await Promise.all([
    listArticles('inbox'),
    listArticles('reviewed'),
  ]);
  inboxBadge.textContent = String(inbox.length);
  arkivBadge.textContent = String(reviewed.length);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
async function renderInbox(): Promise<void> {
  inboxLoading.style.display = 'block';
  articleList.innerHTML = '';
  doneMessage.classList.remove('visible');

  try {
    inboxArticles = await listArticles('inbox');
  } catch (err) {
    inboxLoading.style.display = 'none';
    articleList.innerHTML = `<div class="archive-empty">Kunne ikke hente artikler. Tjek API-forbindelsen.</div>`;
    return;
  }

  inboxLoading.style.display = 'none';

  if (inboxArticles.length === 0) {
    doneMessage.classList.add('visible');
    return;
  }

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
      article.relevanceRationale = result.rationale;
      article.rankedAt = new Date().toISOString();
    }
    renderInboxFromState();
  } finally {
    btn.textContent = original;
    btn.disabled = false;
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
