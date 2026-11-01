/**
 * The in-memory ZIP writer: every entry comes back byte for byte when the
 * archive is read the way unzip reads it (central directory → local header →
 * data), names stay UTF-8, and unsafe names are cleaned.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { zip, crc32 } = require('../src/utils/zip');
const { unzip } = require('./unzip');

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('entries come back as written, compressed or stored', () => {
  const csv = 'name,team\nAysel Məmmədova,Kod Ustaları\n'.repeat(200);
  const tiny = 'x';
  const bin = Buffer.from([0, 1, 2, 3, 255, 254]);
  const archive = zip([
    { name: 'participants.csv', data: csv },
    { name: 'qeydlər/şəkil.txt', data: tiny },
    { name: 'raw.bin', data: bin },
  ]);
  const files = unzip(archive);
  assert.deepEqual(Object.keys(files), ['participants.csv', 'qeydlər/şəkil.txt', 'raw.bin']);
  assert.equal(files['participants.csv'].toString('utf8'), csv);
  assert.equal(files['qeydlər/şəkil.txt'].toString('utf8'), tiny);
  assert.deepEqual([...files['raw.bin']], [...bin]);
  assert.ok(archive.length < csv.length, 'the repetitive CSV is compressed');
});

test('names cannot climb out of the archive, and duplicates are refused', () => {
  const files = unzip(zip([{ name: '../../etc/passwd', data: 'no' }, { name: '\\windows\\x.txt', data: 'y' }]));
  assert.deepEqual(Object.keys(files), ['etc/passwd', 'windows/x.txt']);
  assert.throws(() => zip([{ name: 'a.csv', data: '1' }, { name: './a.csv', data: '2' }]), /duplicate/);
  assert.throws(() => zip([{ name: '../..', data: '1' }]), /empty/);
});

test('an empty archive is still a valid archive', () => {
  assert.deepEqual(unzip(zip([])), {});
});
