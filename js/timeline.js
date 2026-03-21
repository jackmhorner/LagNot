// Timeline view — renders each day as a 24-hour vertical grid with activity pills

const HOUR_H = 44; // px per hour

// Which lane (column) each category occupies
const LANE = {
  'wake':        0,
  'stay-awake':  0,
  'sleep':       0,
  'light-seek':  1,
  'light-avoid': 1,
  'meal':        2,
  'melatonin':   2,
  'exercise':    2,
  'caffeine':       2,
  'caffeine-avoid': 2,
  'hydration':   2,
};

// Default duration in hours for each category
const DURATION = {
  'wake':        0.5,
  'stay-awake':  1,
  'sleep':       7.5,
  'light-seek':  2,
  'light-avoid': 3,
  'meal':        1,
  'melatonin':   0.5,
  'exercise':    1,
  'caffeine':       4,
  'caffeine-avoid': 4,
  'hydration':   0.5,
};

const LABEL = {
  'wake':        'Wake Up',
  'stay-awake':  'Stay Awake',
  'sleep':       'Sleep',
  'light-seek':  'Seek light',
  'light-avoid': 'Avoid light',
  'meal':        'Eat',
  'melatonin':   'Melatonin',
  'exercise':    'Exercise',
  'caffeine':       'Caffeine OK',
  'caffeine-avoid': 'No Caffeine',
  'hydration':   'Hydrate',
};

/**
 * Render all days as timeline cards into cardsAreaEl.
 * todayIndex: index of the day matching today's calendar date, or -1.
 */
export function renderTimeline(days, cardsAreaEl, todayIndex = -1) {
  cardsAreaEl.innerHTML = '';
  days.forEach((day, i) => {
    cardsAreaEl.appendChild(buildTimelineCard(day, i, i === todayIndex));
  });
}

function buildTimelineCard(day, index, isToday = false) {
  const card = document.createElement('div');
  card.className = 'day-card tl-card';
  card.id = `day-card-${index}`;

  // Header
  const header = document.createElement('div');
  header.className = 'day-card-title';
  header.innerHTML = `<span>${day.label}</span>`;
  card.appendChild(header);

  // Lane header row
  const laneHeader = document.createElement('div');
  laneHeader.className = 'tl-lane-header';
  laneHeader.innerHTML = `
    <div class="tl-time-col"></div>
    <div class="tl-lanes">
      <div class="tl-lane-label">Sleep</div>
      <div class="tl-lane-label">Light</div>
      <div class="tl-lane-label">Activities</div>
    </div>
  `;
  card.appendChild(laneHeader);

  // Grid
  card.appendChild(buildGrid(day, isToday));

  // Milestone markers (departure / arrival)
  const milestones = day.items.filter(i => i.category === 'milestone' && i.sortKey);
  if (milestones.length) {
    const list = document.createElement('div');
    list.className = 'tl-milestones';
    milestones.forEach(m => {
      const el = document.createElement('div');
      el.className = 'tl-milestone-note';
      el.textContent = `${m.icon || '✈️'} ${m.time} — ${m.text}`;
      list.appendChild(el);
    });
    card.appendChild(list);
  }

  return card;
}

function buildGrid(day, isToday = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tl-wrapper';

  // Left: hour labels
  const timeCol = document.createElement('div');
  timeCol.className = 'tl-time-col';
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'tl-hour-lbl';
    lbl.style.height = `${HOUR_H}px`;
    lbl.textContent = formatHour(h);
    timeCol.appendChild(lbl);
  }
  wrapper.appendChild(timeCol);

  // Right: pill lanes
  const lanesEl = document.createElement('div');
  lanesEl.className = 'tl-lanes';
  lanesEl.style.height = `${24 * HOUR_H}px`;

  // Hour rule lines
  for (let h = 0; h < 24; h++) {
    const rule = document.createElement('div');
    rule.className = 'tl-rule';
    rule.style.top = `${h * HOUR_H}px`;
    lanesEl.appendChild(rule);
  }

  // Build pills grouped by lane — separate all-day from timed items
  const laneGroups = [
    { timed: [], allDay: [] },
    { timed: [], allDay: [] },
    { timed: [], allDay: [] },
  ];
  for (const item of day.items) {
    const laneIdx = LANE[item.category];
    if (laneIdx === undefined || !item.sortKey) continue;

    if (item.allDay) {
      laneGroups[laneIdx].allDay.push(item);
      continue;
    }

    const startH = localHour(item.sortKey, day.tz);
    let dur;
    if (item.timelineEnd) {
      const endH = localHour(item.timelineEnd, day.tz);
      const adjustedEndH = endH < startH ? endH + 24 : endH;
      dur = Math.min(adjustedEndH - startH, 24 - startH);
    } else {
      const defaultDur = item.durationHours !== undefined ? item.durationHours : (DURATION[item.category] || 1);
      dur = Math.min(defaultDur, 24 - startH);
    }
    laneGroups[laneIdx].timed.push({ item, startH, dur });
  }

  laneGroups.forEach(({ timed, allDay }, laneIdx) => {
    const laneEl = document.createElement('div');
    laneEl.className = `tl-lane tl-lane-${laneIdx}`;
    const hasAllDay = allDay.length > 0;
    if (hasAllDay) laneEl.classList.add('has-allday');

    timed.forEach(({ item, startH, dur }) => {
      laneEl.appendChild(buildPill(item, startH, dur));
    });
    allDay.forEach(item => {
      laneEl.appendChild(buildAllDayPill(item));
    });

    lanesEl.appendChild(laneEl);
  });

  // Now-line: red horizontal rule at the current time (today only)
  if (isToday) {
    const nowH = localHour(new Date(), day.tz);
    const nowLine = document.createElement('div');
    nowLine.className = 'tl-now-line';
    nowLine.style.top = `${nowH * HOUR_H}px`;
    lanesEl.appendChild(nowLine);
  }

  wrapper.appendChild(lanesEl);
  return wrapper;
}

function buildPill(item, startH, dur) {
  // Display at least 1 hour tall — extend downward, never move the start up
  const displayDur = Math.max(dur, 1);

  const pill = document.createElement('div');
  pill.className = `tl-pill tl-pill--${item.category}`;
  pill.style.top = `${startH * HOUR_H}px`;
  pill.style.height = `${displayDur * HOUR_H - 3}px`;
  pill.title = item.text;

  const icon = document.createElement('span');
  icon.className = 'tl-pill-icon';
  icon.textContent = item.icon || '';
  pill.appendChild(icon);

  if (displayDur >= 1) {
    const lbl = document.createElement('span');
    lbl.className = 'tl-pill-label';
    lbl.textContent = LABEL[item.category] || '';
    pill.appendChild(lbl);
  }

  return pill;
}

function buildAllDayPill(item) {
  const pill = document.createElement('div');
  pill.className = `tl-pill tl-pill--${item.category} tl-pill--allday`;
  pill.style.height = `${24 * HOUR_H}px`;
  pill.title = item.text;

  const icon = document.createElement('span');
  icon.className = 'tl-pill-icon';
  icon.textContent = item.icon || '';
  pill.appendChild(icon);

  return pill;
}

function localHour(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === 'hour').value);
  const m = parseInt(parts.find(p => p.type === 'minute').value);
  // Intl returns hour 24 as 0 for midnight — normalise
  return (h === 24 ? 0 : h) + m / 60;
}

function formatHour(h) {
  if (h === 0)  return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
