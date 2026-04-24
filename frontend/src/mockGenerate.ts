import type { Article } from './types';
import { cleanTeaser } from './utils/text';

export function generateMockDraft(article: Article, angle: string): string {
  const teaser = cleanTeaser(article.teaser);
  const headline = buildHeadline(article);
  const lede = buildLede(article, angle, teaser);
  const sections = buildSections(article, angle, teaser);
  const closer = buildCloser(article);

  return `
<h1>${escape(headline)}</h1>
<p class="lede"><em>${escape(lede)}</em></p>
${sections}
${closer}
  `.trim();
}

function buildHeadline(article: Article): string {
  return shortenTitle(article.title);
}

function buildLede(article: Article, angle: string, teaser: string): string {
  const angleHint = angle.trim()
    ? `med fokus på ${escape(lowercaseFirst(firstSentence(angle)))}`
    : 'og hvad det betyder for behandlingen i klinisk praksis';

  if (teaser && teaser.length > 30) {
    return `Et nyt studie peger på, at ${escape(shortenTeaser(teaser))} — her ser vi nærmere på, hvad fundene konkret kan betyde, ${angleHint}.`;
  }
  return `Et nyt studie kaster lys over et område, der længe har optaget både forskere og klinikere — her gennemgår vi de vigtigste pointer ${angleHint}.`;
}

function buildSections(article: Article, angle: string, teaser: string): string {
  const studyText = teaser
    ? `${escape(teaser)} Resultaterne tyder på et mønster, som ifølge forfatterne fortjener opmærksomhed i den videre debat — særligt fordi feltet i forvejen er præget af modstridende fund.`
    : 'Forskerholdet bag studiet undersøgte sammenhænge, der hidtil har været vanskelige at adskille i klinisk praksis. Resultaterne tyder på et mønster, som ifølge forfatterne fortjener opmærksomhed i den videre debat — særligt fordi feltet i forvejen er præget af modstridende fund.';

  const angleSection = angle.trim()
    ? `Redaktionelt har vi valgt at lægge vægt på ${escape(lowercaseFirst(firstSentence(angle)))}. Det er denne tråd, vi forsøger at trække skarpere op herunder, fordi den ofte glider i baggrunden, når studier af denne type bliver omtalt i pressen.`
    : 'Redaktionelt har vi valgt at fokusere på de elementer, der har størst direkte betydning for klinisk praksis — frem for at gengive studiets metodiske detaljer i deres fulde længde.';

  const sourceLinkText = article.url
    ? `Den oprindelige publikation kan læses i sin fulde længde via <a href="${escape(article.url)}" target="_blank" rel="noopener">kilden</a>, hvor metode, deltagere og statistiske analyser er beskrevet i detaljer.`
    : 'Den oprindelige publikation beskriver metode, deltagere og statistiske analyser i detaljer.';

  return `
<h2>Det viser studiet</h2>
<p>${studyText}</p>

<h2>Vores vinkel</h2>
<p>${angleSection}</p>

<h2>Sådan bør resultaterne læses</h2>
<p>Som med de fleste enkeltstudier er det vigtigt at huske, at fundene endnu ikke er gentaget på tværs af populationer. Effektstørrelser, opfølgningsperiode og selektionen af deltagere har betydning for, hvor langt konklusionerne kan strækkes. Det betyder ikke, at studiet er uvæsentligt — kun at det bør indgå i en større mosaik af evidens, før det får lov at ændre anbefalinger.</p>

<h2>Hvad det kan betyde i praksis</h2>
<p>For klinikere åbner fundene for en samtale om, hvornår eksisterende anbefalinger bør revideres, og hvornår det giver mening at afvente flere studier. For pårørende og patienter handler det om at forstå, at forskningens nuancer sjældent passer ind i en simpel overskrift — men at netop nuancerne er dét, der gør forskellen mellem en fornuftig og en forhastet ændring i behandlingen.</p>

<h2>Læs videre</h2>
<p>${sourceLinkText} Vi følger op, hvis efterfølgende analyser eller replikationer ændrer billedet væsentligt.</p>
  `.trim();
}

function buildCloser(article: Article): string {
  const hostname = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return 'kilden'; }
  })();
  return `<p class="source-note"><small>Baseret på <a href="${escape(article.url)}" target="_blank" rel="noopener">${escape(article.title)}</a> (${escape(hostname)}).</small></p>`;
}

function firstSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/^[^.?!]+[.?!]?/);
  return match ? match[0].trim().replace(/[.?!]+$/, '') : cleaned;
}

function shortenTitle(title: string): string {
  const cleaned = title.trim();
  if (cleaned.length <= 90) return cleaned;
  const cutoff = cleaned.lastIndexOf(' ', 88);
  return cleaned.slice(0, cutoff > 40 ? cutoff : 88) + '…';
}

function shortenTeaser(teaser: string): string {
  const cleaned = teaser.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 240) return lowercaseFirst(cleaned).replace(/[.?!]+$/, '');
  const cutoff = cleaned.lastIndexOf(' ', 238);
  return lowercaseFirst(cleaned.slice(0, cutoff > 100 ? cutoff : 238)).replace(/[.?!]+$/, '') + '…';
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
