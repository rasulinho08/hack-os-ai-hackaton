/**
 * The certificate PDF: one A4 landscape page in the event's language, titled
 * with the recipient and the event, for every kind; Azerbaijani ordinals
 * follow the vowel of the number word.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { renderCertificatePdf, azOrdinal, enOrdinal, KINDS, WORDS } = require('../src/services/certificatePdf');

const base = {
  name: 'Aysel Hüseynova',
  event: 'Bakı Hakatonu 2026',
  team: 'Xəzər Kodçuları',
  project: 'MedBot',
  code: 'HX7K-2MQP-9TRW',
  verifyUrl: 'https://hack-os.app/verify/HX7K-2MQP-9TRW',
  issuedAt: '2026-04-27T15:00:00Z',
  signer: { name: 'Rəşad Məmmədov', title: 'Baş təşkilatçı' },
};

test('Azerbaijani and English ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 60, 90, 100].map(azOrdinal),
    ['1-ci', '2-ci', '3-cü', '4-cü', '5-ci', '6-cı', '7-ci', '8-ci', '9-cu', '10-cu', '20-ci', '30-cu', '40-cı', '60-cı', '90-cı', '100-cü']);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(enOrdinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
});

test('every kind renders one landscape A4 page in each language', async () => {
  for (const lang of ['az', 'en', 'ru']) {
    for (const kind of KINDS) {
      const bytes = await renderCertificatePdf({ ...base, lang, kind, place: 2, prize: 'Ən yaxşı dizayn' });
      const doc = await PDFDocument.load(bytes);
      assert.equal(doc.getPageCount(), 1);
      const { width, height } = doc.getPage(0).getSize();
      assert.ok(Math.abs(width - 841.89) < 1 && Math.abs(height - 595.28) < 1, `${lang}/${kind} size ${width}×${height}`);
      assert.equal(doc.getTitle(), `${WORDS[lang].title} · ${base.name} · ${base.event}`);
      assert.equal(doc.getSubject(), WORDS[lang].sub[kind]);
    }
  }
});

test('the sentences read right without case endings on names', () => {
  const c = { ...base, place: 3, prize: 'Ən yaxşı dizayn' };
  assert.equal(WORDS.az.body.winner(c), '“Bakı Hakatonu 2026” tədbirində Xəzər Kodçuları komandası ilə 3-cü yerə layiq görülmüşdür.');
  assert.equal(WORDS.az.body.participation({ ...c, team: null }), '“Bakı Hakatonu 2026” tədbirində iştirak etmişdir.');
  assert.equal(WORDS.en.body.winner(c), 'won 3rd place at Bakı Hakatonu 2026 with team Xəzər Kodçuları.');
  assert.equal(WORDS.ru.body.special(c), 'награда «Ən yaxşı dizayn» на мероприятии «Bakı Hakatonu 2026».');
});

test('an unknown kind is refused, an unknown language falls back to Azerbaijani', async () => {
  await assert.rejects(renderCertificatePdf({ ...base, kind: 'hero' }), /kind/);
  const doc = await PDFDocument.load(await renderCertificatePdf({ ...base, kind: 'mentor', lang: 'de' }));
  assert.equal(doc.getSubject(), WORDS.az.sub.mentor);
});

test('dates are the event\'s calendar days, in its time zone', () => {
  const { dateRange } = require('../src/services/certificatePdf');
  // 00:30 on 20 October in Baku is still 19 October in UTC.
  const start = '2026-10-19T20:30:00Z';
  const end = '2026-10-20T16:00:00Z';
  assert.equal(dateRange('en', start, end, 'Asia/Baku'), '20 October 2026');
  assert.equal(dateRange('az', start, '2026-10-21T16:00:00Z', 'Asia/Baku'), '20–21 oktyabr 2026');
  assert.equal(dateRange('en', start, end), '19–20 October 2026', 'without a zone: UTC, as before');
  assert.equal(dateRange('ru', '2026-10-31T21:00:00Z', '2026-11-02T10:00:00Z', 'Asia/Baku'), '1–2 ноября 2026');
});

test('a ranked place without a prize is an achievement, not a win', () => {
  const c = { ...base, place: 2, prize: '' };
  assert.equal(WORDS.en.body.winner(c), 'took 2nd place at Bakı Hakatonu 2026 with team Xəzər Kodçuları.');
  assert.equal(WORDS.en.body.winner({ ...c, prize: 'Grand prize' }), 'won 2nd place at Bakı Hakatonu 2026 with team Xəzər Kodçuları.');
  for (const lang of ['az', 'en', 'ru']) assert.ok(WORDS[lang].sub.placed, lang);
  assert.notEqual(WORDS.az.sub.placed, WORDS.az.sub.winner);
});
