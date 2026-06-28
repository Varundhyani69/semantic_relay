'use strict';

/**
 * A mock data source shared by every strategy so the comparison is fair.
 *
 * Two things make the numbers realistic:
 *  1. Every query costs a fixed simulated latency (DB_LATENCY_MS).
 *  2. The database has a bounded connection pool (POOL_SIZE). When more queries
 *     are in flight than there are connections, the excess queue up. This is
 *     why issuing FEWER database queries (semantic-relay's whole point) lowers
 *     latency under load, not just DB cost.
 */

const DB_LATENCY_MS = 40;
const PER_ROW_MS = 0.02; // marginal cost per returned row (rewards smaller result sets)
const POOL_SIZE = 10;
const TOTAL_RECORDS = 5000;

// Deterministic dataset. Record at absolute offset i has id (i + 1).
const dataset = Array.from({ length: TOTAL_RECORDS }, (_, i) => ({
  id: i + 1,
  name: 'item-' + (i + 1),
  cat: i % 2 === 0 ? 'a' : 'b',
  brand: ['acme', 'globex', 'initech'][i % 3]
}));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A simple counting semaphore modelling a fixed-size connection pool.
function createPool(size) {
  let available = size;
  const waiters = [];

  function acquire() {
    if (available > 0) {
      available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      available++;
    }
  }

  return { acquire, release };
}

class MockDb {
  constructor() {
    this.pool = createPool(POOL_SIZE);
    this.queryCount = 0;
  }

  reset() {
    this.queryCount = 0;
  }

  getQueryCount() {
    return this.queryCount;
  }

  _applyFilter(filter) {
    let rows = dataset;
    for (const key of Object.keys(filter || {})) {
      const value = filter[key];
      if (value === undefined || value === null || value === '') continue;
      rows = rows.filter((r) => String(r[key]) === String(value));
    }
    return rows;
  }

  // A paginated range query: filter + skip + limit. Counts as one DB call.
  // Latency = base round-trip + a marginal cost proportional to rows returned,
  // so a large superset query is not unfairly "free" versus many small queries.
  async query({ filter = {}, skip = 0, limit = 20 }) {
    this.queryCount++;
    await this.pool.acquire();
    try {
      const rows = this._applyFilter(filter).slice(skip, skip + limit);
      await sleep(DB_LATENCY_MS + rows.length * PER_ROW_MS);
      return rows;
    } finally {
      this.pool.release();
    }
  }

  // A batched by-id lookup (one IN(...) query). Counts as one DB call.
  async queryByIds(ids) {
    this.queryCount++;
    await this.pool.acquire();
    try {
      const wanted = new Set(ids.map(Number));
      const rows = dataset.filter((r) => wanted.has(r.id));
      await sleep(DB_LATENCY_MS + rows.length * PER_ROW_MS);
      return rows;
    } finally {
      this.pool.release();
    }
  }
}

module.exports = {
  MockDb,
  DB_LATENCY_MS,
  POOL_SIZE,
  TOTAL_RECORDS
};
