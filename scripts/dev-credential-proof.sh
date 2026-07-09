#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_HOST="${OWNERSHIP_PROOF_WEB_HOST:-127.0.0.1}"
WEB_PORT="${OWNERSHIP_PROOF_WEB_PORT:-3002}"
VERIFIER_PORT="${PROOF_VERIFIER_DEV_PORT:-8081}"
VERIFIER_URL="http://127.0.0.1:${VERIFIER_PORT}"

if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

cleanup() {
  if [[ -n "${VERIFIER_PID:-}" ]]; then
    kill "$VERIFIER_PID" 2>/dev/null || true
    wait "$VERIFIER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT"
  PORT="$VERIFIER_PORT" exec go run ./cmd/api
) &
VERIFIER_PID=$!

for _ in {1..50}; do
  if curl -fsS "$VERIFIER_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$VERIFIER_PID" 2>/dev/null; then
    wait "$VERIFIER_PID"
    exit 1
  fi
  sleep 0.1
done

if ! curl -fsS "$VERIFIER_URL/api/health" >/dev/null 2>&1; then
  echo "local verifier did not become ready at $VERIFIER_URL" >&2
  exit 1
fi

cd "$ROOT"
PROOF_VERIFIER_DEV_URL="$VERIFIER_URL" \
  pnpm --dir apps/ownership-proof-web dev --hostname "$WEB_HOST" --port "$WEB_PORT"
