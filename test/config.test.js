const semanticRelay = require('../src/index');
const normalizer = require('../src/normalizer');

describe('configurable normalization conventions', () => {
  describe('custom pagination param names', () => {
    it('resolve() reads custom pageParam/limitParam in the fallback path', () => {
      const mw = semanticRelay({ pageParam: 'p', limitParam: 'size' });
      const out = mw.resolve({ query: { p: '3', size: '10', cat: 'shoes' } });

      expect(out).toEqual({
        filter: { cat: 'shoes' }, // p/size excluded, cat kept
        skip: 20, // (3 - 1) * 10
        limit: 10,
        aggregated: false,
        groupSize: 1
      });
    });

    it('normalizer and resolve agree on the same custom config', () => {
      const config = { pageParam: 'p', limitParam: 'size' };
      const req = { path: '/products', query: { p: '2', size: '15', brand: 'acme' } };

      const intent = normalizer(req, config);
      expect(intent.page).toBe(2);
      expect(intent.limit).toBe(15);
      expect(intent.filters).toEqual({ brand: 'acme' });

      const mw = semanticRelay(config);
      const resolved = mw.resolve(req);
      // skip derived from the same page/limit the normalizer used
      expect(resolved.skip).toBe((intent.page - 1) * intent.limit);
      expect(resolved.limit).toBe(intent.limit);
      expect(resolved.filter).toEqual(intent.filters);
    });
  });

  describe('explicit filterFields', () => {
    it('resolve() only includes whitelisted fields, ignoring sort/search params', () => {
      const mw = semanticRelay({ filterFields: ['cat', 'brand'] });
      const out = mw.resolve({
        query: { page: '1', limit: '20', cat: 'shoes', brand: 'acme', sort: 'desc', q: 'red' }
      });

      // sort and q are NOT passed to the DB filter
      expect(out.filter).toEqual({ cat: 'shoes', brand: 'acme' });
    });

    it('normalizer restricts the grouping key to filterFields', () => {
      const config = { filterFields: ['cat'] };
      const a = normalizer({ path: '/p', query: { page: '1', limit: '20', cat: 'x', sort: 'asc' } }, config);
      const b = normalizer({ path: '/p', query: { page: '1', limit: '20', cat: 'x', sort: 'desc' } }, config);

      // Only `cat` matters → both have identical filters despite differing sort.
      expect(a.filters).toEqual({ cat: 'x' });
      expect(b.filters).toEqual({ cat: 'x' });
    });

    it('omits filter fields that are absent from the query', () => {
      const mw = semanticRelay({ filterFields: ['cat', 'brand'] });
      const out = mw.resolve({ query: { page: '1', limit: '20', cat: 'shoes' } });
      expect(out.filter).toEqual({ cat: 'shoes' }); // brand absent, not included as undefined
    });
  });

  describe('safe defaults preserved', () => {
    it('defaults to page/limit with all other params as filters', () => {
      const mw = semanticRelay();
      const out = mw.resolve({ query: { page: '2', limit: '20', cat: 'a', sort: 'desc' } });
      // default behavior: every non-pagination param is part of the filter key
      expect(out.filter).toEqual({ cat: 'a', sort: 'desc' });
      expect(out.skip).toBe(20);
    });
  });
});
