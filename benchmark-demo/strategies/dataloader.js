'use strict';

const express = require('express');

/**
 * DataLoader-style per-tick batching (Facebook DataLoader pattern).
 *
 * DataLoader collects all loads issued during a single event-loop tick and
 * (a) DEDUPLICATES identical keys, then (b) hands the distinct keys to a batch
 * function. Its sweet spot is by-ID loading where many distinct IDs collapse
 * into one `WHERE id IN (...)` query.
 *
 * On a paginated LIST endpoint there is no shared IN(...) key across different
 * pages, so the honest behavior is: identical page requests in the same tick
 * collapse to one query (like dedup), but distinct pages each still issue their
 * own query. This is exactly the gap semantic-relay closes by MERGING distinct
 * but overlapping pages into a single superset query.
 */
function createBatcher() {
  let batch = null;

  function flush(current) {
    for (const entry of current.values()) {
      entry
        .run()
        .then((result) => entry.resolvers.forEach((r) => r(result)))
        .catch((err) => entry.rejecters.forEach((r) => r(err)));
    }
  }

  function load(key, run) {
    if (!batch) {
      batch = new Map();
      const scheduled = batch;
      process.nextTick(() => {
        batch = null;
        flush(scheduled);
      });
    }
    let entry = batch.get(key);
    if (!entry) {
      entry = { run, resolvers: [], rejecters: [] };
      batch.set(key, entry);
    }
    return new Promise((resolve, reject) => {
      entry.resolvers.push(resolve);
      entry.rejecters.push(reject);
    });
  }

  return { load };
}

function createDataLoaderApp(db) {
  const app = express();
  const batcher = createBatcher();

  app.get('/products', async (req, res) => {
    const key = req.originalUrl;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const filter = {};
    if (req.query.cat) filter.cat = req.query.cat;

    const rows = await batcher.load(key, () =>
      db.query({ filter, skip: (page - 1) * limit, limit })
    );
    res.json(rows);
  });

  return app;
}

module.exports = createDataLoaderApp;
