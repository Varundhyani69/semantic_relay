# semantic-relay — Benchmark &amp; Demo

A self-contained benchmark suite and interactive webpage that compares
**semantic-relay** against the API-efficiency strategies used by large-scale apps:

| Strategy | What it represents |
|---|---|
| Naive | Unoptimized Express + DB — one query per request |
| Request dedup | Single-flight / CDN request coalescing (collapses *identical* concurrent requests) |
| Redis-style cache | Exact-key result cache with TTL (wins on requests repeated over time) |
| DataLoader batching | Per-tick batching that dedupes identical keys (Facebook DataLoader pattern) |
| **semantic-relay** | Coalesces *similar-but-different* overlapping requests into one superset query |

This folder is fully isolated from the published npm package (its own
`package.json`, its own dependencies) and is excluded from `npm pack`.

## Run the benchmark

```bash
cd benchmark-demo
npm install
npm run benchmark
```

This runs every strategy against four scenarios (identical burst, overlapping
pagination, mixed filters, high-concurrency diverse), measuring database calls,
average latency, p95 latency, and throughput. Results are written to:

- `results/latest.json` — full machine-readable report
- `web/data.js` — the same report wired up for the demo page

## View the demo

Just open `web/index.html` in a browser — no server or build needed.

Or, if you prefer a localhost URL:

```bash
npm run serve
```

## How the benchmark stays fair

- Every strategy runs as a real Express app hitting the same mock data source.
- The mock DB has a fixed connection pool, so issuing fewer queries genuinely
  lowers latency under load (not just DB cost).
- Each query also carries a per-row marginal cost, so semantic-relay's large
  superset queries are **not** treated as free — they pay for the rows they fetch.
- Each cell is measured as the median of 3 runs after a discarded warm-up.

The numbers illustrate *relative behavior*, not absolute production figures.
