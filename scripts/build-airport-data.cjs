#!/usr/bin/env node
// Run once: node scripts/build-airport-data.js
// Downloads airports.csv from OurAirports and writes data/airports.json

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { find: geoTzFind } = require('geo-tz');

const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT_PATH = path.join(__dirname, '..', 'data', 'airports.json');

function downloadCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, res2 => resolve(res2)).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      resolve(res);
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  console.log('Downloading airports.csv from OurAirports...');
  const stream = await downloadCSV(CSV_URL);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  const airports = [];
  let lineCount = 0;
  let processed = 0;

  for await (const line of rl) {
    lineCount++;
    const fields = parseCSVLine(line);

    if (lineCount === 1) {
      headers = fields.map(h => h.replace(/"/g, ''));
      continue;
    }

    const row = {};
    headers.forEach((h, i) => { row[h] = (fields[i] || '').replace(/^"|"$/g, '').trim(); });

    // Only keep airports with a valid 3-letter IATA code
    if (!row.iata_code || row.iata_code.length !== 3) continue;

    // Only keep medium/large airports (most useful for international travel)
    if (!['large_airport', 'medium_airport'].includes(row.type)) continue;

    const lat = parseFloat(row.latitude_deg);
    const lng = parseFloat(row.longitude_deg);
    if (isNaN(lat) || isNaN(lng)) continue;

    // Look up timezone from coordinates
    const tzResults = geoTzFind(lat, lng);
    const tz = tzResults && tzResults.length > 0 ? tzResults[0] : null;
    if (!tz) continue;

    airports.push({
      iata: row.iata_code.toUpperCase(),
      name: row.name,
      city: row.municipality || '',
      country: row.iso_country || '',
      lat,
      lng,
      tz,
    });

    processed++;
    if (processed % 1000 === 0) process.stdout.write(`  Processed ${processed}...\r`);
  }

  // Sort by IATA for predictable lookup
  airports.sort((a, b) => a.iata.localeCompare(b.iata));

  fs.writeFileSync(OUT_PATH, JSON.stringify(airports));
  console.log(`\nDone. Wrote ${airports.length} airports to ${OUT_PATH}`);
  console.log(`File size: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB`);
}

main().catch(err => { console.error(err); process.exit(1); });
