/**
 * Generator-prompt til Bonzai-assistenten «Videnskabsmaskinen — Generator».
 *
 * VIGTIGT: Denne fil skal holdes i sync med backend/prompts/generate-article.md,
 * som er den canonical reference redaktionen bruger til at opdatere prompten i
 * Bonzai-UI'en. Hvis du ændrer her, så opdater også .md-filen — og omvendt.
 *
 * VIGTIGT (Vej B): Når BONZAI_MODEL er agent_* sendes kun **user message** til
 * Bonzai — assistentens systeminstruktion i UI'en skal derfor spejle reglerne
 * herunder (kopier fra generate-article.md).
 *
 * Hvorfor inline i TS frem for runtime fs-read:
 * - Lambda bundler kun src/, ikke prompts/. Vi undgår SAM-bøvl.
 * - Type-checking fanger tomme strings.
 * - Hot path: ingen IO ved første kald.
 */

import type { Article } from '../types';
export const GENERATE_SYSTEM_PROMPT = `
Du er en dygtig dansk videnskabsjournalist med solid faglig forståelse
af psykologi og psykiatri. Du omsætter videnskabelige artikler til
populærvidenskabelig journalistik på dansk, målrettet voksne læsere
der er nysgerrige på mental sundhed og sygdom — ikke nødvendigvis
fagfolk.

Din opgave er at skrive én færdig artikel ud fra de kildedata og den
redaktionelle vinkel, brugeren sender i sin besked.

OPGAVENS RAMMER

Tro mod kilden
- Artiklen skal være faktuelt korrekt og tro mod den oprindelige
  forskning.
- Forbehold fra kildeartiklen SKAL altid medtages i artiklen.
- Skriv aldrig påstande, der ikke kan udledes af titel, teaser eller
  kildeartiklens egne formuleringer.
- Inddrag ikke andre videnskabelige input end selve kildeartiklen og
  dens egen referencesektion. Hvis referencesektionen ikke er synlig
  for dig, så lad være med at gætte titler eller forfattere.

Vinkel
- Redaktørens vinkel styrer fokus og rammesætning, ikke fakta.
- Hvis vinklen er en stil-instruktion (fx «kortere», «mere klinisk»,
  «for unge læsere»), så følg den i sprog og tone uden at gå på
  kompromis med præcisionen.
- Hvis vinklen er tom eller intetsigende, så vælg selv den vinkel der
  bedst formidler den centrale pointe i kilden.

Sprog og tone
- Skriv på godt og ortografisk korrekt dansk uden at forsimple
  fagligheden unødigt. Stil-instruktioner som «kort», «for unge» eller
  «uformelt» må aldrig medføre tastefejl, dobbelte bogstaver eller
  norsk/svensk indslag — ortografi skal altid være korrekt uanset
  vinkel.
- Brug ikke-stigmatiserende sprog. Undgå formuleringer som «psykisk
  syge er…», «svage», «defekte», «farlige».
- Brug «mennesker med depression» frem for «depressive» osv.
- Skelne tydeligt mellem diagnoser, symptomer og selvrapporterede
  scores. Skriv aldrig «depression», når kilden kun måler symptomer
  eller score på en skala.
- Undgå kausale formuleringer («fører til», «skyldes», «gør at…»),
  hvis kilden ikke har et kausalt design (RCT). Brug i stedet
  «hænger sammen med», «er forbundet med», «associeret med».

Nyhedskriterier (vægt og indvinkling)
- Aktualitet (årstid, samfundsdebat, aktuelle udfordringer).
- Væsentlighed for den almindelige læser.
- Identifikation: skriv så læseren kan genkende sig selv eller en
  pårørende.
- Delbarhed og engagement: artiklen skal have potentiale for samtale
  online og offline.
- Kritisk konstruktiv: vis gerne løsninger eller perspektiver, ikke
  kun konflikt.
- Anvendelighed: hvad kan læseren bruge dette til i hverdagen,
  arbejdet eller samfundsdebatten.
- Fokuser på en dansk vinkel, men kun hvis den findes i kilden.
- Sæt nogle gange løsningerne først.

Struktur og længde
- Fængende, men faktuel overskrift.
- Forklarende underrubrik (lede) på 1-3 sætninger.
- I det første almindelige brødtekstafsnit efter lede (det første <p>
  uden class="lede") skal du med naturlig nyhedsjournalistik knytte
  artiklens bud til kilden — fx «ifølge …», «som forskerne beskriver i …»,
  «i et studie publiceret i …». Det skal føles som en integreret del af
  teksten (som i en klassisk nyhedscrawler), ikke et separat metadatafelt.
- Mindst tre afsnit med selvstændige overskrifter.
- I et af afsnittene: forklar i en bredere sammenhæng — trukket fra
  kildeartiklens egen introduktion eller diskussion — hvorfor det
  problem, kilden undersøger, er væsentligt.
- Længde: 500-2000 ord. Vælg længden ud fra kildens tyngde.
- Brug IKKE bulletlister eller punkttegn. Skriv sammenhængende prosa.

Output-format
Returner KUN ren HTML uden code fences eller markdown. Brug disse tags:

<h1>...</h1>                         (artiklens overskrift)
<p class="lede"><em>...</em></p>     (underrubrik / lede)
<h2>...</h2>                         (sektions-overskrift)
<p>...</p>                           (almindeligt afsnit)

I det første <p> efter lede må du indsætte højst ét link til selve
kildeartiklen for læseren, med præcis denne form:
<a href="..." target="_blank" rel="noopener noreferrer">meningsfuld tekst</a>
Href skal være præcis den URL der står som «Href til link i løbende tekst»
i brugerbeskeden (når den findes). Linkteksten skal være naturlig (fx
tidsskriftsnavn, forlag eller kort beskrivelse), aldrig kun «klik her».

Ingen <ul>, <ol>, <li>, <strong>, <div>, <section>, <img>, <br> eller
andre tags end de nævnte — undtagen det ene <a> som ovenfor.
Ingen indledende «Her er artiklen:» — start direkte med <h1>.
`.trim();

export interface GenerateUserMessageInput {
  title: string;
  teaser: string;
  url: string;
  angle: string;
  suggestedTitle?: string | null;
  suggestedExcerpt?: string | null;
  sourceDescription?: string;
  /**
   * Brødtekst hentet fra kildens URL af fetchArticleBody. Tom streng
   * hvis sitet blokerede (fx 403 fra ScienceDirect). I så fald falder
   * Bonzai tilbage til titel + teaser.
   */
  body: string;
  /** https-URL til <a href> i første brødtekstafsnit (typisk original/forlag). */
  citationUrl?: string;
  /** ISO fra RSS pubDate når tilgængelig. */
  sourcePublishedAt?: string | null;
  /** ISO — fallback for dato i løbende tekst. */
  discoveredAt?: string;
}

function formatDanishLongDate(iso: string | undefined | null): string {
  if (!iso?.trim()) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Første brugbare https-URL til læserens klik (original, ellers OA/content). */
export function readerCitationUrl(article: Pick<Article, 'url' | 'openAccess' | 'sourceType'>): string {
  const primary = article.url?.trim() ?? '';
  if (/^https?:\/\//i.test(primary) && !/^uploaded-document:/i.test(primary)) {
    return primary;
  }
  const oa = article.openAccess?.oaUrl?.trim();
  if (oa && /^https?:\/\//i.test(oa)) return oa;
  const cs = article.openAccess?.contentSourceUrl?.trim();
  if (cs && /^https?:\/\//i.test(cs)) return cs;
  return '';
}

export function buildGenerateUserMessage(input: GenerateUserMessageInput): string {
  const angleSection = input.angle.trim()
    ? input.angle.trim()
    : 'Ingen specifik vinkel angivet. Vælg selv den vinkel, der bedst formidler kildens centrale pointe.';

  const sourceDescription = input.sourceDescription?.trim()
    || (input.body.trim()
      ? 'Fuldtekst fra den bedst tilgængelige kilde.'
      : 'Kun titel og teaser/abstract er tilgængeligt.');

  const suggestedTitle = input.suggestedTitle?.trim();
  const suggestedExcerpt = input.suggestedExcerpt?.trim();
  const articleIdeaSection = suggestedTitle || suggestedExcerpt
    ? `\nARTIKELIDÉ FRA REDAKTIONELT FORARBEJDE\nDette er et redaktionelt udgangspunkt fra den indledende vurdering. Brug det som retning for titel, lede og fokus, men forbedr det hvis kildeteksten eller vinklen kræver det. Du må ikke opfinde fakta for at få idéen til at passe.\n${suggestedTitle ? `Foreslået titel: ${suggestedTitle}\n` : ''}${suggestedExcerpt ? `Foreslået teaser/underrubrik: ${suggestedExcerpt}\n` : ''}`
    : '';

  const bodySection = input.body.trim()
    ? `\nTEKSTGRUNDLAG FOR GENERERING\n${sourceDescription}\n\n${input.body.trim()}\n`
    : `\nTEKSTGRUNDLAG FOR GENERERING\n${sourceDescription}\n\nBrug kun titel og teaser/abstract. Vær ekstra forsigtig med ikke at finde på detaljer, metodeafsnit, tal eller konklusioner der ikke fremgår af tekstgrundlaget.\n`;

  const hrefForCitation = (input.citationUrl?.trim() || input.url?.trim() || '').trim();
  const datePrimary = formatDanishLongDate(input.sourcePublishedAt);
  const dateFallback = formatDanishLongDate(input.discoveredAt);
  const dateLine = datePrimary || dateFallback || 'ikke angivet';

  const citationBlock = hrefForCitation
    ? `
KILDE I LØBENDE TEKST (obligatorisk — som i en nyhedsartikel)
I det første almindelige <p>-afsnit efter lede og før første <h2> skal du
naturligt integrere kilden i prosaen (fx «ifølge en undersøgelse i …»,
«som beskrives i …», «i et studie publiceret …») — ikke som et separat
metadatafelt.
- Indsæt præcis ét klikbart link med:
  <a href="${hrefForCitation}" target="_blank" rel="noopener noreferrer">meningsfuld linktekst</a>
  Brug PRÆCIS denne href-streng (kopier tegn-for-tegn): ${hrefForCitation}
- Arbejd kildedatoen ind i samme afsnit når det giver mening.
  Kildedato til formulering: ${dateLine}
  (Hvis kildedato ovenfor er «ikke angivet», undlad at opdigte en konkret kalenderdato.)
`
    : `
KILDE I LØBENDE TEKST (obligatorisk)
Der er ingen offentlig http(s)-URL til link. I det første <p> efter lede skal du
alligevel naturligt henvise til kilden ved navn/titel — uden <a>-tag.
- Kildedato til formulering: ${dateLine}
`;

  return `Skriv én færdig populærvidenskabelig artikel baseret på følgende kilde og redaktionelle vinkel.

KILDE
Titel: ${input.title}
Teaser/abstract: ${input.teaser || '(ingen teaser)'}
URL (til reference): ${input.url}
${articleIdeaSection}
${bodySection}
${citationBlock}
REDAKTIONEL VINKEL
${angleSection}

Returner kun ren HTML i det format, der er beskrevet i din instruktion.`;
}
