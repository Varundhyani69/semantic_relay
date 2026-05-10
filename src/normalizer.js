const { v4: uuidv4 } = require('uuid');

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizer(req) {
  const resource = req.path || (req.url ? req.url.split('?')[0] : '');
  const query = req.query || {};
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 20);

  const filters = {};
  for (const key in query) {
    if (key !== 'page' && key !== 'limit') {
      filters[key] = query[key];
    }
  }

  return {
    resource,
    page,
    limit,
    filters,
    intentId: uuidv4()
  };
}

module.exports = normalizer;
