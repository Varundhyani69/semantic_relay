function stableStringify(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }

  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function scorer(intentA, intentB) {
  if (intentA.resource !== intentB.resource) return 0;
  
  const fA = stableStringify(intentA.filters);
  const fB = stableStringify(intentB.filters);
  
  if (fA !== fB) return 0.3;
  
  if (intentA.page === intentB.page) return 1.0;
  
  const diff = Math.abs(intentA.page - intentB.page);
  
  if (diff === 1) return 0.9;
  if (diff === 2) return 0.7;
  
  return 0.4;
}

module.exports = scorer;
