// Entry point — wires up the form, runs the schedule, renders the result.

import { loadAirports } from './airports.js';
import { generateSchedule } from './schedule.js';
import { renderSummary, renderDayNav, renderDayCards, activateDay } from './render.js';
import { initAirportInput, initModal, initDayTabs, showEl, hideEl, encodeHash, decodeHash, triggerPrint } from './ui.js';
import { makeLocalDate } from './tz.js';

// ─── DOM references ───────────────────────────────────────────────────────────
const fromInput     = document.getElementById('from-input');
const fromList      = document.getElementById('from-list');
const toInput       = document.getElementById('to-input');
const toList        = document.getElementById('to-list');
const depDateTime   = document.getElementById('dep-datetime');
const retDateTime   = document.getElementById('ret-datetime');
const form          = document.getElementById('trip-form');
const formSection   = document.getElementById('form-section');
const resultsSection= document.getElementById('results-section');
const summaryEl     = document.getElementById('summary-strip');
const sidebarEl     = document.getElementById('day-sidebar');
const tabStripEl    = document.getElementById('tab-strip');
const cardsAreaEl   = document.getElementById('cards-area');
const helpBtn       = document.getElementById('help-btn');
const helpDialog    = document.getElementById('help-dialog');
const resetBtn      = document.getElementById('reset-btn');
const printBtn      = document.getElementById('print-btn');
const formError     = document.getElementById('form-error');
const loadingEl     = document.getElementById('loading');

// ─── Airport inputs ───────────────────────────────────────────────────────────
const fromCtrl = initAirportInput(fromInput, fromList, () => {});
const toCtrl   = initAirportInput(toInput,   toList,   () => {});

// ─── Modal ────────────────────────────────────────────────────────────────────
initModal(helpBtn, helpDialog);

// ─── Print ────────────────────────────────────────────────────────────────────
printBtn.addEventListener('click', triggerPrint);

// ─── Reset ────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  hideEl(resultsSection);
  showEl(formSection);
  window.location.hash = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── Form submit ──────────────────────────────────────────────────────────────
form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.hidden = true;

  const origin = fromCtrl.getSelected();
  const dest   = toCtrl.getSelected();

  if (!origin) { showError('Please select a departure airport from the dropdown.'); return; }
  if (!dest)   { showError('Please select a destination airport from the dropdown.'); return; }
  if (origin.iata === dest.iata) { showError('Departure and destination must be different airports.'); return; }

  const depVal = depDateTime.value; // "YYYY-MM-DDTHH:MM"
  if (!depVal) { showError('Please enter a departure date and time.'); return; }

  // Parse departure as local time at origin
  const [depDate, depTime] = depVal.split('T');
  const [depY, depM, depD] = depDate.split('-').map(Number);
  const [depH, depMin]     = depTime.split(':').map(Number);
  const departureUTC = makeLocalDate(origin.tz, depY, depM, depD, depH, depMin);

  // Estimate arrival: use a rough formula (great-circle not needed — we just need reasonable timing)
  // Actual arrival can be calculated properly; for now use a simple distance-based estimate
  const flightHours = estimateFlightHours(origin.lat, origin.lng, dest.lat, dest.lng);
  const arrivalUTC  = new Date(departureUTC.getTime() + flightHours * 3_600_000);

  // Optional return
  let returnUTC = null;
  const retVal = retDateTime.value;
  if (retVal) {
    const [retDate, retTime] = retVal.split('T');
    const [retY, retM, retD] = retDate.split('-').map(Number);
    const [retH, retMin]     = retTime.split(':').map(Number);
    returnUTC = makeLocalDate(dest.tz, retY, retM, retD, retH, retMin);

    if (returnUTC <= arrivalUTC) {
      showError('Return date must be after your arrival at the destination.'); return;
    }
  }

  // Encode state in URL hash for sharing
  encodeHash(origin.iata, dest.iata, depVal, retVal || '');

  // Show loading
  hideEl(formSection);
  showEl(loadingEl);

  // Small tick to let the browser paint the loading state
  await new Promise(r => setTimeout(r, 50));

  try {
    const schedule = generateSchedule(origin, dest, departureUTC, arrivalUTC, returnUTC);
    renderSchedule(schedule);
  } catch (err) {
    console.error(err);
    showError('Something went wrong generating your plan. Please try again.');
    hideEl(loadingEl);
    showEl(formSection);
    return;
  }

  hideEl(loadingEl);
  showEl(resultsSection);
  resultsSection.scrollIntoView({ behavior: 'smooth' });
});

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSchedule(schedule) {
  renderSummary(schedule.summary, summaryEl);
  renderDayNav(schedule.days, sidebarEl, tabStripEl);
  renderDayCards(schedule.days, cardsAreaEl);

  // Activate day 0 on desktop sidebar
  activateDay(0, sidebarEl, cardsAreaEl);

  // Wire desktop sidebar click to also update cards
  sidebarEl.addEventListener('click', e => {
    const item = e.target.closest('.day-nav-item');
    if (!item) return;
    activateDay(parseInt(item.dataset.index, 10), sidebarEl, cardsAreaEl);
  });

  // Wire mobile tabs
  initDayTabs(tabStripEl, cardsAreaEl);
}

// ─── Error display ────────────────────────────────────────────────────────────

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Flight duration estimate ─────────────────────────────────────────────────
// Simple great-circle distance → speed ~850 km/h + 1h for taxi/approach

function estimateFlightHours(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  const distKm = 2 * R * Math.asin(Math.sqrt(a));
  return Math.max(1, distKm / 850 + 1);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Load airport data
  await loadAirports();

  // Restore from URL hash if present
  const state = decodeHash();
  if (state && state.from && state.to && state.dep) {
    // Pre-fill the form silently; user still hits "Generate"
    // The airport inputs need the full object, so attempt lookup
    const { getAirportByIATA } = await import('./airports.js');
    const fromAirport = getAirportByIATA(state.from);
    const toAirport   = getAirportByIATA(state.to);
    if (fromAirport) { fromInput.value = `${fromAirport.iata} — ${fromAirport.city} (${fromAirport.country})`; fromInput.dataset.iata = fromAirport.iata; fromCtrl._setSelected && fromCtrl._setSelected(fromAirport); }
    if (toAirport)   { toInput.value   = `${toAirport.iata}   — ${toAirport.city} (${toAirport.country})`;   toInput.dataset.iata   = toAirport.iata;   toCtrl._setSelected   && toCtrl._setSelected(toAirport);   }
    if (state.dep) depDateTime.value = state.dep;
    if (state.ret) retDateTime.value = state.ret;
  }
}

// Expose getSelected on the controls so hash restore can set them
// (patching the controllers after the fact)
fromCtrl._setSelected = airport => { fromCtrl._selected = airport; fromCtrl.getSelected = () => airport; };
toCtrl._setSelected   = airport => { toCtrl._selected   = airport; toCtrl.getSelected   = () => airport; };

init().catch(console.error);
