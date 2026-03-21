// Circadian science engine — pure functions, no DOM access.
// Based on:
//   - Czeisler et al. — phase response curves for light and melatonin
//   - Lewy et al. — melatonin timing and dose (0.5 mg physiologic)
//   - Sack et al. — light exposure and jet lag (AASM guidelines)
//   - Beaumont et al. — fasting/refeeding as a zeitgeber
//   - Eastman & Burgess — pre-travel sleep shifting
//   - Caffeine half-life: ~5-6h; 10-hour cutoff for sleep onset protection

import { tzOffsetHours, addHours, makeLocalDate, wallClock } from './tz.js';
import { getSunTimes } from './suncalc-utils.js';

// ─── Core Parameter Calculation ──────────────────────────────────────────────

/**
 * Compute the fundamental jet lag parameters for a trip.
 * @param {object} origin - airport object { iata, lat, lng, tz }
 * @param {object} dest   - airport object { iata, lat, lng, tz }
 * @param {Date}   departureUTC
 * @returns {{ tzDiff, direction, absShift, daysToAdapt, trivial }}
 */
export function computeJetLagParams(origin, dest, departureUTC) {
  const originOffset = tzOffsetHours(origin.tz, departureUTC);
  const destOffset   = tzOffsetHours(dest.tz,   departureUTC);

  // Normalize difference to -12…+12 (take the shorter path around the globe)
  let tzDiff = destOffset - originOffset;
  if (tzDiff > 12)  tzDiff -= 24;
  if (tzDiff < -12) tzDiff += 24;

  const absShift = Math.abs(tzDiff);
  // Eastward = positive diff (dest is ahead of origin)
  const direction = tzDiff >= 0 ? 'east' : 'west';

  // Clock advances ~1 h/day eastward, delays ~1.5 h/day westward
  const ratePerDay = direction === 'east' ? 1.0 : 1.5;
  const daysToAdapt = Math.ceil(absShift / ratePerDay);

  return {
    tzDiff,
    direction,
    absShift,
    daysToAdapt,
    trivial: absShift < 3,
  };
}

// ─── Pre-departure Recommendations ──────────────────────────────────────────

/**
 * Generate sleep shifting targets for a given pre-departure day.
 * dayIndex: -2 = two days before, -1 = one day before
 * Returns { bedtime: Date, wakeTime: Date } in origin time.
 */
export function getPreDepartureSleepShift(params, dayIndex, originBedtimeHour, originWakeHour, departureDateLocal, originTz) {
  if (params.trivial) return null;

  // Shift 30-60 min per night toward destination time
  const shiftPerNight = params.direction === 'east' ? -0.75 : +0.75; // hours earlier/later
  const daysOut = -dayIndex; // 2 or 1

  const bedtimeHour = originBedtimeHour + shiftPerNight * daysOut;
  const wakeHour    = originWakeHour    + shiftPerNight * daysOut;

  const wc = wallClock(departureDateLocal, originTz);
  const dayOffset = dayIndex; // negative

  return {
    bedtime:  makeLocalDate(originTz, wc.year, wc.month, wc.day + dayOffset + 1, Math.floor(bedtimeHour % 24), Math.round((bedtimeHour % 1) * 60)),
    wakeTime: makeLocalDate(originTz, wc.year, wc.month, wc.day + dayOffset + 1, Math.floor(wakeHour  % 24), Math.round((wakeHour  % 1) * 60)),
  };
}

/**
 * Pre-departure melatonin recommendation (eastward travel only).
 * Returns a Date (in origin tz) for when to take melatonin, or null.
 */
export function getPreDepartureMelatonin(params, dayIndex, destBedtimeHour, departureDateLocal, originTz) {
  // Only useful for eastward shifts ≥ 3 zones
  if (params.direction !== 'east' || params.trivial) return null;

  // Take melatonin at 10 PM destination-equivalent (converted to origin local time)
  const wc = wallClock(departureDateLocal, originTz);
  const daysOut = -dayIndex;

  // Destination bedtime hour in origin time = destBedtimeHour - tzDiff
  const melatoninHourOrigin = destBedtimeHour - params.tzDiff;
  const normalizedHour = ((melatoninHourOrigin % 24) + 24) % 24;

  return makeLocalDate(originTz, wc.year, wc.month, wc.day - daysOut, Math.floor(normalizedHour), Math.round((normalizedHour % 1) * 60));
}

// ─── In-flight Recommendations ───────────────────────────────────────────────

/**
 * Fasting protocol: compute when to stop eating and when to eat the first meal.
 * The anchor is 7:00 AM at the destination on arrival day.
 * The fast begins 16 hours before the anchor (or at departure, whichever is later).
 *
 * @param {Date} departureUTC
 * @param {Date} arrivalUTC
 * @param {object} dest  - { lat, lng, tz }
 * @returns {{ fastStart: Date, firstMealTime: Date, duration: number }}
 */
export function getFastingProtocol(departureUTC, arrivalUTC, dest) {
  const arrivalWC = wallClock(arrivalUTC, dest.tz);
  // Anchor: 7 AM on arrival day at destination
  const anchor = makeLocalDate(dest.tz, arrivalWC.year, arrivalWC.month, arrivalWC.day, 7, 0);

  // Fast starts 16 hours before anchor
  const fastStartIdeal = addHours(anchor, -16);
  const fastStart = fastStartIdeal < departureUTC ? departureUTC : fastStartIdeal;

  const durationHours = (anchor - fastStart) / 3_600_000;

  return { fastStart, firstMealTime: anchor, durationHours };
}

/**
 * Should the passenger sleep on the plane?
 * Returns an array of sleep windows (UTC) based on when it is "night" at the destination.
 *
 * @param {Date} departureUTC
 * @param {Date} arrivalUTC
 * @param {object} dest - { tz }
 * @param {number} destBedtimeHour  - e.g. 22 for 10 PM
 * @param {number} destWakeHour     - e.g. 7 for 7 AM
 * @returns {Array<{ start: Date, end: Date }>}
 */
export function getInFlightSleepWindows(departureUTC, arrivalUTC, dest, destBedtimeHour = 22, destWakeHour = 7) {
  const windows = [];
  const flightMs = arrivalUTC - departureUTC;
  if (flightMs <= 0) return windows;

  // Walk through the flight checking for dest-night windows
  let cursor = new Date(departureUTC);
  const step = 3_600_000; // 1 hour steps

  while (cursor < arrivalUTC) {
    const wc = wallClock(cursor, dest.tz);
    const h = wc.hour + wc.minute / 60;

    // "Night" = between bedtime and wake
    const isNight = destBedtimeHour > destWakeHour
      ? (h >= destBedtimeHour || h < destWakeHour)
      : (h >= destBedtimeHour && h < destWakeHour);

    if (isNight) {
      // Find window start
      const winStart = new Date(cursor);
      while (cursor < arrivalUTC) {
        const wc2 = wallClock(cursor, dest.tz);
        const h2 = wc2.hour + wc2.minute / 60;
        const stillNight = destBedtimeHour > destWakeHour
          ? (h2 >= destBedtimeHour || h2 < destWakeHour)
          : (h2 >= destBedtimeHour && h2 < destWakeHour);
        if (!stillNight) break;
        cursor = new Date(cursor.getTime() + step);
      }
      const winEnd = cursor < arrivalUTC ? cursor : arrivalUTC;
      const winDuration = (winEnd - winStart) / 3_600_000;
      if (winDuration >= 1) windows.push({ start: winStart, end: winEnd, durationHours: winDuration });
    }

    cursor = new Date(cursor.getTime() + step);
  }

  return windows;
}

// ─── Post-arrival Recommendations ────────────────────────────────────────────

/**
 * Compute the sleep window for a given recovery day.
 * Linearly interpolates from origin-adjusted bedtime toward destination bedtime.
 *
 * @param {number} dayIndex     - 1-based (day 1 = arrival day)
 * @param {number} daysToAdapt
 * @param {Date}   originBedtimeUTC  - what the person's body clock says is bedtime (in UTC)
 * @param {number} destBedtimeHour   - target bedtime hour at destination (e.g. 22)
 * @param {number} destWakeHour      - target wake hour at destination (e.g. 7)
 * @param {Date}   dayDateUTC        - any date within the recovery day (used to anchor calendar)
 * @param {object} dest              - { tz }
 * @returns {{ bedtime: Date, wakeTime: Date }}
 */
export function getRecoverySleepWindow(dayIndex, daysToAdapt, originBedtimeUTC, destBedtimeHour, destWakeHour, dayDateUTC, dest) {
  const t = Math.min(dayIndex / daysToAdapt, 1);

  // Origin bedtime expressed in dest timezone hour
  const originBedtimeWC = wallClock(originBedtimeUTC, dest.tz);
  const originBedHour = originBedtimeWC.hour + originBedtimeWC.minute / 60;

  // Interpolate
  let bedHour  = originBedHour  + t * (destBedtimeHour - originBedHour);
  let wakeHour = bedHour + (destWakeHour > destBedtimeHour
    ? destWakeHour - destBedtimeHour
    : 24 - destBedtimeHour + destWakeHour);

  bedHour  = ((bedHour  % 24) + 24) % 24;
  wakeHour = ((wakeHour % 24) + 24) % 24;

  const wc = wallClock(dayDateUTC, dest.tz);

  const bedtime  = makeLocalDate(dest.tz, wc.year, wc.month, wc.day, Math.floor(bedHour),  Math.round((bedHour  % 1) * 60));
  const wakeTime = makeLocalDate(dest.tz, wc.year, wc.month, wc.day + (wakeHour < bedHour ? 1 : 0),
    Math.floor(wakeHour), Math.round((wakeHour % 1) * 60));

  return { bedtime, wakeTime };
}

/**
 * Light exposure recommendation for a recovery day.
 * Returns { seek: { start, end, label }, avoid: { start, end, label } | null }
 * All times are UTC Date objects.
 *
 * The phase response curve (PRC) for light:
 *   - Light in subjective morning (body clock 6 AM–noon) → phase advance (good for eastward)
 *   - Light in subjective evening/early night → phase delay (good for westward)
 *   - Light in subjective late night (body clock midnight–6 AM) → opposite effect; AVOID
 *
 * @param {Date}   dayDateUTC
 * @param {object} dest         - { lat, lng, tz }
 * @param {string} direction    - 'east' | 'west'
 * @param {Date}   bodyClock6AM - what UTC time the body currently perceives as 6 AM
 *                                (shifts by tzDiff/daysToAdapt each day)
 */
export function getLightRecommendation(dayDateUTC, dest, direction, bodyClock6AM) {
  const { sunrise, sunset } = getSunTimes(dayDateUTC, dest.lat, dest.lng);
  if (!sunrise || !sunset) return null;

  // Body clock "danger zone": midnight → 6 AM body time
  // Light during this window causes a phase DELAY even if it's morning locally
  const bodyClockMidnight = addHours(bodyClock6AM, -6);
  const dangerEnd = bodyClock6AM;

  if (direction === 'east') {
    // Seek morning light → phase advance
    const seekStart = sunrise;
    const seekEnd   = addHours(sunrise, 2);
    // Avoid if local morning overlaps with subjective midnight window
    const avoidWindow = { start: bodyClockMidnight, end: dangerEnd,
      label: 'Avoid bright light (body clock says it\'s past midnight — light now would delay your clock instead of advancing it)' };

    return {
      seek: { start: seekStart, end: seekEnd, label: 'Get 20–30 min of bright outdoor light (or a 10,000-lux lamp)' },
      avoid: avoidWindow,
    };
  } else {
    // Seek evening light → phase delay
    const seekStart = addHours(sunset, -1);
    const seekEnd   = addHours(sunset, +1);
    return {
      seek:  { start: seekStart, end: seekEnd, label: 'Get 20–30 min of bright light in the evening to delay your clock' },
      avoid: null,
    };
  }
}

/**
 * Melatonin recommendation for a recovery day.
 * Returns a Date (UTC) for when to take it, or null.
 * Dose: always 0.5 mg (physiological, not pharmacological).
 *
 * Eastward: take at destination 10 PM for the first ceil(absShift/2) days
 * Westward: only for very large shifts (>8 zones), take in the morning
 */
export function getMelatoninRecommendation(params, dayIndex, dayDateUTC, dest, destBedtimeHour = 22, destWakeHour = 7) {
  if (params.trivial) return null;

  if (params.direction === 'east') {
    const nDays = Math.ceil(params.absShift / 2);
    if (dayIndex > nDays) return null;
    const wc = wallClock(dayDateUTC, dest.tz);
    return makeLocalDate(dest.tz, wc.year, wc.month, wc.day, Math.floor(destBedtimeHour), Math.round((destBedtimeHour % 1) * 60));
  }

  if (params.direction === 'west' && params.absShift > 8) {
    const nDays = Math.ceil(params.absShift / 2);
    if (dayIndex > nDays) return null;
    const wc = wallClock(dayDateUTC, dest.tz);
    return makeLocalDate(dest.tz, wc.year, wc.month, wc.day, Math.floor(destWakeHour), Math.round((destWakeHour % 1) * 60));
  }

  return null;
}

/**
 * Caffeine cutoff time for a recovery day.
 * Returns a Date (UTC): bedtime minus 10 hours.
 */
export function getCaffeineDeadline(bedtimeUTC) {
  return addHours(bedtimeUTC, -10);
}

/**
 * Exercise window recommendation.
 * Returns { start: Date, end: Date, label: string }.
 */
export function getExerciseWindow(dayDateUTC, dest, direction, sleepBedtime = null) {
  const { sunrise } = getSunTimes(dayDateUTC, dest.lat, dest.lng);
  const wc = wallClock(dayDateUTC, dest.tz);

  if (direction === 'east') {
    // Morning exercise at destination → phase advance
    const start = sunrise ? addHours(sunrise, 1) : makeLocalDate(dest.tz, wc.year, wc.month, wc.day, 8, 0);
    return {
      start,
      end: addHours(start, 2),
      label: 'Morning exercise reinforces phase advance',
    };
  } else {
    // Late afternoon relative to target bedtime (4–2 hours before bed) → phase delay
    const start = sleepBedtime ? addHours(sleepBedtime, -4) : makeLocalDate(dest.tz, wc.year, wc.month, wc.day, 17, 0);
    const end   = sleepBedtime ? addHours(sleepBedtime, -2) : makeLocalDate(dest.tz, wc.year, wc.month, wc.day, 19, 0);
    return {
      start,
      end,
      label: 'Afternoon exercise helps delay your clock',
    };
  }
}

/**
 * Compute the body-clock 6 AM time for a given recovery day.
 * On day 0 (departure), body clock 6 AM = 6 AM origin time.
 * By day daysToAdapt, it has shifted to 6 AM destination time.
 */
export function getBodyClock6AM(dayIndex, params, origin, dest, departureDateUTC) {
  // Origin 6 AM in UTC
  const originWC = wallClock(departureDateUTC, origin.tz);
  const origin6AM = makeLocalDate(origin.tz, originWC.year, originWC.month, originWC.day, 6, 0);

  // Each day the body clock shifts by tzDiff/daysToAdapt hours
  const shiftPerDay = params.tzDiff / params.daysToAdapt;
  const totalShift  = shiftPerDay * Math.min(dayIndex, params.daysToAdapt);

  return addHours(origin6AM, totalShift);
}
