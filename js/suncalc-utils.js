// Wrapper around the SunCalc library for sunrise/sunset calculations.
// SunCalc must be loaded as a global script before this module.

/**
 * Get sunrise, solar noon, and sunset times for a given UTC date and location.
 * Returns times as UTC Date objects, or null if the sun doesn't rise/set (polar).
 *
 * @param {Date} date - any date (UTC); the calendar day at the target location is used
 * @param {number} lat
 * @param {number} lng
 * @returns {{ sunrise: Date|null, solarNoon: Date|null, sunset: Date|null }}
 */
export function getSunTimes(date, lat, lng) {
  if (typeof SunCalc === 'undefined') {
    console.warn('SunCalc not loaded');
    // Return reasonable defaults
    const d = new Date(date);
    d.setUTCHours(6, 0, 0, 0);
    const noon = new Date(date);
    noon.setUTCHours(12, 0, 0, 0);
    const dusk = new Date(date);
    dusk.setUTCHours(20, 0, 0, 0);
    return { sunrise: d, solarNoon: noon, sunset: dusk };
  }

  const times = SunCalc.getTimes(date, lat, lng);
  return {
    sunrise: isValidSunTime(times.sunrise) ? times.sunrise : null,
    solarNoon: isValidSunTime(times.solarNoon) ? times.solarNoon : null,
    sunset: isValidSunTime(times.sunset) ? times.sunset : null,
  };
}

function isValidSunTime(d) {
  return d instanceof Date && !isNaN(d.getTime());
}
