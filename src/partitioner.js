function partitioner(resultsArray, group, superset) {
  const partitioned = new Map();
  
  for (const ctx of group) {
    const intent = ctx.intent;
    const intentSkip = (intent.page - 1) * intent.limit;
    const arrayOffset = intentSkip - superset.skip;
    
    const slice = resultsArray.slice(arrayOffset, arrayOffset + intent.limit);
    partitioned.set(intent.intentId, slice);
  }
  
  return partitioned;
}

module.exports = partitioner;
