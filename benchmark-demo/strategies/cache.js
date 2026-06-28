'use strict';

const express = require('express');

/**
 * Redis-style result cache. Caches the response for an EXACT request key with
 * a TTL. The first request for a key misses and hits the DB; subsequent
 * identical requests within the TTL are served from cache.
 *
 * Key characteristics it demonstrates:
 *  - Wins on requests REPEATED OVER TIME (second caller of the same key is free).
 *  - Exact-key: `?page=1` does nothing for a later `?page=2`.
 *  - Within a single concurrent burst, every key still misses once (the first
 *    response has not been written before the others arrive), so it behaves
 *    like naive for the very first wave.
 */
function createCacheApp(db, options = {}) {
  const app = express();
  const ttlMs = options.ttlMs || 30000;
  const cache = new Map();

  app.get('/products', async (req, res) => {
    const key = req.originalUrl;
    const now = Date.now();
    const hit = cache.get(key);

    if (hit && hit.expiresAt > now) {
      return res.json(hit.value);
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const filter = {};
    if (req.query.cat) filter.cat = req.query.cat;

    const rows = await db.query({ filter, skip: (page - 1) * limit, limit });
    cache.set(key, { value: rows, expiresAt: now + ttlMs });
    res.json(rows);
  });

  return app;
}

module.exports = createCacheApp;
