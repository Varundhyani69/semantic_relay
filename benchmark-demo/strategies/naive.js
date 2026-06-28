'use strict';

const express = require('express');

/**
 * Naive baseline: every incoming request triggers its own database query.
 * This is what an unoptimized Express + MongoDB app does.
 */
function createNaiveApp(db) {
  const app = express();

  app.get('/products', async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const filter = {};
    if (req.query.cat) filter.cat = req.query.cat;

    const rows = await db.query({
      filter,
      skip: (page - 1) * limit,
      limit
    });
    res.json(rows);
  });

  return app;
}

module.exports = createNaiveApp;
