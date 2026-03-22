import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tzOffsetHours, wallClock, makeLocalDate, addHours } from '../js/tz.js';

const SUMMER = new Date('2025-06-15T12:00:00Z');
const WINTER = new Date('2025-01-15T12:00:00Z');

describe('tzOffsetHours', () => {
  it('New York is UTC-4 in summer (EDT)', () => {
    assert.equal(tzOffsetHours('America/New_York', SUMMER), -4);
  });

  it('New York is UTC-5 in winter (EST)', () => {
    assert.equal(tzOffsetHours('America/New_York', WINTER), -5);
  });

  it('London is UTC+1 in summer (BST)', () => {
    assert.equal(tzOffsetHours('Europe/London', SUMMER), 1);
  });

  it('London is UTC+0 in winter (GMT)', () => {
    assert.equal(tzOffsetHours('Europe/London', WINTER), 0);
  });

  it('Tokyo is UTC+9 year-round (no DST)', () => {
    assert.equal(tzOffsetHours('Asia/Tokyo', SUMMER), 9);
    assert.equal(tzOffsetHours('Asia/Tokyo', WINTER), 9);
  });

  it('Los Angeles is UTC-7 in summer (PDT)', () => {
    assert.equal(tzOffsetHours('America/Los_Angeles', SUMMER), -7);
  });
});

describe('wallClock', () => {
  it('returns correct local time for New York in summer', () => {
    const noon_utc = new Date('2025-06-15T16:00:00Z'); // 12:00 EDT
    const wc = wallClock(noon_utc, 'America/New_York');
    assert.equal(wc.year,   2025);
    assert.equal(wc.month,  6);
    assert.equal(wc.day,    15);
    assert.equal(wc.hour,   12);
    assert.equal(wc.minute, 0);
  });

  it('handles day boundary correctly (UTC midnight = 9am Tokyo)', () => {
    const midnight_utc = new Date('2025-06-15T00:00:00Z');
    const wc = wallClock(midnight_utc, 'Asia/Tokyo');
    assert.equal(wc.hour, 9);
    assert.equal(wc.day,  15);
  });

  it('handles previous day when west of UTC', () => {
    const early_utc = new Date('2025-06-15T02:00:00Z'); // still June 14 in LA (UTC-7)
    const wc = wallClock(early_utc, 'America/Los_Angeles');
    assert.equal(wc.day,  14);
    assert.equal(wc.hour, 19);
  });
});

describe('makeLocalDate', () => {
  it('creates a UTC Date for 10 PM in New York (summer)', () => {
    const d = makeLocalDate('America/New_York', 2025, 6, 15, 22, 0);
    const wc = wallClock(d, 'America/New_York');
    assert.equal(wc.hour,   22);
    assert.equal(wc.minute, 0);
    assert.equal(wc.day,    15);
  });

  it('creates a UTC Date for 7 AM in Tokyo', () => {
    const d = makeLocalDate('Asia/Tokyo', 2025, 6, 15, 7, 0);
    const wc = wallClock(d, 'Asia/Tokyo');
    assert.equal(wc.hour, 7);
    assert.equal(wc.day,  15);
  });

  it('round-trips: makeLocalDate → wallClock gives same time', () => {
    const zones = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles'];
    for (const tz of zones) {
      const d = makeLocalDate(tz, 2025, 6, 15, 14, 30);
      const wc = wallClock(d, tz);
      assert.equal(wc.hour,   14, `hour mismatch for ${tz}`);
      assert.equal(wc.minute, 30, `minute mismatch for ${tz}`);
    }
  });
});

describe('addHours', () => {
  it('adds positive hours', () => {
    const base = new Date('2025-06-15T10:00:00Z');
    const result = addHours(base, 5);
    assert.equal(result.toISOString(), '2025-06-15T15:00:00.000Z');
  });

  it('adds fractional hours', () => {
    const base = new Date('2025-06-15T10:00:00Z');
    const result = addHours(base, 0.5);
    assert.equal(result.toISOString(), '2025-06-15T10:30:00.000Z');
  });

  it('subtracts hours with negative value', () => {
    const base = new Date('2025-06-15T10:00:00Z');
    const result = addHours(base, -3);
    assert.equal(result.toISOString(), '2025-06-15T07:00:00.000Z');
  });
});
