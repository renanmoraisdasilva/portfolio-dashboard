#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
RUN_NAME="${1:-before-cache}"
CONNECTIONS="${CONNECTIONS:-25}"
WARMUP_SECONDS="${WARMUP_SECONDS:-3}"
TEST_SECONDS="${TEST_SECONDS:-10}"
OUTPUT_ROOT="${OUTPUT_ROOT:-benchmarks}"

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required" >&2
    exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
    echo "npx is required" >&2
    exit 1
fi

RUN_DIR="$OUTPUT_ROOT/$RUN_NAME-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"
SUMMARY_FILE="$RUN_DIR/summary.md"

cat > "$SUMMARY_FILE" <<EOF
# Benchmark: $RUN_NAME

- Date: $(date -Iseconds)
- Base URL: $BASE_URL
- Connections: $CONNECTIONS
- Warm-up: $WARMUP_SECONDS seconds
- Test duration: $TEST_SECONDS seconds
EOF

run_endpoint() {
    local name="$1"
    local route="$2"
    local url="$BASE_URL$route"

    echo "Warming up $route for ${WARMUP_SECONDS}s..."
    npx --yes autocannon -c "$CONNECTIONS" -d "$WARMUP_SECONDS" "$url" \
        > /dev/null 2>&1

    {
        printf '\n## %s\n\n' "$route"
        printf '### Autocannon\n\n```text\n'
    } >> "$SUMMARY_FILE"

    echo "Testing $route for ${TEST_SECONDS}s..."
    npx --yes autocannon -c "$CONNECTIONS" -d "$TEST_SECONDS" "$url" \
        >> "$SUMMARY_FILE" 2>&1
    printf '```\n' >> "$SUMMARY_FILE"

    echo "Completed $route"
}

run_endpoint prices /api/prices
run_endpoint analytics /api/analytics
run_endpoint state /api/state
run_endpoint history-ohlc /api/history/ohlc

printf 'Benchmark summary saved to %s\n' "$SUMMARY_FILE"
