/**
 * A stand-in for Meta's Model API (Chat Completions), so tests spend no
 * credits: by default it answers a complete event plan; a test can queue
 * other answers.
 *
 *   POST /__answer { content?: string, status?: number }   the next answer
 *   POST /chat/completions                                  the queued answer, or the default plan
 *   GET  /__log    every completion request (model, messages, whether a key came)
 *
 * `node tests/fakeMetaAi.js 5097` runs it for an API started with
 * META_AI_BASE_URL=http://127.0.0.1:5097 and any MODEL_API_KEY.
 */

const http = require('node:http');

const DAY = 24 * 3600 * 1000;
/** "YYYY-MM-DDTHH:mm" `days` from now, at `hh`:00 (read as the event's local time). */
const local = (days, hh) => `${new Date(Date.now() + days * DAY).toISOString().slice(0, 10)}T${String(hh).padStart(2, '0')}:00`;

function defaultPlan() {
  return {
    name: 'Baku Green AI Hackathon',
    tagline: '48 hours to build AI for a cleaner city',
    description: 'A weekend for students and young engineers to build AI tools for energy, transport and waste.\n\nForm a team, build with mentors, present to the jury.',
    category: 'hackathon',
    template: 'hackathon24',
    format: 'offline',
    city: 'Baku',
    max_participants: 200,
    min_team_size: 2,
    team_size_limit: 4,
    registration_end: local(25, 23),
    start_date: local(30, 10),
    submission_deadline: local(32, 8),
    end_date: local(32, 18),
    tracks: [
      { name: 'Energy', description: 'Smarter use of power at home and at work.' },
      { name: 'Transport', description: 'Moving around the city with less traffic.' },
      { name: 'Waste', description: 'Sorting, recycling and less waste.' },
    ],
    prizes: [
      { kind: 'place', name: 'First place', value: '3000 AZN' },
      { kind: 'place', name: 'Second place', value: '1500 AZN' },
      { kind: 'place', name: 'Third place', value: '500 AZN' },
      { kind: 'special', name: 'Best use of AI', value: 'Mentorship' },
    ],
    criteria: [
      { name: 'Impact', description: 'How much it helps the city', weight: 2, max_score: 10 },
      { name: 'Technical execution', description: 'Does it work', weight: 1.5, max_score: 10 },
      { name: 'Presentation', description: 'How clearly the team explains it', weight: 1, max_score: 10 },
    ],
    faq: [{ q: 'Who can join?', a: 'Students and young professionals aged 16 and over.' }],
    rules: 'Code written during the event only. Be kind.',
  };
}

function startFakeMetaAi({ port = 0 } = {}) {
  const queue = [];
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
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { json = {}; }
      if (url.pathname === '/__log') return send(200, log);
      if (url.pathname === '/__answer' && req.method === 'POST') {
        queue.push(json);
        return send(204);
      }
      if (url.pathname !== '/chat/completions' || req.method !== 'POST') return send(404, { error: 'Not Found' });
      log.push({ model: json.model, messages: json.messages, maxTokens: json.max_tokens, auth: Boolean(req.headers.authorization), at: Date.now() });
      const next = queue.shift();
      if (next?.status && next.status !== 200) return send(next.status, { error: { message: 'fake failure' } });
      const content = next?.content ?? JSON.stringify(defaultPlan());
      return send(200, {
        id: `chatcmpl-${log.length}`,
        model: json.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startFakeMetaAi, defaultPlan };

if (require.main === module) {
  const port = Number(process.argv[2]) || 5097;
  startFakeMetaAi({ port }).then((ai) => console.log(`[fake-meta-ai] ${ai.base}`));
}
