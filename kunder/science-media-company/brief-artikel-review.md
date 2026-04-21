# Brief: Artikel-review interface

## Formål
Et batchbaseret review-interface til videnskabsredaktøren hos Science Media Company. Redaktøren sidder med en ny pulje artikler fundet af en crawler og skal hurtigt sortere dem: enten beholde dem (og sende dem videre til AI-bearbejdning) eller ignorere dem. Interfacet skal minimere friktion og holde flowet hurtigt.

Målgruppen er én person: Kristoffer Frøkjær som videnskabsredaktør.

---

## Kontekst
Demoen er en standalone HTML-side i Science Media Company's designunivers — mørkt, monokromt, Source Sans Pro. Den behøver ikke at integrere med det eksisterende site, men skal visuelt føles som samme familie.

---

## Indhold og struktur

### Header
- Logo (cirkel-logo, `images/logo_cirkel.png`) + sitenavn til venstre
- Overskrift: "Artikeloverblik" eller "Nye artikler til review"
- Antal artikler tilbage i puljen, fx: "8 artikler tilbage"

### Artikelliste
En lodret stak af artikelkort. Hvert kort indeholder:

**Øverste del (altid synlig):**
- Billede: thumbnail til venstre (ca. 160×110px), med en mørk placeholder hvis intet billede findes (fx et ikon eller farveblok i designsystemets stil)
- Til højre for billedet:
  - Overskrift (`h3`-niveau, uppercase, letter-spacing)
  - Kort beskrivelse (2-3 linjer brødtekst)
  - Link til originalartikel — diskret, fx "Læs original →" med dotted underline, åbner i nyt faneblad

**Handlingszone (under eller ved siden af indholdet):**
- To knapper: **Behold** (primary, filled hvid) og **Ignorer** (outlined, transparent)
- Når **Behold** klikkes: et tekstfelt folder ud inline under knapperne med label "Din vinkel" og placeholder "Hvad er vinklen på denne artikel?" samt en **Send**-knap
- Når **Ignorer** klikkes: kortet forsvinder med en kort fade-out animation — ingen bekræftelse nødvendig
- Når **Send** klikkes (efter Behold + vinkel): kortet forsvinder med samme fade-out

### Afslutningsskærm
Når alle artikler er behandlet vises en simpel besked centreret på siden:
- Tekst: "Du er igennem alle artikler i denne pulje."
- Ingen knapper — demoen stopper her

---

## Specifikke krav

- **Realistisk indhold:** Brug disse 10 artikler fra Nature.com (april 2026):

  1. **Personalized CRISPR therapies could soon reach thousands — here's how**
     Ny tilgang til test af sjældne genetiske sygdomme gør behandlingsproduktion økonomisk rentabel.

  2. **'Bat feast' animal videos at African cave offer clues to how deadly viruses spread**
     Forskere filmede 10 dyrearter, der spiste flagermus på et kendt Marburg-virus-hotspot med hundredvis af menneskelige besøgende.

  3. **No humans allowed: scientific AI agents get their own social network**
     Autonome agenter "skaber deres egen forskning" på Agent4Science, en Reddit-lignende platform for kunstig intelligens.

  4. **Got bugs? Here's how to catch the errors in your scientific software**
     Computerforskere deler råd til sikring af, at videnskabelig software fungerer som tilsigtet.

  5. **Ancient DNA reveals pervasive directional selection across West Eurasia**
     Analyse af 15.836 gamle vesteurasiske genomer afslørede hundredvis af tilfælde af retningsbestemt selektion.

  6. **What does the future hold for the thawing Arctic?**
     To eksperter udreder, hvordan klima- og geopolitiske tendenser kan forme det nordlige område.

  7. **How hidden contributions power modern research**
     Mennesker, der arbejder bag scenen, siger, der bør være mere anerkendelse for deres roller.

  8. **Immune cells have a surprising role in exercise endurance**
     Undersøgelse i mus foreslår, at B-celler hjælper med at regulere muskelydelse under træning.

  9. **US lawmakers intensify scrutiny of scientific-publishing practices**
     Kongreshøring dækkede fremkomsten af papirmøller og omkostninger ved open-access-publicering.

  10. **A step-by-step guide to nailing your tenure promotion package**
      Vejledning til en vigtig akademisk milepæl, selvom ansættelsesprocessen "er overraskende uigennemsigtig."

- **Billeder:** Brug en ensartet mørk placeholder for alle artikler (da vi ikke har adgang til Nature.com's billeder) — fx en mørkegrå flade med et lille videnskabsikon centreret
- **Links:** Alle "Læs original"-links peger på `https://www.nature.com` (generisk, da vi ikke har de præcise URLs)
- **Animation:** Fade-out når et kort fjernes (`opacity: 0` + `max-height: 0` over ca. 300ms)
- **Vinkelfeltet** folder ud med en smooth expand-animation når Behold klikkes (`max-height` transition)
- **Responsivt:** Fungerer på desktop (primært) men må ikke bryde på en tablet-bredde

---

## Designsystem-referencer

**Genbruges direkte:**
- Baggrundsfarve: `#1b1f22`
- Tekstfarve: `#ffffff`
- Skrifttype: Source Sans Pro 300/600
- Knapper: primary (hvid filled) og outlined (transparent med hvid box-shadow)
- Input/textarea: border `1px solid #ffffff`, transparent baggrund, fokus-state med `rgba(255,255,255,0.075)`
- Border-radius: `4px` på alle elementer
- Overskrifter: uppercase, letter-spacing `0.2rem`

**Nye elementer der skal designes:**
- Artikelkort: mørk flade (`rgba(27,31,34,0.85)` eller lidt lysere for at adskille fra baggrund), med en subtil border (`1px solid rgba(255,255,255,0.15)`)
- Billedplaceholder: mørkegrå flade (`rgba(255,255,255,0.05)`) med et lille ikon
- Inline vinkel-felt: folder ud under handlingsknapperne, med label og Send-knap
- Tæller i headeren: lille badge eller tekst der viser resterende antal

---

## Succeskriterier
- En redaktør kan komme igennem alle 10 artikler uden at løfte hænderne fra musen
- Flowet fra "se artikel" → "beslut" → "næste" føles hurtigt og ufriktioneret
- Vinkelfeltet er tydeligt koblet til Behold-handlingen — ikke en selvstændig formular
- Siden ser ud som om den hører hjemme i Science Media Company's univers
