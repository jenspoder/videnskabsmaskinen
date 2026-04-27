#!/usr/bin/env bash
# Hurtig sundhedstjek af hele Bonzai-generator-flowet.
#
# Brug:    ./health-check.sh
# Default test-artikel kan ændres ved at sætte ARTICLE_ID-env var.
#
# Verificerer:
#   1. API Gateway svarer på GET /articles
#   2. Lambda env vars peger på Vej B (Bonzai-assistent)
#   3. POST /articles/{id}/generate-draft returnerer 202 + jobId
#   4. Self-invoke worker når frem til S3 og afslutter jobbet
#   5. GET /jobs/{id} returnerer ren HTML (starter med <h1>)
#
# Exit-kode 0 = alt ok, 1 = mindst ét trin fejlede.

set -u
API="${API_URL:-https://30bw0tkv7k.execute-api.eu-west-1.amazonaws.com/prod}"
ARTICLE_ID="${ARTICLE_ID:-d3d143e844cf0aa50e7c84e9eb83e527c1d6b03f}"
ANGLE="${ANGLE:-Skriv kort og letlæseligt for unge læsere}"
REGION="${AWS_REGION:-eu-west-1}"

green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }

fail=0

echo "=== 1. API Gateway: GET /articles?status=inbox ==="
COUNT=$(curl -kSs "$API/articles?status=inbox" --max-time 20 \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('count','?'))" 2>/dev/null || echo '?')
if [[ "$COUNT" =~ ^[0-9]+$ ]] && [ "$COUNT" -gt 0 ]; then
  green "  OK: $COUNT artikler i inbox"
else
  red "  FAIL: kunne ikke hente artikler (count=$COUNT)"
  fail=1
fi

echo ""
echo "=== 2. Lambda env vars (Vej B?) ==="
MODEL=$(aws lambda get-function-configuration --function-name videnskabsmaskinen-api \
  --region "$REGION" --query "Environment.Variables.BONZAI_MODEL" --output text 2>/dev/null || echo '?')
TIMEOUT=$(aws lambda get-function-configuration --function-name videnskabsmaskinen-api \
  --region "$REGION" --query "Timeout" --output text 2>/dev/null || echo '?')
if [[ "$MODEL" == agent_* ]]; then
  green "  OK: BONZAI_MODEL=$MODEL (Vej B)"
else
  yellow "  ADVARSEL: BONZAI_MODEL=$MODEL (Vej A eller mangler) - assistant-flow ikke aktivt"
fi
if [ "$TIMEOUT" -ge 300 ] 2>/dev/null; then
  green "  OK: Function timeout=${TIMEOUT}s (nok til worker-jobbet)"
else
  red "  FAIL: Function timeout=${TIMEOUT}s - worker når ikke at afslutte"
  fail=1
fi

echo ""
echo "=== 3. POST /articles/$ARTICLE_ID/generate-draft ==="
START=$(date +%s)
RESP=$(curl -kSs -w "\n%{http_code}" -X POST "$API/articles/$ARTICLE_ID/generate-draft" \
  -H "Content-Type: application/json" -d "{\"angle\":\"$ANGLE\"}" --max-time 20)
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
JOB_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null || echo '')
if [ "$HTTP" = "202" ] && [ -n "$JOB_ID" ]; then
  green "  OK: HTTP 202, jobId=$JOB_ID"
else
  red "  FAIL: HTTP $HTTP, body=$BODY"
  fail=1
  exit 1
fi

echo ""
echo "=== 4. Worker afslutter jobbet (poll i op til 180s) ==="
STATUS="?"
for i in $(seq 1 60); do
  sleep 3
  STATUS=$(curl -kSs "$API/jobs/$JOB_ID" --max-time 10 \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo '?')
  ELAPSED=$(($(date +%s) - START))
  printf "  [t=%ds] status=%s\n" "$ELAPSED" "$STATUS"
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && break
done

if [ "$STATUS" = "completed" ]; then
  green "  OK: jobbet er færdigt"
else
  red "  FAIL: jobbet endte med status=$STATUS"
  fail=1
fi

echo ""
echo "=== 5. Output er ren HTML der starter med <h1>? ==="
HTML=$(curl -kSs "$API/jobs/$JOB_ID" --max-time 10 \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('html','')[:200])" 2>/dev/null || echo '')
if [[ "$HTML" == *"<h1>"* ]]; then
  green "  OK: HTML starter med <h1>"
  echo "  Preview: ${HTML:0:120}..."
else
  yellow "  ADVARSEL: outputtet starter ikke med <h1> (assistent har måske kommenteret før)"
  echo "  Preview: ${HTML:0:200}"
fi

echo ""
if [ $fail -eq 0 ]; then
  green "=== ALT OK ($(($(date +%s) - START))s totalt) ==="
  exit 0
else
  red "=== $fail TJEK FEJLEDE ==="
  exit 1
fi
