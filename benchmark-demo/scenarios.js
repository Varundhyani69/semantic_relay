'use strict';

/**
 * Each scenario produces a list of request paths fired as one concurrent burst.
 * Scenarios are designed to expose where each strategy wins or loses.
 */

const SCENARIOS = [
  {
    id: 'identical-burst',
    label: 'Identical burst',
    description:
      '200 requests for the exact same page. Dedup and cache collapse these; naive does not.',
    build() {
      const reqs = [];
      for (let i = 0; i < 200; i++) {
        reqs.push('/products?cat=a&page=1&limit=20');
      }
      return reqs;
    }
  },
  {
    id: 'overlapping-pages',
    label: 'Overlapping pagination',
    description:
      '200 requests for the same filter spread across pages 1-5. Only semantic-relay merges these overlapping pages into one superset query.',
    build() {
      const reqs = [];
      for (let i = 0; i < 200; i++) {
        const page = (i % 5) + 1;
        reqs.push(`/products?cat=a&page=${page}&limit=20`);
      }
      return reqs;
    }
  },
  {
    id: 'mixed-filter',
    label: 'Mixed filters',
    description:
      '200 requests mixing two filter sets across three pages each. semantic-relay groups within each filter set but never across filters.',
    build() {
      const reqs = [];
      const cats = ['a', 'b'];
      for (let i = 0; i < 200; i++) {
        const cat = cats[i % 2];
        const page = (i % 3) + 1;
        reqs.push(`/products?cat=${cat}&page=${page}&limit=20`);
      }
      return reqs;
    }
  },
  {
    id: 'diverse-pages',
    label: 'High-concurrency diverse',
    description:
      '300 requests each asking for a unique page. Little overlap exists, so this is the hardest case for every batching strategy.',
    build() {
      const reqs = [];
      for (let i = 0; i < 300; i++) {
        reqs.push(`/products?cat=a&page=${i + 1}&limit=20`);
      }
      return reqs;
    }
  }
];

module.exports = SCENARIOS;
