import type { Article } from './types';
import type { UploadedDocument } from './types';
import { cancelDraftJob, deleteDocument, getDraftJob, listArticles, listDocuments, startGenerateDraft, triggerCrawl, uploadDocument } from './api';
import { buildInboxCard } from './components/inbox';
import { buildArchiveCard } from './components/archive';
import { buildSelectedCard } from './components/selected';
import { renderDraftView } from './components/draft';
import { addSelected, getDraft, getSelected, isSelected, removeSelected, saveDraft, setGenerationState } from './store';
import { accessBucket, brugbarhedScore, isGeneratable, isUploadedDocument, type AccessBucket } from './utils/scoring';
import { generateMockDraft } from './mockGenerate';

let inboxArticles: Article[] = [];
let openAngleId: string | null = null;
const activeBuckets: Set<AccessBucket> = new Set(['full', 'abstract']);
let showDocuments = true;
type SortMode = 'relevance' | 'brugbarhed';
let sortMode: SortMode = 'relevance';
let showUnusable = false;
const USE_BACKEND_GENERATION = import.meta.env.VITE_USE_BACKEND_GENERATION === 'true';
const activeGenerationPolls = new Set<string>();
let queueRunning = false;

const PAGE_SIZE = 25;
let currentPage = 1;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const inboxBadge = document.getElementById('inbox-badge')!;
const arkivBadge = document.getElementById('arkiv-badge')!;
const tilBehandlingBadge = document.getElementById('til-behandling-badge')!;
const documentsBadge = document.getElementById('documents-badge')!;
const articleList = document.getElementById('article-list')!;
const archiveList = document.getElementById('archive-list')!;
const selectedList = document.getElementById('selected-list')!;
const documentList = document.getElementById('document-list')!;
const documentUploadInput = document.getElementById('document-upload') as HTMLInputElement | null;
const documentUploadStatus = document.getElementById('document-upload-status')!;
const draftContainer = document.getElementById('draft-container')!;
const doneMessage = document.getElementById('done-message')!;
const inboxLoading = document.getElementById('inbox-loading')!;

// ── Badges ────────────────────────────────────────────────────────────────────
async function refreshBadges(): Promise<void> {
  const [inbox, reviewed, documents] = await Promise.all([
    listArticles('inbox'),
    listArticles('reviewed'),
    listDocuments(),
  ]);
  const selectedIds = new Set(getSelected().map((s) => s.article.id));
  const inboxRemaining = inbox.filter((a) => !selectedIds.has(a.id) && isGeneratable(a)).length;
  inboxBadge.textContent = String(inboxRemaining);
  arkivBadge.textContent = String(reviewed.length);
  tilBehandlingBadge.textContent = String(selectedIds.size);
  documentsBadge.textContent = String(documents.length);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
function visibleInboxArticles(): Article[] {
  return inboxArticles.filter((a) => {
    if (!isGeneratable(a)) return showUnusable;
    if (isUploadedDocument(a)) return showDocuments;
    return activeBuckets.has(accessBucket(a));
  });
}

function updateFilterCounts(): void {
  const counts: Record<AccessBucket, number> = { full: 0, abstract: 0 };
  let documents = 0;
  let unusable = 0;
  for (const a of inboxArticles) {
    if (!isGeneratable(a)) {
      unusable++;
      continue;
    }
    if (isUploadedDocument(a)) {
      documents++;
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
  const documentsEl = document.querySelector('[data-count="documents"]');
  if (documentsEl) documentsEl.textContent = String(documents);
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
  if (name === 'documents') renderDocuments();
  if (name === 'inbox') renderInbox();
}

// ── Egne kilder ───────────────────────────────────────────────────────────────
async function renderDocuments(): Promise<void> {
  documentList.innerHTML = '<div class="archive-empty">Henter egne kilder…</div>';

  let documents: UploadedDocument[];
  try {
    documents = await listDocuments();
  } catch {
    documentList.innerHTML = '<div class="archive-empty">Kunne ikke hente egne kilder.</div>';
    return;
  }

  if (documents.length === 0) {
    documentList.innerHTML = '<div class="archive-empty">Ingen egne dokumenter uploadet endnu.</div>';
    await refreshBadges();
    return;
  }

  documentList.innerHTML = '';
  for (const document of documents) {
    documentList.appendChild(buildDocumentCard(document));
  }
  await refreshBadges();
}

function buildDocumentCard(doc: UploadedDocument): HTMLElement {
  const card = document.createElement('div');
  card.className = 'document-card';
  card.innerHTML = `
    <div class="document-card-main">
      <div class="document-card-label">Egen kilde / dokument</div>
      <div class="document-card-title">${escapeHtml(doc.title)}</div>
      <div class="document-card-meta">
        <span>${escapeHtml(doc.fileName)}</span>
        <span>${formatNumber(doc.textLength)} tegn</span>
        <span>Klar i inbox</span>
      </div>
    </div>
    <button class="document-trash" type="button" aria-label="Fjern ${escapeHtml(doc.fileName)}" title="Fjern dokument">
      Slet
    </button>`;

  card.querySelector<HTMLButtonElement>('.document-trash')?.addEventListener('click', async () => {
    const confirmed = window.confirm(`Fjern "${doc.fileName}" fra egne kilder og inbox?`);
    if (!confirmed) return;
    card.classList.add('removing');
    try {
      await deleteDocument(doc.id);
      await Promise.all([renderDocuments(), renderInbox(), refreshBadges()]);
    } catch (error) {
      card.classList.remove('removing');
      alert(`Kunne ikke fjerne dokument: ${error instanceof Error ? error.message : 'Ukendt fejl'}`);
    }
  });

  return card;
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

  resumeGenerationJobs(items);

  for (const sel of items) {
    selectedList.appendChild(
      buildSelectedCard(
        sel,
        (id) => {
          const selected = getSelected().find((item) => item.article.id === id);
          if (!selected) return;
          if (getDraft(id)) {
            openDraft(id);
            return;
          }
          startDraftGeneration(selected.article, selected.angle);
        },
        (id) => {
          cancelGeneration(id);
        },
        () => {
          renderSelected();
          refreshBadges();
        }
      )
    );
  }

  refreshBadges();
}

async function cancelGeneration(articleId: string): Promise<void> {
  const selected = getSelected().find((item) => item.article.id === articleId);
  const jobId = selected?.generation?.jobId;

  setGenerationState(articleId, {
    ...(selected?.generation ?? {}),
    status: 'canceled',
    error: 'Generering stoppet af redaktør',
  });
  activeGenerationPolls.delete(articleId);
  queueRunning = false;
  refreshSelectedView();
  processGenerationQueue();

  if (jobId && USE_BACKEND_GENERATION) {
    try {
      await cancelDraftJob(jobId);
    } catch (error) {
      console.warn('Kunne ikke stoppe backend-job:', error);
    }
  }
}

function refreshSelectedView(): void {
  if (document.getElementById('view-til-behandling')?.classList.contains('active')) {
    renderSelected();
  }
  refreshBadges();
}

async function startDraftGeneration(article: Article, angle: string): Promise<void> {
  const finalAngle = angle.trim() || article.relevanceAngle || '';
  addSelected(article, finalAngle);
  setGenerationState(article.id, { status: 'queued' });
  showView('til-behandling');
  processGenerationQueue();
}

async function processGenerationQueue(): Promise<void> {
  if (queueRunning) return;
  const selected = getSelected();
  const hasActive = selected.some((item) =>
    item.generation?.status === 'generating' && !getDraft(item.article.id)
  );
  if (hasActive) return;

  const next = selected
    .slice()
    .reverse()
    .find((item) => item.generation?.status === 'queued' && !getDraft(item.article.id));
  if (!next) return;

  queueRunning = true;
  if (!USE_BACKEND_GENERATION) {
    setGenerationState(next.article.id, { status: 'generating', startedAt: new Date().toISOString() });
    refreshSelectedView();
    window.setTimeout(() => {
      saveDraft(next.article.id, generateMockDraft(next.article, next.angle));
      queueRunning = false;
      refreshSelectedView();
      processGenerationQueue();
    }, 1200);
    return;
  }

  try {
    const { jobId } = await startGenerateDraft(next.article.id, next.angle);
    setGenerationState(next.article.id, {
      status: 'generating',
      jobId,
      startedAt: new Date().toISOString(),
    });
    refreshSelectedView();
    pollGenerationJob(next.article.id, jobId);
  } catch (error) {
    setGenerationState(next.article.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Kunne ikke starte generering',
    });
    queueRunning = false;
    refreshSelectedView();
    processGenerationQueue();
  }
}

function resumeGenerationJobs(items = getSelected()): void {
  for (const item of items) {
    const generation = item.generation;
    if (!generation?.jobId || generation.status !== 'generating' || getDraft(item.article.id)) continue;
    pollGenerationJob(item.article.id, generation.jobId);
  }
  processGenerationQueue();
}

function pollGenerationJob(articleId: string, jobId: string): void {
  if (activeGenerationPolls.has(articleId)) return;
  activeGenerationPolls.add(articleId);

  const poll = async (): Promise<void> => {
    try {
      const selected = getSelected().find((item) => item.article.id === articleId);
      if (selected?.generation?.status === 'canceled') {
        activeGenerationPolls.delete(articleId);
        queueRunning = false;
        processGenerationQueue();
        return;
      }
      const job = await getDraftJob(jobId);
      if (job.status === 'completed' && job.html) {
        saveDraft(articleId, job.html);
        activeGenerationPolls.delete(articleId);
        queueRunning = false;
        refreshSelectedView();
        processGenerationQueue();
        return;
      }
      if (job.status === 'failed') {
        setGenerationState(articleId, {
          status: 'failed',
          jobId,
          error: job.error || 'Generering fejlede',
        });
        activeGenerationPolls.delete(articleId);
        queueRunning = false;
        refreshSelectedView();
        processGenerationQueue();
        return;
      }
      if (job.status === 'canceled') {
        setGenerationState(articleId, {
          status: 'canceled',
          jobId,
          error: job.error || 'Generering stoppet',
        });
        activeGenerationPolls.delete(articleId);
        queueRunning = false;
        refreshSelectedView();
        processGenerationQueue();
        return;
      }
      window.setTimeout(poll, 2500);
    } catch (error) {
      setGenerationState(articleId, {
        status: 'failed',
        jobId,
        error: error instanceof Error ? error.message : 'Kunne ikke hente job-status',
      });
      activeGenerationPolls.delete(articleId);
      queueRunning = false;
      refreshSelectedView();
      processGenerationQueue();
    }
  };

  window.setTimeout(poll, 1200);
}

function openDraft(id: string): void {
  const sel = getSelected().find((s) => s.article.id === id);
  if (!sel) return;
  renderDraftView(draftContainer, sel, {
    onBack: () => {
      showView('til-behandling');
    },
    onPublished: () => {
      removeSelected(id);
      showView('til-behandling');
      void renderInbox();
      void refreshBadges();
      refreshSelectedView();
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

function renderInboxFromState(): void {
  articleList.innerHTML = '';
  updateFilterCounts();

  const visible = visibleInboxArticles().sort(compareArticles);
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
      (id) => { openAngleId = id; },
      (article, angle) => {
        startDraftGeneration(article, angle);
      }
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
  const aRanked = a.relevanceScore != null;
  const bRanked = b.relevanceScore != null;
  if (!aRanked && !bRanked) return newestFirst(a, b);
  if (!aRanked) return 1;
  if (!bRanked) return -1;

  if (sortMode === 'relevance') {
    const byRelevance = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    return byRelevance || newestFirst(a, b);
  }

  const byBrugbarhed = brugbarhedScore(b) - brugbarhedScore(a);
  return byBrugbarhed || ((b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)) || newestFirst(a, b);
}

function newestFirst(a: Article, b: Article): number {
  return new Date(b.discoveredAt || 0).getTime() - new Date(a.discoveredAt || 0).getTime();
}

async function handleDocumentUpload(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!documentUploadInput) return;

  documentUploadInput.disabled = true;
  documentUploadStatus.textContent = `Uploader og læser ${file.name}…`;
  documentUploadStatus.classList.remove('is-error');

  try {
    await uploadDocument(file);
    documentUploadInput.value = '';
    documentUploadStatus.textContent = 'Dokumentet er klar og ligger nu i inbox.';
    await Promise.all([renderDocuments(), renderInbox(), refreshBadges()]);
  } catch (error) {
    documentUploadStatus.classList.add('is-error');
    documentUploadStatus.textContent = error instanceof Error ? error.message : 'Upload fejlede.';
  } finally {
    documentUploadInput.disabled = false;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('da-DK').format(value);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(window as any).showView = showView;

document.getElementById('btn-crawl')?.addEventListener('click', (e) => {
  handleCrawl(e.currentTarget as HTMLButtonElement);
});

document.querySelectorAll<HTMLButtonElement>('.filter-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const bucket = btn.dataset.bucket as AccessBucket | undefined;
    if (!bucket) return;
    if (activeBuckets.has(bucket)) {
      activeBuckets.delete(bucket);
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    } else {
      activeBuckets.add(bucket);
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
    currentPage = 1;
    renderInboxFromState();
  });
});

const unusableToggle = document.getElementById('toggle-unusable') as HTMLButtonElement | null;
unusableToggle?.addEventListener('click', () => {
  showUnusable = !showUnusable;
  unusableToggle.classList.toggle('active', showUnusable);
  unusableToggle.setAttribute('aria-pressed', String(showUnusable));
  currentPage = 1;
  renderInboxFromState();
});

const documentsToggle = document.getElementById('toggle-documents') as HTMLButtonElement | null;
documentsToggle?.addEventListener('click', () => {
  showDocuments = !showDocuments;
  documentsToggle.classList.toggle('active', showDocuments);
  documentsToggle.setAttribute('aria-pressed', String(showDocuments));
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

documentUploadInput?.addEventListener('change', () => {
  handleDocumentUpload(documentUploadInput.files);
});

renderInbox();
