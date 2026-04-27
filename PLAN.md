# Plan: Videnskabsmaskinen — fuld AWS-arkitektur

## Status (opdateret 2026-04-27)

### Færdigt
- ✅ Backend: Lambda + S3 (`videnskabsmaskinen-articles`) + API Gateway deployet via AWS SAM
- ✅ EventBridge: Crawler kører automatisk hver 6. time
- ✅ Frontend: Vite + TypeScript deployet på Amplify (`https://main.d1w9o0e40lcutv.amplifyapp.com/`)
- ✅ Crawler: **RSS** (`crawlRssSource.ts`, `type: "rss"` i kilder) + **HTML** (`crawlOneSource`) — `runCrawl()` vælger ud fra `source.type`
- ✅ **Kildelisten** i repo: flere RSS-feeds fra psykiatri- og psykologi-tidsskrifter i `backend/sources.json` (grupperet med `customerId` i filen)
- ✅ GitHub: Auto-deploy ved push til `main`
- ✅ **Bonzai-generator (live)**: `POST /articles/{id}/generate-draft` returnerer 202 + jobId med det samme, Lambda invoker sig selv asynkront og skriver resultatet til `S3:jobs/{jobId}.json`. Frontend poller `GET /jobs/{jobId}` indtil status=completed. Lambda kalder pt. Bonzai-assistenten "Generer videnskabsartikel" (claude-sonnet-4-6) via Vej B.
- ✅ **Async pattern**: omgår API Gateway HTTP API's 30s-timeout. IAM-policy `AllowSelfAsyncInvoke` på Lambda execution role.

### Mangler
- 🟡 **Redaktør-flow (demo)**: frontend har **rangering**, **udvælgelse til Til behandling** (localStorage) og **dedikeret Udkast-view** med ægte Bonzai-genereret artikel via async polling. Hele flowet er nu live. *Send til WordPress* i UI'et er stadig disabled indtil WordPress-credentials er på plads.
- ⬜ **S3 `articles/sources.json`**: hold produktions-kildelisten i sync med den version, der ligger i Git — Lambda læser fra S3 ved crawl
- ⬜ Løbende test af enkelte RSS-URL’er (udgivere ændrer feeds)
- ⬜ WordPress credentials sat i Lambda env vars
- ⬜ Test af fuldt process-article flow (Bonzai → WordPress)
- ⬜ Migrer `lambda:InvokeFunction` self-policy ind i SAM-templaten så den ikke skal genaktiveres ved fremtidige `sam deploy`

---

## Arkitektur

```
EventBridge (scheduler, hver 6. time)
    ↓
Lambda: videnskabsmaskinen-api
    ↓ skriver JSON
S3 bucket: videnskabsmaskinen-articles
    articles/sources.json
    articles/inbox/<sha1>.json
    articles/reviewed/<sha1>.json
    ↑ læser/skriver
API Gateway: https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod
    ↑ kalder
Frontend: https://main.d1w9o0e40lcutv.amplifyapp.com/
    → auto-deploy fra GitHub main via Amplify

Redaktør-flow (planlagt produktion):
Frontend (Inbox → Til behandling → Udkast) → POST /articles/{id}/process
    → fetchArticleBody (brødtekst fra original-URL)
    → Bonzai (Kristoffers prompt A) → WordPress REST API (draft)

Generator-flow (live, async pattern):
Frontend (Udkast-view) → POST /articles/{id}/generate-draft
    ← 202 + jobId (med det samme)
Lambda → invoker sig selv asynkront (InvocationType=Event)
Worker  → fetchArticleBody → Bonzai-assistent (Vej B) → S3: jobs/{jobId}.json
Frontend poller GET /jobs/{jobId} hvert 2.5s
    → renderer HTML i Udkast-view når status=completed
    Switches via VITE_USE_BACKEND_GENERATION=true; ellers mock.

Rangering (delvist i produktion):
Lambda → fetchArticleBody → Bonzai (rank-prompt) → felter på artikel-JSON i S3
    → GET /articles viser rank → frontend sorterer/fremhæver

Frontend-demo (i dag, uden backend-afhængigheder):
Inbox → "Behold" + vinkel → localStorage (Til behandling)
    → "Generer udkast" → mockGenerate.ts → localStorage (udkast)
    → Udkast-view → "Send til WordPress" (disabled, afventer credentials)
```

---

## Redaktør-flow i frontend (demo)

### Formål

- Vise det fulde redaktør-flow — fra triage til udkast — uden at vente på Bonzai- og WordPress-credentials i Lambda.
- Hele state ligger i `localStorage`, så demoen overlever reload, men intet skrives til S3.

### Flow

| Skridt | Hvor | Hvad |
|---|---|---|
| 1. Triage | **Inbox** | Artikler vises sorteret efter relevans (mock-rang). «Ignorer» kalder backend `PATCH`. «Behold + vinkel» flytter artiklen *lokalt* til Til behandling — intet API-kald. |
| 2. Udvælgelse | **Til behandling** (nyt nav-link) | Liste over valgte artikler med vinkel. Vinklen kan **inline-redigeres** (Rediger-knap → textarea → Gem); ved ændret vinkel slettes evt. eksisterende udkast så det regenereres med ny instruktion. Knapper: «Generer udkast» / «Åbn udkast», «Returner til inbox». |
| 3. Generering | **Udkast-view** (dedikeret) | `mockGenerate.ts` producerer en dansk populariseret artikel ud fra titel + teaser + vinkel. Tydeligt mærket «Demo-udkast». Kilde og «Læs videre» linker til originalen. |
| 4. Publish | **Udkast-view** | «Send til WordPress» er disabled med tooltip: kræver Bonzai- og WordPress-credentials i Lambda. |

### Begrænsninger ved mock-generatoren

`mockGenerate.ts` er **ikke en LLM** — det er ren string-skabelon. Den indsætter `title`, `teaser` og `angle` som substrings i et fast layout (rubrik + lede + 5 sektioner + closer). Konsekvenser:

- **Vinklen styrer ikke tone/stil/struktur.** Skriver redaktøren «omformuler til piratsprog», får man ordret sætningen «Redaktionelt har vi valgt at lægge vægt på omformuler indhold til piratsprog» — den faste tekst rundt om er uændret.
- **To af de fem sektioner er 100% statiske** («Sådan bør resultaterne læses», «Hvad det kan betyde i praksis») og ens på tværs af alle artikler.
- **Ingen domæneforståelse, ingen syntese, ingen omskrivning.** Teaseren gengives ordret.

Det er **bevidst** for at demoen ikke skal pretendere at være ægte AI-output. Tagget «Demo-udkast» i Udkast-viewets meta-blok signalerer dette. Reelt indhold kommer først når `processArticle(id, angle)`-routen i Lambda får Bonzai-credentials.

### Filer

- `frontend/src/store.ts` — localStorage-persistence af udvalgte artikler og udkast (`getSelected`, `addSelected`, `removeSelected`, `updateAngle`, `getDraft`, `saveDraft`)
- `frontend/src/mockGenerate.ts` — skabelon-baseret artikel-generator (rubrik, lede, mellemrubrikker, kilde-note)
- `frontend/src/components/selected.ts` — kort i Til behandling-listen, inkl. inline-redigering af vinkel
- `frontend/src/components/draft.ts` — udkast-view med toolbar og artikel-typografi
- `frontend/src/utils/text.ts` — `cleanTeaser` der striper inline metadata fra ScienceDirect-/Elsevier-feeds (`Publication date:`, `Source:`, `Author(s):`)

### Når Bonzai/WordPress-credentials er på plads

1. **Bonzai**: Følg `backend/prompts/bonzai-setup.md` for at sætte env vars. Sæt derefter `VITE_USE_BACKEND_GENERATION=true` på Amplify (og lokalt i `frontend/.env.local`) — så bruger Udkast-viewet `POST /articles/{id}/generate-draft` (Kristoffers prompt A + brødtekst via `fetchArticleBody`) i stedet for `mockGenerate`. Statusbadgen i meta-blokken skifter automatisk fra *Demo-udkast* til *Bonzai-udkast*.
2. **WordPress**: Aktivér WP-knappen i `draft.ts` (fjern `disabled` og tooltip-wrapper), og lad den kalde `processArticle(id, angle)` der allerede laver hele kæden (fetchArticleBody → Bonzai → WP draft).
3. Beslut om den lokale Til behandling-pulje skal bevares som «kladde-pulje før publicering» eller fjernes til fordel for direkte publicering.

---

## Redaktør-rangering (relevans)

### Formål

- Evaluere indkomne artikler og give dem en **rang eller score** efter relevans for redaktionen, så arbejdstriage bliver lettere.

### Mål

- Hver (ny) artikel — eller hele inbox på kommando — **evalueres** mod en aftalt **redaktionsprofil** (temaer, målgruppe, hvad redaktionen typisk dækker / ikke dækker).
- Output: fx **numerisk score** (0–100), **kort begrundelse** til redaktøren, og evt. **etiket** (fx «høj/mellem/lav»).
- **Frontend**: artikler vises sorteret efter relevans (eller med tydelig markering), så redaktøren ser de vigtigste først.

### Er backend klar?

**Delvist.** Den eksisterende arkitektur giver et godt udgangspunkt:

| Findes i dag | Bruges til rangering |
|----------------|----------------------|
| Lambda + S3 pr. artikel (`inbox/<id>.json`) | Gemme `relevanceScore`, `relevanceRationale`, `rankedAt` (navne TBD) |
| `GET /articles`, `PATCH /articles/{id}` | Udvides til at returnere/opdatere rank-felter |
| `process/bonzai.ts` (OpenAI-kompatibel klient) | Samme API-nøgle/base URL som til artikelgenerering; ny funktion fx `evaluateArticleRelevance(...)` |
| Crawl slutter med `saveArticle` | Valgfrit: kør ranking **efter** hver ny artikel, eller **batch** via nyt endpoint |

**Det findes ikke endnu:** felter på `Article` i `types.ts`, persistens i JSON, prompt + parsing af struktureret svar, API-route (fx `POST /articles/rank` eller ranking i crawl), og UI-sortering.

**Afhængighed:** Bonzai-credentials i Lambda skal virke før rangering kan køre i produktion; ved lokal udvikling kan samme API testes via env vars.

### Implementering

**Frontend-demo (på plads):**
- `frontend/src/mockRank.ts` — deterministisk keyword-heuristik (psykiatri-/psykologi-termer + RCT/metaanalyse positivt, pressemeddelelser/dyrestudier negativt) der giver score 0–100, bucket og rationale.
- `Ranger alle`-knap kører mock i memory og sorterer listen.
- Bruges til at vise konceptet uden Bonzai; resultatet persisteres ikke i S3 og forsvinder ved reload.

**Backend (klar, afventer credentials):**
1. `backend/src/process/editorialProfile.ts` — redaktionsprofil-tekst.
2. `backend/src/process/rankArticle.ts` — kalder modellen med titel, teaser og URL; kræver JSON-svar med `score`, `bucket`, `rationale`.
3. `Article`-type + S3 — opdateret JSON skrives tilbage til samme nøgle i `inbox/` med `relevanceScore`, `relevanceBucket`, `relevanceRationale`, `rankedAt`.
4. Trigger via `POST /articles/{id}/rank` (én artikel) eller `POST /articles/rank` (batch over inbox; `?force=true` for re-rank).
5. Når Bonzai-credentials er på plads i Lambda: skift `handleRank` i `frontend/src/main.ts` til at kalde `rankInbox()` fra `api.ts` i stedet for mock.

### Åbne produktspørgsmål

- Skal gamle artikler **om-rangeres** ved ændring af profil, eller kun nye?
- Tolerance for **hallucineret** relevans — altid menneskelig endelig vurdering; rank er **prioriteringshjælp**.

---

## Crawler: RSS (implementeret)

RSS giver stabil struktur (titel, teaser, link) uden skrøbelige HTML-selektorer. **HTML-crawlen** findes stadig til kilder uden brugbart feed.

| Del | Status |
|-----|--------|
| `backend/src/crawler/crawlRssSource.ts` | Henter feed med `fetch()`, parser `<item>` med let string/regex-parser. Renser teaseren for inline metadata (`Publication date:`, `Source:`, `Author(s):`) før den skrives til S3 |
| `handler.ts` → `runCrawl()` | `source.type === 'rss'` → RSS, ellers HTML |
| `backend/sources.json` | Flere RSS-kilder (fx JAMA Psychiatry, Biological Psychiatry, Lancet Psychiatry, …) under én kunde |

**Runtime:** Lambda læser kilder fra **`articles/sources.json` i S3** — ved ændring af kilder skal den fil opdateres (eller holdes i sync med Git), ellers kører produktion med gamle kilder.

### Eksempel-kilder (også muligt ved siden af tidsskrifter)

| Kilde | Type | URL |
|---|---|---|
| Videnskab.dk | HTML | `https://videnskab.dk/seneste-nyt/` |
| WordPress-sites | RSS | typisk `/feed/` |
| Tidsskrifter | RSS | per udgiver (som i `sources.json` i dag) |

---

## Credentials der mangler

Sættes som Lambda environment variables:
```bash
aws lambda update-function-configuration \
  --function-name videnskabsmaskinen-api \
  --region eu-west-1 \
  --environment "Variables={BONZAI_BASE_URL=...,BONZAI_API_KEY=...,BONZAI_MODEL=...,WORDPRESS_URL=...,WORDPRESS_USER=...,WORDPRESS_APP_PASSWORD=...}"
```

| Variabel | Beskrivelse |
|---|---|
| `BONZAI_BASE_URL` | Base URL til Bonzai API |
| `BONZAI_API_KEY` | API-nøgle |
| `BONZAI_MODEL` | Model-navn (fx `gpt-4o`) |
| `WORDPRESS_URL` | WordPress site URL (fx `https://poder.dk`) |
| `WORDPRESS_USER` | WordPress brugernavn |
| `WORDPRESS_APP_PASSWORD` | WordPress application password |

---

## Implementeringsrækkefølge (resterende)

1. **Bonzai-credentials**: Følg `backend/prompts/bonzai-setup.md` — opret evt. assistenten i Bonzai-UI'en, sæt `BONZAI_BASE_URL` / `BONZAI_API_KEY` / `BONZAI_MODEL` på Lambda
2. **Switch til ægte generator**: Sæt `VITE_USE_BACKEND_GENERATION=true` på Amplify + lokalt → Udkast-viewet kalder `/articles/{id}/generate-draft` i stedet for mock
3. **Aktivér rangering i produktion**: skift `handleRank` i `frontend/src/main.ts` fra `mockRankArticle` til `rankInbox()` så scoren persisteres i S3
4. **WordPress-credentials**: Sæt `WORDPRESS_*` env vars på Lambda
5. **Aktivér Send til WordPress**: flyt `processArticle(id, angle)` fra Inbox-flowet til Udkast-viewets WP-knap, og enable knappen
6. **Test fuldt flow**: Crawl → inbox → rangering → Til behandling → Generer udkast (Bonzai) → Send → WordPress draft
7. **Kilder (løbende)**: nye RSS-URL’er, deaktiver ødelagte feeds, hold S3 `sources.json` aligned med beslutninger
