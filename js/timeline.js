// Timeline view — renders each day as a 24-hour vertical grid with activity pills

const HOUR_H = 44; // px per hour

// These categories carry text info only — skip in the pill grid
const SKIP_IN_TIMELINE = new Set(['milestone', 'info']);

// Duration fallback (hours) — used only when no timelineEnd / durationHours is set
const DURATION = {
  'wake':           0.5,
  'stay-awake':     1,
  'sleep':          7.5,
  'light-seek':     2,
  'light-avoid':    3,
  'meal':           1,
  'melatonin':      0.5,
  'exercise':       1,
  'caffeine':       4,
  'caffeine-avoid': 4,
  'hydration':      0.5,
  'flight':         8,
};

const LABEL = {
  'wake':           'Wake',
  'stay-awake':     'Stay Awake',
  'sleep':          'Sleep',
  'light-seek':     'Seek Light',
  'light-avoid':    'Avoid Light',
  'meal':           'Eat',
  'melatonin':      'Melatonin',
  'exercise':       'Exercise',
  'caffeine':       'Caffeine OK',
  'caffeine-avoid': 'No Caffeine',
  'hydration':      'Hydrate',
  'flight':         'Flight',
};

/**
 * Compute the raw start/end hours (fractional, 0–∞) for an item within its day.
 * Returns null if the item should be skipped.
 */
function itemHours(item, tz) {
  if (!item.sortKey || SKIP_IN_TIMELINE.has(item.category)) return null;
  if (item.allDay) return { startH: 0, endH: 24 };

  const startH = localHour(item.sortKey, tz);
  let endH;
  if (item.timelineEnd) {
    const rawEnd = localHour(item.timelineEnd, tz);
    // Cross-midnight: rawEnd will be smaller than startH
    endH = rawEnd < startH ? rawEnd + 24 : rawEnd;
  } else {
    const dur = item.durationHours !== undefined
      ? item.durationHours
      : (DURATION[item.category] || 1);
    endH = startH + dur;
  }
  return { startH, endH };
}

/**
 * Render all days as timeline cards into cardsAreaEl.
 * todayIndex: index of the day matching today's calendar date, or -1.
 *
 * Cross-midnight items are split: clipped at midnight on day i, then a
 * continuation pill is prepended (from midnight) on day i+1.
 */
export function renderTimeline(days, cardsAreaEl, todayIndex = -1) {
  cardsAreaEl.innerHTML = '';

  // continuations[i] = array of { item, startH, endH } to inject into day i
  const continuations = days.map(() => []);

  days.forEach((day, i) => {
    if (i + 1 >= days.length) return;
    const nextDay = days[i + 1];

    for (const item of day.items) {
      const hours = itemHours(item, day.tz);
      if (!hours || item.allDay) continue;

      const { startH, endH } = hours;
      if (endH > 24) {
        // Compute the end hour in the NEXT day's timezone so it aligns with
        // that grid (timezones may differ between origin and destination).
        let contEndH;
        if (item.timelineEnd) {
          contEndH = localHour(item.timelineEnd, nextDay.tz);
          // If contEndH is 0 it literally means midnight — treat as 24 so the
          // pill spans the full continuation (shouldn't normally happen).
          if (contEndH === 0) contEndH = 24;
        } else {
          contEndH = endH - 24;
        }
        continuations[i + 1].push({
          item,
          startH: 0,
          endH: Math.max(Math.min(contEndH, 24), 1),
        });
      }
    }
  });

  days.forEach((day, i) => {
    cardsAreaEl.appendChild(buildTimelineCard(day, i, i === todayIndex, continuations[i]));
  });
}

function buildTimelineCard(day, index, isToday = false, continuations = []) {
  const card = document.createElement('div');
  card.className = 'day-card tl-card';
  card.id = `day-card-${index}`;

  const header = document.createElement('div');
  header.className = 'day-card-title';
  header.innerHTML = `<span>${day.label}</span>`;
  card.appendChild(header);

  card.appendChild(buildGrid(day, isToday, continuations));

  return card;
}

function buildGrid(day, isToday = false, continuations = []) {
  // ── 1. Collect and measure items (before touching the DOM) ─────────────────

  const timedItems = [];

  for (const item of day.items) {
    const hours = itemHours(item, day.tz);
    if (!hours) continue;

    const { startH } = hours;
    // Clip endH to midnight; cross-midnight remainder lives on the next day
    const endH = Math.min(hours.endH, 24);
    // 1-hour minimum display height — extend downward, capped at midnight
    const displayEndH = Math.min(Math.max(endH, startH + 1), 24);
    timedItems.push({ item, startH, endH: displayEndH });
  }

  // Inject continuation pills from the previous day
  for (const cont of continuations) {
    timedItems.push(cont);
  }

  // Sort by start time; longer events first on ties (better column packing)
  timedItems.sort((a, b) =>
    a.startH - b.startH || (b.endH - b.startH) - (a.endH - a.startH)
  );

  // Greedy column assignment
  const colEnds = [];
  for (const ti of timedItems) {
    let col = colEnds.findIndex(e => e <= ti.startH);
    if (col === -1) { col = colEnds.length; colEnds.push(ti.endH); }
    else            { colEnds[col] = ti.endH; }
    ti.col = col;
  }
  const numCols = Math.max(colEnds.length, 1);

  // ── 2. Build DOM ───────────────────────────────────────────────────────────

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

  // Right area
  const rightArea = document.createElement('div');
  rightArea.className = 'tl-right-area';

  // Pill area (always exactly 24 h tall)
  const pillArea = document.createElement('div');
  pillArea.className = 'tl-pill-area';
  pillArea.style.height = `${24 * HOUR_H}px`;

  // Hour grid lines
  for (let h = 0; h < 24; h++) {
    const rule = document.createElement('div');
    rule.className = 'tl-rule';
    rule.style.top = `${h * HOUR_H}px`;
    pillArea.appendChild(rule);
  }

  // Timed pills — equal width, positioned by column
  const GAP = 3; // px between pills and edges
  for (const { item, startH, endH, col } of timedItems) {
    const dur = endH - startH;
    const pill = document.createElement('div');
    pill.className = `tl-pill tl-pill--${item.category}`;
    pill.style.top    = `${startH * HOUR_H}px`;
    pill.style.height = `${dur * HOUR_H - GAP}px`;
    pill.style.left   = `calc(${(col / numCols) * 100}% + ${GAP}px)`;
    pill.style.width  = `calc(${(1 / numCols) * 100}% - ${GAP * 2}px)`;
    pill.title = item.text;

    const icon = document.createElement('span');
    icon.className = 'tl-pill-icon';
    icon.textContent = item.icon || '';
    pill.appendChild(icon);

    // Label always shows (1-hour min height guarantees room)
    if (LABEL[item.category]) {
      const lbl = document.createElement('span');
      lbl.className = 'tl-pill-label';
      lbl.textContent = LABEL[item.category];
      pill.appendChild(lbl);
    }

    pillArea.appendChild(pill);
  }

  // Current-time indicator
  if (isToday) {
    const nowH = localHour(new Date(), day.tz);
    const nowLine = document.createElement('div');
    nowLine.className = 'tl-now-line';
    nowLine.style.top = `${nowH * HOUR_H}px`;
    pillArea.appendChild(nowLine);
  }

  rightArea.appendChild(pillArea);
  wrapper.appendChild(rightArea);
  return wrapper;
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
