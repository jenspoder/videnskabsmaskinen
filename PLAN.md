# Plan: Videnskabsmaskinen — fuld AWS-arkitektur

## Status (opdateret 2026-04-24)

### Færdigt
- ✅ Backend: Lambda + S3 (`videnskabsmaskinen-articles`) + API Gateway deployet via AWS SAM
- ✅ EventBridge: Crawler kører automatisk hver 6. time
- ✅ Frontend: Vite + TypeScript deployet på Amplify (`https://main.d1w9o0e40lcutv.amplifyapp.com/`)
- ✅ Crawler: **RSS** (`crawlRssSource.ts`, `type: "rss"` i kilder) + **HTML** (`crawlOneSource`) — `runCrawl()` vælger ud fra `source.type`
- ✅ **Kildelisten** i repo: flere psykiatri-/psykologi-tidsskrifts-RSS-feeds i `backend/sources.json` (kunden «Psykiatri-tidsskrifter»); reelt indhold kommer fra de feeds projektleder har lagt på
- ✅ GitHub: Auto-deploy ved push til `main`

### Mangler
- ⬜ **Redaktør-rangering**: evaluering af artikler + score/rank for relevans (se afsnit nedenfor; i gang på branch `feature/redaktor-rangering`)
- ⬜ **S3 `articles/sources.json`**: sikr at deployed/produktions-kilder matcher den liste I vil køre (Git-filen er sandhed i repo; Lambda læser fra S3 ved crawl)
- ⬜ Løbende test af enkelte RSS-URL’er (udgivere ændrer feeds)
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

## Crawler: RSS (implementeret)

RSS giver stabil struktur (titel, teaser, link) uden skrøbelige HTML-selektorer. **HTML-crawlen** findes stadig til kilder uden brugbart feed.

| Del | Status |
|-----|--------|
| `backend/src/crawler/crawlRssSource.ts` | Henter feed med `fetch()`, parser `<item>` med let string/regex-parser |
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

1. **Redaktør-rangering**: typer + Bonzai-evaluering + persistens i S3 + API + frontend-sortering (se afsnit ovenfor)
2. **Credentials**: Sæt Bonzai + WordPress env vars i Lambda
3. **Test fuldt flow**: Crawl → inbox → (rangering) → Send / forhåndsvisning → WordPress draft
4. **Kilder (løbende)**: nye RSS-URL’er, deaktiver ødelagte feeds, hold S3 `sources.json` aligned med beslutninger
