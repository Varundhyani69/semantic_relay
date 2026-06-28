# semantic-relay

[![CI](https://github.com/Varundhyani69/Semantic-Relay/actions/workflows/nodejs.yml/badge.svg)](https://github.com/Varundhyani69/Semantic-Relay/actions/workflows/nodejs.yml)

An Express middleware that batches similar incoming GET requests within a short time window, groups them by query similarity, and executes a single "superset" DB query. It partitions the result back to each original caller individually, drastically reducing redundant database calls in monolithic Express/MongoDB apps.

> **What "similar" means here:** requests are grouped only when they target the
> same route and carry the **identical filter set**, differing solely in their
> pagination (`page` / `limit`). Overlapping pages of the same filtered list are
> merged into one query and sliced back to each caller. Requests with different
> filters are never grouped, so each caller always receives exactly the records
> its own standalone query would have returned.

## Features
- **Zero Production Dependencies** (only uses `uuid`)
- Swappable storage adapter for window management
- Groups overlapping pagination queries that share the same filter set
- Deterministic result partitioning, verified by property-based tests
- Built-in metrics tracking

## How it works

semantic-relay turns many overlapping list requests into a single database query
in six steps:

1. **Request arrival** — several clients hit the same endpoint at nearly the same
   moment, each asking for a different slice of the same filtered data.
2. **Time-window collection** — instead of executing immediately, requests are
   held for a short window (default 20ms) so concurrent ones can be considered
   together.
3. **Similarity scoring** — each request is scored. Same route + identical filters
   + adjacent pages score high and are grouped. Different filters score `0` and
   are never merged.
4. **Superset query building** — for each group, one covering query is computed:
   the minimum `skip` through the maximum record across the group. Pages 1 and 2
   (limit 20) become a single query for records `0–40`.
5. **Single database execution** — the group "leader" runs that one query; every
   other request in the group waits, issuing no extra database round-trips.
6. **Result partitioning** — the single result array is sliced back to each
   caller's exact offset and limit, so every client receives precisely what its
   own standalone query would have returned.

Five overlapping requests that traditionally cost five database round-trips cost
just one with semantic-relay.

## When to use it

**Great fit:**
- High-traffic, idempotent list endpoints (feeds, catalogs, search-result pages)
- Endpoints where many users request overlapping pages of the same filtered data
  at nearly the same time
- Read-heavy MongoDB/SQL list APIs paginated with `page`/`limit` query params

**Not a fit:**
- Low-traffic endpoints where requests rarely overlap within the window (adds
  latency for no benefit)
- Per-user or security-scoped data, unless that scope is encoded in the query
  filters
- Streaming responses, file downloads, HTML pages, or mutations (`POST`/`PUT`/etc.)

## Installation

```bash
npm install semantic-relay
```

## Basic Usage

1. **Mount the middleware in your Express app:**

```javascript
const express = require('express');
const { semanticRelay } = require('semantic-relay');
const app = express();

app.use(semanticRelay({
  windowMs: 20, // Collect requests for 20ms
  threshold: 0.8, // Similarity score threshold for grouping
  include: ['/products', '/users'], // Optional route prefixes to watch (all GETs if omitted)
  responseTimeoutMs: 30000, // Fallback followers if the leader never sends JSON
  onAggregate: (group) => console.log(`Aggregated ${group.length} requests`),
  onFallback: (req) => console.log(`Group size 1, fallback to normal execution`)
}));
```

You can also import the middleware directly:

```javascript
const semanticRelay = require('semantic-relay');
```

2. **Adapt your route handler:**

`semantic-relay` executes your route handler **once per group** of requests, so
the handler must run the merged superset query — then return the full array so
the middleware can slice it back to each caller. The simplest way is
`relay.resolve(req)`, which hands you the effective query with the
leader/follower fallback already applied:

```javascript
const relay = semanticRelay({ include: ['/products'] });
app.use(relay);

app.get('/products', async (req, res) => {
  const { filter, skip, limit } = relay.resolve(req);

  // Execute the database call ONCE; return the whole array.
  const products = await Product.find(filter).skip(skip).limit(limit).exec();

  // semantic-relay intercepts this, partitions the array,
  // and sends each original caller its own slice.
  res.json(products);
});
```

`resolve()` returns `{ filter, skip, limit, aggregated, groupSize }` and keeps
full control over `req`/`res` (headers, status, sorting, custom logic). A
standalone form is also exported:

```javascript
const { resolve } = require('semantic-relay');
const { filter, skip, limit } = resolve(req);
```

<details>
<summary><strong>Advanced: accessing the raw aggregation</strong></summary>

If you need the raw grouping state, read `req.semanticRelay` directly. When the
request is a group leader, `req.semanticRelay.query` holds the superset; for
solo/fallback requests it is `null`, so you must fall back to `req.query`:

```javascript
app.get('/products', async (req, res) => {
  const aggregation = req.semanticRelay;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const filter = aggregation?.query?.filter ?? {};
  const skip   = aggregation?.query?.skip   ?? (page - 1) * limit;
  const lim    = aggregation?.query?.limit  ?? limit;

  const products = await Product.find(filter).skip(skip).limit(lim).exec();
  res.json(products);
});
```

`resolve()` is simply a tested wrapper around this pattern.

</details>

### Customizing what counts as pagination vs. a filter

By default, `page`/`limit` are pagination and **every other query param is part
of the filter** (so requests differing in any param are never merged). If your
app uses different param names, or has params that are not DB filter fields
(like `sort` or `q`), configure it once — the setting applies to BOTH grouping
and `resolve()`, so they can never disagree:

```javascript
semanticRelay({
  pageParam: 'p',            // default 'page'
  limitParam: 'size',        // default 'limit'
  filterFields: ['cat', 'brand'] // only these become the filter; sort/q ignored
});
```

With `filterFields` set, `resolve(req).filter` contains only the whitelisted
fields, so you can pass it straight to your query builder without pulling in
non-filter params.

## Integration Notes

- Mount `semanticRelay` before the GET routes you want to batch.
- Use it only for idempotent list endpoints that return arrays or `{ data: [...] }`.
- Include all data-shaping inputs in query params, especially filters, sort order, page, and limit.
- Do not use it for streaming, file downloads, HTML pages, or routes where each request can see different data unless that user/security scope is represented in the query filters.
- If the leader request returns an error status (`4xx` or `5xx`), follower requests fall back to normal route execution.

## Metrics
You can fetch performance metrics to see how many DB calls you successfully omitted:

```javascript
const { semanticRelay } = require('semantic-relay');
const relayMiddleware = semanticRelay({ ... });

app.use(relayMiddleware);

app.get('/metrics', (req, res) => {
  res.json(relayMiddleware.getMetrics());
});
```

## Options Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `windowMs` | `number` | `20` | How long to hold incoming requests before flushing the window |
| `threshold` | `number` | `0.8` | Grouping strictness for same-filter requests (1.0 = identical page only; lower values merge pages further apart). Requests with differing filters are never grouped regardless of this value. |
| `include` | `string[]` | `[]` | Intercepts all GET requests by default. When set, only matching path prefixes are watched (e.g., `['/api']`) |
| `responseTimeoutMs` | `number` | `30000` | Maximum time followers wait for the leader response before falling back to normal route execution |
| `onAggregate` | `function` | `() => {}` | Callback invoked when a group of similarity requests fires |
| `onFallback` | `function` | `() => {}` | Callback invoked when a standalone request fires |
| `window` | `WindowAdapter`| `new MemoryWindow()` | Injectable cache driver for microservice setups |
| `pageParam` | `string` | `'page'` | Query param holding the page number |
| `limitParam` | `string` | `'limit'` | Query param holding the page size |
| `filterFields` | `string[] \| null` | `null` | If set, only these params are treated as filters; otherwise every param except page/limit is a filter |

## Response Contract

For grouped requests, the route should call `res.json(array)`, `res.json({ data: array })`, or `res.send()` with a JSON-serialized array/object in that shape. The middleware partitions the returned array and sends each original request its own slice.

## Benchmarks

A benchmark suite comparing semantic-relay against common API-efficiency
strategies (request deduplication, Redis-style caching, DataLoader batching, and
a naive baseline) lives in the [`benchmark-demo/`](./benchmark-demo) folder,
along with an interactive results page. It is not part of the published package.

```bash
cd benchmark-demo
npm install
npm run benchmark   # writes results
# then open benchmark-demo/web/index.html in a browser
```

## Correctness

The result-partitioning logic — the guarantee that each caller receives exactly
what its standalone query would have returned — is covered by property-based
tests that run thousands of randomized request groups. Requests with differing
filters are never grouped, so a misconfigured `threshold` can never return one
caller another caller's data.

## License

ISC © Varundhyani69

