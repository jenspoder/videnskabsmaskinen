# Sådan opsættes Bonzai-generator i Lambda

Denne guide beskriver hvordan vores Lambda kalder Bonzai for at generere
populærvidenskabelige udkast, og hvordan du skifter mellem de to
opsætninger vi understøtter.

## Arkitektur i ét overblik

```
[Frontend "Generer udkast"]
  ↓ POST /articles/{id}/generate-draft
[Lambda]                     ── 202 + jobId ──→ frontenden
  ↓ async self-invoke (InvocationType=Event)
[Lambda worker]
  ↓ POST {BONZAI_BASE_URL}/chat/completions
[Bonzai] ── HTML ──→ S3: jobs/{jobId}.json (status=completed)

[Frontend poller GET /jobs/{jobId} hvert 2.5s]
```

Vi bruger et **async pattern** fordi Bonzai-assistenten typisk skriver
i 30-60 sekunder, hvilket overskrider API Gateway HTTP API's hårde
timeout på 30s. Lambda invoker sig selv asynkront og frontenden poller
S3 indtil resultatet er klart.

## To måder at kalde Bonzai på

Vores `backend/src/process/bonzai.ts` understøtter begge opsætninger
via `BONZAI_MODEL`:

| | Vej A — chat completions | Vej B — Bonzai Assistant |
|---|---|---|
| `BONZAI_BASE_URL` | `https://…/v1` | `https://…/assistants` |
| `BONZAI_MODEL` | fx `claude-sonnet-4-5` | `agent_xxx` (id på din assistent) |
| `BONZAI_API_KEY` | Project API key | Personal API key (kun den der har oprettet assistenten kan kalde den) |
| Prompt-kilde | `generateArticlePrompt.ts` (Git-versioneret) | Bonzai-UI'en |
| Backup af prompt i Git | Samme fil | `backend/prompts/generate-article.md` (manuel sync) |

`bonzai.ts` checker om `BONZAI_MODEL` starter med `agent_`. Hvis ja,
sender vi kun user-message; ellers sender vi system-prompt + user-message.

## Vej A: chat completions

Den simpleste opsætning — alt findes i Git og kan deployes uden afhængighed
af Bonzai's UI.

```
BONZAI_BASE_URL=https://api-v2.bonzai.iodigital.com/v1
BONZAI_API_KEY=<project key>
BONZAI_MODEL=claude-sonnet-4-5
```

For at ændre prompten: rediger `backend/src/process/generateArticlePrompt.ts`,
deploy. Den kanoniske version er også i `backend/prompts/generate-article.md`
(bør holdes i sync som backup).

## Vej B: Bonzai Assistant (anbefalet i produktion)

Brug en assistent oprettet i Bonzai-UI'en. Prompten kan redigeres uden
deploy. Krav: API-keyen skal tilhøre den bruger der har oprettet
assistenten (det er en begrænsning i Bonzai's permission-model i dag).

```
BONZAI_BASE_URL=https://api-v2.bonzai.iodigital.com/assistants
BONZAI_API_KEY=<personal key fra https://app.bonzai.iodigital.com/api-keys>
BONZAI_MODEL=agent_L-IbyQc5TYwIaK2_orOs2
```

For at finde assistant-id:

```bash
curl -s https://api-v2.bonzai.iodigital.com/assistants/assistants \
  -H "Authorization: Bearer $BONZAI_API_KEY" | jq '.data[] | {id, name}'
```

For at oprette/ændre assistenten: gå til
https://app.bonzai.iodigital.com → Assistants → vælg eller opret
"Generer videnskabsartikel". Indsæt prompten fra
`backend/prompts/generate-article.md` (System prompt-blokken).

## Test API-keyen direkte (uden Lambda)

```bash
# Vej A
curl -s -X POST https://api-v2.bonzai.iodigital.com/v1/chat/completions \
  -H "Authorization: Bearer $BONZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"Sig hej"}]}'

# Vej B
curl -s -X POST https://api-v2.bonzai.iodigital.com/assistants/chat/completions \
  -H "Authorization: Bearer $BONZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"agent_L-IbyQc5TYwIaK2_orOs2","messages":[{"role":"user","content":"Sig hej"}]}'
```

## Sæt env vars og deploy

```bash
PERSONAL_KEY=$(cat ~/.bonzai-test-key)  # eller hvor du har den
aws lambda update-function-configuration \
  --function-name videnskabsmaskinen-api \
  --region eu-west-1 \
  --environment "Variables={BUCKET=videnskabsmaskinen-articles,\
BONZAI_BASE_URL=https://api-v2.bonzai.iodigital.com/assistants,\
BONZAI_API_KEY=$PERSONAL_KEY,\
BONZAI_MODEL=agent_L-IbyQc5TYwIaK2_orOs2,\
WORDPRESS_URL=https://placeholder,\
WORDPRESS_USER=placeholder,\
WORDPRESS_APP_PASSWORD=placeholder}"
```

Deploy koden:

```bash
cd backend
npm run package
aws lambda update-function-code --function-name videnskabsmaskinen-api \
  --region eu-west-1 --zip-file fileb://function.zip
```

## End-to-end test mod live Lambda

```bash
API=https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod
ID=3c0f10d723cb09f1d3e52ae4d83ea79b2eae86c3

# 1) Start job — returnerer jobId straks
JOB=$(curl -s -X POST "$API/articles/$ID/generate-draft" \
  -H "Content-Type: application/json" \
  -d '{"angle":"Skriv kort og letlæseligt for unge læsere"}' \
  | jq -r .jobId)
echo "JobId: $JOB"

# 2) Poll for resultat
while true; do
  STATUS=$(curl -s "$API/jobs/$JOB" | jq -r .status)
  echo "$STATUS"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 3
done
curl -s "$API/jobs/$JOB" | jq .
```

## Aktivér i frontenden

Frontenden bruger backend hvis miljøvariablen er sat:

```
# I Amplify Console → Environment variables
VITE_USE_BACKEND_GENERATION=true
VITE_API_URL=https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod

# Lokalt i frontend/.env.local
VITE_USE_BACKEND_GENERATION=true
VITE_API_URL=https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod
```

Når flagget er sat, kalder draft-viewet backend'en og viser en spinner
med en tæller mens jobbet kører. Statusbadgen skifter fra
*Demo-udkast* til *Bonzai-udkast*.

`VITE_API_URL` skal også være sat, hvis knappen **Send til WordPress** skal kunne aktiveres efter generering.

## WordPress (psykesundhed.dk)

**Application password og bruger må aldrig ligge i Git, i frontenden eller i chat.** De skal kun sættes som **miljøvariabler på Lambda-funktionen** `videnskabsmaskinen-api` (AWS Console → Lambda → Configuration → Environment variables), eller via **AWS Systems Manager Parameter Store** hvis I vil have rotation og strengere adgang.

| Variabel | Eksempel | Formål |
|----------|-----------|--------|
| `WORDPRESS_URL` | `https://psykesundhed.dk` | Ingen afsluttende `/` |
| `WORDPRESS_USER` | WordPress-brugernavnet som app-password’et hører til | Basic auth |
| `WORDPRESS_APP_PASSWORD` | Den genererede app-adgangskode **uden mellemrum** | Basic auth |
| `WORDPRESS_CATEGORY_SLUG` | (valgfri) Standard: `ny-viden` | Finder kategori-id til **Ny viden** |
| `WORDPRESS_CATEGORY_ID` | (valgfri) Fx `42` | Hvis slug-opslag fejler, sæt id direkte |

Efter deploy: **Send til WordPress** i udkast-view kalder `POST /articles/{id}/publish-wordpress` med det gemte HTML-udkast og opretter et **offentligt** indlæg (`status: publish`) i den angivne kategori.

Opdater også Lambda-koden efter ændringer i `backend/`:

```bash
cd backend && rm -f function.zip && npm run package && aws lambda update-function-code --function-name videnskabsmaskinen-api --region eu-west-1 --zip-file fileb://function.zip
```

## IAM-permission til self-invoke

Lambda-execution-rollen skal have `lambda:InvokeFunction` på sig selv,
så den kan starte worker-jobbet asynkront. Tilføjet som inline policy
(`AllowSelfAsyncInvoke`) — er dækket i SAM-templaten ved næste rullende
deploy. Hvis du laver en frisk SAM-deploy og det stopper med at virke,
så genaktivér policyen:

```bash
ROLE=videnskabsmaskinen-ApiFunctionRole-PRdUGLVosECx
ARN=$(aws lambda get-function-configuration \
  --function-name videnskabsmaskinen-api --region eu-west-1 \
  --query FunctionArn --output text)
aws iam put-role-policy --role-name $ROLE --policy-name AllowSelfAsyncInvoke \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$ARN\"}]}"
```

## Fejlfinding

| Symptom | Sandsynlig årsag |
|---|---|
| 503 fra `/articles/{id}/generate-draft` | API Gateway 30s-timeout. Tjek at koden er den nye async-version (returnerer 202, ikke 200) |
| 202 men job hænger som `pending` for evigt | Self-invoke fejlede. Tjek CloudWatch logs på Lambda for IAM-fejl. Bekræft at `AllowSelfAsyncInvoke`-policyen eksisterer på rollen |
| Job-resultat har en meta-paragraph før første `<h1>` | Bonzai-assistenten har afvist en del af vinklen. Indholdet er stadig brugbart — meta-teksten kan strippes manuelt eller assistant-prompten kan tilpasses |
| `error: "Agent not found"` | Forkert `BONZAI_MODEL` (assistant-id er korrekt format men eksisterer ikke for keyen) — tjek med `GET /assistants/assistants` |
| `error: "Access to agents is disabled for your role"` | API-keyen er en project key, ikke personal. Bonzai's Assistants API kræver personal key i dag |
| Frontend timeout efter 180s | Bonzai er overbelastet eller assistant-prompten genererer ekstremt langt output. Tjek `GET /jobs/{id}` direkte for at se om jobbet faktisk fortsætter — hvis det færdiggøres senere, er HTML'en stadig i S3 |
| `502` fra `publish-wordpress` om kategori | Kategorien findes ikke med slug `ny-viden`. Opret den i WP eller sæt `WORDPRESS_CATEGORY_ID` |
| `401`/`403` ved WordPress | Forkert bruger/app-password, eller brugeren mangler rettighed til at oprette indlæg via REST API |
