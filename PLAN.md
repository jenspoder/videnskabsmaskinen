# Plan: Videnskabsmaskinen — fuld AWS-arkitektur

## Kontekst

Vi har et eksisterende redaktørinterface (`kunder/science-media-company/demo-artikel-review/index.html`) bygget i vanilla HTML/JS med hardcodede artikler og ingen backend. Målet er at erstatte det med en reel applikation, der:

1. Crawler videnskabskilder automatisk og gemmer artikler i S3
2. Viser artiklerne i et redaktørinterface der kalder et AWS API
3. Lader redaktøren ignorere eller beholde artikler (med vinkel)
4. Ved "behold": sender artiklen til Bonzai AI → formaterer som HTML → publisher til WordPress som draft

Der eksisterer allerede en fungerende prototype i `/Users/jenshjerrildpoder/Python-Maskiner/nyhedscrawler` som vi genbruger store dele af.

---

## Arkitektur

```
EventBridge (scheduler, hver 6. time)
    ↓
Lambda: crawler
    ↓ skriver JSON
S3 bucket: videnskabsmaskinen-articles
    articles/inbox/<uuid>.json
    articles/reviewed/<uuid>.json
    articles/sources.json
    ↑ læser/skriver
Lambda: articles-api
    ↑ kalder
API Gateway (HTTP API)
    ↑ kalder
Frontend (Vite + TypeScript)
    → hosted på AWS Amplify (auto-deploy fra GitHub main)

"Behold"-flow:
Frontend → Lambda: process-article → Bonzai API → WordPress REST API
```

---

## Mappestruktur i projektet

```
videnskabsmaskinen/
  frontend/
    src/
      main.ts
      api.ts          ← wrapper til API Gateway
      types.ts        ← Article, Status (kopieres/tilpasses fra prototype)
      components/
        inbox.ts
        archive.ts
    index.html        ← kopiér design fra demo-artikel-review/index.html
    vite.config.ts
    tsconfig.json
    package.json

  backend/
    src/
      handler.ts                    ← Lambda entry point (tilpasses fra prototype)
      types.ts                      ← kopieres fra prototype, tilføj nye felter
      s3Store.ts                    ← kopieres fra prototype, tilpas til individuelle filer
      crawler/
        crawlOneSource.ts           ← kopieres direkte fra prototype (uændret)
      process/
        bonzai.ts                   ← ny: Bonzai API-kald (OpenAI-kompatibel)
        wordpress.ts                ← ny: WordPress REST API draft-publicering
    sources.json                    ← kopieres fra prototype, skift til videnskabskilder
    package.json
    tsconfig.json

  infrastructure/
    template.yaml                   ← AWS SAM template
```

---

## Hvad genbruges fra prototypen

| Fil i prototype | Destination | Ændringer |
|---|---|---|
| `backend/src/crawler/crawlOneSource.ts` | `backend/src/crawler/crawlOneSource.ts` | Ingen |
| `backend/src/s3Store.ts` | `backend/src/s3Store.ts` | Tilpas til individuelle filer (ikke én stor items.json) |
| `backend/src/types.ts` | `backend/src/types.ts` | Tilføj `angle`, `wordpressPostId`, `publishedAt` |
| `backend/src/handler.ts` | `backend/src/handler.ts` | Udvid med process-article endpoint |
| `backend/sources.json` | `backend/sources.json` | Skift til videnskabskilder (TBD) |
| `backend/package.json` | `backend/package.json` | Tilføj openai-sdk til Bonzai |

---

## S3-datastruktur

Bucket: `videnskabsmaskinen-articles`

```
articles/sources.json              ← kilde-konfiguration
articles/inbox/<uuid>.json         ← nye artikler fra crawler
articles/reviewed/<uuid>.json      ← gennemgåede artikler
```

Article JSON-schema (udvidelse af prototype-typen):
```json
{
  "id": "sha1-af-url",
  "customerId": "science-media-company",
  "sourceId": "kilde-1",
  "title": "Titel",
  "url": "https://...",
  "teaser": "Kort beskrivelse",
  "discoveredAt": "ISO8601",
  "status": "new" | "ignored" | "processing" | "published",
  "angle": "",
  "reviewedAt": null,
  "publishedAt": null,
  "wordpressPostId": null
}
```

---

## Lambda-funktioner

### 1. `crawler` (EventBridge trigger, hver 6. time)
- Genbruger `crawlOneSource.ts` fra prototype
- Læser kildeliste fra `articles/sources.json` i S3
- Deduplication: springer artikler over hvis ID allerede findes i inbox eller reviewed
- Gemmer nye artikler som individuelle filer: `articles/inbox/<id>.json`

### 2. `articles-api` (API Gateway)
- `GET /articles?status=inbox` → lister og returnerer alle filer i `articles/inbox/`
- `GET /articles?status=reviewed` → lister `articles/reviewed/`
- `PATCH /articles/{id}` med `{ status, angle? }` → flytter fil mellem mapper, opdaterer felter
- `POST /crawl` → trigger manuel crawl (til test)

### 3. `process-article` (API Gateway)
- `POST /articles/{id}/process` med `{ angle }`
- Henter artikel fra S3
- Kalder Bonzai via OpenAI-kompatibel SDK (base URL + model sættes som Lambda env vars)
- Prompt: skriv dansk artikel baseret på titel, teaser, kilde-URL og redaktørens vinkel
- Formaterer svar som HTML
- Poster til WordPress: `POST /wp-json/wp/v2/posts` med Basic Auth (application password)
- Opdaterer artikel i S3: `status: "published"`, `wordpressPostId`, `publishedAt`

---

## Frontend (Vite + TypeScript)

Erstatter demo-artikel-review. Kopierer det visuelle design direkte.

- Henter artikler via `GET /articles?status=inbox` og `?status=reviewed`
- `ignoreArticle(id)` → `PATCH /articles/{id}` med `{ status: "ignored" }`
- `sendArticle(id, angle)` → `POST /articles/{id}/process` med `{ angle }`
- Polling eller manuel refresh-knap (ingen websockets)
- Env var: `VITE_API_URL` sat i Amplify

---

## Implementeringsrækkefølge

1. **Backend fundament**: Kopier og tilpas prototype → S3-struktur med individuelle filer + articles-api Lambda + API Gateway (SAM template)
2. **Frontend migration**: Vite + TypeScript setup, kopiér eksisterende design, kobl til API
3. **Crawler**: Tilpas til videnskabskilder, deploy med EventBridge schedule
4. **Process-article**: Bonzai-integration + WordPress-publicering
5. **Amplify deploy**: Kobl GitHub repo, sæt env vars (API URL, Bonzai key, WordPress credentials)

---

## Åbne punkter (non-blocking)
- Kildeliste til crawleren — starter med én placeholder-kilde, tilføjer løbende
- Bonzai base URL og model-navn — indsættes som Lambda env vars
- WordPress site URL og application password — indsættes som Lambda env vars

---

## Verificering

- Crawler: Kør `POST /crawl` manuelt → tjek at JSON dukker op i S3 inbox
- API: `curl GET /articles?status=inbox` returnerer array
- Frontend: Inbox viser artikler, knapper opdaterer S3
- Process: Klik "Send" → draft-post dukker op i WordPress
