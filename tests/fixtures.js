// Shared airport fixtures and helpers for tests.
// All use summer 2025 dates (June 15) to keep DST offsets predictable.
//   America/New_York  → UTC-4 (EDT)
//   Europe/London     → UTC+1 (BST)
//   America/Los_Angeles → UTC-7 (PDT)
//   Asia/Tokyo        → UTC+9  (no DST)
//   Australia/Sydney  → UTC+10 (AEST — southern hemisphere winter)
//   Asia/Dubai        → UTC+4  (no DST)

export const JFK = { iata: 'JFK', name: 'JFK', city: 'New York',      lat: 40.64,  lng: -73.78,  tz: 'America/New_York'     };
export const LHR = { iata: 'LHR', name: 'LHR', city: 'London',        lat: 51.48,  lng:  -0.45,  tz: 'Europe/London'         };
export const LAX = { iata: 'LAX', name: 'LAX', city: 'Los Angeles',   lat: 33.94,  lng: -118.41, tz: 'America/Los_Angeles'  };
export const NRT = { iata: 'NRT', name: 'NRT', city: 'Tokyo',         lat: 35.76,  lng: 140.39,  tz: 'Asia/Tokyo'            };
export const SYD = { iata: 'SYD', name: 'SYD', city: 'Sydney',        lat: -33.95, lng: 151.18,  tz: 'Australia/Sydney'      };
export const DXB = { iata: 'DXB', name: 'DXB', city: 'Dubai',         lat: 25.25,  lng:  55.36,  tz: 'Asia/Dubai'            };
export const ORD = { iata: 'ORD', name: 'ORD', city: 'Chicago',       lat: 41.98,  lng: -87.90,  tz: 'America/Chicago'       };
export const SIN = { iata: 'SIN', name: 'SIN', city: 'Singapore',     lat:  1.36,  lng: 103.99,  tz: 'Asia/Singapore'        };

/**
 * Departure at a given local time on 2025-06-15 at the origin airport.
 * Returns a UTC Date.
 */
export function dep(airport, hour, minute = 0) {
  // Simple approximation: subtract the known summer offset for each tz.
  const offsets = {
    'America/New_York':    -4,
    'Europe/London':       +1,
    'America/Los_Angeles': -7,
    'Asia/Tokyo':          +9,
    'Australia/Sydney':    +10,
    'Asia/Dubai':          +4,
    'America/Chicago':     -5,
    'Asia/Singapore':      +8,
  };
  const offset = offsets[airport.tz] ?? 0;
  return new Date(Date.UTC(2025, 5, 15, hour - offset, minute)); // month 5 = June
}

/** Hours between two Dates. */
export function hoursBetween(a, b) {
  return (b - a) / 3_600_000;
}
