# semantic-relay

[![CI](https://github.com/Varundhyani69/Semantic-Relay/actions/workflows/nodejs.yml/badge.svg)](https://github.com/Varundhyani69/Semantic-Relay/actions/workflows/nodejs.yml)

An Express middleware that batches similar incoming GET requests within a short time window, groups them by semantic similarity, and executes a single "superset" DB query. It partitions the result back to each original caller individually, drastically reducing redundant database calls in monolithic Express/MongoDB apps.

## Features
- **Zero Production Dependencies** (only uses `uuid`)
- Swappable storage adapter for window management
- Groups similar overlapping pagination queries
- Built-in metrics tracking

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

2. **Adapt your Route Handler (Mongoose Example):**

Since `semantic-relay` executes your route handler ONCE for a group of requests, your route handler needs to use the grouped `superset` query provided by `req.semanticRelay` if it exists.

```javascript
app.get('/products', async (req, res) => {
  // Check if semantic-relay has batched requests
  const aggregation = req.semanticRelay;
  
  // Use the superset query if it exists; otherwise use the original from req.query
  const filter = aggregation?.query?.filter || req.query.filter || {};
  
  // Example for pagination
  const baseSkip = (parseInt(req.query.page) - 1) * parseInt(req.query.limit || 20);
  const skip = aggregation?.query?.skip ?? baseSkip;
  const limit = aggregation?.query?.limit ?? parseInt(req.query.limit || 20);

  // Execute the database call ONCE
  const products = await Product.find(filter)
    .skip(skip)
    .limit(limit)
    .exec();

  // semantic-relay intercepts this call, partitions the results,
  // and intelligently slices the array down to each original caller
  res.json(products);
});
```

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
| `threshold` | `number` | `0.8` | Grouping strictness (1.0 = exact params) |
| `include` | `string[]` | `[]` | Intercepts all GET requests by default. When set, only matching path prefixes are watched (e.g., `['/api']`) |
| `responseTimeoutMs` | `number` | `30000` | Maximum time followers wait for the leader response before falling back to normal route execution |
| `onAggregate` | `function` | `() => {}` | Callback invoked when a group of similarity requests fires |
| `onFallback` | `function` | `() => {}` | Callback invoked when a standalone request fires |
| `window` | `WindowAdapter`| `new MemoryWindow()` | Injectable cache driver for microservice setups |

## Response Contract

For grouped requests, the route should call `res.json(array)`, `res.json({ data: array })`, or `res.send()` with a JSON-serialized array/object in that shape. The middleware partitions the returned array and sends each original request its own slice.
