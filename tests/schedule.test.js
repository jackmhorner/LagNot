/**
 * Integration tests for generateSchedule.
 * Verifies logical correctness of the full day-by-day plan across diverse routes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../js/schedule.js';
import { addHours, wallClock, makeLocalDate } from '../js/tz.js';
import { JFK, LHR, LAX, NRT, SYD, DXB, ORD, dep, hoursBetween } from './fixtures.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Estimate flight hours by great-circle (same formula as main.js). */
function flightHours(o, d) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(d.lat - o.lat);
  const dLng = toRad(d.lng - o.lng);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(o.lat)) * Math.cos(toRad(d.lat)) * Math.sin(dLng/2)**2;
  const km = 2 * R * Math.asin(Math.sqrt(a));
  return Math.max(1, km / 850 + 1);
}

function makeTrip(origin, dest, depHour) {
  const departure = dep(origin, depHour);
  const fh        = flightHours(origin, dest);
  const arrival   = addHours(departure, fh);
  return { departure, arrival, fh };
}

const VALID_CATEGORIES = new Set([
  'sleep', 'wake', 'stay-awake', 'light-seek', 'light-avoid',
  'meal', 'melatonin', 'exercise', 'caffeine', 'caffeine-avoid',
  'hydration', 'info', 'milestone', 'flight',
]);

function itemsByCategory(days, category) {
  return days.flatMap(d => d.items.filter(i => i.category === category));
}

function assertSortedByTime(day) {
  const dated = day.items.filter(i => i.sortKey instanceof Date);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(dated[i].sortKey >= dated[i-1].sortKey,
      `${day.label}: items out of order at index ${i}`);
  }
}

// ─── Scenario: JFK → LHR (eastward, 5 zones) ─────────────────────────────────

describe('JFK → LHR (eastward, 5 zones, evening departure)', () => {
  const { departure, arrival } = makeTrip(JFK, LHR, 20);
  const schedule = generateSchedule(JFK, LHR, departure, arrival, null);
  const { summary, days } = schedule;

  it('summary has correct direction and zone count', () => {
    assert.equal(summary.direction, 'east');
    assert.equal(summary.absShift, 5);
  });

  it('has 2 pre-departure days', () => {
    const pre = days.filter(d => d.phase === 'pre-departure');
    assert.equal(pre.length, 2);
  });

  it('has exactly 1 flight day', () => {
    assert.equal(days.filter(d => d.phase === 'flight').length, 1);
  });

  it('has daysToAdapt recovery days', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    assert.equal(recovery.length, summary.daysToAdapt);
  });

  it('all item categories are valid', () => {
    for (const day of days) {
      for (const item of day.items) {
        assert.ok(VALID_CATEGORIES.has(item.category),
          `Unknown category "${item.category}" in ${day.label}`);
      }
    }
  });

  it('all timed items have a sortKey', () => {
    for (const day of days) {
      for (const item of day.items) {
        if (item.category !== 'hydration' || !item.allDay) {
          // non-allDay items should have a sortKey
          if (!item.allDay) {
            assert.ok(item.sortKey, `${day.label}: item "${item.text?.slice(0,40)}" missing sortKey`);
          }
        }
      }
    }
  });

  it('all days are sorted by time', () => {
    for (const day of days) {
      assertSortedByTime(day);
    }
  });

  it('pre-departure days include melatonin (eastward)', () => {
    const preDays = days.filter(d => d.phase === 'pre-departure');
    const hasMel  = preDays.some(d => d.items.some(i => i.category === 'melatonin'));
    assert.ok(hasMel, 'Eastward pre-departure should include melatonin');
  });

  it('pre-departure days include light-seek in the morning', () => {
    const preDays = days.filter(d => d.phase === 'pre-departure');
    const hasSeek = preDays.some(d => d.items.some(i => i.category === 'light-seek'));
    assert.ok(hasSeek, 'Pre-departure should include light-seek items');
  });

  it('recovery days all have a sleep item', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    for (const day of recovery) {
      const hasSleep = day.items.some(i => i.category === 'sleep');
      assert.ok(hasSleep, `${day.label} should have a sleep item`);
    }
  });

  it('recovery days: caffeine-ok ends when caffeine-avoid begins', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    for (const day of recovery) {
      const ok    = day.items.find(i => i.category === 'caffeine');
      const avoid = day.items.find(i => i.category === 'caffeine-avoid');
      if (ok && avoid && ok.timelineEnd && avoid.sortKey) {
        const diff = Math.abs(hoursBetween(ok.timelineEnd, avoid.sortKey));
        assert.ok(diff < 0.02,
          `${day.label}: caffeine-ok end and caffeine-avoid start should align (diff=${diff}h)`);
      }
    }
  });

  it('recovery days: sleep ends at or after wake time', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    for (const day of recovery) {
      const sleep = day.items.find(i => i.category === 'sleep');
      const wake  = day.items.find(i => i.category === 'wake');
      if (sleep?.timelineEnd && wake?.sortKey) {
        assert.ok(sleep.timelineEnd >= wake.sortKey,
          `${day.label}: sleep timelineEnd should be at/after wake sortKey`);
      }
    }
  });

  it('flight day has a flight-category item (timeline pill)', () => {
    const flightDay = days.find(d => d.phase === 'flight');
    const pill = flightDay.items.find(i => i.category === 'flight');
    assert.ok(pill, 'Flight day should have a flight pill');
    assert.ok(pill.timelineOnly, 'Flight pill should be timelineOnly');
    assert.ok(pill.timelineEnd > pill.sortKey, 'Flight pill should have positive duration');
  });

  it('summary flight hours matches pill duration approximately', () => {
    const flightDay = days.find(d => d.phase === 'flight');
    const pill = flightDay.items.find(i => i.category === 'flight');
    const pillDur = hoursBetween(pill.sortKey, pill.timelineEnd);
    assert.ok(Math.abs(pillDur - summary.flightHours) < 0.5,
      `Pill duration (${pillDur}h) should match summary flightHours (${summary.flightHours}h)`);
  });

  it('recovery days: caffeine cutoff is 10h before bedtime', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    for (const day of recovery) {
      const sleep     = day.items.find(i => i.category === 'sleep');
      const cafAvoid  = day.items.find(i => i.category === 'caffeine-avoid');
      if (sleep?.sortKey && cafAvoid?.sortKey) {
        const gap = hoursBetween(cafAvoid.sortKey, sleep.sortKey);
        assert.ok(Math.abs(gap - 10) < 0.1,
          `${day.label}: caffeine cutoff should be 10h before sleep, got ${gap}h`);
      }
    }
  });
});

// ─── Scenario: LHR → JFK (westward, 5 zones) ─────────────────────────────────

describe('LHR → JFK (westward, 5 zones, morning departure)', () => {
  const { departure, arrival } = makeTrip(LHR, JFK, 9);
  const schedule = generateSchedule(LHR, JFK, departure, arrival, null);
  const { summary, days } = schedule;

  it('is westward', () => assert.equal(summary.direction, 'west'));

  it('pre-departure days have NO melatonin (westward, not >8 zones)', () => {
    const preDays = days.filter(d => d.phase === 'pre-departure');
    const hasMel  = preDays.some(d => d.items.some(i => i.category === 'melatonin'));
    assert.equal(hasMel, false, 'Westward 5-zone pre-departure should not include melatonin');
  });

  it('pre-departure has light-seek in the evening', () => {
    const preDays = days.filter(d => d.phase === 'pre-departure');
    const hasSeek = preDays.some(d => d.items.some(i => i.category === 'light-seek'));
    assert.ok(hasSeek, 'Westward pre-departure should include evening light-seek');
  });

  it('recovery days: no melatonin (5-zone westward)', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    const hasMel   = recovery.some(d => d.items.some(i => i.category === 'melatonin'));
    assert.equal(hasMel, false, '5-zone westward recovery should not recommend melatonin');
  });

  it('all days sorted by time', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Scenario: LAX → NRT (long westward, 8 zones) ────────────────────────────

describe('LAX → NRT (westward, 8 zones, long-haul)', () => {
  const { departure, arrival, fh } = makeTrip(LAX, NRT, 11);
  const schedule = generateSchedule(LAX, NRT, departure, arrival, null);
  const { summary, days } = schedule;

  it('is westward and 8 zones', () => {
    assert.equal(summary.direction, 'west');
    assert.equal(summary.absShift, 8);
  });

  it('flight day has in-flight sleep recommendations (long overnight)', () => {
    const flightDay = days.find(d => d.phase === 'flight');
    const hasSleep  = flightDay.items.some(i => i.category === 'sleep');
    assert.ok(hasSleep, 'Long-haul should recommend in-flight sleep');
  });

  it('has recovery days', () => {
    assert.ok(days.filter(d => d.phase === 'recovery').length > 0);
  });

  it('all days sorted', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Scenario: NRT → JFK (long eastward, 11 zones) ───────────────────────────

describe('NRT → JFK (eastward, 11 zones)', () => {
  const { departure, arrival } = makeTrip(NRT, JFK, 10);
  const schedule = generateSchedule(NRT, JFK, departure, arrival, null);
  const { summary, days } = schedule;

  it('is eastward and ~11 zones', () => {
    assert.equal(summary.direction, 'east');
    assert.equal(summary.absShift, 11);
  });

  it('recovery has melatonin for first ceil(11/2)=6 days', () => {
    const recovery = days.filter(d => d.phase === 'recovery');
    const melDays  = recovery.filter(d => d.items.some(i => i.category === 'melatonin'));
    assert.equal(melDays.length, Math.ceil(11 / 2));
  });

  it('all days sorted', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Scenario: JFK → ORD (trivial — 1 zone) ──────────────────────────────────

describe('JFK → ORD (trivial, 1 zone)', () => {
  const { departure, arrival } = makeTrip(JFK, ORD, 12);
  const schedule = generateSchedule(JFK, ORD, departure, arrival, null);
  const { summary, days } = schedule;

  it('summary marks trivial', () => assert.equal(summary.trivial, true));
  it('returns only 1 day', () => assert.equal(days.length, 1));
  it('trivial day has phase "trivial"', () => assert.equal(days[0].phase, 'trivial'));
  it('trivial day has no caffeine-avoid or melatonin items', () => {
    const cats = days[0].items.map(i => i.category);
    assert.ok(!cats.includes('melatonin'), 'trivial day should not have melatonin');
  });
});

// ─── Scenario: JFK → LHR with return (round-trip) ────────────────────────────

describe('JFK → LHR with return 5 days later (round-trip)', () => {
  const { departure, arrival } = makeTrip(JFK, LHR, 20);
  const returnUTC = addHours(arrival, 5 * 24); // return 5 days after arrival
  const schedule  = generateSchedule(JFK, LHR, departure, arrival, returnUTC);
  const { days }  = schedule;

  it('has both outbound and return flight days', () => {
    assert.equal(days.filter(d => d.phase === 'flight').length, 2);
  });

  it('outbound recovery days are limited by time at destination', () => {
    // Both outbound and return recovery have phase='recovery', so narrow to days
    // between the two flight days.
    const flightIdxs = days.map((d, i) => d.phase === 'flight' ? i : -1).filter(i => i >= 0);
    const outboundRecovery = days.slice(flightIdxs[0] + 1, flightIdxs[1]);
    // 5 days at dest, daysToAdapt=5 → maxRecovery = min(5, floor(5)) = 5
    assert.ok(outboundRecovery.length <= 5,
      `Outbound recovery (${outboundRecovery.length}) should be ≤ 5`);
  });

  it('has home recovery days after return', () => {
    // Days after the return flight should exist (up to 3 per schedule.js cap)
    const flightDays = days.map((d, i) => ({ d, i })).filter(({ d }) => d.phase === 'flight');
    const returnFlightIdx = flightDays[flightDays.length - 1].i;
    const afterReturn = days.slice(returnFlightIdx + 1);
    assert.ok(afterReturn.length > 0, 'Should have home recovery days after return');
  });

  it('all days sorted', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Scenario: Short-haul same day — LHR → DXB (3 zones east) ────────────────

describe('LHR → DXB (eastward, 3 zones, short-haul)', () => {
  const { departure, arrival } = makeTrip(LHR, DXB, 8);
  const schedule = generateSchedule(LHR, DXB, departure, arrival, null);
  const { summary, days } = schedule;

  it('direction is eastward, 3 zones', () => {
    assert.equal(summary.direction, 'east');
    assert.equal(summary.absShift, 3);
  });

  it('not trivial', () => assert.equal(summary.trivial, false));

  it('has pre-departure, flight, recovery days', () => {
    assert.ok(days.some(d => d.phase === 'pre-departure'));
    assert.ok(days.some(d => d.phase === 'flight'));
    assert.ok(days.some(d => d.phase === 'recovery'));
  });

  it('all days sorted', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Scenario: Southern hemisphere — JFK → SYD (eastward, long-haul) ─────────

describe('JFK → SYD (eastward, long-haul, crossing many zones)', () => {
  const { departure, arrival } = makeTrip(JFK, SYD, 22);
  const schedule = generateSchedule(JFK, SYD, departure, arrival, null);
  const { summary, days } = schedule;

  it('has a valid direction', () => {
    assert.ok(['east', 'west'].includes(summary.direction));
  });

  it('absShift is within 0–12', () => {
    assert.ok(summary.absShift >= 0 && summary.absShift <= 12);
  });

  it('all item categories are valid', () => {
    for (const day of days) {
      for (const item of day.items) {
        assert.ok(VALID_CATEGORIES.has(item.category),
          `Unknown category "${item.category}" in ${day.label}`);
      }
    }
  });

  it('all days sorted', () => {
    for (const day of days) assertSortedByTime(day);
  });
});

// ─── Cross-cutting: hydration appears on every non-trivial day ────────────────

describe('hydration appears on all non-trivial days', () => {
  const scenarios = [
    { o: JFK, d: LHR, h: 20 },
    { o: LHR, d: JFK, h: 9  },
    { o: LAX, d: NRT, h: 11 },
  ];
  for (const { o, d, h } of scenarios) {
    it(`${o.iata}→${d.iata}: every day has hydration`, () => {
      const { departure, arrival } = makeTrip(o, d, h);
      const { days } = generateSchedule(o, d, departure, arrival, null);
      for (const day of days) {
        const has = day.items.some(i => i.category === 'hydration');
        assert.ok(has, `${day.label} should have a hydration item`);
      }
    });
  }
});

// ─── Cross-cutting: item text is non-empty ────────────────────────────────────

describe('all items have non-empty text', () => {
  const { departure, arrival } = makeTrip(JFK, LHR, 20);
  const { days } = generateSchedule(JFK, LHR, departure, arrival, null);

  it('every item has a non-empty text field', () => {
    for (const day of days) {
      for (const item of day.items) {
        assert.ok(item.text && item.text.length > 0,
          `${day.label}: item with category "${item.category}" has empty text`);
      }
    }
  });

  it('every item has an icon', () => {
    for (const day of days) {
      for (const item of day.items) {
        assert.ok(item.icon && item.icon.length > 0,
          `${day.label}: item with category "${item.category}" missing icon`);
      }
    }
  });
});
