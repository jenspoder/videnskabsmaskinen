# Sådan opsætter du «Videnskabsmaskinen — Generator» i Bonzai

Denne guide beskriver hvordan du opretter den Bonzai-assistent, vores
Lambda kalder, når en redaktør trykker **Generer udkast** i frontenden.

Vi har bygget integrationen, så Bonzai-assistenten *også* kan kaldes i
ren chat completions-tilstand (hvor Lambda selv sender system prompten).
Den simpleste vej til en virkende demo er derfor:

1. **Få Bonzai API-credentials** (steps 1-3 herunder).
2. **Sæt env vars** på Lambda (step 4).
3. **Test at det virker** (step 5).

Hvis Bonzai *også* har et UI til at oprette og navngive en assistent
(med fast system prompt), så opret den i UI'en (step 6) — det giver
redaktionen mulighed for at justere prompten uden redeploy senere. Hvis
Bonzai ikke har det koncept, så er prompten i `generateArticlePrompt.ts`
kilden, og vi opdaterer via Git.

---

## 1. Find Bonzai API-endpoint og credentials

Tjek hos jeres kontaktperson (eller i Bonzai-portalen):

- `BONZAI_BASE_URL` — fx `https://api.bonzai.example/v1` eller hvad de
  bruger. Vores Lambda forventer **OpenAI-kompatibelt endpoint**, dvs.
  at `POST {BASE_URL}/chat/completions` virker.
- `BONZAI_API_KEY` — secret token til at autentificere kald.
- `BONZAI_MODEL` — model-id, fx `gpt-4o`, `gpt-4-turbo` eller en
  Bonzai-specifik model. Den der vælges, bør kunne håndtere ca. 10.000
  ord input og generere op til 2.000 ord output.

## 2. (Valgfrit, men anbefalet) Opret et projekt i Bonzai

Hvis Bonzai har «projects» eller «workspaces», opret ét til denne demo
så credentials er isoleret fra andre ting:

- **Navn:** `Videnskabsmaskinen — Demo`
- **Beskrivelse:** Demo-assistent der omsætter videnskabelige RSS-
  artikler om mental sundhed til populærvidenskabelig journalistik på
  dansk.

## 3. Validér at API'et virker

Test først udenfor vores app, så vi ved at credentials er korrekte. Fra
din terminal (erstat værdier):

```bash
curl -X POST "$BONZAI_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $BONZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Sig hej på dansk." }
    ]
  }'
```

Hvis du får et JSON-svar med `choices[0].message.content` der indeholder
en hilsen, er API'et klar. Hvis det fejler:

- 401 → API key er forkert eller mangler `Bearer`-prefix.
- 404 → Base URL er forkert (mangler `/v1`?). Spørg Bonzai-supporten.
- 429 → Rate limit, vent et øjeblik.
- Andet → Send fejlen videre, så undersøger vi.

## 4. Sæt env vars på Lambda

I AWS-konsollen → Lambda → `videnskabsmaskinen-api` → **Configuration →
Environment variables**:

| Variable           | Værdi                                |
|--------------------|---------------------------------------|
| `BONZAI_BASE_URL`  | værdien fra step 1                   |
| `BONZAI_API_KEY`   | værdien fra step 1                   |
| `BONZAI_MODEL`     | værdien fra step 1 (fx `gpt-4o`)     |

> **Tip:** Du kan også sætte dem via SAM ved næste deploy — men UI'en er
> hurtigere til at validere uden ny deploy.

Når du har gemt env vars, vent ~10 sekunder og test:

```bash
curl -X POST "https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod/articles/<en-rigtig-artikel-id>/generate-draft" \
  -H "Content-Type: application/json" \
  -d '{ "angle": "Skriv kort og engagerende" }'
```

(Find et `articleId` ved at åbne demoen og kigge på `data-id` på et
inbox-card eller via S3.)

Forventet svar:

```json
{
  "articleId": "...",
  "title": "...",
  "sourceUrl": "...",
  "angle": "Skriv kort og engagerende",
  "html": "<h1>...</h1><p class=\"lede\"><em>...</em></p>...",
  "bodyFetched": true,
  "generatedAt": "2026-04-27T..."
}
```

`bodyFetched: true` betyder Bonzai fik brødteksten med. `false` betyder
sitet (fx ScienceDirect) blokerede crawling — modellen genererer
stadig, men kun ud fra titel + teaser.

## 5. Aktivér backend-generation i frontenden

Sæt env var på Vite-deployment (fx i Amplify):

```
VITE_USE_BACKEND_GENERATION=true
```

Lokalt i `frontend/.env.local`:

```
VITE_API_URL=https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod
VITE_USE_BACKEND_GENERATION=true
```

Genstart Vite (eller Amplify deploy). Når en redaktør nu trykker
**Generer udkast**, kalder frontenden Lambda → Bonzai → ægte AI-output
i stedet for mock-skabelonen. Statusbadgen i Udkast-viewet skifter fra
*Demo-udkast* til *Bonzai-udkast*.

Hvis du **ikke** sætter flagget, fortsætter demoen med at bruge mock —
nyttigt fx i præsentationssituationer hvor du ikke vil bruge tokens.

## 6. (Valgfrit) Opret en navngivet assistent i Bonzai-UI'en

Hvis Bonzai har et UI til at oprette assistenter med fast system prompt
(à la OpenAI Assistants eller «GPTs»):

1. Opret en assistent med navnet `Videnskabsmaskinen — Generator`.
2. Som **system prompt** indsætter du **hele teksten i blokken under
   «System prompt» i `backend/prompts/generate-article.md`**. Kopier
   *præcis* — ingen redigering af struktur — med mindre I bevidst
   tilpasser tonen.
3. Vælg samme model som i `BONZAI_MODEL`.
4. Tag assistant_id'en og sæt den som ekstra env var:
   `BONZAI_ASSISTANT_ID=<id>`. *Vores Lambda bruger den ikke i dag*,
   men når Bonzai-koncernen får støttet et `assistant_id`-felt i
   chat completions-kaldet, kan vi udvide `bonzai.ts` til at sende
   det. Indtil da fungerer redigering af prompten i Bonzai-UI'en kun
   som dokumentation, ikke som kilde — Lambda bruger
   `generateArticlePrompt.ts` som sandhedskilde.

> **Beslutning vi skal tage senere:** Hvis Bonzai *kun* understøtter
> chat completions (ikke et separat Assistants API), så er der ikke
> nogen god grund til at oprette en assistent i UI'en — prompten i
> repoet er sandhedskilden. Hvis Bonzai derimod har Assistants API,
> så omskriver vi `bonzai.ts` til at kalde
> `POST /assistants/{id}/messages` (eller hvad endpoint hedder) og
> sender kun user message + variabler.

## Hvis du vil ændre prompten

1. **Lambdas prompt:** Rediger `backend/src/process/generateArticlePrompt.ts`
   *og* `backend/prompts/generate-article.md` (de skal holdes i sync).
2. Deploy: `cd infrastructure && sam build && sam deploy`.
3. Hvis du har oprettet assistenten i Bonzai-UI'en (step 6), så kopier
   den nye system prompt fra `.md`-filen ind i UI'en også, så de er
   konsistente.

## Fejlfinding

| Symptom                                    | Sandsynlig årsag                              |
|--------------------------------------------|-----------------------------------------------|
| Lambda returnerer 500 «401 Unauthorized»    | Forkert `BONZAI_API_KEY` eller manglende prefix |
| Lambda returnerer 500 «404 Not Found»       | Forkert `BONZAI_BASE_URL` — mangler `/v1`?    |
| `bodyFetched: false` på alle artikler       | Crawler blokeres af alle sites — tjek at `User-Agent` ikke er rate limited; brug RSS-teaser som primær kilde |
| `html` indeholder \`\`\`html\`\`\` fences   | Modellen ignorerer instruktion — `stripFences` i `bonzai.ts` skal håndtere det |
| Generation tager > 30 sekunder              | Lambda timeout (default 60s i SAM-template). Hæv hvis nødvendigt eller bed Bonzai om kortere output |
