const semanticRelay = require('../src/index');
const { resolve } = require('../src/index');

describe('resolve() helper', () => {
  it('is exposed both as a standalone export and on the middleware', () => {
    const mw = semanticRelay();
    expect(typeof resolve).toBe('function');
    expect(typeof mw.resolve).toBe('function');
  });

  it('returns the superset query for a coalesced group leader', () => {
    const req = {
      query: { page: '1', limit: '20', cat: 'shoes' },
      semanticRelay: {
        aggregated: true,
        groupSize: 3,
        leader: true,
        query: { filter: { cat: 'shoes' }, skip: 0, limit: 60, pages: [1, 2, 3], baseLimit: 20 }
      }
    };

    const out = resolve(req);
    expect(out).toEqual({
      filter: { cat: 'shoes' },
      skip: 0,
      limit: 60,
      aggregated: true,
      groupSize: 3
    });
  });

  it('falls back to req.query for a solo request (no aggregation)', () => {
    const req = { query: { page: '3', limit: '10', cat: 'books' } };

    const out = resolve(req);
    expect(out).toEqual({
      filter: { cat: 'books' },
      skip: 20, // (3 - 1) * 10
      limit: 10,
      aggregated: false,
      groupSize: 1
    });
  });

  it('falls back to req.query for a follower that fell back to normal execution', () => {
    const req = {
      query: { page: '2', limit: '5', type: 'a' },
      semanticRelay: {
        aggregated: false,
        groupSize: 4,
        query: null,
        fallbackReason: 'leader-timeout'
      }
    };

    const out = resolve(req);
    expect(out).toEqual({
      filter: { type: 'a' },
      skip: 5, // (2 - 1) * 5
      limit: 5,
      aggregated: false,
      groupSize: 4 // preserves the group size it was part of
    });
  });

  it('applies default pagination for missing/invalid params', () => {
    expect(resolve({ query: {} })).toEqual({
      filter: {},
      skip: 0,
      limit: 20,
      aggregated: false,
      groupSize: 1
    });

    expect(resolve({ query: { page: '-1', limit: '0' } })).toMatchObject({
      skip: 0,
      limit: 20
    });
  });

  it('excludes page and limit from the derived filter', () => {
    const out = resolve({ query: { page: '2', limit: '15', brand: 'acme', color: 'red' } });
    expect(out.filter).toEqual({ brand: 'acme', color: 'red' });
  });

  it('produces a query equivalent to the manual fallback pattern', () => {
    // Equivalence check: resolve() must match the documented manual pattern.
    const req = { query: { page: '4', limit: '25', cat: 'x' } };
    const out = resolve(req);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const manualSkip = (page - 1) * limit;

    expect(out.skip).toBe(manualSkip);
    expect(out.limit).toBe(limit);
    expect(out.filter).toEqual({ cat: 'x' });
  });
});
