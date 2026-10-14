#!/usr/bin/env sh
# curl walkthrough of the M-Ai-L Box API. Requires curl and jq.
set -e
BASE="${MAILBOX_URL:-http://localhost:8000}"

# 1. Create a temporary mailbox (no account). Keep the token secret — it is the only key to the inbox.
RESP=$(curl -sf -X POST "$BASE/api/mailboxes" -H 'Content-Type: application/json' -d '{"label":"curl demo"}')
ID=$(echo "$RESP" | jq -r .mailbox.id)
ADDR=$(echo "$RESP" | jq -r .mailbox.address)
TOKEN=$(echo "$RESP" | jq -r .token)
echo "address: $ADDR"

# 2. Optional: a read-only API key bound to this mailbox, for CI
KEY=$(curl -sf -X POST "$BASE/api/mailboxes/$ID/api-keys" -H "X-Mailbox-Token: $TOKEN" \
      -H 'Content-Type: application/json' -d '{"name":"ci","scopes":["messages:read","attachments:read"]}' | jq -r .key)

# 3. Send something to $ADDR from the app under test (locally: python scripts/send_test_email.py "$ADDR")
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "send an email to $ADDR within 60 s…"

# 4. Wait for it (long-poll, 408 on timeout)
MSG=$(curl -sf "$BASE/api/mailboxes/$ID/wait?subject=code&since=$SINCE&timeout=60" -H "Authorization: Bearer $KEY")
echo "$MSG" | jq '{subject, from, received_at, sent_at, otp_codes, links: [.links[].url]}'

# 5. List messages / download the first attachment
curl -sf "$BASE/api/mailboxes/$ID/messages?limit=5" -H "Authorization: Bearer $KEY" | jq '.items[] | {subject, received_at}'
AID=$(echo "$MSG" | jq -r '.attachments[0].id // empty')
if [ -n "$AID" ]; then
  URL=$(curl -sf -X POST "$BASE/api/mailboxes/$ID/attachments/$AID/download-link" -H "Authorization: Bearer $KEY" | jq -r .url)
  curl -sf -OJ "$BASE$URL"   # link is valid for ~2 minutes
fi
