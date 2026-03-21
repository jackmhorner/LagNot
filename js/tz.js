// Timezone utilities using the native Intl API (no external library)

/**
 * Returns the UTC offset in fractional hours for a given IANA timezone at a specific date.
 * e.g., America/New_York in summer → -4.0
 */
export function tzOffsetHours(ianaZone, date = new Date()) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const localStr = date.toLocaleString('en-US', { timeZone: ianaZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (parseLocaleStr(localStr) - parseLocaleStr(utcStr)) / 3_600_000;
}

function parseLocaleStr(str) {
  // Format: MM/DD/YYYY, HH:MM:SS  (en-US locale)
  const [datePart, timePart] = str.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  let [hour, minute, second] = timePart.split(':').map(Number);
  // Handle 24:00 edge case from some browsers
  if (hour === 24) hour = 0;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Given a UTC Date and an IANA timezone, return a plain object representing
 * the wall-clock date/time in that zone: { year, month (1-12), day, hour, minute, weekday }
 */
export function wallClock(date, ianaZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'long',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour) % 24, // normalize 24→0
    minute: parseInt(parts.minute),
    weekday: parts.weekday,
  };
}

/**
 * Create a UTC Date that represents a specific wall-clock time in an IANA timezone.
 * e.g., makeLocalDate('America/New_York', 2025, 6, 15, 22, 30) → the UTC Date for 10:30 PM EDT
 *
 * Uses binary search to find the correct UTC instant.
 */
export function makeLocalDate(ianaZone, year, month, day, hour = 0, minute = 0) {
  // Approximate UTC first
  const approxUTC = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetHours(ianaZone, new Date(approxUTC));
  return new Date(approxUTC - offset * 3_600_000);
}

/**
 * Format a UTC Date as a time string in a given IANA timezone.
 * Returns e.g. "10:30 PM"
 */
export function formatTime(date, ianaZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Format a UTC Date as a short date string in a given IANA timezone.
 * Returns e.g. "Monday, June 15"
 */
export function formatDate(date, ianaZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Format a UTC Date as a short date: "Jun 15"
 */
export function formatShortDate(date, ianaZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Add hours to a Date, returning a new Date.
 */
export function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3_600_000);
}

/**
 * Add days to a Date, returning a new Date.
 */
export function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Get midnight (00:00) of the next calendar day in a given timezone.
 */
export function startOfNextDay(date, ianaZone) {
  const wc = wallClock(date, ianaZone);
  return makeLocalDate(ianaZone, wc.year, wc.month, wc.day + 1, 0, 0);
}

/**
 * Get midnight (00:00) of the current calendar day in a given timezone.
 */
export function startOfDay(date, ianaZone) {
  const wc = wallClock(date, ianaZone);
  return makeLocalDate(ianaZone, wc.year, wc.month, wc.day, 0, 0);
}
