/**
 * A small ZIP reader for the tests, enough to check what src/utils/zip.js
 * wrote: central directory → local header → data, with CRC and UTF-8 names
 * checked on the way.
 */

const assert = require('node:assert/strict');
const zlib = require('zlib');
const { crc32 } = require('../src/utils/zip');

/** @returns {Record<string, Buffer>} every entry by name */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory present');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const raw = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    assert.equal(flags & 0x0800, 0x0800, 'names flagged UTF-8');
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, raw);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out[name] = data;
    p += 46 + nameLen;
  }
  return out;
}

module.exports = { unzip };
