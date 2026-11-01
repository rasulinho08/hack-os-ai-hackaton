/**
 * A stand-in for the GitHub REST API, for the GitHub check: a test registers
 * repositories (when they were made, their commit dates) and the API asks
 * this server instead of api.github.com.
 *
 *   POST /__repos { owner, repo, createdAt, pushedAt, commits: [iso…], status? }
 *        status 404 = missing or private, 403 = rate limited
 *   GET  /repos/:owner/:repo
 *   GET  /repos/:owner/:repo/commits?since=&until=&per_page=   (409 when empty)
 *   GET  /__log    every request, for the tests
 *
 * `node tests/fakeGithub.js 5098` runs it for an API started with
 * GITHUB_API_BASE=http://127.0.0.1:5098.
 */

const http = require('node:http');

function startFakeGithub({ port = 0 } = {}) {
  const repos = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__log') return send(200, log);
      if (url.pathname === '/__repos' && req.method === 'POST') {
        let r = {};
        try { r = JSON.parse(body || '{}'); } catch { r = {}; }
        repos.set(`${r.owner}/${r.repo}`.toLowerCase(), r);
        return send(204);
      }
      log.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: Boolean(req.headers.authorization), at: Date.now() });
      const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/commits)?$/);
      if (!m) return send(404, { message: 'Not Found' });
      const r = repos.get(`${m[1]}/${m[2]}`.toLowerCase());
      if (!r || r.status === 404) return send(404, { message: 'Not Found' });
      if (r.status === 403) return send(403, { message: 'API rate limit exceeded' });
      if (!m[3]) return send(200, { full_name: `${r.owner}/${r.repo}`, created_at: r.createdAt, pushed_at: r.pushedAt || r.createdAt, private: false });
      const commits = (r.commits || []).map((d) => new Date(d).getTime());
      if (!commits.length) return send(409, { message: 'Git Repository is empty.' });
      const since = url.searchParams.get('since') ? new Date(url.searchParams.get('since')).getTime() : -Infinity;
      const until = url.searchParams.get('until') ? new Date(url.searchParams.get('until')).getTime() : Infinity;
      const per = Math.min(100, Number(url.searchParams.get('per_page')) || 30);
      const list = commits.filter((t) => t >= since && t <= until).sort((a, b) => b - a).slice(0, per);
      return send(200, list.map((t, i) => ({ sha: `${t.toString(16)}${i}`, commit: { author: { date: new Date(t).toISOString() } } })));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startFakeGithub };

if (require.main === module) {
  const port = Number(process.argv[2]) || 5098;
  startFakeGithub({ port }).then((gh) => console.log(`[fake-github] ${gh.base}`));
}
