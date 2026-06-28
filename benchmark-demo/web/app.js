'use strict';

(function () {
  const data = window.BENCHMARK_DATA;
  const main = document.querySelector('main');

  if (!data) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent =
      'Benchmark data not found. Run `npm run benchmark` in the benchmark-demo ' +
      'folder to generate web/data.js, then reload this page.';
    main.prepend(banner);
    return;
  }

  const STRATEGY_COLORS = {
    naive: getCss('--naive'),
    dedup: getCss('--dedup'),
    cache: getCss('--cache'),
    dataloader: getCss('--dataloader'),
    relay: getCss('--relay')
  };

  const METRIC_UNITS = {
    dbCalls: '',
    avgLatencyMs: ' ms',
    p95LatencyMs: ' ms',
    throughput: ' req/s'
  };

  function getCss(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  // ---------- Config / metadata lines ----------
  const cfg = data.metadata.config;
  document.getElementById('config-line').textContent =
    `model: ${cfg.dbLatencyMs}ms base DB latency · pool ${cfg.poolSize} · ` +
    `${cfg.totalRecords} records · node ${data.metadata.nodeVersion}`;

  document.getElementById('meta-line').textContent =
    `Generated ${new Date(data.metadata.timestamp).toLocaleString()} · ` +
    `${data.metadata.hardware.cpu} (${data.metadata.hardware.cores} cores, ` +
    `${data.metadata.hardware.memoryGb} GB) · semantic-relay v${data.metadata.relayVersion}`;

  // ---------- Summary ----------
  const summaryGrid = document.getElementById('summary-grid');
  Object.keys(data.summary).forEach((id) => {
    const s = data.summary[id];
    const item = document.createElement('div');
    item.className = 'summary-item';
    item.innerHTML =
      `<h4>vs ${escapeHtml(s.label)}</h4>` +
      metricRow('Fewer DB calls', s.dbCallReductionPct) +
      metricRow('Lower latency', s.latencyImprovementPct) +
      metricRow('More throughput', s.throughputGainPct);
    summaryGrid.appendChild(item);
  });

  function metricRow(label, pct) {
    const cls = pct > 1 ? 'good' : pct < -1 ? 'bad' : 'flat';
    const sign = pct > 0 ? '+' : '';
    return (
      `<div class="metric-row"><span class="label">${label}</span>` +
      `<span class="value ${cls}">${sign}${pct}%</span></div>`
    );
  }

  // ---------- Scenario selector + charts ----------
  const select = document.getElementById('scenario-select');

  const aggregateOption = document.createElement('option');
  aggregateOption.value = '__aggregate__';
  aggregateOption.textContent = 'All scenarios (average)';
  select.appendChild(aggregateOption);

  data.scenarios.forEach((sc) => {
    const opt = document.createElement('option');
    opt.value = sc.id;
    opt.textContent = sc.label;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => renderScenario(select.value));

  function getCellData(scenarioId) {
    if (scenarioId !== '__aggregate__') {
      return { results: data.results[scenarioId], desc: descFor(scenarioId) };
    }
    // Aggregate: average each metric across scenarios per strategy.
    const agg = {};
    data.strategies.forEach((strat) => {
      const cells = data.scenarios
        .map((sc) => data.results[sc.id][strat.id])
        .filter((c) => c && !c.skipped);
      if (cells.length === 0) {
        agg[strat.id] = { skipped: 'no data' };
        return;
      }
      agg[strat.id] = {
        dbCalls: avg(cells.map((c) => c.dbCalls)),
        avgLatencyMs: avg(cells.map((c) => c.avgLatencyMs)),
        p95LatencyMs: avg(cells.map((c) => c.p95LatencyMs)),
        throughput: avg(cells.map((c) => c.throughput))
      };
    });
    return { results: agg, desc: 'Mean of every metric across all four scenarios.' };
  }

  function descFor(scenarioId) {
    const sc = data.scenarios.find((s) => s.id === scenarioId);
    return sc ? sc.description : '';
  }

  function avg(arr) {
    return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100;
  }

  function renderScenario(scenarioId) {
    const { results, desc } = getCellData(scenarioId);
    document.getElementById('scenario-desc').textContent = desc;

    document.querySelectorAll('.chart').forEach((chartEl) => {
      const metric = chartEl.dataset.metric;
      renderChart(chartEl, metric, results);
    });
  }

  function renderChart(chartEl, metric, results) {
    chartEl.innerHTML = '';

    const entries = data.strategies.map((strat) => ({
      id: strat.id,
      label: strat.label,
      cell: results[strat.id]
    }));

    const values = entries
      .filter((e) => e.cell && !e.cell.skipped)
      .map((e) => e.cell[metric]);
    const max = Math.max(...values, 1);

    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'bar-row';

      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = e.label;
      label.title = e.label;

      const track = document.createElement('div');
      track.className = 'bar-track';

      const fill = document.createElement('div');
      fill.className = 'bar-fill';

      if (!e.cell || e.cell.skipped) {
        fill.classList.add('skipped');
        fill.textContent = 'skipped';
      } else {
        const value = e.cell[metric];
        const pct = Math.max((value / max) * 100, 2);
        fill.style.background = STRATEGY_COLORS[e.id] || '#888';
        // animate width on next frame
        requestAnimationFrame(() => {
          fill.style.width = pct + '%';
        });
        const display = formatValue(value, metric);
        fill.textContent = display;

        const tip = `${e.label}: ${display}`;
        track.title = tip;
        fill.title = tip;
      }

      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      chartEl.appendChild(row);
    });
  }

  function formatValue(value, metric) {
    const unit = METRIC_UNITS[metric] || '';
    if (metric === 'dbCalls') return Math.round(value) + unit;
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + unit;
  }

  // ---------- Mechanism walkthrough ----------
  const STEPS = [
    {
      title: 'Request arrival',
      body:
        'Multiple clients hit the same list endpoint at almost the same moment. ' +
        'Each asks for a different slice of the same filtered data.',
      demo:
        '<span class="pill group-a">GET /products?cat=a&page=1</span>' +
        '<span class="pill group-a">GET /products?cat=a&page=2</span>' +
        '<span class="pill group-b">GET /products?cat=b&page=1</span>'
    },
    {
      title: 'Time-window collection',
      body:
        'Instead of executing immediately, semantic-relay holds incoming GETs for a ' +
        'short window (default 20ms) so concurrent requests can be considered together.',
      demo: '<span class="pill">buffering for windowMs = 20ms…</span>'
    },
    {
      title: 'Semantic similarity scoring',
      body:
        'Each pair is scored. Same route + identical filters + adjacent pages score high ' +
        'and are grouped. Different filters score 0 and are never merged.',
      demo:
        '<div class="score-pair"><span class="score merge">0.9</span>' +
        '<span>cat=a page 1 &harr; cat=a page 2 → <strong>merge</strong></span></div>' +
        '<div class="score-pair"><span class="score split">0.0</span>' +
        '<span>cat=a page 1 &harr; cat=b page 1 → <strong>keep separate</strong></span></div>'
    },
    {
      title: 'Superset query building',
      body:
        'For each group, a single covering query is computed: the minimum skip through the ' +
        'maximum record across the group. Pages 1 and 2 (limit 20) become one query for records 0–40.',
      demo: '<span class="pill group-a">find({cat:"a"}).skip(0).limit(40)</span>'
    },
    {
      title: 'Single database execution',
      body:
        'The leader request runs that one query. Every other request in the group waits — ' +
        'no extra database round-trips are made.',
      demo: '<span class="pill group-a">1 DB call serves the whole group</span>'
    },
    {
      title: 'Result partitioning',
      body:
        'The single result array is sliced back to each caller’s exact offset and limit, so ' +
        'every client receives precisely what its own standalone query would have returned.',
      demo:
        '<span class="pill group-a">page 1 ← records[0:20]</span>' +
        '<span class="pill group-a">page 2 ← records[20:40]</span>'
    }
  ];

  const stepsEl = document.getElementById('steps');
  STEPS.forEach((step, i) => {
    const el = document.createElement('div');
    el.className = 'step' + (i === 0 ? ' active' : '');
    el.innerHTML =
      `<span class="step-num">${i + 1}</span><h3>${escapeHtml(step.title)}</h3>` +
      `<p>${step.body}</p><div class="demo">${step.demo}</div>`;
    stepsEl.appendChild(el);
  });

  let current = 0;
  const prevBtn = document.getElementById('prev-step');
  const nextBtn = document.getElementById('next-step');
  const indicator = document.getElementById('step-indicator');

  function showStep(idx) {
    const stepEls = stepsEl.querySelectorAll('.step');
    stepEls.forEach((s, i) => s.classList.toggle('active', i === idx));
    indicator.textContent = `${idx + 1} / ${STEPS.length}`;
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === STEPS.length - 1;
  }
  prevBtn.addEventListener('click', () => {
    if (current > 0) showStep(--current);
  });
  nextBtn.addEventListener('click', () => {
    if (current < STEPS.length - 1) showStep(++current);
  });
  showStep(0);

  // ---------- Before / after ----------
  const before = document.getElementById('ba-before');
  const after = document.getElementById('ba-after');
  const reqs = [1, 2, 3, 4, 5];

  const beforeReqs = reqs
    .map((p) => `<div class="ba-req">GET …page=${p}</div>`)
    .join('');
  before.innerHTML =
    beforeReqs +
    '<div class="ba-db">' +
    reqs.map(() => '<span class="db-hit">DB</span>').join('') +
    '</div>';
  document.getElementById('ba-before-count').textContent = '5 database round-trips';

  after.innerHTML =
    beforeReqs +
    '<div class="ba-db"><span class="db-hit single">1 superset query</span></div>';
  document.getElementById('ba-after-count').textContent = '1 database round-trip';

  document.getElementById('threshold-note').innerHTML =
    'The similarity <strong>threshold</strong> (default <code>0.8</code>) controls how ' +
    'aggressively requests merge. A score of 1.0 means identical pages; adjacent pages of ' +
    'the same filter score 0.9; requests with different filters score 0.0 and are guaranteed ' +
    'never to be grouped, so every caller always receives correct data.';

  // ---------- Initial render ----------
  renderScenario('__aggregate__');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
})();
