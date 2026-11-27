// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../drain-model.js");

const min = (a) => Math.min(...a);
const last = (a) => a[a.length - 1];

test("no load at home alone or asleep", () => {
  assert.equal(M.socialLoad("home", 0, false), 0);
  assert.equal(M.socialLoad("sleep", 0, false), 0);
  assert.ok(M.socialLoad("out", 0, false) > 0);
});

test("crowd load saturates: 40 people is far less than 10x 4 people", () => {
  const four = M.socialLoad("out", 4, false);
  const forty = M.socialLoad("out", 40, false);
  assert.ok(forty > four);
  assert.ok(forty / four < 4);
});

test("close friends cost less than strangers", () => {
  assert.ok(M.socialLoad("out", 3, true) < M.socialLoad("out", 3, false));
});

test("quiet day barely drains anyone", () => {
  for (const p of Object.keys(M.PERSONAS)) {
    const r = M.simulateProposed(M.PRESET_DAYS.quiet.segments, p);
    assert.ok(min(r.levels) > 80, `${p} dropped to ${min(r.levels)}`);
  }
});

test("office day: introvert < ambivert < extrovert, all in a believable range", () => {
  const lows = {};
  for (const p of Object.keys(M.PERSONAS)) lows[p] = min(M.simulateProposed(M.PRESET_DAYS.office.segments, p).levels);
  assert.ok(lows.introvert < lows.ambivert && lows.ambivert < lows.extrovert, JSON.stringify(lows));
  assert.ok(lows.introvert > 10 && lows.introvert < 45);
  assert.ok(lows.ambivert > 35 && lows.ambivert < 65);
  assert.ok(lows.extrovert > 60 && lows.extrovert < 90);
});

test("party drains an introvert hard but not to zero", () => {
  const r = M.simulateProposed(M.PRESET_DAYS.party.segments, "introvert");
  assert.ok(min(r.levels) > 0 && min(r.levels) < 30, String(min(r.levels)));
});

test("sleep brings everyone mostly back by morning", () => {
  for (const day of ["office", "party"]) {
    for (const p of Object.keys(M.PERSONAS)) {
      const r = M.simulateProposed(M.PRESET_DAYS[day].segments, p);
      assert.ok(last(r.levels) > 70, `${day}/${p} ended at ${last(r.levels)}`);
    }
  }
});

test("friends over at home drains instead of charging", () => {
  const segs = M.PRESET_DAYS.dinner.segments;
  const r = M.simulateProposed(segs, "introvert");
  const dinnerStart = 12 * 60, dinnerEnd = 16 * 60 - 1;
  assert.ok(r.levels[dinnerEnd] < r.levels[dinnerStart]);
});

test("current formula empties on a single grocery run", () => {
  const r = M.simulateCurrent(M.PRESET_DAYS.quiet.segments);
  assert.equal(min(r.levels), 0);
});

test("levels always stay within 0..100", () => {
  for (const day of Object.values(M.PRESET_DAYS)) {
    for (const p of Object.keys(M.PERSONAS)) {
      const r = M.simulateProposed(day.segments, p, { params: { maxDrainPerHour: 40 } });
      for (const v of r.levels) assert.ok(v >= 0 && v <= 100);
    }
  }
});
