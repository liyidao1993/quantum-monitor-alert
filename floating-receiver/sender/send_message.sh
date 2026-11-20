#!/usr/bin/env sh
set -eu

if [ "$#" -lt 4 ]; then
  echo "Usage: $0 SERVER_URL TOKEN TITLE BODY [LEVEL]"
  exit 1
fi

SERVER_URL=${1%/}
TOKEN=$2
TITLE=$3
BODY=$4
LEVEL=${5:-info}

PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"title": sys.argv[1], "body": sys.argv[2], "level": sys.argv[3]}))' "$TITLE" "$BODY" "$LEVEL")
curl --fail --silent --show-error \
  -X POST "$SERVER_URL/api/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD"
