/**
 * A stand-in mail server for tests: it speaks just enough SMTP for
 * nodemailer and remembers every message, so a suite can check what the API
 * e-mailed without a mail provider or network access.
 *
 *   node tests/fakeSmtp.js 2525      SMTP on 2525, its log on http://127.0.0.1:2526/__log
 *
 * Start the API with MAIL_PROVIDER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=2525
 * SMTP_USER=x SMTP_PASS=x MAIL_FROM_EMAIL=noreply@hackos.test to use it.
 * Addresses listed in `reject` are refused at RCPT TO (550).
 */

const net = require('node:net');
const http = require('node:http');

function startFakeSmtp({ port = 0, httpPort = 0, reject = [] } = {}) {
  const messages = [];
  const smtp = net.createServer((sock) => {
    let mode = 'cmd';
    let buffer = '';
    let current = { from: null, to: [], data: '' };
    const send = (line) => sock.write(`${line}\r\n`);
    send('220 fake-smtp ready');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (mode === 'data') {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        current.data = buffer.slice(0, end).replace(/^\.\./gm, '.');
        buffer = buffer.slice(end + 5);
        const subject = (current.data.match(/^Subject: (.*)$/im) || [])[1] || '';
        messages.push({ ...current, subject, at: Date.now() });
        current = { from: null, to: [], data: '' };
        mode = 'cmd';
        send('250 2.0.0 queued');
      }
      let nl;
      while (mode === 'cmd' && (nl = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') { send('250-fake-smtp'); send('250-AUTH PLAIN'); send('250 8BITMIME'); }
        else if (verb === 'HELO') send('250 fake-smtp');
        else if (verb === 'AUTH') send('235 2.7.0 accepted');
        else if (verb === 'MAIL') { current.from = (line.match(/<([^>]*)>/) || [])[1] || null; send('250 ok'); }
        else if (verb === 'RCPT') {
          const to = (line.match(/<([^>]*)>/) || [])[1] || '';
          if (reject.includes(to.toLowerCase())) send('550 5.1.1 no such user');
          else { current.to.push(to); send('250 ok'); }
        } else if (verb === 'DATA') { mode = 'data'; send('354 go ahead'); }
        else if (verb === 'RSET') { current = { from: null, to: [], data: '' }; send('250 ok'); }
        else if (verb === 'QUIT') { send('221 bye'); sock.end(); }
        else send('250 ok');
        if (mode === 'data' && buffer.includes('\r\n.\r\n')) sock.emit('data', Buffer.alloc(0));
      }
    });
  });
  const web = http.createServer((req, res) => {
    if (req.url === '/__log') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(messages)); }
    if (req.url === '/__reset') { messages.length = 0; res.writeHead(204); return res.end(); }
    res.writeHead(404); return res.end();
  });
  return new Promise((resolve) => {
    smtp.listen(port, '127.0.0.1', () => {
      web.listen(httpPort, '127.0.0.1', () => {
        resolve({
          port: smtp.address().port,
          logUrl: `http://127.0.0.1:${web.address().port}/__log`,
          messages,
          close: () => Promise.all([new Promise((r) => smtp.close(r)), new Promise((r) => web.close(r))]),
        });
      });
    });
  });
}

module.exports = { startFakeSmtp };

if (require.main === module) {
  const port = Number(process.argv[2]) || 2525;
  startFakeSmtp({ port, httpPort: port + 1, reject: ['bounce@e2e.test'] })
    .then((s) => console.log(`[fake-smtp] smtp://127.0.0.1:${s.port} log ${s.logUrl}`));
}
