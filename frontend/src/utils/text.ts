// Renser teasere fra RSS-feeds (især ScienceDirect/Elsevier) der har
// inline metadata som "Publication date: ...", "Source: ...", "Author(s): ..."
// klistret sammen uden mellemrum eller linjeskift.
//
// Bruges både ved render af inbox-kort og som input til mock-generatoren,
// så eksisterende artikler i S3 også vises pænt uden re-crawl.

const META_PREFIXES = [
  'Publication date',
  'Source',
  'Author(s)',
  'Authors',
  'DOI',
];

export function cleanTeaser(raw: string | null | undefined): string {
  if (!raw) return '';

  let text = raw.replace(/\s+/g, ' ').trim();

  for (const prefix of META_PREFIXES) {
    const re = new RegExp(`${prefix}\\s*:\\s*[^]*?(?=\\s+(?:${META_PREFIXES.join('|')})\\s*:|$)`, 'gi');
    text = text.replace(re, ' ');
  }

  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[—–\-:•·,;\s]+/, '').trim();

  return text;
}
