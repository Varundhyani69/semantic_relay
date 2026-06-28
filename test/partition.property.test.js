const fc = require('fast-check');
const supersetBuilder = require('../src/superset-builder');
const partitioner = require('../src/partitioner');
const scorer = require('../src/scorer');

/**
 * Property-based tests for the core correctness guarantee of semantic-relay:
 *
 *   For any group of same-filter requests merged into a single superset query,
 *   each original caller MUST receive exactly the records it would have received
 *   from its own standalone query against the same dataset.
 *
 * We model the backing data source as a table where the record at absolute
 * offset `i` is the value `i`. A standalone query for a caller is therefore
 * `table.slice(skip, skip + limit)`. The superset query fetches one contiguous
 * range, and the partitioner must reproduce each standalone result from it.
 */

// Same filter object shared by every intent in a group (the only case the
// scorer ever groups, enforced by scorer returning 0 for differing filters).
const FILTER = { cat: 'shoes' };

const intentArb = fc.record({
  page: fc.integer({ min: 1, max: 200 }),
  limit: fc.integer({ min: 1, max: 50 })
});

function makeGroup(intents) {
  return intents.map((it, idx) => ({
    intent: {
      intentId: 'id-' + idx,
      resource: '/products',
      page: it.page,
      limit: it.limit,
      filters: FILTER
    }
  }));
}

// The standalone result a caller would have gotten on its own.
function soloQuery(table, intent) {
  const skip = (intent.page - 1) * intent.limit;
  return table.slice(skip, skip + intent.limit);
}

describe('partitioner correctness (property-based)', () => {
  it('each caller gets exactly its standalone slice, for any same-filter group', () => {
    fc.assert(
      fc.property(
        fc.array(intentArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 5000 }),
        (intents, totalRecords) => {
          const group = makeGroup(intents);

          // A table of `totalRecords` rows; row at absolute offset i == i.
          const table = Array.from({ length: totalRecords }, (_, i) => i);

          const superset = supersetBuilder(group);

          // The single superset query against the table.
          const supersetResult = table.slice(
            superset.skip,
            superset.skip + superset.limit
          );

          const partitions = partitioner(supersetResult, group, superset);

          for (const ctx of group) {
            const got = partitions.get(ctx.intent.intentId);
            const expected = soloQuery(table, ctx.intent);
            expect(got).toEqual(expected);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('superset fully covers every caller range (no caller offset is negative)', () => {
    fc.assert(
      fc.property(
        fc.array(intentArb, { minLength: 1, maxLength: 12 }),
        (intents) => {
          const group = makeGroup(intents);
          const superset = supersetBuilder(group);

          for (const ctx of group) {
            const intentSkip = (ctx.intent.page - 1) * ctx.intent.limit;
            const arrayOffset = intentSkip - superset.skip;
            // Every caller's window must start at or after the superset start
            // and end at or before the superset end.
            expect(arrayOffset).toBeGreaterThanOrEqual(0);
            expect(arrayOffset + ctx.intent.limit).toBeLessThanOrEqual(
              superset.limit
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('superset limit equals exactly the covered record span', () => {
    fc.assert(
      fc.property(
        fc.array(intentArb, { minLength: 1, maxLength: 12 }),
        (intents) => {
          const group = makeGroup(intents);
          const superset = supersetBuilder(group);

          let minSkip = Infinity;
          let maxEnd = 0;
          for (const it of intents) {
            const skip = (it.page - 1) * it.limit;
            minSkip = Math.min(minSkip, skip);
            maxEnd = Math.max(maxEnd, skip + it.limit);
          }
          expect(superset.skip).toBe(minSkip);
          expect(superset.limit).toBe(maxEnd - minSkip);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe('scorer safety invariant (property-based)', () => {
  it('never groups requests with different filters, at any threshold', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string()),
        fc.dictionary(fc.string(), fc.string()),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        (filtersA, filtersB, pageA, pageB) => {
          const a = { resource: '/products', page: pageA, limit: 20, filters: filtersA };
          const b = { resource: '/products', page: pageB, limit: 20, filters: filtersB };

          const sameFilters =
            JSON.stringify(Object.entries(filtersA).sort()) ===
            JSON.stringify(Object.entries(filtersB).sort());

          if (!sameFilters) {
            // Different filters must score 0 so no threshold can ever group them.
            expect(scorer(a, b)).toBe(0);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('different resources always score 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        (pageA, pageB) => {
          const a = { resource: '/products', page: pageA, limit: 20, filters: FILTER };
          const b = { resource: '/users', page: pageB, limit: 20, filters: FILTER };
          expect(scorer(a, b)).toBe(0);
        }
      ),
      { numRuns: 500 }
    );
  });
});
