/*
 * Volt drain model (proposed) plus the current formula, for comparison.
 * Pure functions, no DOM. Works in the browser (window.VoltModel) and in Node (require).
 *
 * A day is a list of segments: { start, end, place, people, close }
 *   start/end : minutes from the start of the simulation (0 = 07:00 by default)
 *   place     : "home" | "out" | "sleep"
 *   people    : estimated people nearby (not raw Bluetooth devices)
 *   close     : true if they are close friends / family
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoltModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_PARAMS = {
    maxDrainPerHour: 9,      // % per hour at load 1.0 for an ambivert, above comfort
    outBaseLoad: 0.10,       // cost of just being out of the house
    crowdRef: 30,            // people count that gives a crowd load of 1.0
    crowdExponent: 0.6,      // < 1 means big crowds saturate
    closeFriendFactor: 0.6,  // close friends cost less energy
    lowBatteryBoost: 0.3,    // drain is up to 30% faster near 0%
    deferredShare: 0.4,      // share of drain that arrives later ("tired later")
    deferredMinutes: 90,     // time constant for the deferred fatigue
    sleepHalfLifeHours: 2,   // recharge half-life while asleep
    devicesPerPerson: 2      // used to turn Bluetooth devices into people
  };

  const PERSONAS = {
    introvert: { label: "Introvert", temperament: 1.4, comfort: 0.05, awakeHalfLifeHours: 2.5, cabinFever: false },
    ambivert:  { label: "Ambivert",  temperament: 1.0, comfort: 0.12, awakeHalfLifeHours: 3.0, cabinFever: false },
    extrovert: { label: "Extrovert", temperament: 0.7, comfort: 0.25, awakeHalfLifeHours: 3.5, cabinFever: true }
  };
  // Extroverts: after this many awake minutes alone, the recharge target drops.
  const CABIN_FEVER_AFTER_MIN = 360;
  const CABIN_FEVER_TARGET = 80;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** Bluetooth devices (already RSSI-filtered, furniture removed) -> estimated people. */
  function peopleFromDevices(devices, params = DEFAULT_PARAMS) {
    return Math.max(0, devices) / params.devicesPerPerson;
  }

  /** Social load for one minute. 0 when home or asleep with nobody around. */
  function socialLoad(place, people, close, params = DEFAULT_PARAMS) {
    if (place !== "out" && people <= 0) return 0;
    let L = (place === "out" ? params.outBaseLoad : 0) +
            Math.pow(Math.max(0, people) / params.crowdRef, params.crowdExponent);
    if (close) L *= params.closeFriendFactor;
    return L;
  }

  /** Expand segments into one entry per minute. */
  function expand(segments) {
    const out = [];
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    for (const s of sorted) for (let m = s.start; m < s.end; m++) out.push(s);
    return out;
  }

  /**
   * Proposed model. Returns per-minute arrays: level, load, drainPerHour.
   * hrvFactor (optional) is a constant multiplier, normally 0.85–1.3.
   */
  function simulateProposed(segments, persona, opts = {}) {
    const params = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
    const p = typeof persona === "string" ? PERSONAS[persona] : persona;
    const hrvFactor = clamp(opts.hrvFactor ?? 1, 0.85, 1.3);
    let level = opts.startLevel ?? 90;
    let debt = 0, aloneAwake = 0;
    const levels = [], loads = [], drains = [];

    for (const seg of expand(segments)) {
      const L = socialLoad(seg.place, seg.people, seg.close, params);
      const excess = Math.max(0, L - p.comfort);
      const perHour = params.maxDrainPerHour * p.temperament * excess *
                      (1 + params.lowBatteryBoost * (1 - level / 100)) * hrvFactor;
      const perMin = perHour / 60;

      debt += params.deferredShare * perMin;
      const released = debt / params.deferredMinutes;
      debt -= released;
      level -= (1 - params.deferredShare) * perMin + released;

      if (excess === 0) {
        const asleep = seg.place === "sleep";
        const halfLife = asleep ? params.sleepHalfLifeHours : p.awakeHalfLifeHours;
        let target = 100;
        if (p.cabinFever && seg.place === "home" && seg.people <= 0) {
          aloneAwake++;
          if (aloneAwake > CABIN_FEVER_AFTER_MIN) target = CABIN_FEVER_TARGET;
        } else if (!asleep) {
          aloneAwake = 0;
        }
        level += (target - level) * (1 - Math.pow(0.5, 1 / (halfLife * 60)));
      } else {
        aloneAwake = 0;
      }

      level = clamp(level, 0, 100);
      levels.push(level); loads.push(L); drains.push(perHour);
    }
    return { levels, loads, drains };
  }

  /**
   * Today's formula from ContentView.swift, assuming a perfect Bluetooth count
   * of people × devicesPerDevice devices. Home or asleep = +5%/min.
   */
  function simulateCurrent(segments, opts = {}) {
    const devicesPerPerson = opts.devicesPerPerson ?? 2.5;
    let level = opts.startLevel ?? 90;
    const levels = [];
    for (const seg of expand(segments)) {
      if (seg.place === "out") level -= 1.0 + 0.2 * seg.people * devicesPerPerson;
      else level += 5.0;
      level = clamp(level, 0, 100);
      levels.push(level);
    }
    return { levels };
  }

  const H = 60;
  const PRESET_DAYS = {
    quiet: {
      label: "Quiet day",
      note: "Home all morning, 1-hour grocery run (~4 people) at 9:00, coffee with a close friend at 14:00, quiet evening, bed at 23:00.",
      segments: [
        { start: 0, end: 2 * H, place: "home", people: 0, close: false },
        { start: 2 * H, end: 3 * H, place: "out", people: 4, close: false },
        { start: 3 * H, end: 7 * H, place: "home", people: 0, close: false },
        { start: 7 * H, end: 8 * H, place: "out", people: 2, close: true },
        { start: 8 * H, end: 16 * H, place: "home", people: 0, close: false },
        { start: 16 * H, end: 24 * H, place: "sleep", people: 0, close: false }
      ]
    },
    office: {
      label: "Office day",
      note: "Train (~15), open office (~8), busy café lunch (~12), 2-hour meeting (6), commute home at 17:30, bed at 23:00.",
      segments: [
        { start: 0, end: 90, place: "home", people: 0, close: false },
        { start: 90, end: 135, place: "out", people: 15, close: false },
        { start: 135, end: 5 * H, place: "out", people: 8, close: false },
        { start: 5 * H, end: 6 * H, place: "out", people: 12, close: false },
        { start: 6 * H, end: 8 * H, place: "out", people: 6, close: false },
        { start: 8 * H, end: 630, place: "out", people: 8, close: false },
        { start: 630, end: 675, place: "out", people: 15, close: false },
        { start: 675, end: 16 * H, place: "home", people: 0, close: false },
        { start: 16 * H, end: 24 * H, place: "sleep", people: 0, close: false }
      ]
    },
    party: {
      label: "Big party",
      note: "Lazy Saturday at home, 30-minute ride (~10), 5-hour party (~40) from 19:30, short ride home, bed at 01:00.",
      segments: [
        { start: 0, end: 12 * H, place: "home", people: 0, close: false },
        { start: 12 * H, end: 750, place: "out", people: 10, close: false },
        { start: 750, end: 1050, place: "out", people: 40, close: false },
        { start: 1050, end: 18 * H, place: "out", people: 3, close: false },
        { start: 18 * H, end: 24 * H, place: "sleep", people: 0, close: false }
      ]
    },
    dinner: {
      label: "Friends over",
      note: "Normal workday, then 4 close friends over for dinner at home from 19:00 to 23:00. Home is not automatically recharging.",
      segments: [
        { start: 0, end: 90, place: "home", people: 0, close: false },
        { start: 90, end: 10 * H, place: "out", people: 6, close: false },
        { start: 10 * H, end: 12 * H, place: "home", people: 0, close: false },
        { start: 12 * H, end: 16 * H, place: "home", people: 4, close: true },
        { start: 16 * H, end: 24 * H, place: "sleep", people: 0, close: false }
      ]
    }
  };

  return {
    DEFAULT_PARAMS, PERSONAS, PRESET_DAYS,
    peopleFromDevices, socialLoad, expand, simulateProposed, simulateCurrent
  };
});
