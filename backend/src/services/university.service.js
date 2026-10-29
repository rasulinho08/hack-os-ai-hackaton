/**
 * @file university.service.js
 * @description University search for the registration form (decision E4).
 *
 * Azerbaijan: the official list of the Ministry of Science and Education
 * (edu.gov.az, all four categories, branches included), shown first and
 * searchable by its Azerbaijani name, English name and usual abbreviation.
 * Everywhere else: the open university-domains-list dataset (MIT licence,
 * data/universities/LICENSE-world.txt). Both ship with the API and are
 * searched in memory, so the form never waits on a third-party service.
 */

const path = require('path');
const { transliterate } = require('./eventTemplates');

const DIR = path.resolve(__dirname, '..', '..', 'data', 'universities');
const norm = (s) => transliterate(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();

let AZ = null;
let WORLD = null;

function load() {
  if (AZ) return;
  AZ = require(path.join(DIR, 'az.json')).items.map((u) => ({
    id: u.id,
    name: u.name,
    country: 'AZ',
    keys: [u.name, ...(u.alt || [])].map(norm),
  }));
  WORLD = require(path.join(DIR, 'world.json')).items.map(([name, country], i) => ({
    id: `w-${i}`,
    name,
    country,
    key: norm(name),
  }));
}

function score(keys, q) {
  const short = q.length < 4;
  let best = 0;
  for (const k of keys) {
    if (k === q) return 3;
    const words = k.split(' ');
    if (k.startsWith(q) || words.some((w) => w.startsWith(q))) best = Math.max(best, 2);
    else if (!short && k.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * @param {string} q
 * @param {{ country?: string, limit?: number }} [opts]
 * @returns {Array<{ id: string, name: string, country: string }>}
 */
function search(q, { country = null, limit = 20 } = {}) {
  load();
  const cc = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
  const n = Math.min(Math.max(Number(limit) || 20, 1), 60);
  const query = norm(q);
  const pick = ({ u }) => ({ id: u.id, name: u.name, country: u.country });

  // Nothing typed yet: the Azerbaijani list in full, or the first of a country.
  if (!query) {
    if (!cc || cc === 'AZ') return AZ.map((u) => pick({ u }));
    return WORLD.filter((u) => u.country === cc).slice(0, n).map((u) => pick({ u }));
  }

  const out = [];
  if (!cc || cc === 'AZ') {
    AZ.map((u) => ({ u, s: score(u.keys, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .forEach((x) => out.push(pick(x)));
  }
  if (cc !== 'AZ' && query.length >= 2) {
    const hits = [];
    for (const u of WORLD) {
      if (cc && u.country !== cc) continue;
      const s = score([u.key], query);
      if (s > 0) hits.push({ u, s });
    }
    hits.sort((a, b) => b.s - a.s || a.u.name.length - b.u.name.length);
    hits.slice(0, n).forEach((x) => out.push(pick(x)));
  }
  return out.slice(0, n);
}

module.exports = { search };
