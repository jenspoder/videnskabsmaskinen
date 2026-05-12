#!/usr/bin/env node
// backend/scripts/enrich-openaccess.mjs
//
// Beriger artikler i S3 med OpenAlex-data og verificerer om vi kan hente
// brugbart fuldtekst-indhold.
//
// For hver artikel under articles/inbox/ og articles/reviewed/:
//   1. Ekstrahér DOI fra URL (eller titel-søg i OpenAlex som fallback)
//   2. Slå op i OpenAlex /works endpoint
//   3. Hvis OA-URL findes: sample-fetch og kvalitetstjek
//   4. Skriv openAccess-felt tilbage til artikel-JSON
//
// Brug:
//   AWS_REGION=eu-west-1 node backend/scripts/enrich-openaccess.mjs
//   ... --folder=inbox             # kun inbox (default: begge)
//   ... --limit=20                 # begræns antal (test)
//   ... --force                    # re-enrich allerede tjekkede
//   ... --dry-run                  # skriv ikke tilbage til S3
//   ... --concurrent=3             # parallelle workers (default 3)

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.BUCKET || 'videnskabsmaskinen-articles';
const REGION = process.env.AWS_REGION || 'eu-west-1';
const POLITE_EMAIL = process.env.OPENALEX_EMAIL || 'audit@sciencemediacompany.dk';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const args = parseArgs(process.argv.slice(2));
const FOLDER_FILTER = args.folder || null;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const FORCE = args.force === 'true';
const DRY_RUN = args['dry-run'] === 'true';
const CONCURRENT = parseInt(args.concurrent || '3', 10);

const s3 = new S3Client({ region: REGION });

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

async function main() {
  console.log(`\n=== OpenAccess Enrichment ===`);
  console.log(`Bucket:        ${BUCKET}  (region: ${REGION})`);
  console.log(`Folder:        ${FOLDER_FILTER || 'inbox + reviewed'}`);
  console.log(`Limit:         ${LIMIT === Infinity ? 'no limit' : LIMIT}`);
  console.log(`Force re-check: ${FORCE}`);
  console.log(`Dry run:       ${DRY_RUN}`);
  console.log(`Concurrent:    ${CONCURRENT}`);
  console.log(`Polite email:  ${POLITE_EMAIL}\n`);

  const folders = FOLDER_FILTER ? [FOLDER_FILTER] : ['inbox', 'reviewed'];
  const allKeys = [];
  for (const folder of folders) {
    const keys = await listKeys(`articles/${folder}/`);
    console.log(`  ${folder}: ${keys.length} artikler`);
    allKeys.push(...keys);
  }

  const targets = allKeys.slice(0, LIMIT);
  console.log(`\nProcesserer ${targets.length} af ${allKeys.length} samlet\n`);

  const stats = {
    total: targets.length,
    skipped: 0,
    enriched: 0,
    inOpenAlex: 0,
    isOa: 0,
    usable: 0,
    usableOriginal: 0,
    usableOa: 0,
    errors: 0,
    fetched: 0,
    openalexAbstract: 0,
    publisherAbstract: 0,
    crossrefAbstract: 0,
    teaserReplaced: 0,
    noUsableContent: 0,
  };

  // Simpel concurrency-pool
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENT }, async () => {
    while (cursor < targets.length) {
      const i = cursor++;
      const key = targets[i];
      try {
        const result = await processArticle(key, stats, i + 1, targets.length);
        if (result === 'skipped') stats.skipped++;
        else if (result === 'enriched') stats.enriched++;
      } catch (err) {
        stats.errors++;
        console.log(`  [${i + 1}/${targets.length}] FEJL ${key}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  printSummary(stats);
}

async function processArticle(key, stats, index, total) {
  const article = await loadJson(key);
  if (!article) return 'skipped';

  if (
    !FORCE &&
    article.openAccess?.checked &&
    article.openAccess?.checkedAt &&
    Date.now() - new Date(article.openAccess.checkedAt).getTime() < 30 * 24 * 3600 * 1000
  ) {
    console.log(`  [${index}/${total}] SKIP allerede tjekket: ${truncate(article.title, 60)}`);
    if (article.openAccess.isOa) stats.isOa++;
    if (article.openAccess.hasUsableFulltext) stats.usable++;
    if (article.openAccess.inOpenAlex) stats.inOpenAlex++;
    if (article.openAccess.hasOpenAlexAbstract) stats.openalexAbstract++;
    return 'skipped';
  }

  const { oa, abstractText, abstractSource, openalexType } = await checkOpenAccess(article);
  if (oa.inOpenAlex) stats.inOpenAlex++;
  if (oa.isOa) stats.isOa++;
  if (oa.hasUsableFulltext) {
    stats.usable++;
    stats.fetched++;
  }
  if (oa.contentSourceType === 'original_fulltext') stats.usableOriginal++;
  if (oa.contentSourceType === 'oa_fulltext') stats.usableOa++;

  // Berig teaser hvis vi har et længere, brugbart abstract.
  const oldTeaserLen = (article.teaser || '').length;
  let teaserReplaced = false;
  if (abstractText && abstractText.length > oldTeaserLen + 100) {
    article.teaser = abstractText;
    teaserReplaced = true;
    stats.teaserReplaced++;
  }

  oa.hasOpenAlexAbstract = abstractSource === 'openalex';
  oa.hasPublisherAbstract = abstractSource === 'publisher';
  oa.openalexType = openalexType || null;
  if (abstractSource === 'openalex') stats.openalexAbstract++;
  if (abstractSource === 'publisher') stats.publisherAbstract++;
  if (abstractSource === 'crossref') stats.crossrefAbstract++;
  if (!oa.canGenerate) stats.noUsableContent++;

  article.openAccess = oa;

  const flag = oa.hasUsableFulltext
    ? '✓ FULL'
    : oa.isOa
    ? '◐ OA-blokeret'
    : oa.inOpenAlex
    ? '○ closed'
    : '? ikke i OA';

  const teaserNote = teaserReplaced
    ? ` 📝 ${abstractSource || 'abstract'} ${oldTeaserLen}→${abstractText.length}`
    : '';
  const typeNote = openalexType && openalexType !== 'article' ? ` [${openalexType}]` : '';

  const sourceNote = oa.contentSourceType ? ` {${oa.contentSourceType}}` : '';
  console.log(`  [${index}/${total}] ${flag.padEnd(15)} ${truncate(article.title, 55)}${typeNote}${sourceNote}${teaserNote}`);

  if (!DRY_RUN) {
    await saveJson(key, article);
  }

  return 'enriched';
}

async function checkOpenAccess(article) {
  const oa = {
    checked: true,
    checkedAt: new Date().toISOString(),
    doi: extractDoiFromUrl(article.url),
    inOpenAlex: false,
    isOa: false,
    oaStatus: null,
    license: null,
    oaUrl: null,
    hasUsableFulltext: false,
    hasOpenAlexAbstract: false,
    hasPublisherAbstract: false,
    openalexType: null,
    contentSourceType: 'none',
    contentSourceUrl: null,
    contentSourceHost: null,
    contentTextLength: 0,
    canGenerate: false,
  };

  // 1. Originalkilden først: kan vi faktisk hente fuldtekst herfra?
  const originalFulltext = await sampleFetch(article.url);
  if (originalFulltext.usable) {
    oa.hasUsableFulltext = true;
    oa.contentSourceType = 'original_fulltext';
    oa.contentSourceUrl = article.url;
    oa.contentSourceHost = hostOf(article.url);
    oa.contentTextLength = originalFulltext.textLength || originalFulltext.byteLength || 0;
    oa.canGenerate = true;
  }

  // 3. Hvis originalen ikke giver fuldtekst, se om originalen giver et
  // offentligt abstract. Det er ofte nok til et forsigtigt udkast.
  let abstractText = null;
  let abstractSource = null;
  if (!oa.canGenerate) {
    const publisherAbstract = await fetchPublisherAbstract(article.url);
    if (publisherAbstract) {
      abstractText = publisherAbstract;
      abstractSource = 'publisher';
      oa.contentSourceType = 'original_abstract';
      oa.contentSourceUrl = article.url;
      oa.contentSourceHost = hostOf(article.url);
      oa.contentTextLength = publisherAbstract.length;
      oa.canGenerate = true;
    }
  }

  let work = null;
  try {
    if (oa.doi) {
      work = await openalexLookup(oa.doi);
    }
    if (!work) {
      work = await openalexSearchByTitle(article.title);
      if (work && work.doi) {
        oa.doi = work.doi.replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
      }
    }
  } catch (err) {
    return { oa, abstractText, abstractSource, openalexType: null };
  }

  if (!work) {
    if (!oa.canGenerate) {
      const crossref = await crossrefSearchByTitle(article.title);
      if (crossref?.abstract) {
        abstractText = crossref.abstract;
        abstractSource = 'crossref';
        oa.doi = crossref.doi?.toLowerCase() || oa.doi;
        oa.contentSourceType = 'crossref_abstract';
        oa.contentSourceUrl = crossref.url;
        oa.contentSourceHost = 'crossref.org';
        oa.contentTextLength = crossref.abstract.length;
        oa.canGenerate = true;
      }
    }
    return { oa, abstractText, abstractSource, openalexType: null };
  }

  oa.inOpenAlex = true;
  oa.isOa = work.open_access?.is_oa ?? false;
  oa.oaStatus = work.open_access?.oa_status ?? null;
  oa.license = work.best_oa_location?.license ?? null;

  const openalexType = work.type || null;
  const openalexAbstract = reconstructAbstract(work.abstract_inverted_index);

  // 3b. Hvis originalens abstract ikke kunne hentes, men OpenAlex har
  // et abstract, brug det som genereringsgrundlag.
  if (!oa.canGenerate && openalexAbstract) {
    abstractText = openalexAbstract;
    abstractSource = 'openalex';
    oa.contentSourceType = 'openalex_abstract';
    oa.contentSourceUrl = work.id || null;
    oa.contentSourceHost = 'openalex.org';
    oa.contentTextLength = openalexAbstract.length;
    oa.canGenerate = true;
  }

  // 3c. Sidste metadata-fallback: Crossref har ofte JATS-abstracts for
  // artikler hvor publisheren blokerer (fx JAMA/Cloudflare), og hvor
  // OpenAlex ikke har abstractet.
  if (!oa.canGenerate) {
    const crossref = await crossrefSearchByTitle(article.title);
    if (crossref?.abstract) {
      abstractText = crossref.abstract;
      abstractSource = 'crossref';
      oa.contentSourceType = 'crossref_abstract';
      oa.contentSourceUrl = crossref.url;
      oa.contentSourceHost = 'crossref.org';
      oa.contentTextLength = crossref.abstract.length;
      oa.canGenerate = true;
      if (!oa.doi && crossref.doi) oa.doi = crossref.doi.toLowerCase();
    }
  }

  const oaLocations = collectOaLocations(work);
  if (!oa.isOa || oaLocations.length === 0) {
    return { oa, abstractText, abstractSource, openalexType };
  }

  // 2. OpenAlex/OA-fuldtekst: kun hvis originalen ikke allerede var
  // brugbar fuldtekst. En OA-URL som kun giver embargo/paywall tæller
  // ikke som genereringskilde.
  for (const loc of oaLocations.slice(0, 3)) {
    const fetched = await sampleFetch(loc.url);
    if (fetched.usable) {
      oa.oaUrl = loc.url;
      if (oa.contentSourceType !== 'original_fulltext') {
        oa.hasUsableFulltext = true;
        oa.contentSourceType = 'oa_fulltext';
        oa.contentSourceUrl = loc.url;
        oa.contentSourceHost = hostOf(loc.url);
        oa.contentTextLength = fetched.textLength || fetched.byteLength || 0;
        oa.canGenerate = true;
      }
      return { oa, abstractText, abstractSource, openalexType };
    }
  }

  // Ingen OA-fetch lykkedes — gem alligevel den bedste OA-URL som reference,
  // men markér den ikke som kilden Bonzai kan bruge.
  oa.oaUrl = work.best_oa_location?.landing_page_url ?? oaLocations[0]?.url ?? null;
  return { oa, abstractText, abstractSource, openalexType };
}

/**
 * Forsøger at skrabe abstractet fra forlagets HTML-side. Mange forlag
 * (Nature, Lancet, Wiley, JAMA, Elsevier) har abstractet offentligt
 * tilgængeligt, også når selve artiklen er paywallet.
 *
 * Returnerer det udtrukne abstract som tekst, eller null hvis intet
 * brugbart kunne findes.
 */
async function fetchPublisherAbstract(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    const html = await res.text();
    return extractAbstractFromHtml(html, url);
  } catch (err) {
    return null;
  }
}

const ABSTRACT_EXTRACTORS = [
  // Nature / Springer Nature
  { match: /nature\.com|link\.springer\.com|biomedcentral/i,
    selector: /<div\b[^>]*\bid="Abs\d+-content"[^>]*>([\s\S]*?)<\/div>/i },

  // The Lancet / ScienceDirect / Elsevier
  { match: /thelancet\.com|sciencedirect\.com|cell\.com/i,
    selector: /<div\b[^>]*\bclass="[^"]*\babstract\s+author[^"]*"[^>]*>([\s\S]*?)<\/div>/i },

  // Wiley
  { match: /onlinelibrary\.wiley\.com/i,
    selector: /<section\b[^>]*\bclass="[^"]*\barticle-section__abstract[^"]*"[^>]*>([\s\S]*?)<\/section>/i },

  // JAMA Network
  { match: /jamanetwork\.com/i,
    selector: /<div\b[^>]*\bclass="[^"]*\babstract-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i },

  // Generisk: <section data-title="Abstract">
  { match: /.*/,
    selector: /<section\b[^>]*\bdata-title="Abstract"[^>]*>([\s\S]*?)<\/section>/i },

  // Generisk: <h2>Abstract</h2><div class="...">
  { match: /.*/,
    selector: /<h[1-3][^>]*>\s*Abstract\s*<\/h[1-3]>\s*<(?:div|section)[^>]*>([\s\S]*?)<\/(?:div|section)>/i },
];

function extractAbstractFromHtml(html, url) {
  for (const { match, selector } of ABSTRACT_EXTRACTORS) {
    if (!match.test(url)) continue;
    const m = html.match(selector);
    if (!m) continue;
    const text = htmlToText(m[1]);
    if (text.length >= 400) return text;
  }
  return null;
}

function htmlToText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rekonstruerer et abstract fra OpenAlex' abstract_inverted_index.
 * Strukturen er { word: [positions] } — vi bygger ord-arrayet og joiner.
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  const positions = Object.values(invertedIndex).flat();
  if (positions.length === 0) return null;
  const max = Math.max(...positions);
  const words = new Array(max + 1);
  for (const [word, posList] of Object.entries(invertedIndex)) {
    for (const p of posList) words[p] = word;
  }
  const text = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

// ─── OpenAlex ─────────────────────────────────────────────────────

async function openalexLookup(doi) {
  const params = new URLSearchParams();
  params.set('mailto', POLITE_EMAIL);
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY);
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': `videnskabsmaskinen-enrich/1.0 (mailto:${POLITE_EMAIL})`,
      Accept: 'application/json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  return res.json();
}

async function openalexSearchByTitle(title) {
  if (!title) return null;
  const params = new URLSearchParams();
  params.set('mailto', POLITE_EMAIL);
  params.set('per-page', '1');
  params.set('filter', `title.search:${title.slice(0, 200)}`);
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY);
  const url = `https://api.openalex.org/works?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': `videnskabsmaskinen-enrich/1.0 (mailto:${POLITE_EMAIL})`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`OpenAlex search HTTP ${res.status}`);
  const json = await res.json();
  const hit = json.results?.[0];
  if (!hit) return null;
  if (jaccard(normalize(hit.title || ''), normalize(title)) < 0.6) return null;
  return hit;
}

async function crossrefSearchByTitle(title) {
  if (!title) return null;
  const params = new URLSearchParams();
  params.set('rows', '3');
  params.set('query.title', title.slice(0, 200));
  const url = `https://api.crossref.org/works?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': `videnskabsmaskinen-enrich/1.0 (mailto:${POLITE_EMAIL})`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    for (const item of json.message?.items || []) {
      const hitTitle = item.title?.[0] || '';
      if (jaccard(normalize(hitTitle), normalize(title)) < 0.65) continue;
      const abstract = htmlToText(item.abstract || '');
      if (abstract.length < 400) continue;
      return {
        doi: item.DOI || null,
        url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : 'https://www.crossref.org/'),
        abstract,
      };
    }
  } catch (err) {
    return null;
  }
  return null;
}

function collectOaLocations(work) {
  const locs = [];
  for (const loc of work.locations || []) {
    if (!loc?.is_oa) continue;
    if (loc.pdf_url) {
      locs.push({ url: loc.pdf_url, kind: 'pdf', source: loc.source?.display_name || '' });
    }
    if (loc.landing_page_url) {
      locs.push({ url: loc.landing_page_url, kind: 'html', source: loc.source?.display_name || '' });
    }
  }
  locs.sort((a, b) => kindRank(a) - kindRank(b));
  return locs;
}

function kindRank(loc) {
  const s = (loc.source || '').toLowerCase();
  if (s.includes('pubmed central') || s.includes('pmc')) return 0;
  if (s.includes('arxiv') || s.includes('biorxiv') || s.includes('medrxiv') || s.includes('psyarxiv')) return 1;
  if (loc.kind === 'pdf') return 2;
  return 3;
}

async function sampleFetch(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) return { usable: false, status: res.status };

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) {
      const buf = await res.arrayBuffer();
      return { usable: buf.byteLength > 50000, contentType: 'pdf', byteLength: buf.byteLength };
    }
    const body = await res.text();
    return assessHtmlQuality(body);
  } catch (err) {
    return { usable: false, error: err.message };
  }
}

function assessHtmlQuality(html) {
  const paragraphs = (html.match(/<p\b[^>]*>/gi) || []).length;
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = text.toLowerCase();
  const blocked = [
    'this is a preview of subscription content',
    'access through your institution',
    'get full text access',
    'buy this article',
    'subscribe to this journal',
    'enable javascript and cookies to continue',
    'just a moment',
  ].some((marker) => lower.includes(marker));
  const usable = !blocked && text.length > 5000 && paragraphs >= 10;
  return { usable, textLength: text.length, paragraphCount: paragraphs };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── DOI extraction ──────────────────────────────────────────────

function extractDoiFromUrl(url) {
  if (!url) return null;
  // Standard DOI-mønster
  const direct = url.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+?)(?:[?#]|$)/i);
  if (direct) return direct[1].replace(/[).,;]+$/, '').toLowerCase();

  // Springer/Nature: udled fra article-path
  const nature = url.match(/nature\.com\/articles\/(s\d{5}-\d{3}-\d{5}-[A-Z0-9])/i);
  if (nature) return `10.1038/${nature[1]}`.toLowerCase();

  return null;
}

// ─── S3 helpers ──────────────────────────────────────────────────

async function listKeys(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key?.endsWith('.json')) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function loadJson(key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

async function saveJson(key, value) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    })
  );
}

// ─── Misc helpers ────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    if (m) out[m[1]] = m[2] || 'true';
  }
  return out;
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccard(a, b) {
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  const inter = new Set([...sa].filter((x) => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function pct(n, total) {
  if (!total) return '—';
  return `${Math.round((100 * n) / total)}%`;
}

function printSummary(stats) {
  console.log(`\n=== SUMMARY ===`);
  console.log(`  Total artikler:        ${stats.total}`);
  console.log(`  Sprunget over (cache): ${stats.skipped}`);
  console.log(`  Beriget:               ${stats.enriched}`);
  console.log(`  Fejl:                  ${stats.errors}`);
  console.log(`\n  I OpenAlex:            ${stats.inOpenAlex}/${stats.total}  (${pct(stats.inOpenAlex, stats.total)})`);
  console.log(`  Open Access:           ${stats.isOa}/${stats.total}  (${pct(stats.isOa, stats.total)})`);
  console.log(`  USABLE fuldtekst:      ${stats.usable}/${stats.total}  (${pct(stats.usable, stats.total)})`);
  console.log(`    - originalkilde:     ${stats.usableOriginal}/${stats.total}  (${pct(stats.usableOriginal, stats.total)})`);
  console.log(`    - OA-kilde:          ${stats.usableOa}/${stats.total}  (${pct(stats.usableOa, stats.total)})`);
  console.log(`  Abstract via OpenAlex: ${stats.openalexAbstract}/${stats.total}  (${pct(stats.openalexAbstract, stats.total)})`);
  console.log(`  Abstract via publisher:${stats.publisherAbstract}/${stats.total}  (${pct(stats.publisherAbstract, stats.total)})`);
  console.log(`  Abstract via Crossref: ${stats.crossrefAbstract}/${stats.total}  (${pct(stats.crossrefAbstract, stats.total)})`);
  console.log(`  Teaser opgraderet:     ${stats.teaserReplaced}/${stats.total}  (${pct(stats.teaserReplaced, stats.total)})`);
  console.log(`  Ingen brugbar adgang:  ${stats.noUsableContent}/${stats.total}  (${pct(stats.noUsableContent, stats.total)})`);
  if (DRY_RUN) {
    console.log(`\n  ⚠ DRY-RUN: ingen S3-skrivninger udført`);
  }
  console.log();
}
