// DOM rendering — turns the schedule model into HTML

import { wallClock } from './tz.js';

const MILESTONE_CATEGORIES = new Set(['milestone']);

const CATEGORY_META = {
  'sleep':       { color: 'navy',   label: 'Sleep'    },
  'wake':        { color: 'navy',   label: 'Wake Up'   },
  'stay-awake':  { color: 'navy',   label: 'Stay Awake'},
  'light-seek':  { color: 'amber',  label: 'Light ☀️' },
  'light-avoid': { color: 'red',    label: 'No Light' },
  'meal':        { color: 'green',  label: 'Meal'     },
  'melatonin':   { color: 'purple', label: 'Melatonin'},
  'exercise':    { color: 'teal',   label: 'Exercise' },
  'caffeine':    { color: 'brown',  label: 'Caffeine' },
  'hydration':   { color: 'blue',   label: 'Hydration'},
  'info':        { color: 'gray',   label: 'Note'     },
};

/**
 * Render the summary strip above the schedule.
 */
export function renderSummary(summary, el) {
  const { origin, dest, tzDiff, direction, absShift, daysToAdapt, trivial, flightHours } = summary;
  const dir = direction === 'east' ? 'eastward ›' : '‹ westward';
  const zones = absShift === 1 ? '1 time zone' : `${absShift.toFixed(absShift % 1 === 0 ? 0 : 1)} time zones`;

  el.innerHTML = `
    <div class="summary-route">
      <span class="summary-airport">${origin.iata}<br><small>${origin.city}</small></span>
      <span class="summary-arrow">${dir}</span>
      <span class="summary-airport">${dest.iata}<br><small>${dest.city}</small></span>
    </div>
    <div class="summary-stats">
      <div class="stat"><span class="stat-value">${zones}</span><span class="stat-label">crossed</span></div>
      <div class="stat"><span class="stat-value">${Math.round(flightHours)}h</span><span class="stat-label">flight</span></div>
      ${trivial
        ? `<div class="stat trivial"><span class="stat-value">Minimal</span><span class="stat-label">jet lag expected</span></div>`
        : `<div class="stat"><span class="stat-value">${daysToAdapt}</span><span class="stat-label">days to adapt</span></div>`}
    </div>
  `;
}

/**
 * Render both the sidebar day list (desktop) and the tab strip (mobile).
 */
export function renderDayNav(days, sidebarEl, tabStripEl) {
  sidebarEl.innerHTML = '';
  tabStripEl.innerHTML = '';

  days.forEach((day, i) => {
    const phaseClass = `phase-${day.phase}`;

    // Sidebar item (desktop)
    const li = document.createElement('li');
    li.className = `day-nav-item ${phaseClass}`;
    li.dataset.index = i;
    li.textContent = day.label;
    sidebarEl.appendChild(li);

    // Tab (mobile)
    const btn = document.createElement('button');
    btn.className = `day-tab ${phaseClass}`;
    btn.dataset.index = i;
    btn.textContent = shortLabel(day);
    tabStripEl.appendChild(btn);
  });

  // Sidebar click handler
  sidebarEl.addEventListener('click', e => {
    const item = e.target.closest('.day-nav-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index, 10);
    activateDay(idx, sidebarEl, document.querySelector('#cards-area'));
  });
}

function shortLabel(day) {
  if (day.phase === 'pre-departure') return day.label.split('—')[0].trim();
  if (day.phase === 'flight')        return '✈️ Flight';
  if (day.phase === 'recovery')      return day.label.split('—')[0].trim().replace('Day ', 'Day ');
  return day.label.split('—')[0].trim();
}

/**
 * Render all day cards into the cards area.
 * todayIndex: index of the day matching today's calendar date, or -1.
 */
export function renderDayCards(days, cardsAreaEl, todayIndex = -1) {
  cardsAreaEl.innerHTML = '';
  days.forEach((day, i) => {
    const card = renderDayCard(day, i, i === todayIndex);
    cardsAreaEl.appendChild(card);
  });
}

function findCurrentItemIndex(items) {
  const now = new Date();
  let current = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].sortKey instanceof Date && items[i].sortKey <= now) {
      current = i;
    }
  }
  return current;
}

function renderDayCard(day, index, isToday = false) {
  const card = document.createElement('div');
  card.className = `day-card phase-${day.phase}`;
  card.dataset.index = index;

  const heading = document.createElement('h2');
  heading.className = 'day-card-title';
  heading.textContent = day.label;
  card.appendChild(heading);

  if (day.items.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No specific recommendations for this day.';
    card.appendChild(empty);
    return card;
  }

  const currentItemIdx = isToday ? findCurrentItemIndex(day.items) : -1;

  const list = document.createElement('ul');
  list.className = 'schedule-list';
  day.items.forEach((item, i) => list.appendChild(renderScheduleItem(item, i === currentItemIdx)));
  card.appendChild(list);

  return card;
}

function renderMilestone(item) {
  const li = document.createElement('li');
  li.className = 'schedule-milestone';
  li.innerHTML = `
    <span class="milestone-icon">${item.icon}</span>
    <span class="milestone-text">${item.text}</span>
    <span class="milestone-time">${item.time}</span>
  `;
  return li;
}

function renderScheduleItem(item, isCurrent = false) {
  if (MILESTONE_CATEGORIES.has(item.category)) {
    return renderMilestone(item);
  }

  const li = document.createElement('li');
  li.className = `schedule-item cat-${item.category}${isCurrent ? ' current-step' : ''}`;

  const meta = CATEGORY_META[item.category] || CATEGORY_META.info;

  const timeEl = document.createElement('span');
  timeEl.className = 'item-time';
  timeEl.textContent = item.time || '';

  const iconEl = document.createElement('span');
  iconEl.className = 'item-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = item.icon || '';

  const chip = document.createElement('span');
  chip.className = `item-chip chip-${meta.color}`;
  chip.textContent = meta.label;

  const textEl = document.createElement('span');
  textEl.className = 'item-text';
  textEl.textContent = item.text;

  li.appendChild(timeEl);
  li.appendChild(iconEl);
  const body = document.createElement('span');
  body.className = 'item-body';
  body.appendChild(chip);
  body.appendChild(textEl);
  li.appendChild(body);

  return li;
}

/**
 * Activate a day by index.
 * On mobile: show/hide cards. On desktop: scroll to the card.
 */
export function activateDay(index, sidebarEl, cardsAreaEl) {
  const navItems = sidebarEl.querySelectorAll('.day-nav-item');
  const cards    = cardsAreaEl.querySelectorAll('.day-card');

  navItems.forEach((el, i) => el.classList.toggle('active', i === index));
  cards.forEach((el, i)    => el.classList.toggle('active', i === index));

  // On desktop, scroll cards area so the card title aligns with the top
  const card = cards[index];
  if (card && window.innerWidth >= 768) {
    const areaTop = cardsAreaEl.getBoundingClientRect().top;
    const cardTop = card.getBoundingClientRect().top;
    const target  = cardsAreaEl.scrollTop + (cardTop - areaTop);
    cardsAreaEl.scrollTo({ top: target, behavior: 'smooth' });
  }
}

/**
 * Wire an IntersectionObserver so the sidebar highlight tracks scroll position.
 */
export function initScrollSpy(sidebarEl, cardsAreaEl, onDayChange) {
  if (window.innerWidth < 768) return;

  const navItems = Array.from(sidebarEl.querySelectorAll('.day-nav-item'));
  const cards    = Array.from(cardsAreaEl.querySelectorAll('.day-card'));
  if (!cards.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = cards.indexOf(entry.target);
        if (idx >= 0) {
          navItems.forEach((el, i) => el.classList.toggle('active', i === idx));
          onDayChange?.(idx);
          // Scroll the sidebar itself (not the page) to keep the active item visible
          const item = navItems[idx];
          if (item) {
            const itemTop = item.offsetTop;
            const itemBottom = itemTop + item.offsetHeight;
            const sTop = sidebarEl.scrollTop;
            const sBottom = sTop + sidebarEl.clientHeight;
            if (itemTop < sTop) sidebarEl.scrollTop = itemTop;
            else if (itemBottom > sBottom) sidebarEl.scrollTop = itemBottom - sidebarEl.clientHeight;
          }
        }
      }
    });
  }, {
    root: cardsAreaEl,
    rootMargin: '0px 0px -60% 0px',
    threshold: 0,
  });

  cards.forEach(card => observer.observe(card));
}
