#!/usr/bin/env node
// backend/scripts/openalex-audit.mjs
//
// Audit-script: Mål hvor godt OpenAlex kan supplere vores RSS-kilder med
// fuldtekst og open-access-data.
//
// Trin pr. RSS-kilde:
//   1. Hent feed
//   2. Parse <item>-elementer (titel + link + DOI)
//   3. For hvert item: slå DOI op i OpenAlex
//   4. Registrér: er artiklen i OpenAlex? OA? PDF? HTML? licens? abstract?
//   5. Sample-fetch 1-2 fuldtekst-URLs pr. kilde for at teste tilgængelighed
//
// Brug:
//   node backend/scripts/openalex-audit.mjs                     # alle kilder, 5 items hver
//   node backend/scripts/openalex-audit.mjs --per-source=10     # 10 items pr. kilde
//   node backend/scripts/openalex-audit.mjs --source=jama-psychiatry
//
// Authentication:
//   OpenAlex polite-pool: vi sender mailto-parameter, gratis indtil ~100k req/dag

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(__dirname, '..', 'sources.json');
const REPORT_PATH = resolve(__dirname, '..', '..', 'openalex-audit-report.json');

const POLITE_EMAIL = process.env.OPENALEX_EMAIL || 'audit@sciencemediacompany.dk';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const args = parseArgs(process.argv.slice(2));
const PER_SOURCE_LIMIT = parseInt(args['per-source'] || '5', 10);
const SOURCE_FILTER = args.source || null;
const SAMPLE_FETCHES_PER_SOURCE = parseInt(args['sample-fetches'] || '2', 10);

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

async function main() {
  const sources = loadSources();
  console.log(`\n=== OpenAlex Audit ===`);
  console.log(`Per-source limit: ${PER_SOURCE_LIMIT} items`);
  console.log(`Sample fetches per source: ${SAMPLE_FETCHES_PER_SOURCE}`);
  console.log(`Polite-pool email: ${POLITE_EMAIL}`);
  console.log(`API key: ${OPENALEX_API_KEY ? 'set' : 'not set (using polite pool)'}\n`);

  const allResults = [];

  for (const source of sources) {
    if (SOURCE_FILTER && source.sourceId !== SOURCE_FILTER) continue;
    if (!source.enabled) continue;
    if (source.type !== 'rss') continue;

    console.log(`\n--- ${source.sourceId} (${source.name}) ---`);
    const results = await auditSource(source);
    allResults.push({ source: source.sourceId, results });
    printSourceSummary(source, results);
  }

  printOverallSummary(allResults);

  writeFileSync(REPORT_PATH, JSON.stringify(allResults, null, 2));
  console.log(`\nFull JSON report: ${REPORT_PATH}\n`);
}

async function auditSource(source) {
  let xml;
  try {
    xml = await fetchText(source.startUrl);
  } catch (err) {
    console.log(`  ✗ Could not fetch RSS: ${err.message}`);
    return [];
  }

  const items = parseRssItems(xml).slice(0, PER_SOURCE_LIMIT);
  console.log(`  Fetched ${items.length} items from feed`);

  const results = [];
  let sampleFetchesDone = 0;

  for (const item of items) {
    const doi = extractDoi(item);
    const result = {
      title: item.title.slice(0, 100),
      url: item.url,
      doi,
      doiSource: doi ? 'extracted' : 'missing',
    };

    let work = null;
    try {
      if (doi) {
        work = await openalexLookup(doi);
      }
      if (!work && item.title) {
        work = await openalexSearchByTitle(item.title);
        if (work) {
          result.doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '') || null;
          result.doiSource = 'title-search';
        }
      }

      if (work) {
        const oaLocations = collectOaLocations(work);
        result.openalex = {
          found: true,
          isOa: work.open_access?.is_oa ?? false,
          oaStatus: work.open_access?.oa_status ?? null,
          bestOaUrl: work.best_oa_location?.landing_page_url ?? null,
          bestOaPdfUrl: work.best_oa_location?.pdf_url ?? null,
          license: work.best_oa_location?.license ?? null,
          version: work.best_oa_location?.version ?? null,
          oaLocations: oaLocations.length,
          abstractAvailable: !!work.abstract_inverted_index,
          abstractWordCount: work.abstract_inverted_index
            ? Object.keys(work.abstract_inverted_index).length
            : 0,
          citedByCount: work.cited_by_count ?? 0,
          authorshipsCount: work.authorships?.length ?? 0,
        };

        if (
          result.openalex.isOa &&
          oaLocations.length > 0 &&
          sampleFetchesDone < SAMPLE_FETCHES_PER_SOURCE
        ) {
          result.sampleFetch = await sampleFetchAnyUrl(oaLocations);
          sampleFetchesDone++;
        }
      } else {
        result.openalex = { found: false };
      }
    } catch (err) {
      result.openalex = { found: false, error: err.message };
    }

    results.push(result);

    await sleep(120); // ~8 req/sec; well under polite-pool limits
  }

  return results;
}

function printSourceSummary(source, results) {
  const total = results.length;
  const withDoi = results.filter((r) => r.doi).length;
  const inOpenalex = results.filter((r) => r.openalex?.found).length;
  const oaAvailable = results.filter((r) => r.openalex?.isOa).length;
  const fullTextUrl = results.filter(
    (r) => r.openalex?.bestOaUrl || r.openalex?.bestOaPdfUrl
  ).length;
  const abstracts = results.filter((r) => r.openalex?.abstractAvailable).length;
  const fetched = results.filter((r) => r.sampleFetch?.ok).length;
  const fetchTried = results.filter((r) => r.sampleFetch).length;
  const ccByLike = results.filter((r) =>
    /^cc-by(?!-nc|-nd)/i.test(r.openalex?.license || '')
  ).length;

  console.log(
    `  Pct DOI:           ${pct(withDoi, total)}  (${withDoi}/${total})`
  );
  console.log(
    `  Pct in OpenAlex:   ${pct(inOpenalex, total)}  (${inOpenalex}/${total})`
  );
  console.log(
    `  Pct OA available:  ${pct(oaAvailable, total)}  (${oaAvailable}/${total})`
  );
  console.log(
    `  Pct fulltext URL:  ${pct(fullTextUrl, total)}  (${fullTextUrl}/${total})`
  );
  console.log(
    `  Pct abstract:      ${pct(abstracts, total)}  (${abstracts}/${total})`
  );
  console.log(
    `  Pct CC-BY-licens:  ${pct(ccByLike, total)}  (${ccByLike}/${total})`
  );
  if (fetchTried > 0) {
    const usable = results.filter((r) => r.sampleFetch?.usable).length;
    const avgText = Math.round(
      results
        .filter((r) => r.sampleFetch?.usable)
        .reduce((s, r) => s + (r.sampleFetch.textLength || r.sampleFetch.bodyLength || 0), 0) /
        (usable || 1)
    );
    console.log(
      `  Sample fetches:    ${fetched}/${fetchTried} responded, ${usable}/${fetchTried} USABLE` +
        (usable ? ` (avg ${avgText.toLocaleString()} chars body)` : '')
    );
  }
}

function printOverallSummary(allResults) {
  const flat = allResults.flatMap((r) => r.results);
  const total = flat.length;
  const withDoi = flat.filter((r) => r.doi).length;
  const inOpenalex = flat.filter((r) => r.openalex?.found).length;
  const oaAvailable = flat.filter((r) => r.openalex?.isOa).length;
  const fullTextUrl = flat.filter(
    (r) => r.openalex?.bestOaUrl || r.openalex?.bestOaPdfUrl
  ).length;
  const fetchedOk = flat.filter((r) => r.sampleFetch?.ok).length;

  console.log(`\n=== OVERALL ${total} items ===`);
  console.log(`  DOI extracted:    ${pct(withDoi, total)}  (${withDoi}/${total})`);
  console.log(`  In OpenAlex:      ${pct(inOpenalex, total)}  (${inOpenalex}/${total})`);
  console.log(`  Open Access:      ${pct(oaAvailable, total)}  (${oaAvailable}/${total})`);
  console.log(`  Fulltext URL:     ${pct(fullTextUrl, total)}  (${fullTextUrl}/${total})`);
  const fetchTriedTotal = flat.filter((r) => r.sampleFetch).length;
  const usableTotal = flat.filter((r) => r.sampleFetch?.usable).length;
  console.log(
    `  Fetch responded:  ${fetchedOk}/${fetchTriedTotal} (HTTP 200)`
  );
  console.log(
    `  Fetch USABLE:     ${usableTotal}/${fetchTriedTotal} (substantielt artikel-indhold)`
  );

  // OA-status fordeling
  const oaStatusCounts = {};
  for (const r of flat) {
    const s = r.openalex?.oaStatus || 'unknown';
    oaStatusCounts[s] = (oaStatusCounts[s] || 0) + 1;
  }
  console.log(`\n  OA-status fordeling:`);
  for (const [status, count] of Object.entries(oaStatusCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`    ${status.padEnd(15)} ${count}  (${pct(count, total)})`);
  }

  // Licens-fordeling
  const licenseCounts = {};
  for (const r of flat) {
    const l = r.openalex?.license || 'no-license';
    licenseCounts[l] = (licenseCounts[l] || 0) + 1;
  }
  console.log(`\n  Licens-fordeling:`);
  for (const [lic, count] of Object.entries(licenseCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`    ${lic.padEnd(15)} ${count}  (${pct(count, total)})`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function loadSources() {
  const data = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  return data.sources;
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    if (m) out[m[1]] = m[2] || 'true';
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parseRssItems(xml) {
  const rawItems = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  return rawItems
    .map((raw) => {
      const title = decodeContent(extractTag(raw, 'title') || '');
      const url = extractLink(raw);
      const description = decodeContent(extractTag(raw, 'description') || '');
      const dcId = decodeContent(extractTag(raw, 'dc:identifier') || '');
      const prismDoi = decodeContent(extractTag(raw, 'prism:doi') || '');
      const guid = decodeContent(extractTag(raw, 'guid') || '');
      return { title, url, description, dcId, prismDoi, guid, raw };
    })
    .filter((i) => i.title && i.url);
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLink(itemXml) {
  const text = itemXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (text && text[1].trim()) return decodeContent(text[1].trim());
  const href = itemXml.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  return href ? href[1].trim() : '';
}

function decodeContent(raw) {
  let c = raw.trim();
  const cdata = c.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) c = cdata[1].trim();
  return c
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractDoi(item) {
  const candidates = [
    item.prismDoi,
    item.dcId,
    item.guid,
    item.url,
    item.description,
  ].filter(Boolean);

  const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;

  for (const c of candidates) {
    const cleaned = c.replace(/^doi:\s*/i, '');
    const m = cleaned.match(DOI_RE);
    if (m) {
      return m[1].replace(/[).,;]+$/, '').toLowerCase();
    }
  }

  return null;
}

async function openalexLookup(doi) {
  const params = new URLSearchParams();
  params.set('mailto', POLITE_EMAIL);
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY);

  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': `videnskabsmaskinen-audit/1.0 (mailto:${POLITE_EMAIL})`,
      Accept: 'application/json',
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);

  return res.json();
}

async function openalexSearchByTitle(title) {
  const params = new URLSearchParams();
  params.set('mailto', POLITE_EMAIL);
  params.set('per-page', '1');
  params.set('filter', `title.search:${title.slice(0, 200)}`);
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY);

  const url = `https://api.openalex.org/works?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': `videnskabsmaskinen-audit/1.0 (mailto:${POLITE_EMAIL})`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`OpenAlex search HTTP ${res.status}`);
  const json = await res.json();
  const hit = json.results?.[0];
  if (!hit) return null;

  // sanity-check titel-overlap så vi ikke fanger en helt anden artikel
  const a = normalize(hit.title || '');
  const b = normalize(title);
  if (jaccard(a, b) < 0.6) return null;

  return hit;
}

function collectOaLocations(work) {
  const locs = [];
  for (const loc of work.locations || []) {
    if (!loc?.is_oa) continue;
    if (loc.pdf_url) locs.push({ url: loc.pdf_url, kind: 'pdf', license: loc.license, source: loc.source?.display_name });
    if (loc.landing_page_url) locs.push({ url: loc.landing_page_url, kind: 'html', license: loc.license, source: loc.source?.display_name });
  }
  // Sortér: foretrækker repositories (PMC, arXiv osv.) over publisher-sites der ofte blokerer bots
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

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccard(a, b) {
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  const intersection = new Set([...sa].filter((x) => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

async function sampleFetchAnyUrl(locations) {
  const attempts = [];
  for (const loc of locations.slice(0, 3)) {
    const result = await sampleFetchUrl(loc.url);
    attempts.push({ ...result, kind: loc.kind, sourceName: loc.source });
    if (result.ok) return { ...result, kind: loc.kind, sourceName: loc.source, attemptedUrls: locations.length };
  }
  return { ok: false, attempts, attemptedUrls: locations.length };
}

async function sampleFetchUrl(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, status: res.status, url };
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) {
      const buf = await res.arrayBuffer();
      const usable = buf.byteLength > 50000; // PDFs >50KB sandsynligvis rigtige
      return {
        ok: true,
        usable,
        status: res.status,
        url,
        contentType: 'pdf',
        bodyLength: buf.byteLength,
      };
    }
    const body = await res.text();
    const quality = assessHtmlQuality(body);
    return {
      ok: true,
      usable: quality.usable,
      status: res.status,
      url,
      contentType: ct.split(';')[0],
      bodyLength: body.length,
      textLength: quality.textLength,
      paragraphCount: quality.paragraphCount,
      preview: body.slice(0, 200).replace(/\s+/g, ' '),
    };
  } catch (err) {
    return { ok: false, error: err.message, url };
  }
}

function assessHtmlQuality(html) {
  // Tæl <p>-tags og estimér body-tekstlængde efter strip
  const paragraphMatches = html.match(/<p\b[^>]*>/gi) || [];
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "Usable" = mindst 5000 tegn ren tekst OG mindst 10 paragraffer
  const usable = text.length > 5000 && paragraphMatches.length >= 10;
  return { textLength: text.length, paragraphCount: paragraphMatches.length, usable };
}

function pct(n, total) {
  if (!total) return '—';
  return `${Math.round((100 * n) / total)}%`.padStart(4);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
