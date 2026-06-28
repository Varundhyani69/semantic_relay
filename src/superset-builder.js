function stableStringify(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }

  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function supersetBuilder(group) {
  if (!Array.isArray(group) || group.length === 0) {
    throw new Error('supersetBuilder requires at least one request context');
  }

  const leaderIntent = group[0].intent;
  const leaderFilterKey = stableStringify(leaderIntent.filters);

  let minSkip = Infinity;
  let maxRecord = 0;
  const pages = new Set();
  
  for (const ctx of group) {
    const { intent } = ctx;

    // Defense-in-depth: the superset query is built from the leader's filter
    // set only. Grouping intents with differing filters would return incorrect
    // data to followers, so we refuse to build a superset for a mixed group.
    // The scorer already prevents this, but a custom adapter or future change
    // must not be able to silently corrupt results.
    if (stableStringify(intent.filters) !== leaderFilterKey) {
      throw new Error('supersetBuilder received a group with mismatched filters');
    }

    const skip = (intent.page - 1) * intent.limit;
    const endRecord = skip + intent.limit;

    if (skip < minSkip) minSkip = skip;
    if (endRecord > maxRecord) maxRecord = endRecord;

    pages.add(intent.page);
  }

  const combinedLimit = maxRecord - minSkip;

  return {
    filter: Object.assign({}, leaderIntent.filters),
    skip: minSkip,
    limit: combinedLimit,
    pages: Array.from(pages).sort((a,b) => a - b),
    baseLimit: leaderIntent.limit
  };
}

module.exports = supersetBuilder;
