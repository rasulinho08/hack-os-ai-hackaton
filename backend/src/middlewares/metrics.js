/**
 * @file metrics.js
 * @description Request counts and timings of this instance, per minute, for
 * the owner console's health page. In memory, the last hour only: a restart
 * starts afresh, and nothing about who asked is kept (no paths, no ids).
 */

const KEEP_MINUTES = 60;
const SAMPLES_PER_MINUTE = 300;
const startedAt = Date.now();

/** minute (epoch / 60000) → { count, errors, clientErrors, totalMs, maxMs, samples[] } */
const buckets = new Map();

function bucketFor(minute) {
  let b = buckets.get(minute);
  if (!b) {
    b = { count: 0, errors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, samples: [] };
    buckets.set(minute, b);
    for (const k of buckets.keys()) if (k < minute - KEEP_MINUTES) buckets.delete(k);
  }
  return b;
}

function record(status, ms) {
  const b = bucketFor(Math.floor(Date.now() / 60000));
  b.count += 1;
  if (status >= 500) b.errors += 1;
  else if (status >= 400) b.clientErrors += 1;
  b.totalMs += ms;
  if (ms > b.maxMs) b.maxMs = ms;
  // Enough for a percentile; a busy minute keeps a spread, not every value.
  if (b.samples.length < SAMPLES_PER_MINUTE) b.samples.push(ms);
  else b.samples[Math.floor(Math.random() * SAMPLES_PER_MINUTE)] = ms;
}

/** Long polls wait on purpose: their time says nothing about speed. */
const isLongPoll = (url) => /\/chat\/channels\/\d+\/messages\?(.*&)?wait=[1-9]/.test(url);

function middleware(req, res, next) {
  // originalUrl: routers rewrite req.url on the way down.
  const url = req.originalUrl || req.url || '';
  if (url === '/health' || req.method === 'OPTIONS' || isLongPoll(url)) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => record(res.statusCode, Number(process.hrtime.bigint() - t0) / 1e6));
  return next();
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/** The last `minutes` together, and minute by minute for a chart. */
function snapshot(minutes = 15) {
  const now = Math.floor(Date.now() / 60000);
  const series = [];
  const all = { count: 0, errors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, samples: [] };
  for (let m = now - KEEP_MINUTES + 1; m <= now; m += 1) {
    const b = buckets.get(m);
    series.push({ at: new Date(m * 60000).toISOString(), count: b?.count || 0, errors: b?.errors || 0 });
    if (b && m > now - minutes) {
      all.count += b.count; all.errors += b.errors; all.clientErrors += b.clientErrors;
      all.totalMs += b.totalMs; all.maxMs = Math.max(all.maxMs, b.maxMs); all.samples.push(...b.samples);
    }
  }
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    windowMinutes: minutes,
    requests: all.count,
    serverErrors: all.errors,
    clientErrors: all.clientErrors,
    errorRate: all.count ? round((all.errors / all.count) * 100) : 0,
    avgMs: all.count ? round(all.totalMs / all.count) : null,
    p95Ms: round(percentile(all.samples, 95)),
    maxMs: all.count ? round(all.maxMs) : null,
    series,
    since: new Date(startedAt).toISOString(),
  };
}

module.exports = { middleware, snapshot, record };
