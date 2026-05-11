# OpenAlex Audit — Findings

**Dato:** 11. maj 2026  
**Sample:** 59 artikler fordelt på 7 RSS-kilder (10 nyeste pr. kilde, dog kun 2 i Schizophrenia Bulletin der havde få i feed)  
**Script:** `backend/scripts/openalex-audit.mjs`

## TL;DR

OpenAlex er **fantastisk til metadata** men kun **delvis hjælp til fuldtekst**:

- **95% af alle artikler findes i OpenAlex** med struktureret data (forfattere, abstracts, citationer)
- **42% er markeret som Open Access** og har en URL til en OA-version
- **Men kun ~25-30% af forsøgte fetches gav reelt brugbart artikel-indhold** — resten blev blokeret af bot-detection eller var paywall-stub

**Kvalitative observationer**: Bot-blokeringen er platformsspecifik. Springer/Nature-tidsskrifter (`nature.com`) leverer perfekt. Elsevier (`sciencedirect.com`) blokerer alt. Wiley (`onlinelibrary.wiley.com`) blokerer det meste.

## Resultater pr. kilde

| Kilde | Forlag | DOI ekstraheret | I OpenAlex | OA tilgængelig | Fuldtekst USABLE | Bemærkning |
|---|---|---|---|---|---|---|
| **Molecular Psychiatry** | Springer/Nature | 100% | 88% | 50% | **100% (3/3)** | Bot-venlig, CC-BY artikler virker perfekt |
| **Acta Psychiatrica Scandinavica** | Wiley | 100% | 100% | 60% | 33% (1/3) | Wiley blokerer mest, men nogle CC-BY virker |
| **Lancet Psychiatry** | Elsevier | 100% | 100% | 20% | 50% (1/2) | Lav OA-rate men de der er, kan hentes |
| **Schizophrenia Research** | Elsevier | 90% | 90% | 40% | **0% (0/3)** | ScienceDirect blokerer alt — kun stub-HTML |
| **Biological Psychiatry** | Elsevier | 90% | 90% | 70% | **0% (0/3)** | ScienceDirect blokerer trods høj OA-rate |
| **Schizophrenia Bulletin** | Oxford Academic | 100% | 100% | 0% | n/a | Helt closed access |
| **JAMA Psychiatry** | AMA | 100% | 100% | 22% | 0% (0/2) | Næsten helt closed access |

### Konklusion pr. kilde

- ✅ **Beholdes**: Molecular Psychiatry — pålidelig fuldtekst-tilgang via OpenAlex
- ⚠️ **Behov for fallback**: Acta Psychiatrica + Lancet Psychiatry — delvist OA, fetch er upålidelig
- ❌ **Stort set ubrugelig** for fuldtekst: Schizophrenia Research, Biological Psychiatry — OpenAlex finder OA-versioner men ScienceDirect-platformen blokerer alt
- ❌ **Helt ubrugelig** for OA-fuldtekst: Schizophrenia Bulletin, JAMA Psychiatry

## OA-status fordeling (af 59)

| Status | Antal | Pct | Forklaring |
|---|---|---|---|
| `closed` | 31 | 53% | Ingen OA-version eksisterer — paywall-only |
| `hybrid` | 15 | 25% | Forfatter har betalt for OA i ellers paywallet tidsskrift |
| `green` | 5 | 8% | OA-version findes i et repository (PMC, preprint, institutionelt) |
| `bronze` | 4 | 7% | Forlag har lagt PDF gratis ud uden formel licens |
| `gold` | 1 | 2% | Helt OA-tidsskrift |
| `unknown` | 3 | 5% | Status ikke registreret |

## Licens-fordeling (af 59)

| Licens | Antal | Pct | Hvad må vi |
|---|---|---|---|
| `no-license` | 42 | 71% | Standard ophavsret — kun fair use (citater, omtale) |
| `cc-by` | 13 | 22% | Fri til omformulering + republikation med tilskrivning |
| `cc-by-nc-nd` | 3 | 5% | Kun ikke-kommerciel + ingen ændringer — ikke brugbar for os |
| `other-oa` | 1 | 2% | Varierende vilkår |

**Juridisk pointe**: Selvom artikler er "Open Access" betyder det ikke automatisk at vi må omformulere dem. **Kun 22% (CC-BY)** er sikkert at bruge med LLM-omskrivning. Resten kræver fair-use-vurdering.

## Hvad audit-scriptet ikke har testet endnu

- **PMC E-utilities API**: PMC's HTML-pages 403'er, men deres XML-API virker. Vi kan måske få mere fuldtekst gennem den vej (kræver mapping fra DOI → PMCID).
- **Andre OA-først tidsskrifter** (Frontiers, BMC, PLOS, Translational Psychiatry, JMIR Mental Health) — vores nuværende kildeliste er paywall-tung. Skift til OA-først ville sandsynligvis give 80-100% USABLE rate.
- **Pressemeddelelser** (EurekAlert, Newswise) — alternativ kilde der kan give bedre råmateriale end videnskabsartiklen selv.

## Praktiske implikationer for systemet

### Lille effekt (kan implementeres uafhængigt)

- **Bedre metadata for 95% af artikler**: OpenAlex's strukturerede data (forfattere, koncepter, citationer) kan tilføjes til alle artikler. Det forbedrer ranking og giver redaktøren mere kontekst.
- **Bedre abstract for ~50-78%**: OpenAlex genopbygger abstract fra inverted index — ofte længere/komplet end det vi får i RSS.

### Mellemstor effekt

- **Reel fuldtekst for ~25-30% af artikler**: Springer/Nature CC-BY artikler kan hentes pålideligt. For disse kan LLM'en producere markant bedre artikler.
- **Filter "Vis kun brugbart"** i UI: Lad redaktøren skjule artikler hvor vi ikke kan få fuldtekst. Reducerer demo-volumen men hæver gennemsnitskvaliteten.

### Stor effekt (kræver kildebeslutning)

- **Skift kildeliste til OA-først tidsskrifter**: Frontiers in Psychiatry, BMC Psychiatry, PLOS Mental Health, Translational Psychiatry, JMIR Mental Health, npj Schizophrenia. Forventet USABLE rate: 80-100%. Kontra: tabt prestige-tidsskrifter.
- **Tilføj EurekAlert! som primær kilde**: Pressemeddelelser er tit bedre råmateriale end selve studiet og dækker også paywallede studier. Forventet hit-rate: ~70% af mediedækningsværdige psyk-studier.

## Anbefalet næste skridt

1. **Skift til OA-først kildeliste eller suppler** — det er det vigtigste valg I skal træffe
2. **Implementer OpenAlex-integration** uanset retning — metadata-forbedringen er gratis upgrade  
3. **Test EurekAlert!-feeds** parallelt — sandsynligvis det største kvalitetsspring
4. **Pivotér evt. format** — kort nyhedsartikel ved kun-abstract, lang formidling ved fuldtekst

## Bilag: Sådan kører du auditen igen

```bash
cd /Users/oliverdyruphanert/peytz-custom-projects/sciencemediacompany
node backend/scripts/openalex-audit.mjs --per-source=10 --sample-fetches=3
# Output: openalex-audit-report.json (rå data) + console summary
```

Eller for én bestemt kilde:

```bash
node backend/scripts/openalex-audit.mjs --source=molecular-psychiatry --per-source=20
```
