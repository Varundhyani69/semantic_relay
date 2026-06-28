'use strict';

const express = require('express');
const semanticRelay = require('../../src/index');

/**
 * semantic-relay: the package under test, using the real source in ../../src.
 *
 * It coalesces same-filter requests that arrive within a short window — even
 * when they ask for DIFFERENT but overlapping pages — into a single superset
 * query, executes it once, and partitions the result back to each caller.
 */
function createRelayApp(db, options = {}) {
  const app = express();

  const relay = semanticRelay({
    windowMs: options.windowMs || 20,
    threshold: options.threshold || 0.8,
    include: ['/products']
  });

  app.use(relay);

  app.get('/products', async (req, res) => {
    const aggregation = req.semanticRelay;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    // Use the superset query when this request is the group leader; otherwise
    // fall back to this request's own parameters.
    const baseFilter = {};
    if (req.query.cat) baseFilter.cat = req.query.cat;

    const filter = aggregation && aggregation.query
      ? aggregation.query.filter
      : baseFilter;
    const skip = aggregation && aggregation.query
      ? aggregation.query.skip
      : (page - 1) * limit;
    const effectiveLimit = aggregation && aggregation.query
      ? aggregation.query.limit
      : limit;

    const rows = await db.query({ filter, skip, limit: effectiveLimit });
    res.json(rows);
  });

  // expose relay metrics for reporting
  app.getRelayMetrics = () => relay.getMetrics();

  return app;
}

module.exports = createRelayApp;
