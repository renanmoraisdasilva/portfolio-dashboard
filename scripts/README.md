# Benchmark Script

`benchmark.sh` runs short HTTP load tests and records Autocannon results in one summary file. OpenTelemetry metrics and traces are available in SigNoz separately.

## Requirements

Run it from a Linux or macOS machine that can reach the deployed application:

- `bash`
- `curl`
- `npx` and Node.js
- Network access to the application URL

The load generator should ideally be a different machine from the application server so its CPU and memory do not affect the results.

## Quick Start

From this directory:

```bash
bash benchmark.sh before-cache
```

The default target is `http://localhost:3000` (the script's `BASE_URL`
default), so it works against a local stack out of the box. Point it at a
deployed host by exporting `BASE_URL` — see **Configuration** below.

Each endpoint runs a 3-second warm-up followed by a 10-second test. The full run takes about one minute.

## Output

Each run creates one ignored Markdown summary file:

```text
benchmarks/before-cache-YYYYMMDD-HHMMSS/summary.md
```

The summary contains:

- Test configuration
- Autocannon results for each endpoint
- HTTP throughput and latency from Autocannon

The tested endpoints are:

```text
/api/prices
/api/analytics
/api/trades
/api/cash
/api/history/ohlc
```

## Before-and-After Comparison

Run the baseline before changing the application:

```bash
bash benchmark.sh before-cache
```

After implementing the cache, run the same test with the same machine and settings:

```bash
bash benchmark.sh after-cache
```

Compare the two `summary.md` files. Important values are:

- Requests/sec: higher is better
- Median latency: lower is better
- p95 latency: lower is better
- 5xx error rate: should remain zero
- CPU and memory: lower is better for equivalent throughput

Keep the endpoint, concurrency, duration, warm-up, database state, and load-generator machine consistent between runs.

## Configuration

All settings can be overridden with environment variables:

```bash
BASE_URL=http://<deployed-host>:3000 \
CONNECTIONS=10 \
WARMUP_SECONDS=3 \
TEST_SECONDS=10 \
bash benchmark.sh before-cache
```

For a longer test:

```bash
WARMUP_SECONDS=15 TEST_SECONDS=60 bash benchmark.sh before-cache
```

For a stronger capacity test:

```bash
CONNECTIONS=25 WARMUP_SECONDS=5 TEST_SECONDS=30 bash benchmark.sh before-cache
```

To use a local stack:

```bash
BASE_URL=http://localhost:3000 \
bash benchmark.sh before-cache
```

## Cleanup

Benchmark output is ignored by Git. To remove local results:

```bash
rm -rf benchmarks
```
