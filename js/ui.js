// UI helpers: airport autocomplete dropdown, modal, tabs, print

import { searchAirports, formatAirport } from './airports.js';

// ─── Airport Autocomplete ─────────────────────────────────────────────────────

/**
 * Wire up an airport search input with a custom dropdown.
 * @param {HTMLInputElement} input
 * @param {HTMLElement}      listEl   - the ul/div to render results into
 * @param {function}         onSelect - called with the airport object when selected
 */
export function initAirportInput(input, listEl, onSelect) {
  let activeIndex = -1;
  let currentResults = [];
  let selectedAirport = null;

  function closeDropdown() {
    listEl.hidden = true;
    listEl.innerHTML = '';
    activeIndex = -1;
    currentResults = [];
  }

  function renderDropdown(results) {
    listEl.innerHTML = '';
    if (!results.length) { closeDropdown(); return; }

    currentResults = results;
    listEl.hidden = false;
    activeIndex = -1;

    results.forEach((airport, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.index = i;
      li.className = 'airport-option';

      const iataSpan = document.createElement('span');
      iataSpan.className = 'airport-iata';
      iataSpan.textContent = airport.iata;

      const infoSpan = document.createElement('span');
      infoSpan.className = 'airport-info';
      infoSpan.textContent = `${airport.city || airport.name}`;

      const subSpan = document.createElement('span');
      subSpan.className = 'airport-sub';
      subSpan.textContent = airport.name !== airport.city ? ` — ${airport.name} (${airport.country})` : ` (${airport.country})`;

      infoSpan.appendChild(subSpan);
      li.appendChild(iataSpan);
      li.appendChild(infoSpan);

      li.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent blur before click
        selectAirport(airport);
      });
      listEl.appendChild(li);
    });
  }

  function selectAirport(airport) {
    selectedAirport = airport;
    input.value = formatAirport(airport);
    input.dataset.iata = airport.iata;
    closeDropdown();
    onSelect(airport);
  }

  function setActive(idx) {
    const items = listEl.querySelectorAll('.airport-option');
    items.forEach((el, i) => {
      const active = i === idx;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    activeIndex = idx;
    if (idx >= 0 && items[idx]) {
      input.setAttribute('aria-activedescendant', items[idx].id || '');
    }
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');
  listEl.setAttribute('role', 'listbox');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    selectedAirport = null;
    delete input.dataset.iata;
    if (q.length < 2) { closeDropdown(); return; }
    const results = searchAirports(q, 8);
    renderDropdown(results);
    input.setAttribute('aria-expanded', results.length ? 'true' : 'false');
  });

  input.addEventListener('keydown', e => {
    const items = listEl.querySelectorAll('.airport-option');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && currentResults[activeIndex]) {
        e.preventDefault();
        selectAirport(currentResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  input.addEventListener('blur', () => {
    // Small delay so mousedown on option fires first
    setTimeout(closeDropdown, 150);
  });

  // Return a method to get the currently selected airport
  return {
    getSelected: () => selectedAirport,
    setSelected: (airport) => {
      selectedAirport = airport;
      if (airport) {
        input.value = `${airport.iata} — ${airport.city} (${airport.country})`;
        input.dataset.iata = airport.iata;
      }
    },
    clear: () => { input.value = ''; selectedAirport = null; delete input.dataset.iata; closeDropdown(); },
  };
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function initModal(triggerEl, dialogEl) {
  triggerEl.addEventListener('click', () => {
    if (typeof dialogEl.showModal === 'function') {
      dialogEl.showModal();
    } else {
      dialogEl.setAttribute('open', '');
    }
  });

  dialogEl.addEventListener('click', e => {
    // Close when clicking the backdrop (outside the dialog content)
    if (e.target === dialogEl) {
      dialogEl.close ? dialogEl.close() : dialogEl.removeAttribute('open');
    }
  });

  const closeBtn = dialogEl.querySelector('.modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      dialogEl.close ? dialogEl.close() : dialogEl.removeAttribute('open');
    });
  }
}

// ─── Day Tabs (mobile) ────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} tabStrip   - container for tab buttons
 * @param {HTMLElement} cardsArea  - container for day cards
 */
export function initDayTabs(tabStrip, cardsArea) {
  function activateTab(index) {
    const tabs  = tabStrip.querySelectorAll('.day-tab');
    const cards = cardsArea.querySelectorAll('.day-card');
    tabs.forEach((t, i)  => t.classList.toggle('active', i === index));
    cards.forEach((c, i) => c.classList.toggle('active', i === index));
    // Scroll the active tab into view
    if (tabs[index]) tabs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  tabStrip.addEventListener('click', e => {
    const tab = e.target.closest('.day-tab');
    if (!tab) return;
    const idx = parseInt(tab.dataset.index, 10);
    activateTab(idx);
  });

  // Activate first tab by default
  activateTab(0);
}

// ─── Section visibility ───────────────────────────────────────────────────────

export function showEl(el) { el.hidden = false; }
export function hideEl(el) { el.hidden = true;  }

// ─── Print ────────────────────────────────────────────────────────────────────

export function triggerPrint() { window.print(); }

// ─── URL hash state ───────────────────────────────────────────────────────────

/**
 * Encode form state into the URL hash.
 * Format: #from=JFK&to=LHR&dep=2025-06-15T09:00&ret=2025-06-22T18:00
 */
export function encodeHash(from, to, dep, ret) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to',   to);
  if (dep)  params.set('dep',  dep);
  if (ret)  params.set('ret',  ret);
  window.location.hash = params.toString();
}

/**
 * Decode form state from the URL hash. Returns an object or null.
 */
export function decodeHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  try {
    const p = new URLSearchParams(hash);
    return {
      from: p.get('from') || '',
      to:   p.get('to')   || '',
      dep:  p.get('dep')  || '',
      ret:  p.get('ret')  || '',
    };
  } catch { return null; }
}
