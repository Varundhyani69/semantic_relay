function supersetBuilder(group) {
  if (!Array.isArray(group) || group.length === 0) {
    throw new Error('supersetBuilder requires at least one request context');
  }

  let minSkip = Infinity;
  let maxRecord = 0;
  const pages = new Set();
  
  for (const ctx of group) {
    const { intent } = ctx;
    const skip = (intent.page - 1) * intent.limit;
    const endRecord = skip + intent.limit;

    if (skip < minSkip) minSkip = skip;
    if (endRecord > maxRecord) maxRecord = endRecord;

    pages.add(intent.page);
  }

  const leaderIntent = group[0].intent;
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
