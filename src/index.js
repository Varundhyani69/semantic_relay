const WindowManager = require('./window-manager');
const normalizer = require('./normalizer');
const supersetBuilder = require('./superset-builder');
const partitioner = require('./partitioner');
const MemoryWindow = require('./adapters/memory-window');

function extractResultsArray(data) {
  if (Array.isArray(data)) return data;

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return extractResultsArray(parsed);
    } catch (err) {
      return [];
    }
  }

  if (data && Array.isArray(data.data)) return data.data;

  return [];
}

function invokeOriginal(res, method, data) {
  if (typeof method !== 'function') return res;
  return method.call(res, data);
}

const parsePositiveInt = normalizer.parsePositiveInt;

/**
 * Returns the effective query a route handler should run, with the
 * leader/follower fallback already applied, using the same normalization
 * config as the grouping core so the two can never disagree.
 *
 * - When the request is a coalesced group leader, returns the merged superset
 *   query ({ filter, skip, limit }) built by semantic-relay's core.
 * - Otherwise (solo request, or a follower that fell back to normal execution),
 *   derives the equivalent query from req.query using the same config.
 *
 * This is a read-only convenience over `req.semanticRelay`; it does not change
 * any coalescing, superset, or partitioning behavior.
 */
function resolveWith(req, config) {
  const agg = req && req.semanticRelay;

  if (agg && agg.query) {
    return {
      filter: agg.query.filter,
      skip: agg.query.skip,
      limit: agg.query.limit,
      aggregated: true,
      groupSize: agg.groupSize
    };
  }

  const cfg = config || {};
  const pageParam = cfg.pageParam || 'page';
  const limitParam = cfg.limitParam || 'limit';
  const filterFields = cfg.filterFields || null;

  const query = (req && req.query) || {};
  const page = parsePositiveInt(query[pageParam], 1);
  const limit = parsePositiveInt(query[limitParam], 20);

  const filter = {};
  if (filterFields) {
    for (const key of filterFields) {
      if (query[key] !== undefined) {
        filter[key] = query[key];
      }
    }
  } else {
    for (const key in query) {
      if (key !== pageParam && key !== limitParam) {
        filter[key] = query[key];
      }
    }
  }

  return {
    filter,
    skip: (page - 1) * limit,
    limit,
    aggregated: false,
    groupSize: agg ? agg.groupSize : 1
  };
}

// Standalone export: uses default conventions (page/limit, all params as filter).
function resolve(req) {
  return resolveWith(req, {});
}

function semanticRelay(options = {}) {
  const {
    windowMs = 20,
    threshold = 0.8,
    include = [],
    responseTimeoutMs = 30000,
    onAggregate = () => {},
    onFallback = () => {},
    window: windowAdapter = new MemoryWindow(),
    pageParam = 'page',
    limitParam = 'limit',
    filterFields = null
  } = options;

  // Shared normalization config: used for grouping/superset AND resolve(), so
  // the two can never disagree about pagination vs. filters.
  const normConfig = { pageParam, limitParam, filterFields };

  let totalRequests = 0;
  let aggregatedRequests = 0;
  let soloRequests = 0;
  let totalWindowsOpened = 0;

  const wm = new WindowManager({ windowMs, threshold, window: windowAdapter });

  wm.onFlush((groupContexts) => {
    totalWindowsOpened++;

    if (groupContexts.length === 1) {
      soloRequests++;
      const solo = groupContexts[0];
      solo.req.semanticRelay = {
        aggregated: false,
        groupSize: 1,
        query: null
      };
      try {
        onFallback(solo.req);
      } catch (err) {
        solo.req.semanticRelay.callbackError = err;
      }
      solo.resolve(null);
      solo.next();
      return;
    }

    aggregatedRequests += groupContexts.length;
    
    try {
      const superset = supersetBuilder(groupContexts);
      const leader = groupContexts[0];

      for (const ctx of groupContexts) {
        ctx.req.semanticRelay = {
          aggregated: true,
          groupSize: groupContexts.length,
          leader: ctx === leader,
          query: ctx === leader ? superset : null
        };
      }

      try {
        onAggregate(groupContexts);
      } catch (err) {
        leader.req.semanticRelay.callbackError = err;
      }

      const originalJson = leader.res.json;
      const originalSend = leader.res.send;
      let intercepted = false;
      let responseTimer = null;

      const restore = () => {
        leader.res.json = originalJson;
        if (typeof originalSend === 'function') {
          leader.res.send = originalSend;
        }
      };

      const fallbackFollowers = (reason) => {
        for (const ctx of groupContexts) {
          ctx.req.semanticRelay = Object.assign({}, ctx.req.semanticRelay, {
            aggregated: false,
            fallbackReason: reason
          });
          ctx.resolve(null);
          if (ctx !== leader) {
            ctx.next();
          }
        }
      };

      const intercept = function(data, methodName) {
        if (intercepted) return leader.res;
        intercepted = true;
        if (responseTimer) clearTimeout(responseTimer);

        restore();

        if (leader.res.statusCode >= 400) {
          fallbackFollowers('leader-error-response');
          return invokeOriginal(
            leader.res,
            methodName === 'send' ? originalSend : originalJson,
            data
          );
        }

        try {
          const resultsArray = extractResultsArray(data);
          const partitioned = partitioner(resultsArray, groupContexts, superset);

          for (const ctx of groupContexts) {
            const slice = partitioned.get(ctx.intent.intentId);
            ctx.resolve(slice);
          }
        } catch (err) {
          for (const ctx of groupContexts) {
            ctx.reject(err);
          }
        }

        return leader.res;
      };

      leader.res.json = intercept;
      if (typeof originalSend === 'function') {
        leader.res.send = function(data) {
          return intercept(data, 'send');
        };
      }

      if (responseTimeoutMs > 0) {
        responseTimer = setTimeout(() => {
          if (intercepted) return;
          intercepted = true;
          restore();
          fallbackFollowers('leader-timeout');
        }, responseTimeoutMs);
      }

      leader.next();
    } catch (err) {
      for (const ctx of groupContexts) {
         ctx.resolve(null);
         ctx.req.semanticRelay = {
           aggregated: false,
           groupSize: groupContexts.length,
           error: err.message
         };
         ctx.next();
      }
    }
  });

  const middleware = async (req, res, next) => {
    try {
      if (req.method !== 'GET') {
        return next();
      }

      const requestPath = req.path || req.url || '';
      const isIncluded = include.length === 0 || include.some(route => requestPath.startsWith(route));
      if (!isIncluded) {
        return next();
      }

      totalRequests++;

      const intent = normalizer(req, normConfig);

      let resolveDeferred, rejectDeferred;
      const deferred = new Promise((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
      });

      const reqCtx = {
        req,
        res,
        next,
        intent,
        resolve: resolveDeferred,
        reject: rejectDeferred
      };

      wm.add(reqCtx);

      const resolvedData = await deferred;

      if (resolvedData !== null) {
        res.json(resolvedData);
      }
      
    } catch (err) {
      return next(err);
    }
  };

  middleware.getMetrics = () => {
    const queriesSaved = totalRequests - totalWindowsOpened;
    return {
      totalRequests,
      aggregatedRequests,
      soloRequests,
      totalWindowsOpened,
      queriesSaved,
      reductionPercent: totalRequests === 0 ? 0 : (queriesSaved / totalRequests) * 100
    };
  };

  middleware.resolve = (req) => resolveWith(req, normConfig);

  return middleware;
}

module.exports = semanticRelay;
module.exports.semanticRelay = semanticRelay;
module.exports.MemoryWindow = MemoryWindow;
module.exports.resolve = resolve;
