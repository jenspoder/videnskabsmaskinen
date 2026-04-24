# Plan: Videnskabsmaskinen — fuld AWS-arkitektur

## Status (opdateret 2026-04-24)

### Færdigt
- ✅ Backend: Lambda + S3 (`videnskabsmaskinen-articles`) + API Gateway deployet via AWS SAM
- ✅ EventBridge: Crawler kører automatisk hver 6. time
- ✅ Frontend: Vite + TypeScript deployet på Amplify (`https://main.d1w9o0e40lcutv.amplifyapp.com/`)
- ✅ Crawler: Videnskab.dk (HTML) kører, 16 artikler i inbox
- ✅ GitHub: Auto-deploy ved push til `main`

### Mangler
- ⬜ **Redaktør-rangering**: evaluering af artikler + score/rank for relevans (se afsnit nedenfor; i gang på branch `feature/redaktor-rangering`)
- ⬜ RSS-understøttelse i crawler (se nedenfor)
- ⬜ Kildeliste defineret og testet
- ⬜ Bonzai API credentials sat i Lambda env vars
- ⬜ WordPress credentials sat i Lambda env vars
- ⬜ Test af fuldt process-article flow (Bonzai → WordPress)

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

"Send"-flow:
Frontend → POST /articles/{id}/process → Bonzai API → WordPress REST API (draft)

Rangering (planlagt):
Lambda → Bonzai (evaluerings-prompt) → felter på artikel-JSON i S3 → GET /articles viser rank → frontend sorterer/fremhæver
```

---

## Redaktør-rangering (relevans)

### Ønske fra projektleder

> Det kunne være fedt, hvis vi fik lavet et setup, hvor den kunne evaluere de artikler, der er, og give dem en eller anden form for rank ud fra, hvor relevante de er for redaktøren.

### Mål

- Hver (ny) artikel — eller hele inbox på kommando — **evalueres** mod en aftalt **redaktionsprofil** (temaer, målgruppe, hvad I typisk dækker / ikke dækker).
- Output: fx **numerisk score** (0–100), **kort begrundelse** til redaktøren, og evt. **etiket** (fx «høj/mellem/lav»).
- **Frontend**: artikler vises sorteret efter relevans (eller med tydelig markering), så redaktøren ser de vigtigste først.

### Er backend klar?

**Delvist.** I har allerede det rigtige sted at bygge videre:

| Findes i dag | Bruges til rangering |
|----------------|----------------------|
| Lambda + S3 pr. artikel (`inbox/<id>.json`) | Gemme `relevanceScore`, `relevanceRationale`, `rankedAt` (navne TBD) |
| `GET /articles`, `PATCH /articles/{id}` | Udvides til at returnere/opdatere rank-felter |
| `process/bonzai.ts` (OpenAI-kompatibel klient) | Samme API-nøgle/base URL som til artikelgenerering; ny funktion fx `evaluateArticleRelevance(...)` |
| Crawl slutter med `saveArticle` | Valgfrit: kør ranking **efter** hver ny artikel, eller **batch** via nyt endpoint |

**Det findes ikke endnu:** felter på `Article` i `types.ts`, persistens i JSON, prompt + parsing af struktureret svar, API-route (fx `POST /articles/rank` eller ranking i crawl), og UI-sortering.

**Afhængighed:** Bonzai-credentials i Lambda skal virke før rangering kan køre i produktion (lokalt kan I teste med env vars mod samme API).

### Implementering (første iteration)

1. **Redaktionsprofil** — én fast tekstblok (senere: per `customerId` i `sources.json` eller egen fil i S3).
2. **`backend/src/process/rankArticle.ts`** (eller lign.) — kalder modellen med titel, teaser, URL (evt. kilde-navn); kræv JSON-svar: `score`, `rationale`, evt. `bucket`.
3. **`Article`-type + S3** — når rank er beregnet, skriv opdateret JSON tilbage til samme nøgle i `inbox/`.
4. **Trigger** — enten (A) automatisk efter crawl for nye artikler, (B) `POST` der ranker hele inbox, eller (C) per-artikel knap; start gerne med **B eller C** for lavere omkostning og nemmere fejlsøgning.
5. **Frontend** — sortér liste efter `relevanceScore` desc; vis score + kort rationale på kortet.

### Åbne produktspørgsmål

- Skal gamle artikler **om-rangeres** ved ændring af profil, eller kun nye?
- Tolerance for **hallucineret** relevans — altid menneskelig endelig vurdering; rank er **prioriteringshjælp**.

---

## Næste: RSS-understøttelse i crawler

### Hvorfor RSS
- Stabil struktur — ingen CSS-selektorer der går i stykker ved redesign
- Titel, beskrivelse, URL og dato ud af boksen
- De fleste WordPress-sites har `/feed/` som standard (inkl. Poder)
- Bruges til kilder der har RSS — HTML-crawleren beholdes til resten

### Implementering
Tilføj `type: "rss" | "html"` i `sources.json` per kilde.

Ny fil: `backend/src/crawler/crawlRssSource.ts`
- Henter RSS-feed med `fetch()`
- Parser XML med en lille regex/string-parser (ingen ekstra dependency)
- Returnerer samme `Article`-array som `crawlOneSource`

`handler.ts` → `runCrawl()` vælger parser baseret på `source.type`.

### Kilder (TBD — defineres løbende)
| Kilde | Type | URL |
|---|---|---|
| Videnskab.dk | HTML | `https://videnskab.dk/seneste-nyt/` |
| Poder (WordPress) | RSS | `https://poder.dk/feed/` |
| Øvrige | TBD | TBD |

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

1. **Redaktør-rangering**: typer + Bonzai-evaluering + persistens i S3 + API + frontend-sortering (se afsnit ovenfor)
2. **RSS-crawler**: `crawlRssSource.ts` + `type`-felt i `sources.json` (filer findes; verificér deploy og kilder)
3. **Kildeliste**: Definer og test kilder med rigtige selektorer/RSS-URLs
4. **Credentials**: Sæt Bonzai + WordPress env vars i Lambda
5. **Test fuldt flow**: Crawl → inbox → (rangering) → Send / forhåndsvisning → WordPress draft
