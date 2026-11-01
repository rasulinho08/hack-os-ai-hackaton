/**
 * The background job that issues an event's certificates: a retry after a
 * failed first attempt still sends the e-mails and the announcement, although
 * the certificates were already saved and there is nothing new to issue.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const calls = [];

function stub(rel, exports) {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

stub('services/certificate.service', {
  issue: async () => ({ issued: 0, existing: 3, needsResults: false }),
  queueEmails: async (eventId, ids) => { calls.push(['emails', eventId, ids]); return { queued: 2 }; },
});
stub('services/autoAnnouncementPlanner', {
  trigger: async (eventId, key) => { calls.push(['announce', eventId, key]); },
});

const handlers = {};
require('../src/jobs/certificateJobs').register({ jobs: { register: (type, fn) => { handlers[type] = fn; } } });
const run = handlers['certificates.issue'];

test('nothing new on a first run: no e-mails, no announcement', async () => {
  calls.length = 0;
  await run({ eventId: 7 }, { attempts: 1 });
  assert.deepEqual(calls, []);
});

test('a retry with nothing new still queues the unsent e-mails and the announcement', async () => {
  calls.length = 0;
  await run({ eventId: 7 }, { attempts: 2 });
  assert.deepEqual(calls, [['emails', 7, null], ['announce', 7, 'certs']]);
});
