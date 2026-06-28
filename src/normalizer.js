const { v4: uuidv4 } = require('uuid');

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Builds the normalized "intent" for a request. The same config object is used
 * by the middleware (for grouping + superset building) and by resolve(), so the
 * two can never disagree about what counts as pagination vs. a filter.
 *
 * config:
 *   pageParam    - query param holding the page number     (default 'page')
 *   limitParam   - query param holding the page size        (default 'limit')
 *   filterFields - if provided, ONLY these query params are treated as filters;
 *                  otherwise every param except page/limit is a filter (safe
 *                  default: requests differing in any param are never merged).
 */
function normalizer(req, config = {}) {
  const pageParam = config.pageParam || 'page';
  const limitParam = config.limitParam || 'limit';
  const filterFields = config.filterFields || null;

  const resource = req.path || (req.url ? req.url.split('?')[0] : '');
  const query = req.query || {};
  const page = parsePositiveInt(query[pageParam], 1);
  const limit = parsePositiveInt(query[limitParam], 20);

  const filters = {};
  if (filterFields) {
    for (const key of filterFields) {
      if (query[key] !== undefined) {
        filters[key] = query[key];
      }
    }
  } else {
    for (const key in query) {
      if (key !== pageParam && key !== limitParam) {
        filters[key] = query[key];
      }
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

normalizer.parsePositiveInt = parsePositiveInt;

module.exports = normalizer;
