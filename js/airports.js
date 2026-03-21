// Airport data loading and search

let airportList = null; // raw array, sorted by IATA
let loadPromise = null;

/**
 * Load airports.json once. Returns a promise that resolves when done.
 */
export function loadAirports() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch('data/airports.json')
    .then(r => r.json())
    .then(data => { airportList = data; });
  return loadPromise;
}

/**
 * Search airports by query string. Returns up to `limit` results.
 * Search order: IATA prefix → city name substring → airport name substring.
 */
export function searchAirports(query, limit = 8) {
  if (!airportList || !query || query.length < 2) return [];

  const q = query.trim().toUpperCase();
  const qLower = query.trim().toLowerCase();

  const iataExact = [];
  const iataPrefix = [];
  const cityMatch = [];
  const nameMatch = [];

  for (const a of airportList) {
    if (a.iata === q) {
      iataExact.push(a);
    } else if (a.iata.startsWith(q)) {
      iataPrefix.push(a);
    } else if (a.city.toLowerCase().includes(qLower)) {
      cityMatch.push(a);
    } else if (a.name.toLowerCase().includes(qLower)) {
      nameMatch.push(a);
    }
    if (iataExact.length + iataPrefix.length + cityMatch.length + nameMatch.length >= limit * 3) break;
  }

  return [...iataExact, ...iataPrefix, ...cityMatch, ...nameMatch].slice(0, limit);
}

/**
 * Get a single airport by IATA code. Returns null if not found.
 */
export function getAirportByIATA(iata) {
  if (!airportList) return null;
  const code = iata.trim().toUpperCase();
  // Binary search since array is sorted by IATA
  let lo = 0, hi = airportList.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = airportList[mid].iata.localeCompare(code);
    if (cmp === 0) return airportList[mid];
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * Format an airport for display in the dropdown.
 * e.g. "JFK — New York (US)"
 */
export function formatAirport(a) {
  const city = a.city || a.name;
  return `${a.iata} — ${city} (${a.country})`;
}
