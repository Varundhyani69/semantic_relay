'use strict';

const express = require('express');

/**
 * Request deduplication / single-flight (Go singleflight, React Query, CDN
 * request coalescing). If an IDENTICAL request is already in flight, later
 * identical requests latch onto the same promise instead of hitting the DB.
 *
 * Key limitation it demonstrates: only EXACT-match requests are collapsed.
 * `?page=1` and `?page=2` are treated as completely unrelated.
 */
function createDedupApp(db) {
  const app = express();
  const inflight = new Map();

  app.get('/products', async (req, res) => {
    const key = req.originalUrl;
    let pending = inflight.get(key);

    if (!pending) {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const filter = {};
      if (req.query.cat) filter.cat = req.query.cat;

      pending = db.query({ filter, skip: (page - 1) * limit, limit });
      inflight.set(key, pending);
      pending.finally(() => inflight.delete(key));
    }

    const rows = await pending;
    res.json(rows);
  });

  return app;
}

module.exports = createDedupApp;
