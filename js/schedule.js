// Schedule generator — orchestrates circadian.js into a full day-by-day plan.

import {
  computeJetLagParams,
  getPreDepartureSleepShift,
  getPreDepartureMelatonin,
  getFastingProtocol,
  getInFlightSleepWindows,
  getRecoverySleepWindow,
  getLightRecommendation,
  getMelatoninRecommendation,
  getCaffeineDeadline,
  getExerciseWindow,
  getBodyClock6AM,
} from './circadian.js';

import { formatTime, formatDate, formatShortDate, addHours, addDays, makeLocalDate, wallClock, tzOffsetHours } from './tz.js';

// Default sleep/wake preferences (user can adjust in a future version)
const DEFAULT_BEDTIME_HOUR = 22;  // 10 PM
const DEFAULT_WAKE_HOUR    = 7;   // 7 AM

/**
 * Generate the full jet lag reduction plan.
 *
 * @param {object} origin       - airport { iata, name, city, country, lat, lng, tz }
 * @param {object} dest         - airport { iata, name, city, country, lat, lng, tz }
 * @param {Date}   departureUTC - UTC departure time
 * @param {Date}   arrivalUTC   - UTC arrival time (estimated from flight duration or user input)
 * @param {Date|null} returnUTC - UTC return departure time (optional)
 * @returns {{ summary, preDepartureDays, flightDay, recoveryDays }}
 */
export function generateSchedule(origin, dest, departureUTC, arrivalUTC, returnUTC = null) {
  const params = computeJetLagParams(origin, dest, departureUTC);

  // ── Summary ────────────────────────────────────────────────────────────────
  const flightHours = (arrivalUTC - departureUTC) / 3_600_000;

  const summary = {
    origin: { iata: origin.iata, city: origin.city || origin.name, tz: origin.tz },
    dest:   { iata: dest.iata,   city: dest.city   || dest.name,   tz: dest.tz   },
    tzDiff: params.tzDiff,
    direction: params.direction,
    absShift: params.absShift,
    daysToAdapt: params.daysToAdapt,
    trivial: params.trivial,
    flightHours: Math.round(flightHours * 10) / 10,
    departureUTC,
    arrivalUTC,
  };

  if (params.trivial) {
    return { summary, days: [makeTrivialDay(params, origin, dest, departureUTC)] };
  }

  const days = [];

  // ── Pre-departure days (-2 and -1) ────────────────────────────────────────
  const preDepartDays = params.absShift >= 3 ? [-2, -1] : [];
  for (const di of preDepartDays) {
    days.push(buildPreDepartureDay(di, params, origin, dest, departureUTC));
  }

  // ── Flight day ────────────────────────────────────────────────────────────
  days.push(buildFlightDay(params, origin, dest, departureUTC, arrivalUTC));

  // ── Recovery days ─────────────────────────────────────────────────────────
  // Calculate the body's "origin bedtime" in UTC as a reference
  const originWC = wallClock(departureUTC, origin.tz);
  const originBedtimeUTC = makeLocalDate(origin.tz, originWC.year, originWC.month, originWC.day, DEFAULT_BEDTIME_HOUR, 0);

  // Limit recovery days if a return trip is soon
  let maxRecoveryDays = params.daysToAdapt;
  if (returnUTC) {
    const daysAtDest = (returnUTC - arrivalUTC) / 86_400_000;
    maxRecoveryDays = Math.min(params.daysToAdapt, Math.floor(daysAtDest));
  }

  for (let di = 1; di <= maxRecoveryDays; di++) {
    const dayDate = addDays(arrivalUTC, di - 1);
    days.push(buildRecoveryDay(di, params, dest, dayDate, originBedtimeUTC, returnUTC));
  }

  // ── Return trip days (if provided) ────────────────────────────────────────
  if (returnUTC) {
    // Compute return trip params (reversed direction)
    const returnParams = computeJetLagParams(dest, origin, returnUTC);
    const returnArrivalUTC = addHours(returnUTC, flightHours); // approximate
    days.push(buildFlightDay(returnParams, dest, origin, returnUTC, returnArrivalUTC, true));

    // A few recovery days back home
    const homeRecoveryDays = Math.min(returnParams.daysToAdapt, 3);
    const destBedtimeUTC = makeLocalDate(dest.tz, wallClock(returnUTC, dest.tz).year,
      wallClock(returnUTC, dest.tz).month, wallClock(returnUTC, dest.tz).day, DEFAULT_BEDTIME_HOUR, 0);
    for (let di = 1; di <= homeRecoveryDays; di++) {
      const dayDate = addDays(returnArrivalUTC, di - 1);
      days.push(buildRecoveryDay(di, returnParams, origin, dayDate, destBedtimeUTC, null, true));
    }
  }

  return { summary, days };
}

// ─── Day Builders ─────────────────────────────────────────────────────────────

function buildPreDepartureDay(dayIndex, params, origin, dest, departureUTC) {
  const daysOut = -dayIndex; // 2 or 1
  const dayDate = addDays(departureUTC, dayIndex);
  const items = [];

  const wc = wallClock(dayDate, origin.tz);
  const label = daysOut === 2
    ? `2 Days Before Departure — ${formatShortDate(dayDate, origin.tz)}`
    : `1 Day Before Departure — ${formatShortDate(dayDate, origin.tz)}`;

  // Sleep shifting
  const sleepShift = getPreDepartureSleepShift(params, dayIndex, DEFAULT_BEDTIME_HOUR, DEFAULT_WAKE_HOUR, departureUTC, origin.tz);
  if (sleepShift) {
    const shiftDir = params.direction === 'east' ? 'earlier' : 'later';
    const mins = Math.round(Math.abs((DEFAULT_BEDTIME_HOUR - (sleepShift.bedtime.getHours() + sleepShift.bedtime.getMinutes() / 60))) * 60);
    const wakeWC = wallClock(sleepShift.wakeTime, origin.tz);
    const wakeSortKey = makeLocalDate(origin.tz, wc.year, wc.month, wc.day, wakeWC.hour, wakeWC.minute);
    items.push({
      time: formatTime(sleepShift.wakeTime, origin.tz),
      sortKey: wakeSortKey,
      category: 'wake',
      icon: '🌅',
      text: `Wake up ${mins} min ${shiftDir} than usual (${formatTime(sleepShift.wakeTime, origin.tz)}) to begin shifting your body clock`,
    });
    items.push({
      time: formatTime(sleepShift.bedtime, origin.tz),
      sortKey: sleepShift.bedtime,
      category: 'sleep',
      icon: '🌙',
      text: `Target bedtime: ${formatTime(sleepShift.bedtime, origin.tz)} — ${mins} min ${shiftDir} than usual`,
    });
  }

  // Pre-departure melatonin (eastward only)
  const melatoninTime = getPreDepartureMelatonin(params, dayIndex, DEFAULT_BEDTIME_HOUR, departureUTC, origin.tz);
  if (melatoninTime) {
    items.push({
      time: formatTime(melatoninTime, origin.tz),
      sortKey: melatoninTime,
      category: 'melatonin',
      icon: '💊',
      text: `Take 0.5 mg melatonin at ${formatTime(melatoninTime, origin.tz)} (this is your destination's equivalent bedtime — it begins shifting your clock eastward)`,
    });
  }

  // Light exposure
  if (params.direction === 'east') {
    items.push({
      time: '8:00 AM',
      sortKey: makeLocalDate(origin.tz, wc.year, wc.month, wc.day, 8, 0),
      category: 'light-seek',
      icon: '☀️',
      text: 'Get 20–30 min of bright morning light as early as possible — this shifts your clock earlier (eastward)',
    });
    items.push({
      time: '9:00 PM',
      sortKey: makeLocalDate(origin.tz, wc.year, wc.month, wc.day, 21, 0),
      category: 'light-avoid',
      icon: '🕶️',
      text: 'After 9 PM: dim lights, no bright screens — evening light delays your clock and will worsen eastward jet lag',
    });
  } else {
    items.push({
      time: '7:00 PM',
      sortKey: makeLocalDate(origin.tz, wc.year, wc.month, wc.day, 19, 0),
      category: 'light-seek',
      icon: '☀️',
      text: 'Get bright evening light — this delays your clock (helpful for westward travel)',
    });
    items.push({
      time: '8:00 AM',
      sortKey: makeLocalDate(origin.tz, wc.year, wc.month, wc.day, 8, 0),
      category: 'light-avoid',
      icon: '🕶️',
      text: 'Wear sunglasses for the first 2 hours after waking — morning light would advance your clock (wrong direction for westward travel)',
    });
  }

  // Alcohol / hydration advice
  items.push({
    time: 'All Day',
    sortKey: makeLocalDate(origin.tz, wc.year, wc.month, wc.day, 0, 1),
    category: 'hydration',
    icon: '💧',
    text: 'Stay well-hydrated; limit alcohol — dehydration and alcohol worsen jet lag',
  });

  return makeDay({ label, date: dayDate, phase: 'pre-departure', items, tz: origin.tz });
}

function buildFlightDay(params, origin, dest, departureUTC, arrivalUTC, isReturn = false) {
  const items = [];
  const label = isReturn ? `Return Flight — ${formatShortDate(departureUTC, origin.tz)}` : `Departure Day & Flight — ${formatShortDate(departureUTC, origin.tz)}`;

  // Departure milestone
  items.push({
    time: formatTime(departureUTC, origin.tz),
    sortKey: departureUTC,
    category: 'milestone',
    icon: '🛫',
    text: `Departs ${origin.iata} — ${formatTime(departureUTC, origin.tz)} (${origin.city})`,
  });

  // Arrival milestone
  items.push({
    time: formatTime(arrivalUTC, dest.tz),
    sortKey: arrivalUTC,
    category: 'milestone',
    icon: '🛬',
    text: `Arrives ${dest.iata} — ${formatTime(arrivalUTC, dest.tz)} (${dest.city})`,
  });

  // Fasting protocol
  const fast = getFastingProtocol(departureUTC, arrivalUTC, dest);
  if (fast.durationHours >= 8) {
    items.push({
      time: formatTime(fast.fastStart, origin.tz),
      sortKey: fast.fastStart,
      category: 'meal',
      icon: '🍽️',
      text: `Start fasting at ${formatTime(fast.fastStart, origin.tz)} (${origin.tz.split('/').pop().replace(/_/g,' ')}). This ~${Math.round(fast.durationHours)}-hour fast signals your body to reset to the new time zone`,
    });
    items.push({
      time: formatTime(fast.firstMealTime, dest.tz),
      sortKey: fast.firstMealTime,
      category: 'meal',
      icon: '🍳',
      text: `First meal at ${formatTime(fast.firstMealTime, dest.tz)} (destination time) — eat a protein-rich breakfast. This resets your gut and liver clocks to the new time zone`,
    });
  } else {
    items.push({
      time: formatTime(departureUTC, origin.tz),
      sortKey: departureUTC,
      category: 'meal',
      icon: '🍽️',
      text: 'Short flight — no extended fasting needed. Eat meals aligned with destination local times to help reset your body clock',
    });
  }

  // In-flight sleep windows
  const sleepWindows = getInFlightSleepWindows(departureUTC, arrivalUTC, dest, DEFAULT_BEDTIME_HOUR, DEFAULT_WAKE_HOUR);
  if (sleepWindows.length > 0) {
    for (const w of sleepWindows) {
      items.push({
        time: formatTime(w.start, origin.tz),
        sortKey: w.start,
        category: 'sleep',
        icon: '😴',
        text: `Sleep window on plane: ${formatTime(w.start, dest.tz)}–${formatTime(w.end, dest.tz)} (destination time). It is nighttime at your destination — sleeping now helps synchronize your clock`,
      });
    }
  } else {
    items.push({
      time: formatTime(departureUTC, origin.tz),
      sortKey: addHours(departureUTC, 1),
      category: 'stay-awake',
      icon: '⚡',
      text: 'Stay awake during the flight — it is daytime at your destination. Sleeping would delay your adjustment',
    });
  }

  // Clock change
  items.push({
    time: formatTime(departureUTC, origin.tz),
    sortKey: addHours(departureUTC, 0.01),
    category: 'info',
    icon: '🕐',
    text: `Set your watch and phone to destination time (${dest.iata} — ${dest.city}) immediately on takeoff`,
  });

  // Hydration / alcohol
  items.push({
    time: 'During Flight',
    sortKey: addHours(departureUTC, 2),
    category: 'hydration',
    icon: '💧',
    text: 'Drink ~250 mL (8 oz) of water every hour. Avoid alcohol entirely — cabin air is very dry and alcohol significantly worsens jet lag and disrupts sleep quality',
  });

  // Caffeine
  items.push({
    time: 'During Flight',
    sortKey: addHours(departureUTC, 3),
    category: 'caffeine',
    icon: '☕',
    text: 'Use caffeine only to stay awake if it is daytime at your destination; avoid it for the last 10 hours before your target destination bedtime',
  });

  // Post-arrival nudge
  items.push({
    time: formatTime(arrivalUTC, dest.tz),
    sortKey: addHours(arrivalUTC, 0.01),
    category: 'stay-awake',
    icon: '⚡',
    text: `Push through to local bedtime if at all possible — do not nap on arrival`,
  });

  return makeDay({ label, date: departureUTC, phase: 'flight', items, tz: origin.tz });
}

function buildRecoveryDay(dayIndex, params, dest, dayDateUTC, originBedtimeUTC, returnUTC = null, isHomeRecovery = false) {
  const items = [];

  // Compute sleep window
  const sleep = getRecoverySleepWindow(
    dayIndex, params.daysToAdapt,
    originBedtimeUTC, DEFAULT_BEDTIME_HOUR, DEFAULT_WAKE_HOUR,
    dayDateUTC, dest
  );

  // Caffeine cutoff
  const caffeineCutoff = getCaffeineDeadline(sleep.bedtime);

  // Light recommendation
  const bodyClock6AM = getBodyClock6AM(dayIndex, params, { tz: originBedtimeUTC ? 'UTC' : dest.tz }, dest, dayDateUTC);
  const lightRec = getLightRecommendation(dayDateUTC, dest, params.direction, bodyClock6AM);

  // Melatonin
  const melatoninTime = getMelatoninRecommendation(params, dayIndex, dayDateUTC, dest);

  // Exercise
  const exercise = getExerciseWindow(dayDateUTC, dest, params.direction);

  const isFullyAdapted = dayIndex >= params.daysToAdapt;
  const prefix = isHomeRecovery ? 'Home Day' : `Day ${dayIndex}`;
  const adaptNote = isFullyAdapted ? ' — Fully Adapted!' : '';
  const label = `${prefix} at ${dest.city}${adaptNote} — ${formatShortDate(dayDateUTC, dest.tz)}`;

  // Wake time — pin sortKey to this card's calendar day so it sorts at the top
  const wc = wallClock(dayDateUTC, dest.tz);
  const wakeWC = wallClock(sleep.wakeTime, dest.tz);
  const wakeSortKey = makeLocalDate(dest.tz, wc.year, wc.month, wc.day, wakeWC.hour, wakeWC.minute);
  items.push({
    time: formatTime(sleep.wakeTime, dest.tz),
    sortKey: wakeSortKey,
    category: 'wake',
    icon: '🌅',
    text: `Wake up: ${formatTime(sleep.wakeTime, dest.tz)}${isFullyAdapted ? ' — you are now fully adapted!' : ' (shifting toward local schedule)'}`,
  });

  // Light
  if (lightRec) {
    items.push({
      time: formatTime(lightRec.seek.start, dest.tz),
      sortKey: lightRec.seek.start,
      category: 'light-seek',
      icon: '☀️',
      text: `${formatTime(lightRec.seek.start, dest.tz)}–${formatTime(lightRec.seek.end, dest.tz)}: ${lightRec.seek.label}`,
    });
    if (lightRec.avoid) {
      items.push({
        time: formatTime(lightRec.avoid.start, dest.tz),
        sortKey: lightRec.avoid.start,
        category: 'light-avoid',
        icon: '🕶️',
        text: `${formatTime(lightRec.avoid.start, dest.tz)}–${formatTime(lightRec.avoid.end, dest.tz)}: ${lightRec.avoid.label}`,
      });
    }
  }

  // Breakfast
  const breakfast = makeLocalDate(dest.tz, wc.year, wc.month, wc.day, 7, 0);
  items.push({
    time: formatTime(breakfast, dest.tz),
    sortKey: breakfast,
    category: 'meal',
    icon: '🍳',
    text: dayIndex === 1
      ? 'Eat breakfast at 7 AM local time even if not hungry — this is the most important meal for resetting your body clock. High protein.'
      : 'Eat meals at regular local times — consistency reinforces your new circadian rhythm',
  });

  // Exercise
  items.push({
    time: formatTime(exercise.start, dest.tz),
    sortKey: exercise.start,
    category: 'exercise',
    icon: '🏃',
    text: `${formatTime(exercise.start, dest.tz)}–${formatTime(exercise.end, dest.tz)}: ${exercise.label}`,
  });

  // Caffeine cutoff
  items.push({
    time: formatTime(caffeineCutoff, dest.tz),
    sortKey: caffeineCutoff,
    category: 'caffeine',
    icon: '☕',
    text: `Last caffeine by ${formatTime(caffeineCutoff, dest.tz)} — caffeine's 5–6 hour half-life means anything later will still be in your system at bedtime`,
  });

  // No napping (or short nap only)
  const noonLocal = makeLocalDate(dest.tz, wc.year, wc.month, wc.day, 13, 0);
  items.push({
    time: '1:00 PM',
    sortKey: noonLocal,
    category: 'stay-awake',
    icon: '⚡',
    text: dayIndex <= 2
      ? 'Avoid naps longer than 20 min. If exhausted, a short "power nap" before 2 PM is OK — longer naps reset your clock to the wrong time'
      : 'Avoid napping — your clock is nearly adapted; naps now can destabilize it',
  });

  // Melatonin
  if (melatoninTime) {
    items.push({
      time: formatTime(melatoninTime, dest.tz),
      sortKey: melatoninTime,
      category: 'melatonin',
      icon: '💊',
      text: `Take 0.5 mg melatonin at ${formatTime(melatoninTime, dest.tz)} — use the lowest effective dose (0.5 mg, not the 5–10 mg sold OTC). Higher doses are no more effective for clock shifting and impair sleep quality`,
    });
  }

  // Alcohol
  items.push({
    time: 'Evening',
    sortKey: addHours(sleep.bedtime, -3),
    category: 'hydration',
    icon: '🚫',
    text: 'Avoid alcohol — it fragments sleep architecture and prolongs jet lag recovery even when it seems to help you fall asleep',
  });

  // Bedtime
  items.push({
    time: formatTime(sleep.bedtime, dest.tz),
    sortKey: sleep.bedtime,
    category: 'sleep',
    icon: '🌙',
    text: `Target bedtime: ${formatTime(sleep.bedtime, dest.tz)}. Keep the room cool (~65–68°F / 18–20°C) and dark`,
  });

  return makeDay({ label, date: dayDateUTC, phase: 'recovery', items, tz: dest.tz });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDay({ label, date, phase, items, tz }) {
  // Sort by time
  const sorted = items.slice().sort((a, b) => {
    if (a.sortKey instanceof Date && b.sortKey instanceof Date) {
      return a.sortKey - b.sortKey;
    }
    return 0;
  });

  return { label, date, phase, items: sorted, tz };
}

function makeTrivialDay(params, origin, dest, departureUTC) {
  return {
    label: 'Your Trip',
    date: departureUTC,
    phase: 'trivial',
    tz: dest.tz,
    items: [
      {
        time: '',
        category: 'info',
        icon: '✅',
        text: `Your trip crosses only ${params.absShift.toFixed(1)} time zone${params.absShift !== 1 ? 's' : ''} — jet lag will be minimal. Most people adapt within a day without any special protocol.`,
      },
      {
        time: '',
        category: 'sleep',
        icon: '🌙',
        text: 'Tip: Try to sleep at local bedtime on your first night and eat meals at local times. You\'ll adapt quickly.',
      },
      {
        time: '',
        category: 'hydration',
        icon: '💧',
        text: 'Stay hydrated on the flight and avoid alcohol. Good sleep hygiene is all you need.',
      },
    ],
  };
}
