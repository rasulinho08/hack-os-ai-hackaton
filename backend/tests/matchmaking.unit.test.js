/**
 * Matchmaking: skills are read whatever shape they come in, and suggestions
 * are ranked by what each side brings the other — a wanted skill counts
 * twice, a skill the other side lacks once — with the reasons attached.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { skillList, fit, rankCandidates, rankTeams } = require('../src/services/matchmaking.service');

test('skills are read from JSON arrays, JSON text and comma lists, without duplicates', () => {
  assert.deepEqual(skillList(['React', ' react ', 'Node']), ['React', 'Node']);
  assert.deepEqual(skillList('["Python","SQL"]'), ['Python', 'SQL']);
  assert.deepEqual(skillList('Figma, UX ,Figma'), ['Figma', 'UX']);
  assert.deepEqual(skillList(null), []);
  assert.equal(skillList(Array.from({ length: 50 }, (_, i) => `s${i}`)).length, 30);
});

test('a wanted skill counts twice, a new one once, a shared one not at all', () => {
  const f = fit(['React', 'Python', 'Docker'], ['Python'], ['React']);
  assert.equal(f.score, 2 + 1);
  assert.deepEqual(f.matched, ['React']);
  assert.deepEqual(f.fresh, ['Docker']);
});

test('people are ranked for a team by what they bring, those looking first on a tie', () => {
  const people = [
    { userId: 1, name: 'Aysel', skills: ['Python'], looking: false },
    { userId: 2, name: 'Rauf', skills: ['React', 'Figma'], looking: false },
    { userId: 3, name: 'Leyla', skills: ['Figma'], looking: true },
  ];
  const ranked = rankCandidates(['Python'], ['React'], people);
  assert.deepEqual(ranked.map((p) => p.userId), [2, 3, 1]);
  assert.deepEqual(ranked[0].matched, ['React']);
  assert.deepEqual(ranked[0].brings, ['Figma']);
});

test('teams with room are ranked for a person, recruiting ones and those with more room first on a tie', () => {
  const teams = [
    { id: 10, name: 'Alpha', skills: ['React'], wantedSkills: [], recruiting: false, openSpots: 1 },
    { id: 11, name: 'Beta', skills: ['Python'], wantedSkills: ['React'], recruiting: true, openSpots: 2 },
    { id: 12, name: 'Gamma', skills: ['Go'], wantedSkills: [], recruiting: false, openSpots: 3 },
  ];
  const ranked = rankTeams(['React'], teams);
  assert.equal(ranked[0].id, 11, 'the team that asked for React');
  assert.deepEqual(ranked[0].matched, ['React']);
  assert.equal(ranked[1].id, 12, 'React is new to Gamma');
  assert.equal(ranked[2].id, 10, 'Alpha already has React');
});
