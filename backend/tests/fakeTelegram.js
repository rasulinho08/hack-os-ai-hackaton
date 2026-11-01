/**
 * A stand-in for the Telegram Bot API, for tests: it answers the methods the
 * API uses and remembers every call, so a test can check what was sent
 * without a real bot or network access.
 *
 *   const tg = await startFakeTelegram();   // tg.base → TELEGRAM_API_BASE
 *   ... tg.calls('sendMessage') ...
 *   tg.close();
 *
 * Chat ids listed in `blocked` answer 403 ("bot was blocked by the user").
 * GET /__admin/<chat>/<yes|no> (or /__admin/<chat>:<user>/<yes|no>) sets
 * what getChatMember answers; getChat of "@missing…" is "chat not found".
 */

const http = require('node:http');

function startFakeTelegram({ port = 0, botUsername = 'hackos_test_bot', blocked = [] } = {}) {
  const log = [];
  const admins = new Map(); // chat id → bot is admin there
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // Test hooks: read and clear what was sent, mark admin rights.
      if (req.url === '/__log') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(log)); }
      if (req.url === '/__reset') { log.length = 0; res.writeHead(204); return res.end(); }
      const adminHook = req.url.match(/^\/__admin\/(-?\d+(?::\d+)?)\/(yes|no)$/);
      if (adminHook) { admins.set(adminHook[1], adminHook[2] === 'yes'); res.writeHead(204); return res.end(); }
      const m = req.url.match(/^\/bot([^/]+)\/(\w+)/);
      let params = {};
      try { params = body ? JSON.parse(body) : {}; } catch { params = {}; }
      const method = m ? m[2] : '';
      log.push({ method, token: m ? m[1] : null, params, at: Date.now() });
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
      if (blocked.includes(String(params.chat_id))) {
        return send(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
      }
      switch (method) {
        case 'getMe':
          return send(200, { ok: true, result: { id: 42, is_bot: true, username: botUsername } });
        case 'sendMessage':
          return send(200, { ok: true, result: { message_id: log.length, chat: { id: params.chat_id }, text: params.text } });
        case 'getChat':
          if (/^@missing/i.test(String(params.chat_id))) return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
          return send(200, { ok: true, result: { id: params.chat_id === '@public_channel' ? -100777 : params.chat_id, type: 'channel', title: 'Public Channel', username: 'public_channel' } });
        case 'getChatMember': {
          // "<chat>:<user>" decides for one member, "<chat>" for everyone in it; default: administrator.
          const own = admins.get(`${params.chat_id}:${params.user_id}`);
          const all = admins.get(String(params.chat_id));
          const isAdmin = own !== undefined ? own : all !== false;
          return send(200, { ok: true, result: { status: isAdmin ? 'administrator' : 'left', can_post_messages: true } });
        }
        case 'setWebhook':
        case 'deleteMessage':
          return send(200, { ok: true, result: true });
        default:
          return send(200, { ok: true, result: true });
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        log,
        calls: (method) => log.filter((c) => c.method === method),
        setAdmin: (chatId, isAdmin) => admins.set(String(chatId), isAdmin),
        reset: () => { log.length = 0; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeTelegram };

// `node tests/fakeTelegram.js 5099` runs it on its own, for an API started
// with TELEGRAM_API_BASE=http://127.0.0.1:5099 (the e2e suites read /__log).
if (require.main === module) {
  const port = Number(process.argv[2]) || 5099;
  startFakeTelegram({ port, blocked: ['999000999'] }).then((tg) => console.log(`[fake-telegram] ${tg.base}`));
}
