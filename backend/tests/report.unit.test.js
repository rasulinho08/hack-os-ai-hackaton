/**
 * The pure parts of the new features: the report's breakdowns (small groups
 * folded away, too few answers hidden), its days axis, the PDF drawn from
 * edge-case data in every language; the profile handle rules; the
 * directory's reading of a query string.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { breakdown, everyDay } = require('../src/services/report.service');
const { renderReportPdf, rangeText } = require('../src/services/reportPdf');
const { handleFrom, checkHandle } = require('../src/services/profile.service');
const { parseQuery } = require('../src/services/directory.service');

test('breakdown: case and spacing count together; groups under 3 become "Other"', () => {
  const b = breakdown(['ADA', 'ada ', 'ADA', 'BDU', 'BDU', 'BDU', 'Xəzər', null, '', { name: 'BDU' }]);
  assert.equal(b.total, 8);
  assert.deepEqual(b.items.map((x) => [x.label, x.n]), [['BDU', 4], ['ADA', 3]]);
  assert.equal(b.other, 1);
  assert.equal(b.hidden, false);
});

test('breakdown: fewer than five answers are not shown at all', () => {
  const b = breakdown(['A', 'A', 'A', 'B']);
  assert.equal(b.hidden, true);
  assert.deepEqual(b.items, []);
  assert.equal(breakdown([]).hidden, false);
});

test('breakdown: at most eight named groups, the rest in "Other"', () => {
  const values = [];
  for (let i = 0; i < 10; i += 1) for (let k = 0; k < 3 + i; k += 1) values.push(`U${i}`);
  const b = breakdown(values);
  assert.equal(b.items.length, 8);
  assert.equal(b.items[0].label, 'U9');
  assert.equal(b.other, 3 + 4);
});

test('every day between the first and last registration, zeros included', () => {
  assert.deepEqual(everyDay([{ day: '2026-10-01', n: 2 }, { day: '2026-10-03', n: 1 }]), [
    { day: '2026-10-01', n: 2 }, { day: '2026-10-02', n: 0 }, { day: '2026-10-03', n: 1 },
  ]);
  assert.deepEqual(everyDay([]), []);
});

test('date ranges in the event’s zone and language', () => {
  assert.equal(rangeText('en', '2026-10-18T06:00:00Z', '2026-10-20T14:00:00Z', 'Asia/Baku'), '18–20 October 2026');
  assert.equal(rangeText('az', '2026-10-30T06:00:00Z', '2026-11-02T14:00:00Z', 'Asia/Baku'), '30 oktyabr – 2 noyabr 2026');
  assert.equal(rangeText('ru', '2026-10-18T22:00:00Z', null, 'Asia/Baku'), '19 октября 2026');
});

const BASE = {
  generatedAt: '2026-10-23T10:00:00Z',
  event: {
    name: 'Hackathon with a very long name that goes on and on 🚀 to test wrapping across two lines of the cover',
    tagline: null, category: 'hackathon', format: 'online', city: null, country: null, venue: null,
    startDate: '2026-10-18T06:00:00Z', endDate: '2026-10-19T14:00:00Z', timezone: 'Asia/Baku', organiser: null, language: 'az',
  },
  branding: { branded: false, colour: null, hasLogo: false },
  funnel: { registrations: 0, approved: 0, waitlisted: 0, pending: 0, rejected: 0, checkedIn: null, inTeams: 0, teams: 0, projects: 0 },
  registrationsByDay: [],
  timeline: [],
  demographics: {},
  judging: { judges: 0, criteria: [], reviews: 0, projectsReviewed: 0, projects: 0, reviewsPerProject: null },
  winners: { published: false, items: [] },
  feedback: { nps: { responses: 0, score: null, promoters: 0, passives: 0, detractors: 0 }, rating: { responses: 0, average: null } },
  sponsors: [],
  tracks: [],
  privacy: { minGroup: 3, minAnswers: 5 },
  logo: null,
};

test('the PDF draws an empty event in every language', async () => {
  for (const language of ['az', 'en', 'ru']) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await renderReportPdf({ ...BASE, language });
    // eslint-disable-next-line no-await-in-loop
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 2);
    assert.equal(doc.getTitle().startsWith(language === 'az' ? 'Tədbirdən' : language === 'en' ? 'Post-event' : 'Итоговый'), true);
  }
});

test('the PDF draws a full, branded event with long lists across pages', async () => {
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const bytes = await renderReportPdf({
    ...BASE,
    language: 'en',
    branding: { branded: true, colour: '#0f766e', hasLogo: false },
    funnel: { registrations: 1200, approved: 900, waitlisted: 100, pending: 50, rejected: 150, checkedIn: 800, inTeams: 850, teams: 220, projects: 190 },
    registrationsByDay: many(60, (i) => ({ day: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), n: (i * 7) % 40 })),
    timeline: [{ key: 'registration_start', at: '2026-08-01T06:00:00Z' }, { key: 'start', at: '2026-10-18T06:00:00Z' }, { key: 'results', at: '2026-10-19T15:00:00Z' }],
    demographics: {
      university: { total: 900, items: many(8, (i) => ({ label: `University number ${i} with a long official name`, key: `u${i}`, n: 100 - i })), other: 128, hidden: false },
      experience: { total: 4, items: [], other: 0, hidden: true },
      gender: { total: 300, items: [{ label: 'female', key: 'female', n: 150 }, { label: 'male', key: 'male', n: 140 }], other: 10, hidden: false },
      country: { total: 30, items: [{ label: 'AZ', key: 'az', n: 25 }, { label: 'TR', key: 'tr', n: 5 }], other: 0, hidden: false },
    },
    judging: { judges: 12, criteria: many(6, (i) => ({ name: `Criterion ${i}`, weight: i + 1, maxScore: 10 })), reviews: 600, projectsReviewed: 190, projects: 190, reviewsPerProject: 3.2 },
    winners: { published: true, teamsRanked: 190, items: many(12, (i) => ({ prize: `Prize ${i}`, kind: i < 3 ? 'place' : 'special', position: i < 3 ? i + 1 : null, value: i % 2 ? '1 000 AZN' : null, place: i + 1, team: `Team ${i}`, project: `Project ${i} 🎉` })) },
    feedback: { nps: { responses: 300, score: 42, promoters: 180, passives: 66, detractors: 54 }, rating: { responses: 120, average: 4.4 } },
    sponsors: many(9, (i) => ({ name: `Sponsor ${i}`, tier: ['platinum', 'gold', 'silver', 'bronze', 'partner', null][i % 6] })),
    tracks: many(4, (i) => ({ name: `Track ${i}`, teams: 50 + i })),
  });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 4, `${doc.getPageCount()} pages`);
});

test('profile handles: from a name, and the rules', () => {
  assert.equal(handleFrom('Aysel Məmmədova'), 'aysel-memmedova');
  assert.equal(handleFrom('Шамиль Ёлкин'), 'shamil-elkin');
  assert.equal(handleFrom('Ə'), '');
  assert.equal(handleFrom('x'.repeat(50)).length, 30);
  assert.deepEqual(checkHandle(' Aysel-M '), { handle: 'aysel-m' });
  for (const bad of ['ab', 'a--b', '-ab', 'ab-', 'a b', 'admin', 'x'.repeat(31)]) assert.ok(checkHandle(bad).error, bad);
});

test('directory query: unknown values dropped, numbers clamped, text trimmed', () => {
  assert.deepEqual(parseQuery({}), { status: null, format: null, city: null, q: null, page: 1, limit: 12 });
  assert.deepEqual(parseQuery({ status: 'OPEN', format: 'Hybrid', city: '  Bakı ', q: ' ai   hack ', page: '3', limit: '500' }), {
    status: 'open', format: 'hybrid', city: 'Bakı', q: 'ai hack', page: 3, limit: 48,
  });
  assert.equal(parseQuery({ status: 'drafts', format: 'space' }).status, null);
  assert.equal(parseQuery({ page: ['2', '9'] }).page, 2);
  assert.equal(parseQuery({ q: 'x'.repeat(500) }).q.length, 80);
});
