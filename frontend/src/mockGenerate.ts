import type { Article } from './types';

export function generateMockDraft(article: Article, angle: string): string {
  const headline = buildHeadline(article, angle);
  const lede = buildLede(article, angle);
  const sections = buildSections(article, angle);
  const closer = buildCloser(article);

  return `
<h1>${escape(headline)}</h1>
<p class="lede"><em>${escape(lede)}</em></p>
${sections}
${closer}
  `.trim();
}

function buildHeadline(article: Article, angle: string): string {
  const angleSeed = firstSentence(angle);
  if (angleSeed && angleSeed.length > 12 && angleSeed.length < 90) {
    return capitalize(angleSeed.replace(/[.?!]+$/, ''));
  }
  return shortenTitle(article.title);
}

function buildLede(article: Article, angle: string): string {
  const angleHint = angle.trim()
    ? `med fokus på ${lowercaseFirst(firstSentence(angle))}`
    : 'og hvad det betyder for behandlingen i klinisk praksis';

  const teaser = article.teaser?.trim();
  if (teaser) {
    return `Et nyt studie peger på, at ${shortenTeaser(teaser)} — her ser vi nærmere på, hvad fundene konkret kan betyde, ${angleHint}.`;
  }
  return `Et nyt studie kaster lys over et område, der længe har optaget både forskere og klinikere — her gennemgår vi de vigtigste pointer, ${angleHint}.`;
}

function buildSections(article: Article, angle: string): string {
  const teaser = article.teaser?.trim() || 'Forskerholdet bag studiet undersøgte sammenhænge, der hidtil har været vanskelige at adskille i klinisk praksis.';
  const angleText = angle.trim() || 'Den redaktionelle interesse ligger i, hvordan resultatet kan oversættes til konkrete anbefalinger for fagfolk.';

  return `
<h2>Det viser studiet</h2>
<p>${escape(teaser)} Resultaterne tyder på et mønster, som ifølge forfatterne fortjener opmærksomhed i den videre debat — særligt fordi feltet i forvejen er præget af modstridende fund.</p>

<h2>Vores vinkel</h2>
<p>${escape(angleText)} Det er denne tråd, vi forsøger at trække skarpere op i artiklen herunder.</p>

<h2>Hvad det kan betyde i praksis</h2>
<p>For klinikere åbner fundene for en samtale om, hvornår eksisterende anbefalinger bør revideres, og hvornår det giver mening at afvente flere studier. For pårørende og patienter handler det om at forstå, at forskningens nuancer sjældent passer ind i en simpel overskrift — men at netop nuancerne er dét, der gør forskellen mellem en fornuftig og en forhastet ændring i behandlingen.</p>
  `.trim();
}

function buildCloser(article: Article): string {
  const hostname = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return 'kilden'; }
  })();
  return `<p class="source-note"><small>Baseret på ${escape(article.title)} (${escape(hostname)}).</small></p>`;
}

function firstSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/^[^.?!]+[.?!]?/);
  return match ? match[0].trim() : cleaned;
}

function shortenTitle(title: string): string {
  const cleaned = title.trim();
  if (cleaned.length <= 80) return cleaned;
  const cutoff = cleaned.lastIndexOf(' ', 78);
  return cleaned.slice(0, cutoff > 40 ? cutoff : 78) + '…';
}

function shortenTeaser(teaser: string): string {
  const cleaned = teaser.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 220) return lowercaseFirst(cleaned).replace(/[.?!]+$/, '');
  const cutoff = cleaned.lastIndexOf(' ', 218);
  return lowercaseFirst(cleaned.slice(0, cutoff > 100 ? cutoff : 218)).replace(/[.?!]+$/, '') + '…';
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercaseFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function escape(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
