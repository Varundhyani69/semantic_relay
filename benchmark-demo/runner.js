'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { MockDb, DB_LATENCY_MS, POOL_SIZE, TOTAL_RECORDS } = require('./mock-db');
const SCENARIOS = require('./scenarios');

const createNaiveApp = require('./strategies/naive');
const createDedupApp = require('./strategies/dedup');
const createCacheApp = require('./strategies/cache');
const createDataLoaderApp = require('./strategies/dataloader');
const createRelayApp = require('./strategies/relay');

const RUNS = 3; // measured runs (median reported)
const WARMUP = 1; // discarded warm-up runs

const STRATEGIES = [
  {
    id: 'naive',
    label: 'Naive (no optimization)',
    create: (db) => createNaiveApp(db)
  },
  {
    id: 'dedup',
    label: 'Request dedup (single-flight)',
    create: (db) => createDedupApp(db)
  },
  {
    id: 'cache',
    label: 'Redis-style cache',
    create: (db) => createCacheApp(db)
  },
  {
    id: 'dataloader',
    label: 'DataLoader batching',
    create: (db) => createDataLoaderApp(db)
  },
  {
    id: 'relay',
    label: 'semantic-relay',
    create: (db) => createRelayApp(db)
  }
];

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Fire a single GET and resolve with its latency in ms.
function fireRequest(port, reqPath) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const req = http.get(
      { host: '127.0.0.1', port, path: reqPath },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const end = process.hrtime.bigint();
          resolve(Number(end - start) / 1e6);
        });
      }
    );
    req.on('error', reject);
  });
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor((p / 100) * sortedAsc.length)
  );
  return sortedAsc[idx];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function runOnce(strategy, requests) {
  const db = new MockDb();
  const app = strategy.create(db);
  const server = await listen(app);
  const port = server.address().port;

  db.reset();
  const startWall = process.hrtime.bigint();

  const latencies = await Promise.all(
    requests.map((reqPath) => fireRequest(port, reqPath))
  );

  const endWall = process.hrtime.bigint();
  const wallMs = Number(endWall - startWall) / 1e6;

  const relayMetrics =
    typeof app.getRelayMetrics === 'function' ? app.getRelayMetrics() : null;

  await closeServer(server);

  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  return {
    dbCalls: db.getQueryCount(),
    avgLatencyMs: avg,
    p95LatencyMs: percentile(sorted, 95),
    wallMs,
    throughput: (requests.length / wallMs) * 1000, // req/sec
    relayMetrics
  };
}

async function runStrategyOnScenario(strategy, scenario) {
  const requests = scenario.build();

  // Warm-up runs (discarded).
  for (let i = 0; i < WARMUP; i++) {
    await runOnce(strategy, requests);
  }

  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    samples.push(await runOnce(strategy, requests));
  }

  return {
    dbCalls: Math.round(median(samples.map((s) => s.dbCalls))),
    avgLatencyMs: round2(median(samples.map((s) => s.avgLatencyMs))),
    p95LatencyMs: round2(median(samples.map((s) => s.p95LatencyMs))),
    wallMs: round2(median(samples.map((s) => s.wallMs))),
    throughput: round2(median(samples.map((s) => s.throughput))),
    totalRequests: requests.length,
    relayMetrics: samples[samples.length - 1].relayMetrics
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function buildSummary(results) {
  // Improvement of semantic-relay vs each competitor, averaged across scenarios.
  const summary = {};
  const competitors = STRATEGIES.filter((s) => s.id !== 'relay');

  for (const competitor of competitors) {
    const perScenario = [];
    for (const scenario of SCENARIOS) {
      const relay = results[scenario.id].relay;
      const other = results[scenario.id][competitor.id];
      if (!relay || !other) continue;

      perScenario.push({
        dbCallReductionPct:
          other.dbCalls === 0
            ? 0
            : round2(((other.dbCalls - relay.dbCalls) / other.dbCalls) * 100),
        latencyImprovementPct:
          other.avgLatencyMs === 0
            ? 0
            : round2(
                ((other.avgLatencyMs - relay.avgLatencyMs) /
                  other.avgLatencyMs) *
                  100
              ),
        throughputGainPct:
          other.throughput === 0
            ? 0
            : round2(
                ((relay.throughput - other.throughput) / other.throughput) * 100
              )
      });
    }

    summary[competitor.id] = {
      label: competitor.label,
      dbCallReductionPct: round2(avg(perScenario.map((p) => p.dbCallReductionPct))),
      latencyImprovementPct: round2(
        avg(perScenario.map((p) => p.latencyImprovementPct))
      ),
      throughputGainPct: round2(avg(perScenario.map((p) => p.throughputGainPct)))
    };
  }

  return summary;
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

async function main() {
  console.log('semantic-relay benchmark suite');
  console.log(
    `Config: DB latency ${DB_LATENCY_MS}ms, pool size ${POOL_SIZE}, dataset ${TOTAL_RECORDS} records`
  );
  console.log(`Runs per cell: ${WARMUP} warm-up + ${RUNS} measured (median)\n`);

  const results = {};

  for (const scenario of SCENARIOS) {
    console.log(`\nScenario: ${scenario.label} (${scenario.id})`);
    results[scenario.id] = {};
    for (const strategy of STRATEGIES) {
      process.stdout.write(`  - ${strategy.label.padEnd(32)} `);
      try {
        const cell = await runStrategyOnScenario(strategy, scenario);
        results[scenario.id][strategy.id] = cell;
        console.log(
          `dbCalls=${String(cell.dbCalls).padStart(4)}  ` +
            `avg=${String(cell.avgLatencyMs).padStart(8)}ms  ` +
            `p95=${String(cell.p95LatencyMs).padStart(8)}ms  ` +
            `thru=${String(cell.throughput).padStart(8)} req/s`
        );
      } catch (err) {
        results[scenario.id][strategy.id] = { skipped: err.message };
        console.log(`SKIPPED (${err.message})`);
      }
    }
  }

  const report = {
    metadata: {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      hardware: {
        cpu: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
        cores: os.cpus().length,
        memoryGb: round2(os.totalmem() / 1024 ** 3)
      },
      config: { dbLatencyMs: DB_LATENCY_MS, poolSize: POOL_SIZE, totalRecords: TOTAL_RECORDS },
      relayVersion: require('../package.json').version
    },
    strategies: STRATEGIES.map((s) => ({ id: s.id, label: s.label })),
    scenarios: SCENARIOS.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description
    })),
    results,
    summary: buildSummary(results)
  };

  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const jsonPath = path.join(resultsDir, 'latest.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Also emit a JS file so the demo page can load data via <script> under file://
  // (avoids fetch/CORS restrictions when opening index.html directly).
  const jsPath = path.join(__dirname, 'web', 'data.js');
  fs.mkdirSync(path.dirname(jsPath), { recursive: true });
  fs.writeFileSync(
    jsPath,
    'window.BENCHMARK_DATA = ' + JSON.stringify(report, null, 2) + ';\n'
  );

  console.log(`\nReport written to ${jsonPath}`);
  console.log(`Demo data written to ${jsPath}`);
  console.log('\nSummary (semantic-relay vs competitors, averaged):');
  for (const id of Object.keys(report.summary)) {
    const s = report.summary[id];
    console.log(
      `  vs ${s.label.padEnd(30)} ` +
        `DB calls -${s.dbCallReductionPct}%  ` +
        `latency -${s.latencyImprovementPct}%  ` +
        `throughput +${s.throughputGainPct}%`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
