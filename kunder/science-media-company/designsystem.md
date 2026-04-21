# Designsystem – Science Media Company

**URL:** https://sciencemediacompany.dk/  
**Template:** "Dimension" af HTML5 UP  
**Dato dokumenteret:** 2026-04-21

---

## Visuel identitet

### Farvepalet

| Rolle | Farve | Værdi |
|---|---|---|
| Baggrund (body) | Næsten sort grå | `#1b1f22` |
| Primær tekst | Hvid | `#ffffff` |
| Panel/artikel baggrund | Semi-transparent mørk | `rgba(27, 31, 34, 0.85)` |
| Baggrundsbillede overlay | Mørk halvtransparent | `rgba(19, 21, 25, 0.5)` |
| Hover-state (knapper, nav) | Hvid 7,5% | `rgba(255, 255, 255, 0.075)` |
| Aktiv-state | Hvid 17,5% | `rgba(255, 255, 255, 0.175)` |
| Input-baggrund (fokus) | Hvid 7,5% | `rgba(255, 255, 255, 0.075)` |
| Placeholder-tekst | Halvtransparent hvid | `rgba(255, 255, 255, 0.5)` |
| Primær knap (filled) baggrund | Hvid | `#ffffff` |
| Primær knap (filled) tekst | Mørk | `#1b1f22` |

**Designet er monokromt:** ingen farveaccenter udover hvid-på-mørkt. Atmosfæren skabes primært af baggrundsbilledet (`images/w5b.jpg`) og dybdeeffekter via blur og opacity-transitions.

---

### Typografi

**Skrifttype:** Source Sans Pro (Google Fonts)  
Importeres via: `https://fonts.googleapis.com/css?family=Source+Sans+Pro:300italic,600italic,300,600`

**Breakpoint-baseret base font-size:**
- Desktop (standard): `16pt`
- ≤ 1680px: `12pt`
- ≤ 736px: `11pt`
- ≤ 360px: `10pt`

**Brødtekst:**
- Skrift: Source Sans Pro
- Vægt: 300 (light)
- Størrelse: `1rem`
- Linjehøjde: `1.65`
- Farve: `#ffffff`
- Afstand efter afsnit: `margin-bottom: 2rem`

**Overskrifter** (alle er uppercase med letter-spacing):

| Tag | Størrelse | Vægt | Letter-spacing | Linjehøjde |
|---|---|---|---|---|
| h1 | `2.25rem` (mobil: `1.75rem`) | 600 | `0.5rem` | `1.3` |
| h2 | `1.5rem` (mobil: `1.25em`) | 600 | `0.5rem` | `1.4` |
| h3 | `1rem` | 600 | `0.2rem` | `1.5` |
| h4 | `0.8rem` | 600 | `0.2rem` | `1.5` |
| h5 | `0.7rem` | 600 | `0.2rem` | `1.5` |
| h6 | `0.6rem` | 600 | `0.2rem` | `1.5` |

**`.major`-variant** (bruges til sektionstitler inde i artikelpanelerne):
- Tilføjer `border-bottom: solid 1px #ffffff`
- `width: max-content` (understregen følger kun tekstbredden)
- `padding-bottom: 0.5rem`
- `margin-bottom: 2rem`

**Links:**
- Farve: arver (`color: inherit`)
- Understreg: `border-bottom: dotted 1px rgba(255, 255, 255, 0.5)`
- Hover: understreg forsvinder

---

### Spacing og grid

- `#wrapper` padding: `4rem 2rem` (desktop) → `3rem 2rem` (≤1680px) → `2rem 1rem` (≤736px) → `1rem` (≤480px)
- Artikelpaneler er centrerede, max-bredde `40rem`
- Standard afstand efter block-elementer (p, overskrifter, etc.): `2rem`
- Ingen decideret grid — layout er single-column, centreret

---

## Komponenter

### Header / Splash-skærm

Header er sitets velkomstskærm og vises kun på forsiden (forsvinder når en artikel åbnes):

- Cirkulært logo: `5.5rem × 5.5rem`, `border: solid 1px #ffffff`, `border-radius: 70%`
- Logo-billede: `images/logo_cirkel.png` (120px bredde, inline-stylet)
- Sitetitel: `<h1>` — "Science Media Company"
- Undertitel: `<h2>` — "V/Kristoffer frøkjær"
- Tagline: `<h3>` — opsummerer de tre serviceområder
- Indholdsblok (`#header .content`) har `border-top: 1px` og `border-bottom: 1px`, begge `#ffffff`
- Indre padding: `3rem 2rem`
- Baggrund på header: `radial-gradient(rgba(0,0,0,0.25) 25%, rgba(0,0,0,0) 55%)` — subtil dybdeeffekt

Når en artikel åbnes: header skaleres til 0.95, blur `0.1rem`, opacity → 0 (transition `0.325s ease-in-out`).

---

### Navigation

```html
<nav>
  <ul>
    <li><a href="#intro">Om</a></li>
    <li><a href="#work">Journalistik</a></li>
    <li><a href="#AI">AI kurser</a></li>
    <li><a href="#ide">Projektudvikling</a></li>
    <li><a href="#contact">Kontakt</a></li>
  </ul>
</nav>
```

- Container: `display: flex`, `border: solid 1px #ffffff`, `border-radius: 4px`
- Hvert nav-item: `min-width: 7.5rem`, `height: 2.75rem`, `line-height: 2.75rem`
- Tekst: `font-size: 0.8rem`, uppercase, `letter-spacing: 0.2rem`
- Separator: `border-left: solid 1px #ffffff` (undtagen første)
- Hover: `background-color: rgba(255, 255, 255, 0.075)`
- Aktiv: `background-color: rgba(255, 255, 255, 0.175)`
- Mobilvisning (≤480px): vertikal flex, `border-top` erstatter `border-left`

Ingen separat mobilmenu (hamburger) — navigationen kollapser til en vertikal liste.

---

### Artikelpaneler (modal-lignende sektioner)

Indholdet er struktureret som skjulte `<article>`-elementer, der aktiveres af nav-linkene:

```html
<article id="intro">
  <h2 class="major">Om</h2>
  <span class="image main"><img src="images/kf2.jpg" alt="" /></span>
  <p>...</p>
</article>
```

**Stil:**
- Bredde: `40rem`, max-width: `100%`
- Baggrund: `rgba(27, 31, 34, 0.85)` — semi-transparent mørk flade
- `border-radius: 4px`
- Padding: `4.5rem 2.5rem 1.5rem 2.5rem` (desktop) / `3.5rem 2rem 0.5rem 2rem` (≤736px) / `3rem 1.5rem 0.5rem 1.5rem` (≤480px)
- Lukkeknap: `4rem × 4rem` i øverste højre hjørne, cirkulær, med X-ikon (SVG)
- Transition ved åbning: `opacity 0.325s ease-in-out` + `translateY(0.25rem → 0)`

**Sektioner:**

| ID | Titel | Billede |
|---|---|---|
| `#intro` | Om | `images/kf2.jpg` |
| `#AI` | AI kurser til kommunikatører | `images/qw.JPG` |
| `#work` | Videnskabsjournalistik | `images/jou1.jpg` |
| `#ide` | Projektudvikling | `images/projekt.jpg` |
| `#contact` | Kontakt | — |

---

### `.image.main` — artikelbilleder

Bruges øverst i hvert artikelpanel:

- `display: block`, `width: 100%`
- `margin: 2.5rem 0` (desktop) / `2rem 0` (≤736px) / `1.5rem 0` (≤480px)
- `border-radius: 4px`
- Mørkt overlay: `background-color: rgba(19, 21, 25, 0.5)` + `images/overlay.png` (teksturoverlay), `opacity: 0.1`

---

### Knapper

**Standard (outlined):**
- `background-color: transparent`
- `box-shadow: inset 0 0 0 1px #ffffff`
- `color: #ffffff`
- `height: 2.75rem`, `line-height: 2.75rem`
- `font-size: 0.8rem`, uppercase, `letter-spacing: 0.2rem`
- `border-radius: 4px`
- Hover: `background rgba(255,255,255,0.075)`
- Aktiv: `background rgba(255,255,255,0.175)`

**`.primary` (filled):**
- `background-color: #ffffff`
- `color: #1b1f22`
- `font-weight: 600`

**`.small`:**
- `font-size: 0.6rem`, `height: 2.0625rem`

**Disabled:**
- `opacity: 0.25`, `pointer-events: none`

---

### Kontaktformular

```html
<form method="post" action="#">
  <div class="fields">
    <div class="field half">
      <label for="name">Navn</label>
      <input type="text" name="name" id="name" placeholder="Navn" />
    </div>
    <div class="field half">
      <label for="email">Email</label>
      <input type="email" name="email" id="email" placeholder="Email" />
    </div>
    <div class="field">
      <label for="message">Besked</label>
      <textarea name="message" id="message" placeholder="Skriv din besked" rows="4"></textarea>
    </div>
  </div>
  <ul class="actions">
    <li><input type="submit" value="Send besked" class="primary" /></li>
    <li><input type="reset" value="Nulstil" /></li>
  </ul>
</form>
```

**Inputfelter:**
- `background-color: transparent`
- `border: solid 1px #ffffff`
- `border-radius: 4px`
- `height: 2.75rem` (text/email), textarea: `padding: 0.75rem 1rem`
- Fokus: `background rgba(255,255,255,0.075)`, `box-shadow: 0 0 0 1px #ffffff`
- Placeholder: `rgba(255,255,255,0.5)`

---

### Social-ikoner (ul.icons)

- Cirkulære ikoner: `2.25rem × 2.25rem`
- `box-shadow: inset 0 0 0 1px #ffffff`
- `line-height: 2.25rem`, `text-align: center`
- Hover: `background-color: rgba(255,255,255,0.075)`
- Kun LinkedIn er i brug

---

### Footer

- Simpel tekst-footer centreret i bunden
- Indeholder: firmanavn, email, telefon, CVR, adresse
- `font-size: 0.6rem`, uppercase, `letter-spacing: 0.2rem`, `opacity: 0.75`
- Forsvinder (opacity → 0) når en artikel er åben

---

## Baggrundssystem

Baggrunden er et separat `#bg`-element der er fixed og fylder hele viewporten:

- Baggrundsbillede: `images/w5b.jpg` (cover, center)
- Overlay: `linear-gradient(to top, rgba(19,21,25,0.5), rgba(19,21,25,0.5))` + `images/overlay.png` (grain-tekstur)
- Når en artikel åbnes: baggrunden skaleres til 1.0825 og blurres `0.2rem` (dybdeeffekt)

---

## Sidetyper

**Science Media Company er en single-page application** med ét layout:

1. **Forsidevisning** — splash med logo, sitetitel, tagline og navigation
2. **Artikelvisning** — et panel/modal vises oven på baggrunden, forsiden toges ned
3. **Kontaktsidevisning** — samme artikelpanel-layout, men med formular i stedet for brødtekst

Der er ingen separate sidetyper, produktsider, kategori-sider eller lister.

---

## Tone og stil

**Visuel tone:**
- Mørkt, atmosfærisk og seriøst — taler til professionelle og beslutningstagere
- Monokromt (sort/hvid) uden farveaccenter — signalerer faglig autoritet
- Baggrundsbilledet (`w5b.jpg`) er det eneste visuelle virkemiddel til stemning
- Billeder i panelerne er dokumentarisk/faglig stil (person, miljø)

**Teksttone:**
- Professionel men tilgængelig — ikke akademisk stiv
- Kompetencefokuseret: fremhæver erfaring, baggrund og metoder (PPIT, NABC, Knowledge Brokering)
- CTA er implicitte — ingen aggressive "køb nu"-knapper
- Opgaveorienteret: beskriver hvad kunden får, ikke abstrakte værdier

**Animationer:**
- Alle overgange: `0.325s ease-in-out`
- Baggrundstransition ved preload: `2.5s ease-in-out`
- Panel-åbning: opacity + translateY kombination
- Header/footer forsvinder ved panel-visning: blur + scale(0.95) + opacity 0

---

## Teknisk stack

- Ren HTML/CSS/JS — ingen framework
- Template: HTML5 UP "Dimension"
- jQuery (til panel-animationer og navigation)
- Font Awesome 5 (ikoner)
- Google Fonts: Source Sans Pro
- Ingen CMS, ingen backend (statisk site)
- Kontaktformular: PHP-baseret (utilaktiveret kode kommenteret ud i HTML)
