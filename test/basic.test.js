const { semanticRelay } = require('../src/index');
const normalizer = require('../src/normalizer');
const scorer = require('../src/scorer');
const supersetBuilder = require('../src/superset-builder');
const partitioner = require('../src/partitioner');

describe('semanticRelay core modules', () => {
  it('supports direct and named CommonJS imports', () => {
    const directImport = require('../src/index');

    expect(typeof directImport).toBe('function');
    expect(directImport.semanticRelay).toBe(semanticRelay);
  });

  it('normalizer extracts cleanly', () => {
    const req = {
      path: '/products',
      query: { page: '2', limit: '30', sort: 'desc' }
    };
    const intent = normalizer(req);
    expect(intent.resource).toBe('/products');
    expect(intent.page).toBe(2);
    expect(intent.limit).toBe(30);
    expect(intent.filters).toEqual({ sort: 'desc' });
    expect(intent.intentId).toBeDefined();
  });

  it('normalizer falls back for invalid pagination', () => {
    const intent = normalizer({
      path: '/products',
      query: { page: '-2', limit: '0', type: 'book' }
    });

    expect(intent.page).toBe(1);
    expect(intent.limit).toBe(20);
    expect(intent.filters).toEqual({ type: 'book' });
  });

  it('scorer logic', () => {
    const intentA = { resource: '/products', page: 1, filters: { cat: 'shoes' } };
    const intentB = { resource: '/products', page: 2, filters: { cat: 'shoes' } };
    const intentC = { resource: '/users', page: 1, filters: { cat: 'shoes' } };
    
    expect(scorer(intentA, intentA)).toBe(1.0);
    expect(scorer(intentA, intentB)).toBe(0.9);
    expect(scorer(intentA, intentC)).toBe(0);
  });

  it('builds and partitions absolute ranges when limits differ', () => {
    const group = [
      { intent: { intentId: 'a', page: 2, limit: 2, filters: { cat: 'shoes' } } },
      { intent: { intentId: 'b', page: 1, limit: 5, filters: { cat: 'shoes' } } }
    ];

    const superset = supersetBuilder(group);
    expect(superset).toMatchObject({
      filter: { cat: 'shoes' },
      skip: 0,
      limit: 5,
      pages: [1, 2]
    });

    const partitions = partitioner([1, 2, 3, 4, 5], group, superset);
    expect(partitions.get('a')).toEqual([3, 4]);
    expect(partitions.get('b')).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('semanticRelay middleware', () => {
  jest.useFakeTimers();

  it('batches requests correctly', async () => {
    const mw = semanticRelay({
      windowMs: 20,
      threshold: 0.8,
      include: ['/products']
    });

    const createReqRes = (page) => {
      const intentId = 'id-' + page;
      const req = {
        method: 'GET',
        path: '/products',
        query: { page: String(page), limit: '2' },
      };
      let jsonResolve;
      const jsonPromise = new Promise(r => jsonResolve = r);
      const res = {
        json: jest.fn((data) => {
             jsonResolve(data);
        }),
        send: jest.fn((data) => jsonResolve(data))
      };
      const next = jest.fn();
      return { req, res, next, jsonPromise, intentId };
    };

    const ctx1 = createReqRes(1);
    const ctx2 = createReqRes(2);

    mw(ctx1.req, ctx1.res, ctx1.next);
    mw(ctx2.req, ctx2.res, ctx2.next);

    jest.advanceTimersByTime(25);

    await Promise.resolve(); // trigger microtasks
    await Promise.resolve();
    
    expect(ctx1.next).toHaveBeenCalled();
    expect(ctx2.next).not.toHaveBeenCalled();

    // the intercepting function overrides leader res
    ctx1.res.json([
      { id: 1 }, { id: 2 },
      { id: 3 }, { id: 4 }
    ]);

    await ctx1.jsonPromise;
    await ctx2.jsonPromise;
    
    expect(ctx1.res.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
    expect(ctx2.res.json).toHaveBeenCalledWith([{ id: 3 }, { id: 4 }]);
    
    const metrics = mw.getMetrics();
    expect(metrics.totalWindowsOpened).toBe(1);
    expect(metrics.queriesSaved).toBe(1);
  });

  it('intercepts send with a JSON array payload', async () => {
    const mw = semanticRelay({
      windowMs: 20,
      threshold: 0.8,
      include: ['/products']
    });

    const createReqRes = (page) => {
      const req = {
        method: 'GET',
        path: '/products',
        query: { page: String(page), limit: '2' },
      };
      let jsonResolve;
      const jsonPromise = new Promise(r => jsonResolve = r);
      const res = {
        json: jest.fn((data) => jsonResolve(data)),
        send: jest.fn((data) => jsonResolve(data))
      };
      const next = jest.fn();
      return { req, res, next, jsonPromise };
    };

    const ctx1 = createReqRes(1);
    const ctx2 = createReqRes(2);

    mw(ctx1.req, ctx1.res, ctx1.next);
    mw(ctx2.req, ctx2.res, ctx2.next);

    jest.advanceTimersByTime(25);
    await Promise.resolve();
    await Promise.resolve();

    ctx1.res.send(JSON.stringify([
      { id: 1 }, { id: 2 },
      { id: 3 }, { id: 4 }
    ]));

    await ctx1.jsonPromise;
    await ctx2.jsonPromise;

    expect(ctx1.res.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
    expect(ctx2.res.json).toHaveBeenCalledWith([{ id: 3 }, { id: 4 }]);
  });

  it('falls followers back when the leader sends an error response', async () => {
    const mw = semanticRelay({
      windowMs: 20,
      threshold: 0.8,
      include: ['/products']
    });

    const createReqRes = (page, statusCode = 200) => {
      const req = {
        method: 'GET',
        path: '/products',
        query: { page: String(page), limit: '2' },
      };
      let jsonResolve;
      const jsonPromise = new Promise(r => jsonResolve = r);
      const res = {
        statusCode,
        json: jest.fn((data) => jsonResolve(data)),
        send: jest.fn((data) => jsonResolve(data))
      };
      const next = jest.fn();
      return { req, res, next, jsonPromise };
    };

    const ctx1 = createReqRes(1, 500);
    const ctx2 = createReqRes(2);

    mw(ctx1.req, ctx1.res, ctx1.next);
    mw(ctx2.req, ctx2.res, ctx2.next);

    jest.advanceTimersByTime(25);
    await Promise.resolve();
    await Promise.resolve();

    ctx1.res.json({ error: 'database failed' });

    await ctx1.jsonPromise;
    await Promise.resolve();

    expect(ctx1.res.json).toHaveBeenCalledWith({ error: 'database failed' });
    expect(ctx2.next).toHaveBeenCalledTimes(1);
    expect(ctx2.req.semanticRelay.fallbackReason).toBe('leader-error-response');
  });

  it('falls followers back when the leader never sends a response', async () => {
    const mw = semanticRelay({
      windowMs: 20,
      threshold: 0.8,
      include: ['/products'],
      responseTimeoutMs: 50
    });

    const createReqRes = (page) => {
      const req = {
        method: 'GET',
        path: '/products',
        query: { page: String(page), limit: '2' },
      };
      const res = {
        statusCode: 200,
        json: jest.fn(),
        send: jest.fn()
      };
      const next = jest.fn();
      return { req, res, next };
    };

    const ctx1 = createReqRes(1);
    const ctx2 = createReqRes(2);

    mw(ctx1.req, ctx1.res, ctx1.next);
    mw(ctx2.req, ctx2.res, ctx2.next);

    jest.advanceTimersByTime(25);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx1.next).toHaveBeenCalledTimes(1);
    expect(ctx2.next).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(ctx2.next).toHaveBeenCalledTimes(1);
    expect(ctx2.req.semanticRelay.fallbackReason).toBe('leader-timeout');
  });
});
