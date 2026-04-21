# Plan: Videnskabsmaskinen — fuld AWS-arkitektur

## Status (opdateret 2026-04-21)

### Færdigt
- ✅ Backend: Lambda + S3 (`videnskabsmaskinen-articles`) + API Gateway deployet via AWS SAM
- ✅ EventBridge: Crawler kører automatisk hver 6. time
- ✅ Frontend: Vite + TypeScript deployet på Amplify (`https://main.d1w9o0e40lcutv.amplifyapp.com/`)
- ✅ Crawler: Videnskab.dk (HTML) kører, 16 artikler i inbox
- ✅ GitHub: Auto-deploy ved push til `main`

### Mangler
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
```

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

1. **RSS-crawler**: `crawlRssSource.ts` + `type`-felt i `sources.json`
2. **Kildeliste**: Definer og test kilder med rigtige selektorer/RSS-URLs
3. **Credentials**: Sæt Bonzai + WordPress env vars i Lambda
4. **Test fuldt flow**: Crawl → inbox → Send → WordPress draft
