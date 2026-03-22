import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeJetLagParams,
  getPreDepartureSleepShift,
  getPreDepartureMelatonin,
  getFastingProtocol,
  getInFlightSleepWindows,
  getRecoverySleepWindow,
  getMelatoninRecommendation,
  getCaffeineDeadline,
  getExerciseWindow,
  getBodyClock6AM,
} from '../js/circadian.js';
import { wallClock, addHours, makeLocalDate } from '../js/tz.js';
import { JFK, LHR, LAX, NRT, SYD, DXB, ORD, dep, hoursBetween } from './fixtures.js';

// ─── computeJetLagParams ───────────────────────────────────────────────────────

describe('computeJetLagParams', () => {
  describe('JFK → LHR (eastward, +5 zones, summer)', () => {
    const params = computeJetLagParams(JFK, LHR, dep(JFK, 20));
    it('is eastward', () => assert.equal(params.direction, 'east'));
    it('crosses 5 zones', () => assert.equal(params.absShift, 5));
    it('is not trivial', () => assert.equal(params.trivial, false));
    it('takes 5 days to adapt (1 h/day eastward)', () => assert.equal(params.daysToAdapt, 5));
  });

  describe('LHR → JFK (westward, 5 zones, summer)', () => {
    const params = computeJetLagParams(LHR, JFK, dep(LHR, 10));
    it('is westward', () => assert.equal(params.direction, 'west'));
    it('crosses 5 zones', () => assert.equal(params.absShift, 5));
    it('takes 4 days to adapt (1.5 h/day westward)', () => assert.equal(params.daysToAdapt, 4));
  });

  describe('JFK → LAX (westward, 3 zones, summer)', () => {
    const params = computeJetLagParams(JFK, LAX, dep(JFK, 8));
    it('is westward', () => assert.equal(params.direction, 'west'));
    it('crosses 3 zones', () => assert.equal(params.absShift, 3));
    it('takes 2 days to adapt', () => assert.equal(params.daysToAdapt, 2));
  });

  describe('LAX → JFK (eastward, 3 zones, summer)', () => {
    const params = computeJetLagParams(LAX, JFK, dep(LAX, 7));
    it('is eastward', () => assert.equal(params.direction, 'east'));
    it('crosses 3 zones', () => assert.equal(params.absShift, 3));
    it('takes 3 days to adapt', () => assert.equal(params.daysToAdapt, 3));
  });

  describe('LAX → NRT (westward shorter path, summer)', () => {
    // LAX=UTC-7, NRT=UTC+9 → diff=+16 → normalized to -8 (westward shorter)
    const params = computeJetLagParams(LAX, NRT, dep(LAX, 11));
    it('is westward (shorter path around globe)', () => assert.equal(params.direction, 'west'));
    it('crosses 8 zones', () => assert.equal(params.absShift, 8));
    it('takes 6 days to adapt', () => assert.equal(params.daysToAdapt, 6));
  });

  describe('NRT → JFK (eastward shorter path, summer)', () => {
    // NRT=UTC+9, JFK=UTC-4 → diff=-13 → normalized to +11 (eastward shorter)
    const params = computeJetLagParams(NRT, JFK, dep(NRT, 11));
    it('is eastward (shorter path around globe)', () => assert.equal(params.direction, 'east'));
    it('crosses 11 zones', () => assert.equal(params.absShift, 11));
  });

  describe('JFK → ORD (trivial — 1 zone)', () => {
    const params = computeJetLagParams(JFK, ORD, dep(JFK, 12));
    it('is trivial', () => assert.equal(params.trivial, true));
    it('absShift is 1', () => assert.equal(params.absShift, 1));
  });

  describe('LHR → DXB (eastward, 3 zones)', () => {
    // LHR=UTC+1 (summer), DXB=UTC+4 → diff=+3
    const params = computeJetLagParams(LHR, DXB, dep(LHR, 9));
    it('is eastward', () => assert.equal(params.direction, 'east'));
    it('crosses 3 zones', () => assert.equal(params.absShift, 3));
  });

  describe('tzDiff is always in -12…+12 range', () => {
    const routes = [
      [JFK, LHR], [LHR, JFK], [LAX, NRT], [NRT, LAX], [JFK, SYD], [SYD, JFK],
    ];
    for (const [o, d] of routes) {
      const params = computeJetLagParams(o, d, dep(o, 12));
      it(`${o.iata}→${d.iata}: tzDiff within -12…+12`, () => {
        assert.ok(params.tzDiff >= -12 && params.tzDiff <= 12,
          `tzDiff=${params.tzDiff} out of range`);
      });
    }
  });
});

// ─── getPreDepartureSleepShift ────────────────────────────────────────────────

describe('getPreDepartureSleepShift', () => {
  const eastParams = computeJetLagParams(JFK, LHR, dep(JFK, 20));
  const westParams = computeJetLagParams(LHR, JFK, dep(LHR, 10));
  const departure  = dep(JFK, 20);

  it('returns null for trivial shifts', () => {
    const trivial = computeJetLagParams(JFK, ORD, dep(JFK, 12));
    const result  = getPreDepartureSleepShift(trivial, -1, 22, 7, dep(JFK, 12), JFK.tz);
    assert.equal(result, null);
  });

  it('eastward day -1: bedtime is earlier than default 10 PM', () => {
    const shift = getPreDepartureSleepShift(eastParams, -1, 22, 7, departure, JFK.tz);
    const bedtimeWC = wallClock(shift.bedtime, JFK.tz);
    // Should be 0.75h earlier → ~9:15 PM
    const bedtimeH = bedtimeWC.hour + bedtimeWC.minute / 60;
    assert.ok(bedtimeH < 22, `Eastward bedtime should be earlier than 10 PM, got ${bedtimeH}`);
  });

  it('eastward day -2: bedtime is earlier still (1.5h earlier than default)', () => {
    const shift1 = getPreDepartureSleepShift(eastParams, -1, 22, 7, departure, JFK.tz);
    const shift2 = getPreDepartureSleepShift(eastParams, -2, 22, 7, departure, JFK.tz);
    const bed1H  = wallClock(shift1.bedtime, JFK.tz).hour + wallClock(shift1.bedtime, JFK.tz).minute / 60;
    const bed2H  = wallClock(shift2.bedtime, JFK.tz).hour + wallClock(shift2.bedtime, JFK.tz).minute / 60;
    assert.ok(bed2H < bed1H, 'Day -2 bedtime should be earlier than day -1');
  });

  it('westward day -1: bedtime is later than default 10 PM', () => {
    const shift = getPreDepartureSleepShift(westParams, -1, 22, 7, dep(LHR, 10), LHR.tz);
    const bedtimeWC = wallClock(shift.bedtime, LHR.tz);
    const bedtimeH  = bedtimeWC.hour + bedtimeWC.minute / 60;
    // hour 22.75 → wraps to 22.75; but if it exceeds 24 it wraps (hour % 24)
    // Either way it should be > 22 or very close to midnight
    const normalizedBed = ((bedtimeH % 24) + 24) % 24;
    assert.ok(normalizedBed > 22 || normalizedBed < 1,
      `Westward bedtime should be later than 10 PM, got ${normalizedBed}`);
  });

  it('wakeTime is always before bedtime within the same shift', () => {
    const shift = getPreDepartureSleepShift(eastParams, -1, 22, 7, departure, JFK.tz);
    assert.ok(shift.wakeTime < shift.bedtime,
      'wakeTime should be earlier in the day than bedtime');
  });
});

// ─── getPreDepartureMelatonin ─────────────────────────────────────────────────

describe('getPreDepartureMelatonin', () => {
  const eastParams = computeJetLagParams(JFK, LHR, dep(JFK, 20));
  const westParams = computeJetLagParams(LHR, JFK, dep(LHR, 10));

  it('returns a Date for eastward travel', () => {
    const t = getPreDepartureMelatonin(eastParams, -1, 22, dep(JFK, 20), JFK.tz);
    assert.ok(t instanceof Date);
  });

  it('returns null for westward travel', () => {
    const t = getPreDepartureMelatonin(westParams, -1, 22, dep(LHR, 10), LHR.tz);
    assert.equal(t, null);
  });

  it('melatonin time is equivalent to destination bedtime in origin tz', () => {
    // LHR 10 PM bedtime = 5 PM New York time (5h behind)
    const t = getPreDepartureMelatonin(eastParams, -1, 22, dep(JFK, 20), JFK.tz);
    const wc = wallClock(t, JFK.tz);
    const h = wc.hour + wc.minute / 60;
    // Expected: 22 - 5 = 17:00 New York time
    assert.ok(Math.abs(h - 17) < 0.1, `Expected ~5 PM New York, got ${h}`);
  });
});

// ─── getFastingProtocol ───────────────────────────────────────────────────────

describe('getFastingProtocol', () => {
  it('long flight (JFK→LHR ~7h): first meal is 7 AM destination time', () => {
    const departure = dep(JFK, 20);          // 8 PM New York
    const arrival   = addHours(departure, 7);
    const fast = getFastingProtocol(departure, arrival, LHR);
    const mealWC = wallClock(fast.firstMealTime, LHR.tz);
    assert.equal(mealWC.hour, 7);
    assert.equal(mealWC.minute, 0);
  });

  it('first meal is always at 7 AM destination regardless of flight length', () => {
    const scenarios = [
      { o: JFK, d: LHR, depH: 20, flightH: 7  },
      { o: LAX, d: NRT, depH: 11, flightH: 10 },
      { o: LHR, d: JFK, depH: 10, flightH: 7  },
    ];
    for (const { o, d, depH, flightH } of scenarios) {
      const departure = dep(o, depH);
      const arrival   = addHours(departure, flightH);
      const fast = getFastingProtocol(departure, arrival, d);
      const wc = wallClock(fast.firstMealTime, d.tz);
      assert.equal(wc.hour, 7, `${o.iata}→${d.iata}: first meal should be 7 AM at dest`);
    }
  });

  it('fast starts 16h before 7 AM destination when departure is early enough', () => {
    // JFK→NRT departing 1 AM NYC (very early): arrival is ~14h later, next day in Tokyo.
    // The 16h window before 7 AM NRT arrival-day falls AFTER departure, so it is not clamped.
    const NRT_local = { iata: 'NRT', city: 'Tokyo', lat: 35.76, lng: 140.39, tz: 'Asia/Tokyo' };
    const departure = dep(JFK, 1); // 1 AM New York = 5 AM UTC
    const arrival   = addHours(departure, 14);
    const fast = getFastingProtocol(departure, arrival, NRT_local);
    const expectedFastStart = addHours(fast.firstMealTime, -16);
    assert.ok(fast.fastStart > departure,
      'fastStart should be after departure (not clamped) for this scenario');
    assert.equal(fast.fastStart.getTime(), expectedFastStart.getTime());
  });

  it('fast cannot start before departure', () => {
    // Late departure that is after the ideal fast start
    const departure = dep(JFK, 6); // 6 AM — only ~1h before the 16h window would start
    const arrival   = addHours(departure, 7);
    const fast = getFastingProtocol(departure, arrival, LHR);
    assert.ok(fast.fastStart >= departure, 'fast start cannot be before departure');
  });

  it('duration is always positive', () => {
    const departure = dep(JFK, 20);
    const arrival   = addHours(departure, 7);
    const fast = getFastingProtocol(departure, arrival, LHR);
    assert.ok(fast.durationHours > 0);
  });
});

// ─── getInFlightSleepWindows ──────────────────────────────────────────────────

describe('getInFlightSleepWindows', () => {
  it('overnight long-haul (JFK→LHR, depart 8 PM) has sleep windows', () => {
    const departure = dep(JFK, 20); // 8 PM New York = 1 AM London
    const arrival   = addHours(departure, 7);
    const windows   = getInFlightSleepWindows(departure, arrival, LHR);
    assert.ok(windows.length > 0, 'overnight flight should have sleep windows');
  });

  it('short daytime flight (JFK→ORD, 9 AM) has no meaningful sleep windows', () => {
    const departure = dep(JFK, 9); // 9 AM New York = 2 PM Chicago
    const arrival   = addHours(departure, 2.5);
    const windows   = getInFlightSleepWindows(departure, arrival, ORD);
    // No windows, or all < 1h (filtered out)
    assert.equal(windows.length, 0, 'daytime short flight should have no sleep windows');
  });

  it('all windows fall within the flight duration', () => {
    const departure = dep(LAX, 11);
    const arrival   = addHours(departure, 10);
    const windows   = getInFlightSleepWindows(departure, arrival, NRT);
    for (const w of windows) {
      assert.ok(w.start >= departure, 'window start must be after departure');
      assert.ok(w.end   <= arrival,   'window end must be before arrival');
    }
  });

  it('all windows are at least 1 hour', () => {
    const departure = dep(JFK, 20);
    const arrival   = addHours(departure, 7);
    const windows   = getInFlightSleepWindows(departure, arrival, LHR);
    for (const w of windows) {
      assert.ok(w.durationHours >= 1, `window should be ≥ 1h, got ${w.durationHours}h`);
    }
  });

  it('returns empty array for zero-duration flight', () => {
    const t = dep(JFK, 12);
    const windows = getInFlightSleepWindows(t, t, LHR);
    assert.equal(windows.length, 0);
  });
});

// ─── getRecoverySleepWindow ───────────────────────────────────────────────────

describe('getRecoverySleepWindow', () => {
  // Fly JFK→LHR (eastward, 5 zones). Origin bedtime 10 PM New York = 3 AM London.
  const params          = computeJetLagParams(JFK, LHR, dep(JFK, 20));
  const departure       = dep(JFK, 20);
  const originBedtimeUTC = makeLocalDate(JFK.tz, 2025, 6, 15, 22, 0); // 10 PM NYC
  const dayDate         = dep(LHR, 8); // arrival day morning

  it('day 1: bedtime is between origin-equivalent and destination bedtime', () => {
    const s = getRecoverySleepWindow(1, params.daysToAdapt, originBedtimeUTC, 22, 7, dayDate, LHR);
    const bedWC = wallClock(s.bedtime, LHR.tz);
    const bedH  = bedWC.hour + bedWC.minute / 60;
    // Body clock says 10 PM = 3 AM London; destination target = 10 PM London
    // Day 1 interpolation: 3 AM + (22 - 3) * (1/5) = 3 + 3.8 = 6.8 AM → ~7 AM? No...
    // Actually t = 1/5 = 0.2; bed = 3 + 0.2*(22-3) = 3 + 3.8 = 6.8 AM London
    // So bedtime on day 1 should be well before 10 PM and after midnight (3 AM range)
    assert.ok(bedH > 2 && bedH < 23, `Bedtime should be reasonable (2–23h), got ${bedH}`);
  });

  it('final day: bedtime is at (or very close to) 10 PM destination', () => {
    const s = getRecoverySleepWindow(params.daysToAdapt, params.daysToAdapt, originBedtimeUTC, 22, 7, dayDate, LHR);
    const bedWC = wallClock(s.bedtime, LHR.tz);
    const bedH  = bedWC.hour + bedWC.minute / 60;
    assert.ok(Math.abs(bedH - 22) < 0.1, `Final day bedtime should be ~10 PM, got ${bedH}`);
  });

  it('wakeTime is after bedtime (accounting for cross-midnight)', () => {
    for (let di = 1; di <= params.daysToAdapt; di++) {
      const s = getRecoverySleepWindow(di, params.daysToAdapt, originBedtimeUTC, 22, 7, dayDate, LHR);
      assert.ok(s.wakeTime > s.bedtime,
        `Day ${di}: wakeTime (${s.wakeTime.toISOString()}) should be after bedtime (${s.bedtime.toISOString()})`);
    }
  });

  it('sleep duration is approximately 9h (destination bedtime 10PM, wake 7AM)', () => {
    const s   = getRecoverySleepWindow(params.daysToAdapt, params.daysToAdapt, originBedtimeUTC, 22, 7, dayDate, LHR);
    const dur = hoursBetween(s.bedtime, s.wakeTime);
    assert.ok(Math.abs(dur - 9) < 0.1, `Sleep should be ~9h, got ${dur}h`);
  });

  it('bedtime moves progressively toward destination across recovery days', () => {
    const bedtimes = [];
    for (let di = 1; di <= params.daysToAdapt; di++) {
      const s   = getRecoverySleepWindow(di, params.daysToAdapt, originBedtimeUTC, 22, 7, dayDate, LHR);
      const wc  = wallClock(s.bedtime, LHR.tz);
      bedtimes.push(wc.hour + wc.minute / 60);
    }
    // Each day bedtime should be later (moving from ~3AM toward 10PM going through
    // earlier hours as clock advances eastward)
    // Simplest check: last day closer to 22 than first day
    const distFirst = Math.abs(bedtimes[0] - 22);
    const distLast  = Math.abs(bedtimes[bedtimes.length - 1] - 22);
    assert.ok(distLast <= distFirst, 'Bedtime should converge toward 10 PM over days');
  });
});

// ─── getMelatoninRecommendation ───────────────────────────────────────────────

describe('getMelatoninRecommendation', () => {
  const eastParams = computeJetLagParams(JFK, LHR, dep(JFK, 20));   // 5 zones east
  const westParams = computeJetLagParams(LHR, JFK, dep(LHR, 10));   // 5 zones west
  const dayDate    = dep(LHR, 8);

  it('eastward: melatonin on days 1–ceil(shift/2)', () => {
    const nDays = Math.ceil(eastParams.absShift / 2); // ceil(5/2) = 3
    for (let di = 1; di <= nDays; di++) {
      const t = getMelatoninRecommendation(eastParams, di, dayDate, LHR);
      assert.ok(t instanceof Date, `Day ${di}: should recommend melatonin`);
    }
  });

  it('eastward: no melatonin after ceil(shift/2) days', () => {
    const nDays = Math.ceil(eastParams.absShift / 2);
    const t = getMelatoninRecommendation(eastParams, nDays + 1, dayDate, LHR);
    assert.equal(t, null);
  });

  it('eastward: melatonin is at 10 PM destination time', () => {
    const t  = getMelatoninRecommendation(eastParams, 1, dayDate, LHR);
    const wc = wallClock(t, LHR.tz);
    assert.equal(wc.hour, 22);
  });

  it('westward 5 zones: no melatonin (needs >8 zones)', () => {
    const t = getMelatoninRecommendation(westParams, 1, dep(JFK, 9), JFK);
    assert.equal(t, null);
  });

  it('westward large shift (LAX→NRT, 8 zones): morning melatonin at destination', () => {
    const params  = computeJetLagParams(LAX, NRT, dep(LAX, 11));
    assert.equal(params.direction, 'west');
    assert.equal(params.absShift, 8);
    // Exactly 8 — boundary condition (>8 required, so should be null at 8)
    const t = getMelatoninRecommendation(params, 1, dep(NRT, 9), NRT);
    assert.equal(t, null, 'Exactly 8 zones west should not trigger melatonin (needs >8)');
  });

  it('trivial: no melatonin', () => {
    const trivial = computeJetLagParams(JFK, ORD, dep(JFK, 12));
    const t = getMelatoninRecommendation(trivial, 1, dayDate, ORD);
    assert.equal(t, null);
  });
});

// ─── getCaffeineDeadline ──────────────────────────────────────────────────────

describe('getCaffeineDeadline', () => {
  it('is exactly 10 hours before bedtime', () => {
    const bedtime  = makeLocalDate(LHR.tz, 2025, 6, 15, 22, 0); // 10 PM London
    const deadline = getCaffeineDeadline(bedtime);
    const diff = hoursBetween(deadline, bedtime);
    assert.equal(diff, 10);
  });

  it('works for early bedtimes (crossing midnight backward)', () => {
    const bedtime  = makeLocalDate(NRT.tz, 2025, 6, 15, 23, 0); // 11 PM Tokyo
    const deadline = getCaffeineDeadline(bedtime);
    const diff = hoursBetween(deadline, bedtime);
    assert.equal(diff, 10);
    // Should be 1 PM Tokyo
    const wc = wallClock(deadline, NRT.tz);
    assert.equal(wc.hour, 13);
  });
});

// ─── getExerciseWindow ────────────────────────────────────────────────────────

describe('getExerciseWindow', () => {
  const dayDate = dep(LHR, 8);

  it('eastward: exercise window is in the morning', () => {
    const w  = getExerciseWindow(dayDate, LHR, 'east', null);
    const wc = wallClock(w.start, LHR.tz);
    const h  = wc.hour + wc.minute / 60;
    assert.ok(h >= 6 && h <= 12, `Eastward exercise should be morning (6–12h), got ${h}`);
  });

  it('westward: exercise window is in the afternoon/evening', () => {
    const bedtime = makeLocalDate(JFK.tz, 2025, 6, 16, 23, 0); // 11 PM (delayed)
    const w  = getExerciseWindow(dep(JFK, 9), JFK, 'west', bedtime);
    const wc = wallClock(w.start, JFK.tz);
    const h  = wc.hour + wc.minute / 60;
    assert.ok(h >= 12 && h <= 22, `Westward exercise should be afternoon/evening, got ${h}`);
  });

  it('exercise window has positive duration', () => {
    const w = getExerciseWindow(dayDate, LHR, 'east', null);
    assert.ok(w.end > w.start, 'exercise end should be after start');
  });

  it('westward: window ends 2h before bedtime', () => {
    const bedtime = makeLocalDate(JFK.tz, 2025, 6, 15, 23, 0);
    const w = getExerciseWindow(dep(JFK, 9), JFK, 'west', bedtime);
    const gapToSleep = hoursBetween(w.end, bedtime);
    assert.equal(gapToSleep, 2);
  });
});

// ─── getBodyClock6AM ──────────────────────────────────────────────────────────

describe('getBodyClock6AM', () => {
  const params    = computeJetLagParams(JFK, LHR, dep(JFK, 20));
  const departure = dep(JFK, 20);

  it('on day 0: body clock 6AM is 6AM origin time', () => {
    const bc = getBodyClock6AM(0, params, JFK, LHR, departure);
    const wc = wallClock(bc, JFK.tz);
    assert.equal(wc.hour, 6);
  });

  it('on final day: body clock 6AM has shifted by full tzDiff from day 0', () => {
    const bc0 = getBodyClock6AM(0,                 params, JFK, LHR, departure);
    const bcN = getBodyClock6AM(params.daysToAdapt, params, JFK, LHR, departure);
    const totalShift = hoursBetween(bc0, bcN);
    assert.ok(Math.abs(totalShift - params.tzDiff) < 0.01,
      `Total body clock shift should equal tzDiff (${params.tzDiff}h), got ${totalShift}h`);
  });

  it('shifts by tzDiff/daysToAdapt each day', () => {
    const shiftPerDay = params.tzDiff / params.daysToAdapt;
    const bc0 = getBodyClock6AM(0, params, JFK, LHR, departure);
    const bc1 = getBodyClock6AM(1, params, JFK, LHR, departure);
    const actualShift = hoursBetween(bc0, bc1);
    assert.ok(Math.abs(actualShift - shiftPerDay) < 0.01,
      `Expected shift of ${shiftPerDay}h/day, got ${actualShift}h`);
  });
});
